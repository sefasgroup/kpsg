/**
 * Uji KONKURENSI — empat siklus deadlock yang sudah terbukti, dijalankan
 * lewat FUNGSI APLIKASI ASLI.
 *
 *   node uji/jalankan.mjs uji/uji-konkurensi.ts
 *
 * MENGAPA UJI INI ADA
 *
 * Deadlock tidak muncul dari satu transaksi yang salah, melainkan dari dua
 * transaksi yang masing-masing benar tetapi mengambil kunci yang sama dalam
 * urutan berbeda. Karena itu ia tidak akan pernah ditemukan oleh uji yang
 * menjalankan satu fungsi pada satu waktu — dan tidak akan pernah ditemukan
 * pula oleh simulasi berurutan, sebagus apa pun.
 *
 * TUJUH siklus di bawah PERNAH melempar `ER_LOCK_DEADLOCK` (errno 1213),
 * dan semuanya dibuktikan di sini — bukan disimpulkan dari membaca kode.
 *
 * Urutan kunci yang tidak seragam (ditutup `lib/kunci.ts`):
 *
 *   1. `visits` ↔ `billing_transactions`  — asesmen dokter vs pembayaran kasir
 *   2. `visits` ↔ `prescriptions`         — revisi resep vs penyerahan obat
 *   3. `visits` ↔ `lab_orders`            — order lab vs input hasil
 *   4. `item_stocks` ↔ `item_stocks`      — dua resep, urutan item terbalik
 *
 * Gap lock atas baris yang belum ada, lalu INSERT dari transaksi lain ke
 * gap yang sama (ditutup dengan mengganti penguncian jadi pembacaan biasa):
 *
 *   5. `attendances`         — dua staf absen masuk bersamaan
 *   6. `prescriptions`       — dua dokter meresepkan untuk pasien berbeda
 *   7. `cashier_shifts`      — dua kasir membuka shift
 *
 * Tiga yang terakhir tidak terduga sama sekali dan JAUH lebih sering: pada
 * ketiganya kedua pihak tidak berbagi satu pun data. Ketiganya ditemukan
 * hanya karena uji ini menjalankan fungsi aplikasi yang sebenarnya —
 * percobaan sintetis sebelumnya memeriksa pasangan yang sudah diduga, dan
 * karena itu tidak akan pernah menemukan yang tidak diduga.
 *
 * Yang diuji di sini bukan "operasinya berhasil" — sebagian memang WAJIB
 * gagal karena aturan bisnis (mis. membayar kunjungan yang belum di kasir).
 * Yang diuji adalah **tidak ada satu pun yang gagal dengan errno 1213**.
 * Kegagalan aturan bisnis adalah jawaban; deadlock adalah kerusakan.
 *
 * Setiap pasangan dijalankan berulang kali karena penjadwalan tidak bisa
 * dipaksa: satu putaran yang lolos tidak membuktikan apa pun.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne, transaction } from "../src/lib/db";
import { tambahStok } from "../src/lib/stock";
import { simpanAsesmen } from "../src/lib/doctor";
import { catatAbsensi } from "../src/lib/hr";
import { simpanResep } from "../src/lib/prescription";
import { serahkanResep, terimaResep, validasiResep } from "../src/lib/pharmacy";
import { bukaShift, prosesPembayaran } from "../src/lib/cashier";
import { buatOrderLab, simpanHasilLab } from "../src/lib/lab";
import { asesmenSchema, resepSchema } from "../src/lib/validations/doctor";
import { pembayaranSchema } from "../src/lib/validations/cashier";
import { hasilLabSchema, orderLabSchema } from "../src/lib/validations/lab";
import { tanggalHariIni } from "../src/lib/tanggal";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

const TANDA = "UJIKNK";
const hariIni = tanggalHariIni();
const PUTARAN = 12;

/** Menjalankan dua operasi bersamaan dan melaporkan HANYA deadlock-nya. */
async function bersamaan(a: () => Promise<unknown>, b: () => Promise<unknown>) {
  const hasil = await Promise.allSettled([a(), b()]);
  const dl: string[] = [];
  const bisnis: string[] = [];
  for (const h of hasil) {
    if (h.status !== "rejected") continue;
    const e = h.reason as Error & { errno?: number };
    if (e?.errno === 1213) dl.push("DEADLOCK");
    else if (e?.errno === 1205) dl.push("LOCK WAIT TIMEOUT");
    else bisnis.push(e?.message ?? String(e));
  }
  return { deadlock: dl, bisnis };
}

async function bersih() {
  const sites = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM sites WHERE kode LIKE '${TANDA}%'`)
  ).map((r) => r.id);
  const items = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM items WHERE kode LIKE '${TANDA}%'`)
  ).map((r) => r.id);
  if (sites.length) {
    const s = sites.join(",");
    for (const q of [
      `DELETE FROM billing_items WHERE billing_id IN (SELECT id FROM billing_transactions WHERE site_id IN (${s}))`,
      `DELETE FROM billing_transactions WHERE site_id IN (${s})`,
      `DELETE FROM prescription_racikan_ingredients WHERE racikan_id IN (SELECT id FROM prescription_racikans WHERE prescription_id IN (SELECT id FROM prescriptions WHERE site_id IN (${s})))`,
      `DELETE FROM prescription_racikans WHERE prescription_id IN (SELECT id FROM prescriptions WHERE site_id IN (${s}))`,
      `DELETE FROM prescription_items WHERE prescription_id IN (SELECT id FROM prescriptions WHERE site_id IN (${s}))`,
      `DELETE FROM prescriptions WHERE site_id IN (${s})`,
      `DELETE FROM lab_results WHERE order_id IN (SELECT id FROM lab_orders WHERE site_id IN (${s}))`,
      `DELETE FROM lab_order_panels WHERE order_id IN (SELECT id FROM lab_orders WHERE site_id IN (${s}))`,
      `DELETE FROM lab_orders WHERE site_id IN (${s})`,
      `DELETE FROM assessment_diagnoses WHERE assessment_id IN (SELECT id FROM medical_assessments WHERE site_id IN (${s}))`,
      `DELETE FROM assessment_procedures WHERE assessment_id IN (SELECT id FROM medical_assessments WHERE site_id IN (${s}))`,
      `DELETE FROM medical_assessments WHERE site_id IN (${s})`,
      `DELETE FROM notifications WHERE site_id IN (${s})`,
      `DELETE FROM queues WHERE site_id IN (${s})`,
      `DELETE FROM visits WHERE site_id IN (${s})`,
      `DELETE FROM patients WHERE site_id IN (${s})`,
      `DELETE FROM stock_movements WHERE site_id IN (${s})`,
      `DELETE FROM item_batches WHERE site_id IN (${s})`,
      `DELETE FROM item_stocks WHERE site_id IN (${s})`,
      `DELETE FROM polis WHERE site_id IN (${s})`,
      `DELETE FROM attendances WHERE site_id IN (${s})`,
      `DELETE FROM cashier_shifts WHERE site_id IN (${s})`,
      `DELETE FROM sequences WHERE site_id IN (${s})`,
    ]) await execute(q);
  }
  if (items.length) {
    const l = items.join(",");
    await execute(`DELETE FROM stock_movements WHERE item_id IN (${l})`);
    await execute(`DELETE FROM item_stocks WHERE item_id IN (${l})`);
    await execute(`DELETE FROM items WHERE id IN (${l})`);
  }
  await execute(`DELETE FROM lab_parameters WHERE panel_id IN (SELECT id FROM lab_panels WHERE kode LIKE '${TANDA}%')`);
  await execute(`DELETE FROM lab_panels WHERE kode LIKE '${TANDA}%'`);
  await execute(`DELETE FROM medical_procedures WHERE kode LIKE '${TANDA}%'`);
  await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
  if (sites.length) await execute(`DELETE FROM sites WHERE id IN (${sites.join(",")})`);
}
await bersih();

const site = (await execute(
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}', 'Uji Konkurensi')`,
)).insertId;
const roleId = async (c: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM roles WHERE code = ?`, [c]))!.id);
const buatUser = async (u: string, n: string, c: string) =>
  (await execute(
    `INSERT INTO users (site_id, role_id, nama, username, password_hash) VALUES (?,?,?,?,'x')`,
    [site, await roleId(c), n, u],
  )).insertId;

const dokter = await buatUser(`${TANDA}.dok`, "dr. Konkuren", "dokter");
const apoteker = await buatUser(`${TANDA}.apt`, "apt. Konkuren", "farmasi");
const kasir = await buatUser(`${TANDA}.kas`, "Kasir Konkuren", "kasir");
const analis = await buatUser(`${TANDA}.lab`, "Analis Konkuren", "petugas_lab");

const poli = (await execute(
  `INSERT INTO polis (site_id, kode, nama) VALUES (?, '${TANDA}-P', 'Poli Konkuren')`, [site],
)).insertId;
const konsul = (await execute(
  `INSERT INTO medical_procedures (kode, nama, tarif, is_konsultasi)
   VALUES ('${TANDA}-K', 'Konsultasi', 50000, 1)`,
)).insertId;

/*
 * Dua obat saja sudah cukup untuk siklus keempat, dan justru itu yang
 * membuatnya sering terjadi di klinik: katalog yang dipakai sebagian besar
 * resep memang sempit.
 */
const obatA = (await execute(
  `INSERT INTO items (kode, nama, tipe, satuan_dasar, hpp, harga_jual)
   VALUES ('${TANDA}-A', 'Obat A', 'obat', 'tablet', 100, 500)`,
)).insertId;
const obatB = (await execute(
  `INSERT INTO items (kode, nama, tipe, satuan_dasar, hpp, harga_jual)
   VALUES ('${TANDA}-B', 'Obat B', 'obat', 'tablet', 100, 500)`,
)).insertId;
await transaction(async (conn) => {
  for (const it of [obatA, obatB]) {
    await tambahStok(conn, {
      siteId: site, itemId: it, qty: 100000, jenis: "masuk_pembelian",
      refType: "purchase", userId: apoteker,
    });
  }
});

const panel = (await execute(
  `INSERT INTO lab_panels (kode, nama, kategori, tarif)
   VALUES ('${TANDA}-P1', 'Panel Konkuren', 'Uji', 30000)`,
)).insertId;
const param = (await execute(
  `INSERT INTO lab_parameters (panel_id, kode, nama, tipe_nilai, urutan)
   VALUES (?, '${TANDA}-PR', 'Parameter', 'numerik', 1)`, [panel],
)).insertId;

const icd = await query<RowDataPacket & { code: string }>(
  `SELECT code FROM icd10_codes WHERE is_active = 1 LIMIT 1`,
);

let np = 0;
async function buatKunjungan(status: string) {
  np++;
  const pasien = (await execute(
    `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin)
     VALUES (?,?,?,?, '1990-01-01', 'L')`,
    [site, `${TANDA}-RM${np}`, `327322000009${2000 + np}`, `Pasien Konkuren ${np}`],
  )).insertId;
  const visitId = (await execute(
    `INSERT INTO visits (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
                         jenis_kunjungan, status, registered_by)
     VALUES (?,?,?,?,?,?, 'baru', ?, ?)`,
    [site, pasien, `${TANDA}/V/${np}`, hariIni, poli, dokter, status, dokter],
  )).insertId;
  await execute(
    `INSERT INTO queues (site_id, visit_id, poli_id, tanggal, prefix, nomor, status)
     VALUES (?,?,?,?, 'K', ?, 'dilayani')`,
    [site, visitId, poli, hariIni, np],
  );
  return visitId;
}

const asesmen = (finalkan: boolean) =>
  asesmenSchema.parse({
    finalkan,
    jenis_anamnesis: "auto",
    keluhan_utama: "Uji konkurensi",
    status_lokalis: { regio: {}, titik: [] },
    diagnoses: [{ icd10_code: icd[0].code, nama: "Diagnosa uji", tipe: "primer" }],
    procedures: [{
      procedure_id: konsul, nama: "Konsultasi", qty: 1, tarif: 50000,
      is_konsultasi: true,
    }],
  });

/** Resep dengan urutan item yang bisa dibalik — inti siklus keempat. */
const resepUrut = (urutan: number[]) =>
  resepSchema.parse({
    items: urutan.map((id) => ({
      item_id: id, nama: id === obatA ? "Obat A" : "Obat B", qty: 2,
      satuan: "tablet", aturan_pakai: "2 x sehari 1 tablet", harga_satuan: 500,
    })),
    racikans: [],
  });

const totalDeadlock: string[] = [];
const catat = (nama: string, dl: string[]) => {
  if (dl.length) totalDeadlock.push(`${nama}: ${dl.join(", ")}`);
};

// =====================================================================
console.log(`\n== 1. item_stocks ↔ item_stocks (${PUTARAN} putaran) ==`);
// =====================================================================
/*
 * Dua resep divalidasi bersamaan, masing-masing memuat obat A dan B dengan
 * URUTAN TERBALIK. Inilah siklus yang paling sering terjadi di klinik sibuk
 * dan yang paling mudah luput dari perhatian: tidak ada yang salah pada
 * kedua resepnya.
 */
let dl1 = 0;
for (let putaran = 0; putaran < PUTARAN; putaran++) {
  const v1 = await buatKunjungan("dalam_pemeriksaan");
  const v2 = await buatKunjungan("dalam_pemeriksaan");
  const rx1 = await simpanResep(v1, site, dokter, resepUrut([obatA, obatB]));
  const rx2 = await simpanResep(v2, site, dokter, resepUrut([obatB, obatA]));
  await execute(`UPDATE visits SET status = 'menunggu_farmasi' WHERE id IN (?,?)`, [v1, v2]);
  await terimaResep(rx1.prescriptionId, site, apoteker);
  await terimaResep(rx2.prescriptionId, site, apoteker);

  const r = await bersamaan(
    () => validasiResep(rx1.prescriptionId, site, apoteker),
    () => validasiResep(rx2.prescriptionId, site, apoteker),
  );
  if (r.deadlock.length) dl1++;
  catat(`validasi paralel putaran ${putaran + 1}`, r.deadlock);
}
ok(`${PUTARAN}× validasi resep [A,B] vs [B,A] tanpa deadlock`, dl1 === 0,
  dl1 > 0 ? `${dl1} putaran deadlock` : "");

// =====================================================================
console.log(`\n== 2. visits ↔ billing_transactions (${PUTARAN} putaran) ==`);
// =====================================================================
let dl2 = 0;
for (let putaran = 0; putaran < PUTARAN; putaran++) {
  const v = await buatKunjungan("dalam_pemeriksaan");
  await simpanAsesmen(v, site, dokter, asesmen(true));
  const bt = (await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM billing_transactions WHERE visit_id = ?`, [v]))!;
  await execute(`UPDATE visits SET status = 'menunggu_kasir' WHERE id = ?`, [v]);
  await execute(`UPDATE billing_transactions SET status = 'menunggu' WHERE id = ?`, [bt.id]);

  const r = await bersamaan(
    () => prosesPembayaran(
      Number(bt.id), site, kasir, null,
      pembayaranSchema.parse({ payment_method: "tunai", dibayar: 999999, diskon: 0 }), 0,
    ),
    () => simpanAsesmen(v, site, dokter, asesmen(false)),
  );
  if (r.deadlock.length) dl2++;
  catat(`bayar vs asesmen putaran ${putaran + 1}`, r.deadlock);
}
ok(`${PUTARAN}× pembayaran kasir vs simpan asesmen tanpa deadlock`, dl2 === 0,
  dl2 > 0 ? `${dl2} putaran deadlock` : "");

// =====================================================================
console.log(`\n== 3. visits ↔ prescriptions (${PUTARAN} putaran) ==`);
// =====================================================================
let dl3 = 0;
for (let putaran = 0; putaran < PUTARAN; putaran++) {
  const v = await buatKunjungan("dalam_pemeriksaan");
  const rx = await simpanResep(v, site, dokter, resepUrut([obatA]));
  await execute(`UPDATE visits SET status = 'menunggu_farmasi' WHERE id = ?`, [v]);
  await terimaResep(rx.prescriptionId, site, apoteker);
  await validasiResep(rx.prescriptionId, site, apoteker);
  const bt = (await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM billing_transactions WHERE visit_id = ?`, [v]))!;
  await prosesPembayaran(
    Number(bt.id), site, kasir, null,
    pembayaranSchema.parse({ payment_method: "tunai", dibayar: 999999, diskon: 0 }), 0,
  );

  const r = await bersamaan(
    () => serahkanResep(rx.prescriptionId, site, apoteker),
    () => simpanResep(v, site, dokter, resepUrut([obatB])),
  );
  if (r.deadlock.length) dl3++;
  catat(`serahkan vs revisi resep putaran ${putaran + 1}`, r.deadlock);
}
ok(`${PUTARAN}× penyerahan obat vs revisi resep tanpa deadlock`, dl3 === 0,
  dl3 > 0 ? `${dl3} putaran deadlock` : "");

// =====================================================================
console.log(`\n== 4. visits ↔ lab_orders (${PUTARAN} putaran) ==`);
// =====================================================================
let dl4 = 0;
for (let putaran = 0; putaran < PUTARAN; putaran++) {
  const v = await buatKunjungan("dalam_pemeriksaan");
  const o1 = (await buatOrderLab(
    v, site, dokter,
    orderLabSchema.parse({
      prioritas: "rutin", sifat_hasil: "ditunggu",
      panels: [{ panel_id: panel, nama: "Panel Konkuren", tarif: 30000 }],
    }),
  )).orderId;

  const r = await bersamaan(
    () => simpanHasilLab(
      o1, site, analis,
      hasilLabSchema.parse({
        finalkan: true, hasil: [{ parameter_id: param, panel_id: panel, nilai: "5" }],
      }),
    ),
    () => buatOrderLab(
      v, site, dokter,
      orderLabSchema.parse({
        prioritas: "rutin", sifat_hasil: "menyusul",
        panels: [{ panel_id: panel, nama: "Panel Konkuren", tarif: 30000 }],
      }),
    ),
  );
  if (r.deadlock.length) dl4++;
  catat(`input hasil vs order baru putaran ${putaran + 1}`, r.deadlock);
}
ok(`${PUTARAN}× input hasil lab vs order lab baru tanpa deadlock`, dl4 === 0,
  dl4 > 0 ? `${dl4} putaran deadlock` : "");

// =====================================================================
console.log(`\n== 5. Gap lock: absensi pagi (${PUTARAN} putaran) ==`);
// =====================================================================
/*
 * `catatAbsensi()` memakai pola yang sama dengan `pastikanTagihan()` dulu:
 * penguncian atas baris yang belum ada, lalu INSERT. Inilah kejadian paling
 * biasa yang bisa dibayangkan — seluruh staf absen masuk dalam rentang
 * beberapa menit setiap pagi.
 */
let dl5 = 0;
for (let putaran = 0; putaran < PUTARAN; putaran++) {
  const u1 = await buatUser(`${TANDA}.abs${putaran}a`, `Staf ${putaran}A`, "perawat");
  const u2 = await buatUser(`${TANDA}.abs${putaran}b`, `Staf ${putaran}B`, "perawat");
  const r = await bersamaan(
    () => catatAbsensi(site, u1, hariIni, "masuk"),
    () => catatAbsensi(site, u2, hariIni, "masuk"),
  );
  if (r.deadlock.length) dl5++;
  catat(`absensi paralel putaran ${putaran + 1}`, r.deadlock);
}
ok(`${PUTARAN}× dua staf absen masuk bersamaan tanpa deadlock`, dl5 === 0,
  dl5 > 0 ? `${dl5} putaran deadlock` : "");

// =====================================================================
console.log(`\n== 6. Gap lock: dua resep kunjungan berbeda (${PUTARAN} putaran) ==`);
// =====================================================================
/*
 * `simpanResep()` mengunci dengan predikat tidak unik dan barisnya sering
 * belum ada, lalu ia menyisipkan resep baru. Dua dokter yang meresepkan
 * bersamaan untuk pasien berbeda karena itu bisa saling menunggu, meski
 * tidak ada satu pun data yang mereka bagi.
 */
let dl6 = 0;
for (let putaran = 0; putaran < PUTARAN; putaran++) {
  const va = await buatKunjungan("dalam_pemeriksaan");
  const vb = await buatKunjungan("dalam_pemeriksaan");
  const r = await bersamaan(
    () => simpanResep(va, site, dokter, resepUrut([obatA])),
    () => simpanResep(vb, site, dokter, resepUrut([obatB])),
  );
  if (r.deadlock.length) dl6++;
  catat(`resep paralel putaran ${putaran + 1}`, r.deadlock);
}
ok(`${PUTARAN}× dua resep kunjungan berbeda tanpa deadlock`, dl6 === 0,
  dl6 > 0 ? `${dl6} putaran deadlock` : "");

// =====================================================================
console.log(`\n== 7. Gap lock: dua kasir membuka shift (${PUTARAN} putaran) ==`);
// =====================================================================
let dl7 = 0;
for (let putaran = 0; putaran < PUTARAN; putaran++) {
  const k1 = await buatUser(`${TANDA}.ks${putaran}a`, `Kasir ${putaran}A`, "kasir");
  const k2 = await buatUser(`${TANDA}.ks${putaran}b`, `Kasir ${putaran}B`, "kasir");
  const r = await bersamaan(
    () => bukaShift(site, k1, 0),
    () => bukaShift(site, k2, 0),
  );
  if (r.deadlock.length) dl7++;
  catat(`buka shift paralel putaran ${putaran + 1}`, r.deadlock);
}
ok(`${PUTARAN}× dua kasir membuka shift bersamaan tanpa deadlock`, dl7 === 0,
  dl7 > 0 ? `${dl7} putaran deadlock` : "");
// =====================================================================
console.log("\n== 8. Ringkasan ==");
// =====================================================================
ok(`total ${PUTARAN * 7} pasangan operasi bersamaan: nol deadlock`,
  totalDeadlock.length === 0, totalDeadlock.slice(0, 5).join(" | "));

/*
 * Penjaga terhadap uji ini sendiri: bila stok tidak pernah berkurang, yang
 * dijalankan bukan jalur sungguhan dan nol deadlock tidak berarti apa pun.
 */
const sisaA = Number((await queryOne<RowDataPacket & { q: string }>(
  `SELECT qty_on_hand AS q FROM item_stocks WHERE site_id = ? AND item_id = ?`,
  [site, obatA]))!.q);
ok("uji ini benar-benar menyentuh stok", sisaA < 100000,
  `sisa Obat A ${sisaA} dari 100000`);

// =====================================================================
await bersih();
console.log(gagal === 0 ? "\nSEMUA UJI LULUS\n" : `\n${gagal} UJI GAGAL\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
