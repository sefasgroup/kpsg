import mysql, { type Pool, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";

/**
 * Pool MySQL tunggal per proses.
 * Di dev, Next.js melakukan hot-reload modul sehingga pool disimpan di globalThis
 * agar tidak membuka koneksi baru setiap kali file berubah.
 */
declare global {
  var __kpsgPool: Pool | undefined;
}

function createPool(): Pool {
  return mysql.createPool({
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "simklinik_kpsg",
    connectionLimit: Number(process.env.DB_POOL ?? 10),
    charset: "utf8mb4_unicode_ci",
    timezone: "+07:00",
    dateStrings: ["DATE"],
    supportBigNumbers: true,
    bigNumberStrings: false,
    // DECIMAL dikembalikan sebagai string agar nilai uang tidak kehilangan presisi.
    decimalNumbers: false,
  });
}

export const pool: Pool = globalThis.__kpsgPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalThis.__kpsgPool = pool;

/** Tipe nilai yang boleh dikirim sebagai parameter prepared statement. */
export type SqlParam = string | number | boolean | Date | Buffer | null;

/**
 * LIMIT tidak bisa memakai placeholder `?`.
 *
 * MySQL menolak parameter LIMIT lewat protokol prepared statement
 * (`ER_WRONG_ARGUMENTS: Incorrect arguments to mysqld_stmt_execute`), dan
 * `pool.execute()` selalu memakai protokol itu. Gejalanya menipu: query
 * yang sama berjalan mulus lewat `pool.query()` maupun klien mysql CLI.
 *
 * Fungsi ini mengembalikan bilangan bulat yang sudah dibersihkan untuk
 * diinterpolasi langsung ke SQL. Nilainya SELALU berasal dari kode kita
 * sendiri (bukan input pengguna) dan dipaksa jadi integer dalam rentang
 * wajar, jadi tidak membuka celah injeksi.
 */
export function limitAman(n: unknown, bawaan = 50, maks = 1000): number {
  const angka = Math.trunc(Number(n));
  if (!Number.isFinite(angka) || angka <= 0) return bawaan;
  return Math.min(angka, maks);
}

/** SELECT banyak baris. */
export async function query<T extends RowDataPacket>(
  sql: string,
  params: SqlParam[] = [],
): Promise<T[]> {
  const [rows] = await pool.execute<T[]>(sql, params);
  return rows;
}

/** SELECT satu baris (atau null). */
export async function queryOne<T extends RowDataPacket>(
  sql: string,
  params: SqlParam[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** INSERT / UPDATE / DELETE. */
export async function execute(
  sql: string,
  params: SqlParam[] = [],
): Promise<ResultSetHeader> {
  const [result] = await pool.execute<ResultSetHeader>(sql, params);
  return result;
}

/**
 * Menjalankan beberapa perintah dalam satu transaksi.
 *
 * WAJIB dipakai untuk operasi yang menyentuh stok + tagihan sekaligus
 * (dispensing resep, pemakaian BMHP, penerimaan barang, opname) —
 * lihat docs/DATABASE.md §3.3.
 */
export async function transaction<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Mengambil nomor dokumen berikutnya secara aman terhadap race condition.
 * Harus dipanggil DI DALAM transaksi yang sama dengan pembuatan dokumennya
 * (docs/DATABASE.md §3.8).
 */
export async function nextSequence(
  conn: mysql.PoolConnection,
  siteId: number,
  key: string,
  periode = "-",
): Promise<number> {
  await conn.execute(
    `INSERT INTO sequences (site_id, seq_key, periode, last_number)
     VALUES (?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE site_id = site_id`,
    [siteId, key, periode],
  );
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT last_number FROM sequences
      WHERE site_id = ? AND seq_key = ? AND periode = ?
      FOR UPDATE`,
    [siteId, key, periode],
  );
  const next = Number(rows[0].last_number) + 1;
  await conn.execute(
    `UPDATE sequences SET last_number = ?
      WHERE site_id = ? AND seq_key = ? AND periode = ?`,
    [next, siteId, key, periode],
  );
  return next;
}
