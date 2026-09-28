/**
 * Uji KEPATUHAN: persetujuan pasien, insiden keselamatan, SIPNAP, dan LB1.
 *
 *   node uji/jalankan.mjs uji/uji-kepatuhan.ts
 *
 * Empat kewajiban yang sebelumnya tidak punya tempat di sistem ini. Yang
 * diuji bukan kelengkapan kolomnya, melainkan hal-hal yang membuat
 * catatannya berguna atau justru berbahaya:
 *
 *   1. **Persetujuan** — dokumen yang menyatakan pasien menyetujui sesuatu
 *      yang tidak dinamai, atau penolakan yang tercatat sebagai setuju,
 *      lebih buruk daripada tidak ada dokumen.
 *   2. **IKP** — insiden risiko tinggi tidak boleh ditutup tanpa analisis
 *      akar masalah, dan pelaporan anonim harus benar-benar anonim.
 *   3. **SIPNAP** — angkanya diturunkan dari kartu stok, jadi ia harus
 *      cocok dengan saldo gudang; selisih adalah temuan, bukan pembulatan.
 *   4. **LB1** — diagnosa banding tidak boleh dilaporkan sebagai penyakit,
 *      dan kunjungan yang TIDAK terhitung harus bisa dilihat jumlahnya.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne, transaction } from "../src/lib/db";
import {
  batalkanConsent, consentKunjungan, daftarIkp, getIkp, laporkanIkp,
  rekapIkp, simpanConsent, tindakLanjutIkp,
} from "../src/lib/kepatuhan";
import { kesiapanSipnap, rekapSipnap, registerSipnap } from "../src/lib/sipnap";
import { kesiapanLb1, lb1Morbiditas } from "../src/lib/laporan";
import { tambahStok, kurangiStok } from "../src/lib/stock";
import { consentSchema, ikpSchema, tindakLanjutIkpSchema } from "../src/lib/validations/kepatuhan";
import { tanggalHariIni } from "../src/lib/tanggal";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

const TANDA = "UJIKPT";
const hariIni = tanggalHariIni();

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
    await execute(`DELETE FROM patient_safety_incidents WHERE site_id IN (${s})`);
    await execute(`DELETE FROM consents WHERE site_id IN (${s})`);
    await execute(`DELETE FROM assessment_diagnoses WHERE assessment_id IN (SELECT id FROM medical_assessments WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM medical_assessments WHERE site_id IN (${s})`);
    await execute(`DELETE FROM billing_items WHERE billing_id IN (SELECT id FROM billing_transactions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM billing_transactions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM queues WHERE site_id IN (${s})`);
    await execute(`DELETE FROM visits WHERE site_id IN (${s})`);
    await execute(`DELETE FROM patients WHERE site_id IN (${s})`);
    await execute(`DELETE FROM stock_movements WHERE site_id IN (${s})`);
    await execute(`DELETE FROM item_batches WHERE site_id IN (${s})`);
    await execute(`DELETE FROM item_stocks WHERE site_id IN (${s})`);
    await execute(`DELETE FROM polis WHERE site_id IN (${s})`);
    await execute(`DELETE FROM sequences WHERE site_id IN (${s})`);
  }
  if (items.length) {
    const l = items.join(",");
    await execute(`DELETE FROM stock_movements WHERE item_id IN (${l})`);
    await execute(`DELETE FROM item_stocks WHERE item_id IN (${l})`);
    await execute(`DELETE FROM items WHERE id IN (${l})`);
  }
  await execute(`DELETE FROM medical_procedures WHERE kode LIKE '${TANDA}%'`);
  await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
  if (sites.length) await execute(`DELETE FROM sites WHERE id IN (${sites.join(",")})`);
}
await bersih();

const site = (await execute(
  `INSERT INTO sites (kode, nama) VALUES ('${TANDA}', 'Uji Kepatuhan')`,
)).insertId;

const roleId = async (c: string) =>
  Number((await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM roles WHERE code = ?`, [c]))!.id);
const buatUser = async (u: string, n: string, c: string) =>
  (await execute(
    `INSERT INTO users (site_id, role_id, nama, username, password_hash) VALUES (?,?,?,?,'x')`,
    [site, await roleId(c), n, u],
  )).insertId;

const dokter = await buatUser(`${TANDA}.dok`, "dr. Kepatuhan", "dokter");
const perawat = await buatUser(`${TANDA}.per`, "Perawat Kepatuhan", "perawat");
const admin = await buatUser(`${TANDA}.adm`, "Admin Kepatuhan", "admin_cabang");
const apoteker = await buatUser(`${TANDA}.apt`, "apt. Kepatuhan", "farmasi");

const poli = (await execute(
  `INSERT INTO polis (site_id, kode, nama) VALUES (?, '${TANDA}-P', 'Poli Kepatuhan')`, [site],
)).insertId;
const tindakan = (await execute(
  `INSERT INTO medical_procedures (kode, nama, tarif) VALUES ('${TANDA}-T', 'Insisi Abses', 150000)`,
)).insertId;

let np = 0;
async function buatKunjungan(opts: { status?: string; baru?: boolean } = {}) {
  np++;
  const pasien = (await execute(
    `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin)
     VALUES (?,?,?,?, '1990-01-01', ?)`,
    [site, `${TANDA}-RM${np}`, `327355000009${1000 + np}`, `Pasien Kepatuhan ${np}`,
      np % 2 === 0 ? "P" : "L"],
  )).insertId;
  const visitId = (await execute(
    `INSERT INTO visits (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
                         jenis_kunjungan, status, registered_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [site, pasien, `${TANDA}/V/${np}`, hariIni, poli, dokter,
      opts.baru ? "baru" : "lama", opts.status ?? "dalam_pemeriksaan", dokter],
  )).insertId;
  return { visitId, pasien };
}

// =====================================================================
// 1. Persetujuan pasien
// =====================================================================
console.log("\n== 1. Persetujuan pasien ==");

const k1 = await buatKunjungan();

const idUmum = await simpanConsent(
  consentSchema.parse({
    visit_id: k1.visitId, jenis: "umum",
    judul: "Persetujuan Umum Pelayanan Kesehatan",
    isi: "Saya bersedia menjalani pemeriksaan dan pengobatan sesuai kebutuhan medis saya.",
    penandatangan: "Pasien Kepatuhan 1", hubungan: "Pasien sendiri",
  }),
  site, perawat,
);
ok("persetujuan umum tersimpan", idUmum > 0);

/*
 * Persetujuan TINDAKAN tanpa menyebut tindakannya bukan persetujuan —
 * pasien tidak bisa menyetujui sesuatu yang tidak dinamai.
 */
ok("persetujuan tindakan tanpa tindakan ditolak",
  !consentSchema.safeParse({
    visit_id: k1.visitId, jenis: "tindakan", judul: "Persetujuan Tindakan",
    isi: "Setelah mendapat penjelasan saya menyetujui tindakan tersebut dilakukan.",
    penandatangan: "Budi Santoso", penjelasan_oleh: dokter,
  }).success);
ok("persetujuan tindakan tanpa pemberi penjelasan ditolak",
  !consentSchema.safeParse({
    visit_id: k1.visitId, jenis: "tindakan", judul: "Persetujuan Tindakan",
    isi: "Setelah mendapat penjelasan saya menyetujui tindakan tersebut dilakukan.",
    penandatangan: "Budi Santoso", procedure_id: tindakan,
  }).success);
ok("penolakan yang berstatus setuju ditolak",
  !consentSchema.safeParse({
    visit_id: k1.visitId, jenis: "penolakan", judul: "Penolakan Tindakan",
    isi: "Saya menolak dilakukannya tindakan tersebut dan menerima akibatnya.",
    penandatangan: "Budi Santoso", status: "setuju",
  }).success);
ok("isi terlalu pendek untuk ditandatangani ditolak",
  !consentSchema.safeParse({
    visit_id: k1.visitId, jenis: "umum", judul: "Umum", isi: "setuju",
    penandatangan: "Budi Santoso",
  }).success);

const idTindakan = await simpanConsent(
  consentSchema.parse({
    visit_id: k1.visitId, jenis: "tindakan", judul: "Persetujuan Tindakan Kedokteran",
    isi: "Setelah mendapat penjelasan mengenai risiko dan alternatifnya, saya menyetujui tindakan insisi abses.",
    procedure_id: tindakan, penjelasan_oleh: dokter,
    penandatangan: "Ibu Pasien", hubungan: "Ibu", saksi_nama: "Perawat Kepatuhan",
  }),
  site, dokter,
);
ok("persetujuan tindakan lengkap tersimpan", idTindakan > 0);

const daftarC = await consentKunjungan(k1.visitId);
ok("kedua persetujuan terbaca di kunjungannya", daftarC.length === 2);
ok("nama tindakan ikut terbaca",
  daftarC.some((c) => c.tindakan_nama === "Insisi Abses"));
ok("penandatangan bukan pasien tercatat beserta hubungannya",
  daftarC.some((c) => c.penandatangan === "Ibu Pasien" && c.hubungan === "Ibu"));
ok("pemberi penjelasan tercatat",
  daftarC.some((c) => c.pemberi_penjelasan === "dr. Kepatuhan"));

await batalkanConsent(idUmum, site, "Pasien menarik persetujuannya");
const setelahBatal = await consentKunjungan(k1.visitId);
ok("persetujuan dibatalkan, TIDAK dihapus", setelahBatal.length === 2);
ok("statusnya berubah beserta alasannya",
  setelahBatal.some(
    (c) => Number(c.id) === idUmum && c.status === "dibatalkan" &&
      c.alasan_batal === "Pasien menarik persetujuannya",
  ));

let tolakBatalUlang = "";
try {
  await batalkanConsent(idUmum, site, "lagi");
} catch (e) {
  tolakBatalUlang = e instanceof Error ? e.message : String(e);
}
ok("pembatalan ganda ditolak", tolakBatalUlang !== "", tolakBatalUlang);

const kBatal = await buatKunjungan({ status: "batal" });
let tolakVisitBatal = "";
try {
  await simpanConsent(
    consentSchema.parse({
      visit_id: kBatal.visitId, jenis: "umum", judul: "Umum",
      isi: "Saya bersedia menjalani pemeriksaan dan pengobatan sesuai kebutuhan medis saya.",
      penandatangan: "Budi Santoso",
    }),
    site, perawat,
  );
} catch (e) {
  tolakVisitBatal = e instanceof Error ? e.message : String(e);
}
ok("persetujuan pada kunjungan batal ditolak",
  /kunjungan ini sudah dibatalkan/i.test(tolakVisitBatal),
  tolakVisitBatal || "DITERIMA");

// =====================================================================
// 2. Insiden Keselamatan Pasien
// =====================================================================
console.log("\n== 2. Insiden keselamatan pasien ==");

ok("kronologi satu baris ditolak",
  !ikpSchema.safeParse({
    tanggal: hariIni, lokasi: "Apotek", jenis: "knc", kronologi: "pasien jatuh",
  }).success);

const ikpKnc = await laporkanIkp(
  ikpSchema.parse({
    visit_id: k1.visitId, tanggal: hariIni, waktu: "10:30", lokasi: "Apotek",
    jenis: "knc",
    kronologi:
      "Obat untuk pasien A hampir diserahkan kepada pasien B karena nama depannya sama. " +
      "Ketidaksesuaian diketahui saat petugas mencocokkan tanggal lahir sebelum menyerahkan.",
    tindakan_segera: "Penyerahan dihentikan, identitas dicocokkan ulang.",
  }),
  site, apoteker,
);
ok("nomor IKP berpola", /\/IKP\/\d{6}\/\d{4}$/.test(ikpKnc.noIkp), ikpKnc.noIkp);

const barisKnc = await getIkp(ikpKnc.id, site);
ok("pasien ikut tertaut lewat kunjungannya", barisKnc?.pasien !== null);
ok("pelapor tercatat", barisKnc?.pelapor === "apt. Kepatuhan");
ok("status awal 'baru'", barisKnc?.status === "baru");
ok("belum digrading saat dilaporkan", barisKnc?.grading === null);

// --- pelaporan anonim ---
const ikpAnonim = await laporkanIkp(
  ikpSchema.parse({
    tanggal: hariIni, lokasi: "Ruang Tindakan", jenis: "ktd", anonim: true,
    kronologi:
      "Pasien terjatuh dari brankar saat dipindahkan karena pengaman sisi tidak terpasang. " +
      "Pasien mengalami lecet pada lengan kanan dan sudah dibersihkan.",
  }),
  site, perawat,
);
const barisAnonim = await getIkp(ikpAnonim.id, site);
ok("pelaporan anonim TIDAK menyimpan pelapornya",
  barisAnonim?.pelapor === null, String(barisAnonim?.pelapor));

const idPelapor = await queryOne<RowDataPacket & { pelapor_id: number | null }>(
  `SELECT pelapor_id FROM patient_safety_incidents WHERE id = ?`, [ikpAnonim.id],
);
ok("dan kolomnya benar-benar NULL di database, bukan disembunyikan di layar",
  idPelapor?.pelapor_id === null);

// KTD memicu notifikasi ke Admin Cabang; KNC tidak.
const notif = await query<RowDataPacket & { jenis: string; judul: string }>(
  `SELECT jenis, judul FROM notifications WHERE site_id = ? AND jenis = 'ikp_baru'`,
  [site],
);
ok("KTD memicu notifikasi ke Admin Cabang", notif.length === 1, `${notif.length} notifikasi`);
ok("dan KNC tidak ikut memicunya",
  !notif.some((n) => n.judul.includes(ikpKnc.noIkp)));

// --- tindak lanjut & penjaga RCA ---
ok("grading kuning tanpa RCA tidak boleh ditutup (schema)",
  !tindakLanjutIkpSchema.safeParse({
    grading: "kuning", status: "ditutup", analisis: "",
  }).success);
ok("grading hijau boleh ditutup tanpa RCA",
  tindakLanjutIkpSchema.safeParse({ grading: "hijau", status: "ditutup" }).success);

await tindakLanjutIkp(
  ikpAnonim.id, site,
  tindakLanjutIkpSchema.parse({ grading: "kuning", status: "investigasi" }),
  admin,
);
const setelahGrading = await getIkp(ikpAnonim.id, site);
ok("grading tersimpan", setelahGrading?.grading === "kuning");
ok("belum ditutup", setelahGrading?.status === "investigasi");

await tindakLanjutIkp(
  ikpAnonim.id, site,
  tindakLanjutIkpSchema.parse({
    grading: "kuning", status: "ditutup",
    analisis: "Prosedur pemindahan pasien tidak mencantumkan pemeriksaan pengaman brankar.",
    rekomendasi: "Tambahkan langkah verifikasi pengaman pada SPO pemindahan pasien.",
  }),
  admin,
);
const ditutup = await getIkp(ikpAnonim.id, site);
ok("laporan bisa ditutup setelah RCA ada", ditutup?.status === "ditutup");
ok("penutup tercatat", ditutup?.ditutup_oleh === "Admin Kepatuhan");

let tolakUbahTutup = "";
try {
  await tindakLanjutIkp(
    ikpAnonim.id, site,
    tindakLanjutIkpSchema.parse({ grading: "biru", status: "investigasi" }),
    admin,
  );
} catch (e) {
  tolakUbahTutup = e instanceof Error ? e.message : String(e);
}
ok("laporan yang sudah ditutup tidak bisa diubah",
  /sudah ditutup/i.test(tolakUbahTutup), tolakUbahTutup || "DITERIMA");

const rekap = await rekapIkp(site, hariIni, hariIni);
ok("rekap menghitung total", rekap.total === 2);
ok("rekap memisahkan per jenis", rekap.perJenis.knc === 1 && rekap.perJenis.ktd === 1);
ok("insiden belum digrading terhitung", rekap.belumDigrading === 1, String(rekap.belumDigrading));
ok("tanpaRca nol karena yang kuning sudah dianalisis", rekap.tanpaRca === 0);
ok("yang masih terbuka terhitung", rekap.terbuka === 1);

ok("daftar IKP tersaring per cabang",
  (await daftarIkp(site, { dari: hariIni, sampai: hariIni })).length === 2);

// =====================================================================
// 3. SIPNAP
// =====================================================================
console.log("\n== 3. SIPNAP narkotika & psikotropika ==");

const nark = (await execute(
  `INSERT INTO items (kode, nama, tipe, satuan_dasar, hpp, harga_jual,
                      is_narkotika, golongan_narkotika, no_izin_edar)
   VALUES ('${TANDA}-N', 'Kodein 10mg', 'obat', 'tablet', 1000, 2500, 1, 'III', 'DKL1234567890A1')`,
)).insertId;
const psiko = (await execute(
  `INSERT INTO items (kode, nama, tipe, satuan_dasar, hpp, harga_jual, is_psikotropika)
   VALUES ('${TANDA}-P', 'Diazepam 2mg', 'obat', 'tablet', 800, 2000, 1)`,
)).insertId;
const biasa = (await execute(
  `INSERT INTO items (kode, nama, tipe, satuan_dasar, hpp, harga_jual)
   VALUES ('${TANDA}-B', 'Parasetamol 500mg', 'obat', 'tablet', 200, 500)`,
)).insertId;

await transaction(async (conn) => {
  await tambahStok(conn, {
    siteId: site, itemId: nark, qty: 100, jenis: "masuk_pembelian",
    refType: "purchase", userId: apoteker,
  });
  await tambahStok(conn, {
    siteId: site, itemId: psiko, qty: 50, jenis: "masuk_pembelian",
    refType: "purchase", userId: apoteker,
  });
  await tambahStok(conn, {
    siteId: site, itemId: biasa, qty: 500, jenis: "masuk_pembelian",
    refType: "purchase", userId: apoteker,
  });
});
await transaction(async (conn) => {
  await kurangiStok(conn, {
    siteId: site, itemId: nark, qty: 12, jenis: "keluar_resep",
    refType: "prescription_item", userId: apoteker,
  });
});

const sipnap = await rekapSipnap(site, hariIni, hariIni);
ok("hanya narkotika & psikotropika yang dilaporkan", sipnap.length === 2,
  `${sipnap.length} item`);
ok("obat biasa tidak ikut", !sipnap.some((b) => Number(b.item_id) === biasa));

const barisNark = sipnap.find((b) => Number(b.item_id) === nark)!;
ok("golongan terbaca", barisNark.golongan === "narkotika" && barisNark.golongan_narkotika === "III");
ok("pemasukan terhitung", Number(barisNark.masuk) === 100, String(barisNark.masuk));
ok("pengeluaran terhitung", Number(barisNark.keluar) === 12, String(barisNark.keluar));
ok("saldo akhir = masuk − keluar", Number(barisNark.saldo_akhir) === 88,
  String(barisNark.saldo_akhir));

/*
 * INTI bagian ini. Saldo hasil hitungan pergerakan HARUS sama dengan saldo
 * yang tercatat di gudang. Kalau berbeda, ada pergerakan yang tidak masuk
 * kartu stok — dan pada narkotika itu temuan pemeriksaan, bukan pembulatan.
 */
ok("saldo hitungan cocok dengan saldo gudang",
  Number(barisNark.saldo_akhir) === Number(barisNark.saldo_sistem),
  `${barisNark.saldo_akhir} vs ${barisNark.saldo_sistem}`);

const siap = await kesiapanSipnap(site, hariIni, hariIni);
ok("kesiapan: tidak ada selisih", siap.selisih === 0);
ok("kesiapan: 1 narkotika & 1 psikotropika",
  siap.narkotika === 1 && siap.psikotropika === 1);
ok("psikotropika tanpa NIE terdeteksi", siap.tanpaIzinEdar >= 1,
  String(siap.tanpaIzinEdar));

const register = await registerSipnap(site, nark, hariIni, hariIni);
ok("register memuat setiap pergerakan", register.length === 2, `${register.length} baris`);
ok("register menyebut petugasnya", register.every((r) => r.petugas === "apt. Kepatuhan"));

// =====================================================================
// 4. LB1 morbiditas
// =====================================================================
console.log("\n== 4. LB1 morbiditas ==");

const icd = await query<RowDataPacket & { code: string }>(
  `SELECT code FROM icd10_codes WHERE is_active = 1 ORDER BY code LIMIT 2`,
);
if (icd.length < 2) {
  ok("data ICD-10 tersedia untuk uji", false, "seed ICD-10 kosong");
} else {
  const kLb1 = await buatKunjungan({ status: "selesai", baru: true });
  const asesmen = (await execute(
    `INSERT INTO medical_assessments (visit_id, site_id, doctor_id, status)
     VALUES (?,?,?, 'final')`,
    [kLb1.visitId, site, dokter],
  )).insertId;
  await execute(
    `INSERT INTO assessment_diagnoses (assessment_id, icd10_code, tipe) VALUES (?,?, 'primer')`,
    [asesmen, icd[0].code],
  );
  // Diagnosa BANDING — tidak boleh masuk laporan morbiditas.
  await execute(
    `INSERT INTO assessment_diagnoses (assessment_id, icd10_code, tipe) VALUES (?,?, 'banding')`,
    [asesmen, icd[1].code],
  );

  // Asesmen yang masih draf: tidak dilaporkan, tetapi harus terhitung
  // sebagai kunjungan yang belum terekam.
  const kDraf = await buatKunjungan({ status: "selesai" });
  const asDraf = (await execute(
    `INSERT INTO medical_assessments (visit_id, site_id, doctor_id, status)
     VALUES (?,?,?, 'draft')`,
    [kDraf.visitId, site, dokter],
  )).insertId;
  await execute(
    `INSERT INTO assessment_diagnoses (assessment_id, icd10_code, tipe) VALUES (?,?, 'primer')`,
    [asDraf, icd[0].code],
  );

  const lb1 = await lb1Morbiditas(site, hariIni, hariIni);
  ok("hanya diagnosa ditegakkan yang dilaporkan", lb1.length === 1,
    `${lb1.length} kode`);
  ok("diagnosa banding TIDAK ikut",
    !lb1.some((b) => b.code === icd[1].code));
  ok("asesmen draf tidak ikut", Number(lb1[0].total) === 1, String(lb1[0].total));
  ok("dipecah per jenis kelamin & status kunjungan",
    Number(lb1[0].baru_l) + Number(lb1[0].baru_p) +
      Number(lb1[0].lama_l) + Number(lb1[0].lama_p) === Number(lb1[0].total));

  const siapLb1 = await kesiapanLb1(site, hariIni, hariIni);
  ok("kunjungan tanpa asesmen final terhitung sebagai belum terekam",
    siapLb1.tanpaAsesmenFinal >= 1, String(siapLb1.tanpaAsesmenFinal));
  ok("total kasus cocok dengan barisnya", siapLb1.totalKasus === 1);
  ok("kunjungan batal tidak dihitung",
    siapLb1.kunjungan === (await query(
      `SELECT id FROM visits WHERE site_id = ? AND tanggal = ? AND status <> 'batal'`,
      [site, hariIni],
    )).length);
}

// =====================================================================
await bersih();
console.log(gagal === 0 ? "\nSEMUA UJI LULUS\n" : `\n${gagal} UJI GAGAL\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
