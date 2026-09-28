/**
 * Uji konsumsi batch FEFO (*first expired, first out*) di `kurangiStok()`.
 *
 *   node uji/jalankan.mjs uji-fefo.ts
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne, transaction } from "../src/lib/db";
import { StokTidakCukupError, kurangiStok, tambahStok } from "../src/lib/stock";
import { tambahHari, tanggalHariIni } from "../src/lib/tanggal";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

const TANDA = "UJIFEFO";
const hariIni = tanggalHariIni();

async function bersih() {
  const sites = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM sites WHERE kode LIKE '${TANDA}%'`)
  ).map((r) => r.id);
  const items = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM items WHERE kode LIKE '${TANDA}%'`)
  ).map((r) => r.id);
  if (items.length) {
    const l = items.join(",");
    await execute(`DELETE FROM stock_movements WHERE item_id IN (${l})`);
    await execute(`DELETE FROM item_batches WHERE item_id IN (${l})`);
    await execute(`DELETE FROM item_stocks WHERE item_id IN (${l})`);
    await execute(`DELETE FROM items WHERE id IN (${l})`);
  }
  if (sites.length) {
    const l = sites.join(",");
    await execute(`DELETE FROM stock_movements WHERE site_id IN (${l})`);
    await execute(`DELETE FROM item_batches WHERE site_id IN (${l})`);
    await execute(`DELETE FROM item_stocks WHERE site_id IN (${l})`);
    // Akun uji menunjuk ke cabang uji — harus lepas sebelum cabangnya dihapus.
    await execute(`DELETE FROM users WHERE username = '${TANDA.toLowerCase()}.petugas'`);
    await execute(`DELETE FROM sites WHERE id IN (${l})`);
  }
}
await bersih();

const site = (await execute(`INSERT INTO sites (kode, nama) VALUES ('${TANDA}', 'Uji FEFO')`)).insertId;
/*
 * Petugas dibuat sendiri, bukan dipinjam dari akun seed. Uji yang bergantung
 * pada data contoh berhenti bekerja tepat ketika paling dibutuhkan: setelah
 * basis data dikosongkan untuk go-live.
 */
const roleFarmasi = Number(
  (await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM roles WHERE code = 'farmasi'`,
  ))!.id,
);
await execute(
  `INSERT INTO users (site_id, role_id, nama, username, password_hash)
   VALUES (?,?, 'Petugas Uji FEFO', '${TANDA.toLowerCase()}.petugas', 'x')
   ON DUPLICATE KEY UPDATE nama = VALUES(nama)`,
  [site, roleFarmasi],
);
const petugas = Number(
  (await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM users WHERE username = '${TANDA.toLowerCase()}.petugas'`,
  ))!.id,
);

async function buatItem(kode: string) {
  return (
    await execute(
      `INSERT INTO items (kode, tipe, nama, satuan_dasar, hpp, harga_jual)
       VALUES (?, 'obat', ?, 'tablet', 1000, 2500)`,
      [kode, `Uji ${kode}`],
    )
  ).insertId;
}

const stok = async (itemId: number) =>
  Number(
    (await queryOne<RowDataPacket & { q: string }>(
      `SELECT qty_on_hand q FROM item_stocks WHERE site_id=? AND item_id=?`,
      [site, itemId],
    ))?.q ?? 0,
  );

const batchQty = async (itemId: number) =>
  (
    await query<RowDataPacket & { no_batch: string; qty: string }>(
      `SELECT no_batch, qty FROM item_batches WHERE site_id=? AND item_id=? ORDER BY tanggal_kadaluarsa IS NULL, tanggal_kadaluarsa, id`,
      [site, itemId],
    )
  ).map((b) => `${b.no_batch}=${Number(b.qty)}`);

/** Membuat batch lewat jalur resmi: penerimaan. */
async function terima(
  itemId: number,
  qty: number,
  noBatch: string | null,
  expDalamHari: number | null,
  hpp = 1000,
) {
  await transaction(async (conn) => {
    let batchId: number | null = null;
    if (noBatch || expDalamHari !== null) {
      const res = await conn.execute<import("mysql2").ResultSetHeader>(
        `INSERT INTO item_batches (site_id, item_id, no_batch, tanggal_kadaluarsa, qty, hpp)
         VALUES (?,?,?,?,?,?)`,
        [
          site, itemId, noBatch,
          expDalamHari === null ? null : tambahHari(hariIni, expDalamHari),
          qty, hpp,
        ],
      );
      batchId = res[0].insertId;
    }
    await tambahStok(conn, {
      siteId: site, itemId, qty, jenis: "masuk_pembelian",
      hpp, batchId, refType: "purchase", userId: petugas,
    });
  });
}

const potong = (itemId: number, qty: number, opts: Record<string, unknown> = {}) =>
  transaction((conn) =>
    kurangiStok(conn, {
      siteId: site, itemId, qty, jenis: "keluar_resep",
      refType: "uji", userId: petugas, ...opts,
    }),
  );

// =====================================================================
console.log("\n== 1. Urutan konsumsi: kadaluarsa terdekat lebih dulu ==");
// =====================================================================

const itemA = await buatItem(`${TANDA}-A`);
// Sengaja dimasukkan TIDAK berurutan agar urutan benar-benar diuji.
await terima(itemA, 30, "LAMBAT", 300);
await terima(itemA, 20, "CEPAT", 10);
await terima(itemA, 50, "SEDANG", 100);

ok("stok total setelah 3 penerimaan", (await stok(itemA)) === 100);

await potong(itemA, 15);
ok(
  "batch tercepat kadaluarsa dipakai lebih dulu",
  (await batchQty(itemA)).join(" ") === "CEPAT=5 SEDANG=50 LAMBAT=30",
  (await batchQty(itemA)).join(" "),
);

await potong(itemA, 25);
ok(
  "pemotongan melintasi batas batch",
  (await batchQty(itemA)).join(" ") === "CEPAT=0 SEDANG=30 LAMBAT=30",
  "5 sisa dari CEPAT habis, 20 diambil dari SEDANG",
);
ok("saldo gudang tetap konsisten", (await stok(itemA)) === 60);

const kartu = await query<RowDataPacket & { qty: string; batch_id: number | null; qty_after: string }>(
  `SELECT qty, batch_id, qty_after FROM stock_movements
    WHERE site_id=? AND item_id=? AND qty_delta < 0 ORDER BY id`,
  [site, itemA],
);
ok("pemotongan lintas batch menghasilkan satu baris per batch", kartu.length === 3, `${kartu.length} baris untuk 2 pemotongan`);
ok("setiap baris tertaut ke batch-nya", kartu.every((k) => k.batch_id !== null));
ok(
  "jumlah qty seluruh baris sama dengan yang diminta",
  kartu.reduce((n, k) => n + Number(k.qty), 0) === 40,
);
ok(
  "qty_after baris terakhir sama dengan saldo sebenarnya",
  Number(kartu[kartu.length - 1].qty_after) === 60,
  "kartu stok tetap terbaca sebagai deret yang runtut",
);

// =====================================================================
console.log("\n== 2. Batch tanpa tanggal kadaluarsa ==");
// =====================================================================

const itemB = await buatItem(`${TANDA}-B`);
await terima(itemB, 10, "TANPA-EXP", null);
await terima(itemB, 10, "ADA-EXP", 60);

await potong(itemB, 12);
ok(
  "batch bertanggal kadaluarsa didahulukan",
  (await batchQty(itemB)).join(" ") === "ADA-EXP=0 TANPA-EXP=8",
  "yang tidak diketahui masa berlakunya tidak boleh mendahului yang jelas akan kadaluarsa",
);

// =====================================================================
console.log("\n== 3. Saldo tanpa batch (saldo awal / penerimaan tanpa batch) ==");
// =====================================================================

const itemC = await buatItem(`${TANDA}-C`);
await terima(itemC, 40, null, null); // tanpa batch sama sekali
await terima(itemC, 10, "SATU", 30);

await potong(itemC, 25);
ok(
  "batch dihabiskan lebih dulu, sisanya dari stok tak berbatch",
  (await batchQty(itemC)).join(" ") === "SATU=0",
);
const kartuC = await query<RowDataPacket & { qty: string; batch_id: number | null }>(
  `SELECT qty, batch_id FROM stock_movements
    WHERE site_id=? AND item_id=? AND qty_delta < 0 ORDER BY id`,
  [site, itemC],
);
ok("baris berbatch mencatat 10", Number(kartuC[0].qty) === 10 && kartuC[0].batch_id !== null);
ok(
  "sisanya dicatat tanpa batch, bukan ditolak",
  Number(kartuC[1].qty) === 15 && kartuC[1].batch_id === null,
  "menolaknya akan menghentikan pelayanan demi kerapian pencatatan",
);
ok("saldo akhir benar", (await stok(itemC)) === 25);

// =====================================================================
console.log("\n== 4. Penjaga stok tetap utama ==");
// =====================================================================

const itemD = await buatItem(`${TANDA}-D`);
await terima(itemD, 5, "KECIL", 20);

let pesan = "";
try {
  await potong(itemD, 6);
} catch (e) {
  pesan = e instanceof StokTidakCukupError ? "StokTidakCukupError" : (e as Error).message;
}
ok("pemotongan melebihi saldo tetap ditolak", pesan === "StokTidakCukupError");
ok("stok tidak berubah", (await stok(itemD)) === 5);
ok("batch tidak ikut berkurang saat ditolak", (await batchQty(itemD)).join(" ") === "KECIL=5");

// --- Balapan: 15 pemotongan @2 atas stok 10 ---
const itemE = await buatItem(`${TANDA}-E`);
await terima(itemE, 4, "R1", 10);
await terima(itemE, 6, "R2", 50);

const hasil = await Promise.allSettled(
  Array.from({ length: 15 }, () => potong(itemE, 2)),
);
const sukses = hasil.filter((h) => h.status === "fulfilled").length;
ok("tepat 5 dari 15 pemotongan bersamaan berhasil", sukses === 5, `${sukses} berhasil`);
ok("saldo habis tepat di nol, tidak minus", (await stok(itemE)) === 0);
ok(
  "seluruh batch ikut terkuras habis, tidak tertinggal",
  (await batchQty(itemE)).join(" ") === "R1=0 R2=0",
  "alokasi FEFO ikut terkunci FOR UPDATE",
);

// =====================================================================
console.log("\n== 5. Penarikan batch tertentu (melewati FEFO) ==");
// =====================================================================

const itemF = await buatItem(`${TANDA}-F`);
await terima(itemF, 10, "DEKAT", 5);
await terima(itemF, 10, "JAUH", 500);

const idJauh = Number(
  (await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM item_batches WHERE site_id=? AND item_id=? AND no_batch='JAUH'`,
    [site, itemF],
  ))!.id,
);
await potong(itemF, 4, { jenis: "keluar_kadaluarsa", batchId: idJauh });
ok(
  "batch yang dipaksa berkurang, bukan yang tercepat kadaluarsa",
  (await batchQty(itemF)).join(" ") === "DEKAT=10 JAUH=6",
  "yang dimusnahkan memang batch tertentu",
);

let pesanBatch = "";
try {
  await potong(itemF, 9, { jenis: "keluar_kadaluarsa", batchId: idJauh });
} catch (e) {
  pesanBatch = (e as Error).message;
}
ok(
  "penarikan melebihi isi batch yang dipaksa ditolak",
  pesanBatch.includes("hanya berisi"),
  pesanBatch,
);
ok("penolakan me-rollback seluruhnya", (await stok(itemF)) === 16 && (await batchQty(itemF)).join(" ") === "DEKAT=10 JAUH=6");

// =====================================================================
console.log("\n== 6. Batch kadaluarsa tidak pernah diserahkan ke pasien ==");
// =====================================================================

const itemG = await buatItem(`${TANDA}-G`);
await terima(itemG, 10, "SUDAH-LEWAT", -5); // kadaluarsa 5 hari lalu
await terima(itemG, 10, "MASIH-VALID", 60);

await potong(itemG, 6, { jenis: "keluar_resep" });
ok(
  "resep MELEWATI batch yang sudah kadaluarsa",
  (await batchQty(itemG)).join(" ") === "SUDAH-LEWAT=10 MASIH-VALID=4",
  "FEFO polos justru mendahulukan yang sudah lewat — persis yang paling tidak boleh diserahkan",
);

await potong(itemG, 2, { jenis: "keluar_bmhp" });
ok(
  "BMHP perawat juga melewatinya",
  (await batchQty(itemG)).join(" ") === "SUDAH-LEWAT=10 MASIH-VALID=2",
);

await potong(itemG, 3, { jenis: "keluar_kadaluarsa" });
ok(
  "pemusnahan JUSTRU mengambil yang sudah kadaluarsa",
  (await batchQty(itemG)).join(" ") === "SUDAH-LEWAT=7 MASIH-VALID=2",
  "hanya lewat jalur inilah barang kadaluarsa boleh keluar",
);

await potong(itemG, 1, { jenis: "keluar_opname" });
ok(
  "koreksi opname juga boleh menyentuhnya",
  (await batchQty(itemG)).join(" ") === "SUDAH-LEWAT=6 MASIH-VALID=2",
);

/*
 * Inti keselamatannya: saldo gudang saat ini 8 (2 valid + 6 kadaluarsa).
 * Permintaan 4 untuk pasien HARUS ditolak — memenuhinya berarti diam-diam
 * mengambil 2 unit dari bagian yang batch-nya sudah kadaluarsa.
 */
const stokSebelum = await stok(itemG);
let pesanKadaluarsa = "";
let terkunci = 0;
try {
  await potong(itemG, 4, { jenis: "keluar_resep" });
} catch (e) {
  pesanKadaluarsa = (e as Error).message;
  terkunci = e instanceof StokTidakCukupError ? e.terkunciKadaluarsa : 0;
}
ok("saldo gudang memang masih memuat yang kadaluarsa", stokSebelum === 8);
ok(
  "permintaan yang hanya bisa dipenuhi dari stok kadaluarsa DITOLAK",
  pesanKadaluarsa.includes("tidak boleh diserahkan"),
  pesanKadaluarsa.slice(0, 80),
);
ok("pesan menyebut jumlah yang terkunci", terkunci === 6);
ok("saldo tidak berubah setelah penolakan", (await stok(itemG)) === 8);

// Yang masih layak tetap bisa diserahkan.
await potong(itemG, 2, { jenis: "keluar_resep" });
ok(
  "stok yang masih layak tetap bisa diserahkan",
  (await stok(itemG)) === 6 && (await batchQty(itemG)).join(" ") === "SUDAH-LEWAT=6 MASIH-VALID=0",
);

// Pemusnahan tidak terhalang penguncian itu.
await potong(itemG, 6, { jenis: "keluar_kadaluarsa" });
ok(
  "pemusnahan tetap bisa mengosongkannya",
  (await stok(itemG)) === 0 &&
    (await batchQty(itemG)).join(" ") === "SUDAH-LEWAT=0 MASIH-VALID=0",
);

// =====================================================================
console.log("\n== 7. Invarian: total batch tidak melebihi saldo gudang ==");
// =====================================================================

const timpang = await query<RowDataPacket & { kode: string; batch: string; stok: string }>(
  `SELECT i.kode,
          COALESCE(SUM(b.qty), 0) AS batch,
          MAX(s.qty_on_hand) AS stok
     FROM item_stocks s
     JOIN items i ON i.id = s.item_id
     LEFT JOIN item_batches b ON b.item_id = s.item_id AND b.site_id = s.site_id
    WHERE s.site_id = ?
    GROUP BY s.item_id, i.kode
   HAVING batch > stok`,
  [site],
);
ok(
  "tidak ada item yang total batch-nya melebihi saldo",
  timpang.length === 0,
  timpang.map((t) => `${t.kode}: batch ${t.batch} > stok ${t.stok}`).join("; ") || "seluruhnya konsisten",
);

// =====================================================================
await bersih();
console.log(`\n${gagal === 0 ? "SEMUA UJI LULUS" : `${gagal} UJI GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
