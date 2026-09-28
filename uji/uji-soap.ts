/**
 * Uji SOAP terstruktur di form dokter.
 *
 *   node uji/jalankan.mjs uji-soap.ts
 *
 * Empat hal yang bisa salah dan tidak akan terlihat dari layar:
 *
 *   1. Suntingan dokter menimpa catatan PERAWAT. Keduanya adalah pernyataan
 *      dua orang pada dua tahap; menimpa yang satu menghapus jejak siapa
 *      mencatat apa — justru yang dicari saat rekam medis dipersoalkan.
 *   2. Diagnosa BANDING dihitung sebagai diagnosa yang ditegakkan, sehingga
 *      asesmen berisi tiga kemungkinan dan nol kepastian lolos difinalkan.
 *   3. Titik body diagram hilang atau bergeser saat disimpan-baca ulang.
 *   4. Alloanamnesis tersimpan tanpa menyebut sumbernya.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne } from "../src/lib/db";
import { bacaStatusLokalis, getAsesmen, getDiagnosa, simpanAsesmen } from "../src/lib/doctor";
import { asesmenSchema, REGIO_PEMERIKSAAN } from "../src/lib/validations/doctor";
import { detailRekamMedis } from "../src/lib/rekam-medis";
import { tanggalHariIni } from "../src/lib/tanggal";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

const TANDA = "UJISOAP";
const hariIni = tanggalHariIni();

// =====================================================================
// Persiapan
// =====================================================================
async function bersih() {
  const sites = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM sites WHERE kode LIKE '${TANDA}%'`)
  ).map((r) => r.id);
  if (sites.length) {
    const s = sites.join(",");
    await execute(`DELETE FROM billing_items WHERE billing_id IN (SELECT id FROM billing_transactions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM billing_transactions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM assessment_diagnoses WHERE assessment_id IN (SELECT id FROM medical_assessments WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM assessment_procedures WHERE assessment_id IN (SELECT id FROM medical_assessments WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM medical_assessments WHERE site_id IN (${s})`);
    await execute(`DELETE FROM nurse_assessments WHERE site_id IN (${s})`);
    await execute(`DELETE FROM visits WHERE site_id IN (${s})`);
    await execute(`DELETE FROM patients WHERE site_id IN (${s})`);
    await execute(`DELETE FROM polis WHERE site_id IN (${s})`);
    await execute(`DELETE FROM sequences WHERE site_id IN (${s})`);
    await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
    await execute(`DELETE FROM sites WHERE id IN (${s})`);
  } else {
    await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
  }
  await execute(`DELETE FROM icd10_codes WHERE code LIKE '${TANDA}%'`);
}
await bersih();

const site = (await execute(
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}', 'Uji SOAP')`,
)).insertId;

const roleId = async (c: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM roles WHERE code = ?`, [c]))!.id);

const dokter = (await execute(
  `INSERT INTO users (site_id, role_id, nama, username, password_hash)
   VALUES (?,?, 'dr. Uji SOAP', '${TANDA}.dokter', 'x')`, [site, await roleId("dokter")],
)).insertId;
const perawat = (await execute(
  `INSERT INTO users (site_id, role_id, nama, username, password_hash)
   VALUES (?,?, 'Perawat Uji', '${TANDA}.perawat', 'x')`, [site, await roleId("perawat")],
)).insertId;

const poli = (await execute(
  `INSERT INTO polis (site_id, kode, nama) VALUES (?, '${TANDA}-P', 'Poli Uji')`, [site],
)).insertId;

for (const [kode, nama] of [
  [`${TANDA}1.1`, "Diagnosa Utama Uji"],
  [`${TANDA}2.2`, "Diagnosa Sekunder Uji"],
  [`${TANDA}3.3`, "Diagnosa Banding Uji"],
]) {
  await execute(
    `INSERT INTO icd10_codes (code, nama_id, nama_en) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE nama_id = VALUES(nama_id)`,
    [kode, nama, nama],
  );
}

let n = 0;
/** Kunjungan lengkap dengan pengkajian perawat, seperti alur sesungguhnya. */
async function buatKunjungan() {
  n++;
  const pasien = (await execute(
    `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin)
     VALUES (?,?,?,?, '1990-01-01', 'P')`,
    [site, `${TANDA}-${n}`, `327300000008${1000 + n}`, `Pasien ${n}`],
  )).insertId;

  const visit = (await execute(
    `INSERT INTO visits (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
                         jenis_kunjungan, status, registered_by)
     VALUES (?,?,?,?,?,?, 'baru', 'menunggu_dokter', ?)`,
    [site, pasien, `${TANDA}/V/${n}`, hariIni, poli, dokter, dokter],
  )).insertId;

  await execute(
    `INSERT INTO nurse_assessments
       (visit_id, site_id, nurse_id, triase, keluhan_utama, riwayat_singkat,
        riwayat_pengobatan, keadaan_umum, keadaan_gizi)
     VALUES (?,?,?, 'hijau', 'Batuk 3 hari (versi perawat)',
             'Asma sejak kecil (versi perawat)', 'Salbutamol inhaler',
             'sedang', 'kurang')`,
    [visit, site, perawat],
  );

  return visit;
}

const soap = (extra: Record<string, unknown>) =>
  asesmenSchema.parse({
    diagnoses: [{ icd10_code: `${TANDA}1.1`, nama: "Diagnosa Utama Uji", tipe: "primer" }],
    procedures: [],
    ...extra,
  });

const bacaPerawat = async (visitId: number) =>
  queryOne<RowDataPacket & {
    keluhan_utama: string; riwayat_singkat: string; riwayat_pengobatan: string;
    keadaan_umum: string; keadaan_gizi: string;
  }>(`SELECT keluhan_utama, riwayat_singkat, riwayat_pengobatan,
             keadaan_umum, keadaan_gizi
        FROM nurse_assessments WHERE visit_id = ?`, [visitId]);

// =====================================================================
// 1. Seluruh kolom S dan O tersimpan
// =====================================================================
console.log("\n== 1. Kolom SOAP terstruktur tersimpan ==");

const v1 = await buatKunjungan();
await simpanAsesmen(v1, site, dokter, soap({
  jenis_anamnesis: "allo",
  sumber_anamnesis: "Ibu kandung",
  keluhan_utama: "Batuk 3 hari (versi dokter)",
  riwayat_penyakit: "Asma sejak kecil (versi dokter)",
  riwayat_pengobatan: "Salbutamol inhaler bila sesak",
  keadaan_umum: "baik",
  keadaan_gizi: "baik",
  assessment: "ISPA dengan riwayat asma",
  terapi: "Tirah baring, banyak minum",
  plan: "Kontrol 3 hari",
  edukasi: "Hindari debu",
  finalkan: false,
}));

const a1 = await getAsesmen(v1);
for (const [kolom, harap] of [
  ["jenis_anamnesis", "allo"],
  ["sumber_anamnesis", "Ibu kandung"],
  ["keluhan_utama", "Batuk 3 hari (versi dokter)"],
  ["riwayat_penyakit", "Asma sejak kecil (versi dokter)"],
  ["riwayat_pengobatan", "Salbutamol inhaler bila sesak"],
  ["keadaan_umum", "baik"],
  ["keadaan_gizi", "baik"],
  ["assessment", "ISPA dengan riwayat asma"],
  ["terapi", "Tirah baring, banyak minum"],
  ["plan", "Kontrol 3 hari"],
  ["edukasi", "Hindari debu"],
] as const) {
  const nyata = (a1 as unknown as Record<string, unknown>)[kolom];
  ok(`${kolom} tersimpan`, nyata === harap, String(nyata));
}

// =====================================================================
// 2. Catatan perawat TIDAK ikut berubah
// =====================================================================
console.log("\n== 2. Catatan perawat tidak tertimpa ==");

const na = await bacaPerawat(v1);
ok("keluhan utama perawat tetap versinya sendiri",
  na?.keluhan_utama === "Batuk 3 hari (versi perawat)", String(na?.keluhan_utama));
ok("riwayat perawat tetap versinya sendiri",
  na?.riwayat_singkat === "Asma sejak kecil (versi perawat)", String(na?.riwayat_singkat));
ok("keadaan umum perawat tetap 'sedang' walau dokter menilai 'baik'",
  na?.keadaan_umum === "sedang", String(na?.keadaan_umum));
ok("keadaan gizi perawat tetap 'kurang' walau dokter menilai 'baik'",
  na?.keadaan_gizi === "kurang", String(na?.keadaan_gizi));

// =====================================================================
// 2b. Kolom yang dihapus dari form tidak ikut terhapus datanya
// =====================================================================
console.log("\n== 2b. Kolom lama tidak tertimpa NULL ==");

/*
 * `objective` (Pemeriksaan Fisik Umum), `subjective` (Anamnesis Tambahan),
 * dan `riwayat_alergi` sudah dikeluarkan dari form. Bahayanya: bila ketiganya
 * masih disebut di ON DUPLICATE KEY UPDATE, setiap penyimpanan ulang asesmen
 * lama akan menimpanya menjadi NULL — data hilang tanpa satu pun pesan galat.
 */
const vLama = await buatKunjungan();
await execute(
  `INSERT INTO medical_assessments
     (visit_id, site_id, doctor_id, objective, subjective, riwayat_alergi, status)
   VALUES (?,?,?, 'Faring hiperemis (asesmen lama)', 'Catatan tambahan lama',
           'Debu, udang (teks lama)', 'draft')`,
  [vLama, site, dokter],
);

await simpanAsesmen(vLama, site, dokter, soap({
  keluhan_utama: "Diisi ulang lewat form baru",
  finalkan: false,
}));

const aLama = await getAsesmen(vLama);
ok("kolom baru tersimpan", aLama?.keluhan_utama === "Diisi ulang lewat form baru");
ok("objective lama TIDAK terhapus",
  aLama?.objective === "Faring hiperemis (asesmen lama)", String(aLama?.objective));
ok("subjective lama TIDAK terhapus",
  aLama?.subjective === "Catatan tambahan lama", String(aLama?.subjective));
ok("riwayat_alergi lama TIDAK terhapus",
  aLama?.riwayat_alergi === "Debu, udang (teks lama)", String(aLama?.riwayat_alergi));

// Skema pun tidak lagi menerimanya — kiriman apa pun dibuang zod.
const asing = asesmenSchema.parse({
  procedures: [], diagnoses: [],
  objective: "x", subjective: "y", riwayat_alergi: "z",
}) as unknown as Record<string, unknown>;
ok("objective tidak lagi diterima skema", !("objective" in asing));
ok("subjective tidak lagi diterima skema", !("subjective" in asing));
ok("riwayat_alergi tidak lagi diterima skema", !("riwayat_alergi" in asing));

// =====================================================================
// 3. Status lokalis — body diagram
// =====================================================================
console.log("\n== 3. Status lokalis (body diagram) ==");

const v2 = await buatKunjungan();
await simpanAsesmen(v2, site, dokter, soap({
  status_lokalis: {
    catatan: "Luka lecet superfisial",
    titik: [
      { sisi: "depan", x: 42.5, y: 31.2, keterangan: "Nyeri tekan epigastrium" },
      { sisi: "belakang", x: 60, y: 45, keterangan: "" },
    ],
  },
  finalkan: false,
}));

const a2 = await getAsesmen(v2);
const lok = bacaStatusLokalis(a2?.status_lokalis ?? null);
ok("dua titik tersimpan", lok.titik.length === 2, `${lok.titik.length} titik`);
ok("koordinat tidak bergeser",
  lok.titik[0]?.x === 42.5 && lok.titik[0]?.y === 31.2,
  `${lok.titik[0]?.x}, ${lok.titik[0]?.y}`);
ok("sisi tersimpan benar",
  lok.titik[0]?.sisi === "depan" && lok.titik[1]?.sisi === "belakang");
ok("keterangan per titik tersimpan",
  lok.titik[0]?.keterangan === "Nyeri tekan epigastrium", lok.titik[0]?.keterangan);
ok("titik tanpa keterangan tetap tersimpan", lok.titik[1]?.keterangan === "");
ok("catatan lokalis tersimpan", lok.catatan === "Luka lecet superfisial", String(lok.catatan));

// Status lokalis kosong disimpan NULL, bukan JSON "{}" yang menyesatkan.
const v3 = await buatKunjungan();
await simpanAsesmen(v3, site, dokter, soap({ finalkan: false }));
const a3 = await getAsesmen(v3);
ok("status lokalis kosong disimpan NULL", a3?.status_lokalis === null, String(a3?.status_lokalis));
ok("dibaca kembali sebagai bentuk kosong yang aman",
  bacaStatusLokalis(a3?.status_lokalis ?? null).titik.length === 0);

// JSON rusak tidak boleh menggagalkan layar.
await execute(`UPDATE medical_assessments SET status_lokalis = '{rusak' WHERE visit_id = ?`, [v3]);
const rusak = bacaStatusLokalis(
  (await getAsesmen(v3))?.status_lokalis ?? null,
);
ok("JSON rusak dibaca sebagai kosong, bukan melempar galat", rusak.titik.length === 0);

// =====================================================================
// 3b. Pemeriksaan fisik per regio (kepala → kulit)
// =====================================================================
console.log("\n== 3b. Regio pemeriksaan fisik ==");

/*
 * Urutan dan isi daftar mengikuti formulir Status Lokalis KPSG. Diuji
 * eksplisit karena daftar ini yang tercetak di rekam medis — regio yang
 * hilang atau tertukar urutannya membuat cetakan tidak cocok dengan formulir
 * kertas yang dipakai klinik.
 */
const REGIO_HARAP = [
  "kepala", "mata", "hidung", "telinga", "tenggorokan", "leher",
  "dada", "jantung", "paru", "perut", "hati", "limpa",
  "punggung", "genitalia", "ekstremitas", "kulit",
];
ok("daftar regio sama persis dengan formulir",
  REGIO_PEMERIKSAAN.map((r) => r.kunci).join(",") === REGIO_HARAP.join(","),
  `${REGIO_PEMERIKSAAN.length} regio: ${REGIO_PEMERIKSAAN.map((r) => r.kunci).join(", ")}`);
ok("kepala pertama, kulit terakhir",
  REGIO_PEMERIKSAAN[0].kunci === "kepala" &&
  REGIO_PEMERIKSAAN[REGIO_PEMERIKSAAN.length - 1].kunci === "kulit");

const v6 = await buatKunjungan();
await simpanAsesmen(v6, site, dokter, soap({
  status_lokalis: {
    titik: [],
    regio: {
      kepala: { dbn: true, temuan: "" },
      mata: { dbn: false, temuan: "Konjungtiva anemis +/+" },
      perut: { dbn: false, temuan: "Nyeri tekan epigastrium" },
      // Tidak diperiksa — tidak boleh ikut tersimpan.
      genitalia: { dbn: false, temuan: "" },
      // Kunci tak dikenal harus dibuang — termasuk nama regio LAMA yang
      // sudah diganti, supaya sisa data tidak diam-diam ikut tercetak.
      abdomen: { dbn: false, temuan: "nama regio lama" },
      ekor_naga: { dbn: true, temuan: "seharusnya hilang" },
    },
  },
  finalkan: false,
}));

const lok6 = bacaStatusLokalis((await getAsesmen(v6))?.status_lokalis ?? null);
ok("regio DBN tersimpan", lok6.regio.kepala?.dbn === true);
ok("regio dengan temuan tersimpan",
  lok6.regio.mata?.temuan === "Konjungtiva anemis +/+", lok6.regio.mata?.temuan);
ok("regio kosong TIDAK tersimpan — beda dari 'diperiksa, normal'",
  lok6.regio.genitalia === undefined,
  JSON.stringify(lok6.regio.genitalia));
ok("kunci regio tak dikenal dibuang",
  lok6.regio.ekor_naga === undefined, JSON.stringify(lok6.regio.ekor_naga));
ok("nama regio lama ikut dibuang",
  lok6.regio.abdomen === undefined, JSON.stringify(lok6.regio.abdomen));
ok("hanya tiga regio tersimpan", Object.keys(lok6.regio).length === 3,
  Object.keys(lok6.regio).join(", "));

// Regio ikut ke lembar cetak.
const rm6 = await detailRekamMedis(v6, "Petugas Uji");
ok("regio ikut ke cetakan rekam medis",
  Object.keys(rm6?.lokalis.regio ?? {}).length === 3,
  Object.keys(rm6?.lokalis.regio ?? {}).join(", "));

// Asesmen yang HANYA berisi regio tetap tersimpan (bukan dianggap kosong).
const v7 = await buatKunjungan();
await simpanAsesmen(v7, site, dokter, soap({
  status_lokalis: { titik: [], regio: { kulit: { dbn: true, temuan: "" } } },
  finalkan: false,
}));
ok("status_lokalis berisi regio saja tidak disimpan NULL",
  (await getAsesmen(v7))?.status_lokalis !== null);

// =====================================================================
// 4. Diagnosa banding
// =====================================================================
console.log("\n== 4. Diagnosa banding ==");

const v4 = await buatKunjungan();
await simpanAsesmen(v4, site, dokter, {
  ...soap({ finalkan: false }),
  diagnoses: [
    { icd10_code: `${TANDA}1.1`, nama: "Diagnosa Utama Uji", tipe: "primer", keterangan: undefined },
    { icd10_code: `${TANDA}2.2`, nama: "Diagnosa Sekunder Uji", tipe: "sekunder", keterangan: undefined },
    { icd10_code: `${TANDA}3.3`, nama: "Diagnosa Banding Uji", tipe: "banding", keterangan: undefined },
  ],
});

const dx = await getDiagnosa(v4);
ok("tiga diagnosa tersimpan", dx.length === 3, `${dx.length}`);
ok("tipe banding benar-benar tersimpan",
  dx.some((d) => d.tipe === "banding"), dx.map((d) => d.tipe).join(", "));

/*
 * Inti aturannya: banding TIDAK dihitung. Asesmen berisi tiga kemungkinan
 * dan nol kepastian belum menyatakan apa pun.
 */
const hanyaBanding = asesmenSchema.safeParse({
  finalkan: true,
  procedures: [],
  diagnoses: [
    { icd10_code: `${TANDA}3.3`, nama: "Banding", tipe: "banding" },
    { icd10_code: `${TANDA}2.2`, nama: "Banding 2", tipe: "banding" },
  ],
});
ok("finalisasi dengan diagnosa banding saja DITOLAK", !hanyaBanding.success,
  hanyaBanding.success ? "lolos" : hanyaBanding.error.issues[0].message);
ok("pesannya menjelaskan sebabnya",
  !hanyaBanding.success && /banding/i.test(hanyaBanding.error.issues[0].message));

const utamaPlusBanding = asesmenSchema.safeParse({
  finalkan: true,
  procedures: [],
  diagnoses: [
    { icd10_code: `${TANDA}1.1`, nama: "Utama", tipe: "primer" },
    { icd10_code: `${TANDA}3.3`, nama: "Banding", tipe: "banding" },
  ],
});
ok("satu utama + banding diterima", utamaPlusBanding.success,
  utamaPlusBanding.success ? "" : utamaPlusBanding.error.issues[0].message);

const duaUtama = asesmenSchema.safeParse({
  finalkan: true,
  procedures: [],
  diagnoses: [
    { icd10_code: `${TANDA}1.1`, nama: "A", tipe: "primer" },
    { icd10_code: `${TANDA}2.2`, nama: "B", tipe: "primer" },
  ],
});
ok("dua diagnosa utama ditolak", !duaUtama.success);

// =====================================================================
// 5. Alloanamnesis wajib menyebut sumber
// =====================================================================
console.log("\n== 5. Alloanamnesis ==");

const alloKosong = asesmenSchema.safeParse({
  finalkan: false, procedures: [], diagnoses: [], jenis_anamnesis: "allo",
});
ok("alloanamnesis tanpa sumber ditolak", !alloKosong.success,
  alloKosong.success ? "lolos" : alloKosong.error.issues[0].message);
ok("galat menunjuk ke field sumbernya",
  !alloKosong.success && alloKosong.error.issues[0].path[0] === "sumber_anamnesis");

const autoDenganSumber = asesmenSchema.safeParse({
  finalkan: false, procedures: [], diagnoses: [],
  jenis_anamnesis: "auto", sumber_anamnesis: "Ibu",
});
ok("autoanamnesis tidak butuh sumber", autoDenganSumber.success);

/*
 * Sumber yang sempat terketik lalu jenisnya diubah ke auto harus DIBUANG —
 * bukan tersimpan diam-diam dan muncul lagi di lembar cetak.
 */
const v5 = await buatKunjungan();
await simpanAsesmen(v5, site, dokter, soap({
  jenis_anamnesis: "auto", sumber_anamnesis: "Sisa isian lama", finalkan: false,
}));
ok("sumber dibuang bila autoanamnesis",
  (await getAsesmen(v5))?.sumber_anamnesis === null,
  String((await getAsesmen(v5))?.sumber_anamnesis));

// =====================================================================
// 6. Ikut terbawa ke lembar rekam medis
// =====================================================================
console.log("\n== 6. Terbawa ke cetakan rekam medis ==");

const rm = await detailRekamMedis(v1, "Petugas Uji");
ok("rekam medis terakit", rm !== null);
ok("keluhan utama versi DOKTER yang tercetak",
  rm?.asesmen?.keluhan_utama === "Batuk 3 hari (versi dokter)",
  String(rm?.asesmen?.keluhan_utama));
ok("jenis anamnesis ikut", rm?.asesmen?.jenis_anamnesis === "allo");
ok("sumber anamnesis ikut", rm?.asesmen?.sumber_anamnesis === "Ibu kandung");
ok("terapi ikut", rm?.asesmen?.terapi === "Tirah baring, banyak minum");
ok("keadaan umum/gizi ikut",
  rm?.asesmen?.keadaan_umum === "baik" && rm?.asesmen?.keadaan_gizi === "baik");

const rm2 = await detailRekamMedis(v2, "Petugas Uji");
ok("titik lokalis ikut ke cetakan", rm2?.lokalis.titik.length === 2,
  `${rm2?.lokalis.titik.length} titik`);

// =====================================================================
await bersih();
console.log(`\n${gagal === 0 ? "SEMUA UJI LULUS" : `${gagal} UJI GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
