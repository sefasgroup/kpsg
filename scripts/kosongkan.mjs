/**
 * Mengosongkan seluruh data contoh/uji, menyisakan kerangka yang benar-benar
 * dibutuhkan agar sistem masih bisa dimasuki dan diisi data asli.
 *
 * BAWAANNYA TIDAK MENGHAPUS APA PUN. Tanpa `--ya` skrip ini hanya menghitung
 * dan menampilkan apa yang akan hilang. Penghapusan data klinis tidak boleh
 * terjadi karena seseorang salah menekan panah-atas di terminal.
 *
 *   node scripts/kosongkan.mjs                     # tinjau saja
 *   node scripts/kosongkan.mjs --ya                # reset penuh
 *   node scripts/kosongkan.mjs --ya --hanya-klinis # buang data pasien, simpan konfigurasi
 *
 * `--hanya-klinis` untuk membersihkan sisa UAT: pasien, kunjungan, resep,
 * tagihan, dan stok percobaan dibuang, sementara cabang, akun staf, jadwal,
 * dan seluruh master data yang sudah susah payah diisi tetap utuh.
 *
 * YANG SENGAJA DIPERTAHANKAN
 * --------------------------
 *   roles, permissions, role_permissions
 *       Bukan data contoh melainkan struktur: 7 role adalah kontrak dengan
 *       kode (CLAUDE.md §2.1) dan `roles.code` dirujuk di seluruh aplikasi.
 *       Menghapusnya membuat aplikasi tidak bisa dijalankan sama sekali.
 *
 *   settings global (site_id IS NULL)
 *       Identitas aplikasi, bukan data klinik.
 *
 *   SATU akun super_admin
 *       Menghapus seluruh akun akan mengunci semua orang di luar sistem —
 *       tidak ada layar registrasi mandiri, jadi tidak ada jalan masuk untuk
 *       membuat akun pertama. Akun ini hanya pintu masuk; PASSWORD-nya wajib
 *       diganti lewat scripts/rotasi-kredensial.mjs sebelum dipakai.
 */
import { readFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const arg = process.argv.slice(2);
const EKSEKUSI = arg.includes("--ya");
const HANYA_KLINIS = arg.includes("--hanya-klinis");

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
 * Urutan penghapusan mengikuti arah kunci asing: anak lebih dulu, induk
 * belakangan. Foreign key checks SENGAJA tidak dimatikan — kalau urutan ini
 * salah, MySQL menolak dan kita tahu; mematikannya justru menyembunyikan
 * kesalahan dan bisa meninggalkan baris yatim.
 */
const KLINIS = [
  ["Tagihan", ["billing_items", "billing_transactions", "cashier_shifts"]],
  ["Dokumen medis", ["medical_certificates"]],
  ["Resep", [
    "prescription_racikan_ingredients", "prescription_racikans",
    "prescription_items", "prescriptions",
  ]],
  ["Laboratorium", ["lab_results", "lab_order_panels", "lab_orders"]],
  ["Asesmen dokter", [
    "assessment_diagnoses", "assessment_procedures", "medical_assessments",
  ]],
  ["Pengkajian perawat", ["nurse_bmhp_usage", "nurse_assessments"]],
  ["Kunjungan & antrean", ["queues", "visits"]],
  ["Pasien", ["patient_allergies", "patients"]],
  ["Notifikasi & log", ["notifications", "satusehat_sync_logs", "audit_logs"]],
  ["HR operasional", ["attendances", "leave_requests", "schedule_exceptions"]],
  /*
   * Stok dikembalikan ke NOL, bukan "dikurangi sebanyak yang dipakai uji".
   *
   * Saldo gudang wajib selalu sama dengan jumlah seluruh pergerakan. Menghapus
   * sebagian pergerakan sambil membiarkan saldonya memutus persamaan itu dan
   * merusak alat rekonsiliasi — persis kesalahan yang dulu ada di seed.sql.
   * Nol sama dengan nol adalah satu-satunya keadaan yang jelas benar.
   *
   * Katalognya sendiri tetap ada; yang hilang hanya saldo, batch, dan
   * riwayatnya. Saldo awal dimasukkan ulang lewat Penerimaan.
   */
  ["Stok & pergerakan", [
    "stock_opname_items", "stock_opnames",
    "purchase_items", "purchases",
    "stock_movements", "item_batches", "item_stocks",
  ]],
];

/** Konfigurasi — hanya dihapus pada reset penuh, tidak pada --hanya-klinis. */
const KONFIGURASI = [
  ["Katalog", ["items", "item_categories", "suppliers"]],
  ["Tindakan & tarif", ["site_procedure_tariffs", "medical_procedures"]],
  ["Laboratorium (master)", ["lab_parameters", "lab_panels"]],
  ["ICD-10", ["icd10_codes"]],
  ["Jadwal praktik", ["doctor_schedules"]],
  ["Akun", ["doctor_profiles", "user_sites"]],
  ["Poli & penomoran", ["polis", "sequences"]],
  ["Cabang", ["sites"]], // settings per-cabang ikut ON DELETE CASCADE
];

const env = bacaEnv();
const c = await mysql.createConnection({
  host: env.DB_HOST ?? "127.0.0.1",
  port: Number(env.DB_PORT ?? 3306),
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME ?? "simklinik_kpsg",
  multipleStatements: false,
});

const hitung = async (tabel, where = "") => {
  const [[r]] = await c.query(`SELECT COUNT(*) k FROM \`${tabel}\` ${where}`);
  return Number(r.k);
};

// --- Akun yang dipertahankan --------------------------------------------
const [[penjaga]] = await c.query(
  `SELECT u.id, u.username, u.nama
     FROM users u JOIN roles r ON r.id = u.role_id
    WHERE r.code = 'super_admin'
    ORDER BY u.id LIMIT 1`,
);

if (!penjaga) {
  console.error(
    "\nTidak ada akun super_admin sama sekali. Mengosongkan sekarang akan\n" +
      "membuat sistem tidak bisa dimasuki siapa pun. Buat satu akun\n" +
      "super_admin lebih dulu, lalu jalankan ulang.\n",
  );
  await c.end();
  process.exit(2);
}

const kelompok = HANYA_KLINIS ? KLINIS : [...KLINIS, ...KONFIGURASI];

// --- Tinjauan -------------------------------------------------------------
console.log(
  `\n${EKSEKUSI ? "MENGOSONGKAN" : "TINJAUAN (tidak ada yang dihapus)"} — ` +
    `basis data ${env.DB_NAME}` +
    `\nMode: ${HANYA_KLINIS ? "hanya data klinis (konfigurasi dipertahankan)" : "reset penuh"}\n`,
);

let total = 0;
for (const [judul, tabel] of kelompok) {
  const baris = [];
  for (const t of tabel) {
    const n = await hitung(t);
    if (n > 0) baris.push(`${t} ${n}`);
    total += n;
  }
  if (baris.length) console.log(`  ${judul.padEnd(22)} ${baris.join(", ")}`);
}

const akunHapus = HANYA_KLINIS ? 0 : await hitung("users", `WHERE id <> ${penjaga.id}`);
total += akunHapus;
if (akunHapus) {
  console.log(`  ${"Akun".padEnd(22)} users ${akunHapus} (kecuali "${penjaga.username}")`);
}

// --- Berkas unggahan ------------------------------------------------------
const AKAR_STORAGE = path.join(process.cwd(), "storage");
let berkasHapus = 0;
const daftarBerkas = [];
const telusuri = async (d) => {
  let isi;
  try { isi = await readdir(d, { withFileTypes: true }); } catch { return; }
  for (const e of isi) {
    if (e.name === ".gitignore") continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) await telusuri(p);
    else { berkasHapus++; daftarBerkas.push(p); }
  }
};
await telusuri(AKAR_STORAGE);
if (berkasHapus) console.log(`  ${"Berkas unggahan".padEnd(22)} storage/ ${berkasHapus} berkas`);

console.log(`\n  Total ${total} baris` + (berkasHapus ? ` + ${berkasHapus} berkas` : ""));

if (!EKSEKUSI) {
  console.log(`
Tidak ada yang dihapus. Untuk menjalankan sungguhan:

    node scripts/backup.mjs          # amankan dulu — ini tidak bisa dibatalkan
    node scripts/kosongkan.mjs --ya${HANYA_KLINIS ? " --hanya-klinis" : ""}
${
  HANYA_KLINIS
    ? `
Cabang, akun staf, jadwal, dan seluruh master data DIPERTAHANKAN.
Stok dikembalikan ke nol — masukkan ulang saldo awal lewat Penerimaan.
`
    : `
Tambahkan --hanya-klinis bila konfigurasi yang sudah diisi (cabang, akun,
jadwal, katalog, ICD-10) ingin dipertahankan dan hanya data pasien yang
dibuang.
`
}`);
  await c.end();
  process.exit(0);
}

// --- Eksekusi -------------------------------------------------------------
await c.beginTransaction();
try {
  /*
   * Urutannya penting:
   *   1. data klinis — di antaranya anak dari `users` (shift kasir, absensi,
   *      cuti, audit log) dan dari `items` (pergerakan stok),
   *   2. konfigurasi, diakhiri akun lalu cabang, karena `users.site_id`
   *      menunjuk ke `sites`.
   *
   * Menghapus cabang lebih awal gagal dengan fk_users_site: akun penjaga
   * masih menggantung padanya.
   */
  for (const [, tabel] of KLINIS) {
    for (const t of tabel) await c.query(`DELETE FROM \`${t}\``);
  }

  if (HANYA_KLINIS) {
    /*
     * Penomoran dikembalikan ke 0, BUKAN barisnya dihapus: baris sequences
     * dibuat saat cabang dibuat, jadi menghapusnya membuat cabang kehilangan
     * penomorannya tanpa ada yang membuat ulang.
     */
    await c.query(`UPDATE sequences SET last_number = 0`);
  } else {
    for (const [judul, tabel] of KONFIGURASI) {
      for (const t of tabel) await c.query(`DELETE FROM \`${t}\``);

      /*
       * Akun dihapus SETELAH profil dan penugasannya (yang menunjuk ke
       * `users`), dan SEBELUM cabang (yang ditunjuk oleh `users.site_id`).
       * Kelompok "Akun" berada tepat di antara keduanya di KONFIGURASI.
       */
      if (judul === "Akun") {
        await c.query(`DELETE FROM users WHERE id <> ?`, [penjaga.id]);
        await c.query(`UPDATE users SET site_id = NULL WHERE id = ?`, [penjaga.id]);
      }
    }
  }
  await c.commit();
} catch (e) {
  await c.rollback();
  console.error(`\nGAGAL — tidak ada perubahan yang disimpan.\n${e.message}\n`);
  await c.end();
  process.exit(1);
}

/*
 * AUTO_INCREMENT direset agar data asli mulai dari 1. Ini DDL, jadi tidak
 * bisa ikut transaksi di atas dan sengaja dijalankan setelah commit.
 */
for (const t of kelompok.flatMap(([, t]) => t)) {
  try { await c.query(`ALTER TABLE \`${t}\` AUTO_INCREMENT = 1`); } catch { /* tanpa AI */ }
}

for (const p of daftarBerkas) await rm(p, { force: true });

const sisaAkun = await hitung("users");
await c.end();

console.log(
  HANYA_KLINIS
    ? `
Selesai. ${total} baris dan ${berkasHapus} berkas data klinis dihapus.

Dipertahankan: cabang, ${sisaAkun} akun staf, jadwal praktik, poli, ICD-10,
tindakan, panel lab, katalog, dan supplier. Penomoran dokumen kembali ke 1.

PERHATIKAN
Stok sekarang NOL untuk semua item. Masukkan ulang saldo awal lewat
Farmasi -> Penerimaan, lengkap dengan nomor batch dan tanggal kadaluarsa.
Membiarkannya kosong membuat resep pertama ditolak karena stok tidak cukup.

Buktikan setelahnya:
    node uji/jalankan.mjs uji-rekonsiliasi.ts
`
    : `
Selesai. ${total} baris dan ${berkasHapus} berkas dihapus.

Tersisa:
  roles, permissions, role_permissions   struktur RBAC — bukan data contoh
  settings global                        identitas aplikasi
  users                                  ${sisaAkun} akun: "${penjaga.username}" (${penjaga.nama})

LANGKAH BERIKUTNYA — WAJIB, BERURUTAN
1. Ganti password akun yang tersisa. Hash contoh dari seed.sql ada di
   repositori, jadi selama belum diganti akun ini bukan milik Anda sendiri:

       node scripts/rotasi-kredensial.mjs --semua

2. Isi master data mengikuti urutannya: docs/MASTER-DATA.md
   Urutannya bukan saran gaya — langkah berikutnya benar-benar tidak bisa
   dikerjakan sebelum yang sebelumnya ada.
`,
);
