/**
 * Uji UANG — harga dihitung di server, kasir, klaim, dan laporan metode bayar.
 *
 *   node uji/jalankan.mjs uji-uang.ts
 *
 * Setiap bagian mengunci satu bug yang pernah lolos:
 *
 *   1. Harga obat, bahan racikan, BMHP, dan panel lab diambil dari katalog /
 *      kontrak penjamin — kiriman formulir dengan harga 0 tidak berpengaruh.
 *   2. Tarif kontrak penjamin untuk BARANG benar-benar dipakai.
 *   3. Kasir hanya bisa menutup shift miliknya sendiri; pembayaran ke shift
 *      yang sudah ditutup ditolak.
 *   4. Pembayaran tagihan yang sedang diklaim tidak bisa dibatalkan.
 *   5. Klaim yang ditolak seluruhnya selesai (lunas), bukan piutang penuh;
 *      verifikasi ulang setelah ada pembayaran ditolak.
 *   6. Laporan metode bayar = uang yang diterima, bukan nilai tagihan.
 *   7. "BPJS" tidak bisa dipakai membayar bagian pasien; "lainnya" wajib
 *      berketerangan.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne, transaction } from "../src/lib/db";
import { tambahStok } from "../src/lib/stock";
import { simpanPenjamin, simpanTarifPenjamin } from "../src/lib/penjamin";
import { hitungUlangTagihan, pastikanTagihan, tambahBarisTagihan } from "../src/lib/billing";
import {
  alasanTakBolehBatal, batalkanPembayaran, bukaShift, prosesPembayaran, tutupShift,
} from "../src/lib/cashier";
import { terimaResep, validasiResep } from "../src/lib/pharmacy";
import { simpanResep } from "../src/lib/prescription";
import { buatOrderLab } from "../src/lib/lab";
import { simpanPengkajian } from "../src/lib/nurse";
import {
  ajukanKlaim, barisKlaim, buatKlaim, catatPembayaranKlaim, ringkasanKlaim, verifikasiKlaim,
} from "../src/lib/klaim";
import { metodeBayar } from "../src/lib/laporan";
import { pembayaranSchema } from "../src/lib/validations/cashier";
import { penjaminSchema, tarifPenjaminSchema } from "../src/lib/validations/penjamin";
import { bayarKlaimSchema, klaimBaruSchema } from "../src/lib/validations/klaim";
import { resepSchema } from "../src/lib/validations/doctor";
import { orderLabSchema } from "../src/lib/validations/lab";
import { nurseAssessmentSchema } from "../src/lib/validations/nurse";
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

const TANDA = "UJIUANG";
const hariIni = tanggalHariIni();

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
    await execute(`DELETE FROM claim_payments WHERE claim_id IN (SELECT id FROM claims WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM claim_items WHERE claim_id IN (SELECT id FROM claims WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM claims WHERE site_id IN (${s})`);
    await execute(`DELETE FROM notifications WHERE site_id IN (${s})`);
    await execute(`DELETE FROM billing_items WHERE billing_id IN (SELECT id FROM billing_transactions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM billing_transactions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM cashier_shifts WHERE site_id IN (${s})`);
    await execute(`DELETE FROM prescription_racikans WHERE prescription_id IN (SELECT id FROM prescriptions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM prescription_items WHERE prescription_id IN (SELECT id FROM prescriptions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM prescriptions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM lab_order_panels WHERE order_id IN (SELECT id FROM lab_orders WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM lab_orders WHERE site_id IN (${s})`);
    await execute(`DELETE FROM nurse_bmhp_usage WHERE site_id IN (${s})`);
    await execute(`DELETE FROM nurse_assessments WHERE site_id IN (${s})`);
    await execute(`DELETE FROM queues WHERE site_id IN (${s})`);
    await execute(`DELETE FROM medical_assessments WHERE site_id IN (${s})`);
    await execute(`DELETE FROM visits WHERE site_id IN (${s})`);
    await execute(`DELETE FROM patients WHERE site_id IN (${s})`);
    await execute(`DELETE FROM stock_movements WHERE site_id IN (${s})`);
    await execute(`DELETE FROM item_batches WHERE site_id IN (${s})`);
    await execute(`DELETE FROM item_stocks WHERE site_id IN (${s})`);
    await execute(`DELETE FROM polis WHERE site_id IN (${s})`);
    await execute(`DELETE FROM sequences WHERE site_id IN (${s})`);
  }
  await execute(`DELETE FROM payer_tariffs WHERE payer_id IN (SELECT id FROM payers WHERE kode LIKE '${TANDA}%')`);
  await execute(`DELETE FROM payers WHERE kode LIKE '${TANDA}%'`);
  await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
  if (sites.length) await execute(`DELETE FROM sites WHERE id IN (${sites.join(",")})`);
  if (items.length) {
    const l = items.join(",");
    await execute(`DELETE FROM stock_movements WHERE item_id IN (${l})`);
    await execute(`DELETE FROM item_stocks WHERE item_id IN (${l})`);
    await execute(`DELETE FROM items WHERE id IN (${l})`);
  }
  await execute(`DELETE FROM lab_panels WHERE kode LIKE '${TANDA}%'`);
}
await bersih();

const site = (await execute(
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}', 'Uji Uang')`,
)).insertId;
const roleId = async (c: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM roles WHERE code = ?`, [c]))!.id);
const buatUser = async (u: string, n: string, c: string) =>
  (await execute(
    `INSERT INTO users (site_id, role_id, nama, username, password_hash) VALUES (?,?,?,?,'x')`,
    [site, await roleId(c), n, u],
  )).insertId;
const admin = await buatUser(`${TANDA}.adm`, "Admin Uang", "admin_cabang");
const kasir = await buatUser(`${TANDA}.kas`, "Kasir Uang", "kasir");
const kasir2 = await buatUser(`${TANDA}.kas2`, "Kasir Dua", "kasir");
const dokter = await buatUser(`${TANDA}.dok`, "dr. Uang", "dokter");
const apoteker = await buatUser(`${TANDA}.apt`, "apt. Uang", "farmasi");
const perawat = await buatUser(`${TANDA}.prw`, "Perawat Uang", "perawat");
const poli = (await execute(
  `INSERT INTO polis (site_id, kode, nama) VALUES (?, '${TANDA}-P', 'Poli Uji')`, [site],
)).insertId;

const obat = (await execute(
  `INSERT INTO items (kode, nama, tipe, satuan_dasar, hpp, harga_jual)
   VALUES ('${TANDA}-OBAT', 'Amoksisilin Uji', 'obat', 'tablet', 500, 1000)`,
)).insertId;
const bmhp = (await execute(
  `INSERT INTO items (kode, nama, tipe, satuan_dasar, hpp, harga_jual)
   VALUES ('${TANDA}-KASA', 'Kasa Uji', 'bmhp', 'lembar', 1000, 2500)`,
)).insertId;
for (const it of [obat, bmhp]) {
  await transaction((conn) =>
    tambahStok(conn, {
      siteId: site, itemId: it, qty: 100, jenis: "masuk_pembelian",
      refType: "purchase", userId: apoteker,
    }),
  );
}
const panel = (await execute(
  `INSERT INTO lab_panels (kode, nama, kategori, tarif) VALUES ('${TANDA}-P1', 'Darah Lengkap Uji', 'Uji', 45000)`,
)).insertId;

const payer = await simpanPenjamin(penjaminSchema.parse({
  kode: `${TANDA}-PJ`, nama: "PT Kontrak Obat", jenis: "perusahaan",
  termin_hari: 30, plafon_per_kunjungan: 0,
}));
await simpanTarifPenjamin(tarifPenjaminSchema.parse({
  payer_id: payer, procedure_id: null, item_id: obat, harga: 700,
}));

let np = 0;
async function kunjungan(status: string, payerId: number | null = null) {
  np++;
  const pasien = (await execute(
    `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin, payer_id)
     VALUES (?,?,?,?, '1990-01-01', 'L', ?)`,
    [site, `${TANDA}-${np}`, `327377000009${1000 + np}`, `Pasien Uang ${np}`, payerId],
  )).insertId;
  const v = (await execute(
    `INSERT INTO visits (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
                         jenis_kunjungan, cara_bayar, payer_id, status, registered_by)
     VALUES (?,?,?,?,?,?, 'baru', ?, ?, ?, ?)`,
    [site, pasien, `${TANDA}/V/${np}`, hariIni, poli, dokter,
      payerId ? "perusahaan" : "umum", payerId, status, admin],
  )).insertId;
  await execute(
    `INSERT INTO queues (site_id, visit_id, poli_id, tanggal, prefix, nomor, status)
     VALUES (?,?,?,?, 'K', ?, 'dilayani')`,
    [site, v, poli, hariIni, np],
  );
  return v;
}
async function tagihanSiapBayar(status: string, nilai: number, payerId: number | null = null) {
  const v = await kunjungan(status, payerId);
  const billingId = await transaction(async (conn) => {
    const id = await pastikanTagihan(conn, v, site);
    await tambahBarisTagihan(conn, {
      billingId: id, kategori: "tindakan", deskripsi: "Tindakan Uji", qty: 1, hargaSatuan: nilai,
    });
    await hitungUlangTagihan(conn, id);
    return id;
  });
  await execute(`UPDATE billing_transactions SET status = 'menunggu' WHERE id = ?`, [billingId]);
  return { visitId: v, billingId };
}
const barisTagihan = async (v: number) =>
  query<RowDataPacket & { kategori: string; deskripsi: string; harga_satuan: string; subtotal: string }>(
    `SELECT bi.kategori, bi.deskripsi, bi.harga_satuan, bi.subtotal
       FROM billing_items bi JOIN billing_transactions bt ON bt.id = bi.billing_id
      WHERE bt.visit_id = ? ORDER BY bi.id`, [v]);
const bayar = (billingId: number, shiftId: number | null, kasirId = kasir, raw: object = { payment_method: "tunai", dibayar: 10_000_000, diskon: 0 }) =>
  prosesPembayaran(billingId, site, kasirId, shiftId, pembayaranSchema.parse(raw), 0);

// =====================================================================
// 1 & 2. Harga dari server + tarif kontrak barang
// =====================================================================
console.log("\n== 1. Harga dihitung di server, bukan dari formulir ==");

const resepHarga0 = () => resepSchema.parse({
  items: [{ item_id: obat, nama: "NAMA PALSU", qty: 10, satuan: "tablet",
    aturan_pakai: "3 x sehari 1 tablet", harga_satuan: 0 }],
  racikans: [{
    nama_racikan: "Puyer Uji", qty_jadi: 10, aturan_pakai: "3 x sehari 1 bungkus",
    biaya_jasa_racik: 3000,
    ingredients: [{ item_id: obat, nama: "x", qty_bahan: 5, satuan: "tablet", harga_satuan: 0 }],
  }],
});

// (a) pasien umum → harga jual katalog
const vUmum = await kunjungan("dalam_pemeriksaan");
const rxUmum = await simpanResep(vUmum, site, dokter, resepHarga0());
const hargaTersimpan = await queryOne<RowDataPacket & { h: string }>(
  `SELECT harga_satuan h FROM prescription_items WHERE prescription_id = ?`, [rxUmum.prescriptionId]);
ok("harga 0 dari formulir diabaikan — tersimpan harga katalog", Number(hargaTersimpan!.h) === 1000,
  String(hargaTersimpan!.h));
await execute(`UPDATE visits SET status = 'menunggu_farmasi' WHERE id = ?`, [vUmum]);
await terimaResep(rxUmum.prescriptionId, site, apoteker);
// harga katalog berubah SETELAH resep ditulis → validasi mengunci harga terbaru
await execute(`UPDATE items SET harga_jual = 1200 WHERE id = ?`, [obat]);
await validasiResep(rxUmum.prescriptionId, site, apoteker);
await execute(`UPDATE items SET harga_jual = 1000 WHERE id = ?`, [obat]);
const tUmum = await barisTagihan(vUmum);
const obatUmum = tUmum.find((b) => b.kategori === "obat");
ok("validasi menagih harga katalog terbaru (kunci harga)", Number(obatUmum?.harga_satuan) === 1200,
  String(obatUmum?.harga_satuan));
ok("deskripsi tagihan dari katalog, bukan dari formulir", obatUmum?.deskripsi === "Amoksisilin Uji",
  String(obatUmum?.deskripsi));
const racikanUmum = tUmum.find((b) => b.kategori === "racikan");
ok("nilai bahan racikan dari katalog (5 × 1.200)", Number(racikanUmum?.subtotal) === 6000,
  String(racikanUmum?.subtotal));
ok("jasa racik tetap sesuai isian dokter", tUmum.some((b) => b.kategori === "jasa_racik" && Number(b.subtotal) === 3000));

// (b) pasien penjamin → tarif kontrak barang
console.log("\n== 2. Tarif kontrak penjamin untuk barang ==");
const vPj = await kunjungan("dalam_pemeriksaan", payer);
const rxPj = await simpanResep(vPj, site, dokter, resepHarga0());
await execute(`UPDATE visits SET status = 'menunggu_farmasi' WHERE id = ?`, [vPj]);
await terimaResep(rxPj.prescriptionId, site, apoteker);
await validasiResep(rxPj.prescriptionId, site, apoteker);
const tPj = await barisTagihan(vPj);
ok("obat pasien penjamin ditagih harga kontrak (700)",
  Number(tPj.find((b) => b.kategori === "obat")?.harga_satuan) === 700,
  String(tPj.find((b) => b.kategori === "obat")?.harga_satuan));
ok("bahan racikan pasien penjamin memakai harga kontrak (5 × 700)",
  Number(tPj.find((b) => b.kategori === "racikan")?.subtotal) === 3500);

// (c) panel lab
const vLab = await kunjungan("dalam_pemeriksaan");
await buatOrderLab(vLab, site, dokter, orderLabSchema.parse({
  prioritas: "rutin", sifat_hasil: "menyusul",
  panels: [{ panel_id: panel, nama: "NAMA PALSU", tarif: 1 }],
}));
const lab = (await barisTagihan(vLab)).find((b) => b.kategori === "laboratorium");
ok("tarif lab dari master panel (45.000), bukan 1 dari formulir", Number(lab?.harga_satuan) === 45000,
  String(lab?.harga_satuan));
ok("nama panel dari master", lab?.deskripsi === "Darah Lengkap Uji", String(lab?.deskripsi));

// (d) BMHP perawat
const vBmhp = await kunjungan("menunggu_perawat");
await simpanPengkajian(vBmhp, site, perawat, nurseAssessmentSchema.parse({
  triase: "hijau", keluhan_utama: "luka lecet",
  bmhp: [{ item_id: bmhp, nama: "NAMA PALSU", satuan: "lembar", harga_satuan: 0, qty: 2 }],
}));
const bm = (await barisTagihan(vBmhp)).find((b) => b.kategori === "bmhp");
ok("BMHP ditagih harga katalog (2.500), bukan 0", Number(bm?.harga_satuan) === 2500, String(bm?.harga_satuan));
ok("nama BMHP dari katalog", bm?.deskripsi === "Kasa Uji", String(bm?.deskripsi));

// =====================================================================
// 3. Shift kasir
// =====================================================================
console.log("\n== 3. Shift kasir ==");
const shift1 = await bukaShift(site, kasir, 0);
const shift2 = await bukaShift(site, kasir2, 0);
const tolakTutupOrangLain = await ditolak(() => tutupShift(shift2, site, kasir, 999999));
ok("kasir TIDAK bisa menutup shift kasir lain", tolakTutupOrangLain !== "", tolakTutupOrangLain);
ok("shift kasir lain tetap terbuka",
  (await queryOne<RowDataPacket & { t: string | null }>(
    `SELECT ditutup_at t FROM cashier_shifts WHERE id = ?`, [shift2]))!.t === null);

const tShift = await tagihanSiapBayar("menunggu_kasir", 50000);
await tutupShift(shift2, site, kasir2, 0);
const tolakShiftTutup = await ditolak(() => bayar(tShift.billingId, shift2, kasir2));
ok("pembayaran ke shift yang sudah ditutup ditolak", tolakShiftTutup !== "", tolakShiftTutup);
ok("tagihannya tetap belum lunas",
  (await queryOne<RowDataPacket & { s: string }>(
    `SELECT status s FROM billing_transactions WHERE id = ?`, [tShift.billingId]))!.s !== "lunas");

// =====================================================================
// 4. Pembatalan pembayaran tagihan yang sedang diklaim
// =====================================================================
console.log("\n== 4. Tagihan yang diklaim tidak bisa dibatalkan pembayarannya ==");
const tKlaim = await tagihanSiapBayar("menunggu_kasir", 80000, payer);
await bayar(tKlaim.billingId, shift1, kasir, { payment_method: "tunai", dibayar: 0, diskon: 0 });
const klaimA = await buatKlaim(klaimBaruSchema.parse({
  payer_id: payer, periode_dari: hariIni, periode_sampai: hariIni,
}), site, admin);
const alasan = await alasanTakBolehBatal(tKlaim.billingId, site);
ok("layar kasir menyebut klaimnya", Boolean(alasan && /klaim/i.test(alasan)), String(alasan));
const tolakBatal = await ditolak(() => batalkanPembayaran(tKlaim.billingId, site, "salah input"));
ok("batalkanPembayaran DITOLAK selama diklaim", tolakBatal !== "", tolakBatal);

// =====================================================================
// 5. Klaim ditolak seluruhnya & verifikasi ulang
// =====================================================================
console.log("\n== 5. Klaim ditolak seluruhnya ==");
await ajukanKlaim(klaimA.id, site, admin);
const piutangSebelum = (await ringkasanKlaim(site)).piutang;
const semuaBaris = await barisKlaim(klaimA.id);
await verifikasiKlaim(klaimA.id, site, {
  baris: semuaBaris.map((b) => ({
    claim_item_id: Number(b.id), nilai_disetujui: 0, alasan_koreksi: "Di luar tanggungan polis",
  })),
});
const statusKlaimA = (await queryOne<RowDataPacket & { s: string }>(
  `SELECT status s FROM claims WHERE id = ?`, [klaimA.id]))!.s;
ok("klaim yang ditolak seluruhnya → lunas (tidak ada lagi yang ditagih)", statusKlaimA === "lunas", statusKlaimA);
const piutangSesudah = (await ringkasanKlaim(site)).piutang;
ok("piutang berkurang seluruh nilai klaim itu", piutangSebelum - piutangSesudah >= 80000,
  `${piutangSebelum} → ${piutangSesudah}`);
const tolakBayarNol = await ditolak(() => catatPembayaranKlaim(klaimA.id, site,
  bayarKlaimSchema.parse({ tanggal: hariIni, jumlah: 1000, metode: "transfer" }), admin));
ok("pembayaran untuk klaim bernilai 0 ditolak", tolakBayarNol !== "", tolakBayarNol);

console.log("\n== 5b. Verifikasi ulang setelah ada pembayaran ==");
const tKlaimB = await tagihanSiapBayar("menunggu_kasir", 100000, payer);
await bayar(tKlaimB.billingId, shift1, kasir, { payment_method: "tunai", dibayar: 0, diskon: 0 });
const klaimB = await buatKlaim(klaimBaruSchema.parse({
  payer_id: payer, periode_dari: hariIni, periode_sampai: hariIni,
}), site, admin);
await ajukanKlaim(klaimB.id, site, admin);
const barisB = await barisKlaim(klaimB.id);
await verifikasiKlaim(klaimB.id, site, {
  baris: barisB.map((b) => ({ claim_item_id: Number(b.id), nilai_disetujui: Number(b.nilai_diajukan) })),
});
await catatPembayaranKlaim(klaimB.id, site,
  bayarKlaimSchema.parse({ tanggal: hariIni, jumlah: 80000, metode: "transfer", ref: "TRF-UJI" }), admin);
const tolakVerifUlang = await ditolak(() => verifikasiKlaim(klaimB.id, site, {
  baris: barisB.map((b) => ({ claim_item_id: Number(b.id), nilai_disetujui: 70000, alasan_koreksi: "potong" })),
}));
ok("verifikasi ulang setelah pembayaran DITOLAK", tolakVerifUlang !== "", tolakVerifUlang);
const lunasB = await catatPembayaranKlaim(klaimB.id, site,
  bayarKlaimSchema.parse({ tanggal: hariIni, jumlah: 20000, metode: "transfer", ref: "TRF-UJI-2" }), admin);
ok("sisa pembayaran tetap bisa dicatat sampai lunas", lunasB.lunas === true, JSON.stringify(lunasB));

// =====================================================================
// 6. Laporan metode bayar
// =====================================================================
console.log("\n== 6. Laporan metode bayar = uang yang diterima ==");
const plafon = await simpanPenjamin(penjaminSchema.parse({
  kode: `${TANDA}-CAP`, nama: "PT Berplafon Uang", jenis: "asuransi",
  termin_hari: 14, plafon_per_kunjungan: 100000,
}));
const tPlafon = await tagihanSiapBayar("menunggu_kasir", 153000, plafon);
await bayar(tPlafon.billingId, shift1, kasir, { payment_method: "qris", payment_ref: "QR-UJI", diskon: 0 });
const baris = (await metodeBayar(site, hariIni, hariIni)).find((m) => m.payment_method === "qris");
ok("QRIS tercatat 53.000 (bagian pasien), bukan 153.000", Number(baris?.nilai) === 53000, String(baris?.nilai));

// =====================================================================
// 7. Metode BPJS & lainnya
// =====================================================================
console.log("\n== 7. Metode bayar tanpa jejak uang ==");
const tBpjs = await tagihanSiapBayar("menunggu_kasir", 40000);
const tolakBpjs = await ditolak(() => bayar(tBpjs.billingId, shift1, kasir, { payment_method: "bpjs", diskon: 0 }));
ok("bagian pasien dengan metode BPJS ditolak", tolakBpjs !== "", tolakBpjs);
ok("metode 'lainnya' tanpa keterangan ditolak schema",
  !pembayaranSchema.safeParse({ payment_method: "lainnya", diskon: 0 }).success);
ok("metode 'lainnya' dengan keterangan diterima schema",
  pembayaranSchema.safeParse({ payment_method: "lainnya", payment_ref: "Voucher karyawan", diskon: 0 }).success);

// =====================================================================
await bersih();
await pool.end();
console.log(gagal ? `\n${gagal} GAGAL` : "\nSEMUA UJI LULUS");
process.exit(gagal ? 1 : 0);
