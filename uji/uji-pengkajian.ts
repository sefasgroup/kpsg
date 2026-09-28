/**
 * Uji parameter tambahan pengkajian perawat + pencatatan alergi.
 *
 *   node uji/jalankan.mjs uji-pengkajian.ts
 *
 * Butuh data contoh (scripts/data-contoh.ts).
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne } from "@/lib/db";
import { alergiPasien, tambahAlergi } from "@/lib/nurse";
import { alergiSchema, nurseAssessmentSchema } from "@/lib/validations/nurse";

let gagal = 0;
const ok = (n: string, l: boolean, d = "") => {
  console.log(`  ${l ? "PASS" : "GAGAL"}  ${n}${d ? " — " + d : ""}`);
  if (!l) gagal++;
};

const dasar = { triase: "hijau", keluhan_utama: "demam 3 hari" };

// =====================================================================
console.log("\n== Rentang GCS per komponen ==");
// =====================================================================
/*
 * Rentangnya BERBEDA: E 1-4, V 1-5, M 1-6. Membatasinya seragam akan
 * meloloskan E5 — nilai yang tidak ada dalam skala tapi menghasilkan total
 * yang tampak masuk akal, dan angka GCS dipakai memutuskan rujukan.
 */
for (const [f, nilai, sah] of [
  ["gcs_e", 4, true], ["gcs_e", 5, false], ["gcs_e", 0, false],
  ["gcs_v", 5, true], ["gcs_v", 6, false],
  ["gcs_m", 6, true], ["gcs_m", 7, false],
] as const) {
  const h = nurseAssessmentSchema.safeParse({ ...dasar, [f]: nilai });
  ok(`${f}=${nilai} ${sah ? "diterima" : "ditolak"}`, h.success === sah);
}

ok("GCS boleh dikosongkan seluruhnya",
  nurseAssessmentSchema.safeParse({ ...dasar, gcs_e: "", gcs_v: "", gcs_m: "" }).success);

// =====================================================================
console.log("\n== Rentang GCS juga ditegakkan database ==");
// =====================================================================
const visit = await queryOne<RowDataPacket & { id: number; site_id: number }>(
  `SELECT id, site_id FROM visits ORDER BY id LIMIT 1`,
);
const perawat = await queryOne<RowDataPacket & { id: number }>(
  `SELECT id FROM users WHERE username = 'perawat.pst'`,
);

if (!visit) {
  console.log("  (dilewati — belum ada kunjungan)");
} else {
  let ditolak = false;
  try {
    await execute(
      `INSERT INTO nurse_assessments (visit_id, site_id, nurse_id, triase, keluhan_utama, gcs_e)
       VALUES (?,?,?, 'hijau', 'uji', 9)
       ON DUPLICATE KEY UPDATE gcs_e = 9`,
      [visit.id, visit.site_id, perawat!.id],
    );
  } catch { ditolak = true; }
  ok("INSERT langsung dengan gcs_e=9 ditolak database", ditolak,
    "validasi form bisa dilewati; database adalah pertahanan terakhir");
  await execute(`DELETE FROM nurse_assessments WHERE visit_id = ? AND keluhan_utama = 'uji'`,
    [visit.id]);
}

// =====================================================================
console.log("\n== Keadaan umum & gizi ==");
// =====================================================================
ok("keadaan_umum sah", nurseAssessmentSchema.safeParse({ ...dasar, keadaan_umum: "sedang" }).success);
ok("keadaan_umum 'kurang' ditolak (itu milik gizi)",
  !nurseAssessmentSchema.safeParse({ ...dasar, keadaan_umum: "kurang" }).success);
ok("keadaan_gizi sah", nurseAssessmentSchema.safeParse({ ...dasar, keadaan_gizi: "kurang" }).success);
ok("keadaan_gizi 'sedang' ditolak (itu milik keadaan umum)",
  !nurseAssessmentSchema.safeParse({ ...dasar, keadaan_gizi: "sedang" }).success);

// =====================================================================
console.log("\n== Riwayat pengobatan terpisah dari riwayat penyakit ==");
// =====================================================================
const h = nurseAssessmentSchema.safeParse({
  ...dasar,
  riwayat_singkat: "Hipertensi sejak 2019",
  riwayat_pengobatan: "Amlodipin 10 mg 1x1",
});
ok("keduanya diterima sebagai field terpisah",
  h.success && h.data.riwayat_singkat !== h.data.riwayat_pengobatan);

// =====================================================================
console.log("\n== Alergi menempel pada PASIEN, bukan kunjungan ==");
// =====================================================================
const pasien = await queryOne<RowDataPacket & { id: number }>(
  `SELECT id FROM patients ORDER BY id LIMIT 1`,
);

if (!pasien) {
  console.log("  (dilewati — belum ada pasien)");
} else {
  const pid = Number(pasien.id);
  await execute(`DELETE FROM patient_allergies WHERE patient_id = ? AND nama_alergen LIKE 'UJI%'`, [pid]);

  await tambahAlergi(pid, alergiSchema.parse({
    jenis: "obat", nama_alergen: "UJI Amoksisilin", reaksi: "ruam", keparahan: "sedang",
  }), Number(perawat!.id));

  const d1 = (await alergiPasien(pid)).filter((a) => a.nama_alergen.startsWith("UJI"));
  ok("alergi tercatat", d1.length === 1, d1[0]?.nama_alergen);
  ok("tersimpan di patient_allergies, bukan nurse_assessments",
    Number((await queryOne<RowDataPacket & { n: number }>(
      `SELECT COUNT(*) n FROM patient_allergies WHERE patient_id = ? AND nama_alergen LIKE 'UJI%'`,
      [pid]))?.n) === 1);

  // Duplikat: perawat berbeda di kunjungan berbeda mencatat hal yang sama.
  await tambahAlergi(pid, alergiSchema.parse({
    jenis: "obat", nama_alergen: "uji amoksisilin", // beda kapitalisasi
  }), Number(perawat!.id));
  const d2 = (await alergiPasien(pid)).filter((a) => a.nama_alergen.startsWith("UJI"));
  ok("alergen sama tidak digandakan meski beda kapitalisasi", d2.length === 1,
    `${d2.length} baris — pita alergi yang mengulang justru sulit dibaca`);

  // Melengkapi keterangan yang kosong, bukan menimpa yang sudah ada.
  await execute(`DELETE FROM patient_allergies WHERE patient_id = ? AND nama_alergen LIKE 'UJI%'`, [pid]);
  await tambahAlergi(pid, alergiSchema.parse({ nama_alergen: "UJI Udang" }), Number(perawat!.id));
  await tambahAlergi(pid, alergiSchema.parse({
    nama_alergen: "UJI Udang", reaksi: "gatal", keparahan: "ringan",
  }), Number(perawat!.id));
  const d3 = (await alergiPasien(pid)).find((a) => a.nama_alergen === "UJI Udang");
  ok("keterangan yang semula kosong ikut terisi", d3?.reaksi === "gatal" && d3?.keparahan === "ringan");

  await tambahAlergi(pid, alergiSchema.parse({
    nama_alergen: "UJI Udang", reaksi: "SESAK BERAT", keparahan: "berat",
  }), Number(perawat!.id));
  const d4 = (await alergiPasien(pid)).find((a) => a.nama_alergen === "UJI Udang");
  ok("keterangan yang sudah ada TIDAK ditimpa", d4?.reaksi === "gatal",
    "menimpa akan menghapus catatan perawat sebelumnya tanpa jejak");

  // Yang paling penting: terbaca di jalur lain.
  const dibacaFarmasi = await query<RowDataPacket & { alergi: string | null }>(
    `SELECT (SELECT GROUP_CONCAT(a.nama_alergen SEPARATOR ', ')
               FROM patient_allergies a
              WHERE a.patient_id = p.id AND a.is_active = 1) AS alergi
       FROM patients p WHERE p.id = ?`, [pid],
  );
  ok("terbaca oleh kueri alergi yang dipakai farmasi & dokter",
    (dibacaFarmasi[0]?.alergi ?? "").includes("UJI Udang"),
    "inilah alasan alergi tidak boleh jadi teks bebas di pengkajian");

  await execute(`DELETE FROM patient_allergies WHERE patient_id = ? AND nama_alergen LIKE 'UJI%'`, [pid]);
}

console.log("\n== Validasi alergi ==");
ok("nama alergen wajib", !alergiSchema.safeParse({ nama_alergen: "" }).success);
ok("jenis default 'obat'", alergiSchema.parse({ nama_alergen: "Debu" }).jenis === "obat");
ok("keparahan di luar daftar ditolak",
  !alergiSchema.safeParse({ nama_alergen: "Debu", keparahan: "parah" }).success);

console.log(`\n${gagal === 0 ? "SEMUA LULUS" : `${gagal} GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
