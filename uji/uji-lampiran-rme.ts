/**
 * Uji dokumen pendukung rekam medis.
 *
 *   node uji/jalankan.mjs uji-lampiran-rme.ts
 *
 * Fitur ini menaruh berkas milik orang lain di server, jadi yang diuji bukan
 * "apakah berkasnya tersimpan" melainkan batas-batasnya:
 *
 *   - Berkas divalidasi dari ISINYA (magic bytes), bukan dari `File.type`
 *     yang datang dari peramban dan bisa dipalsukan.
 *   - Satu berkas buruk tidak boleh menggagalkan seluruh unggahan.
 *   - Nama berkas dari pengunggah tidak pernah menjadi jalur di disk —
 *     di situlah path traversal masuk.
 *   - Penghapusan tidak membuang barisnya; rekam medis tidak berubah diam-diam.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne } from "../src/lib/db";
import { bacaBerkas, hapusBerkas } from "../src/lib/berkas";
import {
  daftarLampiran, hapusLampiran, pemilikLampiran, ubahKeterangan, unggahLampiran,
} from "../src/lib/lampiran-rme";
import { tanggalHariIni } from "../src/lib/tanggal";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

const TANDA = "UJILMP";
const hariIni = tanggalHariIni();

// =====================================================================
// Berkas contoh — magic bytes yang benar-benar sesuai formatnya.
// =====================================================================
const isiPdf = Buffer.concat([
  Buffer.from("%PDF-1.4\n", "latin1"),
  Buffer.alloc(2048, 0x20),
]);
const isiPng = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(1024, 0x00),
]);
const isiJpg = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(512, 0x00),
]);

const berkas = (isi: Buffer, nama: string, mime: string) =>
  new File([new Uint8Array(isi)], nama, { type: mime });

// =====================================================================
// Persiapan
// =====================================================================
async function bersih() {
  const sites = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM sites WHERE kode LIKE '${TANDA}%'`)
  ).map((r) => r.id);

  if (sites.length) {
    const s = sites.join(",");
    // Berkas fisiknya ikut dibersihkan — uji tidak boleh meninggalkan sampah.
    const kunci = await query<RowDataPacket & { kunci: string }>(
      `SELECT kunci FROM visit_documents WHERE site_id IN (${s})`,
    );
    for (const k of kunci) await hapusBerkas(k.kunci);

    await execute(`DELETE FROM visit_documents WHERE site_id IN (${s})`);
    await execute(`DELETE FROM visits WHERE site_id IN (${s})`);
    await execute(`DELETE FROM patients WHERE site_id IN (${s})`);
    await execute(`DELETE FROM polis WHERE site_id IN (${s})`);
    await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
    await execute(`DELETE FROM sites WHERE id IN (${s})`);
  } else {
    await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
  }
}
await bersih();

const site = (await execute(
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}', 'Uji Lampiran')`,
)).insertId;

const roleDokter = Number((await queryOne<RowDataPacket & { id: number }>(
  `SELECT id FROM roles WHERE code = 'dokter'`))!.id);

const dokter = (await execute(
  `INSERT INTO users (site_id, role_id, nama, username, password_hash)
   VALUES (?,?, 'dr. Uji Lampiran', '${TANDA}.dokter', 'x')`, [site, roleDokter],
)).insertId;

const poli = (await execute(
  `INSERT INTO polis (site_id, kode, nama) VALUES (?, '${TANDA}-PU', 'Poli Uji')`, [site],
)).insertId;

const pasien = (await execute(
  `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin)
   VALUES (?, '${TANDA}-001', '3273${Date.now().toString().slice(-12)}', 'Pasien Uji', '1990-01-01', 'P')`,
  [site],
)).insertId;

const visit = (await execute(
  `INSERT INTO visits (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
                       jenis_kunjungan, status, registered_by)
   VALUES (?,?, '${TANDA}/V/1', ?, ?, ?, 'baru', 'dalam_pemeriksaan', ?)`,
  [site, pasien, hariIni, poli, dokter, dokter],
)).insertId;

const unggah = (b: { file: File; keterangan: string }[]) =>
  unggahLampiran(visit, site, pasien, dokter, b);

// =====================================================================
// 1. Unggah banyak sekaligus, masing-masing dengan keterangannya
// =====================================================================
console.log("\n== 1. Unggah beberapa dokumen sekaligus ==");

const h1 = await unggah([
  { file: berkas(isiPdf, "hasil-usg.pdf", "application/pdf"), keterangan: "Hasil USG abdomen" },
  { file: berkas(isiPng, "rontgen.png", "image/png"), keterangan: "Rontgen thorax PA" },
  { file: berkas(isiJpg, "rujukan.jpg", "image/jpeg"), keterangan: "" },
]);

ok("tiga dokumen tersimpan", h1.tersimpan === 3, `${h1.tersimpan} tersimpan`);
ok("tidak ada yang ditolak", h1.ditolak.length === 0, JSON.stringify(h1.ditolak));

const daftar1 = await daftarLampiran(visit);
ok("ketiganya terbaca kembali", daftar1.length === 3, `${daftar1.length} baris`);

const usg = daftar1.find((d) => d.nama_asli === "hasil-usg.pdf");
ok("keterangan tersimpan per dokumen",
  usg?.keterangan === "Hasil USG abdomen", String(usg?.keterangan));
ok("keterangan kosong disimpan NULL, bukan string kosong",
  daftar1.find((d) => d.nama_asli === "rujukan.jpg")?.keterangan === null);
ok("mime disimpan sesuai ISI berkas", usg?.mime === "application/pdf", String(usg?.mime));
ok("nama pengunggah ikut terbaca", usg?.pengunggah === "dr. Uji Lampiran", String(usg?.pengunggah));

// =====================================================================
// 2. Berkas benar-benar ada di storage dan bisa dibaca kembali
// =====================================================================
console.log("\n== 2. Berkas tersimpan di storage ==");

const fisik = await bacaBerkas(String(usg?.kunci));
ok("berkas terbaca dari storage", fisik !== null);
ok("isinya utuh", fisik?.isi.length === isiPdf.length, `${fisik?.isi.length} byte`);
ok("kunci berada di kategori 'rekam'",
  String(usg?.kunci).startsWith("rekam/"), String(usg?.kunci));

/*
 * Nama dari pengunggah TIDAK boleh muncul di jalur berkas. Kalau ia ikut,
 * nama seperti "../../etc/passwd" menjadi celah path traversal.
 */
ok("nama asli tidak ikut jadi jalur berkas",
  !String(usg?.kunci).includes("hasil-usg"), String(usg?.kunci));
ok("nama berkas dibuat dari byte acak",
  /^rekam\/\d{6}\/[a-f0-9]{32}\.pdf$/.test(String(usg?.kunci)), String(usg?.kunci));

// =====================================================================
// 3. Berkas yang harus DITOLAK
// =====================================================================
console.log("\n== 3. Berkas yang ditolak ==");

/*
 * Mengaku PDF, isinya bukan. Inilah alasan `File.type` tidak pernah dipercaya:
 * nilainya berasal dari peramban dan bisa dibuat sesuka pengunggah.
 */
const h2 = await unggah([
  {
    file: berkas(Buffer.from("<?php system($_GET[0]); ?>", "latin1"), "jahat.pdf", "application/pdf"),
    keterangan: "Mengaku PDF",
  },
]);
ok("berkas yang isinya bukan PDF ditolak", h2.tersimpan === 0 && h2.ditolak.length === 1);
ok("alasan penolakan disebutkan",
  /tidak didukung/i.test(h2.ditolak[0]?.alasan ?? ""), h2.ditolak[0]?.alasan);

const h3 = await unggah([
  { file: berkas(Buffer.alloc(0), "kosong.pdf", "application/pdf"), keterangan: "" },
]);
ok("berkas kosong ditolak", h3.tersimpan === 0, h3.ditolak[0]?.alasan);

const h4 = await unggah([
  {
    file: berkas(
      Buffer.concat([Buffer.from("%PDF-1.4\n", "latin1"), Buffer.alloc(6 * 1024 * 1024)]),
      "besar.pdf", "application/pdf",
    ),
    keterangan: "",
  },
]);
ok("berkas melebihi 5 MB ditolak", h4.tersimpan === 0, h4.ditolak[0]?.alasan);
ok("penolakan ukuran menyebut batasnya",
  /MB/.test(h4.ditolak[0]?.alasan ?? ""), h4.ditolak[0]?.alasan);

// =====================================================================
// 4. Satu berkas buruk tidak menggagalkan yang lain
// =====================================================================
console.log("\n== 4. Kegagalan sebagian ==");

const h5 = await unggah([
  { file: berkas(isiPdf, "baik-1.pdf", "application/pdf"), keterangan: "Dokumen baik 1" },
  { file: berkas(Buffer.from("bukan berkas gambar"), "buruk.png", "image/png"), keterangan: "x" },
  { file: berkas(isiPng, "baik-2.png", "image/png"), keterangan: "Dokumen baik 2" },
]);

ok("dua yang baik tetap tersimpan", h5.tersimpan === 2, `${h5.tersimpan} tersimpan`);
ok("yang buruk dilaporkan tersendiri", h5.ditolak.length === 1, JSON.stringify(h5.ditolak));
ok("laporan menyebut NAMA berkas yang gagal",
  h5.ditolak[0]?.nama === "buruk.png", h5.ditolak[0]?.nama);
ok("dokumen setelah yang gagal tetap diproses",
  (await daftarLampiran(visit)).some((d) => d.nama_asli === "baik-2.png"),
  "berkas ketiga tidak ikut terhenti oleh kegagalan berkas kedua");

// =====================================================================
// 5. Keterangan bisa diubah
// =====================================================================
console.log("\n== 5. Mengubah keterangan ==");

const target = (await daftarLampiran(visit)).find((d) => d.nama_asli === "rujukan.jpg")!;
await ubahKeterangan(target.id, visit, "  Surat rujukan balik RSUD  ");
const sesudah = (await daftarLampiran(visit)).find((d) => d.id === target.id);
ok("keterangan diperbarui", sesudah?.keterangan === "Surat rujukan balik RSUD", String(sesudah?.keterangan));

await ubahKeterangan(target.id, visit, "   ");
ok("keterangan yang dikosongkan menjadi NULL",
  (await daftarLampiran(visit)).find((d) => d.id === target.id)?.keterangan === null);

/*
 * visit_id ikut jadi syarat WHERE. Tanpa itu, id dokumen yang ditebak dari
 * kunjungan lain bisa disunting lewat layar kunjungan ini.
 */
await ubahKeterangan(target.id, visit + 99999, "Disuntik dari kunjungan lain");
ok("penyuntingan lewat visit_id yang salah tidak berpengaruh",
  (await daftarLampiran(visit)).find((d) => d.id === target.id)?.keterangan === null);

// =====================================================================
// 6. Hak baca berkas
// =====================================================================
console.log("\n== 6. Penentu hak baca ==");

const milik = await pemilikLampiran(String(usg?.kunci));
ok("pemilik berkas terbaca dari kuncinya", milik?.siteId === site, String(milik?.siteId));
ok("kunci yang tidak dikenal tidak berpemilik",
  (await pemilikLampiran("rekam/202608/" + "0".repeat(32) + ".pdf")) === null);

// Jalur di luar pola ditolak sebelum menyentuh disk sama sekali.
for (const jahat of [
  "rekam/202608/../../../package.json",
  "../package.json",
  "rekam/202608/abc.pdf",
]) {
  ok(`jalur "${jahat}" ditolak`, (await bacaBerkas(jahat)) === null);
}

// =====================================================================
// 7. Penghapusan menyembunyikan, bukan membuang
// =====================================================================
console.log("\n== 7. Penghapusan ==");

const sebelumHapus = (await daftarLampiran(visit)).length;
const terhapus = await hapusLampiran(target.id, visit, dokter);
ok("penghapusan berhasil", terhapus);
ok("hilang dari daftar",
  (await daftarLampiran(visit)).length === sebelumHapus - 1,
  `${(await daftarLampiran(visit)).length} tersisa`);

const baris = await queryOne<RowDataPacket & { deleted_by: number; deleted_at: string }>(
  `SELECT deleted_by, deleted_at FROM visit_documents WHERE id = ?`, [target.id],
);
ok("barisnya TIDAK dibuang dari database", baris !== null);
ok("tercatat siapa yang menghapus", Number(baris?.deleted_by) === dokter);
ok("dokumen terhapus tidak lagi berpemilik (tidak bisa dibaca lewat API)",
  (await pemilikLampiran(target.kunci)) === null);

ok("menghapus dua kali tidak berpengaruh",
  (await hapusLampiran(target.id, visit, dokter)) === false);

// =====================================================================
await bersih();
console.log(`\n${gagal === 0 ? "SEMUA UJI LULUS" : `${gagal} UJI GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
