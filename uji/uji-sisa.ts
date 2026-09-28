/**
 * Uji perbaikan SISA — SDM, pendaftaran, lab, laporan, surat, persetujuan.
 *
 *   node uji/jalankan.mjs uji-sisa.ts
 *
 *   1. Cuti disetujui menimpa hari ganti jam/tambahan (bukan melewatinya) dan
 *      melepas penugasan dokter itu sebagai pengganti.
 *   2. Jadwal bentrok antarcabang ditolak.
 *   3. Absensi: hanya pegawai cabang ini, jam masuk hanya hari ini, status
 *      tidak untuk tanggal yang belum tiba.
 *   4. Dua pendaftaran bersamaan untuk pasien & poli yang sama → hanya satu.
 *   5. Tanggal lahir hari ini sah (tidak bergeser zona waktu).
 *   6. Lab: order bisa dibatalkan setelah lunas (tagihan utuh, admin diberi
 *      tahu); sifat hasil tidak bisa diubah di kasir atau untuk APS; hasil
 *      untuk parameter di luar panel ditolak.
 *   7. Laporan: pendapatan dibukukan pada tanggal bayar.
 *   8. Surat: yang berhak adalah dokter pemeriksa.
 *   9. Persetujuan tindakan membekukan nama tindakan & pemberi penjelasan.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne } from "../src/lib/db";
import {
  ajukanCuti, catatAbsensi, dokterBertugas, putuskanCuti, setStatusAbsensi,
  tambahJadwal, tambahPengecualian,
} from "../src/lib/hr";
import { daftarkanKunjungan } from "../src/lib/visits";
import { batalkanOrderLab, buatOrderLab, simpanHasilLab, ubahSifatHasil } from "../src/lib/lab";
import { ringkasanCabang } from "../src/lib/laporan";
import { terbitkanSurat } from "../src/lib/dokumen";
import { simpanConsent } from "../src/lib/kepatuhan";
import { cutiSchema, jadwalSchema, pengecualianSchema } from "../src/lib/validations/hr";
import { patientSchema, visitSchema } from "../src/lib/validations/patient";
import { hasilLabSchema, orderLabSchema } from "../src/lib/validations/lab";
import { suratSchema } from "../src/lib/validations/dokumen";
import { consentSchema } from "../src/lib/validations/kepatuhan";
import { hariDalamMinggu, tambahHari, tanggalHariIni } from "../src/lib/tanggal";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};
const ditolak = async (f: () => Promise<unknown>) => {
  try { await f(); return ""; } catch (e) { return (e as Error).message || "galat"; }
};

const TANDA = "UJISISA";
const hariIni = tanggalHariIni();

async function bersih() {
  const sites = (await query<RowDataPacket & { id: number }>(`SELECT id FROM sites WHERE kode LIKE '${TANDA}%'`)).map((r) => r.id);
  if (sites.length) {
    const s = sites.join(",");
    for (const sql of [
      `DELETE FROM consents WHERE site_id IN (${s})`,
      `DELETE FROM medical_certificates WHERE site_id IN (${s})`,
      `DELETE FROM notifications WHERE site_id IN (${s})`,
      `DELETE FROM billing_items WHERE billing_id IN (SELECT id FROM billing_transactions WHERE site_id IN (${s}))`,
      `DELETE FROM billing_transactions WHERE site_id IN (${s})`,
      `DELETE FROM lab_results WHERE order_id IN (SELECT id FROM lab_orders WHERE site_id IN (${s}))`,
      `DELETE FROM lab_order_panels WHERE order_id IN (SELECT id FROM lab_orders WHERE site_id IN (${s}))`,
      `DELETE FROM lab_orders WHERE site_id IN (${s})`,
      `DELETE FROM medical_assessments WHERE site_id IN (${s})`,
      `DELETE FROM queues WHERE site_id IN (${s})`,
      `DELETE FROM visits WHERE site_id IN (${s})`,
      `DELETE FROM patients WHERE site_id IN (${s})`,
      `DELETE FROM attendances WHERE site_id IN (${s})`,
      `DELETE FROM schedule_exceptions WHERE site_id IN (${s})`,
      `DELETE FROM leave_requests WHERE site_id IN (${s})`,
      `DELETE FROM doctor_schedules WHERE site_id IN (${s})`,
      `DELETE FROM user_sites WHERE site_id IN (${s})`,
      `DELETE FROM polis WHERE site_id IN (${s})`,
      `DELETE FROM sequences WHERE site_id IN (${s})`,
    ]) await execute(sql);
  }
  await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
  if (sites.length) await execute(`DELETE FROM sites WHERE id IN (${sites.join(",")})`);
  await execute(`DELETE FROM lab_parameters WHERE panel_id IN (SELECT id FROM lab_panels WHERE kode LIKE '${TANDA}%')`);
  await execute(`DELETE FROM lab_panels WHERE kode LIKE '${TANDA}%'`);
  await execute(`DELETE FROM medical_procedures WHERE kode LIKE '${TANDA}%'`);
}
await bersih();

const site = (await execute(`INSERT INTO sites (kode, nama) VALUES ('${TANDA}', 'Uji Sisa A')`)).insertId;
const siteB = (await execute(`INSERT INTO sites (kode, nama) VALUES ('${TANDA}B', 'Uji Sisa B')`)).insertId;
const roleId = async (c: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(`SELECT id FROM roles WHERE code = ?`, [c]))!.id);
const buatUser = async (u: string, c: string, s = site) =>
  (await execute(`INSERT INTO users (site_id, role_id, nama, username, password_hash) VALUES (?,?,?,?,'x')`,
    [s, await roleId(c), u, u])).insertId;
const dokA = await buatUser(`${TANDA}.dokA`, "dokter");
const dokB = await buatUser(`${TANDA}.dokB`, "dokter");
const dokC = await buatUser(`${TANDA}.dokC`, "dokter");
const admin = await buatUser(`${TANDA}.adm`, "admin_cabang");
const analis = await buatUser(`${TANDA}.lab`, "petugas_lab");
const kasirB = await buatUser(`${TANDA}.kasB`, "kasir", siteB);
await execute(`INSERT INTO user_sites (user_id, site_id) VALUES (?,?)`, [dokA, siteB]);
const poli = (await execute(`INSERT INTO polis (site_id, kode, nama, prefix_antrean) VALUES (?, '${TANDA}-P', 'Poli A', 'A')`, [site])).insertId;
const poliB = (await execute(`INSERT INTO polis (site_id, kode, nama, prefix_antrean) VALUES (?, '${TANDA}-Q', 'Poli B', 'B')`, [siteB])).insertId;

// =====================================================================
console.log("\n== 1. Cuti menimpa ganti jam & melepas penugasan pengganti ==");
const besok = tambahHari(hariIni, 5);
const hariBesok = hariDalamMinggu(besok);
await tambahJadwal(jadwalSchema.parse({ doctor_id: dokA, poli_id: poli, hari: hariBesok, jam_mulai: "08:00", jam_selesai: "12:00", kuota: 10 }), site, admin);
await tambahJadwal(jadwalSchema.parse({ doctor_id: dokC, poli_id: poli, hari: hariBesok, jam_mulai: "13:00", jam_selesai: "16:00", kuota: 10 }), site, admin);
// Dr A: ganti jam di hari itu (disetujui); Dr A juga pengganti untuk Dr C.
const gj = await tambahPengecualian(pengecualianSchema.parse({ doctor_id: dokA, tanggal: besok, jenis: "ganti_jam", jam_mulai: "13:00", jam_selesai: "17:00", alasan: "" }), site, admin);
await execute(`UPDATE schedule_exceptions SET status = 'disetujui' WHERE id = ?`, [gj]);
const izinC = await tambahPengecualian(pengecualianSchema.parse({ doctor_id: dokC, tanggal: besok, jenis: "izin", substitute_doctor_id: dokA, alasan: "" }), site, admin);
await execute(`UPDATE schedule_exceptions SET status = 'disetujui' WHERE id = ?`, [izinC]);
const cuti = await ajukanCuti(cutiSchema.parse({ user_id: dokA, jenis: "cuti_tahunan", tanggal_mulai: besok, tanggal_akhir: besok, alasan: "uji" }), site);
const hasilCuti = await putuskanCuti(cuti, site, admin, true);
const bertugas = await dokterBertugas(site, besok);
const a = bertugas.find((d) => d.doctor_id === dokA);
ok("hari ganti jam kini tercatat berhalangan (bukan praktik)", !a || a.kosong === true, JSON.stringify(a && { kosong: a.kosong, jam: a.jam_mulai }));
const c = bertugas.find((d) => d.doctor_id === dokC);
ok("penugasan Dr A sebagai pengganti Dr C dilepas", c?.substitute_doctor_id === null && c?.kosong === true,
  JSON.stringify(c && { pengganti: c.substitute_doctor_id, kosong: c.kosong }));
ok("jumlah penugasan dilepas dilaporkan", hasilCuti.penggantiDilepas === 1, String(hasilCuti.penggantiDilepas));

// =====================================================================
console.log("\n== 2. Bentrok jadwal antarcabang ==");
const tolakBentrok = await ditolak(() => tambahJadwal(jadwalSchema.parse({
  doctor_id: dokA, poli_id: poliB, hari: hariBesok, jam_mulai: "09:00", jam_selesai: "11:00", kuota: 10,
}), siteB, admin));
ok("jadwal Dr A di cabang B yang beririsan ditolak", /cabang/i.test(tolakBentrok), tolakBentrok);

// =====================================================================
console.log("\n== 3. Absensi ==");
ok("pegawai cabang lain ditolak", (await ditolak(() => catatAbsensi(site, kasirB, hariIni, "masuk"))) !== "");
ok("jam masuk untuk tanggal lampau ditolak", (await ditolak(() => catatAbsensi(site, admin, tambahHari(hariIni, -3), "masuk"))) !== "");
ok("jam masuk hari ini diterima", (await ditolak(() => catatAbsensi(site, admin, hariIni, "masuk"))) === "");
ok("status untuk tanggal yang belum tiba ditolak", (await ditolak(() => setStatusAbsensi(site, analis, besok, "izin"))) !== "");
ok("status tak dikenal ditolak", (await ditolak(() => setStatusAbsensi(site, analis, hariIni, "liburan"))) !== "");

// =====================================================================
console.log("\n== 4 & 5. Pendaftaran ==");
ok("tanggal lahir HARI INI sah", patientSchema.shape.tanggal_lahir.safeParse(hariIni).success);
ok("tanggal lahir besok ditolak", !patientSchema.shape.tanggal_lahir.safeParse(tambahHari(hariIni, 1)).success);
const pasien = (await execute(
  `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin) VALUES (?,?,?,?, '1990-01-01', 'L')`,
  [site, `${TANDA}-1`, "3273990000091001", "Pasien Sisa"],
)).insertId;
const daftar = () => daftarkanKunjungan(visitSchema.parse({ patient_id: pasien, poli_id: poli, doctor_id: dokB, cara_bayar: "umum" }), site, admin);
const hasilDaftar = await Promise.allSettled([daftar(), daftar(), daftar()]);
const berhasil = hasilDaftar.filter((h) => h.status === "fulfilled").length;
ok("tiga pendaftaran serentak → tepat satu berhasil", berhasil === 1, `${berhasil} berhasil`);

// =====================================================================
console.log("\n== 6. Laboratorium ==");
const panel = (await execute(`INSERT INTO lab_panels (kode, nama, kategori, tarif) VALUES ('${TANDA}-P1', 'Panel Sisa', 'Uji', 30000)`)).insertId;
const panelLain = (await execute(`INSERT INTO lab_panels (kode, nama, kategori, tarif) VALUES ('${TANDA}-P2', 'Panel Lain', 'Uji', 30000)`)).insertId;
const parLain = (await execute(`INSERT INTO lab_parameters (panel_id, kode, nama, tipe_nilai, urutan) VALUES (?, '${TANDA}-X', 'Param Lain', 'numerik', 1)`, [panelLain])).insertId;
const v = (hasilDaftar.find((h) => h.status === "fulfilled") as PromiseFulfilledResult<{ id: number }>).value.id;
await execute(`UPDATE visits SET status = 'dalam_pemeriksaan' WHERE id = ?`, [v]);
const order = (await buatOrderLab(v, site, dokB, orderLabSchema.parse({
  prioritas: "rutin", sifat_hasil: "menyusul", panels: [{ panel_id: panel, nama: "x", tarif: 1 }],
}))).orderId;
const tolakParam = await ditolak(() => simpanHasilLab(order, site, analis, hasilLabSchema.parse({
  finalkan: false, hasil: [{ parameter_id: parLain, panel_id: panel, nilai: "5" }],
})));
ok("hasil untuk parameter di luar panel yang dipesan ditolak", tolakParam !== "", tolakParam);
const aps = (await buatOrderLab(v, site, analis, orderLabSchema.parse({
  prioritas: "rutin", sifat_hasil: "menyusul", panels: [{ panel_id: panel, nama: "x", tarif: 1 }],
}), true)).orderId;
await execute(`UPDATE visits SET status = 'dalam_pemeriksaan' WHERE id = ?`, [v]);
ok("sifat hasil order APS tidak bisa diubah", (await ditolak(() => ubahSifatHasil(aps, site, "ditunggu"))) !== "");
// Tagihan lunas → pembatalan tetap bisa, tagihan utuh, admin diberi tahu.
await execute(`UPDATE billing_transactions SET status = 'lunas', paid_at = NOW() WHERE visit_id = ?`, [v]);
const totalSebelum = Number((await queryOne<RowDataPacket & { t: string }>(`SELECT total t FROM billing_transactions WHERE visit_id = ?`, [v]))!.t);
const tolakBatal = await ditolak(() => batalkanOrderLab(order, site, "Sampel lisis", analis, "Analis"));
ok("order bisa dibatalkan walau tagihan sudah lunas", tolakBatal === "", tolakBatal);
const totalSesudah = Number((await queryOne<RowDataPacket & { t: string }>(`SELECT total t FROM billing_transactions WHERE visit_id = ?`, [v]))!.t);
ok("tagihan yang sudah dibayar tidak berubah", totalSebelum === totalSesudah, `${totalSebelum} → ${totalSesudah}`);
const notif = await queryOne<RowDataPacket & { n: number }>(
  `SELECT COUNT(*) n FROM notifications WHERE site_id = ? AND jenis = 'pengembalian_dana'`, [site]);
ok("admin cabang diberi tahu untuk pengembalian dana", Number(notif!.n) === 1);

// =====================================================================
console.log("\n== 7. Pendapatan per tanggal bayar ==");
const vKemarin = (await execute(
  `INSERT INTO visits (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id, jenis_kunjungan, status, registered_by)
   VALUES (?,?,?,?,?,?, 'lama', 'selesai', ?)`,
  [site, pasien, `${TANDA}/V/K`, tambahHari(hariIni, -1), poli, dokB, admin],
)).insertId;
await execute(
  `INSERT INTO billing_transactions (site_id, visit_id, no_invoice, subtotal, total, status, paid_at)
   VALUES (?,?,?, 77000, 77000, 'lunas', NOW())`,
  [site, vKemarin, `${TANDA}/INV/K`],
);
const r = await ringkasanCabang(site, hariIni, hariIni);
ok("tagihan kunjungan kemarin yang dibayar hari ini masuk pendapatan HARI INI",
  r.pendapatan >= 77000, String(r.pendapatan));
const rKemarin = await ringkasanCabang(site, tambahHari(hariIni, -1), tambahHari(hariIni, -1));
ok("dan tidak ikut pendapatan kemarin", rKemarin.pendapatan === 0, String(rKemarin.pendapatan));

// =====================================================================
console.log("\n== 8. Surat oleh dokter pemeriksa ==");
await execute(`INSERT INTO medical_assessments (visit_id, site_id, doctor_id, status) VALUES (?,?,?, 'final')`, [vKemarin, site, dokC]);
const surat = () => suratSchema.parse({ visit_id: vKemarin, jenis: "sehat", keperluan: "Uji" });
ok("dokter terjadwal yang TIDAK memeriksa ditolak", (await ditolak(() => terbitkanSurat(surat(), site, dokB))) !== "");
ok("dokter pemeriksa boleh menerbitkan", (await ditolak(() => terbitkanSurat(surat(), site, dokC))) === "");

// =====================================================================
console.log("\n== 9. Persetujuan tindakan membekukan nama ==");
const proc = (await execute(`INSERT INTO medical_procedures (kode, nama, tarif) VALUES ('${TANDA}-T', 'Jahit Luka Uji', 50000)`)).insertId;
const idConsent = await simpanConsent(consentSchema.parse({
  visit_id: vKemarin, jenis: "tindakan", judul: "Persetujuan Tindakan",
  isi: "Saya telah mendapat penjelasan dan menyetujui dilakukannya tindakan tersebut.",
  procedure_id: proc, penjelasan_oleh: dokC, penandatangan: "Pasien Sisa",
}), site, dokC);
await execute(`UPDATE medical_procedures SET nama = 'Nama Baru' WHERE id = ?`, [proc]);
const isi = String((await queryOne<RowDataPacket & { isi: string }>(`SELECT isi FROM consents WHERE id = ?`, [idConsent]))!.isi);
ok("nama tindakan tersimpan di teks persetujuan", isi.includes("Jahit Luka Uji"), isi.slice(-80));
ok("nama pemberi penjelasan tersimpan", isi.includes(`${TANDA}.dokC`));
ok("teks tidak berubah setelah master tindakan diganti", !isi.includes("Nama Baru"));

// =====================================================================
await bersih();
await pool.end();
console.log(gagal ? `\n${gagal} GAGAL` : "\nSEMUA UJI LULUS");
process.exit(gagal ? 1 : 0);
