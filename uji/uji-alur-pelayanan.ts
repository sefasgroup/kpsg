/**
 * Uji ALUR PELAYANAN — penjaga antar-tahap dokter, farmasi, kasir, lab, HR.
 *
 *   node uji/jalankan.mjs uji-alur-pelayanan.ts
 *
 * Setiap bagian mengunci satu bug yang pernah lolos:
 *
 *   1. Order lab MENYUSUL + resep → setelah validasi farmasi pasien sampai di
 *      kasir. Dulu tertahan di farmasi sampai hasil (mis. kultur 5 hari) keluar.
 *   2. Farmasi tidak bisa mengambil resep sebelum dokter menekan Finalkan
 *      Asesmen — tombol kirim ke farmasi adalah Finalkan (§3.1). Notifikasi
 *      "resep masuk" juga baru terkirim saat itu.
 *   3. Resep tidak bisa ditulis setelah kunjungan lewat tahap dokter (dulu
 *      obat bisa masuk ke tagihan lunas dan diserahkan tanpa dibayar).
 *   4. Hasil/pembatalan lab APS tidak melompatkan pasien melewati perawat.
 *   5. Finalisasi ulang dengan resep yang sudah divalidasi → langsung kasir,
 *      bukan terjebak di farmasi.
 *   6. Cuti dokter yang sudah disetujui tetap bisa diberi dokter pengganti.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne, transaction } from "../src/lib/db";
import { tambahStok } from "../src/lib/stock";
import { resepMasuk, terimaResep, validasiResep } from "../src/lib/pharmacy";
import { simpanResep } from "../src/lib/prescription";
import { batalkanOrderLab, buatOrderLab, simpanHasilLab } from "../src/lib/lab";
import { simpanAsesmen } from "../src/lib/doctor";
import { daftarkanKunjungan } from "../src/lib/visits";
import {
  ajukanCuti, dokterBertugas, putuskanCuti, tambahJadwal, tambahPengecualian,
} from "../src/lib/hr";
import { asesmenSchema, resepSchema } from "../src/lib/validations/doctor";
import { hasilLabSchema, orderLabSchema } from "../src/lib/validations/lab";
import { visitSchema } from "../src/lib/validations/patient";
import { cutiSchema, jadwalSchema, pengecualianSchema } from "../src/lib/validations/hr";
import { tanggalHariIni } from "../src/lib/tanggal";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};
const ditolak = async (f: () => Promise<unknown>) => {
  try {
    await f();
    return "";
  } catch (e) {
    return (e as Error).message || "galat";
  }
};

const TANDA = "UJIPLY";

// =====================================================================
// Persiapan
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
    await execute(`DELETE FROM queues WHERE site_id IN (${s})`);
    await execute(`DELETE FROM lab_results WHERE order_id IN (SELECT id FROM lab_orders WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM lab_order_panels WHERE order_id IN (SELECT id FROM lab_orders WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM lab_orders WHERE site_id IN (${s})`);
    await execute(`DELETE FROM assessment_procedures WHERE assessment_id IN (SELECT id FROM medical_assessments WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM assessment_diagnoses WHERE assessment_id IN (SELECT id FROM medical_assessments WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM medical_assessments WHERE site_id IN (${s})`);
    await execute(`DELETE FROM visits WHERE site_id IN (${s})`);
    await execute(`DELETE FROM patients WHERE site_id IN (${s})`);
    await execute(`DELETE FROM stock_movements WHERE site_id IN (${s})`);
    await execute(`DELETE FROM item_batches WHERE site_id IN (${s})`);
    await execute(`DELETE FROM item_stocks WHERE site_id IN (${s})`);
    await execute(`DELETE FROM schedule_exceptions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM leave_requests WHERE site_id IN (${s})`);
    await execute(`DELETE FROM doctor_schedules WHERE site_id IN (${s})`);
    await execute(`DELETE FROM polis WHERE site_id IN (${s})`);
    await execute(`DELETE FROM sequences WHERE site_id IN (${s})`);
  }
  await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
  if (sites.length) await execute(`DELETE FROM sites WHERE id IN (${sites.join(",")})`);
  if (items.length) {
    const l = items.join(",");
    await execute(`DELETE FROM stock_movements WHERE item_id IN (${l})`);
    await execute(`DELETE FROM item_stocks WHERE item_id IN (${l})`);
    await execute(`DELETE FROM items WHERE id IN (${l})`);
  }
  await execute(`DELETE FROM lab_results WHERE parameter_id IN (SELECT id FROM lab_parameters WHERE kode LIKE '${TANDA}%')`);
  await execute(`DELETE FROM lab_parameters WHERE panel_id IN (SELECT id FROM lab_panels WHERE kode LIKE '${TANDA}%')`);
  await execute(`DELETE FROM lab_panels WHERE kode LIKE '${TANDA}%'`);
}
await bersih();

const site = (await execute(
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}', 'Uji Alur Pelayanan')`,
)).insertId;
const roleId = async (c: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM roles WHERE code = ?`, [c]))!.id);
const buatUser = async (u: string, n: string, c: string) =>
  (await execute(
    `INSERT INTO users (site_id, role_id, nama, username, password_hash) VALUES (?,?,?,?,'x')`,
    [site, await roleId(c), n, u],
  )).insertId;

const dokter = await buatUser(`${TANDA}.dokter`, "dr. Uji Pelayanan", "dokter");
const dokter2 = await buatUser(`${TANDA}.dokter2`, "dr. Pengganti Uji", "dokter");
const apoteker = await buatUser(`${TANDA}.apt`, "apt. Uji", "farmasi");
const analis = await buatUser(`${TANDA}.lab`, "Analis Uji", "petugas_lab");
const admin = await buatUser(`${TANDA}.admin`, "Admin Uji", "admin_cabang");

const poli = (await execute(
  `INSERT INTO polis (site_id, kode, nama, prefix_antrean) VALUES (?, '${TANDA}-P', 'Poli Uji', 'U')`,
  [site],
)).insertId;
const item = (await execute(
  `INSERT INTO items (kode, nama, tipe, satuan_dasar, hpp, harga_jual)
   VALUES ('${TANDA}-OBAT', 'Obat Uji Pelayanan', 'obat', 'tablet', 1000, 2000)`,
)).insertId;
await transaction((conn) =>
  tambahStok(conn, {
    siteId: site, itemId: item, qty: 100, jenis: "masuk_pembelian",
    refType: "purchase", userId: apoteker,
  }),
);
const panel = (await execute(
  `INSERT INTO lab_panels (kode, nama, kategori, tarif) VALUES ('${TANDA}-P1', 'Panel Uji', 'Uji', 40000)`,
)).insertId;
const parameterId = (await execute(
  `INSERT INTO lab_parameters (panel_id, kode, nama, tipe_nilai, urutan)
   VALUES (?, '${TANDA}-PAR', 'Parameter Uji', 'numerik', 1)`,
  [panel],
)).insertId;
const icd = (await queryOne<RowDataPacket & { code: string }>(
  `SELECT code FROM icd10_codes WHERE is_active = 1 LIMIT 1`,
))!.code;

let n = 0;
async function kunjungan(status?: string) {
  n++;
  const pasien = (await execute(
    `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin)
     VALUES (?,?,?,?, '1990-01-01', 'L')`,
    [site, `${TANDA}-${n}`, `327300000022${1000 + n}`, `Pasien Pelayanan ${n}`],
  )).insertId;
  const v = (await daftarkanKunjungan(
    visitSchema.parse({ patient_id: pasien, poli_id: poli, doctor_id: dokter, cara_bayar: "umum" }),
    site, admin,
  )).id;
  if (status) await execute(`UPDATE visits SET status = ? WHERE id = ?`, [status, v]);
  return v;
}
const statusVisit = async (id: number) =>
  String((await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM visits WHERE id = ?`, [id]))!.status);
const statusTagihan = async (id: number) =>
  String((await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM billing_transactions WHERE visit_id = ?`, [id]))?.status ?? "-");
const resep = () =>
  resepSchema.parse({
    items: [{
      item_id: item, nama: "Obat Uji Pelayanan", qty: 3, satuan: "tablet",
      aturan_pakai: "3 x sehari 1 tablet", harga_satuan: 2000,
    }],
    racikans: [],
  });
const finalkan = (v: number) =>
  simpanAsesmen(v, site, dokter, asesmenSchema.parse({
    finalkan: true, jenis_anamnesis: "auto", keluhan_utama: "Uji alur pelayanan",
    status_lokalis: { regio: {}, titik: [] },
    diagnoses: [{ icd10_code: icd, nama: "Diagnosa uji", tipe: "primer" }],
    procedures: [],
  }));
const orderLab = async (v: number, sifat: "ditunggu" | "menyusul", aps = false) =>
  (await buatOrderLab(
    v, site, aps ? analis : dokter,
    orderLabSchema.parse({
      prioritas: "rutin", sifat_hasil: sifat,
      panels: [{ panel_id: panel, nama: "Panel Uji", tarif: 40000 }],
    }),
    aps,
  )).orderId;
const notifResep = async (rxId: number) =>
  Number((await queryOne<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) n FROM notifications WHERE jenis = 'resep_masuk' AND link = ?`,
    [`/farmasi/${rxId}`]))!.n);

// =====================================================================
// 1. Lab MENYUSUL + resep → pasien sampai di kasir
// =====================================================================
console.log("\n== 1. Lab menyusul tidak menahan pasien di farmasi ==");
const v1 = await kunjungan("dalam_pemeriksaan");
const rx1 = await simpanResep(v1, site, dokter, resep());
await orderLab(v1, "menyusul");
await finalkan(v1);
ok("setelah finalisasi → menunggu_farmasi", (await statusVisit(v1)) === "menunggu_farmasi", await statusVisit(v1));
await terimaResep(rx1.prescriptionId, site, apoteker);
await validasiResep(rx1.prescriptionId, site, apoteker);
ok("setelah validasi → menunggu_kasir (walau kultur belum keluar)",
  (await statusVisit(v1)) === "menunggu_kasir", await statusVisit(v1));
ok("tagihan naik ke menunggu", (await statusTagihan(v1)) === "menunggu", await statusTagihan(v1));

// =====================================================================
// 2. Farmasi menunggu Finalkan Asesmen
// =====================================================================
console.log("\n== 2. Farmasi hanya menerima resep yang sudah difinalkan ==");
const v2 = await kunjungan("dalam_pemeriksaan");
const rx2 = await simpanResep(v2, site, dokter, resep());
ok("draft resep TIDAK tampil di Resep Masuk",
  !(await resepMasuk(site)).some((r) => r.id === rx2.prescriptionId));
ok("draft resep TIDAK mengirim notifikasi ke farmasi", (await notifResep(rx2.prescriptionId)) === 0);
const tolakTerima = await ditolak(() => terimaResep(rx2.prescriptionId, site, apoteker));
ok("farmasi DITOLAK menerima draft resep", tolakTerima !== "", tolakTerima);
await finalkan(v2);
ok("setelah Finalkan → tampil di Resep Masuk",
  (await resepMasuk(site)).some((r) => r.id === rx2.prescriptionId));
ok("setelah Finalkan → notifikasi farmasi terkirim sekali", (await notifResep(rx2.prescriptionId)) === 1);
ok("farmasi kini bisa menerima",
  (await ditolak(() => terimaResep(rx2.prescriptionId, site, apoteker))) === "");

// Hasil DITUNGGU mengembalikan pasien ke dokter → farmasi harus menunggu lagi.
await execute(`UPDATE visits SET status = 'menunggu_dokter' WHERE id = ?`, [v2]);
const tolakValidasi = await ditolak(() => validasiResep(rx2.prescriptionId, site, apoteker));
ok("validasi ditolak selama pasien kembali di tangan dokter", tolakValidasi !== "", tolakValidasi);

// =====================================================================
// 3. Resep tidak bisa ditulis setelah lewat tahap dokter
// =====================================================================
console.log("\n== 3. Resep terkunci setelah tahap dokter ==");
for (const st of ["menunggu_farmasi", "menunggu_kasir", "menunggu_obat", "selesai"]) {
  const v = await kunjungan(st);
  const t = await ditolak(() => simpanResep(v, site, dokter, resep()));
  ok(`simpanResep ditolak di ${st}`, t !== "", t);
}

// =====================================================================
// 4. Lab APS tidak melompatkan pasien melewati perawat
// =====================================================================
console.log("\n== 4. Lab APS tidak melewati perawat ==");
const v4 = await kunjungan("menunggu_perawat");
const aps4 = await orderLab(v4, "menyusul", true);
await simpanHasilLab(aps4, site, analis, hasilLabSchema.parse({
  finalkan: true, hasil: [{ parameter_id: parameterId, panel_id: panel, nilai: "9" }],
}));
ok("hasil APS final → tetap menunggu_perawat", (await statusVisit(v4)) === "menunggu_perawat", await statusVisit(v4));
const v4b = await kunjungan("menunggu_perawat");
const aps4b = await orderLab(v4b, "menyusul", true);
await batalkanOrderLab(aps4b, site, "Sampel lisis", analis, "Analis Uji");
ok("APS dibatalkan → tetap menunggu_perawat", (await statusVisit(v4b)) === "menunggu_perawat", await statusVisit(v4b));

// =====================================================================
// 5. Finalisasi ulang dengan resep yang sudah divalidasi → kasir
// =====================================================================
console.log("\n== 5. Resep sudah divalidasi tidak menjebak pasien di farmasi ==");
const v5 = await kunjungan("dalam_pemeriksaan");
const rx5 = await simpanResep(v5, site, dokter, resep());
await finalkan(v5);
await terimaResep(rx5.prescriptionId, site, apoteker);
await validasiResep(rx5.prescriptionId, site, apoteker);
// Pasien kembali ke dokter (mis. hasil ditunggu keluar) lalu difinalkan ulang.
await execute(`UPDATE visits SET status = 'menunggu_dokter' WHERE id = ?`, [v5]);
await finalkan(v5);
ok("finalisasi ulang → menunggu_kasir, bukan menunggu_farmasi",
  (await statusVisit(v5)) === "menunggu_kasir", await statusVisit(v5));
ok("tidak ada notifikasi farmasi baru untuk resep yang sudah divalidasi",
  (await notifResep(rx5.prescriptionId)) === 1);

// =====================================================================
// 6. Cuti disetujui → pengganti tetap bisa ditetapkan
// =====================================================================
console.log("\n== 6. Dokter pengganti untuk cuti yang sudah disetujui ==");
for (let hari = 1; hari <= 7; hari++) {
  await tambahJadwal(jadwalSchema.parse({
    doctor_id: dokter, poli_id: poli, hari, jam_mulai: "08:00", jam_selesai: "12:00", kuota: 20,
  }), site, admin);
}
const tgl = (() => {
  const d = new Date(`${tanggalHariIni()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 10);
  return d.toISOString().slice(0, 10);
})();
const cuti = await ajukanCuti(cutiSchema.parse({
  user_id: dokter, jenis: "cuti_tahunan", tanggal_mulai: tgl, tanggal_akhir: tgl, alasan: "Uji",
}), site);
await putuskanCuti(cuti, site, admin, true);
const sebelum = (await dokterBertugas(site, tgl)).find((d) => d.doctor_id === dokter);
ok("setelah cuti disetujui → dokter tercatat kosong tanpa pengganti", sebelum?.kosong === true,
  JSON.stringify(sebelum && { kosong: sebelum.kosong, pengganti: sebelum.substitute_doctor_id }));

const tetapkan = () => tambahPengecualian(pengecualianSchema.parse({
  doctor_id: dokter, tanggal: tgl, jenis: "cuti", substitute_doctor_id: dokter2, alasan: "",
}), site, admin);
const tolakPengganti = await ditolak(tetapkan);
ok("pengganti BISA ditetapkan untuk hari cuti", tolakPengganti === "", tolakPengganti);
const sesudah = (await dokterBertugas(site, tgl)).find((d) => d.doctor_id === dokter);
ok("jadwal hari itu kini dilayani dokter pengganti",
  sesudah?.substitute_doctor_id === dokter2 && sesudah?.kosong === false,
  JSON.stringify(sesudah && { kosong: sesudah.kosong, pengganti: sesudah.substitute_doctor_id }));
ok("hanya ada satu baris pengecualian untuk tanggal itu",
  Number((await queryOne<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) n FROM schedule_exceptions WHERE site_id = ? AND doctor_id = ? AND tanggal = ?`,
    [site, dokter, tgl]))!.n) === 1);
const tolakGanda = await ditolak(tetapkan);
ok("pengganti kedua untuk tanggal yang sama ditolak", tolakGanda !== "", tolakGanda);

// =====================================================================
await bersih();
await pool.end();
console.log(gagal ? `\n${gagal} GAGAL` : "\nSEMUA UJI LULUS");
process.exit(gagal ? 1 : 0);
