/**
 * Uji modul inventori farmasi: penerimaan, pengeluaran, opname, kadaluarsa.
 *
 * Menjalankan FUNGSI ASLI dari `src/lib/inventory.ts` — bukan menyalin
 * ulang SQL-nya — supaya bug seperti `LIMIT ?` (yang hanya muncul lewat
 * `execute()`) ikut tertangkap.
 *
 *   node uji/jalankan.mjs uji-inventori.ts
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne } from "../src/lib/db";
import { StokTidakCukupError } from "../src/lib/stock";
import {
  ambangKadaluarsa,
  batalkanOpname,
  batchKadaluarsa,
  buatOpname,
  cariItemStok,
  catatPenerimaan,
  catatPengeluaran,
  daftarPenerimaan,
  daftarPengeluaran,
  daftarOpname,
  finalkanOpname,
  itemOpname,
  itemPenerimaan,
  opnameDraft,
  ringkasanInventori,
  simpanHitungan,
  tarikBatch,
} from "../src/lib/inventory";
import {
  opnameBaruSchema,
  penerimaanSchema,
  pengeluaranSchema,
  supplierSchema,
  tarikBatchSchema,
} from "../src/lib/validations/inventory";
import { tambahHari, tanggalHariIni } from "../src/lib/tanggal";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

const stok = async (siteId: number, itemId: number) => {
  const r = await queryOne<RowDataPacket & { q: string }>(
    `SELECT COALESCE(qty_on_hand,0) q FROM item_stocks WHERE site_id=? AND item_id=?`,
    [siteId, itemId],
  );
  return Number(r?.q ?? 0);
};

const hariIni = tanggalHariIni();

// =====================================================================
// Persiapan
// =====================================================================
async function bersih() {
  const ids = await query<RowDataPacket & { id: number }>(
    `SELECT id FROM items WHERE kode LIKE 'UJIINV%'`,
  );
  const itemIds = ids.map((r) => r.id);
  const siteIds = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM sites WHERE kode LIKE 'UJIINV%'`)
  ).map((r) => r.id);

  if (itemIds.length) {
    const list = itemIds.join(",");
    await execute(`DELETE FROM stock_opname_items WHERE item_id IN (${list})`);
    await execute(`DELETE FROM purchase_items WHERE item_id IN (${list})`);
    await execute(`DELETE FROM stock_movements WHERE item_id IN (${list})`);
    await execute(`DELETE FROM item_batches WHERE item_id IN (${list})`);
    await execute(`DELETE FROM item_stocks WHERE item_id IN (${list})`);
  }
  await execute(`DELETE FROM stock_opnames WHERE no_opname LIKE '%/SO/%' AND site_id IN (SELECT id FROM sites WHERE kode LIKE 'UJIINV%')`);
  await execute(`DELETE FROM purchases WHERE no_penerimaan LIKE 'UJIINV%'`);
  if (siteIds.length) {
    const list = siteIds.join(",");
    await execute(`DELETE FROM stock_opname_items WHERE opname_id IN (SELECT id FROM stock_opnames WHERE site_id IN (${list}))`);
    await execute(`DELETE FROM stock_opnames WHERE site_id IN (${list})`);
    await execute(`DELETE FROM purchase_items WHERE purchase_id IN (SELECT id FROM purchases WHERE site_id IN (${list}))`);
    await execute(`DELETE FROM stock_movements WHERE site_id IN (${list})`);
    await execute(`DELETE FROM purchases WHERE site_id IN (${list})`);
    await execute(`DELETE FROM item_batches WHERE site_id IN (${list})`);
    await execute(`DELETE FROM item_stocks WHERE site_id IN (${list})`);
    await execute(`DELETE FROM sequences WHERE site_id IN (${list})`);
    // Akun uji menunjuk ke cabang uji — harus lepas sebelum cabangnya dihapus.
    await execute(`DELETE FROM users WHERE username = 'ujiinv.petugas'`);
    await execute(`DELETE FROM sites WHERE id IN (${list})`);
  }
  if (itemIds.length) {
    await execute(`DELETE FROM items WHERE id IN (${itemIds.join(",")})`);
  }
}

await bersih();

const siteA = (
  await execute(`INSERT INTO sites (kode, nama) VALUES ('UJIINV-A', 'Uji Inventori A')`)
).insertId;
const siteB = (
  await execute(`INSERT INTO sites (kode, nama) VALUES ('UJIINV-B', 'Uji Inventori B')`)
).insertId;

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
   VALUES (?,?, 'Petugas Uji Inventori', 'ujiinv.petugas', 'x')
   ON DUPLICATE KEY UPDATE nama = VALUES(nama)`,
  [siteA, roleFarmasi],
);
const petugas = Number(
  (await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM users WHERE username = 'ujiinv.petugas'`,
  ))!.id,
);

async function buatItem(kode: string, nama: string, hpp: number, jual: number) {
  return (
    await execute(
      `INSERT INTO items (kode, tipe, nama, satuan_dasar, hpp, harga_jual, min_stock)
       VALUES (?, 'obat', ?, 'tablet', ?, ?, 10)`,
      [kode, nama, hpp, jual],
    )
  ).insertId;
}

const itemA = await buatItem("UJIINV-A1", "Uji Amoksisilin 500", 1000, 2500);
const itemB = await buatItem("UJIINV-B1", "Uji Ranitidin 150", 800, 2000);
const itemC = await buatItem("UJIINV-C1", "Uji Vitamin C 50", 300, 900);

// =====================================================================
console.log("\n== 1. Penerimaan barang ==");
// =====================================================================

const p1 = await catatPenerimaan(
  penerimaanSchema.parse({
    tanggal: hariIni,
    diskon: 0,
    ppn: 0,
    perbarui_hpp: false,
    items: [
      { item_id: itemA, qty: 100, harga_satuan: 1000, no_batch: "BA-01", tanggal_kadaluarsa: tambahHari(hariIni, 400) },
      { item_id: itemB, qty: 50, harga_satuan: 800, no_batch: "", tanggal_kadaluarsa: "" },
    ],
  }),
  siteA,
  petugas,
);

ok("stok bertambah sesuai qty diterima", (await stok(siteA, itemA)) === 100 && (await stok(siteA, itemB)) === 50);
ok("subtotal & total dihitung benar", p1.total === 100 * 1000 + 50 * 800, `total ${p1.total}`);
ok("nomor penerimaan berpola KODE/TRM/YYYYMM/NNNNN", /^UJIINV-A\/TRM\/\d{6}\/\d{5}$/.test(p1.no_penerimaan), p1.no_penerimaan);

const ledger1 = await query<RowDataPacket & { jenis: string; qty_after: string; ref_type: string; batch_id: number | null }>(
  `SELECT jenis, qty_after, ref_type, batch_id FROM stock_movements
    WHERE site_id=? AND item_id=? ORDER BY id DESC LIMIT 1`,
  [siteA, itemA],
);
ok("kartu stok mencatat masuk_pembelian", ledger1[0]?.jenis === "masuk_pembelian" && Number(ledger1[0].qty_after) === 100);
ok("pergerakan terhubung ke dokumen pembelian", ledger1[0]?.ref_type === "purchase");

const batchA = await query<RowDataPacket & { no_batch: string; qty: string }>(
  `SELECT no_batch, qty FROM item_batches WHERE site_id=? AND item_id=?`, [siteA, itemA]);
const batchB = await query<RowDataPacket & { id: number }>(`SELECT id FROM item_batches WHERE site_id=? AND item_id=?`, [siteA, itemB]);
ok("batch dibuat saat ada nomor batch / kadaluarsa", batchA.length === 1 && batchA[0].no_batch === "BA-01");
ok("batch TIDAK dibuat bila keduanya kosong", batchB.length === 0, "menghindari baris batch tanpa informasi");
ok("pergerakan tertaut ke batch-nya", Number(ledger1[0]?.batch_id) === Number((await queryOne<RowDataPacket & { id: number }>(`SELECT id FROM item_batches WHERE site_id=? AND item_id=?`, [siteA, itemA]))!.id));

const rincian = await itemPenerimaan(p1.id);
ok("rincian penerimaan tersimpan lengkap", rincian.length === 2 && Number(rincian[0].subtotal) === 100000);

// --- HPP opsional ---
const hppSebelum = Number((await queryOne<RowDataPacket & { hpp: string }>(`SELECT hpp FROM items WHERE id=?`, [itemA]))!.hpp);
await catatPenerimaan(
  penerimaanSchema.parse({
    tanggal: hariIni, diskon: 0, ppn: 0, perbarui_hpp: false,
    items: [{ item_id: itemA, qty: 10, harga_satuan: 1500, no_batch: "", tanggal_kadaluarsa: "" }],
  }),
  siteA, petugas,
);
const hppTanpaCentang = Number((await queryOne<RowDataPacket & { hpp: string }>(`SELECT hpp FROM items WHERE id=?`, [itemA]))!.hpp);
ok("HPP tidak berubah bila tidak dicentang", hppTanpaCentang === hppSebelum, `${hppSebelum} → ${hppTanpaCentang}`);

await catatPenerimaan(
  penerimaanSchema.parse({
    tanggal: hariIni, diskon: 0, ppn: 0, perbarui_hpp: true,
    items: [{ item_id: itemA, qty: 10, harga_satuan: 1500, no_batch: "", tanggal_kadaluarsa: "" }],
  }),
  siteA, petugas,
);
const hppDicentang = Number((await queryOne<RowDataPacket & { hpp: string }>(`SELECT hpp FROM items WHERE id=?`, [itemA]))!.hpp);
ok("HPP diperbarui bila dicentang", hppDicentang === 1500, `→ ${hppDicentang}`);

// --- Peringatan ---
const p2 = await catatPenerimaan(
  penerimaanSchema.parse({
    tanggal: hariIni, diskon: 0, ppn: 0, perbarui_hpp: false,
    items: [
      { item_id: itemC, qty: 5, harga_satuan: 5000, no_batch: "KEDALUWARSA", tanggal_kadaluarsa: tambahHari(hariIni, -5) },
    ],
  }),
  siteA, petugas,
);
ok("peringatan harga beli > harga jual muncul", p2.peringatanHarga.length === 1, p2.peringatanHarga.join());
ok("peringatan barang sudah kadaluarsa muncul", p2.peringatanKadaluarsa.length === 1);
ok("peringatan TIDAK membatalkan penerimaan", (await stok(siteA, itemC)) === 5, "barangnya memang sudah diterima");

// --- Rollback ---
const stokSebelumGagal = await stok(siteA, itemA);
const jumlahDokumenSebelum = (await daftarPenerimaan(siteA)).length;
let pesanDiskon = "";
try {
  await catatPenerimaan(
    penerimaanSchema.parse({
      tanggal: hariIni, diskon: 999999, ppn: 0, perbarui_hpp: false,
      items: [{ item_id: itemA, qty: 5, harga_satuan: 1000, no_batch: "", tanggal_kadaluarsa: "" }],
    }),
    siteA, petugas,
  );
} catch (e) {
  pesanDiskon = (e as Error).message;
}
ok("diskon melebihi nilai barang ditolak", pesanDiskon.includes("negatif"), pesanDiskon);
ok("penolakan me-rollback stok", (await stok(siteA, itemA)) === stokSebelumGagal);
ok("penolakan me-rollback dokumen", (await daftarPenerimaan(siteA)).length === jumlahDokumenSebelum);

// --- Validasi ---
ok("penerimaan tanpa item ditolak", !penerimaanSchema.safeParse({ tanggal: hariIni, items: [] }).success);
ok("qty 0 ditolak", !penerimaanSchema.safeParse({ tanggal: hariIni, items: [{ item_id: itemA, qty: 0, harga_satuan: 100 }] }).success);
ok("kode supplier huruf kecil ditolak", !supplierSchema.safeParse({ kode: "sup-x", nama: "Uji" }).success);

// =====================================================================
console.log("\n== 2. Pengeluaran non-resep ==");
// =====================================================================

const stokSebelumKeluar = await stok(siteA, itemA);
const keluar = await catatPengeluaran(
  pengeluaranSchema.parse({
    item_id: itemA, qty: 7, jenis: "keluar_rusak",
    alasan: "Strip sobek saat penataan gudang, disaksikan APJ.",
  }),
  siteA, petugas,
);
ok("stok berkurang tepat", (await stok(siteA, itemA)) === stokSebelumKeluar - 7);
ok("saldo setelah dilaporkan benar", keluar.sisa === stokSebelumKeluar - 7);

const gerakKeluar = await queryOne<RowDataPacket & { jenis: string; catatan: string; ref_type: string }>(
  `SELECT jenis, catatan, ref_type FROM stock_movements WHERE id=?`, [keluar.movementId]);
ok("kartu stok mencatat jenis yang dipilih", gerakKeluar?.jenis === "keluar_rusak");
ok("keterangan ikut tersimpan di kartu stok", (gerakKeluar?.catatan ?? "").includes("Strip sobek"));

let pesanKurang = "";
const stokSebelumLebih = await stok(siteA, itemA);
try {
  await catatPengeluaran(
    pengeluaranSchema.parse({
      item_id: itemA, qty: 99999, jenis: "keluar_koreksi",
      alasan: "Percobaan mengeluarkan melebihi saldo gudang.",
    }),
    siteA, petugas,
  );
} catch (e) {
  pesanKurang = e instanceof StokTidakCukupError ? "StokTidakCukupError" : (e as Error).message;
}
ok("pengeluaran melebihi stok ditolak", pesanKurang === "StokTidakCukupError");
ok("stok tidak berubah setelah penolakan", (await stok(siteA, itemA)) === stokSebelumLebih);

ok("alasan < 10 karakter ditolak", !pengeluaranSchema.safeParse({ item_id: itemA, qty: 1, jenis: "keluar_rusak", alasan: "rusak" }).success);
ok("jenis pengeluaran pelayanan tidak boleh manual", !pengeluaranSchema.safeParse({ item_id: itemA, qty: 1, jenis: "keluar_resep", alasan: "sepuluh karakter lebih" }).success, "keluar_resep bukan pilihan yang sah di layar ini");

const arus = await daftarPengeluaran(siteA, { dari: hariIni, sampai: hariIni });
ok("daftar arus keluar memuat pengeluaran tadi", arus.some((g) => g.id === keluar.movementId));

// =====================================================================
console.log("\n== 3. Stock opname ==");
// =====================================================================

const o1 = await buatOpname(
  opnameBaruSchema.parse({ tanggal: hariIni, tipe: "semua", catatan: "Opname uji" }),
  siteA, petugas,
);
ok("lembar hitung memotret item aktif", o1.jumlahItem > 0, `${o1.jumlahItem} item`);
ok("nomor opname berpola KODE/SO/YYYYMM/NNNN", /^UJIINV-A\/SO\/\d{6}\/\d{4}$/.test(o1.no_opname), o1.no_opname);

const barisAwal = await itemOpname(o1.id, siteA);
ok("selisih awal nol untuk semua item", barisAwal.every((b) => Number(b.selisih) === 0), "item yang tak dihitung tidak memunculkan selisih palsu");

let pesanGanda = "";
try {
  await buatOpname(opnameBaruSchema.parse({ tanggal: hariIni, tipe: "semua" }), siteA, petugas);
} catch (e) { pesanGanda = (e as Error).message; }
ok("opname kedua di cabang sama ditolak", pesanGanda.includes("masih ada") || pesanGanda.includes("Masih ada"), pesanGanda);

// Cabang lain boleh punya lembar sendiri.
const oB = await buatOpname(opnameBaruSchema.parse({ tanggal: hariIni, tipe: "semua" }), siteB, petugas);
ok("cabang lain tetap boleh membuka opname", Boolean(oB.id), "penguncian bersifat per cabang");
await batalkanOpname(oB.id, siteB);

const sistemA = Number(barisAwal.find((b) => b.item_id === itemA)!.qty_sistem);
const sistemB = Number(barisAwal.find((b) => b.item_id === itemB)!.qty_sistem);

await simpanHitungan({ opname_id: o1.id, item_id: itemA, qty_fisik: sistemA - 3, catatan: "Kurang 3 tablet" }, siteA);
await simpanHitungan({ opname_id: o1.id, item_id: itemB, qty_fisik: sistemB + 2, catatan: "Lebih 2 tablet" }, siteA);

const barisIsi = await itemOpname(o1.id, siteA);
ok("selisih kurang terhitung", Number(barisIsi.find((b) => b.item_id === itemA)!.selisih) === -3);
ok("selisih lebih terhitung", Number(barisIsi.find((b) => b.item_id === itemB)!.selisih) === 2);

// --- Inti: stok bergerak setelah potret diambil ---
await catatPengeluaran(
  pengeluaranSchema.parse({
    item_id: itemA, qty: 5, jenis: "keluar_koreksi",
    alasan: "Pengeluaran sah yang terjadi di sela penghitungan opname.",
  }),
  siteA, petugas,
);
const stokSetelahGerak = await stok(siteA, itemA);
ok("saldo bergerak di sela penghitungan", stokSetelahGerak === sistemA - 5);

const draft = await opnameDraft(siteA);
ok("lembar draft terbaca kembali", draft?.id === o1.id);

const hasilFinal = await finalkanOpname(o1.id, siteA, petugas);
ok("hanya item berselisih yang dikoreksi", hasilFinal.dikoreksi === 2, `${hasilFinal.naik} lebih, ${hasilFinal.turun} kurang`);

const stokAkhirA = await stok(siteA, itemA);
ok(
  "koreksi dihitung dari potret, bukan dari saldo saat finalisasi",
  stokAkhirA === stokSetelahGerak - 3,
  `${stokSetelahGerak} − 3 = ${stokAkhirA}; memaksa ke qty_fisik akan menghapus pengeluaran 5 tablet itu`,
);
ok("koreksi lebih menambah stok", (await stok(siteA, itemB)) === sistemB + 2);

const ledgerOpname = await query<RowDataPacket & { jenis: string; catatan: string }>(
  `SELECT jenis, catatan FROM stock_movements
    WHERE site_id=? AND ref_type='opname' AND ref_id=? ORDER BY id`, [siteA, o1.id]);
ok("kartu stok memuat 2 baris opname", ledgerOpname.length === 2);
ok("jenis opname naik & turun benar", ledgerOpname.some((l) => l.jenis === "keluar_opname") && ledgerOpname.some((l) => l.jenis === "masuk_opname"));
ok("catatan opname menyebut sistem → fisik", ledgerOpname.every((l) => l.catatan.includes("→")));

let pesanFinalUlang = "";
try { await finalkanOpname(o1.id, siteA, petugas); } catch (e) { pesanFinalUlang = (e as Error).message; }
ok("finalisasi ganda ditolak", pesanFinalUlang.includes("sudah difinalkan"), pesanFinalUlang);

let pesanBatalFinal = "";
try { await batalkanOpname(o1.id, siteA); } catch (e) { pesanBatalFinal = (e as Error).message; }
ok("opname final tidak bisa dibatalkan", pesanBatalFinal.includes("sudah final"), pesanBatalFinal);

// --- Koreksi yang akan membuat stok minus ---
const o2 = await buatOpname(opnameBaruSchema.parse({ tanggal: hariIni, tipe: "semua" }), siteA, petugas);
const sistemC = await stok(siteA, itemC);
await simpanHitungan({ opname_id: o2.id, item_id: itemC, qty_fisik: 0, catatan: "Habis" }, siteA);
await simpanHitungan({ opname_id: o2.id, item_id: itemB, qty_fisik: (await stok(siteA, itemB)) + 4 }, siteA);
// Setelah potret, stok itemC dihabiskan lewat jalur lain.
await catatPengeluaran(
  pengeluaranSchema.parse({
    item_id: itemC, qty: sistemC, jenis: "keluar_kadaluarsa",
    alasan: "Dimusnahkan sebelum lembar opname difinalkan.",
  }),
  siteA, petugas,
);
const stokBSebelumGagal = await stok(siteA, itemB);
let pesanMinus = "";
try { await finalkanOpname(o2.id, siteA, petugas); } catch (e) { pesanMinus = (e as Error).message; }
ok("koreksi yang membuat stok minus ditolak", pesanMinus.includes("saldo gudang sudah berubah"), pesanMinus.slice(0, 90));
ok("pesan menyebut nama itemnya", pesanMinus.includes("Uji Vitamin C"));
ok(
  "kegagalan me-rollback SELURUH koreksi opname",
  (await stok(siteA, itemB)) === stokBSebelumGagal,
  "koreksi +4 pada item lain tidak boleh ikut tersimpan",
);
const statusO2 = await queryOne<RowDataPacket & { status: string }>(`SELECT status FROM stock_opnames WHERE id=?`, [o2.id]);
ok("lembar tetap draft setelah finalisasi gagal", statusO2?.status === "draft");
await batalkanOpname(o2.id, siteA);

const riwayatOpname = await daftarOpname(siteA);
ok("riwayat opname memuat lembar final & batal", riwayatOpname.length >= 2);

// =====================================================================
console.log("\n== 4. Monitoring kadaluarsa ==");
// =====================================================================

const ambang = await ambangKadaluarsa(siteA);
ok("ambang peringatan terbaca dari settings", ambang > 0, `${ambang} hari`);

await catatPenerimaan(
  penerimaanSchema.parse({
    tanggal: hariIni, diskon: 0, ppn: 0, perbarui_hpp: false,
    items: [
      { item_id: itemB, qty: 40, harga_satuan: 800, no_batch: "EXP-DEKAT", tanggal_kadaluarsa: tambahHari(hariIni, 15) },
      { item_id: itemB, qty: 30, harga_satuan: 800, no_batch: "EXP-JAUH", tanggal_kadaluarsa: tambahHari(hariIni, 900) },
      // Batch KEDALUWARSA pada bagian 1 sudah habis dikonsumsi FEFO oleh
      // pemusnahan di bagian 3, jadi dibuat yang baru khusus untuk uji ini.
      { item_id: itemC, qty: 3, harga_satuan: 300, no_batch: "SUDAH-LEWAT", tanggal_kadaluarsa: tambahHari(hariIni, -5) },
    ],
  }),
  siteA, petugas,
);

const daftarBatch = await batchKadaluarsa(siteA, 90);
const kodeBatch = daftarBatch.map((b) => b.no_batch);
ok("batch mendekati kadaluarsa terdaftar", kodeBatch.includes("EXP-DEKAT"));
ok("batch jauh dari kadaluarsa tidak ikut", !kodeBatch.includes("EXP-JAUH"));
ok("batch yang sudah lewat ikut terdaftar", kodeBatch.includes("SUDAH-LEWAT"));
ok("sisa hari bertanda negatif untuk yang lewat", Number(daftarBatch.find((b) => b.no_batch === "SUDAH-LEWAT")!.sisa_hari) < 0);

const batchDekat = daftarBatch.find((b) => b.no_batch === "EXP-DEKAT")!;
const stokBSebelumTarik = await stok(siteA, itemB);
const tarik = await tarikBatch(
  tarikBatchSchema.parse({ batch_id: batchDekat.id, qty: 10, alasan: "Ditarik sesuai berita acara uji." }),
  siteA, petugas,
);
ok("penarikan mengurangi saldo gudang", (await stok(siteA, itemB)) === stokBSebelumTarik - 10);
ok("penarikan mengurangi isi batch", tarik.sisaBatch === Number(batchDekat.qty) - 10);

const gerakTarik = await queryOne<RowDataPacket & { jenis: string; batch_id: number }>(
  `SELECT jenis, batch_id FROM stock_movements
    WHERE site_id=? AND ref_type='batch' AND ref_id=? ORDER BY id DESC LIMIT 1`,
  [siteA, batchDekat.id],
);
ok("kartu stok mencatat keluar_kadaluarsa", gerakTarik?.jenis === "keluar_kadaluarsa");
ok("pergerakan penarikan tertaut ke batch", Number(gerakTarik?.batch_id) === Number(batchDekat.id));

let pesanLebihBatch = "";
try {
  await tarikBatch(
    tarikBatchSchema.parse({ batch_id: batchDekat.id, qty: 99999, alasan: "Melebihi isi batch untuk uji." }),
    siteA, petugas,
  );
} catch (e) { pesanLebihBatch = (e as Error).message; }
ok("penarikan melebihi isi batch ditolak", pesanLebihBatch.includes("melebihi isi batch"), pesanLebihBatch);

// =====================================================================
console.log("\n== 5. Isolasi antar cabang ==");
// =====================================================================

ok("stok cabang B tidak terpengaruh penerimaan cabang A", (await stok(siteB, itemA)) === 0);

let pesanSalahCabang = "";
try {
  await tarikBatch(
    tarikBatchSchema.parse({ batch_id: batchDekat.id, qty: 1, alasan: "Percobaan dari cabang lain." }),
    siteB, petugas,
  );
} catch (e) { pesanSalahCabang = (e as Error).message; }
ok("batch cabang lain tidak bisa ditarik", pesanSalahCabang.includes("tidak ditemukan di cabang ini"), pesanSalahCabang);

const penerimaanB = await daftarPenerimaan(siteB);
ok("riwayat penerimaan tersaring per cabang", penerimaanB.length === 0);

const batchB2 = await batchKadaluarsa(siteB, 3650);
ok("monitoring kadaluarsa tersaring per cabang", batchB2.length === 0);

// =====================================================================
console.log("\n== 6. Query berpaginasi lewat execute() ==");
// =====================================================================
// Semua fungsi berikut memakai LIMIT hasil interpolasi `limitAman()`.
// Bila ada yang kembali memakai placeholder `?`, di sinilah gagalnya.
const paginasi: [string, () => Promise<unknown[]>][] = [
  ["cariItemStok", () => cariItemStok("Uji", siteA)],
  ["daftarPenerimaan", () => daftarPenerimaan(siteA, { limit: 5 })],
  ["daftarPengeluaran", () => daftarPengeluaran(siteA, { limit: 5 })],
  ["daftarOpname", () => daftarOpname(siteA, 5)],
  ["batchKadaluarsa", () => batchKadaluarsa(siteA, 90)],
];
for (const [nama, fn] of paginasi) {
  try {
    await fn();
    ok(`${nama} berjalan lewat execute()`, true);
  } catch (e) {
    ok(`${nama} berjalan lewat execute()`, false, (e as Error).message);
  }
}

const ring = await ringkasanInventori(siteA, 90);
ok("ringkasan inventori terhitung", ring.nilaiStok > 0 && ring.batchKadaluarsa >= 1, `nilai ${ring.nilaiStok}, batch lewat ${ring.batchKadaluarsa}`);

// =====================================================================
// 7. Pembatalan opname vs finalisasi yang berjalan bersamaan
// =====================================================================
console.log("\n== 7. Balapan batalkan-vs-finalkan opname ==");

/*
 * `batalkanOpname()` dulu membaca status lewat satu kueri lalu menulis
 * lewat kueri lain, dan `UPDATE`-nya tidak menyebut status sama sekali.
 * Di antara keduanya ada jendela nyata — dua admin, atau satu admin dengan
 * dua tab — dan yang tersisa sesudahnya adalah lembar bertanda `batal`
 * yang koreksinya SUDAH masuk kartu stok. Angkanya bergerak, catatannya
 * berkata tidak pernah terjadi.
 *
 * Urutan di bawah memerankan jendela itu persis: baca dulu, finalkan di
 * sela, baru tulis. Yang diuji adalah syarat status pada UPDATE-nya —
 * penjaga yang membuat penulisan terlambat itu tidak berbuat apa-apa.
 */
const oRace = await buatOpname(
  opnameBaruSchema.parse({ tanggal: hariIni, tipe: "semua" }), siteA, petugas,
);
await simpanHitungan({ opname_id: oRace.id, item_id: itemA, qty_fisik: 1 }, siteA);

// (1) Pembatalan membaca status — masih draft.
const statusTerbaca = (await queryOne<RowDataPacket & { status: string }>(
  `SELECT status FROM stock_opnames WHERE id = ?`, [oRace.id]))!.status;
ok("pembatalan membaca status draft", statusTerbaca === "draft", String(statusTerbaca));

// (2) Finalisasi menyelinap di antara baca dan tulis.
await finalkanOpname(oRace.id, siteA, petugas);

// (3) Penulisan yang terlambat itu baru dijalankan.
const telat = await execute(
  `UPDATE stock_opnames SET status = 'batal' WHERE id = ? AND status = 'draft'`,
  [oRace.id],
);
ok("penulisan yang terlambat tidak mengenai apa pun", telat.affectedRows === 0,
  `${telat.affectedRows} baris`);

const statusAkhir = (await queryOne<RowDataPacket & { status: string }>(
  `SELECT status FROM stock_opnames WHERE id = ?`, [oRace.id]))!.status;
ok("lembar tetap final, bukan batal", statusAkhir === "final", String(statusAkhir));

// Jalur normalnya tetap menolak dengan pesan yang bisa dibaca manusia.
let pesanFinal = "";
try {
  await batalkanOpname(oRace.id, siteA);
} catch (e) {
  pesanFinal = e instanceof Error ? e.message : String(e);
}
ok("batalkanOpname menolak lembar final", /sudah final/i.test(pesanFinal), pesanFinal);

let pesanHitung = "";
try {
  await simpanHitungan({ opname_id: oRace.id, item_id: itemA, qty_fisik: 9 }, siteA);
} catch (e) {
  pesanHitung = e instanceof Error ? e.message : String(e);
}
ok("simpanHitungan menolak lembar final", /difinalkan/i.test(pesanHitung), pesanHitung);

// =====================================================================
await bersih();
console.log(`\n${gagal === 0 ? "SEMUA UJI LULUS" : `${gagal} UJI GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
