/**
 * SIMULASI SATU HARI KLINIK — menjalankan seluruh alur, lintas modul.
 *
 *   node uji/jalankan.mjs uji/simulasi-klinik.ts
 *
 * MENGAPA INI ADA
 *
 * Uji per modul membuktikan setiap bagian benar sendirian. Yang tidak
 * dibuktikannya adalah bahwa bagian-bagian itu masih benar ketika dipakai
 * berurutan oleh empat pasien berbeda pada hari yang sama — dan justru di
 * sambungannya kerusakan biasanya bersembunyi.
 *
 * Simulasi ini memerankan satu hari kerja sungguhan:
 *
 *   Pendaftaran → Perawat (TTV + BMHP) → Dokter (SOAP, persetujuan,
 *   order lab, resep) → Lab → Dokter menilai → Farmasi validasi →
 *   Kasir (dengan pembagian tanggungan penjamin) → Farmasi serahkan →
 *   Klaim → Laporan wajib.
 *
 * Empat pasien dipilih supaya keempat cara pembiayaan ikut teruji:
 *
 *   1. Umum        — bayar sendiri
 *   2. Perusahaan  — ditanggung penuh, tanpa plafon
 *   3. Asuransi    — berplafon, sehingga pasien menanggung selisihnya
 *   4. Perusahaan  — ditanggung penuh, dipakai untuk klaim kedua
 *
 * Setiap tahap MEMERIKSA keadaannya, bukan hanya menjalankannya. Yang
 * dicetak adalah jalannya hari itu; yang dihitung adalah kejanggalannya.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne, transaction } from "../src/lib/db";
import { tambahStok } from "../src/lib/stock";
import { daftarkanKunjungan } from "../src/lib/visits";
import { simpanPengkajian } from "../src/lib/nurse";
import { simpanAsesmen } from "../src/lib/doctor";
import { buatOrderLab, simpanHasilLab } from "../src/lib/lab";
import { simpanResep } from "../src/lib/prescription";
import { serahkanResep, terimaResep, validasiResep } from "../src/lib/pharmacy";
import { bukaShift, prosesPembayaran, tutupShift } from "../src/lib/cashier";
import { simpanPenjamin, simpanTarifPenjamin } from "../src/lib/penjamin";
import {
  ajukanKlaim, barisKlaim, buatKlaim, catatPembayaranKlaim,
  ringkasanKlaim, umurPiutang, verifikasiKlaim,
} from "../src/lib/klaim";
import { laporkanIkp, simpanConsent, tindakLanjutIkp } from "../src/lib/kepatuhan";
import { kesiapanSipnap, rekapSipnap } from "../src/lib/sipnap";
import { kesiapanLb1, lb1Morbiditas, ringkasanCabang } from "../src/lib/laporan";
import { visitSchema } from "../src/lib/validations/patient";
import { nurseAssessmentSchema } from "../src/lib/validations/nurse";
import { asesmenSchema, resepSchema } from "../src/lib/validations/doctor";
import { hasilLabSchema, orderLabSchema } from "../src/lib/validations/lab";
import { pembayaranSchema } from "../src/lib/validations/cashier";
import { penjaminSchema, tarifPenjaminSchema } from "../src/lib/validations/penjamin";
import { bayarKlaimSchema, klaimBaruSchema } from "../src/lib/validations/klaim";
import { consentSchema, ikpSchema, tindakLanjutIkpSchema } from "../src/lib/validations/kepatuhan";
import { formatRupiah } from "../src/lib/format";
import { tanggalHariIni } from "../src/lib/tanggal";

let janggal = 0;
const cek = (nama: string, benar: boolean, detail = "") => {
  console.log(`    ${benar ? "OK  " : "!!  "} ${nama}${detail ? " — " + detail : ""}`);
  if (!benar) janggal++;
};
const babak = (n: string) => console.log(`\n${"─".repeat(66)}\n  ${n}\n${"─".repeat(66)}`);
const langkah = (n: string) => console.log(`\n  ▸ ${n}`);

const TANDA = "SIMKLN";
const hariIni = tanggalHariIni();

// =====================================================================
// Persiapan: satu cabang lengkap
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
    await execute(`DELETE FROM claim_payments WHERE claim_id IN (SELECT id FROM claims WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM claim_items WHERE claim_id IN (SELECT id FROM claims WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM claims WHERE site_id IN (${s})`);
    await execute(`DELETE FROM notifications WHERE site_id IN (${s})`);
    await execute(`DELETE FROM patient_safety_incidents WHERE site_id IN (${s})`);
    await execute(`DELETE FROM consents WHERE site_id IN (${s})`);
    await execute(`DELETE FROM billing_items WHERE billing_id IN (SELECT id FROM billing_transactions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM billing_transactions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM cashier_shifts WHERE site_id IN (${s})`);
    await execute(`DELETE FROM prescription_racikan_ingredients WHERE racikan_id IN (SELECT id FROM prescription_racikans WHERE prescription_id IN (SELECT id FROM prescriptions WHERE site_id IN (${s})))`);
    await execute(`DELETE FROM prescription_racikans WHERE prescription_id IN (SELECT id FROM prescriptions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM prescription_items WHERE prescription_id IN (SELECT id FROM prescriptions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM prescriptions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM lab_results WHERE order_id IN (SELECT id FROM lab_orders WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM lab_order_panels WHERE order_id IN (SELECT id FROM lab_orders WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM lab_orders WHERE site_id IN (${s})`);
    await execute(`DELETE FROM nurse_bmhp_usage WHERE nurse_assessment_id IN (SELECT id FROM nurse_assessments WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM nurse_assessments WHERE site_id IN (${s})`);
    await execute(`DELETE FROM assessment_diagnoses WHERE assessment_id IN (SELECT id FROM medical_assessments WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM assessment_procedures WHERE assessment_id IN (SELECT id FROM medical_assessments WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM medical_assessments WHERE site_id IN (${s})`);
    await execute(`DELETE FROM queues WHERE site_id IN (${s})`);
    await execute(`DELETE FROM visits WHERE site_id IN (${s})`);
    await execute(`DELETE FROM patients WHERE site_id IN (${s})`);
    await execute(`DELETE FROM stock_movements WHERE site_id IN (${s})`);
    await execute(`DELETE FROM item_batches WHERE site_id IN (${s})`);
    await execute(`DELETE FROM item_stocks WHERE site_id IN (${s})`);
    await execute(`DELETE FROM doctor_schedules WHERE site_id IN (${s})`);
    await execute(`DELETE FROM polis WHERE site_id IN (${s})`);
    await execute(`DELETE FROM sequences WHERE site_id IN (${s})`);
  }
  if (items.length) {
    const l = items.join(",");
    await execute(`DELETE FROM stock_movements WHERE item_id IN (${l})`);
    await execute(`DELETE FROM item_stocks WHERE item_id IN (${l})`);
    await execute(`DELETE FROM items WHERE id IN (${l})`);
  }
  await execute(`DELETE FROM payer_tariffs WHERE payer_id IN (SELECT id FROM payers WHERE kode LIKE '${TANDA}%')`);
  await execute(`DELETE FROM payers WHERE kode LIKE '${TANDA}%'`);
  await execute(`DELETE FROM lab_parameters WHERE panel_id IN (SELECT id FROM lab_panels WHERE kode LIKE '${TANDA}%')`);
  await execute(`DELETE FROM lab_panels WHERE kode LIKE '${TANDA}%'`);
  await execute(`DELETE FROM medical_procedures WHERE kode LIKE '${TANDA}%'`);
  await execute(`DELETE FROM doctor_profiles WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${TANDA}%')`);
  await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
  if (sites.length) await execute(`DELETE FROM sites WHERE id IN (${sites.join(",")})`);
}
await bersih();

babak("PERSIAPAN — cabang, staf, katalog, penjamin");

const site = (await execute(
  `INSERT INTO sites (kode, nama, alamat) VALUES ('${TANDA}', 'Klinik Simulasi', 'Jl. Uji No. 1')`,
)).insertId;

const roleId = async (c: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM roles WHERE code = ?`, [c]))!.id);
const buatUser = async (u: string, n: string, c: string) =>
  (await execute(
    `INSERT INTO users (site_id, role_id, nama, username, password_hash) VALUES (?,?,?,?,'x')`,
    [site, await roleId(c), n, u],
  )).insertId;

const admin = await buatUser(`${TANDA}.adm`, "Rina Admin", "admin_cabang");
const dokter = await buatUser(`${TANDA}.dok`, "dr. Sim Dokter", "dokter");
const perawat = await buatUser(`${TANDA}.per`, "Dewi Perawat", "perawat");
const analis = await buatUser(`${TANDA}.lab`, "Agus Analis", "petugas_lab");
const apoteker = await buatUser(`${TANDA}.apt`, "apt. Maya", "farmasi");
const kasir = await buatUser(`${TANDA}.kas`, "Budi Kasir", "kasir");
await execute(
  `INSERT INTO doctor_profiles (user_id, no_str, no_sip, spesialisasi, gelar_depan, tarif_konsultasi)
   VALUES (?, 'STR-SIM', 'SIP-SIM', 'Dokter Umum', 'dr.', 50000)`,
  [dokter],
);

const poli = (await execute(
  `INSERT INTO polis (site_id, kode, nama, prefix_antrean) VALUES (?, '${TANDA}-U', 'Poli Umum', 'A')`,
  [site],
)).insertId;

const konsul = (await execute(
  `INSERT INTO medical_procedures (kode, nama, tarif, is_konsultasi)
   VALUES ('${TANDA}-K', 'Konsultasi Dokter Umum', 50000, 1)`,
)).insertId;
const tindakanLuka = (await execute(
  `INSERT INTO medical_procedures (kode, nama, tarif) VALUES ('${TANDA}-T', 'Perawatan Luka', 80000)`,
)).insertId;

const obat = (await execute(
  `INSERT INTO items (kode, nama, tipe, satuan_dasar, hpp, harga_jual)
   VALUES ('${TANDA}-OB', 'Amoksisilin 500mg', 'obat', 'tablet', 800, 2000)`,
)).insertId;
const kodein = (await execute(
  `INSERT INTO items (kode, nama, tipe, satuan_dasar, hpp, harga_jual,
                      is_narkotika, golongan_narkotika, no_izin_edar)
   VALUES ('${TANDA}-NK', 'Kodein 10mg', 'obat', 'tablet', 1500, 4000, 1, 'III', 'DKL9988776655A1')`,
)).insertId;
const kapas = (await execute(
  `INSERT INTO items (kode, nama, tipe, satuan_dasar, hpp, harga_jual)
   VALUES ('${TANDA}-BM', 'Kasa Steril', 'bmhp', 'lembar', 500, 1500)`,
)).insertId;

await transaction(async (conn) => {
  for (const [item, qty] of [[obat, 300], [kodein, 100], [kapas, 200]] as const) {
    await tambahStok(conn, {
      siteId: site, itemId: item, qty, jenis: "masuk_pembelian",
      refType: "purchase", userId: apoteker,
    });
  }
});

const panel = (await execute(
  `INSERT INTO lab_panels (kode, nama, kategori, tarif)
   VALUES ('${TANDA}-DL', 'Darah Lengkap', 'Hematologi', 60000)`,
)).insertId;
const paramHb = (await execute(
  `INSERT INTO lab_parameters (panel_id, kode, nama, satuan, tipe_nilai, ref_low, ref_high, urutan)
   VALUES (?, '${TANDA}-HB', 'Hemoglobin', 'g/dL', 'numerik', 13, 17, 1)`,
  [panel],
)).insertId;

const icd = await query<RowDataPacket & { code: string }>(
  `SELECT code FROM icd10_codes WHERE is_active = 1 ORDER BY code LIMIT 2`,
);

const pPerusahaan = await simpanPenjamin(
  penjaminSchema.parse({
    kode: `${TANDA}-PT`, nama: "PT Maju Bersama", jenis: "perusahaan",
    termin_hari: 30, plafon_per_kunjungan: 0,
  }),
);
const pAsuransi = await simpanPenjamin(
  penjaminSchema.parse({
    kode: `${TANDA}-ASR`, nama: "Asuransi Sehat Jaya", jenis: "asuransi",
    termin_hari: 45, plafon_per_kunjungan: 100000,
  }),
);
// Kontrak: perusahaan mendapat konsultasi lebih murah.
await simpanTarifPenjamin(
  tarifPenjaminSchema.parse({
    payer_id: pPerusahaan, procedure_id: konsul, item_id: null, harga: 40000,
  }),
);

console.log(`  Cabang ${site} siap · 6 staf · 3 item · 1 panel lab · 2 penjamin`);
cek("data ICD-10 tersedia", icd.length >= 2, `${icd.length} kode`);

// =====================================================================
// Alat bantu
// =====================================================================
let np = 0;
async function buatPasien(nama: string, payerId: number | null, jk: "L" | "P") {
  np++;
  return (await execute(
    `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin,
                           payer_id, no_anggota, jenis_pasien)
     VALUES (?,?,?,?, '1988-03-15', ?, ?, ?, ?)`,
    [
      site, `${TANDA}-${String(np).padStart(4, "0")}`,
      `327344000009${2000 + np}`, nama, jk, payerId,
      payerId ? `KRT-${9000 + np}` : null,
      payerId === pPerusahaan ? "perusahaan" : payerId ? "asuransi" : "umum",
    ],
  )).insertId;
}

const tagihan = async (visitId: number) =>
  (await queryOne<RowDataPacket & {
    id: number; total: string; tanggung_penjamin: string; tanggung_pasien: string;
    dibayar: string; status: string; payment_method: string | null; no_invoice: string;
  }>(
    `SELECT id, total, tanggung_penjamin, tanggung_pasien, dibayar, status,
            payment_method, no_invoice
       FROM billing_transactions WHERE visit_id = ?`, [visitId],
  ))!;

const statusVisit = async (id: number) =>
  String((await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM visits WHERE id = ?`, [id]))!.status);

const stok = async (itemId: number) =>
  Number((await queryOne<RowDataPacket & { q: string; r: string }>(
    `SELECT qty_on_hand AS q, qty_reserved AS r FROM item_stocks
      WHERE site_id = ? AND item_id = ?`, [site, itemId]))?.q ?? 0);

const reservasi = async (itemId: number) =>
  Number((await queryOne<RowDataPacket & { r: string }>(
    `SELECT qty_reserved AS r FROM item_stocks WHERE site_id = ? AND item_id = ?`,
    [site, itemId]))?.r ?? 0);

// =====================================================================
babak("07.30 — KASIR MEMBUKA SHIFT");
// =====================================================================
const shift = await bukaShift(site, kasir, 500000);
console.log(`  Shift dibuka, kas awal ${formatRupiah(500000)}`);
cek("shift aktif terbentuk", shift > 0);

// =====================================================================
babak("08.00 — PENDAFTARAN EMPAT PASIEN");
// =====================================================================
type Kasus = {
  nama: string;
  visitId: number;
  patientId: number;
  antrean: string;
  payerId: number | null;
};
const kasus: Kasus[] = [];

const rencana: Array<[string, number | null, "L" | "P"]> = [
  ["Andi Umum", null, "L"],
  ["Bunga Karyawan", pPerusahaan, "P"],
  ["Cahyo Berasuransi", pAsuransi, "L"],
  ["Dewi Karyawan", pPerusahaan, "P"],
];

for (const [nama, payerId, jk] of rencana) {
  const patientId = await buatPasien(nama, payerId, jk);
  const hasil = await daftarkanKunjungan(
    visitSchema.parse({
      patient_id: patientId, poli_id: poli, doctor_id: dokter,
      cara_bayar:
        payerId === pPerusahaan ? "perusahaan" : payerId ? "asuransi" : "umum",
      payer_id: payerId,
      no_anggota: payerId ? `KRT-${9000 + np}` : "",
    }),
    site, admin,
  );
  kasus.push({ nama, visitId: hasil.id, patientId, antrean: hasil.antrean, payerId });
  console.log(`  ${hasil.antrean}  ${nama.padEnd(20)} ${hasil.no_visit}`);
}

cek("empat kunjungan terdaftar", kasus.length === 4);
cek("nomor antrean berurutan",
  kasus.map((k) => k.antrean).join(",") === "A001,A002,A003,A004",
  kasus.map((k) => k.antrean).join(","));

const bekuPenjamin = await query<RowDataPacket & { payer_id: number | null; no_anggota: string | null }>(
  `SELECT payer_id, no_anggota FROM visits WHERE site_id = ? ORDER BY id`, [site],
);
cek("penjamin dibekukan di kunjungan, bukan hanya di pasien",
  bekuPenjamin.filter((v) => v.payer_id !== null).length === 3,
  `${bekuPenjamin.filter((v) => v.payer_id !== null).length} kunjungan berpenjamin`);
cek("no. kepesertaan ikut tersalin",
  bekuPenjamin.filter((v) => v.no_anggota !== null).length === 3);

/*
 * Cara bayar non-umum WAJIB menyebut penjaminnya. Tanpa penjaga ini
 * tagihannya lolos dari kandidat klaim mana pun: pekerjaannya dilakukan,
 * uangnya tidak pernah tertagih, dan tidak ada layar yang mengeluh.
 */
cek("cara bayar 'perusahaan' tanpa penjamin ditolak schema",
  !visitSchema.safeParse({
    patient_id: kasus[0].patientId, poli_id: poli, doctor_id: dokter,
    cara_bayar: "perusahaan", payer_id: null,
  }).success);

// =====================================================================
babak("08.20 — PERAWAT: TTV, TRIASE, DAN BMHP");
// =====================================================================
for (const k of kasus) {
  await simpanPengkajian(
    k.visitId, site, perawat,
    nurseAssessmentSchema.parse({
      triase: "hijau",
      keluhan_utama: "Luka pada tungkai kanan sejak 2 hari",
      td_sistolik: 120, td_diastolik: 80,
      nadi: 82, respirasi: 20, suhu: 36.8, spo2: 98,
      berat_badan: 62, tinggi_badan: 168,
      bmhp: [{
        item_id: kapas, nama: "Kasa Steril", satuan: "lembar",
        harga_satuan: 1500, qty: 2,
      }],
    }),
  );
  cek(`${k.antrean} dikaji & diteruskan ke dokter`,
    (await statusVisit(k.visitId)) === "menunggu_dokter",
    await statusVisit(k.visitId));
}

const stokKapas = await stok(kapas);
cek("BMHP perawat langsung memotong stok", stokKapas === 200 - 8,
  `sisa ${stokKapas} lembar`);

const tagihanBmhp = await tagihan(kasus[0].visitId);
cek("BMHP masuk tagihan sejak pengkajian", Number(tagihanBmhp.total) === 3000,
  formatRupiah(Number(tagihanBmhp.total)));

// =====================================================================
babak("09.00 — DOKTER: PERSETUJUAN, SOAP, LAB, RESEP");
// =====================================================================
const asesmen = (finalkan: boolean, dgnTindakan = true) =>
  asesmenSchema.parse({
    finalkan,
    jenis_anamnesis: "auto",
    keluhan_utama: "Luka pada tungkai kanan sejak 2 hari",
    status_lokalis: { regio: {}, titik: [] },
    diagnoses: [{ icd10_code: icd[0].code, nama: "Diagnosa simulasi", tipe: "primer" }],
    procedures: dgnTindakan
      ? [
          { procedure_id: konsul, nama: "Konsultasi Dokter Umum", qty: 1, tarif: 50000, is_konsultasi: true },
          { procedure_id: tindakanLuka, nama: "Perawatan Luka", qty: 1, tarif: 80000 },
        ]
      : [{ procedure_id: konsul, nama: "Konsultasi Dokter Umum", qty: 1, tarif: 50000, is_konsultasi: true }],
  });

const resep = (qtyObat: number, qtyKodein = 0) =>
  resepSchema.parse({
    items: [
      {
        item_id: obat, nama: "Amoksisilin 500mg", qty: qtyObat, satuan: "tablet",
        aturan_pakai: "3 x sehari 1 tablet sesudah makan", harga_satuan: 2000,
      },
      ...(qtyKodein > 0
        ? [{
            item_id: kodein, nama: "Kodein 10mg", qty: qtyKodein, satuan: "tablet",
            aturan_pakai: "2 x sehari 1 tablet bila nyeri", harga_satuan: 4000,
          }]
        : []),
    ],
    racikans: [],
  });

langkah("Pasien 1 (Andi Umum) — persetujuan tindakan lalu perawatan luka");
await simpanConsent(
  consentSchema.parse({
    visit_id: kasus[0].visitId, jenis: "tindakan",
    judul: "Persetujuan Tindakan Kedokteran",
    isi: "Setelah mendapat penjelasan mengenai tujuan, risiko, dan alternatifnya, saya menyetujui dilakukannya perawatan luka.",
    procedure_id: tindakanLuka, penjelasan_oleh: dokter,
    penandatangan: "Andi Umum", hubungan: "Pasien sendiri",
  }),
  site, dokter,
);
cek("persetujuan tindakan tercatat SEBELUM tindakannya",
  (await query(`SELECT id FROM consents WHERE visit_id = ?`, [kasus[0].visitId])).length === 1);

await simpanAsesmen(kasus[0].visitId, site, dokter, asesmen(false));
await simpanResep(kasus[0].visitId, site, dokter, resep(15, 6));
await simpanAsesmen(kasus[0].visitId, site, dokter, asesmen(true));
cek("Andi difinalkan & menuju farmasi",
  (await statusVisit(kasus[0].visitId)) === "menunggu_farmasi",
  await statusVisit(kasus[0].visitId));

langkah("Pasien 2 (Bunga, perusahaan) — order lab DITUNGGU");
const orderBunga = (await buatOrderLab(
  kasus[1].visitId, site, dokter,
  orderLabSchema.parse({
    prioritas: "rutin", sifat_hasil: "ditunggu",
    panels: [{ panel_id: panel, nama: "Darah Lengkap", tarif: 60000 }],
  }),
)).orderId;
cek("Bunga tertahan di lab", (await statusVisit(kasus[1].visitId)) === "menunggu_lab",
  await statusVisit(kasus[1].visitId));

let tolakFinal = "";
try {
  await simpanAsesmen(kasus[1].visitId, site, dokter, asesmen(true));
} catch (e) {
  tolakFinal = e instanceof Error ? e.message : String(e);
}
cek("finalisasi ditolak selama hasil ditunggu", tolakFinal !== "", tolakFinal.slice(0, 70));

langkah("Pasien 3 & 4 — jalur langsung tanpa lab");
for (const i of [2, 3]) {
  await simpanAsesmen(kasus[i].visitId, site, dokter, asesmen(false));
  await simpanResep(kasus[i].visitId, site, dokter, resep(10));
  await simpanAsesmen(kasus[i].visitId, site, dokter, asesmen(true));
  cek(`${kasus[i].antrean} menuju farmasi`,
    (await statusVisit(kasus[i].visitId)) === "menunggu_farmasi");
}

// =====================================================================
babak("09.40 — LAB: HASIL KELUAR, KEMBALI KE DOKTER");
// =====================================================================
await simpanHasilLab(
  orderBunga, site, analis,
  hasilLabSchema.parse({
    finalkan: true,
    hasil: [{ parameter_id: paramHb, panel_id: panel, nilai: "9.2" }],
  }),
);
cek("hasil ditunggu MEMBALIKKAN pasien ke dokter",
  (await statusVisit(kasus[1].visitId)) === "menunggu_dokter",
  await statusVisit(kasus[1].visitId));

const flagHb = await queryOne<RowDataPacket & { flag: string }>(
  `SELECT flag FROM lab_results WHERE order_id = ? AND parameter_id = ?`,
  [orderBunga, paramHb],
);
cek("Hb 9,2 di bawah rujukan → ditandai rendah", flagHb?.flag === "L", String(flagHb?.flag));

const notifDokter = await query<RowDataPacket & { jenis: string }>(
  `SELECT jenis FROM notifications WHERE site_id = ? AND user_id = ? AND jenis LIKE 'hasil_lab%'`,
  [site, dokter],
);
cek("dokter dinotifikasi hasilnya", notifDokter.length >= 1, `${notifDokter.length} notifikasi`);

langkah("Dokter menilai hasil, meresepkan, lalu memfinalkan");
await simpanAsesmen(kasus[1].visitId, site, dokter, asesmen(false));
await simpanResep(kasus[1].visitId, site, dokter, resep(12));
await simpanAsesmen(kasus[1].visitId, site, dokter, asesmen(true));
cek("Bunga akhirnya menuju farmasi",
  (await statusVisit(kasus[1].visitId)) === "menunggu_farmasi");

// =====================================================================
babak("10.15 — FARMASI TAHAP 1: VALIDASI & KUNCI STOK");
// =====================================================================
const resepIds: number[] = [];
for (const k of kasus) {
  const rx = await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM prescriptions WHERE visit_id = ? AND status <> 'batal'`, [k.visitId],
  );
  resepIds.push(Number(rx!.id));
}

const stokObatSebelum = await stok(obat);
for (let i = 0; i < kasus.length; i++) {
  await terimaResep(resepIds[i], site, apoteker);
  await validasiResep(resepIds[i], site, apoteker);
  cek(`${kasus[i].antrean} divalidasi → menunggu kasir`,
    (await statusVisit(kasus[i].visitId)) === "menunggu_kasir",
    await statusVisit(kasus[i].visitId));
}

cek("stok gudang BELUM dipotong pada tahap validasi",
  (await stok(obat)) === stokObatSebelum, `${await stok(obat)} tablet`);
cek("melainkan dikunci sebagai reservasi",
  (await reservasi(obat)) === 15 + 12 + 10 + 10,
  `${await reservasi(obat)} tablet terkunci`);

// =====================================================================
babak("10.40 — KASIR: PEMBAGIAN TANGGUNGAN");
// =====================================================================
const ringkasBayar: Array<{ nama: string; total: number; penjamin: number; pasien: number; metode: string }> = [];

for (const k of kasus) {
  const t = await tagihan(k.visitId);
  const bagianPasien = Number(t.tanggung_pasien);

  await prosesPembayaran(
    Number(t.id), site, kasir, shift,
    pembayaranSchema.parse({
      payment_method: "tunai",
      dibayar: bagianPasien,
      diskon: 0,
    }),
    0,
  );

  const t2 = await tagihan(k.visitId);
  ringkasBayar.push({
    nama: k.nama,
    total: Number(t2.total),
    penjamin: Number(t2.tanggung_penjamin),
    pasien: Number(t2.tanggung_pasien),
    metode: String(t2.payment_method),
  });

  console.log(
    `  ${k.antrean}  ${k.nama.padEnd(20)} total ${formatRupiah(Number(t2.total)).padStart(12)}` +
    ` · penjamin ${formatRupiah(Number(t2.tanggung_penjamin)).padStart(12)}` +
    ` · pasien ${formatRupiah(Number(t2.tanggung_pasien)).padStart(12)} (${t2.payment_method})`,
  );
  cek(`${k.antrean} lunas`, t2.status === "lunas");
}

const andi = ringkasBayar[0];
const bunga = ringkasBayar[1];
const cahyo = ringkasBayar[2];

cek("Andi (umum) menanggung seluruhnya",
  andi.penjamin === 0 && andi.pasien === andi.total);
cek("Andi dibayar tunai", andi.metode === "tunai");

cek("Bunga (perusahaan tanpa plafon) tidak membayar apa pun",
  bunga.pasien === 0 && bunga.penjamin === bunga.total);
cek("dan metodenya 'penjamin', bukan tunai Rp 0", bunga.metode === "penjamin",
  bunga.metode);

/*
 * Cahyo berplafon Rp 100.000 sementara tagihannya lebih besar (konsultasi
 * 50.000 + tindakan 80.000 + BMHP 3.000 + obat 20.000 = 153.000), jadi
 * selisihnya harus jatuh ke pasien.
 */
cek("Cahyo (berplafon) — penjamin menanggung tepat sebesar plafon",
  cahyo.penjamin === 100000, formatRupiah(cahyo.penjamin));
cek("dan selisihnya ditagihkan ke pasien",
  cahyo.pasien === cahyo.total - 100000, formatRupiah(cahyo.pasien));
cek("Cahyo dibayar tunai karena masih ada bagian pasien",
  cahyo.metode === "tunai", cahyo.metode);

/*
 * Tarif kontrak: konsultasi PT Maju Bersama disepakati 40.000, bukan
 * 50.000. Formulir dokter tetap mengirim tarif global, dan server
 * MENGHITUNGNYA ULANG lewat `tarifTindakanBerlaku()` — harga tidak pernah
 * boleh berasal dari kiriman klien, dan berkas klaim tidak boleh berisi
 * angka di atas harga yang disepakati.
 *
 * Simulasi inilah yang menemukan bahwa jalur ini semula tidak ada:
 * `payer_tariffs` tersimpan rapi tetapi tidak pernah dibaca siapa pun.
 */
const barisKonsulBunga = await queryOne<RowDataPacket & { harga_satuan: string }>(
  `SELECT bi.harga_satuan FROM billing_items bi
     JOIN billing_transactions bt ON bt.id = bi.billing_id
    WHERE bt.visit_id = ? AND bi.ref_type = 'assessment_procedure'
      AND bi.deskripsi LIKE 'Konsultasi%'`,
  [kasus[1].visitId],
);
const hargaKonsul = Number(barisKonsulBunga?.harga_satuan ?? 0);
cek(
  "tarif KONTRAK penjamin dipakai, bukan tarif global",
  hargaKonsul === 40000,
  `tertagih ${formatRupiah(hargaKonsul)}, kontrak ${formatRupiah(40000)}`,
);

// =====================================================================
babak("11.00 — FARMASI TAHAP 2: PENYERAHAN OBAT");
// =====================================================================
for (let i = 0; i < kasus.length; i++) {
  await serahkanResep(resepIds[i], site, apoteker);
  cek(`${kasus[i].antrean} kunjungan ditutup di farmasi`,
    (await statusVisit(kasus[i].visitId)) === "selesai",
    await statusVisit(kasus[i].visitId));
}

cek("stok gudang baru dipotong pada penyerahan",
  (await stok(obat)) === stokObatSebelum - (15 + 12 + 10 + 10),
  `${await stok(obat)} tablet`);
cek("seluruh reservasi dilepas", (await reservasi(obat)) === 0,
  `${await reservasi(obat)} terkunci`);
cek("narkotika ikut terpotong", (await stok(kodein)) === 100 - 6,
  `${await stok(kodein)} tablet`);

// =====================================================================
babak("11.30 — INSIDEN KESELAMATAN PASIEN");
// =====================================================================
const ikp = await laporkanIkp(
  ikpSchema.parse({
    visit_id: kasus[0].visitId, tanggal: hariIni, waktu: "11:05",
    lokasi: "Apotek", jenis: "knc",
    kronologi:
      "Kodein untuk pasien A001 hampir diserahkan kepada pasien A004 karena keduanya " +
      "dipanggil bersamaan. Ketidaksesuaian diketahui saat petugas mencocokkan tanggal lahir.",
    tindakan_segera: "Penyerahan dihentikan dan identitas dicocokkan ulang.",
  }),
  site, apoteker,
);
console.log(`  Insiden ${ikp.noIkp} dilaporkan apt. Maya (KNC, Apotek)`);

await tindakLanjutIkp(
  ikp.id, site,
  tindakLanjutIkpSchema.parse({
    grading: "kuning", status: "ditutup",
    analisis: "Dua pasien dipanggil bersamaan karena antrean penyerahan tidak diberi nomor.",
    rekomendasi: "Panggil satu pasien per waktu dan cocokkan tanggal lahir sebelum menyerahkan.",
  }),
  admin,
);
cek("insiden risiko tinggi bisa ditutup setelah RCA diisi",
  (await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM patient_safety_incidents WHERE id = ?`, [ikp.id]))!.status === "ditutup");

// =====================================================================
babak("15.00 — KASIR MENUTUP SHIFT");
// =====================================================================
const kasSeharusnya = andi.pasien + bunga.pasien + cahyo.pasien + ringkasBayar[3].pasien;
const tutup = await tutupShift(shift, site, kasir, 500000 + kasSeharusnya);
console.log(
  `  Kas awal ${formatRupiah(500000)} + tunai ${formatRupiah(kasSeharusnya)}` +
  ` = ${formatRupiah(500000 + kasSeharusnya)}`,
);
cek("kas kasir HANYA berisi uang dari pasien, bukan tanggungan penjamin",
  tutup.selisih === 0,
  `selisih ${formatRupiah(tutup.selisih)}`,
);

// =====================================================================
babak("BESOK PAGI — KLAIM KE PENJAMIN");
// =====================================================================
const klaimPT = await buatKlaim(
  klaimBaruSchema.parse({
    payer_id: pPerusahaan, periode_dari: hariIni, periode_sampai: hariIni,
  }),
  site, admin,
);
console.log(`  ${klaimPT.noKlaim} — ${klaimPT.jumlahBaris} tagihan, ${formatRupiah(klaimPT.total)}`);
cek("klaim PT memuat dua kunjungan karyawan", klaimPT.jumlahBaris === 2,
  `${klaimPT.jumlahBaris} baris`);
cek("nilainya = jumlah tanggungan penjamin",
  klaimPT.total === bunga.penjamin + ringkasBayar[3].penjamin,
  formatRupiah(klaimPT.total));

const klaimAsr = await buatKlaim(
  klaimBaruSchema.parse({
    payer_id: pAsuransi, periode_dari: hariIni, periode_sampai: hariIni,
  }),
  site, admin,
);
console.log(`  ${klaimAsr.noKlaim} — ${klaimAsr.jumlahBaris} tagihan, ${formatRupiah(klaimAsr.total)}`);
cek("klaim asuransi hanya sebesar plafon, bukan total tagihan",
  klaimAsr.total === 100000, formatRupiah(klaimAsr.total));

cek("pasien umum tidak pernah masuk klaim mana pun",
  !(await barisKlaim(klaimPT.id)).some((b) => Number(b.visit_id) === kasus[0].visitId) &&
  !(await barisKlaim(klaimAsr.id)).some((b) => Number(b.visit_id) === kasus[0].visitId));

await ajukanKlaim(klaimPT.id, site, admin);
await ajukanKlaim(klaimAsr.id, site, admin);
const piutangAwal = await ringkasanKlaim(site);
console.log(`  Piutang setelah diajukan: ${formatRupiah(piutangAwal.piutang)}`);
cek("piutang = jumlah kedua klaim",
  piutangAwal.piutang === klaimPT.total + klaimAsr.total,
  formatRupiah(piutangAwal.piutang));

langkah("Penjamin memverifikasi & memotong satu baris");
const barisPT = await barisKlaim(klaimPT.id);
const verif = await verifikasiKlaim(klaimPT.id, site, {
  baris: barisPT.map((b, i) => ({
    claim_item_id: Number(b.id),
    nilai_disetujui: i === 0 ? Number(b.nilai_diajukan) - 20000 : Number(b.nilai_diajukan),
    alasan_koreksi: i === 0 ? "Tindakan tidak tercakup polis" : undefined,
  })),
});
console.log(`  Disetujui ${formatRupiah(verif.totalDisetujui)} (${verif.dikoreksi} baris dipotong)`);
cek("potongan tercatat", verif.dikoreksi === 1);
cek("piutang menyusut mengikuti nilai disetujui",
  (await ringkasanKlaim(site)).piutang === verif.totalDisetujui + klaimAsr.total,
  formatRupiah((await ringkasanKlaim(site)).piutang));

langkah("Pembayaran masuk sebagian");
await catatPembayaranKlaim(
  klaimPT.id, site,
  bayarKlaimSchema.parse({
    tanggal: hariIni, jumlah: Math.floor(verif.totalDisetujui / 2),
    metode: "transfer", ref: "TRF-SIM-1",
  }),
  admin,
);
const umur = await umurPiutang(site);
console.log("  Umur piutang per penjamin:");
for (const u of umur) {
  console.log(
    `    ${u.penjamin.padEnd(24)} belum j.tempo ${formatRupiah(u.belumJatuhTempo).padStart(12)}` +
    ` · total ${formatRupiah(u.total).padStart(12)}`,
  );
}
cek("kedua penjamin punya piutang", umur.length === 2, `${umur.length} penjamin`);
cek("semuanya belum jatuh tempo (baru diajukan hari ini)",
  umur.every((u) => u.total === u.belumJatuhTempo));

// =====================================================================
babak("AKHIR BULAN — LAPORAN WAJIB");
// =====================================================================
langkah("LB1 — morbiditas ke Dinas Kesehatan");
const lb1 = await lb1Morbiditas(site, hariIni, hariIni);
const siapLb1 = await kesiapanLb1(site, hariIni, hariIni);
console.log(
  `  ${lb1.length} kode ICD-10 · ${siapLb1.totalKasus} kasus dari ${siapLb1.kunjungan} kunjungan`,
);
cek("seluruh kunjungan terekam di LB1",
  siapLb1.tanpaAsesmenFinal === 0 && siapLb1.tanpaDiagnosaDitegakkan === 0,
  `${siapLb1.tanpaAsesmenFinal} tanpa final, ${siapLb1.tanpaDiagnosaDitegakkan} tanpa diagnosa`);
cek("jumlah kasus = jumlah kunjungan", siapLb1.totalKasus === 4,
  String(siapLb1.totalKasus));
cek("pecahan L/P konsisten dengan totalnya",
  lb1.every((b) =>
    Number(b.baru_l) + Number(b.baru_p) + Number(b.lama_l) + Number(b.lama_p) ===
      Number(b.total)));

langkah("SIPNAP — narkotika & psikotropika");
const sipnap = await rekapSipnap(site, hariIni, hariIni);
const siapSipnap = await kesiapanSipnap(site, hariIni, hariIni);
for (const b of sipnap) {
  console.log(
    `  ${b.nama.padEnd(20)} gol ${String(b.golongan_narkotika ?? "-").padEnd(4)}` +
    ` awal ${String(Number(b.saldo_awal)).padStart(6)}` +
    ` masuk ${String(Number(b.masuk)).padStart(5)}` +
    ` keluar ${String(Number(b.keluar)).padStart(5)}` +
    ` akhir ${String(Number(b.saldo_akhir)).padStart(6)}`,
  );
}
cek("kodein terlaporkan", sipnap.some((b) => Number(b.item_id) === kodein));
cek("obat biasa & BMHP tidak ikut", sipnap.length === 1, `${sipnap.length} item`);
cek("saldo laporan cocok dengan saldo gudang", siapSipnap.selisih === 0,
  `${siapSipnap.selisih} selisih`);
cek("golongan & NIE lengkap",
  siapSipnap.tanpaGolongan === 0 && siapSipnap.tanpaIzinEdar === 0);

langkah("Laporan cabang");
const lap = await ringkasanCabang(site, hariIni, hariIni);
console.log(
  `  ${lap.kunjungan} kunjungan · pendapatan ${formatRupiah(lap.pendapatan)}` +
  ` · menunggu kasir ${formatRupiah(lap.nilaiMenungguKasir)}` +
  ` · dalam pelayanan ${formatRupiah(lap.nilaiDalamPelayanan)}`,
);
cek("tidak ada tagihan tersisa di kasir", lap.menungguKasir === 0);
cek("tidak ada pasien yang masih dilayani", lap.dalamPelayanan === 0);

/*
 * Pendapatan dihitung dari tagihan LUNAS — termasuk yang ditanggung
 * penjamin, yang uangnya BELUM masuk. Ini akuntansi akrual dan sah, tetapi
 * harus disadari: pendapatan hari ini tidak sama dengan kas hari ini.
 */
const totalSemua = ringkasBayar.reduce((n, r) => n + r.total, 0);
cek("pendapatan mencakup tagihan yang ditanggung penjamin",
  lap.pendapatan === totalSemua, formatRupiah(lap.pendapatan));
console.log(
  `  Dari ${formatRupiah(lap.pendapatan)} pendapatan, ${formatRupiah(kasSeharusnya)} masuk kas` +
  ` dan ${formatRupiah(lap.pendapatan - kasSeharusnya)} masih piutang penjamin.`,
);
cek("selisih pendapatan vs kas = tanggungan penjamin hari ini",
  lap.pendapatan - kasSeharusnya ===
    ringkasBayar.reduce((n, r) => n + r.penjamin, 0));

// =====================================================================
babak("HASIL SIMULASI");
// =====================================================================
console.log(`  4 pasien dilayani tuntas dari pendaftaran sampai penyerahan obat.`);
console.log(`  2 berkas klaim diajukan, 1 diverifikasi & dibayar sebagian.`);
console.log(`  1 insiden dilaporkan, digrading, dianalisis, ditutup.`);
console.log(`  3 laporan wajib tersusun dari data yang sama.`);

await bersih();

if (janggal === 0) {
  console.log("\n  Tidak ada kejanggalan.\n");
} else {
  console.log(`\n  ${janggal} KEJANGGALAN DITEMUKAN — lihat baris bertanda !!\n`);
}
await pool.end();
process.exit(janggal === 0 ? 0 : 1);
