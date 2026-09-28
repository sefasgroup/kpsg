/**
 * Uji PENCARIAN CEPAT (Ctrl/⌘ + K).
 *
 *   node uji/jalankan.mjs uji/uji-pencarian.ts
 *
 * Kotak pencarian adalah satu-satunya tempat di aplikasi yang menyentuh
 * SEMUA modul sekaligus. Justru karena itu ia jadi tempat paling mudah
 * membocorkan dua hal:
 *
 *   1. **Pemisahan tugas** — kalau tujuannya ditentukan tanpa melihat peran,
 *      kasir bisa mendarat di layar rekam medis.
 *   2. **Isolasi cabang** — setiap layar detail menyaring `site_id`, jadi
 *      tautan ke kunjungan cabang lain berujung 404 yang terbaca sebagai
 *      data hilang.
 *
 * Yang diuji:
 *
 *   1. Pasien ditemukan lewat nama, NIK persis, dan No. RM; di bawah dua
 *      huruf tidak menghasilkan apa pun.
 *   2. Tautan mengikuti PERAN **dan** STATUS — tagihan yang masih `draft`
 *      tidak boleh melempar kasir ke layar pembayaran pasien yang bahkan
 *      belum diperiksa.
 *   3. Kunjungan di cabang lain ditandai dan tidak diberi tautan.
 *   4. Kunjungan yang sudah selesai tidak muncul sebagai posisi sekarang.
 *   5. Peran non-operasional tidak mendapat tautan sama sekali.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne, transaction } from "../src/lib/db";
import { cariCepat } from "../src/lib/pencarian";
import { tambahStok } from "../src/lib/stock";
import { serahkanResep, terimaResep, validasiResep } from "../src/lib/pharmacy";
import { simpanResep } from "../src/lib/prescription";
import { prosesPembayaran } from "../src/lib/cashier";
import { buatOrderLab } from "../src/lib/lab";
import { resepSchema } from "../src/lib/validations/doctor";
import { pembayaranSchema } from "../src/lib/validations/cashier";
import { orderLabSchema } from "../src/lib/validations/lab";
import { tanggalHariIni } from "../src/lib/tanggal";

/*
 * Resep hanya bisa ditulis selama kunjungan di tahap dokter (lib/prescription.ts).
 * Uji ini menyiapkan kunjungannya langsung di tahap farmasi/kasir, jadi urutan
 * nyatanya disimulasikan: kembali sebentar ke tahap dokter, tulis resep, lalu
 * kembali ke status semula — seperti dokter menulis resep lalu menekan
 * Finalkan Asesmen.
 */
async function simpanResepUji(...args: Parameters<typeof simpanResep>) {
  const [visitId] = args;
  const lama = (await queryOne<RowDataPacket & { status: string }>(
    `SELECT status FROM visits WHERE id = ?`, [visitId]))!.status;
  await execute(`UPDATE visits SET status = 'dalam_pemeriksaan' WHERE id = ?`, [visitId]);
  try {
    return await simpanResep(...args);
  } finally {
    await execute(`UPDATE visits SET status = ? WHERE id = ?`, [lama, visitId]);
  }
}


let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

const TANDA = "UJICARI";
const hariIni = tanggalHariIni();

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
    await execute(`DELETE FROM queues WHERE site_id IN (${s})`);
    await execute(`DELETE FROM lab_results WHERE order_id IN (SELECT id FROM lab_orders WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM lab_order_panels WHERE order_id IN (SELECT id FROM lab_orders WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM lab_orders WHERE site_id IN (${s})`);
    await execute(`DELETE FROM medical_assessments WHERE site_id IN (${s})`);
    await execute(`DELETE FROM visits WHERE site_id IN (${s})`);
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
  await execute(`DELETE FROM lab_parameters WHERE panel_id IN (SELECT id FROM lab_panels WHERE kode LIKE '${TANDA}%')`);
  await execute(`DELETE FROM lab_panels WHERE kode LIKE '${TANDA}%'`);
}
await bersih();

const site = (await execute(
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}', 'Uji Cari Utama')`,
)).insertId;
const siteLain = (await execute(
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}2', 'Uji Cari Tetangga')`,
)).insertId;

const roleId = async (c: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM roles WHERE code = ?`, [c]))!.id);

const buatUser = async (u: string, n: string, c: string) =>
  (await execute(
    `INSERT INTO users (site_id, role_id, nama, username, password_hash) VALUES (?,?,?,?,'x')`,
    [site, await roleId(c), n, u],
  )).insertId;

const dokter = await buatUser(`${TANDA}.dokter`, "dr. Uji Cari", "dokter");
const apoteker = await buatUser(`${TANDA}.apt`, "apt. Uji Cari", "farmasi");
const kasir = await buatUser(`${TANDA}.kasir`, "Kasir Cari", "kasir");

const poli = (await execute(
  `INSERT INTO polis (site_id, kode, nama) VALUES (?, '${TANDA}-P', 'Poli Cari')`, [site],
)).insertId;
const poliLain = (await execute(
  `INSERT INTO polis (site_id, kode, nama) VALUES (?, '${TANDA}-P2', 'Poli Tetangga')`, [siteLain],
)).insertId;

const item = (await execute(
  `INSERT INTO items (kode, nama, tipe, satuan_dasar, hpp, harga_jual)
   VALUES ('${TANDA}-OBAT', 'Obat Uji Cari', 'obat', 'tablet', 1000, 2000)`,
)).insertId;

await transaction((conn) =>
  tambahStok(conn, {
    siteId: site, itemId: item, qty: 100, jenis: "masuk_pembelian",
    refType: "purchase", userId: apoteker,
  }),
);

const panel = (await execute(
  `INSERT INTO lab_panels (kode, nama, kategori, tarif)
   VALUES ('${TANDA}-P1', 'Panel Uji Cari', 'Uji', 30000)`,
)).insertId;
await execute(
  `INSERT INTO lab_parameters (panel_id, kode, nama, tipe_nilai, urutan)
   VALUES (?, '${TANDA}-PAR', 'Parameter Cari', 'numerik', 1)`,
  [panel],
);

/*
 * Nama pasien sengaja dibuat khas ("Zulkarnaen Uji…"). Basis data uji
 * berbagi tabel `patients` dengan data contoh, dan nama umum seperti "Budi"
 * akan membuat hasilnya bercampur — uji yang lulus karena kebetulan bukan
 * uji.
 */
let n = 0;
async function buatKunjungan(opts: {
  status: string;
  siteId?: number;
  poliId?: number;
  asesmenFinal?: boolean;
}) {
  n++;
  const s = opts.siteId ?? site;
  const pasien = (await execute(
    `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin)
     VALUES (?,?,?,?, '1990-01-01', 'L')`,
    [s, `${TANDA}-RM${n}`, `327399000009${1000 + n}`, `Zulkarnaen Uji Cari ${n}`],
  )).insertId;

  const visitId = (await execute(
    `INSERT INTO visits (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
                         jenis_kunjungan, status, registered_by)
     VALUES (?,?,?,?,?,?, 'baru', ?, ?)`,
    [s, pasien, `${TANDA}/V/${n}`, hariIni, opts.poliId ?? poli, dokter, opts.status, dokter],
  )).insertId;

  await execute(
    `INSERT INTO queues (site_id, visit_id, poli_id, tanggal, prefix, nomor, status)
     VALUES (?,?,?,?, 'Z', ?, 'dilayani')`,
    [s, visitId, opts.poliId ?? poli, hariIni, n],
  );

  if (opts.asesmenFinal ?? true) {
    await execute(
      `INSERT INTO medical_assessments (visit_id, site_id, doctor_id, status)
       VALUES (?,?,?, 'final')`,
      [visitId, s, dokter],
    );
  }
  return { visitId, pasien, nama: `Zulkarnaen Uji Cari ${n}`, nik: `327399000009${1000 + n}`, noRm: `${TANDA}-RM${n}` };
}

const resep = resepSchema.parse({
  items: [{
    item_id: item, nama: "Obat Uji Cari", qty: 3,
    satuan: "tablet", aturan_pakai: "3 x sehari 1 tablet", harga_satuan: 2000,
  }],
  racikans: [],
});

const cari = (kata: string, peran: Parameters<typeof cariCepat>[1], s: number | null = site) =>
  cariCepat(kata, peran, s, 20);

const ambil = async (
  kata: string,
  peran: Parameters<typeof cariCepat>[1],
  nik: string,
  s: number | null = site,
) => (await cari(kata, peran, s)).find((r) => r.nik === nik) ?? null;

// =====================================================================
// 1. Cara mencari
// =====================================================================
console.log("\n== 1. Nama, NIK, dan No. RM ==");

const a = await buatKunjungan({ status: "menunggu_dokter" });

ok("ketemu lewat potongan nama", (await ambil("Zulkarnaen", "dokter", a.nik)) !== null);
ok("ketemu lewat NIK persis", (await ambil(a.nik, "dokter", a.nik)) !== null);
ok("ketemu lewat No. RM", (await ambil(a.noRm, "dokter", a.nik)) !== null);
ok("satu huruf tidak menghasilkan apa pun", (await cari("Z", "dokter")).length === 0);
ok("kata yang tidak cocok tidak menghasilkan apa pun",
  (await cari("Xxqqzz", "dokter")).length === 0);

const barisA = (await ambil("Zulkarnaen", "dokter", a.nik))!;
ok("posisi pasien ikut terbawa", barisA.status === "menunggu_dokter", String(barisA.status));
ok("poli ikut terbawa", barisA.poliNama === "Poli Cari", String(barisA.poliNama));
ok("nomor antrean ikut terbawa", /^Z\d{3}$/.test(String(barisA.antrean)), String(barisA.antrean));

// =====================================================================
// 2. Tautan mengikuti peran DAN status
// =====================================================================
console.log("\n== 2. Tautan per peran, disaring status ==");

ok("dokter → layar RME", (await ambil("Zulkarnaen", "dokter", a.nik))?.link === `/rme/${a.visitId}`,
  String((await ambil("Zulkarnaen", "dokter", a.nik))?.link));
ok("perawat → layar pengkajian",
  (await ambil("Zulkarnaen", "perawat", a.nik))?.link === `/pengkajian/${a.visitId}`);

/*
 * Inti bagian ini. Tagihan sudah ADA sejak pasien mendaftar, tetapi masih
 * `draft`. Kalau kotak pencarian hanya melihat "ada baris tagihan", kasir
 * akan dilempar ke layar pembayaran pasien yang belum diperiksa dokter.
 */
ok("kasir TIDAK dapat tautan selagi tagihan masih draft",
  (await ambil("Zulkarnaen", "kasir", a.nik))?.link === null,
  String((await ambil("Zulkarnaen", "kasir", a.nik))?.link));
ok("farmasi TIDAK dapat tautan selagi belum ada resep",
  (await ambil("Zulkarnaen", "farmasi", a.nik))?.link === null);
ok("petugas lab TIDAK dapat tautan selagi belum ada order",
  (await ambil("Zulkarnaen", "petugas_lab", a.nik))?.link === null);

// --- order lab dibuat → petugas lab baru dapat tautannya ---
const orderId = (await buatOrderLab(
  a.visitId, site, dokter,
  orderLabSchema.parse({
    prioritas: "rutin",
    sifat_hasil: "menyusul",
    panels: [{ panel_id: panel, nama: "Panel Uji Cari", tarif: 30000 }],
  }),
)).orderId;

ok("setelah order dibuat, petugas lab dapat tautan order",
  (await ambil("Zulkarnaen", "petugas_lab", a.nik))?.link === `/lab/${orderId}`,
  String((await ambil("Zulkarnaen", "petugas_lab", a.nik))?.link));

// --- resep dikirim → farmasi dapat tautannya ---
const b = await buatKunjungan({ status: "menunggu_farmasi" });
const rx = await simpanResepUji(b.visitId, site, dokter, resep);

ok("resep terkirim → farmasi dapat tautan resep",
  (await ambil("Zulkarnaen", "farmasi", b.nik))?.link === `/farmasi/${rx.prescriptionId}`,
  String((await ambil("Zulkarnaen", "farmasi", b.nik))?.link));

// --- resep divalidasi → tagihan naik ke `menunggu`, kasir dapat tautannya ---
await terimaResep(rx.prescriptionId, site, apoteker);
await validasiResep(rx.prescriptionId, site, apoteker);

const tagihanB = (await queryOne<RowDataPacket & { id: number; status: string }>(
  `SELECT id, status FROM billing_transactions WHERE visit_id = ?`, [b.visitId],
))!;
ok("tagihan sudah naik dari draft", tagihanB.status !== "draft", String(tagihanB.status));
ok("kasir dapat tautan tagihan begitu siap dibayar",
  (await ambil("Zulkarnaen", "kasir", b.nik))?.link === `/kasir/${tagihanB.id}`,
  String((await ambil("Zulkarnaen", "kasir", b.nik))?.link));

// =====================================================================
// 3. Cabang lain: ditandai, tidak ditautkan
// =====================================================================
console.log("\n== 3. Kunjungan di cabang lain ==");

const c = await buatKunjungan({
  status: "menunggu_dokter", siteId: siteLain, poliId: poliLain,
});

const dariSini = (await ambil("Zulkarnaen", "dokter", c.nik, site))!;
ok("pasien cabang lain TETAP ketemu", dariSini !== null);
ok("ditandai sebagai cabang lain", dariSini.cabangLain === true);
ok("tanpa tautan — layar detail menyaring site_id", dariSini.link === null,
  String(dariSini.link));
ok("nama cabangnya disebutkan", dariSini.siteNama === "Uji Cari Tetangga",
  String(dariSini.siteNama));

const dariSana = (await ambil("Zulkarnaen", "dokter", c.nik, siteLain))!;
ok("dari cabang yang benar, tautannya muncul", dariSana.link === `/rme/${c.visitId}`,
  String(dariSana.link));

// =====================================================================
// 4. Kunjungan yang sudah tutup bukan "posisi sekarang"
// =====================================================================
console.log("\n== 4. Kunjungan selesai & batal ==");

await prosesPembayaran(
  Number(tagihanB.id), site, kasir, null,
  pembayaranSchema.parse({ payment_method: "tunai", dibayar: 999999, diskon: 0 }), 0,
);
await serahkanResep(rx.prescriptionId, site, apoteker);

const setelahSelesai = (await ambil("Zulkarnaen", "kasir", b.nik))!;
ok("pasien tetap ketemu setelah kunjungan selesai", setelahSelesai !== null);
ok("tidak lagi menunjukkan posisi berjalan", setelahSelesai.status === null,
  String(setelahSelesai.status));
ok("tidak ada tautan untuk kunjungan yang sudah tutup",
  setelahSelesai.link === null, String(setelahSelesai.link));

const d = await buatKunjungan({ status: "batal" });
ok("kunjungan batal juga tidak dianggap posisi berjalan",
  (await ambil("Zulkarnaen", "dokter", d.nik))?.status === null);

// =====================================================================
// 5. Peran tanpa layar operasional
// =====================================================================
console.log("\n== 5. Peran non-operasional ==");

/*
 * Dua peran ini TIDAK PERNAH mendapat tautan, dan itu memang disengaja:
 * menu Super Admin murni sistem & master data, sedangkan menu Admin
 * Cabang tidak punya satu pun layar yang menerima id pasien. `canAccess()`
 * diturunkan dari menu itu, jadi tautan operasional untuk keduanya pasti
 * dipental middleware ke /dashboard — tautan yang selalu gagal lebih buruk
 * daripada tidak ada tautan.
 *
 * Konsekuensinya jatuh ke ANTARMUKA, dan pernah menjadi bug nyata: kotak
 * Ctrl+K menyembunyikan sorotan pada baris yang tak bisa dibuka dan
 * me-`disabled` tombolnya, sehingga bagi dua peran ini panah dan Enter
 * tampak mati total. Baris yang tak bisa dibuka tetap harus bisa disorot
 * dan tetap harus menjelaskan dirinya — lihat `shell/cari-cepat.tsx`.
 */
ok("admin cabang melihat posisinya, tanpa tautan",
  (await ambil("Zulkarnaen", "admin_cabang", a.nik))?.status === "menunggu_dokter" &&
  (await ambil("Zulkarnaen", "admin_cabang", a.nik))?.link === null);
ok("super admin juga tanpa tautan",
  (await ambil("Zulkarnaen", "super_admin", a.nik))?.link === null);

// =====================================================================
// 6. Pasien nonaktif tidak ikut
// =====================================================================
console.log("\n== 6. Pasien nonaktif ==");

await execute(`UPDATE patients SET is_active = 0 WHERE id = ?`, [d.pasien]);
ok("pasien nonaktif hilang dari hasil", (await ambil("Zulkarnaen", "dokter", d.nik)) === null);

// =====================================================================
await bersih();
console.log(gagal === 0 ? "\nSEMUA UJI LULUS\n" : `\n${gagal} UJI GAGAL\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
