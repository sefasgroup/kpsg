/**
 * Mengganti password seluruh akun yang masih memakai hash contoh dari
 * `db/seed.sql`, dengan password acak per akun.
 *
 * ==========================================================================
 * WAJIB DIJALANKAN SEBELUM SISTEM MENGHADAP JARINGAN KLINIK.
 *
 * Hash contoh di seed sama untuk kedelapan akun DAN tertulis di berkas yang
 * ikut ke repositori. `must_change_pw = 1` tidak menolong: siapa pun yang
 * pernah melihat repo tahu passwordnya, dan bisa masuk lebih dulu.
 * ==========================================================================
 *
 * Pemakaian:
 *   node scripts/rotasi-kredensial.mjs            # hanya yang masih memakai hash contoh
 *   node scripts/rotasi-kredensial.mjs --semua    # seluruh akun aktif
 *   node scripts/rotasi-kredensial.mjs --user=dokter,kasir
 *
 * Password hanya ditampilkan SEKALI di layar. Tidak disimpan ke berkas dan
 * tidak masuk audit log — salin sekarang, atau jalankan ulang.
 */
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const HASH_CONTOH = "$2b$10$fLuHLNCVkWxvPIbvraRat.zRvQIdC7FUhpDVcCVyNuLQbJ3H5QRAW";

// --- Konfigurasi dari .env.local, tanpa dependensi tambahan ---------------
function bacaEnv() {
  const env = { ...process.env };
  for (const berkas of [".env.local", ".env"]) {
    try {
      const isi = readFileSync(path.join(process.cwd(), berkas), "utf8");
      for (const baris of isi.split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(baris);
        if (m && env[m[1]] === undefined) {
          env[m[1]] = m[2].replace(/^["']|["']$/g, "");
        }
      }
    } catch {
      /* berkas tidak ada — pakai default */
    }
  }
  return env;
}

/**
 * Password acak yang mudah dibacakan lewat telepon: tanpa huruf/angka yang
 * mudah tertukar (0/O, 1/l/I), dikelompokkan agar tidak salah salin.
 */
function passwordAcak() {
  const abjad = "abcdefghjkmnpqrstuvwxyz";
  const ANGKA = "23456789";
  const SIMBOL = "!@#$%&*";
  const ambil = (s, n) =>
    Array.from({ length: n }, () => s[randomInt(s.length)]).join("");
  return `${ambil(abjad, 4)}-${ambil(ANGKA, 4)}-${ambil(abjad, 4)}${ambil(SIMBOL, 1)}`;
}

const env = bacaEnv();
const arg = process.argv.slice(2);
const semua = arg.includes("--semua");
const daftarUser = arg
  .find((a) => a.startsWith("--user="))
  ?.slice(7)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const pool = mysql.createPool({
  host: env.DB_HOST ?? "127.0.0.1",
  port: Number(env.DB_PORT ?? 3306),
  user: env.DB_USER ?? "root",
  password: env.DB_PASSWORD ?? "",
  database: env.DB_NAME ?? "simklinik_kpsg",
  connectionLimit: 4,
});

let syarat = `password_hash = ?`;
let params = [HASH_CONTOH];

if (daftarUser?.length) {
  syarat = `username IN (${daftarUser.map(() => "?").join(",")})`;
  params = daftarUser;
} else if (semua) {
  syarat = `1 = 1`;
  params = [];
}

const [akun] = await pool.query(
  `SELECT u.id, u.username, u.nama, r.nama AS peran
     FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.deleted_at IS NULL AND u.is_active = 1 AND ${syarat}
    ORDER BY r.id, u.nama`,
  params,
);

if (akun.length === 0) {
  console.log(
    "\nTidak ada akun yang perlu dirotasi. " +
      "Tidak satu pun akun aktif memakai hash contoh dari seed.\n",
  );
  await pool.end();
  process.exit(0);
}

console.log(`\nMerotasi ${akun.length} akun…\n`);

const hasil = [];
for (const a of akun) {
  const baru = passwordAcak();
  const hash = await bcrypt.hash(baru, 12); // cost 12 untuk produksi
  await pool.execute(
    `UPDATE users SET password_hash = ?, must_change_pw = 1 WHERE id = ?`,
    [hash, a.id],
  );
  hasil.push({ ...a, password: baru });
}

const lebar = Math.max(...hasil.map((h) => h.username.length), 8);
console.log(
  `${"USERNAME".padEnd(lebar)}  ${"PASSWORD BARU".padEnd(18)}  NAMA / PERAN`,
);
console.log("-".repeat(lebar + 22 + 30));
for (const h of hasil) {
  console.log(
    `${h.username.padEnd(lebar)}  ${h.password.padEnd(18)}  ${h.nama} — ${h.peran}`,
  );
}

console.log(`
Password di atas TIDAK disimpan di mana pun dan tidak tercatat di audit log.
Salin sekarang; menjalankan ulang skrip ini akan menghasilkan yang baru lagi.

Seluruh akun ditandai wajib ganti password saat masuk pertama kali.
`);

// Pemeriksaan akhir: pastikan tidak ada sisa hash contoh.
const [[sisa]] = await pool.query(
  `SELECT COUNT(*) AS n FROM users WHERE password_hash = ? AND deleted_at IS NULL`,
  [HASH_CONTOH],
);
if (Number(sisa.n) > 0) {
  console.log(
    `PERINGATAN: masih ada ${sisa.n} akun memakai hash contoh ` +
      `(kemungkinan nonaktif). Jalankan dengan --semua bila perlu.\n`,
  );
}

await pool.end();
