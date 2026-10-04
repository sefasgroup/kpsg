/**
 * Backup basis data + berkas unggahan.
 *
 * Menghasilkan satu folder bertanggal berisi:
 *   - `simklinik_kpsg-<stempel>.sql`  — seluruh basis data (mysqldump)
 *   - `storage/`                       — salinan berkas unggahan
 *   - `MANIFEST.txt`                   — versi, ukuran, SHA-256, cara pulihkan
 *
 * SHA-256 bukan hiasan: backup yang rusak diam-diam sama saja dengan tidak
 * punya backup, dan baru ketahuan justru saat dibutuhkan. Verifikasilah
 * dengan `node scripts/backup.mjs --verifikasi <folder>`.
 *
 * Pemakaian:
 *   node scripts/backup.mjs [--tujuan=D:\backup-kpsg]
 *   node scripts/backup.mjs --verifikasi D:\backup-kpsg\2026-08-02_0930
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createReadStream, readFileSync } from "node:fs";
import path from "node:path";

function bacaEnv() {
  const env = { ...process.env };
  for (const berkas of [".env.local", ".env"]) {
    try {
      for (const baris of readFileSync(path.join(process.cwd(), berkas), "utf8").split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(baris);
        if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch { /* tidak ada */ }
  }
  return env;
}

async function sha256(berkas) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(berkas)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

const arg = process.argv.slice(2);

// --- Mode verifikasi -----------------------------------------------------
const iVerif = arg.indexOf("--verifikasi");
if (iVerif !== -1) {
  const folder = arg[iVerif + 1];
  if (!folder) {
    console.error("Sebutkan folder backup yang mau diverifikasi.");
    process.exit(2);
  }
  const manifest = await readFile(path.join(folder, "MANIFEST.txt"), "utf8");
  const baris = manifest
    .split(/\r?\n/)
    .map((b) => /^SHA256\s+([a-f0-9]{64})\s+(.+)$/.exec(b))
    .filter(Boolean);

  let rusak = 0;
  for (const [, hash, nama] of baris) {
    const nyata = await sha256(path.join(folder, nama));
    const cocok = nyata === hash;
    console.log(`  ${cocok ? "OK    " : "RUSAK "} ${nama}`);
    if (!cocok) rusak++;
  }
  console.log(
    rusak === 0
      ? `\n${baris.length} berkas cocok — backup utuh.\n`
      : `\n${rusak} berkas TIDAK cocok — backup ini tidak bisa diandalkan.\n`,
  );
  process.exit(rusak === 0 ? 0 : 1);
}

// --- Mode backup ---------------------------------------------------------
const env = bacaEnv();
const db = env.DB_NAME ?? "simklinik_kpsg";
const tujuanAkar =
  arg.find((a) => a.startsWith("--tujuan="))?.slice(9) ??
  path.join(process.cwd(), "..", "backup-kpsg");

const sekarang = new Date();
const stempel = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Jakarta",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit",
})
  .format(sekarang)
  .replace(" ", "_")
  .replace(":", "");

const folder = path.join(tujuanAkar, stempel);
await mkdir(folder, { recursive: true });

const namaSql = `${db}-${stempel}.sql`;
const berkasSql = path.join(folder, namaSql);

console.log(`\nBackup ke ${folder}\n`);
console.log("  1/3  mysqldump…");

/*
 * `--single-transaction` membuat dump konsisten TANPA mengunci tabel —
 * penting karena klinik bisa saja sedang melayani pasien saat backup jalan.
 * Berlaku untuk InnoDB, dan seluruh tabel sistem ini InnoDB.
 *
 * Password diberikan lewat variabel lingkungan `MYSQL_PWD`, bukan argumen
 * `-p`: argumen proses terlihat oleh pengguna lain di mesin yang sama.
 */
const argDump = [
  "--host", env.DB_HOST ?? "127.0.0.1",
  "--port", String(env.DB_PORT ?? 3306),
  "--user", env.DB_USER ?? "root",
  "--single-transaction",
  // MySQL 8.0.21+ meminta hak PROCESS untuk dump tablespace; akun aplikasi
  // biasanya tidak punya, dan sistem ini tidak memakai tablespace.
  "--no-tablespaces",
  "--routines",
  "--triggers",
  "--events",
  "--default-character-set=utf8mb4",
  "--result-file", berkasSql,
  db,
];

await new Promise((resolve, reject) => {
  const p = spawn("mysqldump", argDump, {
    env: { ...process.env, MYSQL_PWD: env.DB_PASSWORD ?? "" },
    stdio: ["ignore", "inherit", "inherit"],
  });
  p.on("error", (e) =>
    reject(
      new Error(
        `mysqldump tidak bisa dijalankan (${e.message}). ` +
          `Pastikan folder bin MySQL/MariaDB ada di PATH.`,
      ),
    ),
  );
  p.on("close", (kode) =>
    kode === 0 ? resolve() : reject(new Error(`mysqldump keluar dengan kode ${kode}`)),
  );
});

console.log("  2/3  menyalin storage/…");
const asalStorage = path.join(process.cwd(), "storage");
let jumlahBerkas = 0;
const hitungBerkas = async (d) => {
  let n = 0;
  for (const e of await readdir(d, { withFileTypes: true })) {
    if (e.name === ".gitignore") continue;
    if (e.isDirectory()) n += await hitungBerkas(path.join(d, e.name));
    else n++;
  }
  return n;
};
/*
 * Hanya "folder belum ada" yang boleh dilewati. Dulu SETIAP galat (izin
 * ditolak, disk penuh, berhenti di tengah) ditelan dan dilaporkan sebagai
 * "storage/ kosong" — backup tampak utuh padahal lampiran rekam medis
 * pasien tidak ikut. Galat lain kini menghentikan backup, dan jumlah berkas
 * salinan dicocokkan dengan sumbernya.
 */
let adaStorage = true;
try {
  await stat(asalStorage);
} catch (e) {
  if (e?.code !== "ENOENT") throw e;
  adaStorage = false;
  console.log("       (storage/ belum ada — tidak ada lampiran untuk disalin)");
}
if (adaStorage) {
  await cp(asalStorage, path.join(folder, "storage"), { recursive: true });
  jumlahBerkas = await hitungBerkas(asalStorage);
  const tersalin = await hitungBerkas(path.join(folder, "storage"));
  if (tersalin !== jumlahBerkas) {
    throw new Error(
      `Penyalinan storage/ tidak lengkap: ${tersalin} dari ${jumlahBerkas} berkas. Backup DIBATALKAN.`,
    );
  }
}

console.log("  3/3  menulis manifest…");
const ukuran = (await stat(berkasSql)).size;
const hash = await sha256(berkasSql);

await writeFile(
  path.join(folder, "MANIFEST.txt"),
  `BACKUP SIM KLINIK KPSG
======================
Dibuat        : ${sekarang.toISOString()}
Zona klinik   : ${stempel} WIB
Basis data    : ${db}
Ukuran dump   : ${(ukuran / 1024 / 1024).toFixed(2)} MB
Berkas unggahan: ${jumlahBerkas}

SHA256  ${hash}  ${namaSql}

CARA MEMULIHKAN
---------------
1. Siapkan basis data kosong:
       mysql -u root -e "DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

2. Muat dump:
       mysql -u root ${db} < ${namaSql}

3. Kembalikan berkas unggahan:
       salin isi folder storage/ di backup ini ke storage/ pada aplikasi.

4. Verifikasi sebelum dipakai:
       node uji/jalankan.mjs uji-rekonsiliasi.ts

PERIKSA KEUTUHAN BACKUP INI
---------------------------
       node scripts/backup.mjs --verifikasi "${folder}"

CATATAN
-------
Dump ini memuat SELURUH rekam medis pasien. Perlakukan seperti berkas rekam
medis fisik: simpan terenkripsi, batasi yang bisa mengaksesnya, dan jangan
menaruhnya di penyimpanan awan umum tanpa persetujuan tertulis klinik.
`,
  "utf8",
);

console.log(`
Selesai.
  Dump    : ${(ukuran / 1024 / 1024).toFixed(2)} MB
  Berkas  : ${jumlahBerkas}
  SHA-256 : ${hash.slice(0, 16)}…

Verifikasi: node scripts/backup.mjs --verifikasi "${folder}"
`);
