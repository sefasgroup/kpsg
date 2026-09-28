import "server-only";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { nextSequence } from "./db";
import { bagiTanggungan } from "./penjamin";
import { periodeSekarang } from "./tanggal";

/**
 * Inti tagihan. Biaya masuk ke sini dari banyak modul sepanjang kunjungan:
 * BMHP perawat, tindakan dokter, lab, obat, racikan, dan jasa racik
 * (CLAUDE.md §4).
 *
 * CATATAN PENTING: tabel billing_* TIDAK PERNAH menyimpan diagnosa.
 * `deskripsi` sudah berupa teks siap cetak, sehingga layar kasir cukup
 * membaca billing_* + patients tanpa menyentuh medical_assessments
 * (CLAUDE.md §2.1 poin 7).
 */

export type KategoriTagihan =
  | "jasa_dokter"
  | "tindakan"
  | "laboratorium"
  | "obat"
  | "racikan"
  | "jasa_racik"
  | "bmhp"
  | "administrasi"
  | "lainnya";

/**
 * Mengambil (atau membuat) tagihan draft untuk satu kunjungan.
 * Satu kunjungan = satu tagihan (`uq_bt_visit`), jadi aman dipanggil
 * berkali-kali dari modul mana pun. Harus di dalam transaksi.
 */
export async function pastikanTagihan(
  conn: PoolConnection,
  visitId: number,
  siteId: number,
): Promise<number> {
  /*
   * PEMBACAAN BIASA DULU, BUKAN `FOR UPDATE`.
   *
   * Ini bukan gaya penulisan melainkan penutup deadlock yang paling sering
   * terjadi di sistem ini — dan yang paling sulit diduga.
   *
   * `SELECT … WHERE visit_id = ? FOR UPDATE` atas baris yang BELUM ADA
   * tidak mengunci baris apa pun; ia mengambil **gap lock** pada indeks
   * `uq_bt_visit`. Dua kunjungan berbeda yang tagihannya lahir bersamaan
   * karena itu sama-sama memegang gap lock di halaman indeks yang sama,
   * lalu masing-masing meminta baris `sequences` dan hak menyisipkan ke
   * gap yang dipegang lawannya:
   *
   *   T1: gap lock uq_bt_visit  →  menunggu sequences(invoice)
   *   T2: sequences(invoice)    →  menunggu insert-intention pada gap T1
   *
   * MySQL membunuh salah satunya dengan errno 1213. Terbukti terjadi 12
   * dari 12 percobaan pada `uji-konkurensi.ts` — dan pemicunya adalah hal
   * paling biasa di klinik: dua perawat menyelesaikan pengkajian, atau dua
   * apoteker memvalidasi resep, pada detik yang sama.
   *
   * Yang dilakukan sekarang: baca tanpa kunci, dan hanya kunci barisnya
   * bila ia memang ada — penguncian lewat primary key tidak pernah
   * mengambil gap lock. Bila ternyata belum ada, `uq_bt_visit` yang
   * menjaga: `INSERT` yang kalah balapan gagal dengan duplicate key, dan
   * jalur pemulihannya di bawah membacanya ulang.
   */
  const [ada] = await conn.execute<RowDataPacket[]>(
    `SELECT id, status FROM billing_transactions WHERE visit_id = ?`,
    [visitId],
  );

  if (ada[0]) {
    // Kunci lewat primary key — record lock, tanpa gap.
    await conn.execute(
      `SELECT id FROM billing_transactions WHERE id = ? FOR UPDATE`,
      [ada[0].id],
    );
    if (ada[0].status === "lunas") {
      throw new Error(
        "Tagihan kunjungan ini sudah lunas — biaya baru tidak bisa ditambahkan.",
      );
    }
    if (ada[0].status === "batal") {
      throw new Error("Tagihan kunjungan ini sudah dibatalkan.");
    }
    return Number(ada[0].id);
  }

  const [siteRows] = await conn.execute<RowDataPacket[]>(
    `SELECT kode FROM sites WHERE id = ?`,
    [siteId],
  );
  const kodeSite = String(siteRows[0]?.kode ?? "KPSG");
  const periode = periodeSekarang();
  const nomor = await nextSequence(conn, siteId, "invoice", periode);
  const noInvoice = `${kodeSite}/INV/${periode}/${String(nomor).padStart(5, "0")}`;

  /*
   * Penjamin disalin dari kunjungannya, bukan dari pasiennya.
   *
   * Kepesertaan bisa berubah, dan tagihan yang sudah terbit tidak boleh
   * berpindah penjamin hanya karena data pasiennya diperbarui setahun
   * kemudian — berkas klaim yang sudah dikirim akan mendadak tidak cocok
   * dengan isi sistem.
   */
  /*
   * Balapan diselesaikan `uq_bt_visit`, bukan oleh kunci di atas.
   *
   * Yang kalah mendapat ER_DUP_ENTRY, lalu membaca ulang barisnya dengan
   * penguncian — pada titik itu barisnya SUDAH ADA, jadi penguncian
   * berikutnya adalah record lock biasa. Satu nomor invoice terbuang pada
   * kejadian langka ini; itu jauh lebih murah daripada satu deadlock yang
   * membatalkan pekerjaan petugas.
   */
  const [res] = await conn.execute<ResultSetHeader>(
    `INSERT INTO billing_transactions (site_id, visit_id, payer_id, no_invoice, status)
     SELECT ?, ?, v.payer_id, ?, 'draft' FROM visits v WHERE v.id = ?`,
    [siteId, visitId, noInvoice, visitId],
  ).catch(async (err: Error & { code?: string }) => {
    if (err.code !== "ER_DUP_ENTRY") throw err;
    /*
     * Transaksi lain menang balapan. Barisnya kini pasti ada, jadi
     * penguncian di bawah adalah record lock — bukan gap lock.
     */
    const [lagi] = await conn.execute<RowDataPacket[]>(
      `SELECT id, status FROM billing_transactions WHERE visit_id = ? FOR UPDATE`,
      [visitId],
    );
    if (!lagi[0]) throw err;
    if (lagi[0].status === "lunas") {
      throw new Error(
        "Tagihan kunjungan ini sudah lunas — biaya baru tidak bisa ditambahkan.",
      );
    }
    if (lagi[0].status === "batal") {
      throw new Error("Tagihan kunjungan ini sudah dibatalkan.");
    }
    return [{ insertId: Number(lagi[0].id) } as ResultSetHeader];
  });
  return res.insertId;
}

/** Menambahkan satu baris biaya. Harus di dalam transaksi. */
export async function tambahBarisTagihan(
  conn: PoolConnection,
  opts: {
    billingId: number;
    kategori: KategoriTagihan;
    deskripsi: string;
    qty: number;
    hargaSatuan: number;
    diskon?: number;
    refType?: string | null;
    refId?: number | null;
  },
): Promise<number> {
  const diskon = opts.diskon ?? 0;
  const subtotal = opts.qty * opts.hargaSatuan - diskon;

  const [res] = await conn.execute<ResultSetHeader>(
    `INSERT INTO billing_items
       (billing_id, kategori, ref_type, ref_id, deskripsi, qty, harga_satuan, diskon, subtotal)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      opts.billingId, opts.kategori, opts.refType ?? null, opts.refId ?? null,
      opts.deskripsi, opts.qty, opts.hargaSatuan, diskon, subtotal,
    ],
  );
  return res.insertId;
}

/**
 * Menghapus baris tagihan berdasarkan referensinya.
 * Dipakai saat pengkajian disimpan ulang: baris BMHP lama dibuang sebelum
 * yang baru ditulis, supaya tidak menumpuk ganda.
 */
export async function hapusBarisTagihanByRef(
  conn: PoolConnection,
  billingId: number,
  refType: string,
): Promise<void> {
  await conn.execute(
    `DELETE FROM billing_items WHERE billing_id = ? AND ref_type = ?`,
    [billingId, refType],
  );
}

/**
 * Menghitung ulang total dari baris-barisnya, sekaligus membagi
 * tanggungan antara penjamin dan pasien. Harus di dalam transaksi.
 *
 * Pembagiannya dihitung ulang di sini, bukan sekali saat pembayaran:
 * biaya masuk sepanjang kunjungan dari lima modul berbeda, dan plafon
 * penjamin bisa baru terlampaui pada baris terakhir. Layar kasir karena
 * itu selalu menampilkan angka yang mutakhir tanpa perlu tahu urutan
 * modul mana yang menambah biaya lebih dulu.
 */
export async function hitungUlangTagihan(
  conn: PoolConnection,
  billingId: number,
): Promise<{
  subtotal: number;
  total: number;
  tanggungPenjamin: number;
  tanggungPasien: number;
}> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(subtotal), 0) AS subtotal FROM billing_items WHERE billing_id = ?`,
    [billingId],
  );
  const subtotal = Number(rows[0].subtotal);

  const [bt] = await conn.execute<RowDataPacket[]>(
    `SELECT bt.diskon, bt.pembulatan, bt.payer_id, p.plafon_per_kunjungan
       FROM billing_transactions bt
       LEFT JOIN payers p ON p.id = bt.payer_id
      WHERE bt.id = ?`,
    [billingId],
  );
  const diskon = Number(bt[0]?.diskon ?? 0);
  const pembulatan = Number(bt[0]?.pembulatan ?? 0);
  const total = subtotal - diskon + pembulatan;

  const { penjamin: tanggungPenjamin, pasien: tanggungPasien } = bagiTanggungan(
    total,
    bt[0]?.payer_id ? Number(bt[0].plafon_per_kunjungan ?? 0) : -1,
  );

  await conn.execute(
    `UPDATE billing_transactions
        SET subtotal = ?, total = ?, tanggung_penjamin = ?, tanggung_pasien = ?
      WHERE id = ?`,
    [subtotal, total, tanggungPenjamin, tanggungPasien, billingId],
  );

  return { subtotal, total, tanggungPenjamin, tanggungPasien };
}

