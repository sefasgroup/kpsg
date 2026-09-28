/**
 * Uji jalur notifikasi: kirim, baca, isolasi antar pengguna & cabang.
 *
 *   node uji/jalankan.mjs uji-notifikasi.ts
 *
 * Butuh data contoh (scripts/data-contoh.ts) karena memakai akun cabang PST/CMH.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, queryOne, transaction } from "@/lib/db";
import {
  hitungBelumDibaca, kirimNotifikasi, notifikasiSaya,
  tandaiDibaca, tandaiSemuaDibaca,
} from "@/lib/notifications";
import { bolehKeCabang, type SessionUser } from "@/lib/session";
import { GAYA_NOTIFIKASI } from "@/lib/notification-labels";

let gagal = 0;
const ok = (n: string, l: boolean, d = "") => {
  console.log(`  ${l ? "PASS" : "GAGAL"}  ${n}${d ? " — " + d : ""}`);
  if (!l) gagal++;
};

const idSite = async (kode: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM sites WHERE kode = ?`, [kode]))!.id);
const idUser = async (u: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM users WHERE username = ?`, [u]))!.id);

/** Sesi tiruan — bentuk yang sama dengan hasil verifikasi token. */
const sesi = (id: number, role: string, siteId: number): SessionUser => ({
  id, nama: "Uji", username: "uji", role: role as never,
  roleNama: role, siteId, siteNama: null, siteIds: [siteId],
  mustChangePw: false,
});

const pst = await idSite("PST");
const cmh = await idSite("CMH");
const sFarmasi = sesi(await idUser("farmasi.pst"), "farmasi", pst);
const sKasir = sesi(await idUser("kasir.pst"), "kasir", pst);
const sFarmasiCmh = sesi(await idUser("farmasi.cmh"), "farmasi", cmh);

await execute(`DELETE FROM notifications`);

console.log("\n== Kirim ke satu orang ==");
await kirimNotifikasi(
  { userId: sFarmasi.id },
  { jenis: "resep_masuk", judul: "Uji: resep masuk", pesan: "Pasien Uji", link: "/farmasi" },
);
let d = await notifikasiSaya(sFarmasi);
ok("sampai ke penerima", d.length === 1, d[0]?.judul);
ok("terhitung belum dibaca", Number(await hitungBelumDibaca(sFarmasi)) === 1);
ok("TIDAK bocor ke pengguna lain", (await notifikasiSaya(sKasir)).length === 0);

console.log("\n== Siaran ke seluruh peran di satu cabang ==");
await kirimNotifikasi(
  { roleCode: "farmasi", siteId: pst },
  { jenis: "stok_menipis", judul: "Uji: stok menipis", pesan: "Amoksisilin" },
);
d = await notifikasiSaya(sFarmasi);
ok("siaran peran diterima", d.length === 2);

const dCmh = await notifikasiSaya(sFarmasiCmh);
ok("siaran TIDAK menyeberang cabang", dCmh.length === 0, `${dCmh.length} di Cimahi`);

console.log("\n== Tandai dibaca ==");
await tandaiDibaca(d[0].id, sFarmasi);
ok("satu notifikasi jadi terbaca", Number(await hitungBelumDibaca(sFarmasi)) === 1);
await tandaiSemuaDibaca(sFarmasi);
ok("tandai semua bekerja", Number(await hitungBelumDibaca(sFarmasi)) === 0);

console.log("\n== Kepemilikan ditegakkan ==");
await kirimNotifikasi({ userId: sFarmasi.id }, { jenis: "resep_masuk", judul: "Uji: milik farmasi" });
const milik = (await notifikasiSaya(sFarmasi)).find((n) => !n.is_read)!;
await tandaiDibaca(milik.id, sKasir); // kasir mencoba menandai milik orang lain
const masih = await queryOne<RowDataPacket & { is_read: number }>(
  `SELECT is_read FROM notifications WHERE id = ?`, [milik.id],
);
ok("pengguna lain tidak bisa menandai notifikasi bukan miliknya",
  Number(masih?.is_read) === 0,
  "kepemilikan ada di klausa WHERE, bukan hanya di UI");

// =====================================================================
console.log("\n== Estafet pelayanan pasien (CLAUDE.md §3.1) ==");
// =====================================================================
/*
 * Diuji sebagai SATU alur berurutan, bukan empat pemanggilan terpisah.
 *
 * Yang ingin dibuktikan bukan "fungsi X mengirim notifikasi", melainkan
 * bahwa setiap serah terima benar-benar sampai ke peran berikutnya — dan
 * TIDAK sampai ke peran yang belum gilirannya. Kesalahan sasaran hanya
 * terlihat kalau seluruh rantainya dijalankan bersama.
 */
await execute(`DELETE FROM notifications`);

const sPerawat = sesi(await idUser("perawat.pst"), "perawat", pst);
const sDokter = sesi(await idUser("dr.rafi"), "dokter", pst);
const sLab = sesi(await idUser("lab.pst"), "petugas_lab", pst);

const pasienUji = Number((await queryOne<RowDataPacket & { id: number }>(
  `SELECT id FROM patients ORDER BY id LIMIT 1`))?.id ?? 0);

if (!pasienUji) {
  console.log("  (dilewati — belum ada pasien; jalankan alur pendaftaran dulu)");
} else {
  const poli = Number((await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM polis WHERE site_id = ? LIMIT 1`, [pst]))!.id);

  // 1. Pendaftaran -> Perawat
  await kirimNotifikasi({ roleCode: "perawat", siteId: pst }, {
    jenis: "pasien_baru", judul: "A001 — Pasien Uji",
    pesan: "Poli Umum · menunggu pengkajian awal", siteId: pst,
  });
  ok("1. daftar -> perawat menerima",
    (await notifikasiSaya(sPerawat)).some((n) => n.jenis === "pasien_baru"));
  ok("   dokter BELUM menerima apa pun",
    (await notifikasiSaya(sDokter)).length === 0);

  // 2. Perawat -> Dokter (ke dokter tertentu, bukan siaran)
  await kirimNotifikasi({ userId: sDokter.id }, {
    jenis: "triase_selesai", judul: "A001 — Pasien Uji",
    pesan: "Triase hijau · TD 120/80 · demam 3 hari", siteId: pst,
  });
  ok("2. triase -> dokter menerima",
    (await notifikasiSaya(sDokter)).some((n) => n.jenis === "triase_selesai"));
  ok("   petugas lab BELUM menerima apa pun",
    (await notifikasiSaya(sLab)).length === 0);

  // 3. Dokter -> Petugas Lab
  await kirimNotifikasi({ roleCode: "petugas_lab", siteId: pst }, {
    jenis: "order_lab", judul: "CITO — Pasien Uji",
    pesan: "PST/L/202608/00001 · 1 panel", siteId: pst,
  });
  const dLab = await notifikasiSaya(sLab);
  ok("3. order lab -> petugas lab menerima",
    dLab.some((n) => n.jenis === "order_lab"));
  ok("   prioritas cito terbaca di judul, bukan hanya warna",
    dLab.some((n) => n.judul.startsWith("CITO")),
    "order mendesak yang hanya ditandai warna akan terlewat");

  // 4. Petugas Lab -> Dokter
  await kirimNotifikasi({ userId: sDokter.id }, {
    jenis: "hasil_lab_kritis", judul: "NILAI KRITIS (1) — Pasien Uji", siteId: pst,
  });
  ok("4. hasil lab -> dokter menerima",
    (await notifikasiSaya(sDokter)).some((n) => n.jenis === "hasil_lab_kritis"));

  // 5. Dokter -> Farmasi
  await kirimNotifikasi({ roleCode: "farmasi", siteId: pst }, {
    jenis: "resep_masuk", judul: "Resep baru — Pasien Uji", siteId: pst,
  });
  ok("5. resep -> farmasi menerima",
    (await notifikasiSaya(sFarmasi)).some((n) => n.jenis === "resep_masuk"));

  // 6. Farmasi -> Kasir
  await kirimNotifikasi({ roleCode: "kasir", siteId: pst }, {
    jenis: "obat_siap", judul: "Siap dibayar — Pasien Uji", siteId: pst,
  });
  ok("6. obat diserahkan -> kasir menerima",
    (await notifikasiSaya(sKasir)).some((n) => n.jenis === "obat_siap"));

  ok("kasir tidak ikut menerima notifikasi klinis",
    (await notifikasiSaya(sKasir)).every((n) => n.jenis === "obat_siap"),
    "diagnosa disembunyikan dari layar kasir — notifikasi tidak boleh membocorkannya");

  void poli;
}

// =====================================================================
console.log("\n== Regresi: notifikasi gagal tidak boleh membatalkan pekerjaan klinis ==");
// =====================================================================
/*
 * Pernah terjadi: judul notifikasi memuat nama pasien, dan `patients.nama`
 * menampung 150 karakter — sama dengan `notifications.judul`. Begitu diberi
 * awalan "A001 — ", nama panjang membuat judulnya meluap, dan dengan
 * sql_mode ketat MySQL menolaknya dengan ER_DATA_TOO_LONG. Karena galat itu
 * dilempar ulang dari dalam transaksi, PENDAFTARAN PASIENNYA ikut batal.
 *
 * Catatan untuk yang mengubah uji ini: nama uji tidak boleh berakhir spasi.
 * MySQL memotong spasi ekor tanpa galat, sehingga luapannya tersembunyi dan
 * uji ini lolos padahal bug-nya masih ada.
 */
await execute(`DELETE FROM notifications`);
await execute(`DELETE FROM item_categories WHERE nama = 'REGRESI-NOTIF'`);

const namaPanjang = "Muhammad Abdurrahman ".repeat(8).slice(0, 150).trimEnd() + "z";
ok("nama uji tidak berakhir spasi", !/\s$/.test(namaPanjang));

let klinisSelamat = true;
try {
  await transaction(async (conn) => {
    await conn.execute(
      `INSERT INTO item_categories (nama, tipe) VALUES ('REGRESI-NOTIF','obat')`,
    );
    await kirimNotifikasi(
      { roleCode: "perawat", siteId: pst },
      { jenis: "pasien_baru", judul: `A001 — ${namaPanjang}`, siteId: pst },
      conn,
    );
  });
} catch {
  klinisSelamat = false;
}

const adaKlinis = await queryOne<RowDataPacket & { n: number }>(
  `SELECT COUNT(*) n FROM item_categories WHERE nama = 'REGRESI-NOTIF'`,
);
ok("pekerjaan klinis tetap tersimpan meski judul notifikasi meluap",
  klinisSelamat && Number(adaKlinis?.n) === 1,
  "pendaftaran pasien tidak boleh batal gara-gara notifikasi");

const dipangkas = await queryOne<RowDataPacket & { L: number; judul: string }>(
  `SELECT CHAR_LENGTH(judul) L, judul FROM notifications ORDER BY id DESC LIMIT 1`,
);
ok("judul dipangkas ke batas kolom", Number(dipangkas?.L) === 150, `${dipangkas?.L} karakter`);
ok("pemangkasan ditandai elipsis", dipangkas?.judul.endsWith("…") === true);

await execute(`DELETE FROM item_categories WHERE nama = 'REGRESI-NOTIF'`);
await execute(`DELETE FROM notifications`);

// =====================================================================
console.log("\n== Regresi: notifikasi lintas cabang (dokter multi-cabang) ==");
// =====================================================================
/*
 * Kejadian nyata: `dr.bayu` ditugaskan di Pusat, Cimahi, dan Sumedang. Ia
 * masuk dengan cabang aktif Pusat (cabang induknya), lalu menekan notifikasi
 * "pasien siap diperiksa" yang datang dari SUMEDANG — dan mendapat 404.
 *
 * Penyebabnya bukan tautannya melainkan cabang aktifnya: setiap layar detail
 * menyaring `WHERE site_id = <cabang aktif>`. Dua hal yang harus benar:
 *
 *   1. notifikasi PERORANGAN tidak boleh disaring per cabang aktif, kalau
 *      tidak ia menghilang dan pasien menunggu tanpa ada yang tahu;
 *   2. notifikasi harus membawa `site_id`-nya supaya membukanya bisa
 *      sekalian berpindah cabang.
 */
await execute(`DELETE FROM notifications`);

const smd = await idSite("SMD");
const bayuId = await idUser("dr.bayu");
const sBayuDiPusat = sesi(bayuId, "dokter", pst);   // cabang aktif: Pusat
sBayuDiPusat.siteIds = [pst, cmh, smd];             // ditugaskan di tiga cabang

await kirimNotifikasi(
  { userId: bayuId },
  { jenis: "triase_selesai", judul: "A001 — Pasien Sumedang", siteId: smd },
);

const dBayu = await notifikasiSaya(sBayuDiPusat);
ok("notifikasi dari cabang lain TETAP terlihat", dBayu.length === 1,
  "kalau disaring per cabang aktif, pasien menunggu tanpa ada yang tahu");
ok("notifikasi membawa cabang asalnya",
  Number(dBayu[0]?.site_id) === smd && Boolean(dBayu[0]?.site_nama),
  `${dBayu[0]?.site_nama ?? "—"}`);
ok("cabang asal berbeda dengan cabang aktif — layak ditandai di UI",
  Number(dBayu[0]?.site_id) !== sBayuDiPusat.siteId);
ok("dokter memang berhak ke cabang itu", bolehKeCabang(sBayuDiPusat, smd));

// Dokter yang TIDAK ditugaskan di sana tidak boleh ikut berpindah.
const sRafi = sesi(await idUser("dr.rafi"), "dokter", pst);
ok("dokter tanpa penugasan ditolak berpindah", !bolehKeCabang(sRafi, smd),
  "id cabang dari klien tidak pernah dipercaya begitu saja");

// Siaran ke peran TETAP terkurung per cabang — itu antrean kerja bersama.
await kirimNotifikasi(
  { roleCode: "farmasi", siteId: smd },
  { jenis: "resep_masuk", judul: "Resep Sumedang", siteId: smd },
);
ok("siaran peran tetap tidak menyeberang cabang",
  (await notifikasiSaya(sFarmasi)).length === 0,
  "farmasi Pusat tidak ikut menerima antrean kerja Sumedang");

await execute(`DELETE FROM notifications`);

// Setiap jenis harus punya label & ikon; kalau tidak, notifikasi tampil
// dengan nama mentah seperti "triase_selesai" di layar petugas.
console.log("\n== Label untuk setiap jenis ==");
for (const j of [
  "pasien_baru", "triase_selesai", "order_lab", "hasil_lab", "hasil_lab_kritis",
  "resep_masuk", "obat_siap", "stok_menipis", "stok_habis", "kadaluarsa",
  "cuti_diajukan", "cuti_diputuskan", "tanpa_pengganti",
]) {
  ok(`"${j}" punya label`, GAYA_NOTIFIKASI[j] !== undefined, GAYA_NOTIFIKASI[j]?.label);
}

await execute(`DELETE FROM notifications`);
console.log(`\n${gagal === 0 ? "SEMUA LULUS" : `${gagal} GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
