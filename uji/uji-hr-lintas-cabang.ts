/**
 * Uji HR & pendaftaran untuk pegawai yang bertugas di LEBIH DARI SATU cabang.
 *
 *   node uji/jalankan.mjs uji/uji-hr-lintas-cabang.ts
 *
 * Modul HR ditulis dengan anggapan diam-diam bahwa seorang pegawai hanya
 * milik satu cabang — `users.site_id`. Anggapan itu keliru: `user_sites`
 * ada justru untuk dokter yang praktik di beberapa cabang, dan tiga
 * kerusakan berikut semuanya berakar di situ.
 *
 * Yang diuji:
 *
 *   1. **Cuti tidak setengah cuti.** `putuskanCuti()` hanya membuat
 *      pengecualian jadwal di cabang tempat cutinya diajukan. Selama
 *      pendaftaran hanya melihat pengecualian cabangnya sendiri, dokter
 *      yang cuti di Pusat tetap bisa didaftari pasien di Cimahi — padahal
 *      layar pendaftarannya SUDAH menandainya berhalangan. Peringatan yang
 *      boleh diabaikan lebih buruk daripada tidak ada peringatan.
 *
 *   2. **Absensi mengikuti tempat bertugas, bukan cabang induk.** Dengan
 *      penyaring `users.site_id`, dokter tiga cabang hanya bisa diabsen di
 *      satu; di dua cabang lain ia tidak muncul sama sekali — padahal di
 *      sanalah ia hadir hari itu.
 *
 *   3. **Kepemilikan cabang divalidasi.** `tambahPengecualian()` memeriksa
 *      dokter penggantinya sejak awal, tetapi tidak memeriksa dokter yang
 *      digantikan; `ajukanCuti()` tidak memeriksa siapa pun. Keduanya
 *      menerima id dari cabang lain begitu saja.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne } from "../src/lib/db";
import {
  absensiHarian, ajukanCuti, putuskanCuti, putuskanPengecualian, tambahPengecualian,
} from "../src/lib/hr";
import { daftarDokter, daftarkanKunjungan } from "../src/lib/visits";
import { tanggalHariIni } from "../src/lib/tanggal";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

const TANDA = "UJIHRX";
const hariIni = tanggalHariIni();

async function bersih() {
  const sites = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM sites WHERE kode LIKE '${TANDA}%'`)
  ).map((r) => r.id);
  await execute(
    `DELETE FROM user_sites WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${TANDA}%')`,
  );
  if (sites.length) {
    const s = sites.join(",");
    await execute(`DELETE FROM notifications WHERE site_id IN (${s})`);
    await execute(`DELETE FROM billing_items WHERE billing_id IN (SELECT id FROM billing_transactions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM billing_transactions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM queues WHERE site_id IN (${s})`);
    await execute(`DELETE FROM visits WHERE site_id IN (${s})`);
    await execute(`DELETE FROM patients WHERE site_id IN (${s})`);
    await execute(`DELETE FROM attendances WHERE site_id IN (${s})`);
    await execute(`DELETE FROM schedule_exceptions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM leave_requests WHERE site_id IN (${s})`);
    await execute(`DELETE FROM polis WHERE site_id IN (${s})`);
    await execute(`DELETE FROM sequences WHERE site_id IN (${s})`);
  }
  await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
  if (sites.length) await execute(`DELETE FROM sites WHERE id IN (${sites.join(",")})`);
}
await bersih();

const sitePusat = (await execute(
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}P', 'Uji HR Pusat')`,
)).insertId;
const siteCabang = (await execute(
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}C', 'Uji HR Cabang')`,
)).insertId;

const roleId = async (c: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM roles WHERE code = ?`, [c]))!.id);

const buatUser = async (u: string, n: string, c: string, induk: number) =>
  (await execute(
    `INSERT INTO users (site_id, role_id, nama, username, password_hash) VALUES (?,?,?,?,'x')`,
    [induk, await roleId(c), n, u],
  )).insertId;

/*
 * Dokter lintas cabang: cabang INDUKNYA Pusat, tetapi ia juga ditugaskan
 * di Cabang lewat `user_sites`. Inilah bentuk yang dipakai `dr.bayu` pada
 * data contoh, dan inilah yang membuat ketiga kerusakan muncul.
 */
const drLintas = await buatUser(`${TANDA}.lintas`, "dr. Uji Lintas", "dokter", sitePusat);
await execute(`INSERT INTO user_sites (user_id, site_id) VALUES (?,?),(?,?)`,
  [drLintas, sitePusat, drLintas, siteCabang]);

const drLokal = await buatUser(`${TANDA}.lokal`, "dr. Uji Lokal", "dokter", siteCabang);
const adminPusat = await buatUser(`${TANDA}.admp`, "Admin Uji Pusat", "admin_cabang", sitePusat);
const adminCabang = await buatUser(`${TANDA}.admc`, "Admin Uji Cabang", "admin_cabang", siteCabang);

const poli = (await execute(
  `INSERT INTO polis (site_id, kode, nama) VALUES (?, '${TANDA}-PL', 'Poli Uji HR')`,
  [siteCabang],
)).insertId;

let np = 0;
const buatPasien = async () => {
  np++;
  return (await execute(
    `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin)
     VALUES (?,?,?,?, '1990-01-01', 'L')`,
    [siteCabang, `${TANDA}-RM${np}`, `327388000009${2000 + np}`, `Pasien Uji HR ${np}`],
  )).insertId;
};

const daftarkan = async (patientId: number, doctorId: number) =>
  daftarkanKunjungan(
    {
      patient_id: patientId, poli_id: poli, doctor_id: doctorId,
      cara_bayar: "umum", rujukan_dari: null,
      didahulukan: false, alasan_didahulukan: null,
    } as never,
    siteCabang, adminCabang,
  );

// =====================================================================
// 1. Cuti yang disetujui di satu cabang berlaku di semua cabang
// =====================================================================
console.log("\n== 1. Cuti dokter lintas cabang ==");

const idCuti = await ajukanCuti(
  {
    user_id: drLintas, jenis: "cuti_tahunan",
    tanggal_mulai: hariIni, tanggal_akhir: hariIni, alasan: "Uji lintas cabang",
  } as never,
  sitePusat,
);
const hasil = await putuskanCuti(idCuti, sitePusat, adminPusat, true, null);

ok("pengecualian jadwal dibuat otomatis di cabang pengaju",
  hasil.pengecualianDibuat === 1, `${hasil.pengecualianDibuat} baris`);
ok("dan HANYA di cabang itu",
  (await query(
    `SELECT id FROM schedule_exceptions WHERE doctor_id = ? AND site_id = ?`,
    [drLintas, siteCabang],
  )).length === 0);

const daftar = await daftarDokter(siteCabang);
const lintasDiCabang = daftar.find((d) => d.id === drLintas);
ok("layar pendaftaran cabang lain menandainya berhalangan",
  Number(lintasDiCabang?.berhalangan) === 1);

/*
 * Inti uji ini. Sebelum diperbaiki, pendaftaran di sini BERHASIL —
 * peringatan di layar diabaikan begitu saja oleh server.
 */
let tolakLintas = "";
try {
  await daftarkan(await buatPasien(), drLintas);
} catch (e) {
  tolakLintas = e instanceof Error ? e.message : String(e);
}
ok("server menolak mendaftarkan pasien ke dokter itu",
  /berhalangan/i.test(tolakLintas), tolakLintas || "DITERIMA");
ok("pesannya menyebut cabang mana yang mencatat halangannya",
  tolakLintas.includes("Uji HR Pusat"), tolakLintas);

// Dokter lain di cabang itu tidak ikut terhalang.
let tolakLokal = "";
try {
  await daftarkan(await buatPasien(), drLokal);
} catch (e) {
  tolakLokal = e instanceof Error ? e.message : String(e);
}
ok("dokter lain tetap bisa menerima pasien", tolakLokal === "", tolakLokal);

/*
 * Jalan keluarnya harus ada: menetapkan pengganti DI CABANG INI membuka
 * kembali pendaftaran. Tanpa ini perbaikannya cuma memindahkan kebuntuan.
 */
const idPengecualian = await tambahPengecualian(
  {
    doctor_id: drLintas, tanggal: hariIni, jenis: "cuti",
    substitute_doctor_id: drLokal, jam_mulai: null, jam_selesai: null,
    alasan: "Pengganti di cabang ini",
  } as never,
  siteCabang, adminCabang,
);

/*
 * Pengecualian lahir berstatus `pending` dan harus disetujui dulu —
 * penetapan pengganti memang dua langkah di layar Dokter Pengganti.
 * Selama belum disetujui, penolakan pendaftaran HARUS bertahan; kalau
 * tidak, cukup mengetik nama pengganti tanpa persetujuan siapa pun sudah
 * membuka kembali antrean dokter yang sedang cuti.
 */
let tolakBelumDisetujui = "";
try {
  await daftarkan(await buatPasien(), drLintas);
} catch (e) {
  tolakBelumDisetujui = e instanceof Error ? e.message : String(e);
}
ok("pengganti yang belum disetujui belum membuka pendaftaran",
  /berhalangan/i.test(tolakBelumDisetujui), tolakBelumDisetujui || "DITERIMA");

await putuskanPengecualian(idPengecualian, siteCabang, adminCabang, true);

const pasienGanti = await buatPasien();
let tolakSetelahGanti = "";
try {
  await daftarkan(pasienGanti, drLintas);
} catch (e) {
  tolakSetelahGanti = e instanceof Error ? e.message : String(e);
}
ok("setelah pengganti ditetapkan di cabang ini, pendaftaran dibuka lagi",
  tolakSetelahGanti === "", tolakSetelahGanti);

const kunjungan = await queryOne<RowDataPacket & {
  doctor_id: number; substitute_doctor_id: number | null;
}>(
  `SELECT doctor_id, substitute_doctor_id FROM visits
    WHERE patient_id = ? ORDER BY id DESC LIMIT 1`,
  [pasienGanti],
);
ok("dokter terjadwal tetap tercatat sebagai doctor_id",
  Number(kunjungan?.doctor_id) === drLintas);
ok("penggantinya yang tercatat sebagai pelaksana",
  Number(kunjungan?.substitute_doctor_id) === drLokal);

// =====================================================================
// 2. Absensi mengikuti tempat bertugas
// =====================================================================
console.log("\n== 2. Absensi pegawai lintas cabang ==");

const absenCabang = await absensiHarian(siteCabang, hariIni);
ok("dokter lintas cabang muncul di absensi cabang tempatnya bertugas",
  absenCabang.some((r) => Number(r.user_id) === drLintas));
ok("dokter lokal tetap muncul",
  absenCabang.some((r) => Number(r.user_id) === drLokal));

const absenPusat = await absensiHarian(sitePusat, hariIni);
ok("ia juga tetap muncul di cabang induknya",
  absenPusat.some((r) => Number(r.user_id) === drLintas));
ok("dokter lokal TIDAK bocor ke cabang lain",
  !absenPusat.some((r) => Number(r.user_id) === drLokal));

const barisLintas = absenCabang.find((r) => Number(r.user_id) === drLintas);
ok("statusnya sedang cuti ikut terbaca", Number(barisLintas?.sedang_cuti) === 1);

// =====================================================================
// 3. Kepemilikan cabang divalidasi
// =====================================================================
console.log("\n== 3. Validasi kepemilikan cabang ==");

let tolakPengecualian = "";
try {
  await tambahPengecualian(
    {
      doctor_id: drLokal, tanggal: "2099-01-01", jenis: "izin",
      substitute_doctor_id: null, jam_mulai: null, jam_selesai: null,
      alasan: "Dokter cabang lain",
    } as never,
    sitePusat, adminPusat,
  );
} catch (e) {
  tolakPengecualian = e instanceof Error ? e.message : String(e);
}
ok("pengecualian untuk dokter cabang lain ditolak",
  /tidak bertugas/i.test(tolakPengecualian), tolakPengecualian || "DITERIMA");

let tolakCuti = "";
try {
  await ajukanCuti(
    {
      user_id: drLokal, jenis: "izin",
      tanggal_mulai: "2099-01-01", tanggal_akhir: "2099-01-01", alasan: "Pegawai cabang lain",
    } as never,
    sitePusat,
  );
} catch (e) {
  tolakCuti = e instanceof Error ? e.message : String(e);
}
ok("cuti atas nama pegawai cabang lain ditolak",
  /tidak terdaftar/i.test(tolakCuti), tolakCuti || "DITERIMA");

// Yang sah tetap harus lolos — penjaga yang menolak semuanya bukan penjaga.
let tolakSah = "";
try {
  await ajukanCuti(
    {
      user_id: drLintas, jenis: "izin",
      tanggal_mulai: "2099-02-01", tanggal_akhir: "2099-02-01", alasan: "Sah",
    } as never,
    siteCabang,
  );
} catch (e) {
  tolakSah = e instanceof Error ? e.message : String(e);
}
ok("pegawai yang memang bertugas di sini tetap boleh mengajukan",
  tolakSah === "", tolakSah);

// =====================================================================
await bersih();
console.log(gagal === 0 ? "\nSEMUA UJI LULUS\n" : `\n${gagal} UJI GAGAL\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
