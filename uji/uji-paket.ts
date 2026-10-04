/**
 * Uji PEMBULATAN PAKET di kasir.
 *
 *   node uji/jalankan.mjs uji-paket.ts
 *
 *   1. `hitungTotalBayar()` — aturan murni yang dipakai layar DAN server.
 *   2. Tagihan pasien umum di bawah paket terkecil ditolak tanpa paket.
 *   3. Paket menetapkan total; pembulatannya positif (= penanda struk ringkas).
 *   4. Paket di bawah total, digabung diskon, atau di luar daftar cabang ditolak.
 *   5. Pasien berpenjamin tidak terkena biaya minimum dan tidak boleh paket.
 *   5b. Laporan memisahkan selisih paket (pendapatan lain-lain) dari
 *       pembulatan cabang ke bawah.
 *   6. Pembatalan pembayaran menolkan pembulatan paket.
 *   7. Cabang tanpa paket (daftar kosong) berperilaku seperti sebelumnya.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne, transaction } from "../src/lib/db";
import { hitungUlangTagihan, pastikanTagihan, tambahBarisTagihan } from "../src/lib/billing";
import { batalkanPembayaran, prosesPembayaran } from "../src/lib/cashier";
import { simpanPenjamin } from "../src/lib/penjamin";
import { penyesuaianPendapatan } from "../src/lib/laporan";
import {
  PAKET_BAWAAN, hitungTotalBayar, pakaiPaket, pembayaranSchema, uraiPaket,
} from "../src/lib/validations/cashier";
import { penjaminSchema } from "../src/lib/validations/penjamin";
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

const TANDA = "UJIPKT";
const hariIni = tanggalHariIni();
const PAKET = [...PAKET_BAWAAN];

// =====================================================================
// 1. Aturan murni
// =====================================================================
console.log("\n== 1. hitungTotalBayar ==");
const dasar = { diskon: 0, paket: 0, daftarPaket: PAKET, pembulatanKe: 0, berpenjamin: false };

ok("98.000 tanpa paket → wajib pilih",
  hitungTotalBayar({ ...dasar, subtotal: 98000 }).galat !== null);
const p1 = hitungTotalBayar({ ...dasar, subtotal: 98000, paket: 125000 });
ok("98.000 paket 125.000 → total 125.000, pembulatan +27.000",
  p1.galat === null && p1.total === 125000 && p1.pembulatan === 27000, JSON.stringify(p1));
ok("pembulatan paket dikenali sebagai struk ringkas", pakaiPaket(p1.pembulatan));
ok("pembulatan cabang (ke bawah) BUKAN struk ringkas",
  !pakaiPaket(hitungTotalBayar({ ...dasar, subtotal: 200450, pembulatanKe: 100 }).pembulatan));
ok("140.000 paket 125.000 (di bawah total) ditolak",
  hitungTotalBayar({ ...dasar, subtotal: 140000, paket: 125000 }).galat !== null);
ok("140.000 tanpa paket boleh",
  hitungTotalBayar({ ...dasar, subtotal: 140000 }).galat === null);
ok("140.000 paket 170.000 boleh",
  hitungTotalBayar({ ...dasar, subtotal: 140000, paket: 170000 }).total === 170000);
ok("tepat 125.000 tanpa paket boleh",
  hitungTotalBayar({ ...dasar, subtotal: 125000 }).galat === null);
ok("diskon yang menurunkan total di bawah minimum → wajib paket",
  hitungTotalBayar({ ...dasar, subtotal: 130000, diskon: 10000 }).galat !== null);
ok("paket + diskon ditolak",
  hitungTotalBayar({ ...dasar, subtotal: 100000, diskon: 5000, paket: 125000 }).galat !== null);
ok("nominal di luar daftar ditolak",
  hitungTotalBayar({ ...dasar, subtotal: 100000, paket: 150000 }).galat !== null);
ok("berpenjamin: tanpa biaya minimum",
  hitungTotalBayar({ ...dasar, subtotal: 50000, berpenjamin: true }).galat === null);
ok("berpenjamin: paket ditolak",
  hitungTotalBayar({ ...dasar, subtotal: 50000, berpenjamin: true, paket: 125000 }).galat !== null);
ok("daftar kosong: tanpa biaya minimum",
  hitungTotalBayar({ ...dasar, subtotal: 50000, daftarPaket: [] }).galat === null);

ok("uraiPaket: baris tidak ada → bawaan", uraiPaket(null).join() === PAKET.join());
ok("uraiPaket: kosong → fitur mati", uraiPaket("").length === 0);
ok("uraiPaket: titik ribuan, spasi, urutan acak",
  uraiPaket(" 175.000, 125000 ,130000,x,125000").join() === "125000,130000,175000",
  uraiPaket(" 175.000, 125000 ,130000,x,125000").join());

// =====================================================================
// Persiapan basis data
// =====================================================================
async function bersih() {
  const sites = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM sites WHERE kode LIKE '${TANDA}%'`)
  ).map((r) => r.id);
  if (sites.length) {
    const s = sites.join(",");
    await execute(`DELETE FROM notifications WHERE site_id IN (${s})`);
    await execute(`DELETE FROM billing_items WHERE billing_id IN (SELECT id FROM billing_transactions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM billing_transactions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM queues WHERE site_id IN (${s})`);
    await execute(`DELETE FROM visits WHERE site_id IN (${s})`);
    await execute(`DELETE FROM patients WHERE site_id IN (${s})`);
    await execute(`DELETE FROM polis WHERE site_id IN (${s})`);
    await execute(`DELETE FROM sequences WHERE site_id IN (${s})`);
  }
  await execute(`DELETE FROM payers WHERE kode LIKE '${TANDA}%'`);
  await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
  if (sites.length) await execute(`DELETE FROM sites WHERE id IN (${sites.join(",")})`);
}
await bersih();

const site = (await execute(
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}', 'Uji Paket')`,
)).insertId;
const roleId = async (c: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM roles WHERE code = ?`, [c]))!.id);
const buatUser = async (u: string, n: string, c: string) =>
  (await execute(
    `INSERT INTO users (site_id, role_id, nama, username, password_hash) VALUES (?,?,?,?,'x')`,
    [site, await roleId(c), n, u],
  )).insertId;
const admin = await buatUser(`${TANDA}.adm`, "Admin Paket", "admin_cabang");
const kasir = await buatUser(`${TANDA}.kas`, "Kasir Paket", "kasir");
const dokter = await buatUser(`${TANDA}.dok`, "dr. Paket", "dokter");
const poli = (await execute(
  `INSERT INTO polis (site_id, kode, nama) VALUES (?, '${TANDA}-P', 'Poli Uji')`, [site],
)).insertId;
const payer = await simpanPenjamin(penjaminSchema.parse({
  kode: `${TANDA}-PJ`, nama: "PT Uji Paket", jenis: "perusahaan",
  termin_hari: 30, plafon_per_kunjungan: 0,
}));

let np = 0;
async function tagihan(nilai: number, payerId: number | null = null) {
  np++;
  const pasien = (await execute(
    `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin, payer_id)
     VALUES (?,?,?,?, '1990-01-01', 'P', ?)`,
    [site, `${TANDA}-${np}`, `327377000008${1000 + np}`, `Pasien Paket ${np}`, payerId],
  )).insertId;
  const v = (await execute(
    `INSERT INTO visits (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
                         jenis_kunjungan, cara_bayar, payer_id, status, registered_by)
     VALUES (?,?,?,?,?,?, 'baru', ?, ?, 'menunggu_kasir', ?)`,
    [site, pasien, `${TANDA}/V/${np}`, hariIni, poli, dokter,
      payerId ? "perusahaan" : "umum", payerId, admin],
  )).insertId;
  await execute(
    `INSERT INTO queues (site_id, visit_id, poli_id, tanggal, prefix, nomor, status)
     VALUES (?,?,?,?, 'K', ?, 'dilayani')`,
    [site, v, poli, hariIni, np],
  );
  const id = await transaction(async (conn) => {
    const b = await pastikanTagihan(conn, v, site);
    await tambahBarisTagihan(conn, {
      billingId: b, kategori: "jasa_dokter", deskripsi: "Konsultasi Uji", qty: 1, hargaSatuan: nilai,
    });
    await hitungUlangTagihan(conn, b);
    return b;
  });
  await execute(`UPDATE billing_transactions SET status = 'menunggu' WHERE id = ?`, [id]);
  return id;
}
const bayar = (id: number, raw: object, daftar: number[] = PAKET) =>
  prosesPembayaran(
    id, site, kasir, null,
    pembayaranSchema.parse({ payment_method: "tunai", dibayar: 1_000_000, diskon: 0, ...raw }),
    0, daftar,
  );
const baca = (id: number) =>
  queryOne<RowDataPacket & { status: string; total: string; pembulatan: string; kembalian: string }>(
    `SELECT status, total, pembulatan, kembalian FROM billing_transactions WHERE id = ?`, [id],
  ).then((r) => r!);

try {
  // ===================================================================
  console.log("\n== 2–3. Biaya minimum & paket ==");
  const t1 = await tagihan(98000);
  const tolakMin = await ditolak(() => bayar(t1, {}));
  ok("98.000 tanpa paket ditolak server", /pilih salah satu pembulatan/.test(tolakMin), tolakMin || "DITERIMA");
  ok("tagihannya tetap belum lunas", (await baca(t1)).status === "menunggu");

  const h1 = await bayar(t1, { paket: 125000, dibayar: 150000 });
  const b1 = await baca(t1);
  ok("paket 125.000 lunas dengan total 125.000",
    b1.status === "lunas" && Number(b1.total) === 125000 && h1.total === 125000, `total ${b1.total}`);
  ok("pembulatan tersimpan +27.000", Number(b1.pembulatan) === 27000, String(b1.pembulatan));
  ok("kembalian dihitung dari total paket", Number(b1.kembalian) === 25000, String(b1.kembalian));

  // ===================================================================
  console.log("\n== 4. Penolakan paket ==");
  const t2 = await tagihan(140000);
  ok("paket di bawah total ditolak", /di bawah total/.test(await ditolak(() => bayar(t2, { paket: 125000 }))));
  ok("paket + diskon ditolak", /Diskon/.test(await ditolak(() => bayar(t2, { paket: 170000, diskon: 1000 }))));
  ok("nominal di luar daftar cabang ditolak",
    /tidak berlaku/.test(await ditolak(() => bayar(t2, { paket: 150000 }))));
  await bayar(t2, {});
  ok("140.000 tanpa paket tetap boleh", Number((await baca(t2)).total) === 140000);

  // ===================================================================
  console.log("\n== 5. Pasien berpenjamin ==");
  const t3 = await tagihan(50000, payer);
  ok("paket untuk pasien berpenjamin ditolak",
    /penjamin/.test(await ditolak(() => bayar(t3, { paket: 125000 }))));
  await bayar(t3, {});
  const b3 = await baca(t3);
  ok("tanpa biaya minimum — tagihan penjamin tidak dinaikkan",
    b3.status === "lunas" && Number(b3.total) === 50000, `total ${b3.total}`);

  // ===================================================================
  console.log("\n== 5b. Laporan: selisih paket = pendapatan lain-lain ==");
  const t5 = await tagihan(140500);
  await prosesPembayaran(
    t5, site, kasir, null,
    pembayaranSchema.parse({ payment_method: "tunai", dibayar: 1_000_000, diskon: 0 }),
    1000, PAKET,
  );
  const lap = await penyesuaianPendapatan(site, hariIni, hariIni);
  ok("selisih paket terpisah sebagai pendapatan lain-lain (+27.000)",
    lap.selisihPaket === 27000, String(lap.selisihPaket));
  ok("pembulatan cabang ke bawah tidak tercampur (−500)",
    lap.pembulatan === -500, String(lap.pembulatan));

  // ===================================================================
  console.log("\n== 6. Pembatalan menolkan paket ==");
  await batalkanPembayaran(t1, site, "uji pembatalan pembulatan paket");
  const b1b = await baca(t1);
  ok("pembulatan kembali 0 dan total kembali ke rincian",
    Number(b1b.pembulatan) === 0 && Number(b1b.total) === 98000,
    `pembulatan ${b1b.pembulatan}, total ${b1b.total}`);

  // ===================================================================
  console.log("\n== 7. Cabang tanpa paket ==");
  const t4 = await tagihan(40000);
  await bayar(t4, {}, []);
  ok("daftar kosong: 40.000 lunas apa adanya", Number((await baca(t4)).total) === 40000);
} finally {
  await bersih();
  await pool.end();
}

console.log(gagal ? `\n${gagal} pemeriksaan GAGAL` : "\nSemua pemeriksaan lulus.");
process.exit(gagal ? 1 : 0);
