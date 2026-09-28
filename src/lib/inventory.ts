import "server-only";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { execute, limitAman, nextSequence, query, queryOne, transaction } from "./db";
import { periodeSekarang } from "./tanggal";
import { StokTidakCukupError, kurangiStok, tambahStok } from "./stock";
import type {
  PenerimaanInput,
  PengeluaranInput,
  SupplierInput,
} from "./validations/inventory";

/**
 * Inventori farmasi: penerimaan, pengeluaran non-resep, stock opname,
 * dan monitoring kadaluarsa.
 *
 * Tidak satu pun fungsi di sini menyentuh saldo `item_stocks` secara
 * langsung — semuanya lewat `kurangiStok`/`tambahStok` di lib/stock.ts,
 * supaya setiap perubahan saldo pasti punya baris di kartu stok
 * (docs/DATABASE.md §3.3).
 *
 * BATCH & FEFO:
 * `item_batches` diisi saat penerimaan dan dikonsumsi secara FEFO (*first
 * expired, first out*) oleh `kurangiStok()` — resep, racikan, BMHP, maupun
 * pengeluaran non-resep. Qty batch karena itu adalah SISA batch yang
 * sebenarnya.
 *
 * Sebagian saldo bisa saja tidak punya batch (saldo awal implementasi,
 * penerimaan tanpa nomor batch). Pemotongan atas bagian itu tercatat
 * dengan `batch_id` NULL. Invariannya: jumlah qty seluruh batch tidak
 * pernah melebihi saldo gudang.
 */

async function kodeCabang(conn: PoolConnection, siteId: number): Promise<string> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT kode FROM sites WHERE id = ?`,
    [siteId],
  );
  return String(rows[0]?.kode ?? "KPSG");
}

// ---------------------------------------------------------------------
// Pencarian item
// ---------------------------------------------------------------------

export type ItemStok = RowDataPacket & {
  id: number;
  kode: string;
  nama: string;
  tipe: string;
  satuan_dasar: string;
  hpp: string;
  harga_jual: string;
  stok: string;
};

/** Autocomplete item untuk seluruh layar inventori. */
export async function cariItemStok(
  keyword: string,
  siteId: number | null,
  limit = 20,
): Promise<ItemStok[]> {
  const q = keyword.trim();
  if (q.length < 2) return [];

  return query<ItemStok>(
    /* Tersedia, bukan fisik — pengeluaran gudang tidak boleh mengambil
       bagian yang sudah dikunci untuk resep pasien. */
    `SELECT i.id, i.kode, i.nama, i.tipe, i.satuan_dasar, i.hpp, i.harga_jual,
            GREATEST(0, COALESCE(s.qty_on_hand, 0) - COALESCE(s.qty_reserved, 0)) AS stok
       FROM items i
       /* Dijumlahkan per barang — lihat daftarStok() di lib/pharmacy.ts. */
       LEFT JOIN (SELECT item_id, SUM(qty_on_hand) AS qty_on_hand,
                         SUM(qty_reserved) AS qty_reserved
                    FROM item_stocks
                   WHERE (? IS NULL OR site_id = ?)
                   GROUP BY item_id) s ON s.item_id = i.id
      WHERE i.is_active = 1 AND i.deleted_at IS NULL
        AND (i.nama LIKE ? OR i.kode LIKE ? OR i.nama_generik LIKE ?)
      ORDER BY (i.kode = ?) DESC, i.nama
      LIMIT ${limitAman(limit)}`,
    [siteId, siteId, `%${q}%`, `${q}%`, `%${q}%`, q],
  );
}

// ---------------------------------------------------------------------
// Supplier
// ---------------------------------------------------------------------

export type SupplierRow = RowDataPacket & {
  id: number;
  kode: string;
  nama: string;
  kontak: string | null;
  telepon: string | null;
  alamat: string | null;
  is_active: number;
  jumlah_penerimaan: number;
};

export async function daftarSupplier(): Promise<SupplierRow[]> {
  return query<SupplierRow>(
    `SELECT sp.*,
            (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = sp.id) AS jumlah_penerimaan
       FROM suppliers sp
      ORDER BY sp.is_active DESC, sp.nama`,
  );
}

export async function simpanSupplier(
  input: SupplierInput,
  id?: number,
): Promise<number> {
  const kolom = [
    input.kode,
    input.nama,
    input.kontak ?? null,
    input.telepon ?? null,
    input.alamat ?? null,
  ];

  if (id) {
    await execute(
      `UPDATE suppliers SET kode=?, nama=?, kontak=?, telepon=?, alamat=? WHERE id=?`,
      [...kolom, id],
    );
    return id;
  }
  const res = await execute(
    `INSERT INTO suppliers (kode, nama, kontak, telepon, alamat) VALUES (?,?,?,?,?)`,
    kolom,
  );
  return res.insertId;
}

export async function setAktifSupplier(id: number, aktif: boolean): Promise<void> {
  await execute(`UPDATE suppliers SET is_active = ? WHERE id = ?`, [aktif ? 1 : 0, id]);
}

// ---------------------------------------------------------------------
// Penerimaan barang
// ---------------------------------------------------------------------

export type PenerimaanRow = RowDataPacket & {
  id: number;
  no_penerimaan: string;
  no_faktur: string | null;
  tanggal: string;
  supplier_nama: string | null;
  subtotal: string;
  diskon: string;
  ppn: string;
  total: string;
  status: string;
  catatan: string | null;
  petugas: string;
  created_at: string;
  jumlah_item: number;
  total_qty: string;
};

const SELECT_PENERIMAAN = `
  SELECT p.id, p.no_penerimaan, p.no_faktur, p.tanggal, p.subtotal, p.diskon,
         p.ppn, p.total, p.status, p.catatan, p.created_at,
         sp.nama AS supplier_nama, u.nama AS petugas,
         (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS jumlah_item,
         (SELECT COALESCE(SUM(pi.qty),0) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS total_qty
    FROM purchases p
    LEFT JOIN suppliers sp ON sp.id = p.supplier_id
    JOIN users u ON u.id = p.created_by
`;

export async function daftarPenerimaan(
  siteId: number | null,
  opts: { dari?: string; sampai?: string; limit?: number } = {},
): Promise<PenerimaanRow[]> {
  return query<PenerimaanRow>(
    `${SELECT_PENERIMAAN}
      WHERE (? IS NULL OR p.site_id = ?)
        AND (? IS NULL OR p.tanggal >= ?)
        AND (? IS NULL OR p.tanggal <= ?)
      ORDER BY p.tanggal DESC, p.id DESC
      LIMIT ${limitAman(opts.limit, 100)}`,
    [
      siteId, siteId,
      opts.dari ?? null, opts.dari ?? null,
      opts.sampai ?? null, opts.sampai ?? null,
    ],
  );
}

export type BarisPenerimaanRow = RowDataPacket & {
  id: number;
  item_id: number;
  kode: string;
  nama: string;
  satuan_dasar: string;
  no_batch: string | null;
  tanggal_kadaluarsa: string | null;
  qty: string;
  harga_satuan: string;
  subtotal: string;
};

export async function itemPenerimaan(purchaseId: number): Promise<BarisPenerimaanRow[]> {
  return query<BarisPenerimaanRow>(
    `SELECT pi.id, pi.item_id, i.kode, i.nama, i.satuan_dasar,
            pi.no_batch, pi.tanggal_kadaluarsa, pi.qty, pi.harga_satuan, pi.subtotal
       FROM purchase_items pi
       JOIN items i ON i.id = pi.item_id
      WHERE pi.purchase_id = ?
      ORDER BY pi.id`,
    [purchaseId],
  );
}

export type HasilPenerimaan = {
  id: number;
  no_penerimaan: string;
  total: number;
  jumlahItem: number;
  /** Item yang harga belinya sudah melampaui harga jual — perlu ditinjau. */
  peringatanHarga: string[];
  /** Item yang diterima padahal tanggal kadaluarsanya sudah lewat. */
  peringatanKadaluarsa: string[];
};

/**
 * Mencatat penerimaan barang: menambah stok, mengisi kartu stok, dan
 * membuat batch untuk monitoring kadaluarsa — semuanya dalam satu transaksi.
 *
 * Penerimaan langsung berstatus `diterima`; tidak ada tahap draft karena
 * barangnya memang sudah ada di tangan apoteker saat form ini diisi.
 */
export async function catatPenerimaan(
  input: PenerimaanInput,
  siteId: number,
  userId: number,
): Promise<HasilPenerimaan> {
  return transaction(async (conn) => {
    const kode = await kodeCabang(conn, siteId);
    const periode = periodeSekarang();
    const nomor = await nextSequence(conn, siteId, "penerimaan", periode);
    const noPenerimaan = `${kode}/TRM/${periode}/${String(nomor).padStart(5, "0")}`;

    const subtotal = input.items.reduce((n, b) => n + b.qty * b.harga_satuan, 0);
    const total = subtotal - input.diskon + input.ppn;
    if (total < 0) {
      throw new Error("Diskon melebihi nilai barang — total penerimaan jadi negatif.");
    }

    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO purchases
         (site_id, no_penerimaan, supplier_id, no_faktur, tanggal,
          subtotal, diskon, ppn, total, status, catatan, created_by)
       VALUES (?,?,?,?,?,?,?,?,?, 'diterima', ?, ?)`,
      [
        siteId, noPenerimaan, input.supplier_id, input.no_faktur ?? null,
        input.tanggal, subtotal, input.diskon, input.ppn, total,
        input.catatan ?? null, userId,
      ],
    );
    const purchaseId = res.insertId;

    const peringatanHarga: string[] = [];
    const peringatanKadaluarsa: string[] = [];
    const hariIni = input.tanggal;

    for (const b of input.items) {
      const [itemRows] = await conn.execute<RowDataPacket[]>(
        `SELECT nama, harga_jual FROM items WHERE id = ?`,
        [b.item_id],
      );
      if (!itemRows[0]) throw new Error(`Item #${b.item_id} tidak ditemukan.`);
      const nama = String(itemRows[0].nama);

      if (b.harga_satuan > Number(itemRows[0].harga_jual)) {
        peringatanHarga.push(nama);
      }
      if (b.tanggal_kadaluarsa && b.tanggal_kadaluarsa < hariIni) {
        peringatanKadaluarsa.push(nama);
      }

      // Batch dibuat hanya bila ada informasi yang membedakannya. Tanpa
      // nomor batch maupun tanggal kadaluarsa, sebuah baris batch tidak
      // menambah informasi apa pun selain duplikasi kartu stok.
      let batchId: number | null = null;
      if (b.no_batch || b.tanggal_kadaluarsa) {
        const [bres] = await conn.execute<ResultSetHeader>(
          `INSERT INTO item_batches
             (site_id, item_id, no_batch, tanggal_kadaluarsa, qty, hpp, supplier_id)
           VALUES (?,?,?,?,?,?,?)`,
          [
            siteId, b.item_id, b.no_batch ?? null, b.tanggal_kadaluarsa,
            b.qty, b.harga_satuan, input.supplier_id,
          ],
        );
        batchId = bres.insertId;
      }

      await conn.execute(
        `INSERT INTO purchase_items
           (purchase_id, item_id, no_batch, tanggal_kadaluarsa, qty,
            harga_satuan, subtotal, batch_id)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          purchaseId, b.item_id, b.no_batch ?? null, b.tanggal_kadaluarsa,
          b.qty, b.harga_satuan, b.qty * b.harga_satuan, batchId,
        ],
      );

      await tambahStok(conn, {
        siteId,
        itemId: b.item_id,
        qty: b.qty,
        jenis: "masuk_pembelian",
        hpp: b.harga_satuan,
        batchId,
        refType: "purchase",
        refId: purchaseId,
        userId,
        catatan: b.no_batch ? `Batch ${b.no_batch}` : null,
      });

      if (input.perbarui_hpp) {
        await conn.execute(`UPDATE items SET hpp = ? WHERE id = ?`, [
          b.harga_satuan,
          b.item_id,
        ]);
      }
    }

    return {
      id: purchaseId,
      no_penerimaan: noPenerimaan,
      total,
      jumlahItem: input.items.length,
      peringatanHarga,
      peringatanKadaluarsa,
    };
  });
}

// ---------------------------------------------------------------------
// Pengeluaran
// ---------------------------------------------------------------------

export type PengeluaranRow = RowDataPacket & {
  id: number;
  created_at: string;
  jenis: string;
  qty: string;
  qty_after: string;
  catatan: string | null;
  ref_type: string | null;
  kode: string;
  nama: string;
  satuan_dasar: string;
  petugas: string;
};

/**
 * Seluruh pergerakan keluar — resep, racikan, BMHP, maupun non-resep.
 *
 * Sengaja tidak dibatasi ke pengeluaran non-resep saja: apoteker perlu
 * melihat satu arus keluar yang utuh untuk mencocokkan fisik gudang.
 */
export async function daftarPengeluaran(
  siteId: number | null,
  opts: { dari?: string; sampai?: string; jenis?: string; limit?: number } = {},
): Promise<PengeluaranRow[]> {
  return query<PengeluaranRow>(
    `SELECT m.id, m.created_at, m.jenis, m.qty, m.qty_after, m.catatan, m.ref_type,
            i.kode, i.nama, i.satuan_dasar, u.nama AS petugas
       FROM stock_movements m
       JOIN items i ON i.id = m.item_id
       JOIN users u ON u.id = m.created_by
      WHERE m.qty_delta < 0
        AND (? IS NULL OR m.site_id = ?)
        AND (? IS NULL OR DATE(m.created_at) >= ?)
        AND (? IS NULL OR DATE(m.created_at) <= ?)
        AND (? IS NULL OR m.jenis = ?)
      ORDER BY m.id DESC
      LIMIT ${limitAman(opts.limit, 200)}`,
    [
      siteId, siteId,
      opts.dari ?? null, opts.dari ?? null,
      opts.sampai ?? null, opts.sampai ?? null,
      opts.jenis ?? null, opts.jenis ?? null,
    ],
  );
}

/** Pengeluaran non-resep: kadaluarsa, rusak, atau koreksi. */
export async function catatPengeluaran(
  input: PengeluaranInput,
  siteId: number,
  userId: number,
): Promise<{ movementId: number; nama: string; sisa: number }> {
  return transaction(async (conn) => {
    const movementId = await kurangiStok(conn, {
      siteId,
      itemId: input.item_id,
      qty: input.qty,
      jenis: input.jenis,
      refType: "pengeluaran_manual",
      refId: null,
      userId,
      catatan: input.alasan,
    });

    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT i.nama, m.qty_after
         FROM stock_movements m JOIN items i ON i.id = m.item_id
        WHERE m.id = ?`,
      [movementId],
    );
    return {
      movementId,
      nama: String(rows[0].nama),
      sisa: Number(rows[0].qty_after),
    };
  });
}

// ---------------------------------------------------------------------
// Stock opname
// ---------------------------------------------------------------------

export type OpnameRow = RowDataPacket & {
  id: number;
  no_opname: string;
  tanggal: string;
  status: string;
  catatan: string | null;
  created_at: string;
  finalized_at: string | null;
  petugas: string;
  finalisator: string | null;
  jumlah_item: number;
  jumlah_selisih: number;
  selisih_plus: string;
  selisih_minus: string;
};

const SELECT_OPNAME = `
  SELECT o.id, o.no_opname, o.tanggal, o.status, o.catatan, o.created_at,
         o.finalized_at, u.nama AS petugas, f.nama AS finalisator,
         (SELECT COUNT(*) FROM stock_opname_items x WHERE x.opname_id = o.id) AS jumlah_item,
         (SELECT COUNT(*) FROM stock_opname_items x WHERE x.opname_id = o.id AND x.selisih <> 0) AS jumlah_selisih,
         (SELECT COALESCE(SUM(x.selisih),0) FROM stock_opname_items x WHERE x.opname_id = o.id AND x.selisih > 0) AS selisih_plus,
         (SELECT COALESCE(SUM(x.selisih),0) FROM stock_opname_items x WHERE x.opname_id = o.id AND x.selisih < 0) AS selisih_minus
    FROM stock_opnames o
    JOIN users u ON u.id = o.created_by
    LEFT JOIN users f ON f.id = o.finalized_by
`;

export async function daftarOpname(
  siteId: number | null,
  limit = 50,
): Promise<OpnameRow[]> {
  return query<OpnameRow>(
    `${SELECT_OPNAME}
      WHERE (? IS NULL OR o.site_id = ?)
      ORDER BY o.id DESC
      LIMIT ${limitAman(limit)}`,
    [siteId, siteId],
  );
}

export async function getOpname(
  id: number,
  siteId: number | null,
): Promise<OpnameRow | null> {
  return queryOne<OpnameRow>(
    `${SELECT_OPNAME} WHERE o.id = ? AND (? IS NULL OR o.site_id = ?)`,
    [id, siteId, siteId],
  );
}

/** Opname draft yang sedang berjalan di cabang ini, bila ada. */
export async function opnameDraft(siteId: number | null): Promise<OpnameRow | null> {
  return queryOne<OpnameRow>(
    `${SELECT_OPNAME}
      WHERE o.status = 'draft' AND (? IS NULL OR o.site_id = ?)
      ORDER BY o.id DESC`,
    [siteId, siteId],
  );
}

export type BarisOpname = RowDataPacket & {
  id: number;
  item_id: number;
  kode: string;
  nama: string;
  tipe: string;
  satuan_dasar: string;
  hpp: string;
  qty_sistem: string;
  qty_fisik: string;
  selisih: string;
  catatan: string | null;
  /** Saldo gudang saat ini — bisa berubah setelah lembar hitung dibuat. */
  qty_sekarang: string;
};

export async function itemOpname(
  opnameId: number,
  siteId: number,
): Promise<BarisOpname[]> {
  return query<BarisOpname>(
    `SELECT x.id, x.item_id, i.kode, i.nama, i.tipe, i.satuan_dasar, i.hpp,
            x.qty_sistem, x.qty_fisik, x.selisih, x.catatan,
            COALESCE(s.qty_on_hand, 0) AS qty_sekarang
       FROM stock_opname_items x
       JOIN items i ON i.id = x.item_id
       LEFT JOIN item_stocks s ON s.item_id = x.item_id AND s.site_id = ?
      WHERE x.opname_id = ?
      ORDER BY i.nama`,
    [siteId, opnameId],
  );
}

/**
 * Membuka lembar hitung baru: memotret saldo sistem seluruh item aktif
 * pada saat itu. `qty_fisik` awalnya disamakan dengan sistem sehingga
 * item yang tidak dihitung tidak memunculkan selisih palsu.
 */
export async function buatOpname(
  input: { tanggal: string; catatan?: string; tipe: "semua" | "obat" | "bmhp" | "alkes" },
  siteId: number,
  userId: number,
): Promise<{ id: number; no_opname: string; jumlahItem: number }> {
  return transaction(async (conn) => {
    // Satu lembar hitung aktif per cabang. Dua opname paralel akan saling
    // menimpa koreksinya — selisih yang satu sudah dikoreksi, yang lain
    // masih memakai potret lama.
    const [aktif] = await conn.execute<RowDataPacket[]>(
      `SELECT no_opname FROM stock_opnames
        WHERE site_id = ? AND status = 'draft' LIMIT 1`,
      [siteId],
    );
    if (aktif[0]) {
      throw new Error(
        `Masih ada opname berjalan (${String(aktif[0].no_opname)}). Finalkan atau batalkan dulu.`,
      );
    }

    const kode = await kodeCabang(conn, siteId);
    const periode = periodeSekarang();
    const nomor = await nextSequence(conn, siteId, "opname", periode);
    const noOpname = `${kode}/SO/${periode}/${String(nomor).padStart(4, "0")}`;

    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO stock_opnames (site_id, no_opname, tanggal, status, catatan, created_by)
       VALUES (?,?,?, 'draft', ?, ?)`,
      [siteId, noOpname, input.tanggal, input.catatan ?? null, userId],
    );
    const opnameId = res.insertId;

    const filterTipe = input.tipe === "semua" ? null : input.tipe;
    const [ins] = await conn.execute<ResultSetHeader>(
      `INSERT INTO stock_opname_items (opname_id, item_id, qty_sistem, qty_fisik)
       SELECT ?, i.id, COALESCE(s.qty_on_hand, 0), COALESCE(s.qty_on_hand, 0)
         FROM items i
         LEFT JOIN item_stocks s ON s.item_id = i.id AND s.site_id = ?
        WHERE i.is_active = 1 AND i.deleted_at IS NULL
          AND (? IS NULL OR i.tipe = ?)`,
      [opnameId, siteId, filterTipe, filterTipe],
    );

    return { id: opnameId, no_opname: noOpname, jumlahItem: ins.affectedRows };
  });
}

/**
 * Menyimpan satu hitungan fisik.
 *
 * Sama seperti pembatalan: pemeriksaan status dan penulisannya harus berada
 * dalam satu transaksi terkunci. Dengan keduanya terpisah, hitungan yang
 * dikirim tepat saat finalisasi berjalan bisa mendarat di lembar yang sudah
 * final — tersimpan di layar, tidak pernah ikut jadi koreksi stok, dan
 * selamanya menjadi bukti tertulis bahwa gudang pernah dihitung berbeda.
 */
export async function simpanHitungan(
  input: { opname_id: number; item_id: number; qty_fisik: number; catatan?: string },
  siteId: number,
): Promise<void> {
  await transaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT status FROM stock_opnames WHERE id = ? AND site_id = ? FOR UPDATE`,
      [input.opname_id, siteId],
    );
    if (!rows[0]) throw new Error("Lembar opname tidak ditemukan.");
    if (rows[0].status !== "draft") {
      throw new Error("Opname ini sudah difinalkan — hitungannya tidak bisa diubah.");
    }

    const [res] = await conn.execute<ResultSetHeader>(
      `UPDATE stock_opname_items SET qty_fisik = ?, catatan = ?
        WHERE opname_id = ? AND item_id = ?`,
      [input.qty_fisik, input.catatan ?? null, input.opname_id, input.item_id],
    );
    if (res.affectedRows === 0) {
      throw new Error("Item ini tidak termasuk dalam lembar opname.");
    }
  });
}

/**
 * Memfinalkan opname: setiap selisih diubah jadi pergerakan stok.
 *
 * Delta yang diterapkan adalah `qty_fisik - qty_sistem` (selisih saat
 * penghitungan), BUKAN `qty_fisik - saldo sekarang`. Bedanya penting:
 * bila ada resep yang diserahkan setelah lembar hitung dibuat, memaksa
 * saldo menjadi qty_fisik akan menghapus pengeluaran yang sah itu.
 */
export async function finalkanOpname(
  opnameId: number,
  siteId: number,
  userId: number,
): Promise<{ no_opname: string; dikoreksi: number; naik: number; turun: number }> {
  return transaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT no_opname, status FROM stock_opnames
        WHERE id = ? AND site_id = ? FOR UPDATE`,
      [opnameId, siteId],
    );
    if (!rows[0]) throw new Error("Lembar opname tidak ditemukan.");
    if (rows[0].status !== "draft") {
      throw new Error("Opname ini sudah difinalkan atau dibatalkan.");
    }
    const noOpname = String(rows[0].no_opname);

    const [items] = await conn.execute<RowDataPacket[]>(
      `SELECT x.item_id, x.qty_sistem, x.qty_fisik, x.selisih, x.catatan, i.nama
         FROM stock_opname_items x JOIN items i ON i.id = x.item_id
        WHERE x.opname_id = ? AND x.selisih <> 0
        /*
         * Diurutkan menurut item_id, bukan nama.
         *
         * Nama bisa disunting di master data dan mengubah urutan pengambilan
         * kunci tanpa ada yang menyadarinya; item_id tidak pernah berubah.
         * Aturan urutan kunci di lib/kunci.ts bersandar pada hal itu.
         */
        ORDER BY x.item_id`,
      [opnameId],
    );

    let naik = 0;
    let turun = 0;

    for (const it of items) {
      const selisih = Number(it.selisih);
      const catatan = `Opname ${noOpname}: sistem ${Number(it.qty_sistem)} → fisik ${Number(it.qty_fisik)}${it.catatan ? ` — ${String(it.catatan)}` : ""}`;

      if (selisih > 0) {
        await tambahStok(conn, {
          siteId, itemId: Number(it.item_id), qty: selisih,
          jenis: "masuk_opname", refType: "opname", refId: opnameId,
          userId, catatan,
        });
        naik++;
      } else {
        try {
          await kurangiStok(conn, {
            siteId, itemId: Number(it.item_id), qty: -selisih,
            jenis: "keluar_opname", refType: "opname", refId: opnameId,
            userId, catatan,
          });
        } catch (err) {
          if (err instanceof StokTidakCukupError) {
            // Saldo sudah turun lagi setelah lembar hitung dibuat, sehingga
            // koreksi ini akan membuat stok minus. Membiarkannya lewat jauh
            // lebih berbahaya daripada memaksa hitung ulang.
            throw new Error(
              `${String(it.nama)}: saldo gudang sudah berubah sejak lembar hitung dibuat ` +
                `(tersedia ${err.tersedia}, koreksi butuh ${err.diminta}). Hitung ulang item ini sebelum finalisasi.`,
            );
          }
          throw err;
        }
        turun++;
      }
    }

    await conn.execute(
      `UPDATE stock_opnames SET status = 'final', finalized_by = ?, finalized_at = NOW()
        WHERE id = ?`,
      [userId, opnameId],
    );

    return { no_opname: noOpname, dikoreksi: items.length, naik, turun };
  });
}

/**
 * Membatalkan lembar hitung yang belum difinalkan.
 *
 * Pembacaan status dan penulisannya dikerjakan dalam SATU transaksi dengan
 * baris terkunci. Sebelumnya keduanya terpisah dan `UPDATE`-nya tanpa
 * syarat status, sehingga ada celah nyata: bila finalisasi berjalan di
 * antara keduanya — dua admin, atau satu admin dengan dua tab — lembar yang
 * koreksinya SUDAH masuk kartu stok berakhir bertanda `batal`. Angkanya
 * sudah bergerak, catatannya berkata tidak pernah terjadi, dan tidak ada
 * satu pun yang menandai bahwa keduanya bertentangan.
 */
export async function batalkanOpname(
  opnameId: number,
  siteId: number,
): Promise<string> {
  return transaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT no_opname, status FROM stock_opnames
        WHERE id = ? AND site_id = ? FOR UPDATE`,
      [opnameId, siteId],
    );
    const row = rows[0];
    if (!row) throw new Error("Lembar opname tidak ditemukan.");
    if (row.status === "final") {
      throw new Error("Opname yang sudah final tidak bisa dibatalkan — koreksinya sudah masuk kartu stok.");
    }

    // Syarat status tetap ditulis di UPDATE-nya, bukan hanya diandalkan
    // pada penguncian di atas: penjaga yang berdiri sendiri lebih sulit
    // dilangkahi saat kode ini disusun ulang kelak.
    await conn.execute(
      `UPDATE stock_opnames SET status = 'batal' WHERE id = ? AND status = 'draft'`,
      [opnameId],
    );
    return String(row.no_opname);
  });
}

// ---------------------------------------------------------------------
// Monitoring kadaluarsa
// ---------------------------------------------------------------------

export type BatchRow = RowDataPacket & {
  id: number;
  item_id: number;
  kode: string;
  nama: string;
  satuan_dasar: string;
  no_batch: string | null;
  tanggal_kadaluarsa: string;
  /** Sisa batch yang sebenarnya — sudah dikurangi konsumsi FEFO. */
  qty: string;
  hpp: string;
  supplier_nama: string | null;
  /** Saldo gudang item ini, sebagai konteks. */
  stok_item: string;
  sisa_hari: number;
};

/**
 * Batch yang sudah atau akan kadaluarsa dalam `hari` ke depan.
 * Ambang default diambil dari setting `stok.peringatan_kadaluarsa_hari`.
 */
export async function batchKadaluarsa(
  siteId: number | null,
  hari = 90,
): Promise<BatchRow[]> {
  const ambang = limitAman(hari, 90, 3650);
  return query<BatchRow>(
    `SELECT b.id, b.item_id, i.kode, i.nama, i.satuan_dasar, b.no_batch,
            b.tanggal_kadaluarsa, b.qty, b.hpp, sp.nama AS supplier_nama,
            COALESCE(s.qty_on_hand, 0) AS stok_item,
            DATEDIFF(b.tanggal_kadaluarsa, CURDATE()) AS sisa_hari
       FROM item_batches b
       JOIN items i ON i.id = b.item_id
       LEFT JOIN suppliers sp ON sp.id = b.supplier_id
       LEFT JOIN item_stocks s ON s.item_id = b.item_id AND s.site_id = b.site_id
      WHERE b.qty > 0
        AND b.tanggal_kadaluarsa IS NOT NULL
        AND DATEDIFF(b.tanggal_kadaluarsa, CURDATE()) <= ${ambang}
        AND (? IS NULL OR b.site_id = ?)
      ORDER BY b.tanggal_kadaluarsa, i.nama`,
    [siteId, siteId],
  );
}

export async function ambangKadaluarsa(siteId: number | null): Promise<number> {
  const row = await queryOne<RowDataPacket & { svalue: string }>(
    `SELECT svalue FROM settings
      WHERE skey = 'stok.peringatan_kadaluarsa_hari'
        AND (site_id = ? OR site_id IS NULL)
      ORDER BY site_id IS NULL
      LIMIT 1`,
    [siteId],
  );
  return limitAman(row?.svalue, 90, 3650);
}

/**
 * Menarik batch kadaluarsa dari peredaran: memotong saldo gudang dan
 * mengurangi qty batch sekaligus, keduanya lewat `kurangiStok()`.
 *
 * Batch yang ditarik ditentukan eksplisit (bukan FEFO): yang dimusnahkan
 * memang batch tertentu, bukan yang paling cepat kadaluarsa.
 */
export async function tarikBatch(
  input: { batch_id: number; qty: number; alasan: string },
  siteId: number,
  userId: number,
): Promise<{ nama: string; no_batch: string | null; sisaBatch: number; sisaStok: number }> {
  return transaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT b.id, b.item_id, b.no_batch, b.qty, b.tanggal_kadaluarsa, i.nama
         FROM item_batches b JOIN items i ON i.id = b.item_id
        WHERE b.id = ? AND b.site_id = ? FOR UPDATE`,
      [input.batch_id, siteId],
    );
    const batch = rows[0];
    if (!batch) throw new Error("Batch tidak ditemukan di cabang ini.");

    const qtyBatch = Number(batch.qty);
    if (input.qty > qtyBatch) {
      throw new Error(
        `Jumlah penarikan (${input.qty}) melebihi isi batch (${qtyBatch}).`,
      );
    }

    /*
     * `batchId` memaksa pemotongan dari batch INI, melewati FEFO — yang
     * dimusnahkan memang batch tertentu, bukan yang paling cepat
     * kadaluarsa. `kurangiStok` sekaligus mengurangi qty batch-nya, jadi
     * di sini tidak boleh dikurangi lagi.
     */
    const movementId = await kurangiStok(conn, {
      siteId,
      itemId: Number(batch.item_id),
      qty: input.qty,
      jenis: "keluar_kadaluarsa",
      refType: "batch",
      refId: Number(batch.id),
      batchId: Number(batch.id),
      userId,
      catatan: `Batch ${String(batch.no_batch ?? "-")} exp ${String(batch.tanggal_kadaluarsa)} — ${input.alasan}`,
    });

    const [after] = await conn.execute<RowDataPacket[]>(
      `SELECT qty_after FROM stock_movements WHERE id = ?`,
      [movementId],
    );

    return {
      nama: String(batch.nama),
      no_batch: batch.no_batch ? String(batch.no_batch) : null,
      sisaBatch: qtyBatch - input.qty,
      sisaStok: Number(after[0].qty_after),
    };
  });
}

// ---------------------------------------------------------------------
// Ringkasan
// ---------------------------------------------------------------------

export type RingkasanInventori = {
  nilaiStok: number;
  itemHabis: number;
  itemMenipis: number;
  batchKadaluarsa: number;
  batchMendekati: number;
  penerimaanBulanIni: number;
  nilaiPenerimaanBulanIni: number;
};

export async function ringkasanInventori(
  siteId: number | null,
  ambangHari = 90,
): Promise<RingkasanInventori> {
  const ambang = limitAman(ambangHari, 90, 3650);

  const stok = await queryOne<RowDataPacket & {
    nilai: string; habis: number; menipis: number;
  }>(
    `SELECT COALESCE(SUM(COALESCE(s.qty_on_hand,0) * i.hpp), 0) AS nilai,
            SUM(COALESCE(s.qty_on_hand,0) <= 0) AS habis,
            SUM(COALESCE(s.qty_on_hand,0) > 0 AND COALESCE(s.qty_on_hand,0) <= i.min_stock) AS menipis
       FROM items i
       /* Dijumlahkan per barang supaya "habis"/"menipis" dihitung per barang,
          bukan per pasangan barang × cabang saat tanpa cabang. */
       LEFT JOIN (SELECT item_id, SUM(qty_on_hand) AS qty_on_hand
                    FROM item_stocks
                   WHERE (? IS NULL OR site_id = ?)
                   GROUP BY item_id) s ON s.item_id = i.id
      WHERE i.is_active = 1 AND i.deleted_at IS NULL`,
    [siteId, siteId],
  );

  const batch = await queryOne<RowDataPacket & { lewat: number; dekat: number }>(
    `SELECT SUM(DATEDIFF(b.tanggal_kadaluarsa, CURDATE()) < 0) AS lewat,
            SUM(DATEDIFF(b.tanggal_kadaluarsa, CURDATE()) BETWEEN 0 AND ${ambang}) AS dekat
       FROM item_batches b
      WHERE b.qty > 0 AND b.tanggal_kadaluarsa IS NOT NULL
        AND (? IS NULL OR b.site_id = ?)`,
    [siteId, siteId],
  );

  const beli = await queryOne<RowDataPacket & { n: number; nilai: string }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS nilai
       FROM purchases
      WHERE status = 'diterima'
        AND YEAR(tanggal) = YEAR(CURDATE()) AND MONTH(tanggal) = MONTH(CURDATE())
        AND (? IS NULL OR site_id = ?)`,
    [siteId, siteId],
  );

  return {
    nilaiStok: Number(stok?.nilai ?? 0),
    itemHabis: Number(stok?.habis ?? 0),
    itemMenipis: Number(stok?.menipis ?? 0),
    batchKadaluarsa: Number(batch?.lewat ?? 0),
    batchMendekati: Number(batch?.dekat ?? 0),
    penerimaanBulanIni: Number(beli?.n ?? 0),
    nilaiPenerimaanBulanIni: Number(beli?.nilai ?? 0),
  };
}
