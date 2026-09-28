/**
 * Uji alur BAYAR SEBELUM OBAT DISERAHKAN.
 *
 *   node uji/jalankan.mjs uji-bayar-dulu.ts
 *
 *   Dokter → Farmasi validasi (kunci stok & harga)
 *          → Kasir bayar
 *          → Farmasi serahkan (potong stok)
 *          → Selesai
 *
 * Yang diuji adalah hal-hal yang kalau salah, hilangnya berupa BARANG atau
 * UANG dan tidak terlihat sampai stok opname:
 *
 *   1. Validasi TIDAK boleh memotong stok. Obat masih di rak; pasien belum
 *      membayar dan belum menerimanya.
 *   2. Stok yang sudah dikunci tidak boleh dipakai resep pasien lain — itu
 *      seluruh alasan reservasi ada.
 *   3. Obat TIDAK boleh keluar sebelum tagihan lunas.
 *   4. Resep yang dikembalikan ke dokter harus MELEPAS kuncinya. Reservasi
 *      yatim menahan stok selamanya tanpa layar yang menunjukkan sebabnya.
 *   5. Kunjungan tidak boleh ditutup di kasir — pasien masih harus mengambil
 *      obatnya.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne, transaction } from "../src/lib/db";
import { tambahStok } from "../src/lib/stock";
import {
  batalkanTerimaResep, batalkanValidasiResep, serahkanResep, terimaResep,
  validasiResep,
} from "../src/lib/pharmacy";
import { batalkanResep, cariObat, simpanResep } from "../src/lib/prescription";
import { prosesPembayaran } from "../src/lib/cashier";
import { buatOrderLab, simpanHasilLab } from "../src/lib/lab";
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

const TANDA = "UJIBYR";
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
    // Lab dibuang SEBELUM visits — `lab_orders.visit_id` adalah FK tanpa
    // ON DELETE CASCADE, jadi urutannya bukan selera.
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
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}', 'Uji Bayar Dulu')`,
)).insertId;

const roleId = async (c: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM roles WHERE code = ?`, [c]))!.id);

const buatUser = async (u: string, n: string, c: string) =>
  (await execute(
    `INSERT INTO users (site_id, role_id, nama, username, password_hash) VALUES (?,?,?,?,'x')`,
    [site, await roleId(c), n, u],
  )).insertId;

const dokter = await buatUser(`${TANDA}.dokter`, "dr. Uji Bayar", "dokter");
const apoteker = await buatUser(`${TANDA}.apt`, "apt. Uji Bayar", "farmasi");
const kasir = await buatUser(`${TANDA}.kasir`, "Kasir Uji", "kasir");

const poli = (await execute(
  `INSERT INTO polis (site_id, kode, nama) VALUES (?, '${TANDA}-P', 'Poli Uji')`, [site],
)).insertId;

const item = (await execute(
  `INSERT INTO items (kode, nama, tipe, satuan_dasar, hpp, harga_jual)
   VALUES ('${TANDA}-OBAT', 'Obat Uji Bayar', 'obat', 'tablet', 1000, 2000)`,
)).insertId;

// Stok sengaja pas-pasan supaya perebutan antar resep benar-benar terjadi.
await transaction((conn) =>
  tambahStok(conn, {
    siteId: site, itemId: item, qty: 10, jenis: "masuk_pembelian",
    refType: "purchase", userId: apoteker,
  }),
);

let n = 0;
async function buatKunjungan() {
  n++;
  const pasien = (await execute(
    `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin)
     VALUES (?,?,?,?, '1990-01-01', 'L')`,
    [site, `${TANDA}-${n}`, `327300000007${1000 + n}`, `Pasien ${n}`],
  )).insertId;

  const visitId = (await execute(
    `INSERT INTO visits (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
                         jenis_kunjungan, status, registered_by)
     VALUES (?,?,?,?,?,?, 'baru', 'menunggu_farmasi', ?)`,
    [site, pasien, `${TANDA}/V/${n}`, hariIni, poli, dokter, dokter],
  )).insertId;

  /* Baris antrean ikut dibuat: penutupannya di akhir alur adalah salah satu
     hal yang diuji, dan tanpa barisnya pengujian itu tidak berarti apa-apa. */
  await execute(
    `INSERT INTO queues (site_id, visit_id, poli_id, tanggal, prefix, nomor, status)
     VALUES (?,?,?,?, 'U', ?, 'dilayani')`,
    [site, visitId, poli, hariIni, n],
  );

  return visitId;
}

const resep = (qty: number) =>
  resepSchema.parse({
    items: [{
      item_id: item, nama: "Obat Uji Bayar", qty,
      satuan: "tablet", aturan_pakai: "3 x sehari 1 tablet", harga_satuan: 2000,
    }],
    racikans: [],
  });

const saldo = async () =>
  (await queryOne<RowDataPacket & { q: string; r: string }>(
    `SELECT qty_on_hand q, qty_reserved r FROM item_stocks
      WHERE item_id = ? AND site_id = ?`, [item, site],
  ))!;

const statusVisit = async (id: number) =>
  String((await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM visits WHERE id = ?`, [id]))!.status);

const tagihan = async (visitId: number) =>
  (await queryOne<RowDataPacket & { id: number; status: string; total: string }>(
    `SELECT id, status, total FROM billing_transactions WHERE visit_id = ?`, [visitId],
  ))!;

async function bayar(visitId: number) {
  const t = await tagihan(visitId);
  return prosesPembayaran(
    Number(t.id), site, kasir, null,
    pembayaranSchema.parse({
      payment_method: "tunai", dibayar: 999999, diskon: 0,
    }),
    0,
  );
}

// =====================================================================
// 1. Validasi mengunci stok, TIDAK memotongnya
// =====================================================================
console.log("\n== 1. Validasi: kunci, bukan potong ==");

const v1 = await buatKunjungan();
const rx1 = await simpanResepUji(v1, site, dokter, resep(6));
await terimaResep(rx1.prescriptionId, site, apoteker);

const sebelum = await saldo();
await validasiResep(rx1.prescriptionId, site, apoteker);
const sesudahValidasi = await saldo();

ok("stok fisik TIDAK berkurang saat validasi",
  Number(sesudahValidasi.q) === Number(sebelum.q), `${sesudahValidasi.q}`);
ok("6 tablet terkunci", Number(sesudahValidasi.r) === 6, `${sesudahValidasi.r}`);
ok("resep berstatus disiapkan",
  (await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM prescriptions WHERE id = ?`, [rx1.prescriptionId]))?.status === "disiapkan");
ok("kunjungan didorong ke kasir", (await statusVisit(v1)) === "menunggu_kasir");

const t1 = await tagihan(v1);
ok("tagihan 6 × 2.000 = 12.000", Number(t1.total) === 12000, `Rp ${Number(t1.total)}`);
ok("status tagihan naik dari draft ke 'menunggu'", t1.status === "menunggu", t1.status);

// Belum ada satu pun baris kartu stok untuk resep ini.
const kartu = await queryOne<RowDataPacket & { n: number }>(
  `SELECT COUNT(*) n FROM stock_movements
    WHERE item_id = ? AND site_id = ? AND jenis = 'keluar_resep'`, [item, site],
);
ok("belum ada pergerakan stok tercatat", Number(kartu?.n) === 0, String(kartu?.n));

// =====================================================================
// 2. Stok terkunci tidak bisa direbut resep lain
// =====================================================================
console.log("\n== 2. Reservasi menahan resep lain ==");

const v2 = await buatKunjungan();
const rx2 = await simpanResepUji(v2, site, dokter, resep(6));
await terimaResep(rx2.prescriptionId, site, apoteker);

let ditolak = "";
try {
  await validasiResep(rx2.prescriptionId, site, apoteker);
} catch (e) {
  ditolak = (e as Error).message;
}
ok("resep kedua ditolak — sisa 4, butuh 6", ditolak !== "", ditolak);
ok("pesannya menyebut jumlah yang tersedia", /4 tersedia/.test(ditolak), ditolak);
/*
 * Sebab penolakan harus disebut dengan benar. Versi pertama kode ini
 * menyalahkan batch KADALUARSA untuk stok yang sebenarnya dikunci resep
 * pasien lain — apoteker lalu mencarinya di Monitoring Kadaluarsa dan tidak
 * menemukan apa pun. Tindak lanjut kedua sebab itu sama sekali berbeda.
 */
ok("sebabnya disebut sebagai RESERVASI, bukan kadaluarsa",
  /dikunci resep pasien lain/.test(ditolak) && !/kadaluarsa/.test(ditolak),
  ditolak);
ok("reservasi resep pertama tidak ikut berubah",
  Number((await saldo()).r) === 6, (await saldo()).r);

// Yang muat pada sisa stok tetap boleh.
const v3 = await buatKunjungan();
const rx3 = await simpanResepUji(v3, site, dokter, resep(4));
await terimaResep(rx3.prescriptionId, site, apoteker);
await validasiResep(rx3.prescriptionId, site, apoteker);
ok("resep yang muat pada sisa stok tetap bisa divalidasi",
  Number((await saldo()).r) === 10, (await saldo()).r);

// =====================================================================
// 3. Obat tidak keluar sebelum lunas
// =====================================================================
console.log("\n== 3. Penyerahan menunggu pembayaran ==");

let tolakBelumBayar = "";
try {
  await serahkanResep(rx1.prescriptionId, site, apoteker);
} catch (e) {
  tolakBelumBayar = (e as Error).message;
}
ok("penyerahan sebelum lunas DITOLAK", tolakBelumBayar !== "", tolakBelumBayar);
ok("pesannya menyebut pembayaran", /bayar|lunas/i.test(tolakBelumBayar), tolakBelumBayar);
ok("stok tetap utuh setelah penolakan",
  Number((await saldo()).q) === 10, (await saldo()).q);

// =====================================================================
// 4. Bayar → kunjungan ke tahap ambil obat, BUKAN selesai
// =====================================================================
console.log("\n== 4. Kasir tidak menutup kunjungan ==");

await bayar(v1);
ok("tagihan lunas", (await tagihan(v1)).status === "lunas");
ok("kunjungan berstatus menunggu_obat, bukan selesai",
  (await statusVisit(v1)) === "menunggu_obat", await statusVisit(v1));

const notifFarmasi = await queryOne<RowDataPacket & { judul: string }>(
  `SELECT judul FROM notifications
    WHERE site_id = ? AND judul LIKE 'Lunas%' ORDER BY id DESC LIMIT 1`, [site],
);
ok("farmasi diberi tahu bahwa sudah lunas", notifFarmasi !== null, String(notifFarmasi?.judul));

// =====================================================================
// 5. Penyerahan memotong stok dan menutup kunjungan
// =====================================================================
console.log("\n== 5. Penyerahan ==");

await serahkanResep(rx1.prescriptionId, site, apoteker);
const sesudahSerah = await saldo();

ok("stok fisik berkurang 6", Number(sesudahSerah.q) === 4, `${sesudahSerah.q}`);
ok("reservasinya dilepas — tersisa milik resep ketiga saja",
  Number(sesudahSerah.r) === 4, `${sesudahSerah.r}`);
ok("kunjungan SELESAI setelah obat diambil",
  (await statusVisit(v1)) === "selesai", await statusVisit(v1));
/*
 * Baris antrean ikut ditutup. Penutupannya dulu hanya ada di kasir; sejak
 * pasien berresep berakhir di farmasi, jalur ini tidak lagi melewatinya dan
 * setiap pengambilan obat meninggalkan antrean berstatus `dilayani`
 * selamanya.
 */
ok("baris antreannya ikut ditutup",
  (await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM queues WHERE visit_id = ?`, [v1]))?.status === "selesai",
  String((await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM queues WHERE visit_id = ?`, [v1]))?.status));
ok("resep berstatus diserahkan",
  (await queryOne<RowDataPacket & { status: string; stok_direservasi: number }>(
    `SELECT status, stok_direservasi FROM prescriptions WHERE id = ?`,
    [rx1.prescriptionId]))?.status === "diserahkan");
ok("penanda reservasi dibersihkan",
  Number((await queryOne<RowDataPacket & { stok_direservasi: number }>(
    `SELECT stok_direservasi FROM prescriptions WHERE id = ?`,
    [rx1.prescriptionId]))?.stok_direservasi) === 0);

const kartuSesudah = await queryOne<RowDataPacket & { n: number }>(
  `SELECT COUNT(*) n FROM stock_movements
    WHERE item_id = ? AND site_id = ? AND jenis = 'keluar_resep'`, [item, site],
);
ok("pergerakan stok baru tercatat sekarang", Number(kartuSesudah?.n) > 0, String(kartuSesudah?.n));

let tolakDuaKali = "";
try {
  await serahkanResep(rx1.prescriptionId, site, apoteker);
} catch (e) {
  tolakDuaKali = (e as Error).message;
}
ok("penyerahan dua kali ditolak", tolakDuaKali !== "", tolakDuaKali);

// =====================================================================
// 6. TANGGA PEMBATALAN: batalkan validasi dulu, baru kembalikan ke dokter
// =====================================================================
console.log("\n== 6. Tangga pembatalan farmasi ==");

/*
 * Tiap anak tangga hanya bisa turun SATU langkah, dan tiap turunan adalah
 * kebalikan persis dari naiknya:
 *
 *   diterima_farmasi → [Kembalikan ke Dokter] → dokter
 *   disiapkan        → [Batalkan Validasi]    → diterima_farmasi
 *
 * Satu tombol yang membatalkan dua langkah sekaligus adalah cara paling mudah
 * meninggalkan setengah keadaan yang tidak konsisten — dan itu memang pernah
 * terjadi: pasien tertinggal di antrean kasir dengan tagihan yang baris
 * obatnya sudah lenyap.
 */
const rSebelum = Number((await saldo()).r);
ok("resep ketiga masih memegang 4 kunci", rSebelum === 4, String(rSebelum));

let tolakLompat = "";
try {
  await batalkanTerimaResep(rx3.prescriptionId, site, "apt", "Coba lompati satu tangga");
} catch (e) {
  tolakLompat = (e as Error).message;
}
ok("resep yang sudah DIVALIDASI tidak bisa langsung dikembalikan",
  tolakLompat !== "", tolakLompat);
ok("pesannya menunjuk anak tangga yang benar",
  /Batalkan Validasi/i.test(tolakLompat), tolakLompat);
ok("kuncinya belum tersentuh — penolakan tidak boleh setengah jalan",
  Number((await saldo()).r) === 4, (await saldo()).r);

await batalkanValidasiResep(rx3.prescriptionId, site);
ok("batalkan validasi mengembalikan resep ke tahap verifikasi",
  (await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM prescriptions WHERE id = ?`,
    [rx3.prescriptionId]))?.status === "diterima_farmasi");
ok("pasien ditarik pulang dari antrean kasir",
  (await statusVisit(v3)) === "menunggu_farmasi", await statusVisit(v3));

await batalkanTerimaResep(rx3.prescriptionId, site, "apt", "Dosis perlu ditinjau ulang");
ok("baru sesudah itu resepnya kembali ke dokter",
  (await statusVisit(v3)) === "dalam_pemeriksaan", await statusVisit(v3));

const rSesudah = await saldo();
ok("kunci dilepas seluruhnya", Number(rSesudah.r) === 0, `${rSesudah.r}`);
ok("stok fisik tidak ikut berubah", Number(rSesudah.q) === 4, `${rSesudah.q}`);
ok("tagihan obat ikut dibersihkan",
  Number((await tagihan(v3)).total) === 0, `Rp ${Number((await tagihan(v3)).total)}`);
ok("status tagihan turun kembali ke draft",
  (await tagihan(v3)).status === "draft", (await tagihan(v3)).status);
ok("penanda reservasi dibersihkan",
  Number((await queryOne<RowDataPacket & { stok_direservasi: number }>(
    `SELECT stok_direservasi FROM prescriptions WHERE id = ?`,
    [rx3.prescriptionId]))?.stok_direservasi) === 0);

/*
 * Stok yang dilepas benar-benar kembali tersedia. Diuji dengan resep 4 tablet
 * — sisa fisik memang tinggal 4 setelah resep pertama diserahkan, jadi resep
 * 6 tablet tetap ditolak dan itu BENAR.
 */
const v4 = await buatKunjungan();
const rx4 = await simpanResepUji(v4, site, dokter, resep(4));
await terimaResep(rx4.prescriptionId, site, apoteker);

let bolehLagi = "";
try {
  await validasiResep(rx4.prescriptionId, site, apoteker);
} catch (e) {
  bolehLagi = (e as Error).message;
}
ok("stok yang dilepas kembali bisa dipakai resep lain", bolehLagi === "", bolehLagi);
ok("terkunci lagi oleh pemakainya yang baru",
  Number((await saldo()).r) === 4, (await saldo()).r);

// =====================================================================
// 6b. REGRESI: dokter membatalkan resep yang sudah divalidasi
// =====================================================================
console.log("\n== 6b. Pembatalan oleh dokter melepas kunci ==");

/*
 * Versi pertama alur ini hanya melepas reservasi lewat "kembalikan ke
 * dokter". Dokter yang MEMBATALKAN resep meninggalkan stok terkunci
 * selamanya: barangnya ada di rak, sistem menolak memakainya, dan tidak ada
 * satu pun layar yang menunjukkan sebabnya.
 */
/* Stok ditambah supaya bagian ini tidak bergantung pada sisa hitungan di
   bagian sebelumnya — kegagalan di sini harus berarti bug, bukan aritmetika. */
await transaction((conn) =>
  tambahStok(conn, {
    siteId: site, itemId: item, qty: 10, jenis: "masuk_pembelian",
    refType: "purchase", userId: apoteker,
  }),
);

const v5 = await buatKunjungan();
const rx5 = await simpanResepUji(v5, site, dokter, resep(2));
await terimaResep(rx5.prescriptionId, site, apoteker);
await validasiResep(rx5.prescriptionId, site, apoteker);

const rSebelumBatal = Number((await saldo()).r);
ok("resep memegang kunci sebelum dibatalkan", rSebelumBatal >= 2, String(rSebelumBatal));
ok("tagihannya sudah terbentuk", Number((await tagihan(v5)).total) === 4000,
  `Rp ${Number((await tagihan(v5)).total)}`);

await batalkanResep(v5, site, "Pasien menolak obatnya");

ok("kunci ikut dilepas saat dokter membatalkan",
  Number((await saldo()).r) === rSebelumBatal - 2, (await saldo()).r);
ok("tagihan obat ikut dibersihkan",
  Number((await tagihan(v5)).total) === 0, `Rp ${Number((await tagihan(v5)).total)}`);
ok("penanda reservasi dibersihkan",
  Number((await queryOne<RowDataPacket & { stok_direservasi: number }>(
    `SELECT stok_direservasi FROM prescriptions WHERE id = ?`,
    [rx5.prescriptionId]))?.stok_direservasi) === 0);

// =====================================================================
// 6b-2. REGRESI: pengembalian resep yang SUDAH divalidasi
// =====================================================================
console.log("\n== 6b-2. Pengembalian dari tahap kasir ==");

/*
 * `validasiResep()` mendorong pasien ke `menunggu_kasir`. Versi pertama
 * `batalkanTerimaResep()` hanya menarik kembali kunjungan yang berstatus
 * `menunggu_farmasi`, sehingga pengembalian dari tahap kasir meninggalkan
 * pasien di sana. Akibatnya berlapis:
 *
 *   - dokter membuka notifikasinya dan menemukan form terkunci, karena
 *     `menunggu_kasir` bukan status yang boleh diperiksa;
 *   - kasir masih melihat tagihannya dan bisa menagihkan kunjungan yang
 *     baris obatnya baru saja dihapus. Sesudah lunas, `pastikanTagihan()`
 *     menolak segalanya dan resep itu tidak akan pernah bisa divalidasi
 *     ulang — kunjungan mati total.
 */
const v5b = await buatKunjungan();
const rx5b = await simpanResepUji(v5b, site, dokter, resep(2));
await terimaResep(rx5b.prescriptionId, site, apoteker);
await validasiResep(rx5b.prescriptionId, site, apoteker);

ok("validasi mendorong pasien ke kasir",
  (await statusVisit(v5b)) === "menunggu_kasir", await statusVisit(v5b));

await batalkanValidasiResep(rx5b.prescriptionId, site);
ok("batalkan validasi menarik pasien KELUAR dari antrean kasir",
  (await statusVisit(v5b)) === "menunggu_farmasi", await statusVisit(v5b));

await batalkanTerimaResep(rx5b.prescriptionId, site, "apt", "Sediaan keliru, mohon direvisi");

ok("pengembalian membawa pasien kembali ke dokter",
  (await statusVisit(v5b)) === "dalam_pemeriksaan", await statusVisit(v5b));
ok("statusnya boleh diperiksa dokter lagi",
  ["menunggu_dokter", "dalam_pemeriksaan", "menunggu_lab"].includes(
    await statusVisit(v5b)),
  await statusVisit(v5b));
ok("tagihannya turun kembali ke draft",
  (await tagihan(v5b)).status === "draft", (await tagihan(v5b)).status);

/*
 * Resep yang tagihannya SUDAH LUNAS tidak boleh dikembalikan: pengembalian
 * menghitung ulang total pada struk yang uangnya sudah diterima.
 */
const v5c = await buatKunjungan();
const rx5c = await simpanResepUji(v5c, site, dokter, resep(1));
await terimaResep(rx5c.prescriptionId, site, apoteker);
await validasiResep(rx5c.prescriptionId, site, apoteker);
await bayar(v5c);

let tolakLunas = "";
try {
  await batalkanValidasiResep(rx5c.prescriptionId, site);
} catch (e) {
  tolakLunas = (e as Error).message;
}
ok("pembatalan validasi sesudah pasien membayar DITOLAK", tolakLunas !== "", tolakLunas);
ok("pesannya menyebut pembayaran, bukan 'biaya baru'",
  /sudah membayar|lunas/i.test(tolakLunas), tolakLunas);
ok("tagihan lunasnya tidak berubah",
  (await tagihan(v5c)).status === "lunas" && Number((await tagihan(v5c)).total) === 2000,
  `${(await tagihan(v5c)).status} Rp ${Number((await tagihan(v5c)).total)}`);

// =====================================================================
// 6c. REGRESI: stok yang dikunci tidak ditawarkan ke dokter
// =====================================================================
console.log("\n== 6c. Layar menampilkan stok TERSEDIA ==");

/*
 * Kalau layar menampilkan saldo fisik, dokter meresepkan obat yang sudah
 * dikunci pasien lain — dan farmasi menolaknya saat validasi. Kegagalannya
 * baru muncul setelah pasien meninggalkan ruang periksa.
 */
const fisik = Number((await saldo()).q);
const terkunciKini = Number((await saldo()).r);
const barisObat = (await cariObat("Obat Uji Bayar", site))
  .find((o) => Number(o.id) === item);

ok("pencarian obat dokter memakai stok TERSEDIA",
  Number(barisObat?.stok) === fisik - terkunciKini,
  `tampil ${barisObat?.stok}; fisik ${fisik}, terkunci ${terkunciKini}`);

// =====================================================================
// 6d. REGRESI: hasil lab tidak boleh menjebak pasien
// =====================================================================
console.log("\n== 6d. Hasil lab & alur bayar-dulu ==");

/*
 * Dua jebakan yang pernah ada di sini:
 *
 *  a) Resep sudah DIVALIDASI (dihargai, stok dikunci), lalu hasil lab masuk.
 *     Kode lama mengirim pasien kembali ke `menunggu_farmasi` — padahal
 *     farmasi tidak punya pekerjaan tersisa, sementara kasir tidak melihatnya
 *     karena status kunjungannya bukan `menunggu_kasir`. Pasien terjebak.
 *
 *  b) Pasien SUDAH BAYAR (`menunggu_obat`), lalu hasil lab menyusul. Kode
 *     lama menariknya mundur — hilang dari daftar pengambilan obat, dan
 *     kasir menagihnya untuk kedua kalinya.
 */
/* Panel lab sederhana — satu parameter, supaya order bisa benar-benar
   dibuat dan difinalkan lewat jalur yang sesungguhnya. */
const panel = (await execute(
  `INSERT INTO lab_panels (kode, nama, kategori, tarif)
   VALUES ('${TANDA}-P1', 'Panel Uji Bayar', 'Uji', 20000)`,
)).insertId;
await execute(
  `INSERT INTO lab_parameters (panel_id, kode, nama, tipe_nilai, urutan)
   VALUES (?, '${TANDA}-PAR', 'Parameter Uji', 'numerik', 1)`,
  [panel],
);

const buatOrder = async (visitId: number) =>
  (await buatOrderLab(
    visitId, site, dokter,
    orderLabSchema.parse({
      prioritas: "rutin",
      panels: [{ panel_id: panel, nama: "Panel Uji Bayar", tarif: 20000 }],
    }),
  )).orderId;

async function finalkanOrder(orderId: number) {
  const par = await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM lab_parameters WHERE panel_id = ?`, [panel],
  );
  await simpanHasilLab(
    orderId, site, apoteker,
    hasilLabSchema.parse({
      finalkan: true,
      hasil: [{ parameter_id: Number(par!.id), panel_id: panel, nilai: "5" }],
    }),
  );
}

const v6 = await buatKunjungan();
const rx6 = await simpanResepUji(v6, site, dokter, resep(1));
await execute(
  `INSERT INTO medical_assessments (visit_id, site_id, doctor_id, status)
   VALUES (?,?,?, 'final')`,
  [v6, site, dokter],
);
await terimaResep(rx6.prescriptionId, site, apoteker);

/* Dua order dibuat SEBELUM pembayaran: satu difinalkan sebelum bayar
   (skenario a), satu lagi sesudahnya (skenario b). Order BARU pada
   kunjungan yang sudah lunas memang sudah ditolak `pastikanTagihan()`. */
const order1 = await buatOrder(v6);
const order2 = await buatOrder(v6);

/*
 * (a) Validasi DITOLAK selama dokter masih menunggu hasil.
 *
 * Mengunci stok dan harga untuk resep yang masih mungkin berubah adalah
 * kebalikan dari maksud reservasi: yang dijamin seharusnya obat yang sudah
 * pasti ditagihkan. Hasil lab bisa membuat dokter mengganti antibiotiknya.
 */
const kunciSebelumTolak = Number((await saldo()).r);
let tolakValidasiDiniLab = "";
try {
  await validasiResep(rx6.prescriptionId, site, apoteker);
} catch (e) {
  tolakValidasiDiniLab = (e as Error).message;
}
ok("validasi DITOLAK selama hasil lab masih ditunggu",
  tolakValidasiDiniLab !== "", tolakValidasiDiniLab);
ok("pesannya menyebut nomor ordernya",
  /UJIBYR\/L\//.test(tolakValidasiDiniLab), tolakValidasiDiniLab);
/* Penolakan harus utuh: tidak boleh ada satu pun tablet yang terlanjur
   dikunci sebelum penjaga berbunyi. Dibandingkan terhadap kunci milik resep
   lain yang memang sudah ada, bukan terhadap nol. */
ok("penolakan tidak menyisakan kunci baru",
  Number((await saldo()).r) === kunciSebelumTolak,
  `${(await saldo()).r} vs ${kunciSebelumTolak}`);

// Satu order selesai, satu masih berjalan → pasien tetap tertahan di lab.
await execute(`UPDATE visits SET status = 'menunggu_lab' WHERE id = ?`, [v6]);
await finalkanOrder(order1);
ok(
  "masih ada lab berjalan → pasien tetap di lab",
  (await statusVisit(v6)) === "menunggu_lab",
  await statusVisit(v6),
);

/*
 * Lab tuntas → pasien KEMBALI KE DOKTER untuk menilai hasilnya, bukan
 * dilempar ke farmasi atau kasir. Inilah perubahan intinya: pemeriksaan yang
 * hasilnya tidak pernah dibaca adalah biaya tanpa manfaat klinis.
 */
await finalkanOrder(order2);
ok(
  "lab tuntas → pasien kembali ke DOKTER untuk dinilai",
  (await statusVisit(v6)) === "menunggu_dokter",
  await statusVisit(v6),
);

// Selama pasien kembali di tangan dokter, farmasi BELUM boleh mengunci
// resepnya — hasil yang ditunggu wajib dinilai dokter lebih dulu (§3.1).
let tolakSebelumDinilai = "";
try {
  await validasiResep(rx6.prescriptionId, site, apoteker);
} catch (e) {
  tolakSebelumDinilai = (e as Error).message;
}
ok("validasi ditolak sebelum dokter menilai hasil lab",
  tolakSebelumDinilai !== "", tolakSebelumDinilai);

// Dokter menilai hasilnya lalu menekan Finalkan Asesmen → kembali ke farmasi.
// Barulah farmasi boleh mengunci resepnya.
await execute(`UPDATE visits SET status = 'menunggu_farmasi' WHERE id = ?`, [v6]);
await validasiResep(rx6.prescriptionId, site, apoteker);
ok("sesudah hasil keluar, validasi berhasil",
  (await statusVisit(v6)) === "menunggu_kasir", await statusVisit(v6));
ok("tagihannya ikut difinalkan", (await tagihan(v6)).status === "menunggu",
  (await tagihan(v6)).status);

/*
 * (b) Pasien yang SUDAH BAYAR tidak bisa ditarik mundur oleh lab — bukan
 * karena satu penjaga, melainkan dua yang sudah ada lebih dulu:
 * order lab BARU ditolak pada kunjungan lunas, dan order lama tidak bisa
 * difinalkan dua kali. Keduanya diuji di sini, karena keduanyalah yang
 * benar-benar menutup jalannya.
 */
await bayar(v6);
ok("sesudah bayar berstatus menunggu_obat", (await statusVisit(v6)) === "menunggu_obat");

let tolakOrderBaru = "";
try {
  await buatOrder(v6);
} catch (e) {
  tolakOrderBaru = (e as Error).message;
}
ok("order lab BARU pada kunjungan lunas ditolak", tolakOrderBaru !== "", tolakOrderBaru);

let tolakFinalUlang = "";
try {
  await finalkanOrder(order2);
} catch (e) {
  tolakFinalUlang = (e as Error).message;
}
ok("order lab yang sudah final tidak bisa difinalkan ulang",
  tolakFinalUlang !== "", tolakFinalUlang);

ok("pasien tetap di tahap ambil obat",
  (await statusVisit(v6)) === "menunggu_obat", await statusVisit(v6));

// =====================================================================
// 7. Kunjungan tanpa resep tetap selesai di kasir
// =====================================================================
console.log("\n== 7. Tanpa resep, kasir tetap ujung alurnya ==");

const v9 = await buatKunjungan();
await execute(`UPDATE visits SET status = 'menunggu_kasir' WHERE id = ?`, [v9]);
await execute(
  `INSERT INTO billing_transactions (site_id, visit_id, no_invoice, status)
   VALUES (?,?,?, 'menunggu')`,
  [site, v9, `${TANDA}/INV/9`],
);
await bayar(v9);
ok("kunjungan tanpa resep langsung SELESAI di kasir",
  (await statusVisit(v9)) === "selesai", await statusVisit(v9));

// =====================================================================
await bersih();
console.log(`\n${gagal === 0 ? "SEMUA UJI LULUS" : `${gagal} UJI GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
