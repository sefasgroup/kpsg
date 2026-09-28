/**
 * Uji MUTU DATA — stok, riwayat pasien, IKP, dan LB1.
 *
 *   node uji/jalankan.mjs uji-mutu-data.ts
 *
 * Setiap bagian mengunci satu bug yang pernah lolos:
 *
 *   1. Stock opname tidak menghitung dua kali pergerakan yang terjadi
 *      SEBELUM rak dihitung, dan tetap mempertahankan pergerakan SESUDAHNYA.
 *   2. Pengeluaran rusak mengambil batch yang masih berlaku, bukan batch
 *      kadaluarsa (yang membuat stok "tersedia" pasien terlalu besar).
 *   3. Riwayat pasien menampilkan SOAP terstruktur, bukan kosong.
 *   4. Daftar IKP untuk peran selain admin hanya memuat laporan sendiri.
 *   5. LB1: kasus baru = diagnosa pertama kali untuk pasien itu, bukan
 *      kunjungan pertama ke klinik; kelompok umur dihitung pada tanggal
 *      kunjungan.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne, transaction } from "../src/lib/db";
import { kurangiStok, tambahStok } from "../src/lib/stock";
import { buatOpname, catatPengeluaran, finalkanOpname, simpanHitungan } from "../src/lib/inventory";
import { riwayatKunjungan } from "../src/lib/riwayat";
import { daftarIkp, laporkanIkp } from "../src/lib/kepatuhan";
import { lb1Morbiditas } from "../src/lib/laporan";
import { pengeluaranSchema } from "../src/lib/validations/inventory";
import { ikpSchema } from "../src/lib/validations/kepatuhan";
import { tanggalHariIni, tambahHari } from "../src/lib/tanggal";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

const TANDA = "UJIMUTU";
const hariIni = tanggalHariIni();

async function bersih() {
  const sites = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM sites WHERE kode LIKE '${TANDA}%'`)
  ).map((r) => r.id);
  const items = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM items WHERE kode LIKE '${TANDA}%'`)
  ).map((r) => r.id);
  if (sites.length) {
    const s = sites.join(",");
    await execute(`DELETE FROM patient_safety_incidents WHERE site_id IN (${s})`);
    await execute(`DELETE FROM notifications WHERE site_id IN (${s})`);
    await execute(`DELETE FROM stock_opname_items WHERE opname_id IN (SELECT id FROM stock_opnames WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM stock_opnames WHERE site_id IN (${s})`);
    await execute(`DELETE FROM assessment_diagnoses WHERE assessment_id IN (SELECT id FROM medical_assessments WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM medical_assessments WHERE site_id IN (${s})`);
    await execute(`DELETE FROM visits WHERE site_id IN (${s})`);
    await execute(`DELETE FROM patients WHERE site_id IN (${s})`);
    await execute(`DELETE FROM stock_movements WHERE site_id IN (${s})`);
    await execute(`DELETE FROM item_batches WHERE site_id IN (${s})`);
    await execute(`DELETE FROM item_stocks WHERE site_id IN (${s})`);
    await execute(`DELETE FROM polis WHERE site_id IN (${s})`);
    await execute(`DELETE FROM sequences WHERE site_id IN (${s})`);
  }
  await execute(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${TANDA}%')`);
  await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
  if (sites.length) await execute(`DELETE FROM sites WHERE id IN (${sites.join(",")})`);
  if (items.length) await execute(`DELETE FROM items WHERE id IN (${items.join(",")})`);
}
await bersih();

const site = (await execute(`INSERT INTO sites (kode, nama) VALUES ('${TANDA}', 'Uji Mutu')`)).insertId;
const roleId = async (c: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(`SELECT id FROM roles WHERE code = ?`, [c]))!.id);
const buatUser = async (u: string, c: string) =>
  (await execute(
    `INSERT INTO users (site_id, role_id, nama, username, password_hash) VALUES (?,?,?,?,'x')`,
    [site, await roleId(c), u, u],
  )).insertId;
const apoteker = await buatUser(`${TANDA}.apt`, "farmasi");
const dokter = await buatUser(`${TANDA}.dok`, "dokter");
const perawat = await buatUser(`${TANDA}.prw`, "perawat");
const kasir = await buatUser(`${TANDA}.kas`, "kasir");
const poli = (await execute(`INSERT INTO polis (site_id, kode, nama) VALUES (?, '${TANDA}-P', 'Poli')`, [site])).insertId;
const saldo = async (item: number) =>
  Number((await queryOne<RowDataPacket & { q: string }>(
    `SELECT qty_on_hand q FROM item_stocks WHERE site_id = ? AND item_id = ?`, [site, item]))?.q ?? 0);

// =====================================================================
// 1. Stock opname
// =====================================================================
console.log("\n== 1. Stock opname tidak menghitung dua kali ==");
const obat = (await execute(
  `INSERT INTO items (kode, nama, tipe, satuan_dasar, hpp, harga_jual) VALUES ('${TANDA}-O', 'Obat Opname', 'obat', 'tablet', 100, 200)`,
)).insertId;
await transaction((c) => tambahStok(c, { siteId: site, itemId: obat, qty: 100, jenis: "masuk_pembelian", refType: "purchase", userId: apoteker }));
const op = await buatOpname({ tanggal: hariIni, tipe: "obat" }, site, apoteker);
// Resep diserahkan SEBELUM rak dihitung → rak berisi 90.
await transaction((c) => kurangiStok(c, { siteId: site, itemId: obat, qty: 10, jenis: "keluar_resep", refType: "uji", userId: apoteker }));
await simpanHitungan({ opname_id: op.id, item_id: obat, qty_fisik: 90 }, site);
// Resep lain diserahkan SESUDAH rak dihitung → pengeluaran sah, tidak boleh hilang.
await transaction((c) => kurangiStok(c, { siteId: site, itemId: obat, qty: 5, jenis: "keluar_resep", refType: "uji", userId: apoteker }));
await finalkanOpname(op.id, site, apoteker);
ok("saldo akhir 85 (90 terhitung − 5 sesudahnya), bukan 75", (await saldo(obat)) === 85, String(await saldo(obat)));

// =====================================================================
// 2. FEFO pengeluaran rusak
// =====================================================================
console.log("\n== 2. Pengeluaran rusak mendahulukan batch yang berlaku ==");
const kasa = (await execute(
  `INSERT INTO items (kode, nama, tipe, satuan_dasar, hpp, harga_jual) VALUES ('${TANDA}-K', 'Kasa Batch', 'bmhp', 'lembar', 100, 200)`,
)).insertId;
await transaction((c) => tambahStok(c, { siteId: site, itemId: kasa, qty: 15, jenis: "masuk_pembelian", refType: "purchase", userId: apoteker }));
const bExp = (await execute(
  `INSERT INTO item_batches (site_id, item_id, no_batch, tanggal_kadaluarsa, qty, hpp) VALUES (?,?,?,?,5,100)`,
  [site, kasa, "EXP", tambahHari(hariIni, -10)],
)).insertId;
const bOk = (await execute(
  `INSERT INTO item_batches (site_id, item_id, no_batch, tanggal_kadaluarsa, qty, hpp) VALUES (?,?,?,?,10,100)`,
  [site, kasa, "OK", tambahHari(hariIni, 200)],
)).insertId;
await catatPengeluaran(pengeluaranSchema.parse({
  item_id: kasa, qty: 3, jenis: "keluar_rusak", alasan: "Kemasan robek saat dibongkar",
}), site, apoteker);
const qb = async (id: number) => Number((await queryOne<RowDataPacket & { q: string }>(`SELECT qty q FROM item_batches WHERE id = ?`, [id]))!.q);
ok("batch kadaluarsa utuh (5)", (await qb(bExp)) === 5, String(await qb(bExp)));
ok("batch berlaku berkurang (10 → 7)", (await qb(bOk)) === 7, String(await qb(bOk)));

// =====================================================================
// 3 & 5. Riwayat & LB1
// =====================================================================
let np = 0;
async function pasien(tglLahir: string, jk: "L" | "P") {
  np++;
  return (await execute(
    `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin) VALUES (?,?,?,?,?,?)`,
    [site, `${TANDA}-${np}`, `327399000009${1000 + np}`, `Pasien ${np}`, tglLahir, jk],
  )).insertId;
}
async function kunjunganDx(pasienId: number, tanggal: string, icd: string, jenisKunjungan: "baru" | "lama") {
  np++;
  const v = (await execute(
    `INSERT INTO visits (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id, jenis_kunjungan, status, registered_by)
     VALUES (?,?,?,?,?,?,?, 'selesai', ?)`,
    [site, pasienId, `${TANDA}/V/${np}`, tanggal, poli, dokter, jenisKunjungan, dokter],
  )).insertId;
  const ma = (await execute(
    `INSERT INTO medical_assessments (visit_id, site_id, doctor_id, jenis_anamnesis, keluhan_utama,
       keadaan_umum, status_lokalis, terapi, status)
     VALUES (?,?,?, 'auto', 'Batuk berdahak 3 hari', 'baik', ?, 'Kompres hangat', 'final')`,
    [v, site, dokter, JSON.stringify({ catatan: "Ronki basah kanan", titik: [{ sisi: "depan", x: 1, y: 2 }] })],
  )).insertId;
  await execute(`INSERT INTO assessment_diagnoses (assessment_id, icd10_code, tipe) VALUES (?,?, 'primer')`, [ma, icd]);
  return v;
}
const icd = (await queryOne<RowDataPacket & { code: string }>(`SELECT code FROM icd10_codes WHERE is_active = 1 LIMIT 1`))!.code;

console.log("\n== 3. Riwayat pasien menampilkan SOAP terstruktur ==");
const pDewasa = await pasien("1990-05-01", "L");
const kemarin = tambahHari(hariIni, -1);
await kunjunganDx(pDewasa, kemarin, icd, "lama"); // pasien lama klinik, tapi diagnosa ini pertama kali
await kunjunganDx(pDewasa, hariIni, icd, "lama");
const rw = await riwayatKunjungan(pDewasa, 5);
ok("S memuat keluhan utama", Boolean(rw[0]?.subjective?.includes("Keluhan utama: Batuk berdahak")), String(rw[0]?.subjective));
ok("O memuat keadaan umum & status lokalis",
  Boolean(rw[0]?.objective?.includes("Keadaan umum: baik") && rw[0]?.objective?.includes("Ronki basah")), String(rw[0]?.objective));
ok("P memuat terapi", Boolean(rw[0]?.plan?.includes("Terapi: Kompres hangat")), String(rw[0]?.plan));

console.log("\n== 5. LB1: kasus baru & kelompok umur ==");
const pBayi = await pasien(tambahHari(hariIni, -3), "P"); // umur 3 hari
await kunjunganDx(pBayi, hariIni, icd, "baru");
const pLansia = await pasien("1940-01-01", "P");
await kunjunganDx(pLansia, hariIni, icd, "lama");
const lb1 = (await lb1Morbiditas(site, kemarin, hariIni)).find((b) => b.code === icd)!;
ok("pasien lama klinik + diagnosa pertama → kasus BARU (L)", Number(lb1.baru_l) === 1, `baru_l ${lb1.baru_l}`);
ok("diagnosa sama di kunjungan berikutnya → kasus LAMA (L)", Number(lb1.lama_l) === 1, `lama_l ${lb1.lama_l}`);
ok("dua pasien perempuan → 2 kasus baru P", Number(lb1.baru_p) === 2, `baru_p ${lb1.baru_p}`);
ok("total kasus 4", Number(lb1.total) === 4, String(lb1.total));
ok("bayi 3 hari → kelompok 0–7 hari (P)", Number(lb1.u_0_7h_p) === 1, String(lb1.u_0_7h_p));
ok("lansia → kelompok ≥70 (P)", Number(lb1.u_70t_p) === 1, String(lb1.u_70t_p));
ok("dewasa 36 th → kelompok 20–44 (L), hanya kasus barunya", Number(lb1.u_20_44t_l) === 1, String(lb1.u_20_44t_l));

// =====================================================================
// 4. IKP
// =====================================================================
console.log("\n== 4. IKP: peran operasional hanya melihat laporan sendiri ==");
const ikp = (anonim: boolean) => ikpSchema.parse({
  tanggal: hariIni, lokasi: "Ruang tunggu", jenis: "knc", anonim,
  kronologi: "Pasien hampir terpeleset di lantai basah dekat pintu masuk ruang tunggu.",
});
await laporkanIkp(ikp(false), site, perawat);
await laporkanIkp(ikp(false), site, kasir);
await laporkanIkp(ikp(true), site, kasir);
const semua = await daftarIkp(site, { dari: hariIni, sampai: hariIni });
const milikKasir = await daftarIkp(site, { dari: hariIni, sampai: hariIni, pelaporId: kasir });
ok("admin melihat ketiga laporan", semua.length === 3, String(semua.length));
ok("kasir hanya melihat laporannya yang bernama (1)", milikKasir.length === 1, String(milikKasir.length));
ok("laporan perawat tidak terlihat oleh kasir", milikKasir.every((r) => r.pelapor !== `${TANDA}.prw`));

// =====================================================================
await bersih();
await pool.end();
console.log(gagal ? `\n${gagal} GAGAL` : "\nSEMUA UJI LULUS");
process.exit(gagal ? 1 : 0);
