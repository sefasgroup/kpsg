import "server-only";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

/**
 * Inti pergerakan stok. SELURUH pemotongan stok di sistem ini wajib lewat
 * sini — BMHP perawat, obat paten, bahan racikan, kadaluarsa, opname.
 *
 * `stock_movements` adalah satu-satunya sumber kebenaran; `item_stocks`
 * hanyalah cache (docs/DATABASE.md §3.3).
 */

export type JenisKeluar =
  | "keluar_resep"
  | "keluar_racikan"
  | "keluar_bmhp"
  | "keluar_kadaluarsa"
  | "keluar_rusak"
  | "keluar_koreksi"
  | "keluar_opname";

export type JenisMasuk =
  | "masuk_pembelian"
  | "masuk_retur"
  | "masuk_koreksi"
  | "masuk_opname";

export class StokTidakCukupError extends Error {
  constructor(
    readonly namaItem: string,
    readonly tersedia: number,
    readonly diminta: number,
    /** Bagian dari saldo yang terkunci karena batch-nya sudah kadaluarsa. */
    readonly terkunciKadaluarsa = 0,
    /** Bagian yang dikunci resep pasien lain yang menunggu bayar/diambil. */
    readonly terkunciReservasi = 0,
  ) {
    /*
     * Dua sebab berbeda, dua kalimat berbeda — dan keduanya bisa muncul
     * bersamaan. Menyatukannya pernah membuat pesan menyalahkan batch
     * kadaluarsa untuk stok yang sebenarnya dikunci resep pasien lain;
     * apoteker lalu mencarinya di Monitoring Kadaluarsa dan tidak menemukan
     * apa pun. Tindak lanjut kedua sebab itu sama sekali tidak sama.
     */
    const sebab: string[] = [];
    if (terkunciKadaluarsa > 0) {
      sebab.push(
        `${terkunciKadaluarsa} unit ada di gudang tetapi batch-nya sudah ` +
        `kadaluarsa dan tidak boleh diserahkan — tarik lewat Monitoring Kadaluarsa`,
      );
    }
    if (terkunciReservasi > 0) {
      sebab.push(
        `${terkunciReservasi} unit dikunci resep pasien lain yang sudah ` +
        `divalidasi dan menunggu dibayar atau diambil`,
      );
    }

    super(
      sebab.length > 0
        ? `Stok ${namaItem} tidak cukup — ${tersedia} tersedia untuk pasien, ` +
          `diminta ${diminta}. ${sebab.join("; ")}.`
        : `Stok ${namaItem} tidak cukup — tersedia ${tersedia}, diminta ${diminta}.`,
    );
    this.name = "StokTidakCukupError";
  }
}

type ItemInfo = RowDataPacket & {
  id: number;
  nama: string;
  satuan_dasar: string;
  hpp: string;
  harga_jual: string;
};

export async function getItemInfo(
  conn: PoolConnection,
  itemId: number,
): Promise<ItemInfo> {
  const [rows] = await conn.execute<ItemInfo[]>(
    `SELECT id, nama, satuan_dasar, hpp, harga_jual FROM items WHERE id = ?`,
    [itemId],
  );
  if (!rows[0]) throw new Error(`Item #${itemId} tidak ditemukan.`);
  return rows[0];
}

/**
 * Jenis pengeluaran yang barangnya diserahkan ke / dipakai pada PASIEN.
 *
 * Pemisahan ini menentukan keselamatan: batch yang sudah lewat tanggal
 * kadaluarsa tidak boleh ikut dialokasikan untuk jalur-jalur ini.
 */
const UNTUK_PASIEN: readonly JenisKeluar[] = [
  "keluar_resep",
  "keluar_racikan",
  "keluar_bmhp",
];

/**
 * Alokasi FEFO: membagi `qty` ke batch-batch yang paling cepat kadaluarsa.
 *
 * Baris batch dikunci `FOR UPDATE` dengan urutan yang SAMA di setiap
 * pemanggilan (kadaluarsa terdekat dulu, lalu id) supaya dua transaksi yang
 * memotong item sama tidak saling mengunci silang.
 *
 * Batch tanpa tanggal kadaluarsa diletakkan paling belakang: yang tidak
 * diketahui masa berlakunya tidak boleh mendahului yang jelas-jelas akan
 * kadaluarsa lebih dulu.
 *
 * ==========================================================================
 * BATCH YANG SUDAH KADALUARSA TIDAK PERNAH DIALOKASIKAN UNTUK PASIEN.
 *
 * FEFO polos justru mendahulukan yang sudah lewat — persis barang yang
 * paling tidak boleh diserahkan. Untuk `keluar_resep`, `keluar_racikan`,
 * dan `keluar_bmhp`, batch kadaluarsa dilewati; ia hanya bisa keluar lewat
 * pemusnahan (`keluar_kadaluarsa`), pencatatan rusak, atau koreksi opname.
 * ==========================================================================
 */
async function alokasiFefo(
  conn: PoolConnection,
  siteId: number,
  itemId: number,
  qty: number,
  jenis: JenisKeluar,
  batchId?: number | null,
): Promise<{ batchId: number | null; qty: number; hpp: number | null }[]> {
  const untukPasien = UNTUK_PASIEN.includes(jenis);

  /*
   * Selain pemusnahan kadaluarsa, batch yang MASIH BERLAKU didahulukan dan
   * batch kadaluarsa hanya dipakai bila yang berlaku sudah habis.
   *
   * Dulu kadaluarsa selalu di depan untuk pengeluaran non-pasien. Mencatat
   * 3 kasa rusak dari batch yang masih baik lalu memotong batch kadaluarsa:
   * angka "terkunci kadaluarsa" menyusut padahal barang kadaluarsanya masih
   * di rak, sehingga stok TERSEDIA untuk pasien tampak lebih besar dari
   * barang layak yang sungguh ada — dan resep bisa lolos untuk barang yang
   * hanya bisa diambil dari stok kadaluarsa.
   */
  const kadaluarsaDulu = jenis === "keluar_kadaluarsa";
  const [batch] = await conn.execute<RowDataPacket[]>(
    `SELECT id, qty, hpp FROM item_batches
      WHERE site_id = ? AND item_id = ? AND qty > 0
        AND (? IS NULL OR id = ?)
        AND (? = 0 OR tanggal_kadaluarsa IS NULL OR tanggal_kadaluarsa >= CURDATE())
      ORDER BY (tanggal_kadaluarsa IS NOT NULL AND tanggal_kadaluarsa < CURDATE())
                 ${kadaluarsaDulu ? "DESC" : "ASC"},
               tanggal_kadaluarsa IS NULL, tanggal_kadaluarsa, id
      FOR UPDATE`,
    [siteId, itemId, batchId ?? null, batchId ?? null, untukPasien ? 1 : 0],
  );

  const alokasi: { batchId: number | null; qty: number; hpp: number | null }[] = [];
  let sisa = qty;

  for (const b of batch) {
    if (sisa <= 0) break;
    const ambil = Math.min(sisa, Number(b.qty));
    if (ambil <= 0) continue;
    await conn.execute(`UPDATE item_batches SET qty = qty - ? WHERE id = ?`, [
      ambil,
      b.id,
    ]);
    alokasi.push({ batchId: Number(b.id), qty: ambil, hpp: Number(b.hpp) });
    sisa -= ambil;
  }

  /*
   * Sisa yang tidak tertutup batch tetap dipotong dan dicatat dengan
   * `batch_id` NULL. Ini bukan kelalaian: saldo awal implementasi dan
   * penerimaan tanpa nomor batch memang tidak punya batch, dan menolak
   * pemotongannya akan menghentikan pelayanan demi kerapian pencatatan.
   */
  if (sisa > 0) {
    // Bila batch dipaksa, kekurangan berarti pemanggil salah hitung —
    // menutupnya dari stok tak berbatch akan memusnahkan barang dari batch
    // lain tanpa ada yang tahu.
    if (batchId) {
      throw new Error(
        `Batch #${batchId} hanya berisi ${qty - sisa}, diminta ${qty}.`,
      );
    }
    alokasi.push({ batchId: null, qty: sisa, hpp: null });
  }

  return alokasi;
}

/**
 * Mengurangi stok dan mencatat kartu stok. Mengembalikan id stock_movements
 * sebagai bukti pemotongan — kolom `stock_movement_id` di tabel pemakai
 * (nurse_bmhp_usage, prescription_items, …) diisi dari sini. NULL di kolom
 * itu berarti stok belum dipotong, sehingga status "sudah disiapkan"
 * tidak bisa dipalsukan.
 *
 * Pemotongan mengonsumsi batch secara FEFO (*first expired, first out*).
 * Bila pemotongan menghabiskan lebih dari satu batch, kartu stok memuat
 * SATU BARIS PER BATCH — jumlah `qty_delta`-nya tetap sama dengan yang
 * diminta, jadi rekonsiliasi tidak berubah. Yang dikembalikan adalah id
 * baris pertama; sebagai bukti pemotongan itu sudah cukup, dan menyimpan
 * seluruh id memerlukan tabel alokasi tersendiri yang belum sepadan.
 *
 * `batchId` memaksa pemotongan dari satu batch tertentu — dipakai saat
 * menarik batch kadaluarsa, di mana yang dimusnahkan justru batch tertentu,
 * bukan yang paling cepat kadaluarsa.
 *
 * Stok batch kadaluarsa tetap TERCATAT di `item_stocks` sampai ditarik
 * lewat layar Monitoring Kadaluarsa, tetapi tidak dihitung sebagai
 * tersedia untuk pasien — pemotongan untuk resep/racikan/BMHP akan ditolak
 * bila hanya bisa dipenuhi dari bagian yang kadaluarsa itu, dan pesannya
 * menyebutkan berapa banyak yang terkunci.
 *
 * Harus dipanggil di dalam transaksi.
 */
export async function kurangiStok(
  conn: PoolConnection,
  opts: {
    siteId: number;
    itemId: number;
    qty: number;
    jenis: JenisKeluar;
    refType: string;
    refId?: number | null;
    userId: number;
    catatan?: string | null;
    /** Paksa dari batch ini saja (lewati FEFO). */
    batchId?: number | null;
    /**
     * Jumlah ini sudah dikunci lebih dulu lewat `reservasiStok()`. Pemanggil
     * WAJIB melepas reservasinya di transaksi yang sama.
     */
    dariReservasi?: boolean;
  },
): Promise<number> {
  if (opts.qty <= 0) throw new Error("Jumlah pemakaian harus lebih dari 0.");

  const item = await getItemInfo(conn, opts.itemId);

  // Pastikan baris saldo ada, lalu kunci barisnya.
  await conn.execute(
    `INSERT INTO item_stocks (site_id, item_id, qty_on_hand) VALUES (?, ?, 0)
     ON DUPLICATE KEY UPDATE site_id = site_id`,
    [opts.siteId, opts.itemId],
  );

  /*
   * Saldo yang batch-nya sudah kadaluarsa TIDAK BOLEH dihitung sebagai
   * tersedia untuk pasien. Tanpa ini, farmasi bisa menyerahkan lebih banyak
   * daripada barang layak yang benar-benar ada: sisanya diam-diam diambil
   * dari bagian tak berbatch, sementara barang kadaluarsanya tetap
   * menumpuk di gudang.
   */
  const terkunci = UNTUK_PASIEN.includes(opts.jenis)
    ? Number(
        (
          await conn.execute<RowDataPacket[]>(
            `SELECT COALESCE(SUM(qty), 0) AS q FROM item_batches
              WHERE site_id = ? AND item_id = ? AND qty > 0
                AND tanggal_kadaluarsa IS NOT NULL
                AND tanggal_kadaluarsa < CURDATE()`,
            [opts.siteId, opts.itemId],
          )
        )[0][0]?.q ?? 0,
      )
    : 0;

  /*
   * Pengurangan bersyarat dalam satu perintah mencegah stok minus tanpa
   * perlu SELECT-lalu-UPDATE yang rawan balapan. Bila dua petugas memotong
   * item yang sama bersamaan, salah satunya pasti gagal di sini, bukan
   * menghasilkan saldo negatif.
   *
   * Ini tetap penjaga utamanya. Alokasi batch di bawah hanya membagi
   * jumlah yang SUDAH dipastikan tersedia — bukan sumber jaminannya.
   */
  /*
   * `dariReservasi` dipakai saat obat yang stoknya SUDAH dikunci akhirnya
   * diserahkan. Jumlah itu memang miliknya, jadi tidak boleh diuji lagi
   * terhadap `qty_reserved` — kalau diuji, resep yang mereservasi seluruh
   * sisa stok justru gagal menyerahkannya sendiri.
   */
  const cadangan = opts.dariReservasi ? 0 : 1;

  const [upd] = await conn.execute<ResultSetHeader>(
    `UPDATE item_stocks SET qty_on_hand = qty_on_hand - ?
      WHERE site_id = ? AND item_id = ?
        AND qty_on_hand >= ? + ? + (qty_reserved * ?)`,
    [opts.qty, opts.siteId, opts.itemId, opts.qty, terkunci, cadangan],
  );

  if (upd.affectedRows === 0) {
    const [saldo] = await conn.execute<RowDataPacket[]>(
      `SELECT qty_on_hand, qty_reserved FROM item_stocks
        WHERE site_id = ? AND item_id = ?`,
      [opts.siteId, opts.itemId],
    );
    const direservasi = Number(saldo[0]?.qty_reserved ?? 0) * cadangan;
    throw new StokTidakCukupError(
      item.nama,
      Math.max(0, Number(saldo[0]?.qty_on_hand ?? 0) - terkunci - direservasi),
      opts.qty,
      terkunci,
      direservasi,
    );
  }

  const [after] = await conn.execute<RowDataPacket[]>(
    `SELECT qty_on_hand FROM item_stocks WHERE site_id = ? AND item_id = ?`,
    [opts.siteId, opts.itemId],
  );
  const qtyAkhir = Number(after[0].qty_on_hand);

  const alokasi = await alokasiFefo(
    conn,
    opts.siteId,
    opts.itemId,
    opts.qty,
    opts.jenis,
    opts.batchId,
  );

  // `qty_after` menurun berurutan sehingga baris terakhir sama dengan saldo
  // sebenarnya — kartu stok tetap terbaca sebagai satu deret yang runtut.
  let berjalan = qtyAkhir + opts.qty;
  let idPertama = 0;

  for (const a of alokasi) {
    berjalan -= a.qty;
    const [mov] = await conn.execute<ResultSetHeader>(
      `INSERT INTO stock_movements
         (site_id, item_id, batch_id, jenis, qty, qty_delta, qty_after, hpp,
          ref_type, ref_id, catatan, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        opts.siteId, opts.itemId, a.batchId, opts.jenis,
        a.qty, -a.qty, berjalan, a.hpp ?? item.hpp,
        opts.refType, opts.refId ?? null, opts.catatan ?? null, opts.userId,
      ],
    );
    if (!idPertama) idPertama = mov.insertId;
  }

  return idPertama;
}

/**
 * Mengunci stok untuk resep yang sudah divalidasi farmasi.
 *
 * `qty_on_hand` TIDAK berkurang — barangnya masih di rak dan belum diserahkan
 * ke siapa pun. Yang berkurang adalah jumlah yang boleh dijanjikan kepada
 * pasien LAIN. Tanpa ini, pasien yang sudah membayar bisa menemukan obatnya
 * sudah habis terpakai resep berikutnya, dan uangnya harus dikembalikan.
 *
 * Batch kadaluarsa ikut diperhitungkan sebagai tidak tersedia, sama seperti
 * pada `kurangiStok()` — kalau tidak, reservasi bisa berhasil untuk barang
 * yang nanti gagal diserahkan.
 *
 * Harus dipanggil di dalam transaksi.
 */
export async function reservasiStok(
  conn: PoolConnection,
  opts: { siteId: number; itemId: number; qty: number },
): Promise<void> {
  if (opts.qty <= 0) throw new Error("Jumlah reservasi harus lebih dari 0.");

  const item = await getItemInfo(conn, opts.itemId);

  await conn.execute(
    `INSERT INTO item_stocks (site_id, item_id, qty_on_hand) VALUES (?, ?, 0)
     ON DUPLICATE KEY UPDATE site_id = site_id`,
    [opts.siteId, opts.itemId],
  );

  const [kadaluarsa] = await conn.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(qty), 0) AS q FROM item_batches
      WHERE site_id = ? AND item_id = ? AND qty > 0
        AND tanggal_kadaluarsa IS NOT NULL AND tanggal_kadaluarsa < CURDATE()`,
    [opts.siteId, opts.itemId],
  );
  const terkunci = Number(kadaluarsa[0]?.q ?? 0);

  // Bersyarat dalam satu perintah — dua petugas yang memvalidasi resep atas
  // item yang sama secara bersamaan tidak bisa sama-sama berhasil.
  const [upd] = await conn.execute<ResultSetHeader>(
    `UPDATE item_stocks SET qty_reserved = qty_reserved + ?
      WHERE site_id = ? AND item_id = ?
        AND qty_on_hand - qty_reserved >= ? + ?`,
    [opts.qty, opts.siteId, opts.itemId, opts.qty, terkunci],
  );

  if (upd.affectedRows === 0) {
    const [saldo] = await conn.execute<RowDataPacket[]>(
      `SELECT qty_on_hand, qty_reserved FROM item_stocks
        WHERE site_id = ? AND item_id = ?`,
      [opts.siteId, opts.itemId],
    );
    const direservasi = Number(saldo[0]?.qty_reserved ?? 0);
    throw new StokTidakCukupError(
      item.nama,
      Math.max(0, Number(saldo[0]?.qty_on_hand ?? 0) - terkunci - direservasi),
      opts.qty,
      terkunci,
      direservasi,
    );
  }
}

/**
 * Melepas kunci stok — saat obat jadi diserahkan, atau saat resepnya
 * dibatalkan/dikembalikan ke dokter.
 *
 * Dibatasi pada nilai yang benar-benar terkunci (`LEAST`) supaya pelepasan
 * yang terlanjur dipanggil dua kali tidak membuat `qty_reserved` negatif.
 */
export async function lepasReservasi(
  conn: PoolConnection,
  opts: { siteId: number; itemId: number; qty: number },
): Promise<void> {
  if (opts.qty <= 0) return;
  await conn.execute(
    `UPDATE item_stocks
        SET qty_reserved = GREATEST(0, qty_reserved - ?)
      WHERE site_id = ? AND item_id = ?`,
    [opts.qty, opts.siteId, opts.itemId],
  );
}

/** Menambah stok (penerimaan, retur, koreksi). Harus di dalam transaksi. */
export async function tambahStok(
  conn: PoolConnection,
  opts: {
    siteId: number;
    itemId: number;
    qty: number;
    jenis: JenisMasuk;
    hpp?: number | null;
    batchId?: number | null;
    refType: string;
    refId?: number | null;
    userId: number;
    catatan?: string | null;
  },
): Promise<number> {
  if (opts.qty <= 0) throw new Error("Jumlah penerimaan harus lebih dari 0.");

  const item = await getItemInfo(conn, opts.itemId);

  await conn.execute(
    `INSERT INTO item_stocks (site_id, item_id, qty_on_hand) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE qty_on_hand = qty_on_hand + VALUES(qty_on_hand)`,
    [opts.siteId, opts.itemId, opts.qty],
  );

  const [after] = await conn.execute<RowDataPacket[]>(
    `SELECT qty_on_hand FROM item_stocks WHERE site_id = ? AND item_id = ?`,
    [opts.siteId, opts.itemId],
  );

  const [mov] = await conn.execute<ResultSetHeader>(
    `INSERT INTO stock_movements
       (site_id, item_id, batch_id, jenis, qty, qty_delta, qty_after, hpp,
        ref_type, ref_id, catatan, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      opts.siteId, opts.itemId, opts.batchId ?? null, opts.jenis,
      opts.qty, opts.qty, Number(after[0].qty_on_hand),
      opts.hpp ?? item.hpp,
      opts.refType, opts.refId ?? null, opts.catatan ?? null, opts.userId,
    ],
  );

  return mov.insertId;
}

/**
 * Mengembalikan stok akibat pembatalan. Sengaja memakai jenis
 * `masuk_koreksi` dan bukan menghapus baris ledger — kartu stok harus
 * memperlihatkan bahwa pernah terjadi pemotongan lalu dikoreksi.
 */
export async function batalkanPemotongan(
  conn: PoolConnection,
  opts: {
    siteId: number;
    itemId: number;
    qty: number;
    refType: string;
    refId?: number | null;
    userId: number;
    alasan: string;
  },
): Promise<number> {
  return tambahStok(conn, {
    siteId: opts.siteId,
    itemId: opts.itemId,
    qty: opts.qty,
    jenis: "masuk_koreksi",
    refType: opts.refType,
    refId: opts.refId,
    userId: opts.userId,
    catatan: `Pembatalan: ${opts.alasan}`,
  });
}
