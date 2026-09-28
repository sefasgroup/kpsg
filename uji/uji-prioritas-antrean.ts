/**
 * Uji penanda "perlu didahulukan" dari Pendaftaran.
 *
 *   node uji/jalankan.mjs uji-prioritas-antrean.ts
 *
 * Yang diuji adalah URUTAN yang benar-benar keluar dari query — bukan
 * keberadaan kolomnya. Fitur ini hanya bernilai kalau pasien yang ditandai
 * benar-benar naik di layar yang dibaca perawat dan dokter; kolom yang
 * tersimpan rapi tetapi tidak mengubah urutan sama saja dengan tidak ada.
 *
 * Perbedaan penting antara kedua antrean juga diuji:
 *   - Perawat  : triase BELUM ada, jadi penanda Pendaftaran yang menentukan.
 *   - Dokter   : triase SUDAH ada dan mengalahkan penanda itu, karena triase
 *                adalah penilaian klinis sedangkan penanda hanya pengamatan
 *                petugas depan.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne } from "../src/lib/db";
import { antreanAktif } from "../src/lib/visits";
import { worklistPerawat } from "../src/lib/nurse";
import { worklistDokter } from "../src/lib/doctor";
import { visitSchema } from "../src/lib/validations/patient";
import { tanggalHariIni } from "../src/lib/tanggal";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

const TANDA = "UJIPRI";
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
    await execute(`DELETE FROM nurse_assessments WHERE site_id IN (${s})`);
    await execute(`DELETE FROM queues WHERE site_id IN (${s})`);
    await execute(`DELETE FROM visits WHERE site_id IN (${s})`);
    await execute(`DELETE FROM patients WHERE site_id IN (${s})`);
    await execute(`DELETE FROM polis WHERE site_id IN (${s})`);
    await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
    await execute(`DELETE FROM sites WHERE id IN (${s})`);
  } else {
    await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
  }
}
await bersih();

const site = (await execute(
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}', 'Uji Prioritas')`,
)).insertId;

const roleId = async (code: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM roles WHERE code = ?`, [code]))!.id);

const dokter = (await execute(
  `INSERT INTO users (site_id, role_id, nama, username, password_hash)
   VALUES (?,?, 'dr. Uji Prioritas', '${TANDA}.dokter', 'x')`, [site, await roleId("dokter")],
)).insertId;
const perawat = (await execute(
  `INSERT INTO users (site_id, role_id, nama, username, password_hash)
   VALUES (?,?, 'Perawat Uji', '${TANDA}.perawat', 'x')`, [site, await roleId("perawat")],
)).insertId;

const poli = (await execute(
  `INSERT INTO polis (site_id, kode, nama, prefix_antrean) VALUES (?, '${TANDA}-PU', 'Poli Uji', 'A')`,
  [site],
)).insertId;

/** Satu pasien per kunjungan — pendaftaran menolak dobel di poli yang sama. */
async function buatPasien(n: number) {
  return (await execute(
    `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin)
     VALUES (?,?,?,?, '1990-01-01', 'L')`,
    [site, `${TANDA}-${n}`, `327300000000${1000 + n}`, `Pasien ${n}`],
  )).insertId;
}

/**
 * Kunjungan dibuat langsung, bukan lewat `daftarkanKunjungan()`, supaya nomor
 * antreannya bisa ditentukan — inti uji ini adalah urutan, dan urutan hanya
 * bisa dibuktikan kalau nomor awalnya diketahui pasti.
 */
async function buatKunjungan(opts: {
  n: number; nomor: number; didahulukan?: string | false; status?: string;
}) {
  const pasien = await buatPasien(opts.n);
  const visit = (await execute(
    `INSERT INTO visits (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
                         jenis_kunjungan, status, registered_by, didahulukan, alasan_didahulukan)
     VALUES (?,?,?,?,?,?, 'baru', ?, ?, ?, ?)`,
    [
      site, pasien, `${TANDA}/V/${opts.n}`, hariIni, poli, dokter,
      opts.status ?? "menunggu_perawat", dokter,
      opts.didahulukan ? 1 : 0, opts.didahulukan || null,
    ],
  )).insertId;

  await execute(
    `INSERT INTO queues (site_id, visit_id, poli_id, tanggal, prefix, nomor)
     VALUES (?,?,?,?, 'A', ?)`,
    [site, visit, poli, hariIni, opts.nomor],
  );
  return visit;
}

const urutan = (baris: { nama: string }[]) => baris.map((b) => b.nama).join(" → ");

// =====================================================================
// 1. Antrean perawat — triase belum ada, penanda yang menentukan
// =====================================================================
console.log("\n== 1. Antrean perawat ==");

await buatKunjungan({ n: 1, nomor: 1 });
await buatKunjungan({ n: 2, nomor: 2 });
await buatKunjungan({ n: 3, nomor: 3, didahulukan: "Sesak napas, tampak pucat" });
await buatKunjungan({ n: 4, nomor: 4 });

const perawatList = await worklistPerawat(site, hariIni);
ok("empat pasien di antrean perawat", perawatList.length === 4, `${perawatList.length}`);
ok(
  "pasien bertanda naik ke urutan pertama",
  perawatList[0]?.nama === "Pasien 3",
  urutan(perawatList),
);
ok(
  "sisanya tetap urut nomor antrean",
  urutan(perawatList.slice(1)) === "Pasien 1 → Pasien 2 → Pasien 4",
  urutan(perawatList.slice(1)),
);
ok(
  "alasannya ikut terbaca perawat",
  perawatList[0]?.alasan_didahulukan === "Sesak napas, tampak pucat",
  String(perawatList[0]?.alasan_didahulukan),
);

// Dua yang ditandai: di antara mereka sendiri tetap urut nomor.
await buatKunjungan({ n: 5, nomor: 5, didahulukan: "Nyeri dada" });
const dua = await worklistPerawat(site, hariIni);
ok(
  "dua pasien bertanda urut nomor di antara mereka sendiri",
  urutan(dua.slice(0, 2)) === "Pasien 3 → Pasien 5",
  urutan(dua),
);

// =====================================================================
// 2. Papan antrean admin
// =====================================================================
console.log("\n== 2. Papan antrean (Admin Cabang) ==");

const papan = await antreanAktif(site, hariIni);
ok("pasien bertanda muncul di atas", papan[0]?.nama === "Pasien 3", urutan(papan));
ok("penanda ikut terbaca", Number(papan[0]?.didahulukan) === 1);
ok(
  "alasan ikut terbaca",
  papan[0]?.alasan_didahulukan === "Sesak napas, tampak pucat",
  String(papan[0]?.alasan_didahulukan),
);

// =====================================================================
// 3. Antrean dokter — triase mengalahkan penanda Pendaftaran
// =====================================================================
console.log("\n== 3. Antrean dokter ==");

await execute(`DELETE FROM queues WHERE site_id = ?`, [site]);
await execute(`DELETE FROM nurse_assessments WHERE site_id = ?`, [site]);
await execute(`DELETE FROM visits WHERE site_id = ?`, [site]);
await execute(`DELETE FROM patients WHERE site_id = ?`, [site]);

const vHijauTanda = await buatKunjungan({
  n: 11, nomor: 1, didahulukan: "Terlihat lemas", status: "menunggu_dokter",
});
const vMerah = await buatKunjungan({ n: 12, nomor: 2, status: "menunggu_dokter" });
const vHijau = await buatKunjungan({ n: 13, nomor: 3, status: "menunggu_dokter" });

async function kaji(visitId: number, triase: string) {
  await execute(
    `INSERT INTO nurse_assessments (visit_id, site_id, nurse_id, triase, keluhan_utama)
     VALUES (?,?,?,?, 'Keluhan uji')`,
    [visitId, site, perawat, triase],
  );
}
await kaji(vHijauTanda, "hijau");
await kaji(vMerah, "merah");
await kaji(vHijau, "hijau");

const dokterList = await worklistDokter(site, dokter, hariIni);
ok("tiga pasien menunggu dokter", dokterList.length === 3, `${dokterList.length}`);

/*
 * Inti perbedaannya. Pasien 11 ditandai Pendaftaran, tetapi perawat menilainya
 * hijau; Pasien 12 tidak ditandai, tetapi ternyata merah. Penilaian klinis
 * perawat yang menang.
 */
ok(
  "triase merah mendahului pasien bertanda Pendaftaran",
  dokterList[0]?.nama === "Pasien 12",
  urutan(dokterList),
);
ok(
  "di antara triase yang sama, pasien bertanda naik",
  dokterList[1]?.nama === "Pasien 11",
  urutan(dokterList),
);

/*
 * Regresi khusus: `FIELD()` mengembalikan 0 untuk NULL, sehingga pasien tanpa
 * pengkajian perawat akan naik MENDAHULUI triase merah. Diuji supaya kalau
 * pengurutannya suatu saat dikembalikan ke FIELD(), uji ini yang menahannya.
 */
const vTanpaKajian = await buatKunjungan({ n: 14, nomor: 4, status: "menunggu_dokter" });
const denganNull = await worklistDokter(site, dokter, hariIni);
ok(
  "pasien TANPA triase tidak melompati triase merah",
  denganNull[0]?.nama === "Pasien 12",
  urutan(denganNull),
);
ok(
  "pasien tanpa triase justru di urutan terakhir",
  denganNull[denganNull.length - 1]?.nama === "Pasien 14",
  urutan(denganNull),
);
void vTanpaKajian;

// =====================================================================
// 4. Validasi: penanda tanpa alasan ditolak
// =====================================================================
console.log("\n== 4. Alasan wajib bila ditandai ==");

const dasar = { patient_id: 1, poli_id: 1, doctor_id: 1, cara_bayar: "umum" };

const tanpaAlasan = visitSchema.safeParse({ ...dasar, didahulukan: true });
ok("ditandai tanpa alasan ditolak", !tanpaAlasan.success,
  tanpaAlasan.success ? "lolos" : tanpaAlasan.error.issues[0].message);
ok("galat menunjuk ke field alasannya",
  !tanpaAlasan.success && tanpaAlasan.error.issues[0].path[0] === "alasan_didahulukan");

const alasanPendek = visitSchema.safeParse({
  ...dasar, didahulukan: true, alasan_didahulukan: "abc",
});
ok("alasan terlalu pendek ditolak", !alasanPendek.success);

const lengkap = visitSchema.safeParse({
  ...dasar, didahulukan: true, alasan_didahulukan: "Nyeri dada hebat",
});
ok("ditandai dengan alasan diterima", lengkap.success);

const biasa = visitSchema.safeParse(dasar);
ok("pendaftaran biasa tetap lolos tanpa isian apa pun",
  biasa.success && biasa.data.didahulukan === false);

/*
 * Database adalah pertahanan terakhir — validasi zod bisa dilewati lewat API.
 */
let ditolakDb = "";
try {
  await execute(
    `INSERT INTO visits (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
                         jenis_kunjungan, status, registered_by, didahulukan)
     VALUES (?, (SELECT id FROM patients WHERE site_id = ? LIMIT 1), ?, ?, ?, ?,
             'baru', 'menunggu_perawat', ?, 1)`,
    [site, site, `${TANDA}/V/CK`, hariIni, poli, dokter, dokter],
  );
} catch (e) {
  ditolakDb = (e as Error).message;
}
ok("INSERT langsung tanpa alasan ditolak database", ditolakDb !== "",
  ditolakDb || "LOLOS — CHECK ck_v_didahulukan tidak bekerja");

// =====================================================================
await bersih();
console.log(`\n${gagal === 0 ? "SEMUA UJI LULUS" : `${gagal} UJI GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
