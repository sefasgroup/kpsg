/**
 * Uji modul dokter (surat keterangan, riwayat pasien) dan Admin Cabang
 * (laporan, profil cabang).
 *
 * Seperti uji-inventori.ts, ini mengimpor fungsi aslinya — bukan menyalin
 * ulang SQL-nya.
 *
 *   node uji/jalankan.mjs uji-dokumen.ts
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne } from "../src/lib/db";
import { daftarSurat, kunjunganUntukSurat, terbitkanSurat } from "../src/lib/dokumen";
import { suratSchema } from "../src/lib/validations/dokumen";
import { asesmenSchema } from "../src/lib/validations/doctor";
import { dokterPemeriksa, getAsesmen, simpanAsesmen } from "../src/lib/doctor";
import { detailRekamMedis } from "../src/lib/rekam-medis";
import { alergiPasien, riwayatKunjungan, ringkasanPasien } from "../src/lib/riwayat";
import {
  diagnosaTeratas, getProfilCabang, produktivitasDokter,
  ringkasanCabang, simpanProfilCabang, statistikCabang,
} from "../src/lib/laporan";
import { tanggalHariIni } from "../src/lib/tanggal";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

const hariIni = tanggalHariIni();
const TANDA = "UJIDOK";

// =====================================================================
// Persiapan
// =====================================================================
async function bersih() {
  const sites = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM sites WHERE kode LIKE '${TANDA}%'`)
  ).map((r) => r.id);

  if (sites.length) {
    const s = sites.join(",");
    await execute(`DELETE FROM billing_items WHERE billing_id IN (SELECT id FROM billing_transactions WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM billing_transactions WHERE site_id IN (${s})`);
    await execute(`DELETE FROM medical_certificates WHERE site_id IN (${s})`);
    await execute(`DELETE FROM assessment_diagnoses WHERE assessment_id IN (SELECT id FROM medical_assessments WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM medical_assessments WHERE site_id IN (${s})`);
    await execute(`DELETE FROM queues WHERE site_id IN (${s})`);
    await execute(`DELETE FROM visits WHERE site_id IN (${s})`);
    await execute(`DELETE FROM patient_allergies WHERE patient_id IN (SELECT id FROM patients WHERE site_id IN (${s}))`);
    await execute(`DELETE FROM patients WHERE site_id IN (${s})`);
    await execute(`DELETE FROM doctor_profiles WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${TANDA}%')`);
    await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
    await execute(`DELETE FROM polis WHERE site_id IN (${s})`);
    await execute(`DELETE FROM sequences WHERE site_id IN (${s})`);
    await execute(`DELETE FROM sites WHERE id IN (${s})`);
  } else {
    await execute(`DELETE FROM doctor_profiles WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${TANDA}%')`);
    await execute(`DELETE FROM users WHERE username LIKE '${TANDA}%'`);
  }
  await execute(`DELETE FROM icd10_codes WHERE code LIKE '${TANDA}%'`);
}
await bersih();

const siteA = (await execute(`INSERT INTO sites (kode, nama, alamat) VALUES ('${TANDA}-A', 'Uji Cabang A', 'Jl. Uji No. 1, Bandung')`)).insertId;
const siteB = (await execute(`INSERT INTO sites (kode, nama) VALUES ('${TANDA}-B', 'Uji Cabang B')`)).insertId;

const roleDokter = Number((await queryOne<RowDataPacket & { id: number }>(`SELECT id FROM roles WHERE code='dokter'`))!.id);
const roleAdmin = Number((await queryOne<RowDataPacket & { id: number }>(`SELECT id FROM roles WHERE code='admin_cabang'`))!.id);

async function buatUser(username: string, nama: string, roleId: number, siteId: number) {
  return (
    await execute(
      `INSERT INTO users (site_id, role_id, nama, username, password_hash) VALUES (?,?,?,?,'x')`,
      [siteId, roleId, nama, username],
    )
  ).insertId;
}

const drA = await buatUser(`${TANDA}dra`, "Rafi Uji", roleDokter, siteA);
const drB = await buatUser(`${TANDA}drb`, "Sinta Uji", roleDokter, siteA);
await buatUser(`${TANDA}adm`, "Admin Uji", roleAdmin, siteA);
await execute(
  `INSERT INTO doctor_profiles (user_id, no_sip, gelar_depan) VALUES (?, 'SIP-UJI-001', 'dr.')`,
  [drA],
);

const poliA = (await execute(`INSERT INTO polis (site_id, kode, nama, prefix_antrean) VALUES (?, 'UJIU', 'Poli Uji', 'U')`, [siteA])).insertId;
const poliB = (await execute(`INSERT INTO polis (site_id, kode, nama, prefix_antrean) VALUES (?, 'UJIV', 'Poli Uji B', 'V')`, [siteB])).insertId;

const pasien = (
  await execute(
    `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin, alamat, pekerjaan, created_by)
     VALUES (?, '${TANDA}-000001', '3273010101900001', 'Pasien Uji Dokumen', '1990-01-01', 'L', 'Jl. Pasien No. 9', 'Karyawan Swasta', ?)`,
    [siteA, drA],
  )
).insertId;

await execute(
  `INSERT INTO patient_allergies (patient_id, jenis, nama_alergen, reaksi, keparahan, recorded_by)
   VALUES (?, 'obat', 'Amoksisilin', 'Ruam seluruh badan', 'berat', ?)`,
  [pasien, drA],
);

async function buatVisit(opts: {
  site: number; poli: number; dokter: number; sub?: number | null;
  tanggal?: string; status?: string; no: string; baru?: boolean;
}) {
  return (
    await execute(
      `INSERT INTO visits (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
                           substitute_doctor_id, jenis_kunjungan, status, registered_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        opts.site, pasien, opts.no, opts.tanggal ?? hariIni, opts.poli, opts.dokter,
        opts.sub ?? null, opts.baru ? "baru" : "lama", opts.status ?? "selesai", opts.dokter,
      ],
    )
  ).insertId;
}

const vSelesai = await buatVisit({ site: siteA, poli: poliA, dokter: drA, no: `${TANDA}/V/1`, baru: true });
const vBatal = await buatVisit({ site: siteA, poli: poliA, dokter: drA, no: `${TANDA}/V/2`, status: "batal" });
const vPengganti = await buatVisit({ site: siteA, poli: poliA, dokter: drB, sub: drA, no: `${TANDA}/V/3` });
const vCabangLain = await buatVisit({ site: siteB, poli: poliB, dokter: drB, no: `${TANDA}/V/4` });

// Asesmen + diagnosa untuk kunjungan pertama.
const asesmen = (
  await execute(
    `INSERT INTO medical_assessments (visit_id, site_id, doctor_id, subjective, objective, assessment, plan, status, finalized_at)
     VALUES (?,?,?, 'Batuk 3 hari', 'Faring hiperemis', 'ISPA', 'Simptomatik', 'final', NOW())`,
    [vSelesai, siteA, drA],
  )
).insertId;

/*
 * Kode ICD dibuat sendiri, bukan dipinjam dari seed. Uji yang bergantung pada
 * data contoh berhenti bekerja tepat ketika paling dibutuhkan: setelah basis
 * data dikosongkan untuk go-live.
 */
for (const [code, nama] of [
  [`${TANDA}00.0`, "Uji Diagnosa Primer"],
  [`${TANDA}01.0`, "Uji Diagnosa Sekunder"],
]) {
  await execute(
    `INSERT INTO icd10_codes (code, nama_id) VALUES (?,?)
     ON DUPLICATE KEY UPDATE nama_id = VALUES(nama_id)`,
    [code, nama],
  );
}
const icd = await query<RowDataPacket & { code: string }>(
  `SELECT code FROM icd10_codes WHERE code LIKE '${TANDA}%' ORDER BY code LIMIT 2`,
);
await execute(
  `INSERT INTO assessment_diagnoses (assessment_id, icd10_code, tipe) VALUES (?,?, 'primer')`,
  [asesmen, icd[0].code],
);

const asesmen2 = (
  await execute(
    `INSERT INTO medical_assessments (visit_id, site_id, doctor_id, subjective, status)
     VALUES (?,?,?, 'Kontrol', 'draft')`,
    [vPengganti, siteA, drA],
  )
).insertId;
await execute(
  `INSERT INTO assessment_diagnoses (assessment_id, icd10_code, tipe) VALUES (?,?, 'primer')`,
  [asesmen2, icd[0].code],
);

// Tagihan: satu lunas, satu masih menunggu.
async function buatTagihan(visitId: number, total: number, status: string, metode: string | null) {
  const id = (
    await execute(
      `INSERT INTO billing_transactions (site_id, visit_id, no_invoice, subtotal, total, dibayar, payment_method, status, paid_at)
       VALUES (?,?,?,?,?,?,?,?, ${status === "lunas" ? "NOW()" : "NULL"})`,
      [siteA, visitId, `${TANDA}/INV/${visitId}`, total, total, status === "lunas" ? total : 0, metode, status],
    )
  ).insertId;
  await execute(
    `INSERT INTO billing_items (billing_id, kategori, deskripsi, qty, harga_satuan, subtotal)
     VALUES (?, 'jasa_dokter', 'Konsultasi', 1, ?, ?)`,
    [id, total * 0.4, total * 0.4],
  );
  await execute(
    `INSERT INTO billing_items (billing_id, kategori, deskripsi, qty, harga_satuan, subtotal)
     VALUES (?, 'jasa_racik', 'Jasa racik', 1, ?, ?)`,
    [id, total * 0.6, total * 0.6],
  );
  return id;
}
await buatTagihan(vSelesai, 100000, "lunas", "tunai");
await buatTagihan(vPengganti, 50000, "menunggu", null);

/*
 * Kunjungan yang MASIH BERJALAN, dengan tagihan `draft`.
 *
 * Inilah keadaan setiap pasien yang sedang duduk di ruang periksa:
 * tagihannya sudah ada dan sudah berisi konsultasi, tetapi angkanya belum
 * final dan belum boleh disebut piutang. Memakai pasien terpisah supaya
 * pemeriksaan riwayat pasien pertama tidak ikut berubah.
 */
const pasienDilayani = (await execute(
  `INSERT INTO patients (site_id, no_rm, nik, nama, tanggal_lahir, jenis_kelamin)
   VALUES (?,?,?,?, '1995-05-05', 'P')`,
  [siteA, `${TANDA}-RM2`, "3273770000091234", "Pasien Sedang Dilayani"],
)).insertId;

const vDilayani = (await execute(
  `INSERT INTO visits (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
                       jenis_kunjungan, status, registered_by)
   VALUES (?,?,?,?,?,?, 'lama', 'dalam_pemeriksaan', ?)`,
  [siteA, pasienDilayani, `${TANDA}/V/5`, hariIni, poliA, drA, drA],
)).insertId;

await buatTagihan(vDilayani, 30000, "draft", null);

// =====================================================================
console.log("\n== 1. Surat keterangan ==");
// =====================================================================

const s1 = await terbitkanSurat(
  suratSchema.parse({
    visit_id: vSelesai, jenis: "sakit", mulai: hariIni, lama_hari: 3,
    diagnosa_ditulis: "ISPA",
  }),
  siteA, drA,
);
ok("surat sakit terbit", Boolean(s1.id));
ok("nomor surat berpola KODE/SKET/YYYYMM/NNNN", /^UJIDOK-A\/SKET\/\d{6}\/\d{4}$/.test(s1.no_surat), s1.no_surat);

const s2 = await terbitkanSurat(
  suratSchema.parse({ visit_id: vSelesai, jenis: "sehat", keperluan: "Melamar kerja", tinggi_badan: 170, berat_badan: 65 }),
  siteA, drA,
);
ok("nomor surat berurut dan tidak kembar", s2.no_surat !== s1.no_surat, `${s1.no_surat} → ${s2.no_surat}`);

const tersimpan = await daftarSurat(siteA, { doctorId: drA });
const suratSakit = tersimpan.find((t) => t.id === s1.id)!;
const suratSehat = tersimpan.find((t) => t.id === s2.id)!;
ok("isi surat sakit memuat lama istirahat", Number(suratSakit.data.lama_hari) === 3);
ok(
  "isi surat sakit TIDAK memuat field jenis lain",
  !("keperluan" in suratSakit.data) && !("tujuan_faskes" in suratSakit.data),
  "sisa isian jenis lain tidak ikut tersimpan",
);
ok("isi surat sehat memuat keperluan & antropometri", suratSehat.data.keperluan === "Melamar kerja" && Number(suratSehat.data.tinggi_badan) === 170);
ok("data pasien & SIP dokter ikut terbaca untuk kop", suratSakit.no_sip === "SIP-UJI-001" && suratSakit.nama === "Pasien Uji Dokumen");

// --- Wewenang ---
let pesanBukanDokternya = "";
try {
  await terbitkanSurat(
    suratSchema.parse({ visit_id: vSelesai, jenis: "sehat", keperluan: "Uji" }),
    siteA, drB,
  );
} catch (e) { pesanBukanDokternya = (e as Error).message; }
ok("dokter lain tidak boleh menerbitkan surat", pesanBukanDokternya.includes("dokter yang menangani"), pesanBukanDokternya);

const s3 = await terbitkanSurat(
  suratSchema.parse({ visit_id: vPengganti, jenis: "sehat", keperluan: "Uji pengganti" }),
  siteA, drA,
);
ok("dokter PENGGANTI boleh menerbitkan surat", Boolean(s3.id), "ia yang benar-benar memeriksa");

let pesanBatal = "";
try {
  await terbitkanSurat(
    suratSchema.parse({ visit_id: vBatal, jenis: "sehat", keperluan: "Uji" }),
    siteA, drA,
  );
} catch (e) { pesanBatal = (e as Error).message; }
ok("kunjungan batal tidak bisa diterbitkan suratnya", pesanBatal.includes("dibatalkan"), pesanBatal);

let pesanSalahCabang = "";
try {
  await terbitkanSurat(
    suratSchema.parse({ visit_id: vCabangLain, jenis: "sehat", keperluan: "Uji" }),
    siteA, drA,
  );
} catch (e) { pesanSalahCabang = (e as Error).message; }
ok("kunjungan cabang lain ditolak", pesanSalahCabang.includes("tidak ditemukan di cabang ini"), pesanSalahCabang);

// --- Validasi per jenis ---
ok("surat sakit tanpa lama istirahat ditolak", !suratSchema.safeParse({ visit_id: 1, jenis: "sakit", mulai: hariIni }).success);
ok("surat sakit tanpa tanggal mulai ditolak", !suratSchema.safeParse({ visit_id: 1, jenis: "sakit", lama_hari: 2 }).success);
ok("surat sehat tanpa keperluan ditolak", !suratSchema.safeParse({ visit_id: 1, jenis: "sehat" }).success);
ok("rujukan tanpa faskes tujuan ditolak", !suratSchema.safeParse({ visit_id: 1, jenis: "rujukan", alasan_rujukan: "Perlu spesialis" }).success);
ok("rujukan tanpa alasan ditolak", !suratSchema.safeParse({ visit_id: 1, jenis: "rujukan", tujuan_faskes: "RSUD" }).success);
ok("keterangan lain tanpa isi ditolak", !suratSchema.safeParse({ visit_id: 1, jenis: "keterangan_lain", perihal: "Hal" }).success);
ok("lama istirahat > 30 hari ditolak", !suratSchema.safeParse({ visit_id: 1, jenis: "sakit", mulai: hariIni, lama_hari: 60 }).success);

// --- Daftar kunjungan yang boleh disurati ---
const kunjunganDrA = await kunjunganUntukSurat(drA, siteA, {});
const idDrA = kunjunganDrA.map((k) => k.id);
ok("kunjungan sendiri muncul di daftar", idDrA.includes(vSelesai));
ok("kunjungan sebagai pengganti ikut muncul", idDrA.includes(vPengganti));
ok("kunjungan batal tidak muncul", !idDrA.includes(vBatal));
ok("kunjungan cabang lain tidak muncul", !idDrA.includes(vCabangLain));
ok("jumlah surat per kunjungan terhitung", Number(kunjunganDrA.find((k) => k.id === vSelesai)!.jumlah_surat) === 2);

const kunjunganDrB = await kunjunganUntukSurat(drB, siteA, {});
ok(
  "dokter terjadwal tetap melihat kunjungan yang digantikan",
  kunjunganDrB.some((k) => k.id === vPengganti),
  "keduanya berhak: dr. B terjadwal, dr. A yang memeriksa",
);
ok(
  "dokter lain tidak melihat kunjungan yang bukan miliknya",
  !kunjunganDrB.some((k) => k.id === vSelesai),
  "vSelesai murni ditangani dr. A",
);

// =====================================================================
console.log("\n== 2. Riwayat pasien ==");
// =====================================================================

const ring = await ringkasanPasien(pasien);
ok("ringkasan pasien terbaca", ring?.nama === "Pasien Uji Dokumen");
ok("kunjungan batal tidak dihitung", Number(ring?.jumlah_kunjungan) === 3, `${ring?.jumlah_kunjungan} dari 4 kunjungan (1 batal)`);
ok("alergi ikut di ringkasan", (ring?.alergi ?? "").includes("Amoksisilin"));

const alergi = await alergiPasien(pasien);
ok("alergi berat tampil dengan keparahannya", alergi[0]?.keparahan === "berat");

const riwayat = await riwayatKunjungan(pasien);
ok("riwayat memuat seluruh kunjungan non-batal", riwayat.length === 3);
ok("riwayat LINTAS CABANG", riwayat.some((r) => r.id === vCabangLain), "pasien yang sama di cabang lain tetap terlihat");
ok("kunjungan batal tidak masuk riwayat", !riwayat.some((r) => r.id === vBatal));
ok("SOAP terbaca", riwayat.find((r) => r.id === vSelesai)?.subjective === "Batuk 3 hari");
ok("diagnosa ICD-10 terbaca", (riwayat.find((r) => r.id === vSelesai)?.diagnosa ?? "").includes(icd[0].code));
ok("dokter pengganti tercatat di riwayat", riwayat.find((r) => r.id === vPengganti)?.dokter_pengganti === "Rafi Uji");
ok("riwayat terurut terbaru dahulu", riwayat[0].tanggal >= riwayat[riwayat.length - 1].tanggal);

// =====================================================================
console.log("\n== 3. Laporan cabang ==");
// =====================================================================

const lap = await ringkasanCabang(siteA, hariIni, hariIni);
ok("kunjungan cabang terhitung", lap.kunjungan === 4, `${lap.kunjungan} (termasuk yang batal)`);
ok("kunjungan batal dilaporkan terpisah", lap.batal === 1);
ok("pasien baru terhitung", lap.pasienBaru === 1);
ok(
  "pendapatan hanya dari transaksi LUNAS",
  lap.pendapatan === 100000,
  "tagihan 50.000 yang masih menunggu tidak ikut",
);
/*
 * Dua angka, bukan satu.
 *
 * Sebelumnya `draft` dan `menunggu` dijumlahkan jadi satu "Belum Dibayar".
 * Dengan itu, tagihan Rp 30.000 milik pasien yang masih diperiksa ikut
 * terbaca sebagai piutang — angka piutang naik setiap kali seorang pasien
 * masuk ruang periksa, lalu turun lagi begitu ia membayar, tanpa satu
 * rupiah pun pernah tertunggak.
 */
ok("hanya tagihan MENUNGGU yang dihitung sebagai siap ditagih",
  lap.menungguKasir === 1 && lap.nilaiMenungguKasir === 50000,
  `${lap.menungguKasir} tagihan / ${lap.nilaiMenungguKasir}`);
ok("tagihan DRAFT dilaporkan terpisah, bukan dibuang",
  lap.dalamPelayanan === 1 && lap.nilaiDalamPelayanan === 30000,
  `${lap.dalamPelayanan} tagihan / ${lap.nilaiDalamPelayanan}`);
ok("keduanya tidak saling tercampur",
  lap.nilaiMenungguKasir !== lap.nilaiDalamPelayanan &&
    lap.nilaiMenungguKasir + lap.nilaiDalamPelayanan === 80000);
ok("tagihan draft tetap tidak dianggap pendapatan", lap.pendapatan === 100000);
ok("rata-rata per transaksi benar", lap.rataPerKunjungan === 100000);

const lapB = await ringkasanCabang(siteB, hariIni, hariIni);
ok("laporan tersaring per cabang", lapB.kunjungan === 1 && lapB.pendapatan === 0, "cabang B punya 1 kunjungan tanpa tagihan");

const prod = await produktivitasDokter(siteA, hariIni, hariIni);
const barisA = prod.find((p) => p.doctor_id === drA);
const barisB = prod.find((p) => p.doctor_id === drB);
ok(
  "kunjungan dengan pengganti dihitung ke PENGGANTI",
  Number(barisA?.kunjungan) === 3 && barisB === undefined,
  "dr. A menangani 3 (2 miliknya + 1 sebagai pengganti); dr. B tidak melayani satu pun",
);
ok("jumlah sebagai pengganti terhitung", Number(barisA?.sebagai_pengganti) === 1);
ok("asesmen draft tidak dihitung sebagai final", Number(barisA?.asesmen_final) === 1, "ada 2 asesmen, 1 masih draft");
ok("pendapatan dokter hanya dari yang lunas", Number(barisA?.pendapatan) === 100000);

const dx = await diagnosaTeratas(siteA, hariIni, hariIni);
ok("diagnosa teratas terhitung", dx[0]?.code === icd[0].code && Number(dx[0].jumlah) === 2);

// =====================================================================
console.log("\n== 4. Profil cabang ==");
// =====================================================================

const sebelum = await getProfilCabang(siteA);
await simpanProfilCabang(siteA, {
  nama: "Uji Cabang A Diperbarui",
  nama_legal: "PT Uji Sejahtera",
  no_izin_klinik: "440/UJI/2026",
  alamat: "Jl. Uji No. 2",
  kota: "Bandung",
  telepon: "022-1234567",
  email: "uji@contoh.id",
});
const sesudah = await getProfilCabang(siteA);
ok("nama & identitas cabang tersimpan", sesudah?.nama === "Uji Cabang A Diperbarui" && sesudah?.no_izin_klinik === "440/UJI/2026");
ok(
  "kode cabang TIDAK ikut berubah",
  sesudah?.kode === sebelum?.kode,
  `tetap ${sesudah?.kode} — kode melekat pada seluruh nomor dokumen yang sudah terbit`,
);
ok("field yang tidak dikirim dikosongkan, bukan disisakan", sesudah?.provinsi === null, "form mengirim seluruh field sekaligus");

const stat = await statistikCabang(siteA);
ok("statistik pengguna cabang terhitung", Number(stat?.pengguna) === 3);
ok("statistik dokter terhitung", Number(stat?.dokter) === 2);
ok("statistik pasien terhitung", Number(stat?.pasien) === 2,
  "pasien tetap + pasien yang sedang dilayani");
ok("statistik kunjungan mencakup yang batal", Number(stat?.kunjungan) === 4);

// =====================================================================
// 5. Prognosis dihapus dari form dokter
// =====================================================================
console.log("\n== 5. Prognosis dihapus dari form dokter ==");

/*
 * Yang dihapus hanya isian di form; kolomnya tetap ada dan asesmen lama
 * tetap menyimpan isinya. Bahaya yang diuji di sini: kalau `simpanAsesmen`
 * masih menyebut kolom itu di ON DUPLICATE KEY UPDATE, setiap penyimpanan
 * ulang akan menimpa prognosis lama menjadi NULL — data hilang diam-diam
 * tanpa satu pun pesan error.
 */
ok(
  "prognosis tidak lagi diterima skema asesmen",
  !("prognosis" in asesmenSchema.parse({
    subjective: "x",
    prognosis: "Dubia ad bonam",
    diagnoses: [],
    procedures: [],
  })),
  "field asing dibuang oleh zod, bukan diteruskan ke SQL",
);

const vProg = await buatVisit({
  site: siteA, poli: poliA, dokter: drA,
  no: `${TANDA}/V/PROG`, status: "menunggu_dokter",
});

await execute(
  `INSERT INTO medical_assessments (visit_id, site_id, doctor_id, keluhan_utama, prognosis, status)
   VALUES (?,?,?, 'Catatan lama', 'Dubia ad bonam', 'draft')`,
  [vProg, siteA, drA],
);

/*
 * Pembuktian "asesmen tetap tersimpan" memakai `keluhan_utama`, bukan
 * `subjective`. Sejak Anamnesis Tambahan dihapus dari form, `subjective`
 * memang TIDAK lagi ditulis — memakainya di sini akan menguji kolom yang
 * sengaja dibekukan, bukan jalur simpan yang sebenarnya.
 */
await simpanAsesmen(vProg, siteA, drA, asesmenSchema.parse({
  keluhan_utama: "Catatan baru sesudah prognosis dihapus",
  assessment: "ISPA",
  diagnoses: [],
  procedures: [],
}));

const sesudahSimpan = await getAsesmen(vProg);
ok(
  "asesmen tetap tersimpan tanpa field prognosis",
  sesudahSimpan?.keluhan_utama === "Catatan baru sesudah prognosis dihapus",
  String(sesudahSimpan?.keluhan_utama),
);
ok(
  "prognosis LAMA tidak ikut terhapus saat asesmen disimpan ulang",
  sesudahSimpan?.prognosis === "Dubia ad bonam",
  String(sesudahSimpan?.prognosis),
);

// =====================================================================
// 6. Penanda tangan rekam medis kunjungan
// =====================================================================
console.log("\n== 6. Dokter penanda tangan rekam medis ==");

/*
 * Layar pemeriksaan boleh dibuka dokter mana pun di cabang yang sama, jadi
 * blok tanda tangan TIDAK boleh memakai pengguna yang sedang membuka layar.
 * Rekam medis adalah dokumen hukum: nama dan No. SIP di bawahnya adalah
 * pernyataan siapa yang bertanggung jawab atas isinya.
 */
const ttdSelesai = await dokterPemeriksa(vSelesai);
ok("memakai dokter dari asesmen", Number(ttdSelesai?.id) === drA, String(ttdSelesai?.nama));
ok("gelar ikut terbaca", ttdSelesai?.gelar_depan === "dr.", String(ttdSelesai?.gelar_depan));
ok("No. SIP ikut terbaca", ttdSelesai?.no_sip === "SIP-UJI-001", String(ttdSelesai?.no_sip));

/*
 * Kunjungan dr. B dengan pengganti dr. A, dan belum ada asesmen. Yang
 * menandatangani harus PENGGANTI — dialah yang benar-benar memeriksa.
 */
const ttdPengganti = await dokterPemeriksa(vPengganti);
ok(
  "tanpa asesmen, dokter PENGGANTI yang menandatangani",
  Number(ttdPengganti?.id) === drA,
  `${ttdPengganti?.nama} (terjadwal dr. B)`,
);

// Tanpa asesmen dan tanpa pengganti → jatuh ke dokter terjadwal.
const ttdBiasa = await dokterPemeriksa(vCabangLain);
ok("tanpa asesmen & tanpa pengganti, dokter terjadwal", Number(ttdBiasa?.id) === drB,
  String(ttdBiasa?.nama));
ok("dokter tanpa profil tetap terbaca dengan SIP kosong",
  ttdBiasa !== null && ttdBiasa.no_sip === null,
  "blok tanda tangan mencetak 'SIP: —', bukan gagal");

/*
 * Asesmen mengalahkan keduanya. Kunjungan terjadwal dr. B, pengganti dr. A,
 * tetapi yang menyimpan asesmen adalah dr. B sendiri — misalnya ia jadi
 * masuk. Yang menandatangani harus dr. B.
 */
const vTukar = await buatVisit({
  site: siteA, poli: poliA, dokter: drB, sub: drA, no: `${TANDA}/V/TTD`,
});
await execute(
  `INSERT INTO medical_assessments (visit_id, site_id, doctor_id, subjective, status)
   VALUES (?,?,?, 'Diperiksa dokter terjadwal', 'final')`,
  [vTukar, siteA, drB],
);
const ttdTukar = await dokterPemeriksa(vTukar);
ok(
  "asesmen mengalahkan pengganti — yang menandatangani adalah yang memeriksa",
  Number(ttdTukar?.id) === drB,
  `${ttdTukar?.nama} (pengganti terdaftar dr. A)`,
);

ok("kunjungan tidak dikenal mengembalikan null",
  (await dokterPemeriksa(999999999)) === null);

// =====================================================================
// 7. Rakitan rekam medis satu kunjungan
// =====================================================================
console.log("\n== 7. detailRekamMedis() ==");

const rm = await detailRekamMedis(vSelesai, "Petugas Uji");
ok("rekam medis kunjungan terakit", rm !== null);
ok("identitas pasien ikut", Boolean(rm?.pasien.nama) && Boolean(rm?.pasien.noRm),
  `${rm?.pasien.nama} · ${rm?.pasien.noRm}`);
ok("nomor kunjungan ikut", rm?.visit.noVisit === `${TANDA}/V/1`, String(rm?.visit.noVisit));
ok("diagnosa ICD-10 ikut", (rm?.diagnosa.length ?? 0) > 0,
  rm?.diagnosa.map((d) => d.kode).join(", "));
ok("status asesmen terbaca", rm?.asesmen?.status === "final", String(rm?.asesmen?.status));
ok("nama pencetak ikut apa adanya", rm?.dicetakOleh === "Petugas Uji");
ok("penanda tangan adalah dokter pemeriksa",
  rm?.dokter.noSip === "SIP-UJI-001", String(rm?.dokter.noSip));

/*
 * Kop diambil dari cabang KUNJUNGAN, bukan cabang aktif pembaca. Riwayat
 * pasien lintas cabang, jadi dokter di Cabang A bisa mencetak kunjungan
 * Cabang B — dan kertasnya harus berkop Cabang B. Kalau tertukar, dokumen
 * itu menyatakan pelayanan terjadi di tempat yang salah.
 */
const rmB = await detailRekamMedis(vCabangLain, "Petugas Uji");
ok("kunjungan cabang LAIN tetap bisa dirakit", rmB !== null,
  "riwayat pasien memang lintas cabang");
ok(
  "kop mengikuti cabang kunjungan, bukan cabang pembaca",
  rmB?.klinik.nama === "Uji Cabang B",
  `${rmB?.klinik.nama} (kunjungan A berkop "${rm?.klinik.nama}")`,
);

ok("kunjungan tidak dikenal mengembalikan null",
  (await detailRekamMedis(999999999, "x")) === null);

/*
 * Kunjungan tanpa asesmen sama sekali harus tetap terakit — lembarnya yang
 * akan menandai dirinya DRAF, bukan perakitannya yang gagal. `vCabangLain`
 * memang tidak pernah diberi asesmen di fixture ini.
 */
ok("kunjungan tanpa asesmen tetap terakit", rmB !== null);
ok("asesmen kosong dilaporkan null, bukan objek kosong", rmB?.asesmen === null,
  JSON.stringify(rmB?.asesmen));
ok("diagnosa kosong berupa array kosong",
  Array.isArray(rmB?.diagnosa) && rmB?.diagnosa.length === 0);
ok("resep kosong berupa array kosong",
  Array.isArray(rmB?.obat) && rmB?.obat.length === 0 && rmB?.racikan.length === 0);

// =====================================================================
await bersih();
console.log(`\n${gagal === 0 ? "SEMUA UJI LULUS" : `${gagal} UJI GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
