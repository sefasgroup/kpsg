/**
 * Menjalankan migrasi basis data (`db/migrasi/*.sql`) yang belum pernah
 * dijalankan — dipanggil otomatis oleh deploy (.github/workflows/deploy.yml).
 *
 *   node scripts/migrasi.mjs              # jalankan yang tertunda
 *   node scripts/migrasi.mjs --lihat      # tampilkan saja, tanpa menjalankan
 *   node scripts/migrasi.mjs --tanpa-backup
 *
 * Catatan dijaga di tabel `schema_migrations`: satu baris per berkas, sehingga
 * tiap berkas dijalankan TEPAT SEKALI. Berkas dijalankan urut nama (tanggal
 * di depan nama berkas).
 *
 * Saat pertama kali dipasang, migrasi yang sudah ada sebelum runner ini lahir
 * TIDAK dijalankan ulang — sebagian besar bukan ALTER yang aman diulang. Ia
 * dicatat sebagai `baseline`, tetapi hanya setelah jejaknya (tabel/kolom/
 * indeks yang dibuatnya) terbukti ada di basis data. Bila ada yang belum
 * terpasang, runner berhenti tanpa mengubah apa pun: menandai migrasi yang
 * belum pernah jalan sebagai "sudah" adalah cara paling sunyi merusak skema.
 *
 * Sebelum menjalankan migrasi yang tertunda, basis data dibackup lewat
 * `scripts/backup.mjs` ke `../backup-kpsg/pra-migrasi`. DDL MySQL tidak bisa
 * di-rollback; backup itulah jalan pulangnya.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

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

/*
 * Migrasi yang sudah ada sebelum runner ini, beserta jejak yang membuktikan
 * ia sudah terpasang. Daftar ini TIDAK perlu ditambah untuk migrasi baru —
 * migrasi baru dicatat runner sendiri saat dijalankan.
 */
const kolom = (t, k) => ({ jenis: "kolom", t, k });
const tabel = (t) => ({ jenis: "tabel", t });
const indeks = (t, k) => ({ jenis: "indeks", t, k });
const BASELINE = {
  "2026-08-02-lampiran-kunjungan.sql": tabel("visit_documents"),
  "2026-08-02-pengkajian-tambahan.sql": kolom("nurse_assessments", "gcs_total"),
  "2026-08-02-prioritas-antrean.sql": kolom("visits", "didahulukan"),
  "2026-08-03-bayar-sebelum-obat.sql": kolom("item_stocks", "qty_reserved"),
  "2026-08-03-konsultasi-diskon.sql": kolom("assessment_procedures", "alasan_diskon"),
  "2026-08-03-soap-detail.sql": kolom("medical_assessments", "jenis_anamnesis"),
  "2026-08-18-alur-lab-dan-pembatalan.sql": kolom("lab_orders", "sifat_hasil"),
  "2026-08-18-penjamin-klaim-kepatuhan.sql": tabel("payers"),
  "2026-08-18-resep-terbit-ulang.sql": kolom("prescriptions", "visit_aktif"),
  "2026-08-19-indeks-buku-besar.sql": indeks("stock_movements", "ix_sm_periode"),
};

const arg = process.argv.slice(2);
const lihatSaja = arg.includes("--lihat");
const tanpaBackup = arg.includes("--tanpa-backup");

const env = bacaEnv();
const db = env.DB_NAME ?? "simklinik_kpsg";
const conn = await mysql.createConnection({
  host: env.DB_HOST ?? "127.0.0.1",
  port: Number(env.DB_PORT ?? 3306),
  user: env.DB_USER ?? "root",
  password: env.DB_PASSWORD ?? "",
  database: db,
  // Satu berkas migrasi berisi banyak pernyataan.
  multipleStatements: true,
});

let kode = 0;
try {
  const [adaTabel] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'`,
  );

  if (adaTabel.length === 0) {
    // ---- Pemasangan pertama: buktikan baseline sebelum mencatatnya ----
    const hilang = [];
    for (const [nama, j] of Object.entries(BASELINE)) {
      const [r] =
        j.jenis === "tabel"
          ? await conn.query(
              `SELECT 1 FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [j.t])
          : j.jenis === "kolom"
            ? await conn.query(
                `SELECT 1 FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [j.t, j.k])
            : await conn.query(
                `SELECT 1 FROM information_schema.STATISTICS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`, [j.t, j.k]);
      if (r.length === 0) hilang.push(`${nama}  (tidak ada ${j.jenis} ${j.t}${j.k ? "." + j.k : ""})`);
    }
    if (hilang.length) {
      console.error(
        "\nMigrasi lama berikut BELUM terpasang di basis data ini:\n  " +
          hilang.join("\n  ") +
          "\n\nJalankan berkasnya secara manual lebih dulu, lalu ulangi. " +
          "Tidak ada yang diubah.\n",
      );
      process.exit(1);
    }
    if (lihatSaja) {
      console.log(`Pemasangan pertama: ${Object.keys(BASELINE).length} migrasi lama akan dicatat sebagai baseline.`);
    } else {
      await conn.query(`
        CREATE TABLE schema_migrations (
          nama          VARCHAR(190) NOT NULL,
          cara          ENUM('dijalankan','baseline') NOT NULL DEFAULT 'dijalankan',
          dijalankan_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (nama)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await conn.query(
        `INSERT INTO schema_migrations (nama, cara) VALUES ?`,
        [Object.keys(BASELINE).map((n) => [n, "baseline"])],
      );
      console.log(`Baseline: ${Object.keys(BASELINE).length} migrasi lama terbukti terpasang dan dicatat.`);
    }
  }

  // ---- Migrasi yang tertunda ----
  const folder = path.join(process.cwd(), "db", "migrasi");
  const semua = readdirSync(folder).filter((f) => f.endsWith(".sql")).sort();
  const sudah = new Set(
    adaTabel.length === 0 && lihatSaja
      ? Object.keys(BASELINE)
      : (await conn.query(`SELECT nama FROM schema_migrations`))[0].map((r) => r.nama),
  );
  const tertunda = semua.filter((f) => !sudah.has(f));

  if (tertunda.length === 0) {
    console.log("Migrasi: tidak ada yang tertunda.");
  } else if (lihatSaja) {
    console.log(`Migrasi tertunda (${tertunda.length}):\n  ${tertunda.join("\n  ")}`);
  } else {
    console.log(`Migrasi tertunda (${tertunda.length}): ${tertunda.join(", ")}`);
    if (!tanpaBackup) {
      const b = spawnSync(
        process.execPath,
        ["scripts/backup.mjs", `--tujuan=${path.join(process.cwd(), "..", "backup-kpsg", "pra-migrasi")}`],
        { stdio: "inherit" },
      );
      if (b.status !== 0) {
        console.error("\nBackup gagal — migrasi TIDAK dijalankan.\n");
        process.exit(1);
      }
    }
    for (const f of tertunda) {
      process.stdout.write(`  → ${f} … `);
      try {
        await conn.query(readFileSync(path.join(folder, f), "utf8"));
      } catch (e) {
        console.log("GAGAL");
        console.error(
          `\n${e.message}\n\nMigrasi ${f} gagal dan TIDAK dicatat. DDL MySQL tidak bisa ` +
            "di-rollback: periksa pernyataan mana yang sudah terlanjur jalan sebelum " +
            "mengulang, atau pulihkan dari backup di ../backup-kpsg/pra-migrasi.\n",
        );
        process.exit(1);
      }
      await conn.query(`INSERT INTO schema_migrations (nama) VALUES (?)`, [f]);
      console.log("ok");
    }
  }
} catch (e) {
  console.error(e);
  kode = 1;
} finally {
  await conn.end();
}
process.exit(kode);
