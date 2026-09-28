/**
 * Uji ALUR LABORATORIUM ASINKRON, VALIDASI DOKTER, DAN PEMBATALAN KUNJUNGAN.
 *
 *   node uji/jalankan.mjs uji-alur-lab.ts
 *
 * Yang diuji, dan mengapa masing-masing penting:
 *
 *   1. `sifat_hasil` memisahkan dua kebutuhan yang sama-sama benar. Hasil
 *      DITUNGGU menahan pasien; hasil MENYUSUL tidak. Tanpa pembedaan ini,
 *      menahan semua pasien berarti kultur resistensi lima hari menghentikan
 *      pelayanan, dan tidak menahan siapa pun berarti dokter tidak pernah
 *      membaca hasil yang ia pesan.
 *   2. Hasil yang ditunggu SELALU kembali ke dokter — termasuk bila asesmen
 *      sudah terlanjur final. Pemeriksaan yang hasilnya tidak pernah dibaca
 *      adalah biaya yang ditagihkan tanpa manfaat klinis.
 *   3. Finalisasi asesmen DITOLAK selama masih ada hasil yang ditunggu.
 *   4. Kunjungan yang sudah tutup tidak dihidupkan kembali oleh hasil yang
 *      menyusul berhari-hari kemudian.
 *   5. Pembatalan kunjungan melepas kunci stok, membatalkan resep & order
 *      lab, dan menutup antreannya.
 *   6. Pasien boleh mendaftar lebih dari sekali sehari, tetapi tidak boleh
 *      berada di antrean poli yang sama dua kali sekaligus.
 *   7. Parameter lab yang pernah dipakai tidak bisa dihapus.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne, transaction } from "../src/lib/db";
import { tambahStok } from "../src/lib/stock";
import { terimaResep, validasiResep } from "../src/lib/pharmacy";
import { simpanResep } from "../src/lib/prescription";
import { prosesPembayaran } from "../src/lib/cashier";
import {
  batalkanOrderLab, buatOrderLab, simpanHasilLab, ubahSifatHasil,
} from "../src/lib/lab";
import { simpanAsesmen, tertundaDokter, worklistDokter } from "../src/lib/doctor";
import { sapuKunjunganTertunda } from "../src/lib/notifications";
import { tertundaPerawat } from "../src/lib/nurse";
import {
  batalkanKunjungan, daftarkanKunjungan, kunjunganTertunda,
} from "../src/lib/visits";
import { tanggalHariIni } from "../src/lib/tanggal";
import { asesmenSchema, resepSchema } from "../src/lib/validations/doctor";
import { pembayaranSchema } from "../src/lib/validations/cashier";
import { hasilLabSchema, orderLabSchema } from "../src/lib/validations/lab";
import { visitSchema } from "../src/lib/validations/patient";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

const TANDA = "UJILAB";

// =====================================================================
// Persiapan
// =====================================================================
async function bersih() {
  const sites = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM sites WHERE kode LIKE '${TANDA}%'`)
  ).map((r) => r.id);
  const items = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM items WHERE kode LIKE '${TANDA}%'`)
  ).map((r) => r.id);

  if (sites.length) {
    const s = sites.join(",");
    await execute(`DELETE FROM notifications WHERE site_id IN (${s})`);
    await execute(`DELETE FROM billing_items WHERE billing_id IN (SELECT id FROM billing_transactions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM billing_transactions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM prescription_racikans WHERE prescription_id IN (SELECT id FROM prescriptions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM prescription_items WHERE prescription_id IN (SELECT id FROM prescriptions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM prescriptions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM cashier_shifts WHERE site_id IN (${s})`);
    await execute(`DELETE FROM queues WHERE site_id IN (${s})`);
    await execute(`DELETE FROM lab_results WHERE order_id IN (SELECT id FROM lab_orders WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM lab_order_panels WHERE order_id IN (SELECT id FROM lab_orders WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM lab_orders WHERE site_id IN (${s})`);
    await execute(`DELETE FROM assessment_procedures WHERE assessment_id IN (SELECT id FROM medical_assessments WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM assessment_diagnoses WHERE assessment_id IN (SELECT id FROM medical_assessments WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM medical_assessments WHERE site_id IN (${s})`);
    await execute(`DELETE FROM visits WHERE site_id IN (${s})`);
    await execute(`DELETE FROM patient_allergies WHERE patient_id IN (SELECT id FROM patients WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM patients WHERE site_id IN (${s})`);
    await execute(`DELETE FROM stock_movements WHERE site_id IN (${s})`);
    await execute(`DELETE FROM item_batches WHERE site_id IN (${s})`);
    await execute(`DELETE FROM item_stocks WHERE site_id IN (${s})`);
    await execute(`DELETE FROM polis WHERE site_id IN (${s})`);
    await execute(`DELETE FROM sequences WHERE site_id IN (${s})`);
    await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
    await execute(`DELETE FROM sites WHERE id IN (${s})`);
  } else {
    await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
  }
  if (items.length) {
    const l = items.join(",");
    await execute(`DELETE FROM stock_movements WHERE item_id IN (${l})`);
    await execute(`DELETE FROM item_stocks WHERE item_id IN (${l})`);
    await execute(`DELETE FROM items WHERE id IN (${l})`);
  }
  await execute(`DELETE FROM lab_results WHERE parameter_id IN (SELECT id FROM lab_parameters WHERE kode LIKE '${TANDA}%')`);
  await execute(`DELETE FROM lab_parameters WHERE panel_id IN (SELECT id FROM lab_panels WHERE kode LIKE '${TANDA}%')`);
  await execute(`DELETE FROM lab_panels WHERE kode LIKE '${TANDA}%'`);
  await execute(`DELETE FROM medical_procedures WHERE kode LIKE '${TANDA}%'`);
}
await bersih();

const site = (await execute(
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}', 'Uji Alur Lab')`,
)).insertId;

const roleId = async (c: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM roles WHERE code = ?`, [c]))!.id);

const buatUser = async (u: string, n: string, c: string) =>
  (await execute(
    `INSERT INTO users (site_id, role_id, nama, username, password_hash) VALUES (?,?,?,?,'x')`,
    [site, await roleId(c), n, u],
  )).insertId;

const dokter = await buatUser(`${TANDA}.dokter`, "dr. Uji Lab", "dokter");
const apoteker = await buatUser(`${TANDA}.apt`, "apt. Uji Lab", "farmasi");
const kasir = await buatUser(`${TANDA}.kasir`, "Kasir Lab", "kasir");
const analis = await buatUser(`${TANDA}.lab`, "Analis Lab", "petugas_lab");
const admin = await buatUser(`${TANDA}.admin`, "Admin Lab", "admin_cabang");

const poli = (await execute(
  `INSERT INTO polis (site_id, kode, nama, prefix_antrean) VALUES (?, '${TANDA}-P', 'Poli Uji', 'U')`,
  [site],
)).insertId;
const poliDua = (await execute(
  `INSERT INTO polis (site_id, kode, nama, prefix_antrean) VALUES (?, '${TANDA}-Q', 'Poli Gigi Uji', 'G')`,
  [site],
)).insertId;

const item = (await execute(
  `INSERT INTO items (kode, nama, tipe, satuan_dasar, hpp, harga_jual)
   VALUES ('${TANDA}-OBAT', 'Obat Uji Lab', 'obat', 'tablet', 1000, 2000)`,
)).insertId;

await transaction((conn) =>
  tambahStok(conn, {
    siteId: site, itemId: item, qty: 100, jenis: "masuk_pembelian",
    refType: "purchase", userId: apoteker,
  }),
);

const panel = (await execute(
  `INSERT INTO lab_panels (kode, nama, kategori, tarif)
   VALUES ('${TANDA}-P1', 'Panel Uji Lab', 'Uji', 40000)`,
)).insertId;
const parameterId = (await execute(
  `INSERT INTO lab_parameters (panel_id, kode, nama, tipe_nilai, urutan)
   VALUES (?, '${TANDA}-PAR', 'Parameter Uji', 'numerik', 1)`,
  [panel],
)).insertId;

const icd = (await queryOne<RowDataPacket & { code: string }>(
  `SELECT code FROM icd10_codes WHERE is_active = 1 LIMIT 1`,
))!.code;

let n = 0;
async function buatPasien() {
  n++;
  return (await execute(
    `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin)
     VALUES (?,?,?,?, '1990-01-01', 'L')`,
    [site, `${TANDA}-${n}`, `327300000011${1000 + n}`, `Pasien Lab ${n}`],
  )).insertId;
}

async function daftar(patientId: number, poliId = poli) {
  const hasil = await daftarkanKunjungan(
    visitSchema.parse({
      patient_id: patientId, poli_id: poliId, doctor_id: dokter,
      cara_bayar: "umum",
    }),
    site,
    admin,
  );
  return hasil.id;
}

const statusVisit = async (id: number) =>
  String((await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM visits WHERE id = ?`, [id]))!.status);

const asesmen = (finalkan: boolean) =>
  asesmenSchema.parse({
    finalkan,
    jenis_anamnesis: "auto",
    keluhan_utama: "Uji alur lab",
    status_lokalis: { regio: {}, titik: [] },
    diagnoses: [{ icd10_code: icd, nama: "Diagnosa uji", tipe: "primer" }],
    procedures: [],
  });

const order = async (visitId: number, sifat: "ditunggu" | "menyusul") =>
  (await buatOrderLab(
    visitId, site, dokter,
    orderLabSchema.parse({
      prioritas: "rutin",
      sifat_hasil: sifat,
      panels: [{ panel_id: panel, nama: "Panel Uji Lab", tarif: 40000 }],
    }),
  )).orderId;

const finalkanHasil = (orderId: number) =>
  simpanHasilLab(
    orderId, site, analis,
    hasilLabSchema.parse({
      finalkan: true,
      hasil: [{ parameter_id: parameterId, panel_id: panel, nilai: "9" }],
    }),
  );

// =====================================================================
// 1. Hasil DITUNGGU menahan pasien; MENYUSUL tidak
// =====================================================================
console.log("\n== 1. Ditunggu menahan, menyusul tidak ==");

const p1 = await buatPasien();
const v1 = await daftar(p1);
await execute(`UPDATE visits SET status = 'dalam_pemeriksaan' WHERE id = ?`, [v1]);
await order(v1, "ditunggu");
ok("order ditunggu mendorong pasien ke lab",
  (await statusVisit(v1)) === "menunggu_lab", await statusVisit(v1));

const p2 = await buatPasien();
const v2 = await daftar(p2);
await execute(`UPDATE visits SET status = 'dalam_pemeriksaan' WHERE id = ?`, [v2]);
await order(v2, "menyusul");
ok("order menyusul TIDAK memindahkan pasien",
  (await statusVisit(v2)) === "dalam_pemeriksaan", await statusVisit(v2));
ok("tarifnya tetap masuk tagihan — sampel sudah diambil",
  Number((await queryOne<RowDataPacket & { total: string }>(
    `SELECT total FROM billing_transactions WHERE visit_id = ?`, [v2]))!.total) === 40000);

// =====================================================================
// 2. Finalisasi ditolak selama hasil masih ditunggu
// =====================================================================
console.log("\n== 2. Finalisasi menunggu hasil ==");

let tolakFinal = "";
try {
  await simpanAsesmen(v1, site, dokter, asesmen(true));
} catch (e) {
  tolakFinal = (e as Error).message;
}
ok("finalisasi DITOLAK selama hasil ditunggu", tolakFinal !== "", tolakFinal);
ok("pesannya menyebut nomor order & jalan keluarnya",
  /UJILAB\/L\//.test(tolakFinal) && /menyusul/.test(tolakFinal), tolakFinal);

// Draft tetap boleh disimpan — dokter harus bisa mencatat sambil menunggu.
await simpanAsesmen(v1, site, dokter, asesmen(false));
ok("draft tetap bisa disimpan sambil menunggu",
  (await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM medical_assessments WHERE visit_id = ?`, [v1]))?.status === "draft");

/* Order MENYUSUL tidak menghalangi finalisasi — kalau menghalangi, kunjungan
   dengan pemeriksaan rujukan tidak akan pernah bisa ditutup. */
await simpanAsesmen(v2, site, dokter, asesmen(true));
ok("order menyusul TIDAK menghalangi finalisasi",
  (await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM medical_assessments WHERE visit_id = ?`, [v2]))?.status === "final");
ok("pasien lanjut ke kasir meski hasil lab belum keluar",
  (await statusVisit(v2)) === "menunggu_kasir", await statusVisit(v2));

// =====================================================================
// 3. Hasil ditunggu SELALU kembali ke dokter
// =====================================================================
console.log("\n== 3. Hasil kembali ke dokter untuk dinilai ==");

const o1 = await queryOne<RowDataPacket & { id: number }>(
  `SELECT id FROM lab_orders WHERE visit_id = ?`, [v1],
);
await finalkanHasil(Number(o1!.id));
ok("hasil ditunggu mengembalikan pasien ke DOKTER",
  (await statusVisit(v1)) === "menunggu_dokter", await statusVisit(v1));

// Sekarang finalisasi baru boleh, dan itulah tombol kirim ke tahap berikutnya.
await simpanAsesmen(v1, site, dokter, asesmen(true));
ok("setelah hasil dinilai, finalisasi berhasil",
  (await statusVisit(v1)) === "menunggu_kasir", await statusVisit(v1));

/*
 * Kasus yang dulu paling merugikan: asesmen SUDAH final lebih dulu (misalnya
 * ordernya menyusul lalu diubah jadi ditunggu), hasil keluar, dan kode lama
 * melempar pasien langsung ke kasir tanpa dokter pernah membacanya.
 */
const p3 = await buatPasien();
const v3 = await daftar(p3);
await execute(`UPDATE visits SET status = 'dalam_pemeriksaan' WHERE id = ?`, [v3]);
const o3 = await order(v3, "menyusul");
await simpanAsesmen(v3, site, dokter, asesmen(true));
ok("asesmen final duluan, pasien di kasir",
  (await statusVisit(v3)) === "menunggu_kasir", await statusVisit(v3));

await ubahSifatHasil(o3, site, "ditunggu");
ok("diubah jadi ditunggu → pasien ditarik kembali ke lab",
  (await statusVisit(v3)) === "menunggu_lab", await statusVisit(v3));

await finalkanHasil(o3);
ok("hasil ditunggu kembali ke dokter MESKI asesmen sudah final",
  (await statusVisit(v3)) === "menunggu_dokter", await statusVisit(v3));

// =====================================================================
// 4. Hasil menyusul tidak menghidupkan kunjungan yang sudah tutup
// =====================================================================
console.log("\n== 4. Kunjungan tutup tidak dihidupkan hasil susulan ==");

const t2 = await queryOne<RowDataPacket & { id: number }>(
  `SELECT id FROM billing_transactions WHERE visit_id = ?`, [v2],
);
await prosesPembayaran(
  Number(t2!.id), site, kasir, null,
  pembayaranSchema.parse({ payment_method: "tunai", dibayar: 999999, diskon: 0 }),
  0,
);
ok("tanpa resep, kunjungan langsung selesai di kasir",
  (await statusVisit(v2)) === "selesai", await statusVisit(v2));

const o2 = await queryOne<RowDataPacket & { id: number }>(
  `SELECT id FROM lab_orders WHERE visit_id = ?`, [v2],
);
await finalkanHasil(Number(o2!.id));
ok("hasil susulan TIDAK menghidupkan kunjungan yang sudah selesai",
  (await statusVisit(v2)) === "selesai", await statusVisit(v2));
ok("hasilnya tetap tersimpan pada kunjungan itu",
  (await query(`SELECT id FROM lab_results WHERE order_id = ?`, [Number(o2!.id)])).length === 1);

const notifDokter = await queryOne<RowDataPacket & { judul: string }>(
  `SELECT judul FROM notifications
    WHERE user_id = ? AND jenis IN ('hasil_lab','hasil_lab_kritis')
    ORDER BY id DESC LIMIT 1`,
  [dokter],
);
ok("dokter tetap dinotifikasi hasil susulannya",
  notifDokter !== null, String(notifDokter?.judul));

// =====================================================================
// 5. Pembatalan order lab oleh petugas lab memberi tahu dokter
// =====================================================================
console.log("\n== 5. Petugas lab membatalkan order ==");

const p5 = await buatPasien();
const v5 = await daftar(p5);
await execute(`UPDATE visits SET status = 'dalam_pemeriksaan' WHERE id = ?`, [v5]);
const o5 = await order(v5, "ditunggu");

await batalkanOrderLab(o5, site, "Sampel lisis, pasien menolak diambil ulang", analis, "Analis Lab");

ok("tarifnya keluar dari tagihan",
  Number((await queryOne<RowDataPacket & { total: string }>(
    `SELECT total FROM billing_transactions WHERE visit_id = ?`, [v5]))!.total) === 0);
ok("pasien tidak tertinggal di lab",
  (await statusVisit(v5)) === "menunggu_dokter", await statusVisit(v5));

const notifBatal = await queryOne<RowDataPacket & { judul: string; pesan: string }>(
  `SELECT judul, pesan FROM notifications
    WHERE user_id = ? AND jenis = 'order_lab_batal' ORDER BY id DESC LIMIT 1`,
  [dokter],
);
ok("dokter pemesan diberi tahu", notifBatal !== null, String(notifBatal?.judul));
ok("alasannya ikut disampaikan",
  /Sampel lisis/.test(String(notifBatal?.pesan)), String(notifBatal?.pesan));
ok("alasan tersimpan di kolomnya sendiri, bukan di catatan klinis",
  (await queryOne<RowDataPacket & { alasan_batal: string; catatan_klinis: string | null }>(
    `SELECT alasan_batal, catatan_klinis FROM lab_orders WHERE id = ?`, [o5],
  ))?.alasan_batal?.startsWith("Sampel lisis") === true);

// Finalisasi kini tidak lagi terhalang — ordernya sudah tidak berjalan.
await simpanAsesmen(v5, site, dokter, asesmen(true));
ok("finalisasi berhasil setelah order dibatalkan",
  (await statusVisit(v5)) === "menunggu_kasir", await statusVisit(v5));

// =====================================================================
// 6. Pembatalan kunjungan
// =====================================================================
console.log("\n== 6. Pembatalan kunjungan ==");

const p6 = await buatPasien();
const v6 = await daftar(p6);
await execute(`UPDATE visits SET status = 'dalam_pemeriksaan' WHERE id = ?`, [v6]);
const rx6 = await simpanResep(
  v6, site, dokter,
  resepSchema.parse({
    items: [{
      item_id: item, nama: "Obat Uji Lab", qty: 5, satuan: "tablet",
      aturan_pakai: "3 x sehari 1 tablet", harga_satuan: 2000,
    }],
    racikans: [],
  }),
);
/* Ordernya sengaja MENYUSUL: farmasi tidak boleh mengunci resep selagi
   dokter masih menunggu hasil, dan yang diuji di bagian ini adalah
   pembatalan kunjungan yang resepnya sudah terkunci. */
const o6 = await order(v6, "menyusul");
// Dokter menekan Finalkan Asesmen — resep baru sampai di farmasi setelahnya.
await execute(`UPDATE visits SET status = 'menunggu_farmasi' WHERE id = ?`, [v6]);
await terimaResep(rx6.prescriptionId, site, apoteker);
await validasiResep(rx6.prescriptionId, site, apoteker);

const reservasiSebelum = Number((await queryOne<RowDataPacket & { r: string }>(
  `SELECT qty_reserved r FROM item_stocks WHERE item_id = ? AND site_id = ?`,
  [item, site]))!.r);
ok("resep memegang kunci stok", reservasiSebelum === 5, String(reservasiSebelum));

await batalkanKunjungan(v6, site, admin, "Pasien pulang sebelum dipanggil");

ok("kunjungan berstatus batal", (await statusVisit(v6)) === "batal", await statusVisit(v6));
ok("kunci stok DILEPAS",
  Number((await queryOne<RowDataPacket & { r: string }>(
    `SELECT qty_reserved r FROM item_stocks WHERE item_id = ? AND site_id = ?`,
    [item, site]))!.r) === 0);
ok("stok fisik tidak ikut berubah",
  Number((await queryOne<RowDataPacket & { q: string }>(
    `SELECT qty_on_hand q FROM item_stocks WHERE item_id = ? AND site_id = ?`,
    [item, site]))!.q) === 100);
ok("resepnya dibatalkan",
  (await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM prescriptions WHERE id = ?`, [rx6.prescriptionId]))?.status === "batal");
ok("order labnya dibatalkan",
  (await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM lab_orders WHERE id = ?`, [o6]))?.status === "batal");
ok("tagihannya dibatalkan",
  (await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM billing_transactions WHERE visit_id = ?`, [v6]))?.status === "batal");
ok("baris antreannya ditutup",
  (await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM queues WHERE visit_id = ?`, [v6]))?.status === "batal");

let tolakBatalUlang = "";
try {
  await batalkanKunjungan(v6, site, admin, "Coba batalkan dua kali");
} catch (e) {
  tolakBatalUlang = (e as Error).message;
}
ok("pembatalan dua kali ditolak", tolakBatalUlang !== "", tolakBatalUlang);

/* Kunjungan yang sudah LUNAS tidak bisa dibatalkan begitu saja. */
let tolakLunas = "";
try {
  await batalkanKunjungan(v2, site, admin, "Coba batalkan yang sudah bayar");
} catch (e) {
  tolakLunas = (e as Error).message;
}
ok("kunjungan yang sudah lunas/selesai ditolak", tolakLunas !== "", tolakLunas);

// =====================================================================
// 7. Kunjungan berulang dalam sehari
// =====================================================================
console.log("\n== 7. Pasien datang lebih dari sekali sehari ==");

const p7 = await buatPasien();
const v7a = await daftar(p7);

let tolakDobel = "";
try {
  await daftar(p7);
} catch (e) {
  tolakDobel = (e as Error).message;
}
ok("pendaftaran kedua di poli SAMA saat yang pertama masih berjalan → ditolak",
  tolakDobel !== "", tolakDobel);
ok("pesannya menyebut nomor antrean yang masih berjalan",
  /U0\d\d/.test(tolakDobel), tolakDobel);

/* Poli LAIN tetap boleh — pasien memang bisa ke dua poli dalam sehari. */
const v7b = await daftar(p7, poliDua);
ok("poli berbeda pada hari yang sama tetap boleh", v7b > 0);

/* Setelah kunjungan pertama tuntas, poli yang sama boleh lagi. */
await execute(`UPDATE visits SET status = 'selesai' WHERE id = ?`, [v7a]);
const v7c = await daftar(p7);
ok("poli yang sama boleh lagi setelah kunjungan pertama selesai", v7c > 0);
ok("keduanya kunjungan terpisah dengan nomor sendiri",
  (await query(`SELECT id FROM visits WHERE patient_id = ? AND poli_id = ?`, [p7, poli])).length === 2);

// =====================================================================
// 8. Parameter lab yang sudah dipakai tidak boleh dihapus
// =====================================================================
console.log("\n== 8. Parameter lab dinonaktifkan, bukan dihapus ==");

const terpakai = await queryOne<RowDataPacket & { n: number }>(
  `SELECT COUNT(*) n FROM lab_results WHERE parameter_id = ?`, [parameterId],
);
ok("parameter uji ini memang sudah dipakai", Number(terpakai?.n) > 0, String(terpakai?.n));

let tolakHapus = "";
try {
  await execute(`DELETE FROM lab_parameters WHERE id = ?`, [parameterId]);
} catch (e) {
  tolakHapus = (e as Error).message;
}
ok("database MENOLAK penghapusannya — inilah sebabnya harus dinonaktifkan",
  tolakHapus !== "", tolakHapus.slice(0, 80));

await execute(`UPDATE lab_parameters SET is_active = 0 WHERE id = ?`, [parameterId]);
ok("hasil pemeriksaan lama tetap utuh setelah dinonaktifkan",
  Number((await queryOne<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) n FROM lab_results WHERE parameter_id = ?`, [parameterId]))?.n) > 0);
await execute(`UPDATE lab_parameters SET is_active = 1 WHERE id = ?`, [parameterId]);

// =====================================================================
// 9. Kunjungan tertunda tidak boleh hilang dari layar
// =====================================================================
console.log("\n== 9. Kunjungan tertinggal semalam tetap terlihat ==");

/*
 * Kegagalan yang sebenarnya terjadi di lapangan: tiga kunjungan berstatus
 * `menunggu_dokter` bertanggal berhari-hari lalu, tidak muncul di dokter mana
 * pun. Sebabnya bukan status, melainkan `v.tanggal = ?` pada worklist —
 * begitu tanggalnya berganti, pasien lenyap sementara sistem tetap
 * menganggapnya sedang dilayani.
 *
 * Yang membuatnya berbahaya: layar Pendaftaran juga hanya menampilkan hari
 * ini, sehingga kunjungan itu bahkan tidak bisa DIBATALKAN. Ia membeku —
 * tidak maju, tidak tutup, tidak terlihat siapa pun.
 *
 * Alur lab asinkron memperbanyak kejadiannya: hasil `ditunggu` yang baru
 * difinalkan besok mendorong kunjungan ke `menunggu_dokter` pada tanggal
 * kemarin, langsung tak terlihat begitu ia dibuat.
 */
const p9 = await buatPasien();
const v9 = await daftar(p9);
await execute(
  `UPDATE visits SET tanggal = DATE_SUB(CURDATE(), INTERVAL 3 DAY),
                     status = 'menunggu_dokter' WHERE id = ?`,
  [v9],
);
await execute(
  `UPDATE queues SET tanggal = DATE_SUB(CURDATE(), INTERVAL 3 DAY) WHERE visit_id = ?`,
  [v9],
);

const antreanHariIni = await worklistDokter(site, dokter, tanggalHariIni());
ok("kunjungan kemarin memang TIDAK muncul di antrean hari ini",
  !antreanHariIni.some((v) => Number(v.visit_id) === v9));

const daftarTertunda = await tertundaDokter(site, dokter, tanggalHariIni());
ok("tetapi muncul di daftar TERTUNDA dokter",
  daftarTertunda.some((v) => Number(v.visit_id) === v9),
  `${daftarTertunda.length} tertunda`);

const tertundaPendaftaran = await kunjunganTertunda(site, tanggalHariIni());
ok("dan terlihat Pendaftaran, supaya bisa dibatalkan",
  tertundaPendaftaran.some((v) => Number(v.id) === v9),
  `${tertundaPendaftaran.length} tertunda`);

/* Perawat punya perangkap yang sama. */
const p9b = await buatPasien();
const v9b = await daftar(p9b);
await execute(
  `UPDATE visits SET tanggal = DATE_SUB(CURDATE(), INTERVAL 2 DAY) WHERE id = ?`,
  [v9b],
);
ok("pasien belum dikaji dari hari lalu muncul di daftar tertunda perawat",
  (await tertundaPerawat(site, tanggalHariIni())).some((v) => Number(v.visit_id) === v9b));

/* Dan benar-benar bisa ditutup dari sana. */
await batalkanKunjungan(v9, site, admin, "Pasien tidak kembali, kunjungan dibersihkan");
ok("kunjungan tertunda bisa dibatalkan",
  (await statusVisit(v9)) === "batal", await statusVisit(v9));
ok("sesudah dibatalkan ia hilang dari daftar tertunda",
  !(await tertundaDokter(site, dokter, tanggalHariIni()))
    .some((v) => Number(v.visit_id) === v9));

// =====================================================================
// 10. Sapuan harian memberi tahu Admin Cabang
// =====================================================================
console.log("\n== 10. Sapuan kunjungan tertunda ==");

/*
 * Menampilkan saja tidak cukup: tidak ada yang punya alasan membuka layar
 * "Tertunda" kalau ia tidak tahu ada yang perlu dibereskan — dan justru
 * kunjungan yang menggantung berminggu-minggu yang paling tidak akan
 * ditemukan siapa pun. Yang ikut tersangkut di dalamnya adalah kunci stok
 * resep yang sudah divalidasi.
 */
const p10 = await buatPasien();
const v10 = await daftar(p10);
await execute(
  `UPDATE visits SET tanggal = DATE_SUB(CURDATE(), INTERVAL 5 DAY) WHERE id = ?`,
  [v10],
);
await execute(`DELETE FROM notifications WHERE site_id = ? AND jenis = 'kunjungan_tertunda'`, [site]);

const sapuan1 = await sapuKunjunganTertunda();
const cabangIni = sapuan1.find((h) => h.siteId === site);
ok("cabang dengan kunjungan tertunda ikut tersapu", cabangIni !== undefined);
/* DUA: `v10` (5 hari) dan `v9b` dari bagian sebelumnya (2 hari, belum
   dikaji perawat). `v9` tidak terhitung karena sudah dibatalkan — dan itu
   memang yang harus terjadi. */
ok("jumlahnya benar — hanya yang belum tuntas", cabangIni?.jumlah === 2,
  String(cabangIni?.jumlah));
ok("umur kunjungan tertua ikut dihitung", cabangIni?.hariTertua === 5,
  String(cabangIni?.hariTertua));
ok("notifikasinya terkirim", cabangIni?.terkirim === true);

const notif = await queryOne<RowDataPacket & {
  judul: string; pesan: string; role_id: number; link: string;
}>(
  `SELECT judul, pesan, role_id, link FROM notifications
    WHERE site_id = ? AND jenis = 'kunjungan_tertunda' ORDER BY id DESC LIMIT 1`,
  [site],
);
ok("ditujukan ke ADMIN CABANG — satu-satunya yang bisa membatalkan",
  Number(notif?.role_id) === (await roleId("admin_cabang")), String(notif?.role_id));
ok("judulnya menyebut jumlahnya", /2 kunjungan tertunda/.test(String(notif?.judul)),
  String(notif?.judul));
ok("pesannya menyebut kunci stok yang ikut tersangkut",
  /mengunci stok/.test(String(notif?.pesan)), String(notif?.pesan));
ok("mengarah ke Pendaftaran, tempat pembatalan dilakukan",
  notif?.link === "/pendaftaran", String(notif?.link));

/*
 * Idempoten. Penjadwal tugas yang mengulang percobaan, atau admin yang
 * penasaran menjalankannya lagi, tidak boleh menumpuk notifikasi yang sama.
 */
const sapuan2 = await sapuKunjunganTertunda();
ok("sapuan kedua hari ini DILEWATI",
  sapuan2.find((h) => h.siteId === site)?.terkirim === false);
ok("tidak ada notifikasi kedua yang tertumpuk",
  (await query(
    `SELECT id FROM notifications WHERE site_id = ? AND jenis = 'kunjungan_tertunda'`,
    [site],
  )).length === 1);

/* Ambang hari dihormati: 5 hari tidak tersapu oleh ambang 10 hari. */
await execute(`DELETE FROM notifications WHERE site_id = ? AND jenis = 'kunjungan_tertunda'`, [site]);
ok("ambang yang lebih longgar melewatkan kunjungan yang masih muda",
  (await sapuKunjunganTertunda(10)).find((h) => h.siteId === site) === undefined);

// =====================================================================
await bersih();
console.log(`\n${gagal === 0 ? "SEMUA UJI LULUS" : `${gagal} UJI GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
