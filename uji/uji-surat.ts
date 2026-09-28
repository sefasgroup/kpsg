/**
 * Uji layar Surat Keterangan.
 *
 *   node uji/jalankan.mjs uji-surat.ts
 *
 * Regresi utama: `issued_at` HARUS berupa string.
 *
 * Kolomnya DATETIME, dan `dateStrings` di lib/db.ts hanya mencakup `DATE`,
 * sehingga mysql2 mengembalikannya sebagai objek Date. Tipe `SuratRow`
 * menyatakannya `string` dan TypeScript mempercayainya begitu saja — jadi
 * `issued_at.slice(0, 10)` di layar Surat lolos kompilasi lalu meledak saat
 * dijalankan.
 *
 * Yang membuatnya sulit terlihat: halaman hanya gagal setelah dokter yang
 * bersangkutan pernah menerbitkan SATU surat. Dengan riwayat kosong ia
 * tampak sehat, dan itulah sebabnya bug ini lolos dari pengujian pertama.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, queryOne } from "@/lib/db";
import { daftarSurat, kopKlinik } from "@/lib/dokumen";
import { getPemeriksaan } from "@/lib/doctor";
import { BUTA_WARNA, LABEL_BUTA_WARNA, suratSchema } from "@/lib/validations/dokumen";

let gagal = 0;
const ok = (n: string, l: boolean, d = "") => {
  console.log(`  ${l ? "PASS" : "GAGAL"}  ${n}${d ? " — " + d : ""}`);
  if (!l) gagal++;
};

const visit = await queryOne<RowDataPacket & {
  id: number; site_id: number; doctor_id: number;
}>(`SELECT id, site_id, doctor_id FROM visits ORDER BY id LIMIT 1`);

if (!visit) {
  console.log("\n  (dilewati — belum ada kunjungan)\n");
  await pool.end();
  process.exit(0);
}

const siteId = Number(visit.site_id);
const dokterId = Number(visit.doctor_id);

console.log("\n== Kop klinik ==");
const klinik = await kopKlinik(siteId);
ok("kop klinik terbaca", Boolean(klinik?.nama), klinik?.nama);

console.log("\n== Riwayat surat ==");
await execute(`DELETE FROM medical_certificates WHERE no_surat LIKE 'UJISRT%'`);

const kosong = await daftarSurat(siteId, { doctorId: dokterId, limit: 50 });
ok("riwayat kosong tidak error", Array.isArray(kosong));

// Terbitkan satu surat supaya jalur yang dulu meledak benar-benar dilewati.
await execute(
  `INSERT INTO medical_certificates (site_id, visit_id, jenis, no_surat, isi, issued_by)
   VALUES (?,?, 'sakit', 'UJISRT/001', ?, ?)`,
  [siteId, visit.id, JSON.stringify({ lama_istirahat: 2, diagnosa: "ISPA" }), dokterId],
);

const isi = await daftarSurat(siteId, { doctorId: dokterId, limit: 50 });
ok("surat terbaca kembali", isi.length >= 1, `${isi.length} surat`);

const s = isi[0];
/*
 * Dilebarkan ke `unknown` lebih dulu. `SuratRow` menyatakan `issued_at`
 * sebagai `string`, jadi TypeScript menolak `instanceof Date` di sini —
 * penolakan yang justru menggambarkan bug aslinya: tipe itu pernyataan
 * sepihak yang tidak bisa diperiksa terhadap hasil SQL sebenarnya.
 */
const nilaiIssuedAt: unknown = s.issued_at;
ok("issued_at bertipe string, bukan objek Date",
  typeof nilaiIssuedAt === "string",
  `typeof = ${typeof nilaiIssuedAt}${nilaiIssuedAt instanceof Date ? " (Date!)" : ""}`);

// Persis operasi yang dilakukan halaman dan dulu melemparkan TypeError.
let meledak = "";
try {
  const tanggal = s.issued_at.slice(0, 10);
  ok("issued_at.slice() berjalan — inilah yang dulu membuat /surat 500",
    /^\d{4}-\d{2}-\d{2}$/.test(tanggal), tanggal);
} catch (e) {
  meledak = (e as Error).message;
  ok("issued_at.slice() berjalan", false, meledak);
}

ok("format lengkap dengan jam", /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s.issued_at), s.issued_at);
ok("bisa diurai jadi tanggal yang sah", !Number.isNaN(new Date(s.issued_at).getTime()));

/*
 * Membuktikan uji ini memang menangkap sesuatu: tanpa DATE_FORMAT, kolom
 * yang sama kembali sebagai objek Date. Kalau assertion ini suatu saat
 * gagal, berarti perilaku driver berubah dan pemformatan di SQL boleh
 * ditinjau ulang — bukan berarti ujinya usang.
 */
const mentah = await queryOne<RowDataPacket & { issued_at: unknown }>(
  `SELECT issued_at FROM medical_certificates WHERE no_surat = 'UJISRT/001'`,
);
ok("tanpa DATE_FORMAT kolomnya memang objek Date",
  mentah?.issued_at instanceof Date,
  "inilah sumber TypeError-nya — tipe `string` di SuratRow tidak bisa diperiksa TypeScript");

// Penyaringan per dokter — surat dokter lain tidak boleh ikut terbawa.
const dokterLain = await queryOne<RowDataPacket & { id: number }>(
  `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
    WHERE r.code = 'dokter' AND u.id <> ? LIMIT 1`, [dokterId],
);
if (dokterLain) {
  const milikLain = await daftarSurat(siteId, { doctorId: Number(dokterLain.id), limit: 50 });
  ok("surat dokter lain tidak ikut terbawa",
    !milikLain.some((x) => x.no_surat === "UJISRT/001"));
}

console.log("\n== Buta warna pada surat sehat ==");

const dasarSehat = {
  visit_id: visit.id,
  jenis: "sehat" as const,
  keperluan: "Melamar pekerjaan",
};

for (const kode of BUTA_WARNA) {
  const h = suratSchema.safeParse({ ...dasarSehat, buta_warna: kode });
  ok(`"${kode}" diterima`, h.success && h.data.buta_warna === kode,
    h.success ? String(h.data.buta_warna) : h.error.issues[0].message);
}

const kosongWarna = suratSchema.safeParse({ ...dasarSehat, buta_warna: "" });
ok("tidak diperiksa → null, bukan string kosong",
  kosongWarna.success && kosongWarna.data.buta_warna === null,
  kosongWarna.success ? JSON.stringify(kosongWarna.data.buta_warna) : "ditolak");

const tanpaWarna = suratSchema.safeParse(dasarSehat);
ok("field boleh tidak dikirim sama sekali",
  tanpaWarna.success && tanpaWarna.data.buta_warna === null);

// Kode di luar daftar harus ditolak — kalau lolos, surat bisa memuat hasil
// tes yang tidak pernah ada dan lembar cetak diam-diam menyembunyikannya.
const ngawur = suratSchema.safeParse({ ...dasarSehat, buta_warna: "buta_total" });
ok("kode di luar daftar ditolak", !ngawur.success);

ok("setiap kode punya kalimat cetak",
  BUTA_WARNA.every((k) => Boolean(LABEL_BUTA_WARNA[k])),
  BUTA_WARNA.map((k) => LABEL_BUTA_WARNA[k]).join(" / "));

/*
 * Isi surat disimpan sebagai JSON. Dibuktikan bahwa field baru ini benar-benar
 * kembali utuh lewat `bacaIsi()` — dan bahwa surat lama yang sama sekali tidak
 * punya field ini tetap terbaca, bukan melempar error.
 */
await execute(
  `INSERT INTO medical_certificates (site_id, visit_id, jenis, no_surat, isi, issued_by)
   VALUES (?,?, 'sehat', 'UJISRT/002', ?, ?)`,
  [siteId, visit.id, JSON.stringify({ keperluan: "Melamar", buta_warna: "parsial" }), dokterId],
);
await execute(
  `INSERT INTO medical_certificates (site_id, visit_id, jenis, no_surat, isi, issued_by)
   VALUES (?,?, 'sehat', 'UJISRT/003', ?, ?)`,
  [siteId, visit.id, JSON.stringify({ keperluan: "Sekolah" }), dokterId],
);

const sehat = await daftarSurat(siteId, { doctorId: dokterId, jenis: "sehat", limit: 50 });
const baru = sehat.find((x) => x.no_surat === "UJISRT/002");
const lama = sehat.find((x) => x.no_surat === "UJISRT/003");

ok("buta_warna tersimpan dan terbaca kembali",
  baru?.data.buta_warna === "parsial", String(baru?.data.buta_warna));
ok("surat lama tanpa field ini tetap terbaca",
  lama !== undefined && lama.data.buta_warna === undefined,
  lama ? JSON.stringify(lama.data) : "tidak ditemukan");

console.log("\n== Penyaringan per kunjungan (kartu Surat di layar pemeriksaan) ==");

/*
 * Kartu Surat Keterangan di layar pemeriksaan menampilkan surat yang SUDAH
 * terbit untuk kunjungan itu, supaya dokter tidak menerbitkannya dua kali.
 * Yang harus dijaga: surat kunjungan lain tidak boleh ikut terbawa ke sana.
 */
const seVisit = await daftarSurat(siteId, { visitId: Number(visit.id), limit: 50 });
ok(
  "surat kunjungan ini terbaca",
  seVisit.some((s) => s.no_surat === "UJISRT/002"),
  `${seVisit.length} surat`,
);
ok(
  "seluruhnya benar-benar milik kunjungan ini",
  seVisit.every((s) => Number(s.visit_id) === Number(visit.id)),
);

const visitLain = await queryOne<RowDataPacket & { id: number }>(
  `SELECT id FROM visits WHERE id <> ? AND site_id = ? LIMIT 1`,
  [visit.id, siteId],
);
if (visitLain) {
  const lain = await daftarSurat(siteId, { visitId: Number(visitLain.id), limit: 50 });
  ok(
    "surat kunjungan lain tidak ikut terbawa",
    !lain.some((s) => String(s.no_surat).startsWith("UJISRT")),
    `kunjungan #${visitLain.id}: ${lain.length} surat`,
  );
}

console.log("\n== Bekal layar pemeriksaan ==");

/*
 * Kartu surat mengisi sendiri identitas pasien dan menentukan siapa yang
 * berhak menerbitkan. Semua itu bergantung pada kolom di bawah ini — kalau
 * salah satu hilang dari SELECT, kartunya diam-diam mencetak surat tanpa
 * alamat, atau menampilkan tombol kepada dokter yang akan ditolak.
 */
const detail = await getPemeriksaan(Number(visit.id), siteId);
ok("detail pemeriksaan terbaca", detail !== null);
if (detail) {
  for (const kolom of [
    "alamat", "pekerjaan", "doctor_id", "nik", "tanggal_lahir", "jenis_kelamin",
  ] as const) {
    ok(`kolom "${kolom}" ikut terbaca`, kolom in detail, String(detail[kolom]));
  }
  ok(
    "substitute_doctor_id ikut terbaca (boleh NULL)",
    "substitute_doctor_id" in detail,
    String(detail.substitute_doctor_id),
  );
  ok(
    "doctor_id cocok dengan kunjungannya",
    Number(detail.doctor_id) === Number(visit.doctor_id),
    `${detail.doctor_id} vs ${visit.doctor_id}`,
  );
}

await execute(`DELETE FROM medical_certificates WHERE no_surat LIKE 'UJISRT%'`);

console.log(`\n${gagal === 0 ? "SEMUA LULUS" : `${gagal} GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
