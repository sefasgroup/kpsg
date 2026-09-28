/**
 * Menguji `db/schema.sql` pada database yang benar-benar KOSONG.
 *
 * Skema yang hanya pernah dijalankan lewat migrasi bertahap bisa tampak
 * sehat sementara berkas pemasangan barunya rusak — mis. FK yang menunjuk
 * tabel yang belum sempat dibuat. Pemasangan baru pertama akan gagal, dan
 * itu ditemukan di klinik, bukan di sini.
 */
import { readFileSync } from "node:fs";
import { pool } from "../src/lib/db";

const UJI = "simklinik_uji_schema";
const isi = readFileSync("db/schema.sql", "utf8")
  // Nama database di berkas diganti nama database uji, supaya percobaan ini
  // tidak pernah menyentuh data sungguhan.
  .replaceAll("`simklinik_kpsg`", "`" + UJI + "`")
  .replaceAll("simklinik_kpsg", UJI);

const perintah = isi
  // Komentar dibuang LEBIH DULU, baru dipecah: titik koma di dalam
  // komentar akan memotong statement di tempat yang salah.
  .replace(/^\s*--.*$/gm, "")
  .split(/;\s*$/m)
  .map((p) => p.trim())
  .filter(Boolean);

const conn = await pool.getConnection();
let n = 0;
let gagal = false;
try {
  await conn.query(`DROP DATABASE IF EXISTS ${UJI}`);
  for (const p of perintah) {
    n++;
    await conn.query(p);
  }
  const [t] = await conn.query<import("mysql2").RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?`,
    [UJI],
  );
  console.log(`schema.sql BERSIH: ${n} perintah, ${t[0].n} tabel terbentuk.`);
} catch (e) {
  gagal = true;
  console.log(`GAGAL di perintah ${n}: ${(e as Error).message}`);
  console.log("---\n" + perintah[n - 1].slice(0, 300));
} finally {
  await conn.query(`DROP DATABASE IF EXISTS ${UJI}`);
  conn.release();
  await pool.end();
}
console.log(gagal ? "\n1 UJI GAGAL\n" : "\nSEMUA UJI LULUS\n");
process.exit(gagal ? 1 : 0);
