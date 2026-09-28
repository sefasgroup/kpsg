/**
 * Mengisi master data contoh untuk pengujian — TIGA cabang, masing-masing
 * dengan staf, poli, jadwal, tarif, pengaturan, dan stok sendiri.
 *
 *   node uji/jalankan.mjs scripts/data-contoh.ts
 *   node uji/jalankan.mjs scripts/data-contoh.ts --ganti   # timpa yang sudah ada
 *
 * DIJALANKAN LEWAT RUNNER JITI, BUKAN SQL MENTAH — dan itu disengaja.
 *
 * Saldo awal stok dimasukkan lewat `catatPenerimaan()`, fungsi yang sama yang
 * dipakai layar Penerimaan. Menulis `INSERT INTO item_stocks` langsung akan
 * membuat angka di layar terlihat benar sambil memutus persamaan
 * saldo = jumlah pergerakan — persis kesalahan yang dulu ada di `db/seed.sql`
 * dan tidak ketahuan sampai uji rekonsiliasi ditulis. Data contoh yang
 * melanggar invarian sistemnya sendiri lebih buruk daripada tidak ada.
 *
 * Cabang dibuat lewat `simpanCabang()` dan akun lewat `simpanPengguna()`
 * dengan alasan yang sama: keduanya sekalian membuat penomoran dokumen,
 * pengaturan bawaan, dan penugasan multi-cabang.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne } from "../src/lib/db";
import { simpanCabang, simpanPengguna } from "../src/lib/master";
import { penggunaSchema } from "../src/lib/validations/master";
import { penerimaanSchema } from "../src/lib/validations/inventory";
import { catatPenerimaan } from "../src/lib/inventory";
import { tanggalHariIni } from "../src/lib/tanggal";

const GANTI = process.argv.includes("--ganti");
const PASSWORD = "kpsg12345";

const log = (s: string) => console.log(s);
const langkah = (n: number, s: string) => console.log(`\n${n}. ${s}`);

/** Tanggal relatif hari ini — supaya monitoring kadaluarsa tetap masuk akal. */
function hari(selisih: number): string {
  const d = new Date(`${tanggalHariIni()}T00:00:00`);
  d.setDate(d.getDate() + selisih);
  return d.toISOString().slice(0, 10);
}

// =====================================================================
// Pemeriksaan awal
// =====================================================================
const adaCabang = await queryOne<RowDataPacket & { n: number }>(
  `SELECT COUNT(*) n FROM sites`,
);
if (Number(adaCabang?.n) > 0 && !GANTI) {
  console.error(`
Basis data sudah berisi ${adaCabang?.n} cabang.

Skrip ini untuk basis data yang baru dikosongkan. Menimpanya bisa menghapus
data yang sudah Anda isi sendiri, jadi tidak dilakukan tanpa diminta.

  Kosongkan dulu :  node scripts/kosongkan.mjs --ya
  Atau paksa     :  node uji/jalankan.mjs scripts/data-contoh.ts --ganti
`);
  await pool.end();
  process.exit(2);
}

if (GANTI && Number(adaCabang?.n) > 0) {
  log("--ganti: membuang data lama lebih dulu…");
  const { execSync } = await import("node:child_process");
  execSync("node scripts/kosongkan.mjs --ya", { stdio: "inherit" });
}

const superadmin = await queryOne<RowDataPacket & { id: number }>(
  `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
    WHERE r.code = 'super_admin' ORDER BY u.id LIMIT 1`,
);
if (!superadmin) {
  console.error("\nTidak ada akun super_admin. Muat db/seed.sql lebih dulu.\n");
  await pool.end();
  process.exit(2);
}
const OLEH = Number(superadmin.id);

// =====================================================================
langkah(1, "Cabang");
// =====================================================================
const CABANG = [
  {
    kode: "PST", nama: "KPSG Pusat Bandung",
    nama_legal: "PT Sahabat Gamma Sejahtera",
    no_izin_klinik: "503/1234/DPMPTSP/2024",
    alamat: "Jl. Soekarno Hatta No. 210", kota: "Bandung",
    provinsi: "Jawa Barat", telepon: "022-7501234",
    email: "pusat@sahabatgamma.co.id",
  },
  {
    kode: "CMH", nama: "KPSG Cimahi",
    nama_legal: "PT Sahabat Gamma Sejahtera",
    no_izin_klinik: "503/0456/DPMPTSP-CMH/2024",
    alamat: "Jl. Raya Cibabat No. 45", kota: "Cimahi",
    provinsi: "Jawa Barat", telepon: "022-6652211",
    email: "cimahi@sahabatgamma.co.id",
  },
  {
    kode: "SMD", nama: "KPSG Sumedang",
    nama_legal: "PT Sahabat Gamma Sejahtera",
    no_izin_klinik: "503/0789/DPMPTSP-SMD/2024",
    alamat: "Jl. Prabu Geusan Ulun No. 8", kota: "Sumedang",
    provinsi: "Jawa Barat", telepon: "0261-201555",
    email: "sumedang@sahabatgamma.co.id",
  },
] as const;

const siteId: Record<string, number> = {};
for (const c of CABANG) {
  siteId[c.kode] = await simpanCabang({ ...c });
  log(`   ${c.kode}  ${c.nama}`);
}

// Pengaturan sengaja BERBEDA antar cabang — supaya salah-cabang terlihat.
const SETTING: Record<string, Record<string, string>> = {
  PST: { "billing.pembulatan": "100", "racikan.jasa_racik_default": "5000", "cetak.printer_thermal": "80", "billing.biaya_admin": "5000" },
  CMH: { "billing.pembulatan": "500", "racikan.jasa_racik_default": "4000", "cetak.printer_thermal": "58", "billing.biaya_admin": "3000" },
  SMD: { "billing.pembulatan": "100", "racikan.jasa_racik_default": "3500", "cetak.printer_thermal": "58", "billing.biaya_admin": "0" },
};
for (const [kode, pengaturan] of Object.entries(SETTING)) {
  for (const [skey, svalue] of Object.entries(pengaturan)) {
    await execute(`UPDATE settings SET svalue = ? WHERE site_id = ? AND skey = ?`,
      [svalue, siteId[kode], skey]);
  }
}
log("   pengaturan per cabang dibedakan (pembulatan, jasa racik, lebar printer)");

// =====================================================================
langkah(2, "Poli");
// =====================================================================
const POLI = [
  { site: "PST", kode: "UMUM", nama: "Poli Umum", prefix: "A" },
  { site: "PST", kode: "GIGI", nama: "Poli Gigi", prefix: "B" },
  { site: "PST", kode: "KIA", nama: "Poli KIA", prefix: "C" },
  { site: "CMH", kode: "UMUM", nama: "Poli Umum", prefix: "A" },
  { site: "CMH", kode: "KIA", nama: "Poli KIA", prefix: "C" },
  { site: "SMD", kode: "UMUM", nama: "Poli Umum", prefix: "A" },
] as const;

const poliId: Record<string, number> = {};
for (const p of POLI) {
  const r = await execute(
    `INSERT INTO polis (site_id, kode, nama, prefix_antrean) VALUES (?,?,?,?)`,
    [siteId[p.site], p.kode, p.nama, p.prefix],
  );
  poliId[`${p.site}:${p.kode}`] = r.insertId;
}
log(`   ${POLI.length} poli di 3 cabang`);

// =====================================================================
langkah(3, "Pengguna & penugasan multi-cabang");
// =====================================================================
type Staf = {
  username: string; nama: string; role: string; site: string;
  cabangTambahan?: string[];
  dokter?: { str: string; sip: string; spesialisasi: string; gelar: string; tarif: number };
};

const STAF: Staf[] = [
  // --- Pusat ---
  { username: "admin.pst", nama: "Rina Kusuma", role: "admin_cabang", site: "PST" },
  { username: "perawat.pst", nama: "Dewi Lestari", role: "perawat", site: "PST" },
  { username: "lab.pst", nama: "Agus Prasetyo", role: "petugas_lab", site: "PST" },
  { username: "farmasi.pst", nama: "Maya Anggraini", role: "farmasi", site: "PST" },
  { username: "kasir.pst", nama: "Budi Hartono", role: "kasir", site: "PST" },
  {
    username: "dr.rafi", nama: "Rafi Santoso", role: "dokter", site: "PST",
    dokter: { str: "STR-3312004521", sip: "SIP-503/DU/0112/2024", spesialisasi: "Dokter Umum", gelar: "dr.", tarif: 50000 },
  },
  {
    username: "drg.sinta", nama: "Sinta Halim", role: "dokter", site: "PST",
    dokter: { str: "STR-3312007788", sip: "SIP-503/DG/0087/2024", spesialisasi: "Dokter Gigi", gelar: "drg.", tarif: 75000 },
  },

  // --- Cimahi ---
  { username: "admin.cmh", nama: "Yuni Rahmawati", role: "admin_cabang", site: "CMH" },
  { username: "perawat.cmh", nama: "Siti Nurhaliza", role: "perawat", site: "CMH" },
  { username: "lab.cmh", nama: "Hendra Wijaya", role: "petugas_lab", site: "CMH" },
  { username: "farmasi.cmh", nama: "Tia Permata", role: "farmasi", site: "CMH" },
  { username: "kasir.cmh", nama: "Andi Nugroho", role: "kasir", site: "CMH" },
  {
    username: "dr.putri", nama: "Putri Handayani", role: "dokter", site: "CMH",
    dokter: { str: "STR-3277001234", sip: "SIP-503/DU/0210/2024", spesialisasi: "Dokter Umum", gelar: "dr.", tarif: 45000 },
  },

  // --- Sumedang ---
  { username: "admin.smd", nama: "Fajar Ramadhan", role: "admin_cabang", site: "SMD" },
  { username: "perawat.smd", nama: "Lina Marlina", role: "perawat", site: "SMD" },
  { username: "lab.smd", nama: "Rizal Fauzi", role: "petugas_lab", site: "SMD" },
  { username: "farmasi.smd", nama: "Ratna Dewi", role: "farmasi", site: "SMD" },
  { username: "kasir.smd", nama: "Doni Saputra", role: "kasir", site: "SMD" },

  /*
   * INTI PENGUJIAN MULTI-CABANG.
   *
   * Sumedang sengaja TIDAK punya dokter tetap: satu-satunya dokter yang
   * melayani di sana juga praktik di Pusat dan Cimahi. Ini kasus nyata yang
   * dikonfirmasi klinik, dan sekaligus menguji hal yang paling mudah salah —
   * pemilih cabang, penyaringan daftar dokter di pendaftaran, dan daftar
   * penugasan yang ikut di dalam token sesi.
   */
  {
    username: "dr.bayu", nama: "Bayu Prakoso", role: "dokter", site: "PST",
    cabangTambahan: ["CMH", "SMD"],
    dokter: { str: "STR-3312009900", sip: "SIP-503/DU/0345/2024", spesialisasi: "Dokter Umum", gelar: "dr.", tarif: 55000 },
  },

  // Admin lintas cabang: Pusat + Cimahi.
  {
    username: "admin.wilayah", nama: "Hesti Wulandari", role: "admin_cabang",
    site: "PST", cabangTambahan: ["CMH"],
  },
];

const userId: Record<string, number> = {};
for (const s of STAF) {
  /*
   * Divalidasi lewat `penggunaSchema` — skema yang sama dengan form Super
   * Admin — bukan dilempar langsung ke `simpanPengguna()`.
   *
   * Bukan sekadar kerapian: melewatkan validasi berarti kehilangan nilai
   * bawaannya juga. Percobaan pertama skrip ini mengirim `tarif_konsultasi`
   * yang tidak terisi dan mysql2 menolaknya di tengah jalan. Data contoh
   * harus lahir dari jalur yang sama dengan data asli, kalau tidak ia
   * menguji sesuatu yang tidak pernah terjadi di produksi.
   */
  const input = penggunaSchema.parse({
    nama: s.nama,
    username: s.username,
    role_code: s.role,
    site_id: siteId[s.site],
    site_ids: (s.cabangTambahan ?? []).map((k) => siteId[k]),
    password: PASSWORD,
    no_str: s.dokter?.str,
    no_sip: s.dokter?.sip,
    spesialisasi: s.dokter?.spesialisasi,
    gelar_depan: s.dokter?.gelar,
    tarif_konsultasi: s.dokter?.tarif ?? 0,
  });

  const { id } = await simpanPengguna(input);
  userId[s.username] = id;

  // Masa berlaku SIP tidak ada di form pengguna, jadi diisi terpisah.
  if (s.dokter) {
    await execute(
      `UPDATE doctor_profiles SET sip_berlaku_sampai = ? WHERE user_id = ?`,
      [hari(540), id],
    );
  }
}
log(`   ${STAF.length} akun, password semuanya "${PASSWORD}"`);
log(`   dr.bayu       -> Pusat + Cimahi + Sumedang  (dokter multi-cabang)`);
log(`   admin.wilayah -> Pusat + Cimahi`);

// =====================================================================
langkah(4, "Jadwal praktik");
// =====================================================================
const JADWAL: [string, string, string, number[], string, string, number][] = [
  // dokter,      cabang, poli,   hari,        mulai,   selesai, kuota
  ["dr.rafi",     "PST",  "UMUM", [1, 2, 3, 4, 5], "08:00", "14:00", 30],
  ["drg.sinta",   "PST",  "GIGI", [1, 3, 5],       "09:00", "15:00", 15],
  ["dr.rafi",     "PST",  "KIA",  [6],             "08:00", "12:00", 20],
  ["dr.putri",    "CMH",  "UMUM", [1, 2, 3, 4, 5], "08:00", "14:00", 25],
  ["dr.putri",    "CMH",  "KIA",  [6],             "08:00", "12:00", 15],
  // Dokter multi-cabang: Senin-Selasa Pusat, Rabu-Kamis Cimahi, Jumat-Sabtu Sumedang.
  ["dr.bayu",     "PST",  "UMUM", [1, 2],          "14:00", "20:00", 25],
  ["dr.bayu",     "CMH",  "UMUM", [3, 4],          "14:00", "20:00", 20],
  ["dr.bayu",     "SMD",  "UMUM", [5, 6],          "08:00", "14:00", 20],
];

let jumlahJadwal = 0;
for (const [dokter, cabang, poli, hariList, mulai, selesai, kuota] of JADWAL) {
  for (const h of hariList) {
    await execute(
      `INSERT INTO doctor_schedules
         (site_id, doctor_id, poli_id, hari, jam_mulai, jam_selesai, kuota, berlaku_dari, created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [siteId[cabang], userId[dokter], poliId[`${cabang}:${poli}`], h, mulai, selesai, kuota, hari(-30), OLEH],
    );
    jumlahJadwal++;
  }
}
log(`   ${jumlahJadwal} slot jadwal — Sumedang hanya dilayani dr.bayu (Jum-Sab)`);

// =====================================================================
langkah(5, "ICD-10");
// =====================================================================
const ICD: [string, string, string, string][] = [
  ["A09", "Diare dan gastroenteritis non-infeksi", "Diarrhoea and gastroenteritis", "Penyakit Infeksi"],
  ["A15.0", "Tuberkulosis paru", "Tuberculosis of lung", "Penyakit Infeksi"],
  ["A90", "Demam dengue", "Dengue fever", "Penyakit Infeksi"],
  ["B34.9", "Infeksi virus, tidak spesifik", "Viral infection, unspecified", "Penyakit Infeksi"],
  ["E11.9", "Diabetes melitus tipe 2 tanpa komplikasi", "Type 2 diabetes mellitus", "Endokrin"],
  ["E78.5", "Hiperlipidemia, tidak spesifik", "Hyperlipidaemia, unspecified", "Endokrin"],
  ["E86", "Dehidrasi", "Volume depletion", "Endokrin"],
  ["G43.9", "Migrain, tidak spesifik", "Migraine, unspecified", "Saraf"],
  ["H10.9", "Konjungtivitis, tidak spesifik", "Conjunctivitis, unspecified", "Mata"],
  ["H60.9", "Otitis eksterna, tidak spesifik", "Otitis externa, unspecified", "THT"],
  ["H66.9", "Otitis media, tidak spesifik", "Otitis media, unspecified", "THT"],
  ["I10", "Hipertensi esensial (primer)", "Essential (primary) hypertension", "Kardiovaskular"],
  ["I25.1", "Penyakit jantung aterosklerotik", "Atherosclerotic heart disease", "Kardiovaskular"],
  ["J00", "Nasofaringitis akut (common cold)", "Acute nasopharyngitis", "Pernapasan"],
  ["J02.9", "Faringitis akut", "Acute pharyngitis, unspecified", "Pernapasan"],
  ["J06.9", "Infeksi saluran napas atas akut", "Acute upper respiratory infection", "Pernapasan"],
  ["J18.9", "Pneumonia, tidak spesifik", "Pneumonia, unspecified", "Pernapasan"],
  ["J45.9", "Asma, tidak spesifik", "Asthma, unspecified", "Pernapasan"],
  ["K02.9", "Karies gigi, tidak spesifik", "Dental caries, unspecified", "Gigi & Mulut"],
  ["K04.7", "Abses periapikal tanpa sinus", "Periapical abscess without sinus", "Gigi & Mulut"],
  ["K21.9", "Refluks gastroesofageal tanpa esofagitis", "GERD without oesophagitis", "Pencernaan"],
  ["K29.7", "Gastritis, tidak spesifik", "Gastritis, unspecified", "Pencernaan"],
  ["K30", "Dispepsia", "Functional dyspepsia", "Pencernaan"],
  ["L23.9", "Dermatitis kontak alergi", "Allergic contact dermatitis", "Kulit"],
  ["L30.9", "Dermatitis, tidak spesifik", "Dermatitis, unspecified", "Kulit"],
  ["M54.5", "Nyeri punggung bawah", "Low back pain", "Muskuloskeletal"],
  ["M79.1", "Mialgia", "Myalgia", "Muskuloskeletal"],
  ["N39.0", "Infeksi saluran kemih", "Urinary tract infection", "Urogenital"],
  ["R50.9", "Demam, tidak spesifik", "Fever, unspecified", "Gejala & Tanda"],
  ["R51", "Sakit kepala", "Headache", "Gejala & Tanda"],
  ["Z00.0", "Pemeriksaan kesehatan umum", "General medical examination", "Faktor Kesehatan"],
  ["Z23", "Imunisasi", "Encounter for immunization", "Faktor Kesehatan"],
];
for (const [code, id_, en, bab] of ICD) {
  await execute(
    `INSERT INTO icd10_codes (code, nama_id, nama_en, bab) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE nama_id = VALUES(nama_id)`,
    [code, id_, en, bab],
  );
}
log(`   ${ICD.length} kode`);

// =====================================================================
langkah(6, "Tindakan & tarif");
// =====================================================================
const TINDAKAN: [string, string, string, number, string | null][] = [
  ["TND-001", "Konsultasi Dokter Umum", "Konsultasi", 50000, null],
  ["TND-002", "Konsultasi Dokter Gigi", "Konsultasi", 75000, null],
  ["TND-010", "Jahit Luka 1-5 Jahitan", "Tindakan", 150000, "86.59"],
  ["TND-011", "Jahit Luka 6-10 Jahitan", "Tindakan", 250000, "86.59"],
  ["TND-012", "Perawatan Luka / Ganti Verban", "Tindakan", 50000, "93.57"],
  ["TND-013", "Angkat Jahitan", "Tindakan", 40000, "97.89"],
  ["TND-014", "Nebulisasi", "Tindakan", 75000, "93.94"],
  ["TND-015", "Injeksi Intramuskular", "Tindakan", 35000, "99.23"],
  ["TND-016", "Pemasangan Infus", "Tindakan", 100000, "38.93"],
  ["TND-017", "Ekstraksi Kuku", "Tindakan", 200000, "86.23"],
  ["TND-018", "Insisi Abses", "Tindakan", 175000, "86.04"],
  ["TND-020", "Tambal Gigi Sementara", "Gigi", 100000, "23.2"],
  ["TND-021", "Tambal Gigi Tetap", "Gigi", 200000, "23.2"],
  ["TND-022", "Cabut Gigi Sulung", "Gigi", 100000, "23.01"],
  ["TND-023", "Cabut Gigi Permanen", "Gigi", 250000, "23.09"],
  ["TND-024", "Scaling / Pembersihan Karang Gigi", "Gigi", 300000, "96.54"],
  ["TND-030", "Imunisasi Dasar", "KIA", 75000, "99.59"],
  ["TND-031", "Pemeriksaan Kehamilan (ANC)", "KIA", 80000, "75.34"],
  ["TND-040", "EKG", "Penunjang", 120000, "89.52"],
  ["TND-041", "Surat Keterangan Sehat", "Administrasi", 25000, null],
];
const tindakanId: Record<string, number> = {};
for (const [kode, nama, kategori, tarif, icd9] of TINDAKAN) {
  const r = await execute(
    `INSERT INTO medical_procedures (kode, nama, kategori, tarif, icd9cm) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE nama = VALUES(nama)`,
    [kode, nama, kategori, tarif, icd9],
  );
  tindakanId[kode] = r.insertId;
}

/*
 * Override tarif per cabang: Cimahi dan Sumedang lebih murah daripada Pusat.
 * Tanpa baris override, cabang memakai tarif dasar — jadi hanya sebagian yang
 * dibedakan, supaya kedua jalur (override dan fallback) sama-sama teruji.
 */
const OVERRIDE: [string, string, number][] = [
  ["CMH", "TND-001", 40000], ["CMH", "TND-010", 130000], ["CMH", "TND-014", 65000],
  ["SMD", "TND-001", 35000], ["SMD", "TND-010", 120000], ["SMD", "TND-012", 40000],
];
for (const [cabang, kode, tarif] of OVERRIDE) {
  await execute(
    `INSERT INTO site_procedure_tariffs (site_id, procedure_id, tarif) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE tarif = VALUES(tarif)`,
    [siteId[cabang], tindakanId[kode], tarif],
  );
}
log(`   ${TINDAKAN.length} tindakan, ${OVERRIDE.length} override tarif per cabang`);

// =====================================================================
langkah(7, "Panel & parameter laboratorium");
// =====================================================================
const PANEL: {
  kode: string; nama: string; kategori: string; tarif: number;
  param: [string, string, string | null, number | null, number | null, number | null, number | null][];
}[] = [
  {
    kode: "LAB-HEM", nama: "Hematologi Rutin", kategori: "Hematologi", tarif: 85000,
    param: [
      // kode, nama, satuan, ref_low, ref_high, kritis_low, kritis_high
      ["HB", "Hemoglobin", "g/dL", 13.0, 17.0, 7.0, 20.0],
      ["HT", "Hematokrit", "%", 40.0, 54.0, 20.0, 60.0],
      ["LEU", "Leukosit", "10^3/uL", 4.0, 11.0, 1.5, 30.0],
      ["TRO", "Trombosit", "10^3/uL", 150.0, 450.0, 50.0, 1000.0],
      ["ERI", "Eritrosit", "10^6/uL", 4.5, 5.9, null, null],
    ],
  },
  {
    kode: "LAB-GD", nama: "Gula Darah", kategori: "Kimia Klinik", tarif: 45000,
    param: [
      ["GDS", "Glukosa Darah Sewaktu", "mg/dL", 70, 140, 50, 400],
      ["GDP", "Glukosa Darah Puasa", "mg/dL", 70, 100, 50, 400],
      ["HBA1C", "HbA1c", "%", 4.0, 5.6, null, 12.0],
    ],
  },
  {
    kode: "LAB-KIM", nama: "Kimia Darah Lengkap", kategori: "Kimia Klinik", tarif: 175000,
    param: [
      ["CHOL", "Kolesterol Total", "mg/dL", 0, 200, null, 400],
      ["TG", "Trigliserida", "mg/dL", 0, 150, null, 500],
      ["HDL", "HDL", "mg/dL", 40, 60, null, null],
      ["LDL", "LDL", "mg/dL", 0, 130, null, 250],
      ["UA", "Asam Urat", "mg/dL", 3.5, 7.2, null, 12.0],
      ["CREA", "Kreatinin", "mg/dL", 0.6, 1.2, null, 5.0],
      ["SGOT", "SGOT / AST", "U/L", 0, 40, null, 200],
      ["SGPT", "SGPT / ALT", "U/L", 0, 41, null, 200],
    ],
  },
  {
    kode: "LAB-URI", nama: "Urinalisa Lengkap", kategori: "Urinalisa", tarif: 60000,
    param: [
      ["UPH", "pH Urine", null, 4.5, 8.0, null, null],
      ["UBJ", "Berat Jenis", null, 1.005, 1.03, null, null],
    ],
  },
];

let jumlahParam = 0;
for (const p of PANEL) {
  const r = await execute(
    `INSERT INTO lab_panels (kode, nama, kategori, tarif) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE nama = VALUES(nama)`,
    [p.kode, p.nama, p.kategori, p.tarif],
  );
  let urut = 0;
  for (const [kode, nama, satuan, rl, rh, kl, kh] of p.param) {
    await execute(
      `INSERT INTO lab_parameters
         (panel_id, kode, nama, satuan, tipe_nilai, ref_low, ref_high, kritis_low, kritis_high, urutan)
       VALUES (?,?,?,?, 'numerik', ?,?,?,?,?)`,
      [r.insertId, kode, nama, satuan, rl, rh, kl, kh, ++urut],
    );
    jumlahParam++;
  }
}

// Parameter bertipe pilihan — menguji jalur non-numerik pada input hasil lab.
const panelUri = await queryOne<RowDataPacket & { id: number }>(
  `SELECT id FROM lab_panels WHERE kode = 'LAB-URI'`,
);
for (const [kode, nama] of [
  ["UPRO", "Protein Urine"], ["UGLU", "Glukosa Urine"], ["UKET", "Keton Urine"],
]) {
  await execute(
    `INSERT INTO lab_parameters (panel_id, kode, nama, tipe_nilai, pilihan, ref_teks, urutan)
     VALUES (?,?,?, 'pilihan', ?, 'Negatif', 10)`,
    [panelUri!.id, kode, nama, JSON.stringify(["Negatif", "+1", "+2", "+3", "+4"])],
  );
  jumlahParam++;
}
log(`   ${PANEL.length} panel, ${jumlahParam} parameter (semua bernilai rujukan)`);

// =====================================================================
langkah(8, "Kategori, supplier, katalog");
// =====================================================================
const KATEGORI: [string, string][] = [
  ["Analgesik & Antipiretik", "obat"], ["Antibiotik", "obat"],
  ["Antihistamin", "obat"], ["Saluran Cerna", "obat"],
  ["Kardiovaskular", "obat"], ["Antidiabetes", "obat"],
  ["Saluran Napas", "obat"], ["Vitamin & Suplemen", "obat"],
  ["Kortikosteroid", "obat"], ["Bahan Racikan", "obat"],
  ["Perawatan Luka", "bmhp"], ["Habis Pakai Umum", "bmhp"],
  ["Injeksi & Infus", "bmhp"],
];
const katId: Record<string, number> = {};
for (const [nama, tipe] of KATEGORI) {
  const r = await execute(
    `INSERT INTO item_categories (nama, tipe) VALUES (?,?)
     ON DUPLICATE KEY UPDATE nama = VALUES(nama)`,
    [nama, tipe],
  );
  katId[nama] = r.insertId;
}

for (const [kode, nama, kontak, telepon] of [
  ["SUP-001", "PT Kimia Farma Trading", "Bpk. Anwar", "022-4201122"],
  ["SUP-002", "PT Anugrah Pharmindo Lestari", "Ibu Sari", "022-7311455"],
  ["SUP-003", "PT Enseval Putera Megatrading", "Bpk. Joko", "022-6031299"],
  ["SUP-004", "CV Medika Alkes Nusantara", "Ibu Rani", "022-5223377"],
] as const) {
  await execute(
    `INSERT INTO suppliers (kode, nama, kontak, telepon) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE nama = VALUES(nama)`,
    [kode, nama, kontak, telepon],
  );
}

//  kode, tipe, nama, generik, bentuk, satuan, hpp, jual, min, racik, resep, kategori
const ITEM: [string, string, string, string | null, string | null, string, number, number, number, number, number, string][] = [
  ["OBT-001", "obat", "Paracetamol 500 mg", "Paracetamol", "Tablet", "tablet", 250, 800, 200, 1, 0, "Analgesik & Antipiretik"],
  ["OBT-002", "obat", "Ibuprofen 400 mg", "Ibuprofen", "Tablet", "tablet", 450, 1200, 100, 1, 0, "Analgesik & Antipiretik"],
  ["OBT-003", "obat", "Asam Mefenamat 500 mg", "Mefenamic Acid", "Kaplet", "tablet", 400, 1100, 100, 1, 1, "Analgesik & Antipiretik"],
  ["OBT-004", "obat", "Antalgin 500 mg", "Metampiron", "Tablet", "tablet", 350, 900, 80, 1, 1, "Analgesik & Antipiretik"],
  ["OBT-010", "obat", "Amoksisilin 500 mg", "Amoxicillin", "Kaplet", "tablet", 900, 2000, 150, 1, 1, "Antibiotik"],
  ["OBT-011", "obat", "Sefadroksil 500 mg", "Cefadroxil", "Kapsul", "kapsul", 1800, 4000, 80, 0, 1, "Antibiotik"],
  ["OBT-012", "obat", "Siprofloksasin 500 mg", "Ciprofloxacin", "Tablet", "tablet", 1200, 2800, 60, 0, 1, "Antibiotik"],
  ["OBT-013", "obat", "Kotrimoksazol 480 mg", "Cotrimoxazole", "Tablet", "tablet", 500, 1400, 60, 1, 1, "Antibiotik"],
  ["OBT-014", "obat", "Amoksisilin Sirup Kering 125 mg", "Amoxicillin", "Sirup", "botol", 12000, 25000, 20, 0, 1, "Antibiotik"],
  ["OBT-020", "obat", "Cetirizine 10 mg", "Cetirizine", "Tablet", "tablet", 500, 1500, 80, 1, 0, "Antihistamin"],
  ["OBT-021", "obat", "Klorfeniramin Maleat 4 mg", "CTM", "Tablet", "tablet", 150, 500, 200, 1, 0, "Antihistamin"],
  ["OBT-022", "obat", "Loratadine 10 mg", "Loratadine", "Tablet", "tablet", 700, 1800, 50, 1, 0, "Antihistamin"],
  ["OBT-030", "obat", "Omeprazole 20 mg", "Omeprazole", "Kapsul", "kapsul", 900, 2200, 80, 0, 1, "Saluran Cerna"],
  ["OBT-031", "obat", "Antasida Doen", "Antasida", "Tablet Kunyah", "tablet", 200, 700, 150, 1, 0, "Saluran Cerna"],
  ["OBT-032", "obat", "Ranitidin 150 mg", "Ranitidine", "Tablet", "tablet", 600, 1600, 60, 1, 1, "Saluran Cerna"],
  ["OBT-033", "obat", "Oralit Sachet", "Oralit", "Serbuk", "sachet", 1200, 3000, 100, 0, 0, "Saluran Cerna"],
  ["OBT-034", "obat", "Domperidone 10 mg", "Domperidone", "Tablet", "tablet", 700, 1800, 50, 1, 1, "Saluran Cerna"],
  ["OBT-040", "obat", "Amlodipin 10 mg", "Amlodipine", "Tablet", "tablet", 400, 1200, 120, 1, 1, "Kardiovaskular"],
  ["OBT-041", "obat", "Captopril 25 mg", "Captopril", "Tablet", "tablet", 300, 900, 100, 1, 1, "Kardiovaskular"],
  ["OBT-042", "obat", "Simvastatin 20 mg", "Simvastatin", "Tablet", "tablet", 600, 1600, 60, 1, 1, "Kardiovaskular"],
  ["OBT-050", "obat", "Metformin 500 mg", "Metformin", "Tablet", "tablet", 400, 1100, 120, 1, 1, "Antidiabetes"],
  ["OBT-051", "obat", "Glimepiride 2 mg", "Glimepiride", "Tablet", "tablet", 800, 2000, 50, 1, 1, "Antidiabetes"],
  ["OBT-060", "obat", "Ambroksol 30 mg", "Ambroxol", "Tablet", "tablet", 450, 1300, 80, 1, 0, "Saluran Napas"],
  ["OBT-061", "obat", "Gliseril Guaiakolat 100 mg", "GG", "Tablet", "tablet", 200, 600, 200, 1, 0, "Saluran Napas"],
  ["OBT-062", "obat", "Salbutamol 2 mg", "Salbutamol", "Tablet", "tablet", 350, 1000, 80, 1, 1, "Saluran Napas"],
  ["OBT-063", "obat", "Nebul Salbutamol 2.5 mg", "Salbutamol", "Nebule", "ampul", 8000, 18000, 30, 0, 1, "Saluran Napas"],
  ["OBT-070", "obat", "Vitamin B Kompleks", "Vit B Complex", "Tablet", "tablet", 200, 700, 150, 1, 0, "Vitamin & Suplemen"],
  ["OBT-071", "obat", "Vitamin C 500 mg", "Ascorbic Acid", "Tablet", "tablet", 300, 900, 150, 1, 0, "Vitamin & Suplemen"],
  ["OBT-072", "obat", "Zinc 20 mg", "Zinc Sulfate", "Tablet", "tablet", 500, 1400, 80, 1, 0, "Vitamin & Suplemen"],
  ["OBT-080", "obat", "Deksametason 0.5 mg", "Dexamethasone", "Tablet", "tablet", 200, 600, 150, 1, 1, "Kortikosteroid"],
  ["OBT-081", "obat", "Metilprednisolon 4 mg", "Methylprednisolone", "Tablet", "tablet", 700, 1800, 60, 1, 1, "Kortikosteroid"],
  ["OBT-090", "obat", "Laktosa Serbuk (bahan racikan)", "Saccharum Lactis", "Serbuk", "gram", 100, 300, 500, 1, 0, "Bahan Racikan"],
  ["BMP-001", "bmhp", "Kasa Steril 10x10 cm", null, null, "pcs", 2500, 5000, 100, 0, 0, "Perawatan Luka"],
  ["BMP-002", "bmhp", "Plester Rol 5 cm", null, null, "rol", 8000, 15000, 30, 0, 0, "Perawatan Luka"],
  ["BMP-003", "bmhp", "Kapas 250 gram", null, null, "bungkus", 12000, 22000, 20, 0, 0, "Perawatan Luka"],
  ["BMP-004", "bmhp", "Povidone Iodine 60 ml", null, null, "botol", 9000, 18000, 30, 0, 0, "Perawatan Luka"],
  ["BMP-005", "bmhp", "Verban Elastis 4 inch", null, null, "rol", 11000, 20000, 25, 0, 0, "Perawatan Luka"],
  ["BMP-010", "bmhp", "Handscoon Steril 7.5", null, null, "pasang", 3000, 6000, 100, 0, 0, "Habis Pakai Umum"],
  ["BMP-011", "bmhp", "Masker Bedah 3 Ply", null, null, "pcs", 700, 1500, 300, 0, 0, "Habis Pakai Umum"],
  ["BMP-012", "bmhp", "Alkohol Swab", null, null, "pcs", 300, 800, 400, 0, 0, "Habis Pakai Umum"],
  ["BMP-020", "bmhp", "Spuit 3 cc", null, null, "pcs", 1800, 4000, 100, 0, 0, "Injeksi & Infus"],
  ["BMP-021", "bmhp", "Spuit 5 cc", null, null, "pcs", 2200, 4500, 80, 0, 0, "Injeksi & Infus"],
  ["BMP-022", "bmhp", "Infus Set Dewasa", null, null, "set", 9000, 18000, 30, 0, 0, "Injeksi & Infus"],
  ["BMP-023", "bmhp", "IV Catheter No. 20", null, null, "pcs", 7000, 14000, 40, 0, 0, "Injeksi & Infus"],
  ["BMP-024", "bmhp", "Infus RL 500 ml", null, null, "kolf", 12000, 25000, 40, 0, 0, "Injeksi & Infus"],
];

const itemId: Record<string, number> = {};
for (const [kode, tipe, nama, generik, bentuk, satuan, hpp, jual, min, racik, resep, kategori] of ITEM) {
  const r = await execute(
    `INSERT INTO items
       (kode, tipe, nama, nama_generik, bentuk_sediaan, satuan_dasar,
        hpp, harga_jual, min_stock, is_racikable, butuh_resep, category_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE nama = VALUES(nama)`,
    [kode, tipe, nama, generik, bentuk, satuan, hpp, jual, min, racik, resep, katId[kategori]],
  );
  itemId[kode] = r.insertId;
}
log(`   ${KATEGORI.length} kategori, 4 supplier, ${ITEM.length} item katalog`);

// =====================================================================
langkah(9, "Saldo awal stok per cabang (lewat Penerimaan)");
// =====================================================================
const supplierUtama = await queryOne<RowDataPacket & { id: number }>(
  `SELECT id FROM suppliers WHERE kode = 'SUP-001'`,
);

/**
 * Setiap cabang menerima stok sendiri dengan jumlah berbeda. Pusat paling
 * besar, Sumedang paling kecil — perbedaan itu membuat kekeliruan
 * "stok cabang tertukar" langsung kelihatan saat pengujian.
 */
const STOK: Record<string, { qty: number; hariKadaluarsa: number }> = {
  PST: { qty: 300, hariKadaluarsa: 540 },
  CMH: { qty: 180, hariKadaluarsa: 420 },
  SMD: { qty: 90, hariKadaluarsa: 365 },
};

const petugasCabang: Record<string, string> = {
  PST: "farmasi.pst", CMH: "farmasi.cmh", SMD: "farmasi.smd",
};

for (const kode of ["PST", "CMH", "SMD"] as const) {
  const { qty, hariKadaluarsa } = STOK[kode];
  const baris = ITEM.map(([k, , , , , , hpp], i) => ({
    item_id: itemId[k],
    no_batch: `${kode}-B${String(i + 1).padStart(3, "0")}`,
    // Kadaluarsa disebar supaya daftar Monitoring Kadaluarsa tidak seragam.
    tanggal_kadaluarsa: hari(hariKadaluarsa + (i % 7) * 45),
    qty: Math.round(qty * (0.6 + ((i % 5) * 0.2))),
    harga_satuan: hpp,
  }));

  const hasil = await catatPenerimaan(
    penerimaanSchema.parse({
      supplier_id: Number(supplierUtama!.id),
      no_faktur: `FK/${kode}/SALDO-AWAL`,
      tanggal: tanggalHariIni(),
      diskon: 0, ppn: 0,
      catatan: "Saldo awal gudang",
      perbarui_hpp: false,
      items: baris,
    }),
    siteId[kode],
    userId[petugasCabang[kode]],
  );
  log(`   ${kode}  ${hasil.no_penerimaan}  ${hasil.jumlahItem} item`);
}

/*
 * Dua batch khusus HANYA di Pusat, supaya fitur yang paling sulit diuji
 * manual punya data sejak awal:
 *
 *   - satu batch kadaluarsa 20 hari lagi  -> muncul di Monitoring Kadaluarsa
 *   - satu batch YANG SUDAH kadaluarsa    -> harus TERKUNCI dari penyerahan
 *     ke pasien, dan pesan "stok tidak cukup" harus menyebut jumlah yang
 *     terkunci itu. Tanpa data seperti ini, perilaku tersebut hanya bisa
 *     dipercaya, bukan dilihat.
 */
await catatPenerimaan(
  penerimaanSchema.parse({
    supplier_id: Number(supplierUtama!.id),
    no_faktur: "FK/PST/BATCH-UJI",
    tanggal: tanggalHariIni(),
    diskon: 0, ppn: 0,
    catatan: "Batch uji kadaluarsa — sengaja untuk pengujian",
    perbarui_hpp: false,
    items: [
      { item_id: itemId["OBT-001"], no_batch: "PST-EXP-SOON", tanggal_kadaluarsa: hari(20), qty: 40, harga_satuan: 250 },
      { item_id: itemId["OBT-010"], no_batch: "PST-EXPIRED", tanggal_kadaluarsa: hari(-15), qty: 25, harga_satuan: 900 },
    ],
  }),
  siteId.PST,
  userId["farmasi.pst"],
);
log("   PST  + batch hampir kadaluarsa (20 hari) & batch SUDAH kadaluarsa (uji kunci FEFO)");

// =====================================================================
// Verifikasi
// =====================================================================
console.log("\n" + "=".repeat(66));

const cek = await query<RowDataPacket & {
  kode: string; nama: string; staf: number; poli: number; jadwal: number;
  item: number; saldo: number;
}>(
  `SELECT s.kode, s.nama,
          (SELECT COUNT(*) FROM users u WHERE u.site_id = s.id) AS staf,
          (SELECT COUNT(*) FROM polis p WHERE p.site_id = s.id) AS poli,
          (SELECT COUNT(*) FROM doctor_schedules d WHERE d.site_id = s.id) AS jadwal,
          (SELECT COUNT(*) FROM item_stocks i WHERE i.site_id = s.id AND i.qty_on_hand > 0) AS item,
          (SELECT COALESCE(SUM(i.qty_on_hand),0) FROM item_stocks i WHERE i.site_id = s.id) AS saldo
     FROM sites s ORDER BY s.kode`,
);

console.log("\nRINGKASAN PER CABANG");
console.log("  kode  staf  poli  jadwal  item  total stok");
for (const r of cek) {
  console.log(
    `  ${r.kode.padEnd(5)} ${String(r.staf).padStart(4)} ${String(r.poli).padStart(5)} ` +
      `${String(r.jadwal).padStart(7)} ${String(r.item).padStart(5)} ` +
      `${Number(r.saldo).toLocaleString("id-ID").padStart(11)}`,
  );
}

// Invarian kartu stok — data contoh tidak boleh melanggar aturan sistemnya sendiri.
const bocor = await query<RowDataPacket & { kode: string; cache: number; ledger: number }>(
  `SELECT i.kode,
          st.qty_on_hand AS cache,
          COALESCE((SELECT SUM(m.qty_delta) FROM stock_movements m
                     WHERE m.item_id = st.item_id AND m.site_id = st.site_id), 0) AS ledger
     FROM item_stocks st JOIN items i ON i.id = st.item_id
    HAVING cache <> ledger`,
);

console.log(
  bocor.length === 0
    ? "\n  Kartu stok konsisten: saldo = jumlah pergerakan untuk SEMUA item."
    : `\n  PERINGATAN: ${bocor.length} item saldonya tidak cocok dengan kartu stok!`,
);

console.log(`
AKUN — password semuanya "${PASSWORD}"

  superadmin                              Super Admin (lintas cabang)

  Pusat Bandung        Cimahi              Sumedang
  admin.pst            admin.cmh           admin.smd
  perawat.pst          perawat.cmh         perawat.smd
  lab.pst              lab.cmh             lab.smd
  farmasi.pst          farmasi.cmh         farmasi.smd
  kasir.pst            kasir.cmh           kasir.smd
  dr.rafi, drg.sinta   dr.putri            (tidak ada dokter tetap)

  LINTAS CABANG
  dr.bayu         Pusat + Cimahi + Sumedang   -> pemilih cabang aktif
  admin.wilayah   Pusat + Cimahi              -> pemilih cabang aktif

  Sumedang sengaja tanpa dokter tetap: Jum-Sab dilayani dr.bayu. Login
  sebagai dr.bayu lalu berpindah cabang untuk menguji jalur multi-cabang.

  Perubahan penugasan cabang baru berlaku setelah login ulang — daftar
  penugasan ikut di dalam token sesi yang ditandatangani.
`);

await pool.end();
