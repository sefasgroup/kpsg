/**
 * Uji pengembalian klaim resep (farmasi → dokter).
 *
 *   node uji/jalankan.mjs uji-resep-kembali.ts
 *
 * Operasi ini menyentuh DUA status sekaligus — resep dan kunjungan — dan
 * berbatasan langsung dengan pemotongan stok. Tiga hal yang diuji di sini
 * adalah tiga cara fitur ini bisa merusak sesuatu:
 *
 *   1. Membalikkan resep yang stoknya SUDAH terpotong. Harus ditolak;
 *      kalau lolos, saldo gudang dan tagihan pasien langsung tidak cocok.
 *   2. Tidak meninggalkan jejak di kartu stok. Pengembalian klaim bukan
 *      pergerakan barang, jadi tidak boleh ada satu baris pun tercatat.
 *   3. Mengembalikan resep tetapi membiarkan kunjungan tetap di
 *      `menunggu_farmasi`. Dokter membuka rekam medisnya dan menemukan
 *      semuanya terkunci — pengembalian yang tidak bisa ditindaklanjuti.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne } from "../src/lib/db";
import { tambahStok } from "../src/lib/stock";
import { transaction } from "../src/lib/db";
import {
  batalkanTerimaResep, serahkanResep, terimaResep, validasiResep,
} from "../src/lib/pharmacy";
import { batalkanResep, simpanResep } from "../src/lib/prescription";
import { prosesPembayaran } from "../src/lib/cashier";
import { resepSchema } from "../src/lib/validations/doctor";
import { pembayaranSchema } from "../src/lib/validations/cashier";
import { tanggalHariIni } from "../src/lib/tanggal";

/*
 * Resep hanya bisa ditulis selama kunjungan di tahap dokter (lib/prescription.ts).
 * Uji ini menyiapkan kunjungannya langsung di tahap farmasi/kasir, jadi urutan
 * nyatanya disimulasikan: kembali sebentar ke tahap dokter, tulis resep, lalu
 * kembali ke status semula — seperti dokter menulis resep lalu menekan
 * Finalkan Asesmen.
 */
async function simpanResepUji(...args: Parameters<typeof simpanResep>) {
  const [visitId] = args;
  const lama = (await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM visits WHERE id = ?`, [visitId]))!.status;
  await execute(`UPDATE visits SET status = 'dalam_pemeriksaan' WHERE id = ?`, [visitId]);
  try {
    return await simpanResep(...args);
  } finally {
    await execute(`UPDATE visits SET status = ? WHERE id = ?`, [lama, visitId]);
  }
}


let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

const TANDA = "UJIRSK";
const hariIni = tanggalHariIni();

// =====================================================================
// Persiapan — seluruh prasyarat dibuat sendiri, tidak meminjam data seed.
// =====================================================================
async function bersih() {
  const sites = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM sites WHERE kode LIKE '${TANDA}%'`)
  ).map((r) => r.id);
  const items = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM items WHERE kode LIKE '${TANDA}%'`)
  ).map((r) => r.id);

  if (sites.length) {
    const s = sites.join(",");
    await execute(`DELETE FROM notifications WHERE site_id IN (${s})`);
    await execute(`DELETE FROM billing_items WHERE billing_id IN (SELECT id FROM billing_transactions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM billing_transactions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM prescription_racikans WHERE prescription_id IN (SELECT id FROM prescriptions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM prescription_items WHERE prescription_id IN (SELECT id FROM prescriptions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM prescriptions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM visits WHERE site_id IN (${s})`);
    await execute(`DELETE FROM patients WHERE site_id IN (${s})`);
    await execute(`DELETE FROM stock_movements WHERE site_id IN (${s})`);
    await execute(`DELETE FROM item_batches WHERE site_id IN (${s})`);
    await execute(`DELETE FROM item_stocks WHERE site_id IN (${s})`);
    await execute(`DELETE FROM polis WHERE site_id IN (${s})`);
    await execute(`DELETE FROM sequences WHERE site_id IN (${s})`);
    await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
    await execute(`DELETE FROM sites WHERE id IN (${s})`);
  } else {
    await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
  }
  if (items.length) {
    const l = items.join(",");
    await execute(`DELETE FROM stock_movements WHERE item_id IN (${l})`);
    await execute(`DELETE FROM item_stocks WHERE item_id IN (${l})`);
    await execute(`DELETE FROM items WHERE id IN (${l})`);
  }
}
await bersih();

const site = (await execute(
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}', 'Uji Resep Kembali')`,
)).insertId;

const roleId = async (code: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM roles WHERE code = ?`, [code]))!.id);

const buatUser = async (username: string, nama: string, code: string) =>
  (await execute(
    `INSERT INTO users (site_id, role_id, nama, username, password_hash) VALUES (?,?,?,?,'x')`,
    [site, await roleId(code), nama, username],
  )).insertId;

const dokter = await buatUser(`${TANDA}.dokter`, "dr. Uji Kembali", "dokter");
const apoteker = await buatUser(`${TANDA}.apt`, "apt. Uji Kembali", "farmasi");

const poli = (await execute(
  `INSERT INTO polis (site_id, kode, nama) VALUES (?, '${TANDA}-PU', 'Poli Uji')`, [site],
)).insertId;

const pasien = (await execute(
  `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin)
   VALUES (?, '${TANDA}-001', '3273${Date.now().toString().slice(-12)}', 'Pasien Uji Kembali', '1990-01-01', 'L')`,
  [site],
)).insertId;

const item = (await execute(
  `INSERT INTO items (kode, nama, tipe, satuan_dasar, hpp, harga_jual)
   VALUES ('${TANDA}-OBAT', 'Obat Uji Kembali', 'obat', 'tablet', 1000, 2000)`,
)).insertId;

await transaction((conn) =>
  tambahStok(conn, {
    siteId: site, itemId: item, qty: 100, jenis: "masuk_pembelian",
    refType: "purchase", userId: apoteker,
  }),
);

const buatVisit = async (no: string) =>
  (await execute(
    `INSERT INTO visits (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
                         jenis_kunjungan, status, registered_by)
     VALUES (?,?,?,?,?,?, 'baru', 'menunggu_farmasi', ?)`,
    [site, pasien, no, hariIni, poli, dokter, dokter],
  )).insertId;

const resepBaru = (qty: number) =>
  resepSchema.parse({
    items: [{
      item_id: item, nama: "Obat Uji Kembali", qty,
      satuan: "tablet", aturan_pakai: "3 x sehari 1 tablet", harga_satuan: 2000,
    }],
    racikans: [],
  });

const statusResep = async (id: number) =>
  await queryOne<RowDataPacket & {
    status: string; received_by: number | null; received_at: string | null;
  }>(`SELECT status, received_by, received_at FROM prescriptions WHERE id = ?`, [id]);

const statusVisit = async (id: number) =>
  String((await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM visits WHERE id = ?`, [id]))!.status);

const saldo = async () =>
  Number((await queryOne<RowDataPacket & { q: string }>(
    `SELECT qty_on_hand q FROM item_stocks WHERE item_id = ? AND site_id = ?`,
    [item, site]))?.q ?? 0);

const jumlahPergerakan = async () =>
  Number((await queryOne<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) n FROM stock_movements WHERE item_id = ? AND site_id = ?`,
    [item, site]))!.n);

// =====================================================================
// 1. Alur normal: klaim → kembalikan
// =====================================================================
console.log("\n== 1. Klaim lalu dikembalikan ==");

const v1 = await buatVisit(`${TANDA}/V/1`);
const rx1 = await simpanResepUji(v1, site, dokter, resepBaru(10));

await terimaResep(rx1.prescriptionId, site, apoteker);
const sesudahKlaim = await statusResep(rx1.prescriptionId);
ok("resep berstatus diterima_farmasi setelah diklaim",
  sesudahKlaim?.status === "diterima_farmasi", String(sesudahKlaim?.status));

const gerakSebelum = await jumlahPergerakan();
const saldoSebelum = await saldo();

const hasil = await batalkanTerimaResep(
  rx1.prescriptionId, site, "apt. Uji Kembali", "Dosis terlalu besar untuk usia pasien",
);

const sesudahKembali = await statusResep(rx1.prescriptionId);
ok("status kembali ke 'baru'", sesudahKembali?.status === "baru", String(sesudahKembali?.status));
ok("received_by dikosongkan", sesudahKembali?.received_by === null, String(sesudahKembali?.received_by));
ok("received_at dikosongkan", sesudahKembali?.received_at === null, String(sesudahKembali?.received_at));
ok("nomor resep TIDAK berubah", hasil.noResep === rx1.noResep, hasil.noResep);

ok("status kunjungan kembali ke dalam_pemeriksaan",
  (await statusVisit(v1)) === "dalam_pemeriksaan", await statusVisit(v1));

/*
 * Inti keamanannya: klaim tidak pernah menyentuh gudang, jadi membatalkannya
 * juga tidak boleh. Satu baris kartu stok saja sudah berarti saldo bergerak
 * tanpa barang yang benar-benar keluar atau masuk.
 */
ok("saldo stok tidak berubah", (await saldo()) === saldoSebelum, `${await saldo()}`);
ok("tidak ada baris kartu stok baru",
  (await jumlahPergerakan()) === gerakSebelum,
  `${await jumlahPergerakan()} baris (sebelumnya ${gerakSebelum})`);

// =====================================================================
// 2. Dokter benar-benar bisa merevisi sesudahnya
// =====================================================================
console.log("\n== 2. Dokter bisa merevisi sesudah dikembalikan ==");

let revisiGagal = "";
try {
  await simpanResepUji(v1, site, dokter, resepBaru(5));
} catch (e) {
  revisiGagal = (e as Error).message;
}
ok("dokter bisa menyimpan resep revisi", revisiGagal === "", revisiGagal);

const qtyRevisi = await queryOne<RowDataPacket & { qty: string }>(
  `SELECT qty FROM prescription_items WHERE prescription_id = ?`, [rx1.prescriptionId],
);
ok("qty resep benar-benar berubah", Number(qtyRevisi?.qty) === 5, String(qtyRevisi?.qty));

ok(
  "resep tetap berada di antrean farmasi selama direvisi",
  (await statusResep(rx1.prescriptionId))?.status === "baru",
  "status 'baru' termasuk dalam daftar resepMasuk()",
);

// =====================================================================
// 3. Notifikasi ke dokter yang menangani
// =====================================================================
console.log("\n== 3. Notifikasi ke dokter ==");

const notif = await queryOne<RowDataPacket & {
  user_id: number; jenis: string; pesan: string; link: string;
}>(
  `SELECT user_id, jenis, pesan, link FROM notifications
    WHERE site_id = ? AND jenis = 'resep_dikembalikan' ORDER BY id DESC LIMIT 1`,
  [site],
);
ok("notifikasi terkirim", notif !== null);
ok("ditujukan ke dokter yang menangani", Number(notif?.user_id) === dokter, String(notif?.user_id));
ok("memuat alasan pengembalian",
  String(notif?.pesan).includes("Dosis terlalu besar"), String(notif?.pesan));
ok("memuat nama petugas yang mengembalikan",
  String(notif?.pesan).includes("apt. Uji Kembali"), String(notif?.pesan));
ok("menautkan langsung ke rekam medisnya",
  notif?.link === `/rme/${v1}`, String(notif?.link));

// =====================================================================
// 4. Penolakan — batas-batas yang menjaga stok & tagihan
// =====================================================================
console.log("\n== 4. Yang harus DITOLAK ==");

let tolakBaru = "";
try {
  await batalkanTerimaResep(rx1.prescriptionId, site, "apt", "Alasan yang cukup panjang");
} catch (e) {
  tolakBaru = (e as Error).message;
}
ok("resep yang belum diklaim ditolak", tolakBaru !== "", tolakBaru);

/*
 * --- Resep yang sudah diserahkan: stok sudah keluar ---
 *
 * Sejak alur bayar-dulu, penyerahan menempuh tiga langkah: klaim → validasi
 * (kunci stok & harga) → bayar → serahkan. Uji ini melewati semuanya karena
 * yang ingin dibuktikan adalah keadaan SESUDAH obat benar-benar keluar.
 */
const v2 = await buatVisit(`${TANDA}/V/2`);
const rx2 = await simpanResepUji(v2, site, dokter, resepBaru(3));
await terimaResep(rx2.prescriptionId, site, apoteker);
await validasiResep(rx2.prescriptionId, site, apoteker);

const tagihanV2 = await queryOne<RowDataPacket & { id: number }>(
  `SELECT id FROM billing_transactions WHERE visit_id = ?`, [v2],
);
await prosesPembayaran(
  Number(tagihanV2!.id), site, apoteker, null,
  pembayaranSchema.parse({ payment_method: "tunai", dibayar: 999999, diskon: 0 }),
  0,
);
await serahkanResep(rx2.prescriptionId, site, apoteker);

const saldoSesudahSerah = await saldo();
const gerakSesudahSerah = await jumlahPergerakan();

let tolakSerah = "";
try {
  await batalkanTerimaResep(rx2.prescriptionId, site, "apt", "Ternyata obatnya keliru");
} catch (e) {
  tolakSerah = (e as Error).message;
}
ok("resep yang SUDAH diserahkan ditolak", tolakSerah !== "", tolakSerah);
ok("penolakan menyebut stok & tagihan sebagai alasannya",
  /stok|tagihan/i.test(tolakSerah), tolakSerah);
ok("status tetap 'diserahkan' setelah ditolak",
  (await statusResep(rx2.prescriptionId))?.status === "diserahkan");
ok("saldo stok tidak ikut terbalik oleh percobaan itu",
  (await saldo()) === saldoSesudahSerah, `${await saldo()}`);
ok("tidak ada kartu stok tambahan dari percobaan itu",
  (await jumlahPergerakan()) === gerakSesudahSerah);

// --- Cabang lain tidak boleh menyentuhnya ---
const siteLain = (await execute(
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}-B', 'Cabang Lain')`,
)).insertId;
const v3 = await buatVisit(`${TANDA}/V/3`);
const rx3 = await simpanResepUji(v3, site, dokter, resepBaru(2));
await terimaResep(rx3.prescriptionId, site, apoteker);

let tolakCabang = "";
try {
  await batalkanTerimaResep(rx3.prescriptionId, siteLain, "apt", "Coba dari cabang lain");
} catch (e) {
  tolakCabang = (e as Error).message;
}
ok("resep cabang lain tidak bisa dikembalikan", tolakCabang !== "", tolakCabang);
ok("resepnya tetap utuh diklaim",
  (await statusResep(rx3.prescriptionId))?.status === "diterima_farmasi");
await execute(`DELETE FROM sites WHERE id = ?`, [siteLain]);

// =====================================================================
// 5. Kunjungan yang masih tertahan di lab
// =====================================================================
console.log("\n== 5. Kunjungan yang masih menunggu lab ==");

/*
 * Bila pasien masih menunggu hasil lab, statusnya TIDAK boleh dipaksa ke
 * `dalam_pemeriksaan` — itu akan mengeluarkannya dari antrean lab yang
 * belum selesai.
 */
const v4 = await buatVisit(`${TANDA}/V/4`);
const rx4 = await simpanResepUji(v4, site, dokter, resepBaru(1));
// Farmasi hanya menerima resep di tahap farmasi; kunjungannya baru pindah
// ke lab SESUDAHNYA (mis. order diubah menjadi "ditunggu").
await terimaResep(rx4.prescriptionId, site, apoteker);
await execute(`UPDATE visits SET status = 'menunggu_lab' WHERE id = ?`, [v4]);
await batalkanTerimaResep(rx4.prescriptionId, site, "apt", "Perlu revisi dosis dulu");

ok("resep tetap dikembalikan", (await statusResep(rx4.prescriptionId))?.status === "baru");
ok("status kunjungan dibiarkan di menunggu_lab",
  (await statusVisit(v4)) === "menunggu_lab", await statusVisit(v4));

// =====================================================================
// 6. Resep yang dibatalkan bisa diterbitkan ulang
// =====================================================================
console.log("\n== 6. Terbitkan resep baru setelah pembatalan ==");

/*
 * Pesan galat yang dilihat dokter saat mencoba mengubah resep yang sudah
 * diterima farmasi berbunyi persis: "Batalkan resep lalu terbitkan resep
 * baru." Selama `uq_rx_visit` mengunci satu BARIS per kunjungan tanpa
 * memandang status, mengikuti petunjuk itu berakhir di
 *
 *     Duplicate entry '<visit_id>' for key 'prescriptions.uq_rx_visit'
 *
 * Aturan yang benar adalah satu resep BERJALAN per kunjungan; yang sudah
 * dibatalkan tetap tersimpan sebagai riwayat dan tidak boleh menghalangi.
 */
const v5 = await buatVisit(`${TANDA}/V/5`);
const rx5a = await simpanResepUji(v5, site, dokter, resepBaru(2));
await batalkanResep(v5, site, "Salah dosis");

ok("resep lama tersimpan sebagai riwayat, bukan terhapus",
  (await statusResep(rx5a.prescriptionId))?.status === "batal");

let rx5b: { prescriptionId: number; noResep: string } | null = null;
let galatTerbit = "";
try {
  rx5b = await simpanResepUji(v5, site, dokter, resepBaru(3));
} catch (e) {
  galatTerbit = e instanceof Error ? e.message : String(e);
}

ok("resep baru bisa diterbitkan", rx5b !== null, galatTerbit);
ok("nomor resepnya berbeda dari yang dibatalkan",
  rx5b !== null && rx5b.noResep !== rx5a.noResep,
  `${rx5a.noResep} → ${rx5b?.noResep}`);

const semuaResep = await query<RowDataPacket & { id: number; status: string }>(
  `SELECT id, status FROM prescriptions WHERE visit_id = ? ORDER BY id`, [v5],
);
ok("kedua baris berdampingan di satu kunjungan", semuaResep.length === 2,
  semuaResep.map((r) => r.status).join(" + "));
ok("hanya satu yang berjalan",
  semuaResep.filter((r) => r.status !== "batal").length === 1);

// Aturan lamanya tetap berlaku: dua resep hidup sekaligus harus mustahil.
let duaHidup = "";
try {
  await execute(
    `INSERT INTO prescriptions (site_id, visit_id, no_resep, doctor_id, status)
     VALUES (?,?,?,?, 'baru')`,
    [site, v5, `${TANDA}/R/PAKSA`, dokter],
  );
} catch (e) {
  duaHidup = e instanceof Error ? e.message : String(e);
}
ok("dua resep berjalan sekaligus tetap ditolak database",
  /Duplicate entry/i.test(duaHidup), duaHidup || "TIDAK DITOLAK");

// =====================================================================
await bersih();
console.log(`\n${gagal === 0 ? "SEMUA UJI LULUS" : `${gagal} UJI GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
