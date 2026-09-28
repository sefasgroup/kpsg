/**
 * Uji PEMBATALAN: pembayaran kasir dan order lab.
 *
 *   node uji/jalankan.mjs uji-pembatalan.ts
 *
 * Dua operasi yang sebelumnya ada tetapi tidak pernah dipanggil layar mana
 * pun — dan keduanya, kalau dipakai apa adanya, meninggalkan kunjungan dalam
 * keadaan yang tidak bisa dilanjutkan maupun ditutup.
 *
 * Yang diuji:
 *
 *   1. Pembatalan pembayaran mengembalikan pasien ke antrean kasir, bukan
 *      menandai tagihan `batal` — satu kunjungan hanya punya SATU tagihan,
 *      jadi `batal` menutupnya dari penagihan selamanya.
 *   2. Pembatalan ditolak bila obat sudah diserahkan (barang sudah keluar),
 *      bila shift kasirnya sudah ditutup (kas sudah dihitung), dan bila
 *      tagihannya memang belum dibayar.
 *   3. Pembatalan order lab memajukan status kunjungan. Tanpa itu pasien
 *      tertinggal di `menunggu_lab` menunggu pemeriksaan yang tidak ada.
 *   4. Order lab yang hasilnya sudah diinput tidak bisa dibatalkan, dan
 *      order pada kunjungan lunas juga tidak — keduanya mengubah angka yang
 *      sudah terjadi.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne, transaction } from "../src/lib/db";
import { tambahStok } from "../src/lib/stock";
import { serahkanResep, terimaResep, validasiResep } from "../src/lib/pharmacy";
import { simpanResep } from "../src/lib/prescription";
import {
  alasanTakBolehBatal, batalkanPembayaran, bukaShift, prosesPembayaran, tutupShift,
} from "../src/lib/cashier";
import { batalkanOrderLab, buatOrderLab, simpanHasilLab } from "../src/lib/lab";
import { resepSchema } from "../src/lib/validations/doctor";
import { pembayaranSchema } from "../src/lib/validations/cashier";
import { hasilLabSchema, orderLabSchema } from "../src/lib/validations/lab";
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

const TANDA = "UJIBTL";
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
    await execute(`DELETE FROM notifications WHERE site_id IN (${s})`);
    await execute(`DELETE FROM billing_items WHERE billing_id IN (SELECT id FROM billing_transactions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM billing_transactions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM prescription_racikans WHERE prescription_id IN (SELECT id FROM prescriptions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM prescription_items WHERE prescription_id IN (SELECT id FROM prescriptions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM prescriptions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM cashier_shifts WHERE site_id IN (${s})`);
    await execute(`DELETE FROM queues WHERE site_id IN (${s})`);
    await execute(`DELETE FROM lab_results WHERE order_id IN (SELECT id FROM lab_orders WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM lab_order_panels WHERE order_id IN (SELECT id FROM lab_orders WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM lab_orders WHERE site_id IN (${s})`);
    await execute(`DELETE FROM medical_assessments WHERE site_id IN (${s})`);
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
  await execute(`DELETE FROM lab_parameters WHERE panel_id IN (SELECT id FROM lab_panels WHERE kode LIKE '${TANDA}%')`);
  await execute(`DELETE FROM lab_panels WHERE kode LIKE '${TANDA}%'`);
}
await bersih();

const site = (await execute(
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}', 'Uji Pembatalan')`,
)).insertId;

const roleId = async (c: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM roles WHERE code = ?`, [c]))!.id);

const buatUser = async (u: string, n: string, c: string) =>
  (await execute(
    `INSERT INTO users (site_id, role_id, nama, username, password_hash) VALUES (?,?,?,?,'x')`,
    [site, await roleId(c), n, u],
  )).insertId;

const dokter = await buatUser(`${TANDA}.dokter`, "dr. Uji Batal", "dokter");
const apoteker = await buatUser(`${TANDA}.apt`, "apt. Uji Batal", "farmasi");
const kasir = await buatUser(`${TANDA}.kasir`, "Kasir Batal", "kasir");
const petugasLab = await buatUser(`${TANDA}.lab`, "Analis Batal", "petugas_lab");

const poli = (await execute(
  `INSERT INTO polis (site_id, kode, nama) VALUES (?, '${TANDA}-P', 'Poli Uji')`, [site],
)).insertId;

const item = (await execute(
  `INSERT INTO items (kode, nama, tipe, satuan_dasar, hpp, harga_jual)
   VALUES ('${TANDA}-OBAT', 'Obat Uji Batal', 'obat', 'tablet', 1000, 2000)`,
)).insertId;

await transaction((conn) =>
  tambahStok(conn, {
    siteId: site, itemId: item, qty: 100, jenis: "masuk_pembelian",
    refType: "purchase", userId: apoteker,
  }),
);

const panel = (await execute(
  `INSERT INTO lab_panels (kode, nama, kategori, tarif)
   VALUES ('${TANDA}-P1', 'Panel Uji Batal', 'Uji', 30000)`,
)).insertId;
const parameterId = (await execute(
  `INSERT INTO lab_parameters (panel_id, kode, nama, tipe_nilai, urutan)
   VALUES (?, '${TANDA}-PAR', 'Parameter Uji', 'numerik', 1)`,
  [panel],
)).insertId;

let n = 0;
/** Membuat kunjungan lengkap dengan baris antrean dan asesmen final. */
async function buatKunjungan(status: string, asesmenFinal = true) {
  n++;
  const pasien = (await execute(
    `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin)
     VALUES (?,?,?,?, '1990-01-01', 'L')`,
    [site, `${TANDA}-${n}`, `327300000009${1000 + n}`, `Pasien Batal ${n}`],
  )).insertId;

  const visitId = (await execute(
    `INSERT INTO visits (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
                         jenis_kunjungan, status, registered_by)
     VALUES (?,?,?,?,?,?, 'baru', ?, ?)`,
    [site, pasien, `${TANDA}/V/${n}`, hariIni, poli, dokter, status, dokter],
  )).insertId;

  await execute(
    `INSERT INTO queues (site_id, visit_id, poli_id, tanggal, prefix, nomor, status)
     VALUES (?,?,?,?, 'U', ?, 'dilayani')`,
    [site, visitId, poli, hariIni, n],
  );

  if (asesmenFinal) {
    await execute(
      `INSERT INTO medical_assessments (visit_id, site_id, doctor_id, status)
       VALUES (?,?,?, 'final')`,
      [visitId, site, dokter],
    );
  }
  return visitId;
}

const resep = (qty: number) =>
  resepSchema.parse({
    items: [{
      item_id: item, nama: "Obat Uji Batal", qty,
      satuan: "tablet", aturan_pakai: "3 x sehari 1 tablet", harga_satuan: 2000,
    }],
    racikans: [],
  });

const statusVisit = async (id: number) =>
  String((await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM visits WHERE id = ?`, [id]))!.status);

const statusAntrean = async (id: number) =>
  String((await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM queues WHERE visit_id = ?`, [id]))!.status);

const tagihan = async (visitId: number) =>
  (await queryOne<RowDataPacket & {
    id: number; status: string; total: string; diskon: string;
    payment_method: string | null; paid_at: string | null;
  }>(
    `SELECT id, status, total, diskon, payment_method, paid_at
       FROM billing_transactions WHERE visit_id = ?`, [visitId],
  ))!;

async function bayar(visitId: number, shiftId: number | null = null, diskon = 0) {
  const t = await tagihan(visitId);
  return prosesPembayaran(
    Number(t.id), site, kasir, shiftId,
    pembayaranSchema.parse({ payment_method: "tunai", dibayar: 999999, diskon }),
    0,
  );
}

const buatOrder = async (visitId: number) =>
  (await buatOrderLab(
    visitId, site, dokter,
    orderLabSchema.parse({
      prioritas: "rutin",
      panels: [{ panel_id: panel, nama: "Panel Uji Batal", tarif: 30000 }],
    }),
  )).orderId;

// =====================================================================
// 1. Pembatalan pembayaran mengembalikan pasien ke kasir
// =====================================================================
console.log("\n== 1. Batalkan pembayaran: kembali ke antrean, bukan mati ==");

const v1 = await buatKunjungan("menunggu_farmasi");
const rx1 = await simpanResepUji(v1, site, dokter, resep(3));
await terimaResep(rx1.prescriptionId, site, apoteker);
await validasiResep(rx1.prescriptionId, site, apoteker);
await bayar(v1, null, 1000);

ok("sebelum dibatalkan: lunas & menunggu obat",
  (await tagihan(v1)).status === "lunas" && (await statusVisit(v1)) === "menunggu_obat",
  `${(await tagihan(v1)).status} / ${await statusVisit(v1)}`);
ok("tidak ada halangan untuk membatalkan",
  (await alasanTakBolehBatal(Number((await tagihan(v1)).id), site)) === null,
  String(await alasanTakBolehBatal(Number((await tagihan(v1)).id), site)));

await batalkanPembayaran(Number((await tagihan(v1)).id), site, "Salah metode bayar");

const t1 = await tagihan(v1);
/*
 * `menunggu`, BUKAN `batal`. Satu kunjungan hanya boleh punya satu tagihan
 * (`uq_bt_visit`), sehingga `batal` bersifat final: `pastikanTagihan()` akan
 * menolak segalanya dan kunjungan itu tidak bisa ditagih maupun ditutup.
 */
ok("tagihan kembali ke 'menunggu', bukan 'batal'", t1.status === "menunggu", t1.status);
ok("jejak pembayaran dihapus", t1.payment_method === null && t1.paid_at === null,
  `${t1.payment_method} / ${t1.paid_at}`);
ok("diskon ikut dinolkan", Number(t1.diskon) === 0, `Rp ${Number(t1.diskon)}`);
ok("total kembali ke nilai penuh 3 × 2.000", Number(t1.total) === 6000, `Rp ${Number(t1.total)}`);
ok("pasien kembali ke antrean kasir",
  (await statusVisit(v1)) === "menunggu_kasir", await statusVisit(v1));
ok("baris antreannya dibuka lagi",
  (await statusAntrean(v1)) === "dilayani", await statusAntrean(v1));

const notifTahan = await queryOne<RowDataPacket & { judul: string }>(
  `SELECT judul FROM notifications
    WHERE site_id = ? AND judul LIKE 'Pembayaran dibatalkan%' ORDER BY id DESC LIMIT 1`,
  [site],
);
ok("farmasi diberi tahu untuk menahan obatnya",
  notifTahan !== null, String(notifTahan?.judul));

// Dan benar-benar bisa ditagih ulang.
await bayar(v1);
ok("tagihan bisa dibayar ulang", (await tagihan(v1)).status === "lunas");
ok("pasien kembali ke tahap ambil obat",
  (await statusVisit(v1)) === "menunggu_obat", await statusVisit(v1));

// =====================================================================
// 2. Penolakan: obat sudah diserahkan
// =====================================================================
console.log("\n== 2. Obat sudah keluar gudang ==");

await serahkanResep(rx1.prescriptionId, site, apoteker);

const halangan1 = await alasanTakBolehBatal(Number((await tagihan(v1)).id), site);
ok("layar sudah tahu sebabnya sebelum tombol ditekan",
  halangan1 !== null && /diserahkan/.test(halangan1), String(halangan1));

let tolakDiserahkan = "";
try {
  await batalkanPembayaran(Number((await tagihan(v1)).id), site, "Coba batalkan sesudah serah");
} catch (e) {
  tolakDiserahkan = (e as Error).message;
}
ok("pembatalan DITOLAK setelah obat diserahkan", tolakDiserahkan !== "", tolakDiserahkan);
ok("pesannya mengarahkan ke retur obat", /retur/i.test(tolakDiserahkan), tolakDiserahkan);
ok("kunjungan tetap selesai", (await statusVisit(v1)) === "selesai", await statusVisit(v1));

// =====================================================================
// 3. Penolakan: shift kasir sudah ditutup
// =====================================================================
console.log("\n== 3. Shift sudah ditutup, kas sudah dihitung ==");

const shift = await bukaShift(site, kasir, 0);
const v2 = await buatKunjungan("menunggu_kasir");
// Tagihan dibuat lewat jalur normal supaya nomor invoice-nya sah.
await transaction(async (conn) => {
  const { pastikanTagihan, tambahBarisTagihan, hitungUlangTagihan } =
    await import("../src/lib/billing");
  const bid = await pastikanTagihan(conn, v2, site);
  await tambahBarisTagihan(conn, {
    billingId: bid, kategori: "tindakan", deskripsi: "Konsultasi Uji",
    qty: 1, hargaSatuan: 50000, refType: "assessment_procedure", refId: 1,
  });
  await hitungUlangTagihan(conn, bid);
});

await bayar(v2, shift);
ok("terbayar di dalam shift", (await tagihan(v2)).status === "lunas");

await tutupShift(shift, site, kasir, 50000, "tutup untuk uji");

const halangan2 = await alasanTakBolehBatal(Number((await tagihan(v2)).id), site);
ok("halangan shift terbaca di layar", halangan2 !== null && /[Ss]hift/.test(halangan2),
  String(halangan2));

let tolakShift = "";
try {
  await batalkanPembayaran(Number((await tagihan(v2)).id), site, "Coba batalkan sesudah tutup shift");
} catch (e) {
  tolakShift = (e as Error).message;
}
ok("pembatalan DITOLAK setelah shift ditutup", tolakShift !== "", tolakShift);
ok("tagihannya tetap lunas", (await tagihan(v2)).status === "lunas");

// =====================================================================
// 4. Penolakan: belum ada pembayaran
// =====================================================================
console.log("\n== 4. Tagihan yang belum dibayar ==");

const v3 = await buatKunjungan("menunggu_kasir");
await transaction(async (conn) => {
  const { pastikanTagihan } = await import("../src/lib/billing");
  await pastikanTagihan(conn, v3, site);
});

let tolakBelumBayar = "";
try {
  await batalkanPembayaran(Number((await tagihan(v3)).id), site, "Tidak ada yang dibatalkan");
} catch (e) {
  tolakBelumBayar = (e as Error).message;
}
ok("pembatalan pembayaran pada tagihan belum lunas DITOLAK",
  tolakBelumBayar !== "", tolakBelumBayar);

// =====================================================================
// 5. Pembatalan order lab memajukan kunjungan
// =====================================================================
console.log("\n== 5. Batalkan order lab: pasien tidak boleh tertinggal ==");

/*
 * Inilah kegagalan yang sebelumnya tersembunyi: order dibatalkan, tarifnya
 * hilang dari tagihan, tetapi kunjungan tetap `menunggu_lab` — menunggu
 * pemeriksaan yang sudah tidak ada. Pasien tidak muncul di layar mana pun.
 */
const v4 = await buatKunjungan("dalam_pemeriksaan");
const o4 = await buatOrder(v4);
ok("order mendorong pasien ke lab", (await statusVisit(v4)) === "menunggu_lab",
  await statusVisit(v4));
ok("tarif lab masuk tagihan", Number((await tagihan(v4)).total) === 30000,
  `Rp ${Number((await tagihan(v4)).total)}`);

const hasilBatal = await batalkanOrderLab(o4, site, "Salah pilih panel pemeriksaan", petugasLab, "Analis Batal");

ok("tarifnya keluar dari tagihan", Number((await tagihan(v4)).total) === 0,
  `Rp ${Number((await tagihan(v4)).total)}`);
/* Asesmen kunjungan ini final dan tidak ada resep → langsung ke kasir. */
ok("kunjungan TIDAK tertinggal di menunggu_lab",
  (await statusVisit(v4)) !== "menunggu_lab", await statusVisit(v4));
ok("kunjungan maju ke kasir", (await statusVisit(v4)) === "menunggu_kasir",
  await statusVisit(v4));
ok("status yang dilaporkan sama dengan yang tersimpan",
  hasilBatal.statusKunjungan === (await statusVisit(v4)), hasilBatal.statusKunjungan);
ok("tagihannya ikut difinalkan", (await tagihan(v4)).status === "menunggu",
  (await tagihan(v4)).status);
/*
 * Alasan pembatalan punya KOLOMNYA SENDIRI, tidak lagi ditempelkan ke
 * `catatan_klinis`. Kolom itu berisi konteks klinis yang ditulis dokter untuk
 * petugas lab dan ikut tercetak di lembar hasil — mencampurinya dengan catatan
 * administratif membuat keduanya sama-sama sulit dibaca.
 */
const jejakBatal = await queryOne<RowDataPacket & {
  alasan_batal: string | null; catatan_klinis: string | null; dibatalkan_by: number | null;
}>(
  `SELECT alasan_batal, catatan_klinis, dibatalkan_by FROM lab_orders WHERE id = ?`, [o4],
);
ok("alasannya tercatat di kolom alasan_batal",
  /Salah pilih panel/.test(String(jejakBatal?.alasan_batal)), String(jejakBatal?.alasan_batal));
ok("catatan klinis dokter tidak dicemari catatan administratif",
  !/\[BATAL\]/.test(String(jejakBatal?.catatan_klinis ?? "")));
ok("siapa yang membatalkan ikut tercatat",
  Number(jejakBatal?.dibatalkan_by) === petugasLab, String(jejakBatal?.dibatalkan_by));

// Asesmen belum final → pasien dikembalikan ke DOKTER, bukan ke kasir.
const v5 = await buatKunjungan("dalam_pemeriksaan", false);
const o5 = await buatOrder(v5);
await batalkanOrderLab(o5, site, "Pasien menolak diambil darah", petugasLab, "Analis Batal");
ok("asesmen belum final → kembali ke dokter",
  (await statusVisit(v5)) === "menunggu_dokter", await statusVisit(v5));

// Masih ada order lain → pasien tetap di lab.
const v6 = await buatKunjungan("dalam_pemeriksaan");
const o6a = await buatOrder(v6);
await buatOrder(v6);
await batalkanOrderLab(o6a, site, "Panel ini duplikat, dibatalkan satu", petugasLab, "Analis Batal");
ok("masih ada order lain → pasien tetap di lab",
  (await statusVisit(v6)) === "menunggu_lab", await statusVisit(v6));

// =====================================================================
// 6. Penolakan pembatalan order lab
// =====================================================================
console.log("\n== 6. Order yang tidak boleh dibatalkan ==");

/* (a) hasilnya sudah diinput — reagen sudah terpakai */
const v7 = await buatKunjungan("dalam_pemeriksaan");
const o7 = await buatOrder(v7);
await simpanHasilLab(
  o7, site, petugasLab,
  hasilLabSchema.parse({
    finalkan: false,
    hasil: [{ parameter_id: parameterId, panel_id: panel, nilai: "7" }],
  }),
);

let tolakAdaHasil = "";
try {
  await batalkanOrderLab(o7, site, "Coba batalkan padahal sudah ada hasil", petugasLab, "Analis Batal");
} catch (e) {
  tolakAdaHasil = (e as Error).message;
}
ok("order yang hasilnya sudah diinput DITOLAK", tolakAdaHasil !== "", tolakAdaHasil);
ok("pesannya menyebut pemeriksaan sudah dikerjakan",
  /sudah dikerjakan|reagen/i.test(tolakAdaHasil), tolakAdaHasil);
ok("tarifnya tetap di tagihan", Number((await tagihan(v7)).total) === 30000,
  `Rp ${Number((await tagihan(v7)).total)}`);

/* (b) tagihan kunjungan sudah lunas */
const v8 = await buatKunjungan("dalam_pemeriksaan");
const o8a = await buatOrder(v8);
const o8b = await buatOrder(v8);
await simpanHasilLab(
  o8a, site, petugasLab,
  hasilLabSchema.parse({
    finalkan: true,
    hasil: [{ parameter_id: parameterId, panel_id: panel, nilai: "7" }],
  }),
);
// Order kedua sengaja dibiarkan berjalan, lalu kunjungan dipaksa ke kasir
// dan dibayar — meniru koreksi manual yang bisa terjadi di lapangan.
await execute(`UPDATE visits SET status = 'menunggu_kasir' WHERE id = ?`, [v8]);
await bayar(v8);

let tolakLunas = "";
try {
  await batalkanOrderLab(o8b, site, "Coba batalkan pada kunjungan lunas", petugasLab, "Analis Batal");
} catch (e) {
  tolakLunas = (e as Error).message;
}
ok("order pada kunjungan LUNAS DITOLAK", tolakLunas !== "", tolakLunas);
ok("pesannya mengarahkan ke pembatalan pembayaran",
  /lunas|kasir/i.test(tolakLunas), tolakLunas);

/* (c) order yang sudah selesai */
let tolakSelesai = "";
try {
  await batalkanOrderLab(o8a, site, "Coba batalkan order yang sudah selesai", petugasLab, "Analis Batal");
} catch (e) {
  tolakSelesai = (e as Error).message;
}
ok("order yang sudah selesai DITOLAK", tolakSelesai !== "", tolakSelesai);

// =====================================================================
await bersih();
console.log(`\n${gagal === 0 ? "SEMUA UJI LULUS" : `${gagal} UJI GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
