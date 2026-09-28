/**
 * Uji konsultasi sebagai tindakan + diskon dokter.
 *
 *   node uji/jalankan.mjs uji-konsultasi-diskon.ts
 *
 * Fitur ini menyentuh UANG, jadi yang dibuktikan bukan tersimpannya kolom
 * melainkan angka yang benar-benar masuk tagihan pasien. Empat hal yang bisa
 * salah dan tidak akan terlihat sampai kas kasir tidak cocok:
 *
 *   1. Konsultasi tertagih DUA KALI — sebagai tindakan dan sebagai jasa
 *      dokter otomatis. Inilah yang sudah terjadi sebelum perubahan ini.
 *   2. Diskon dipasang pada tindakan yang bukan konsultasi lewat permintaan
 *      yang dirakit sendiri, melewati form.
 *   3. Diskon melebihi nilai tindakan → subtotal negatif → total tagihan
 *      pasien justru BERKURANG.
 *   4. Konsultasi yang sengaja dihapus dokter tetap tertagih.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne } from "../src/lib/db";
import { konsultasiDefault, simpanAsesmen } from "../src/lib/doctor";
import { asesmenSchema } from "../src/lib/validations/doctor";
import { tanggalHariIni } from "../src/lib/tanggal";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

const TANDA = "UJIKSL";
const hariIni = tanggalHariIni();

// =====================================================================
// Persiapan
// =====================================================================
async function bersih() {
  const sites = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM sites WHERE kode LIKE '${TANDA}%'`)
  ).map((r) => r.id);
  if (sites.length) {
    const s = sites.join(",");
    await execute(`DELETE FROM billing_items WHERE billing_id IN (SELECT id FROM billing_transactions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM billing_transactions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM assessment_procedures WHERE assessment_id IN (SELECT id FROM medical_assessments WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM medical_assessments WHERE site_id IN (${s})`);
    await execute(`DELETE FROM visits WHERE site_id IN (${s})`);
    await execute(`DELETE FROM patients WHERE site_id IN (${s})`);
    await execute(`DELETE FROM polis WHERE site_id IN (${s})`);
    await execute(`DELETE FROM sequences WHERE site_id IN (${s})`);
    await execute(`DELETE FROM doctor_profiles WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${TANDA}%')`);
    await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
    await execute(`DELETE FROM sites WHERE id IN (${s})`);
  } else {
    await execute(`DELETE FROM doctor_profiles WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${TANDA}%')`);
    await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
  }
  await execute(`DELETE FROM medical_procedures WHERE kode LIKE '${TANDA}%'`);
  await execute(`DELETE FROM icd10_codes WHERE code LIKE '${TANDA}%'`);
}
await bersih();

const site = (await execute(
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}', 'Uji Konsultasi')`,
)).insertId;

const roleDokter = Number((await queryOne<RowDataPacket & { id: number }>(
  `SELECT id FROM roles WHERE code = 'dokter'`))!.id);

const dokter = (await execute(
  `INSERT INTO users (site_id, role_id, nama, username, password_hash)
   VALUES (?,?, 'dr. Uji Konsultasi', '${TANDA}.dokter', 'x')`, [site, roleDokter],
)).insertId;

/*
 * Tarif konsultasi dokter SENGAJA diisi. Dulu nilai ini terbit sendiri
 * sebagai baris `jasa_dokter` saat finalisasi — uji di bawah membuktikan
 * ia tidak lagi menagih.
 */
await execute(
  `INSERT INTO doctor_profiles (user_id, tarif_konsultasi) VALUES (?, 50000)`,
  [dokter],
);

const poliUmum = (await execute(
  `INSERT INTO polis (site_id, kode, nama) VALUES (?, '${TANDA}-U', 'Poli Umum')`, [site],
)).insertId;
const poliGigi = (await execute(
  `INSERT INTO polis (site_id, kode, nama) VALUES (?, '${TANDA}-G', 'Poli Gigi')`, [site],
)).insertId;

const proc = async (kode: string, nama: string, tarif: number, konsultasi: boolean) =>
  (await execute(
    `INSERT INTO medical_procedures (kode, nama, kategori, is_konsultasi, tarif)
     VALUES (?,?, 'Uji', ?, ?)`,
    [`${TANDA}-${kode}`, nama, konsultasi ? 1 : 0, tarif],
  )).insertId;

const kslUmum = await proc("K1", "Konsultasi Dokter Umum", 50000, true);
const kslGigi = await proc("K2", "Konsultasi Dokter Gigi", 75000, true);
const nebulizer = await proc("T1", "Nebulizer", 65000, false);

let noUrut = 0;
async function buatVisit(poli: number) {
  noUrut++;
  const pasien = (await execute(
    `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin)
     VALUES (?,?,?,?, '1990-01-01', 'L')`,
    [site, `${TANDA}-${noUrut}`, `327300000009${1000 + noUrut}`, `Pasien ${noUrut}`],
  )).insertId;

  return (await execute(
    `INSERT INTO visits (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
                         jenis_kunjungan, status, registered_by)
     VALUES (?,?,?,?,?,?, 'baru', 'menunggu_dokter', ?)`,
    [site, pasien, `${TANDA}/V/${noUrut}`, hariIni, poli, dokter, dokter],
  )).insertId;
}

/*
 * Kode ICD dibuat sendiri: asesmen tidak bisa difinalkan tanpa satu diagnosa
 * primer, dan meminjam kode dari data contoh membuat uji ini berhenti bekerja
 * begitu basis data dikosongkan untuk go-live.
 */
await execute(
  `INSERT INTO icd10_codes (code, nama_id, nama_en) VALUES (?, 'Diagnosa Uji', 'Test Dx')
   ON DUPLICATE KEY UPDATE nama_id = VALUES(nama_id)`,
  [`${TANDA}9.9`],
);

const asesmen = (procedures: Record<string, unknown>[], finalkan = true) =>
  asesmenSchema.parse({
    subjective: "Keluhan uji",
    finalkan,
    diagnoses: [{ icd10_code: `${TANDA}9.9`, nama: "Diagnosa Uji", tipe: "primer" }],
    procedures,
  });

const tagihan = async (visitId: number) => {
  const t = await queryOne<RowDataPacket & { id: number; total: string }>(
    `SELECT id, total FROM billing_transactions WHERE visit_id = ?`, [visitId],
  );
  const baris = await query<RowDataPacket & {
    kategori: string; deskripsi: string; harga_satuan: string; diskon: string; subtotal: string;
  }>(
    `SELECT kategori, deskripsi, harga_satuan, diskon, subtotal
       FROM billing_items WHERE billing_id = ? ORDER BY id`, [t?.id ?? 0],
  );
  return { total: Number(t?.total ?? 0), baris };
};

// =====================================================================
// 1. Default konsultasi mengikuti poli
// =====================================================================
console.log("\n== 1. Default konsultasi per poli ==");

const vUmum = await buatVisit(poliUmum);
const vGigi = await buatVisit(poliGigi);

const defUmum = await konsultasiDefault(vUmum, site);
const defGigi = await konsultasiDefault(vGigi, site);

/*
 * Diuji lewat NAMA, bukan id. `medical_procedures` adalah master global tanpa
 * kolom cabang, jadi konsultasi milik klinik yang sesungguhnya ikut menjadi
 * kandidat — dan kalau salah satunya yang terpilih, itu justru benar. Yang
 * dijanjikan fungsi ini adalah "konsultasi yang paling cocok dengan poli",
 * dan itulah yang diperiksa.
 */
ok("Poli Umum mendapat konsultasi umum",
  /umum/i.test(String(defUmum?.nama)), String(defUmum?.nama));
ok("Poli Gigi mendapat konsultasi GIGI, bukan umum",
  /gigi/i.test(String(defGigi?.nama)), String(defGigi?.nama));
ok("keduanya benar-benar berbeda", defUmum?.id !== defGigi?.id,
  `${defUmum?.nama} vs ${defGigi?.nama}`);
ok("tarifnya ikut terbaca", Number(defGigi?.tarif) > 0, String(defGigi?.tarif));

// Poli tanpa padanan nama tetap dapat konsultasi — jatuh ke yang pertama.
const poliLain = (await execute(
  `INSERT INTO polis (site_id, kode, nama) VALUES (?, '${TANDA}-X', 'Poli KIA')`, [site],
)).insertId;
const vLain = await buatVisit(poliLain);
const defLain = await konsultasiDefault(vLain, site);
ok("poli tanpa padanan tetap mendapat konsultasi", defLain !== null, String(defLain?.nama));

// =====================================================================
// 2. Konsultasi TIDAK tertagih dua kali
// =====================================================================
console.log("\n== 2. Tidak ada tagihan konsultasi ganda ==");

await simpanAsesmen(vUmum, site, dokter, asesmen([
  { procedure_id: kslUmum, nama: "Konsultasi Dokter Umum", qty: 1, tarif: 50000 },
]));

const tUmum = await tagihan(vUmum);
ok("tagihan hanya 50.000, bukan 100.000", tUmum.total === 50000, `Rp ${tUmum.total}`);
ok("tidak ada baris jasa_dokter otomatis",
  !tUmum.baris.some((b) => b.kategori === "jasa_dokter"),
  tUmum.baris.map((b) => `${b.kategori}:${Number(b.subtotal)}`).join(", "));
ok("konsultasi tercatat sebagai tindakan",
  tUmum.baris.filter((b) => b.kategori === "tindakan").length === 1);

// =====================================================================
// 3. Diskon konsultasi
// =====================================================================
console.log("\n== 3. Diskon konsultasi ==");

await simpanAsesmen(vGigi, site, dokter, asesmen([
  {
    procedure_id: kslGigi, nama: "Konsultasi Dokter Gigi", qty: 1, tarif: 75000,
    diskon: 25000, alasan_diskon: "Keringanan pasien tidak mampu",
  },
  { procedure_id: nebulizer, nama: "Nebulizer", qty: 1, tarif: 65000 },
]));

const tGigi = await tagihan(vGigi);
ok("total = (75.000 − 25.000) + 65.000", tGigi.total === 115000, `Rp ${tGigi.total}`);

const barisKsl = tGigi.baris.find((b) => b.deskripsi.includes("Konsultasi"));
ok("diskon ikut ke baris tagihan", Number(barisKsl?.diskon) === 25000, String(barisKsl?.diskon));
ok("harga satuan tetap tarif penuh — potongan terlihat di struk",
  Number(barisKsl?.harga_satuan) === 75000, String(barisKsl?.harga_satuan));

const apKsl = await queryOne<RowDataPacket & { diskon: string; alasan_diskon: string | null; subtotal: string }>(
  `SELECT ap.diskon, ap.alasan_diskon, ap.subtotal
     FROM assessment_procedures ap JOIN medical_assessments ma ON ma.id = ap.assessment_id
    WHERE ma.visit_id = ? AND ap.procedure_id = ?`, [vGigi, kslGigi],
);
ok("alasan tersimpan", apKsl?.alasan_diskon === "Keringanan pasien tidak mampu",
  String(apKsl?.alasan_diskon));
ok("subtotal tindakan = tarif − diskon", Number(apKsl?.subtotal) === 50000, String(apKsl?.subtotal));

// =====================================================================
// 4. Batas yang menjaga uang
// =====================================================================
console.log("\n== 4. Batas diskon ==");

/*
 * Diskon pada tindakan BUKAN konsultasi harus dibuang. Form tidak
 * menampilkan kolomnya, tetapi Server Action bisa dipanggil langsung.
 */
const vCurang = await buatVisit(poliUmum);
await simpanAsesmen(vCurang, site, dokter, asesmen([
  { procedure_id: nebulizer, nama: "Nebulizer", qty: 1, tarif: 65000, diskon: 60000 },
]));
const tCurang = await tagihan(vCurang);
ok("diskon pada tindakan non-konsultasi diabaikan", tCurang.total === 65000, `Rp ${tCurang.total}`);

const apCurang = await queryOne<RowDataPacket & { diskon: string }>(
  `SELECT ap.diskon FROM assessment_procedures ap
     JOIN medical_assessments ma ON ma.id = ap.assessment_id
    WHERE ma.visit_id = ?`, [vCurang],
);
ok("diskonnya tidak ikut tersimpan", Number(apCurang?.diskon) === 0, String(apCurang?.diskon));

// Diskon melebihi nilai tindakan → dipotong, bukan jadi subtotal negatif.
const vLebih = await buatVisit(poliUmum);
await simpanAsesmen(vLebih, site, dokter, asesmen([
  { procedure_id: kslUmum, nama: "Konsultasi Dokter Umum", qty: 1, tarif: 50000, diskon: 999999 },
]));
const tLebih = await tagihan(vLebih);
ok("diskon berlebih dipotong pada nilai tindakan — total 0, bukan negatif",
  tLebih.total === 0, `Rp ${tLebih.total}`);
ok("total tagihan tidak pernah negatif", tLebih.total >= 0);

/*
 * Database adalah pertahanan terakhir — kode di atas bisa saja suatu saat
 * diubah tanpa menyadari akibatnya.
 */
let ditolakDb = "";
try {
  const ma = await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM medical_assessments WHERE visit_id = ?`, [vLebih],
  );
  await execute(
    `INSERT INTO assessment_procedures (assessment_id, procedure_id, qty, tarif, diskon, subtotal)
     VALUES (?,?, 1, 50000, 80000, -30000)`,
    [Number(ma?.id ?? 0), nebulizer],
  );
} catch (e) {
  ditolakDb = (e as Error).message;
}
ok("INSERT langsung dengan diskon > tarif ditolak database", ditolakDb !== "",
  ditolakDb || "LOLOS — CHECK ck_ap_diskon tidak bekerja");

// =====================================================================
// 5. Konsultasi yang dihapus benar-benar tidak tertagih
// =====================================================================
console.log("\n== 5. Konsultasi dihapus (pasien kurang mampu) ==");

const vGratis = await buatVisit(poliUmum);
await simpanAsesmen(vGratis, site, dokter, asesmen([]));

const tGratis = await tagihan(vGratis);
ok("tanpa tindakan sama sekali, tagihan 0", tGratis.total === 0, `Rp ${tGratis.total}`);
ok("tidak ada baris apa pun yang terbit diam-diam",
  tGratis.baris.length === 0,
  tGratis.baris.map((b) => b.kategori).join(", ") || "(kosong)");

/*
 * Kasus yang paling mudah terlewat: dokter menghapus konsultasi pada asesmen
 * yang SEBELUMNYA punya konsultasi. Baris tagihan lamanya harus ikut hilang,
 * bukan tertinggal.
 *
 * Disimpan sebagai draf (`finalkan: false`) supaya kunjungannya masih boleh
 * disunting — finalisasi mendorong pasien ke tahap berikutnya dan mengunci
 * asesmennya, persis seperti di layar sungguhan.
 */
const vHapus = await buatVisit(poliUmum);
await simpanAsesmen(vHapus, site, dokter, asesmen([
  { procedure_id: kslUmum, nama: "Konsultasi Dokter Umum", qty: 1, tarif: 50000 },
], false));
const tSebelumHapus = await tagihan(vHapus);
ok("konsultasi tertagih lebih dulu", tSebelumHapus.total === 50000, `Rp ${tSebelumHapus.total}`);

await simpanAsesmen(vHapus, site, dokter, asesmen([], false));
const tSesudahHapus = await tagihan(vHapus);
ok("konsultasi yang dihapus ikut hilang dari tagihan",
  tSesudahHapus.total === 0,
  `Rp ${tSesudahHapus.total} (sebelumnya Rp ${tSebelumHapus.total})`);
ok("baris tagihannya benar-benar dibuang, bukan disisakan bernilai 0",
  tSesudahHapus.baris.length === 0,
  `${tSesudahHapus.baris.length} baris tersisa`);

// =====================================================================
await bersih();
console.log(`\n${gagal === 0 ? "SEMUA UJI LULUS" : `${gagal} UJI GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
