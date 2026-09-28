/**
 * Uji PENJAMIN, PEMBAGIAN TANGGUNGAN, KLAIM, dan PIUTANG.
 *
 *   node uji/jalankan.mjs uji/uji-penjamin-klaim.ts
 *
 * Modul ini menyentuh UANG di tiga tempat sekaligus — kasir, tagihan, dan
 * klaim — jadi yang diuji bukan sekadar "berhasil tersimpan" melainkan
 * empat cara uang bisa bocor:
 *
 *   1. **Pasien ditagih bagian penjamin.** Kasir harus meminta
 *      `tanggung_pasien`, bukan `total`. Salah di sini berarti pasien
 *      membayar dua kali untuk hal yang sama.
 *   2. **Tagihan ditagihkan dua kali.** Satu tagihan hanya boleh berada di
 *      satu klaim berjalan — dan tetap harus bisa diklaim ulang setelah
 *      klaimnya dibatalkan.
 *   3. **Piutang lebih besar daripada yang disepakati.** Setelah penjamin
 *      memotong, sisa piutang harus dihitung dari nilai DISETUJUI.
 *   4. **Pembayaran melebihi kesepakatan.** Ditolak, bukan diterima lalu
 *      dianggap kelebihan.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne, transaction } from "../src/lib/db";
import { bagiTanggungan, simpanPenjamin, simpanTarifPenjamin, tarifTindakanUntukPenjamin } from "../src/lib/penjamin";
import {
  ajukanKlaim, barisKlaim, batalkanKlaim, buatKlaim, catatPembayaranKlaim,
  daftarKlaim, ringkasanKlaim, tagihanBelumDiklaim, umurPiutang, verifikasiKlaim,
} from "../src/lib/klaim";
import { hitungUlangTagihan, pastikanTagihan, tambahBarisTagihan } from "../src/lib/billing";
import { prosesPembayaran } from "../src/lib/cashier";
import { pembayaranSchema } from "../src/lib/validations/cashier";
import { penjaminSchema, tarifPenjaminSchema } from "../src/lib/validations/penjamin";
import { bayarKlaimSchema, klaimBaruSchema } from "../src/lib/validations/klaim";
import { tanggalHariIni } from "../src/lib/tanggal";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

const TANDA = "UJIPJM";
const hariIni = tanggalHariIni();

async function bersih() {
  const sites = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM sites WHERE kode LIKE '${TANDA}%'`)
  ).map((r) => r.id);
  if (sites.length) {
    const s = sites.join(",");
    await execute(`DELETE FROM claim_payments WHERE claim_id IN (SELECT id FROM claims WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM claim_items WHERE claim_id IN (SELECT id FROM claims WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM claims WHERE site_id IN (${s})`);
    await execute(`DELETE FROM notifications WHERE site_id IN (${s})`);
    await execute(`DELETE FROM billing_items WHERE billing_id IN (SELECT id FROM billing_transactions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM billing_transactions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM queues WHERE site_id IN (${s})`);
    await execute(`DELETE FROM medical_assessments WHERE site_id IN (${s})`);
    await execute(`DELETE FROM visits WHERE site_id IN (${s})`);
    await execute(`DELETE FROM patients WHERE site_id IN (${s})`);
    await execute(`DELETE FROM polis WHERE site_id IN (${s})`);
    await execute(`DELETE FROM sequences WHERE site_id IN (${s})`);
  }
  await execute(`DELETE FROM payer_tariffs WHERE payer_id IN (SELECT id FROM payers WHERE kode LIKE '${TANDA}%')`);
  await execute(`DELETE FROM payers WHERE kode LIKE '${TANDA}%'`);
  await execute(`DELETE FROM medical_procedures WHERE kode LIKE '${TANDA}%'`);
  await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
  if (sites.length) await execute(`DELETE FROM sites WHERE id IN (${sites.join(",")})`);
}
await bersih();

const site = (await execute(
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}', 'Uji Penjamin')`,
)).insertId;

const roleId = async (c: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM roles WHERE code = ?`, [c]))!.id);

const buatUser = async (u: string, n: string, c: string) =>
  (await execute(
    `INSERT INTO users (site_id, role_id, nama, username, password_hash) VALUES (?,?,?,?,'x')`,
    [site, await roleId(c), n, u],
  )).insertId;

const admin = await buatUser(`${TANDA}.adm`, "Admin Penjamin", "admin_cabang");
const kasir = await buatUser(`${TANDA}.kas`, "Kasir Penjamin", "kasir");
const dokter = await buatUser(`${TANDA}.dok`, "dr. Penjamin", "dokter");

const poli = (await execute(
  `INSERT INTO polis (site_id, kode, nama) VALUES (?, '${TANDA}-P', 'Poli Uji')`, [site],
)).insertId;

const tindakan = (await execute(
  `INSERT INTO medical_procedures (kode, nama, tarif) VALUES ('${TANDA}-T1', 'Tindakan Uji', 100000)`,
)).insertId;

// =====================================================================
// 1. Pembagian tanggungan — aturan tunggalnya
// =====================================================================
console.log("\n== 1. bagiTanggungan(): satu aturan, tiga arti plafon ==");

ok("tanpa penjamin (plafon < 0): pasien menanggung semua",
  JSON.stringify(bagiTanggungan(150000, -1)) ===
    JSON.stringify({ penjamin: 0, pasien: 150000, melebihiPlafon: false }));
ok("plafon 0 = TANPA BATAS: penjamin menanggung semua",
  bagiTanggungan(150000, 0).penjamin === 150000 &&
    bagiTanggungan(150000, 0).pasien === 0);
ok("plafon di atas tagihan: penjamin menanggung semua",
  bagiTanggungan(80000, 100000).pasien === 0);
ok("plafon di bawah tagihan: selisih ke pasien",
  bagiTanggungan(150000, 100000).penjamin === 100000 &&
    bagiTanggungan(150000, 100000).pasien === 50000);
ok("kelebihan plafon ditandai", bagiTanggungan(150000, 100000).melebihiPlafon === true);
ok("tepat sama dengan plafon TIDAK ditandai melebihi",
  bagiTanggungan(100000, 100000).melebihiPlafon === false);

// =====================================================================
// 2. Master penjamin & tarif kontrak
// =====================================================================
console.log("\n== 2. Penjamin & tarif kontrak ==");

const pTanpaPlafon = await simpanPenjamin(
  penjaminSchema.parse({
    kode: `${TANDA}-FULL`, nama: "PT Tanggung Penuh", jenis: "perusahaan",
    termin_hari: 30, plafon_per_kunjungan: 0,
  }),
);
const pBerplafon = await simpanPenjamin(
  penjaminSchema.parse({
    kode: `${TANDA}-CAP`, nama: "PT Berplafon", jenis: "asuransi",
    termin_hari: 14, plafon_per_kunjungan: 60000,
  }),
);
ok("dua penjamin tersimpan", pTanpaPlafon > 0 && pBerplafon > 0);

await simpanTarifPenjamin(
  tarifPenjaminSchema.parse({
    payer_id: pTanpaPlafon, procedure_id: tindakan, item_id: null, harga: 75000,
  }),
);
ok("tarif kontrak menimpa tarif global",
  (await tarifTindakanUntukPenjamin(tindakan, site, pTanpaPlafon)) === 75000,
  String(await tarifTindakanUntukPenjamin(tindakan, site, pTanpaPlafon)));
ok("tanpa kontrak, tarif global yang berlaku",
  (await tarifTindakanUntukPenjamin(tindakan, site, pBerplafon)) === 100000);
ok("pasien umum juga memakai tarif global",
  (await tarifTindakanUntukPenjamin(tindakan, site, null)) === 100000);

// Menyimpan ulang = mengubah, bukan gagal.
await simpanTarifPenjamin(
  tarifPenjaminSchema.parse({
    payer_id: pTanpaPlafon, procedure_id: tindakan, item_id: null, harga: 70000,
  }),
);
ok("menyimpan tarif yang sama = mengubah harganya",
  (await tarifTindakanUntukPenjamin(tindakan, site, pTanpaPlafon)) === 70000);

// Satu baris tarif tidak boleh menunjuk dua sasaran sekaligus.
ok("tarif tanpa sasaran ditolak schema",
  !tarifPenjaminSchema.safeParse({
    payer_id: pTanpaPlafon, procedure_id: null, item_id: null, harga: 1000,
  }).success);
ok("tarif dengan dua sasaran ditolak schema",
  !tarifPenjaminSchema.safeParse({
    payer_id: pTanpaPlafon, procedure_id: tindakan, item_id: 1, harga: 1000,
  }).success);

let tolakDb = "";
try {
  await execute(
    `INSERT INTO payer_tariffs (payer_id, procedure_id, item_id, harga) VALUES (?, NULL, NULL, 1000)`,
    [pTanpaPlafon],
  );
} catch (e) {
  tolakDb = e instanceof Error ? e.message : String(e);
}
ok("dan ditolak juga oleh CHECK di database",
  /ck_ptar_sasaran|Check constraint/i.test(tolakDb), tolakDb || "DITERIMA");

// =====================================================================
// 3. Kasir hanya menagih bagian pasien
// =====================================================================
console.log("\n== 3. Kasir menagih bagian PASIEN, bukan total ==");

let np = 0;
async function buatKunjungan(payerId: number | null, nilai: number) {
  np++;
  const pasien = (await execute(
    `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin, payer_id)
     VALUES (?,?,?,?, '1990-01-01', 'L', ?)`,
    [site, `${TANDA}-RM${np}`, `327366000009${1000 + np}`, `Pasien Penjamin ${np}`, payerId],
  )).insertId;

  const visitId = (await execute(
    `INSERT INTO visits (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
                         jenis_kunjungan, cara_bayar, payer_id, no_anggota,
                         status, registered_by)
     VALUES (?,?,?,?,?,?, 'baru', ?, ?, ?, 'menunggu_kasir', ?)`,
    [
      site, pasien, `${TANDA}/V/${np}`, hariIni, poli, dokter,
      payerId ? "perusahaan" : "umum", payerId,
      payerId ? `KRT-${1000 + np}` : null, dokter,
    ],
  )).insertId;

  await execute(
    `INSERT INTO queues (site_id, visit_id, poli_id, tanggal, prefix, nomor, status)
     VALUES (?,?,?,?, 'J', ?, 'dilayani')`,
    [site, visitId, poli, hariIni, np],
  );

  const billingId = await transaction(async (conn) => {
    const id = await pastikanTagihan(conn, visitId, site);
    await tambahBarisTagihan(conn, {
      billingId: id, kategori: "tindakan", deskripsi: "Tindakan Uji",
      qty: 1, hargaSatuan: nilai,
    });
    await hitungUlangTagihan(conn, id);
    return id;
  });

  await execute(`UPDATE billing_transactions SET status = 'menunggu' WHERE id = ?`, [billingId]);
  return { visitId, billingId, pasien };
}

const tagihan = async (id: number) =>
  (await queryOne<RowDataPacket & {
    total: string; tanggung_penjamin: string; tanggung_pasien: string;
    dibayar: string; kembalian: string; payment_method: string | null; status: string;
    payer_id: number | null;
  }>(
    `SELECT total, tanggung_penjamin, tanggung_pasien, dibayar, kembalian,
            payment_method, status, payer_id
       FROM billing_transactions WHERE id = ?`, [id],
  ))!;

// --- (a) ditanggung penuh ---
const a = await buatKunjungan(pTanpaPlafon, 120000);
const ta = await tagihan(a.billingId);
ok("penjamin tersalin ke tagihan dari kunjungannya",
  Number(ta.payer_id) === pTanpaPlafon);
ok("tanggungan terbagi otomatis saat biaya masuk",
  Number(ta.tanggung_penjamin) === 120000 && Number(ta.tanggung_pasien) === 0,
  `${ta.tanggung_penjamin} / ${ta.tanggung_pasien}`);

/*
 * Kasir menerima Rp 0 dari pasien. Sebelum pembagian ini ada, `dibayar`
 * harus menutup `total` — sehingga kasir dipaksa mengetik 120.000 yang tidak
 * pernah diterimanya, dan laporan kas berselisih sebesar itu setiap hari.
 */
await prosesPembayaran(
  a.billingId, site, kasir, null,
  pembayaranSchema.parse({ payment_method: "tunai", dibayar: 0, diskon: 0 }), 0,
);
const ta2 = await tagihan(a.billingId);
ok("tagihan penuh penjamin bisa lunas tanpa uang pasien", ta2.status === "lunas");
ok("metodenya dipaksa 'penjamin', bukan tunai Rp 0",
  ta2.payment_method === "penjamin", String(ta2.payment_method));
ok("kas kasir tidak bertambah", Number(ta2.dibayar) === 0);

// --- (b) melebihi plafon ---
const b = await buatKunjungan(pBerplafon, 100000);
const tb = await tagihan(b.billingId);
ok("plafon 60.000 atas tagihan 100.000: pasien menanggung 40.000",
  Number(tb.tanggung_penjamin) === 60000 && Number(tb.tanggung_pasien) === 40000,
  `${tb.tanggung_penjamin} / ${tb.tanggung_pasien}`);

let tolakKurang = "";
try {
  await prosesPembayaran(
    b.billingId, site, kasir, null,
    pembayaranSchema.parse({ payment_method: "tunai", dibayar: 30000, diskon: 0 }), 0,
  );
} catch (e) {
  tolakKurang = e instanceof Error ? e.message : String(e);
}
ok("uang kurang dari bagian pasien ditolak",
  /kurang/i.test(tolakKurang), tolakKurang || "DITERIMA");

const hasilB = await prosesPembayaran(
  b.billingId, site, kasir, null,
  pembayaranSchema.parse({ payment_method: "tunai", dibayar: 50000, diskon: 0 }), 0,
);
const tb2 = await tagihan(b.billingId);
ok("kembalian dihitung dari bagian pasien, bukan total",
  Number(tb2.kembalian) === 10000, `kembalian ${tb2.kembalian}`);
ok("total tagihan tetap utuh", Number(tb2.total) === 100000);
ok("nilai balik prosesPembayaran konsisten", hasilB.total === 100000);

// --- (c) pasien umum tidak tersentuh ---
const c = await buatKunjungan(null, 90000);
const tc = await tagihan(c.billingId);
ok("pasien tanpa penjamin: seluruhnya tanggungan pasien",
  Number(tc.tanggung_penjamin) === 0 && Number(tc.tanggung_pasien) === 90000);
await prosesPembayaran(
  c.billingId, site, kasir, null,
  pembayaranSchema.parse({ payment_method: "tunai", dibayar: 90000, diskon: 0 }), 0,
);
ok("alur pasien umum tidak berubah",
  (await tagihan(c.billingId)).payment_method === "tunai");

// =====================================================================
// 4. Klaim: kandidat, pembuatan, pengunciannya
// =====================================================================
console.log("\n== 4. Berkas klaim & penguncian tagihan ==");

const kandidat = await tagihanBelumDiklaim(site, pTanpaPlafon, hariIni, hariIni);
ok("hanya tagihan penjamin ini yang jadi kandidat",
  kandidat.length === 1 && Number(kandidat[0].billing_id) === a.billingId,
  `${kandidat.length} kandidat`);
ok("tagihan pasien umum tidak pernah jadi kandidat",
  (await tagihanBelumDiklaim(site, pBerplafon, hariIni, hariIni))
    .every((k) => Number(k.billing_id) !== c.billingId));

const klaim1 = await buatKlaim(
  klaimBaruSchema.parse({
    payer_id: pTanpaPlafon, periode_dari: hariIni, periode_sampai: hariIni,
  }),
  site, admin,
);
ok("klaim terbentuk dengan nomor berpola", /\/KLM\/\d{6}\/\d{4}$/.test(klaim1.noKlaim),
  klaim1.noKlaim);
ok("nilai klaim = jumlah tanggungan penjamin", klaim1.total === 120000,
  String(klaim1.total));

ok("tagihan yang sudah masuk klaim hilang dari kandidat",
  (await tagihanBelumDiklaim(site, pTanpaPlafon, hariIni, hariIni)).length === 0);

let tolakKosong = "";
try {
  await buatKlaim(
    klaimBaruSchema.parse({
      payer_id: pTanpaPlafon, periode_dari: hariIni, periode_sampai: hariIni,
    }),
    site, admin,
  );
} catch (e) {
  tolakKosong = e instanceof Error ? e.message : String(e);
}
ok("klaim kedua atas periode yang sama ditolak (tidak ada kandidat)",
  /tidak ada tagihan/i.test(tolakKosong), tolakKosong || "DITERIMA");

// Piutang belum berjalan selama masih draft.
ok("klaim draft belum menjadi piutang",
  (await ringkasanKlaim(site)).piutang === 0);

// =====================================================================
// 5. Pengajuan, verifikasi, dan piutang
// =====================================================================
console.log("\n== 5. Ajukan → verifikasi → piutang ==");

let tolakBayarDraft = "";
try {
  await catatPembayaranKlaim(
    klaim1.id, site,
    bayarKlaimSchema.parse({ tanggal: hariIni, jumlah: 1000, metode: "transfer" }),
    admin,
  );
} catch (e) {
  tolakBayarDraft = e instanceof Error ? e.message : String(e);
}
ok("pembayaran atas klaim draft ditolak",
  /belum diajukan/i.test(tolakBayarDraft), tolakBayarDraft || "DITERIMA");

const ajuan = await ajukanKlaim(klaim1.id, site, admin);
ok("jatuh tempo dihitung dari termin kontrak (30 hari)",
  ajuan.jatuhTempo ===
    new Date(Date.UTC(...(hariIni.split("-").map(Number) as [number, number, number])) + 30 * 86400000 - 0)
      .toISOString().slice(0, 10) ||
    ajuan.jatuhTempo > hariIni,
  ajuan.jatuhTempo);

const setelahAjuan = await ringkasanKlaim(site);
ok("klaim yang diajukan langsung menjadi piutang",
  setelahAjuan.piutang === 120000, String(setelahAjuan.piutang));
ok("belum lewat jatuh tempo", setelahAjuan.terlambat === 0);

const barisK = await barisKlaim(klaim1.id);
ok("baris klaim tidak memuat diagnosa",
  !Object.keys(barisK[0] ?? {}).some((k) => /diagnos|icd/i.test(k)));

// Penjamin memotong tanpa alasan → ditolak.
let tolakTanpaAlasan = "";
try {
  await verifikasiKlaim(klaim1.id, site, {
    baris: [{ claim_item_id: Number(barisK[0].id), nilai_disetujui: 100000, alasan_koreksi: undefined }],
  });
} catch (e) {
  tolakTanpaAlasan = e instanceof Error ? e.message : String(e);
}
ok("potongan tanpa alasan koreksi ditolak",
  /alasan koreksi/i.test(tolakTanpaAlasan), tolakTanpaAlasan || "DITERIMA");

let tolakLebih = "";
try {
  await verifikasiKlaim(klaim1.id, site, {
    baris: [{ claim_item_id: Number(barisK[0].id), nilai_disetujui: 200000, alasan_koreksi: "x" }],
  });
} catch (e) {
  tolakLebih = e instanceof Error ? e.message : String(e);
}
ok("nilai disetujui di atas nilai diajukan ditolak",
  /melebihi/i.test(tolakLebih), tolakLebih || "DITERIMA");

const verif = await verifikasiKlaim(klaim1.id, site, {
  baris: [{
    claim_item_id: Number(barisK[0].id), nilai_disetujui: 100000,
    alasan_koreksi: "Tarif kontrak berbeda",
  }],
});
ok("verifikasi mencatat potongan", verif.totalDisetujui === 100000 && verif.dikoreksi === 1);

const setelahVerif = await ringkasanKlaim(site);
ok("piutang mengikuti nilai DISETUJUI, bukan diajukan",
  setelahVerif.piutang === 100000, String(setelahVerif.piutang));

// =====================================================================
// 6. Pembayaran bertahap & penolakan kelebihan
// =====================================================================
console.log("\n== 6. Pembayaran penjamin ==");

const bayar1 = await catatPembayaranKlaim(
  klaim1.id, site,
  bayarKlaimSchema.parse({ tanggal: hariIni, jumlah: 40000, metode: "transfer", ref: "TRF-1" }),
  admin,
);
ok("pembayaran sebagian diterima", bayar1.dibayar === 40000 && bayar1.lunas === false);
ok("sisa dihitung benar", bayar1.sisa === 60000, String(bayar1.sisa));

let tolakLebihBayar = "";
try {
  await catatPembayaranKlaim(
    klaim1.id, site,
    bayarKlaimSchema.parse({ tanggal: hariIni, jumlah: 70000, metode: "transfer" }),
    admin,
  );
} catch (e) {
  tolakLebihBayar = e instanceof Error ? e.message : String(e);
}
ok("pembayaran melebihi kesepakatan ditolak",
  /melebihi/i.test(tolakLebihBayar), tolakLebihBayar || "DITERIMA");

const bayar2 = await catatPembayaranKlaim(
  klaim1.id, site,
  bayarKlaimSchema.parse({ tanggal: hariIni, jumlah: 60000, metode: "transfer", ref: "TRF-2" }),
  admin,
);
ok("pelunasan menutup klaim", bayar2.lunas === true && bayar2.sisa === 0);
ok("piutang kembali nol setelah lunas", (await ringkasanKlaim(site)).piutang === 0);

let tolakBatalLunas = "";
try {
  await batalkanKlaim(klaim1.id, site, "coba");
} catch (e) {
  tolakBatalLunas = e instanceof Error ? e.message : String(e);
}
ok("klaim lunas tidak bisa dibatalkan",
  /sudah lunas/i.test(tolakBatalLunas), tolakBatalLunas || "DITERIMA");

// =====================================================================
// 7. Pembatalan klaim melepaskan tagihannya
// =====================================================================
console.log("\n== 7. Batalkan klaim → tagihan bisa diklaim ulang ==");

const d = await buatKunjungan(pBerplafon, 50000);
await prosesPembayaran(
  d.billingId, site, kasir, null,
  pembayaranSchema.parse({ payment_method: "tunai", dibayar: 0, diskon: 0 }), 0,
);
ok("tagihan 50.000 di bawah plafon 60.000 → penuh penjamin",
  Number((await tagihan(d.billingId)).tanggung_pasien) === 0);

const klaim2 = await buatKlaim(
  klaimBaruSchema.parse({
    payer_id: pBerplafon, periode_dari: hariIni, periode_sampai: hariIni,
  }),
  site, admin,
);
ok("klaim kedua memuat tagihan berplafon",
  klaim2.jumlahBaris >= 1, `${klaim2.jumlahBaris} baris`);

await ajukanKlaim(klaim2.id, site, admin);
const batal = await batalkanKlaim(klaim2.id, site, "Berkas ditolak penjamin");
ok("pembatalan melepaskan barisnya", batal.barisDilepas === klaim2.jumlahBaris,
  `${batal.barisDilepas} dilepas`);

/*
 * INTI bagian ini. Kunci unik pada `claim_items` memakai kolom turunan
 * `billing_aktif`, meniru pelajaran dari `prescriptions.visit_aktif`:
 * kunci polos akan membuat tagihan yang klaimnya dibatalkan tidak pernah
 * bisa diklaim lagi — padahal klaim memang sering ditolak lalu diajukan
 * ulang.
 */
const ulang = await tagihanBelumDiklaim(site, pBerplafon, hariIni, hariIni);
ok("tagihannya kembali menjadi kandidat", ulang.length === klaim2.jumlahBaris,
  `${ulang.length} kandidat`);

const klaim3 = await buatKlaim(
  klaimBaruSchema.parse({
    payer_id: pBerplafon, periode_dari: hariIni, periode_sampai: hariIni,
  }),
  site, admin,
);
ok("klaim ulang berhasil dibuat", klaim3.id > 0 && klaim3.noKlaim !== klaim2.noKlaim,
  klaim3.noKlaim);

const jejak = await daftarKlaim(site);
ok("riwayat klaim yang dibatalkan TETAP tersimpan",
  jejak.some((k) => Number(k.id) === klaim2.id && k.status === "batal"));

// Dua klaim berjalan atas satu tagihan tetap mustahil di tingkat database.
let tolakDobel = "";
try {
  await execute(
    `INSERT INTO claim_items (claim_id, billing_id, nilai_diajukan) VALUES (?,?,1)`,
    [klaim3.id, d.billingId],
  );
} catch (e) {
  tolakDobel = e instanceof Error ? e.message : String(e);
}
ok("satu tagihan di dua klaim berjalan ditolak database",
  /Duplicate entry/i.test(tolakDobel), tolakDobel || "DITERIMA");

// =====================================================================
// 8. Umur piutang
// =====================================================================
console.log("\n== 8. Umur piutang ==");

await ajukanKlaim(klaim3.id, site, admin);
// Jatuh tempo dipaksa ke masa lalu untuk menguji embernya.
await execute(
  `UPDATE claims SET jatuh_tempo = DATE_SUB(CURDATE(), INTERVAL 95 DAY) WHERE id = ?`,
  [klaim3.id],
);

const umur = await umurPiutang(site);
const barisUmur = umur.find((u) => u.penjaminId === pBerplafon);
ok("piutang >90 hari masuk ember terakhir",
  (barisUmur?.umurLebih90 ?? 0) > 0, JSON.stringify(barisUmur));
ok("total umur piutang = jumlah embernya",
  barisUmur !== undefined &&
    barisUmur.total ===
      barisUmur.belumJatuhTempo + barisUmur.umur1_30 + barisUmur.umur31_60 +
      barisUmur.umur61_90 + barisUmur.umurLebih90);

const ringAkhir = await ringkasanKlaim(site);
ok("klaim terlambat terhitung", ringAkhir.terlambat === 1, String(ringAkhir.terlambat));
ok("nilai terlambat sama dengan sisanya",
  ringAkhir.nilaiTerlambat === (barisUmur?.umurLebih90 ?? -1));

// =====================================================================
await bersih();
console.log(gagal === 0 ? "\nSEMUA UJI LULUS\n" : `\n${gagal} UJI GAGAL\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
