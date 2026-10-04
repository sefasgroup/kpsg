import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { execute, limitAman, query, queryOne } from "./db";

/**
 * Laporan operasional cabang untuk Admin Cabang / Manajer Operasional.
 *
 * Semua angka di sini SELALU terikat pada satu `siteId` yang berasal dari
 * sesi. Admin Cabang tidak boleh melihat performa cabang lain — itu
 * wewenang Super Admin, dan pemisahan ini adalah bagian dari isolasi
 * multi-cabang (docs/DATABASE.md §3.7).
 *
 * Pendapatan dihitung dari transaksi berstatus `lunas` saja. Tagihan yang
 * masih menunggu bukan pendapatan; memasukkannya membuat laporan harian
 * tidak pernah cocok dengan kas.
 *
 * Yang belum dibayar pun dipecah dua: `menunggu` (siap ditagih di kasir)
 * dan `draft` (pasiennya masih dilayani, angkanya masih bergerak). Satu
 * angka gabungan untuk keduanya terbaca sebagai piutang, padahal separuhnya
 * belum pernah menjadi tagihan.
 */

export type RingkasanCabang = {
  kunjungan: number;
  pasienBaru: number;
  selesai: number;
  batal: number;
  transaksiLunas: number;
  pendapatan: number;
  /** Tagihan berstatus `menunggu` — sudah final, tinggal dibayar. */
  menungguKasir: number;
  nilaiMenungguKasir: number;
  /** Tagihan `draft` — pasiennya masih dilayani, angkanya belum final. */
  dalamPelayanan: number;
  nilaiDalamPelayanan: number;
  rataPerKunjungan: number;
};

export async function ringkasanCabang(
  siteId: number,
  dari: string,
  sampai: string,
): Promise<RingkasanCabang> {
  const v = await queryOne<RowDataPacket & {
    kunjungan: number; baru: number; selesai: number; batal: number;
  }>(
    `SELECT COUNT(*) AS kunjungan,
            SUM(jenis_kunjungan = 'baru') AS baru,
            SUM(status = 'selesai') AS selesai,
            SUM(status = 'batal') AS batal
       FROM visits
      WHERE site_id = ? AND tanggal BETWEEN ? AND ?`,
    [siteId, dari, sampai],
  );

  /*
   * `draft` DIPISAH dari `menunggu` — dulu keduanya dijumlahkan jadi satu
   * angka berlabel "Belum Dibayar".
   *
   * Keduanya sama-sama belum dibayar, tetapi hanya satu yang berarti uang
   * yang bisa ditagih. Tagihan lahir sebagai `draft` sejak pasien
   * mendaftar dan terus bertambah selama ia dilayani — konsultasi, BMHP
   * perawat, tarif lab. Menjumlahkannya dengan tagihan yang benar-benar
   * menunggu di kasir membuat angka piutang naik setiap kali seorang
   * pasien masuk ruang periksa, lalu turun lagi begitu ia membayar,
   * tanpa satu rupiah pun pernah tertunggak.
   *
   * Angka `draft` tetap dilaporkan, bukan dibuang: ia menjawab "berapa
   * nilai pekerjaan yang sedang berjalan", pertanyaan yang sah — hanya
   * saja bukan pertanyaan yang sama.
   */
  const b = await queryOne<RowDataPacket & {
    lunas: number; pendapatan: string;
    menunggu: number; nilai_menunggu: string;
    draft: number; nilai_draft: string;
  }>(
    /*
     * Pendapatan dibukukan pada TANGGAL BAYAR, bukan tanggal kunjungan —
     * sama dengan kas shift. Kunjungan tertunda (§3.3) yang dibayar hari ini
     * dulu masuk ke pendapatan kemarin, sehingga laporan harian tidak pernah
     * cocok dengan uang di laci. Tagihan yang belum lunas tetap mengikuti
     * tanggal kunjungannya.
     */
    `SELECT SUM(bt.status = 'lunas') AS lunas,
            COALESCE(SUM(CASE WHEN bt.status = 'lunas' THEN bt.total END), 0) AS pendapatan,
            SUM(bt.status = 'menunggu') AS menunggu,
            COALESCE(SUM(CASE WHEN bt.status = 'menunggu' THEN bt.total END), 0) AS nilai_menunggu,
            SUM(bt.status = 'draft') AS draft,
            COALESCE(SUM(CASE WHEN bt.status = 'draft' THEN bt.total END), 0) AS nilai_draft
       FROM billing_transactions bt
       JOIN visits v ON v.id = bt.visit_id
      WHERE bt.site_id = ?
        AND ((bt.status = 'lunas' AND DATE(bt.paid_at) BETWEEN ? AND ?)
             OR (bt.status IN ('menunggu','draft') AND v.tanggal BETWEEN ? AND ?))`,
    [siteId, dari, sampai, dari, sampai],
  );

  const lunas = Number(b?.lunas ?? 0);
  const pendapatan = Number(b?.pendapatan ?? 0);

  return {
    kunjungan: Number(v?.kunjungan ?? 0),
    pasienBaru: Number(v?.baru ?? 0),
    selesai: Number(v?.selesai ?? 0),
    batal: Number(v?.batal ?? 0),
    transaksiLunas: lunas,
    pendapatan,
    menungguKasir: Number(b?.menunggu ?? 0),
    nilaiMenungguKasir: Number(b?.nilai_menunggu ?? 0),
    dalamPelayanan: Number(b?.draft ?? 0),
    nilaiDalamPelayanan: Number(b?.nilai_draft ?? 0),
    rataPerKunjungan: lunas > 0 ? Math.round(pendapatan / lunas) : 0,
  };
}

export type KunjunganHarian = RowDataPacket & {
  tanggal: string;
  kunjungan: number;
  baru: number;
  selesai: number;
  pendapatan: string;
};

export async function kunjunganHarian(
  siteId: number,
  dari: string,
  sampai: string,
): Promise<KunjunganHarian[]> {
  return query<KunjunganHarian>(
    `SELECT v.tanggal,
            COUNT(*) AS kunjungan,
            SUM(v.jenis_kunjungan = 'baru') AS baru,
            SUM(v.status = 'selesai') AS selesai,
            -- Pendapatan per TANGGAL BAYAR (lihat ringkasanCabang).
            COALESCE((SELECT SUM(bt.total) FROM billing_transactions bt
                       WHERE bt.site_id = v.site_id AND bt.status = 'lunas'
                         AND DATE(bt.paid_at) = v.tanggal), 0) AS pendapatan
       FROM visits v
      WHERE v.site_id = ? AND v.tanggal BETWEEN ? AND ? AND v.status <> 'batal'
      GROUP BY v.tanggal, v.site_id
      ORDER BY v.tanggal`,
    [siteId, dari, sampai],
  );
}

export type PendapatanKategori = RowDataPacket & {
  kategori: string;
  jumlah_baris: number;
  nilai: string;
};

/** Komposisi pendapatan per kategori biaya — jasa racik berdiri sendiri. */
export async function pendapatanKategori(
  siteId: number,
  dari: string,
  sampai: string,
): Promise<PendapatanKategori[]> {
  return query<PendapatanKategori>(
    `SELECT bi.kategori, COUNT(*) AS jumlah_baris, COALESCE(SUM(bi.subtotal), 0) AS nilai
       FROM billing_items bi
       JOIN billing_transactions bt ON bt.id = bi.billing_id
      WHERE bt.site_id = ? AND bt.status = 'lunas'
        AND DATE(bt.paid_at) BETWEEN ? AND ?
      GROUP BY bi.kategori
      ORDER BY nilai DESC`,
    [siteId, dari, sampai],
  );
}

/**
 * Diskon dan pembulatan yang ditetapkan kasir di tingkat TAGIHAN.
 *
 * Komposisi per kategori menjumlahkan baris biaya (nilai kotor), sedangkan
 * angka Pendapatan adalah total tagihan setelah diskon dan pembulatan.
 * Tanpa baris penyesuaian ini kedua angka di layar yang sama tidak pernah
 * cocok, dan selisihnya terbaca seperti uang yang hilang.
 *
 * Kolom `pembulatan` memuat dua hal yang dipisah di sini menurut tandanya:
 *   - NEGATIF = pembulatan cabang ke bawah (`billing.pembulatan`) — potongan;
 *   - POSITIF = selisih pembulatan paket (`billing.paket`) — dibukukan
 *     sebagai PENDAPATAN LAIN-LAIN, bukan jasa atau obat.
 * Digabung, keduanya saling menutupi: tambahan puluhan ribu dari paket
 * tersamar oleh potongan ratusan rupiah dari pembulatan cabang.
 */
export async function penyesuaianPendapatan(
  siteId: number,
  dari: string,
  sampai: string,
): Promise<{ diskon: number; pembulatan: number; selisihPaket: number }> {
  const r = await queryOne<RowDataPacket & { diskon: string; pembulatan: string; paket: string }>(
    `SELECT COALESCE(SUM(bt.diskon), 0) AS diskon,
            COALESCE(SUM(LEAST(bt.pembulatan, 0)), 0) AS pembulatan,
            COALESCE(SUM(GREATEST(bt.pembulatan, 0)), 0) AS paket
       FROM billing_transactions bt
      WHERE bt.site_id = ? AND bt.status = 'lunas' AND DATE(bt.paid_at) BETWEEN ? AND ?`,
    [siteId, dari, sampai],
  );
  return {
    diskon: Number(r?.diskon ?? 0),
    pembulatan: Number(r?.pembulatan ?? 0),
    selisihPaket: Number(r?.paket ?? 0),
  };
}

export type MetodeBayar = RowDataPacket & {
  payment_method: string | null;
  jumlah: number;
  nilai: string;
};

export async function metodeBayar(
  siteId: number,
  dari: string,
  sampai: string,
): Promise<MetodeBayar[]> {
  return query<MetodeBayar>(
    /* Uang yang benar-benar DITERIMA dari pasien (`dibayar - kembalian`),
       bukan nilai tagihan — sama dengan rekap tutup kasir (cashier.ts).
       `SUM(total)` ikut menghitung bagian yang ditanggung penjamin, sehingga
       laporan ini tidak pernah cocok dengan kas shift. */
    `SELECT bt.payment_method, COUNT(*) AS jumlah,
            COALESCE(SUM(bt.dibayar - bt.kembalian), 0) AS nilai
       FROM billing_transactions bt
      WHERE bt.site_id = ? AND bt.status = 'lunas' AND DATE(bt.paid_at) BETWEEN ? AND ?
      GROUP BY bt.payment_method
      ORDER BY nilai DESC`,
    [siteId, dari, sampai],
  );
}

export type DiagnosaTeratas = RowDataPacket & {
  code: string;
  nama_id: string;
  jumlah: number;
};

export async function diagnosaTeratas(
  siteId: number,
  dari: string,
  sampai: string,
  limit = 15,
): Promise<DiagnosaTeratas[]> {
  return query<DiagnosaTeratas>(
    `SELECT ad.icd10_code AS code, ic.nama_id, COUNT(*) AS jumlah
       FROM assessment_diagnoses ad
       JOIN medical_assessments ma ON ma.id = ad.assessment_id
       JOIN visits v ON v.id = ma.visit_id
       JOIN icd10_codes ic ON ic.code = ad.icd10_code
      WHERE ma.site_id = ? AND v.tanggal BETWEEN ? AND ?
      GROUP BY ad.icd10_code, ic.nama_id
      ORDER BY jumlah DESC, ic.nama_id
      LIMIT ${limitAman(limit, 15, 100)}`,
    [siteId, dari, sampai],
  );
}

export type ProduktivitasDokter = RowDataPacket & {
  doctor_id: number;
  nama: string;
  gelar_depan: string | null;
  kunjungan: number;
  sebagai_pengganti: number;
  asesmen_final: number;
  resep: number;
  /** Baris "Jasa Dokter" saja — dasar bagi hasil; tidak termasuk obat, lab, atau selisih paket. */
  jasa_dokter: string;
  /** Total seluruh tagihan kunjungan yang dilayani dokter ini. */
  pendapatan: string;
};

/**
 * Dihitung terhadap dokter yang BENAR-BENAR melayani: bila ada dokter
 * pengganti, kunjungan itu masuk ke pengganti, bukan ke dokter terjadwal.
 */
export async function produktivitasDokter(
  siteId: number,
  dari: string,
  sampai: string,
): Promise<ProduktivitasDokter[]> {
  return query<ProduktivitasDokter>(
    `SELECT d.id AS doctor_id, d.nama, dp.gelar_depan,
            COUNT(*) AS kunjungan,
            SUM(v.substitute_doctor_id IS NOT NULL) AS sebagai_pengganti,
            SUM(ma.status = 'final') AS asesmen_final,
            COUNT(DISTINCT rx.id) AS resep,
            COALESCE(SUM(CASE WHEN bt.status = 'lunas' THEN
              (SELECT SUM(bi.subtotal) FROM billing_items bi
                WHERE bi.billing_id = bt.id AND bi.kategori = 'jasa_dokter') END), 0) AS jasa_dokter,
            COALESCE(SUM(CASE WHEN bt.status = 'lunas' THEN bt.total END), 0) AS pendapatan
       FROM visits v
       JOIN users d ON d.id = COALESCE(v.substitute_doctor_id, v.doctor_id)
       LEFT JOIN doctor_profiles dp ON dp.user_id = d.id
       LEFT JOIN medical_assessments ma ON ma.visit_id = v.id
       LEFT JOIN prescriptions rx ON rx.visit_id = v.id AND rx.status <> 'batal'
       LEFT JOIN billing_transactions bt ON bt.visit_id = v.id
      WHERE v.site_id = ? AND v.tanggal BETWEEN ? AND ? AND v.status <> 'batal'
      GROUP BY d.id, d.nama, dp.gelar_depan
      ORDER BY kunjungan DESC, d.nama`,
    [siteId, dari, sampai],
  );
}

export type ObatTeratas = RowDataPacket & {
  nama: string;
  kode: string;
  satuan_dasar: string;
  qty: string;
  nilai: string;
};

export async function obatTeratas(
  siteId: number,
  dari: string,
  sampai: string,
  limit = 15,
): Promise<ObatTeratas[]> {
  return query<ObatTeratas>(
    `SELECT i.nama, i.kode, i.satuan_dasar,
            SUM(m.qty) AS qty,
            SUM(m.qty * i.harga_jual) AS nilai
       FROM stock_movements m
       JOIN items i ON i.id = m.item_id
      WHERE m.site_id = ?
        AND m.jenis IN ('keluar_resep','keluar_racikan','keluar_bmhp')
        AND DATE(m.created_at) BETWEEN ? AND ?
      GROUP BY i.id, i.nama, i.kode, i.satuan_dasar
      ORDER BY nilai DESC
      LIMIT ${limitAman(limit, 15, 100)}`,
    [siteId, dari, sampai],
  );
}

export type RingkasanSdm = {
  hadir: number;
  terlambat: number;
  alfa: number;
  cutiPending: number;
  penggantiTanpaDokter: number;
};

export async function ringkasanSdm(
  siteId: number,
  dari: string,
  sampai: string,
): Promise<RingkasanSdm> {
  const a = await queryOne<RowDataPacket & { hadir: number; terlambat: number; alpha: number }>(
    `SELECT SUM(status = 'hadir') AS hadir,
            SUM(status = 'terlambat') AS terlambat,
            SUM(status = 'alpha') AS alpha
       FROM attendances
      WHERE site_id = ? AND tanggal BETWEEN ? AND ?`,
    [siteId, dari, sampai],
  );

  const c = await queryOne<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM leave_requests
      WHERE site_id = ? AND status = 'pending'
        AND tanggal_akhir >= ?`,
    [siteId, dari],
  );

  // Dokter berhalangan yang belum ditetapkan penggantinya: pasien tidak bisa
  // didaftarkan ke dokter itu, jadi ini butuh tindakan Admin Cabang.
  const p = await queryOne<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM schedule_exceptions
      WHERE site_id = ? AND status = 'disetujui'
        AND substitute_doctor_id IS NULL
        AND jenis IN ('libur','cuti','izin','sakit')
        AND tanggal BETWEEN ? AND ?`,
    [siteId, dari, sampai],
  );

  return {
    hadir: Number(a?.hadir ?? 0),
    terlambat: Number(a?.terlambat ?? 0),
    alfa: Number(a?.alpha ?? 0),
    cutiPending: Number(c?.n ?? 0),
    penggantiTanpaDokter: Number(p?.n ?? 0),
  };
}

// ---------------------------------------------------------------------
// LB1 — Laporan Bulanan Data Kesakitan (Dinas Kesehatan)
// ---------------------------------------------------------------------

/**
 * Kelompok umur baku formulir LB1. Umur dihitung pada TANGGAL KUNJUNGAN,
 * bukan hari ini — laporan bulan lalu tidak boleh berubah karena pasiennya
 * berulang tahun sesudahnya.
 */
export const KELOMPOK_UMUR_LB1 = [
  { kode: "0_7h", label: "0–7 hr", sql: "x.hari BETWEEN 0 AND 7" },
  { kode: "8_28h", label: "8–28 hr", sql: "x.hari BETWEEN 8 AND 28" },
  { kode: "1_11b", label: "1–11 bl", sql: "x.hari > 28 AND x.tahun < 1" },
  { kode: "1_4t", label: "1–4 th", sql: "x.tahun BETWEEN 1 AND 4" },
  { kode: "5_9t", label: "5–9 th", sql: "x.tahun BETWEEN 5 AND 9" },
  { kode: "10_14t", label: "10–14 th", sql: "x.tahun BETWEEN 10 AND 14" },
  { kode: "15_19t", label: "15–19 th", sql: "x.tahun BETWEEN 15 AND 19" },
  { kode: "20_44t", label: "20–44 th", sql: "x.tahun BETWEEN 20 AND 44" },
  { kode: "45_54t", label: "45–54 th", sql: "x.tahun BETWEEN 45 AND 54" },
  { kode: "55_59t", label: "55–59 th", sql: "x.tahun BETWEEN 55 AND 59" },
  { kode: "60_69t", label: "60–69 th", sql: "x.tahun BETWEEN 60 AND 69" },
  { kode: "70t", label: "≥70 th", sql: "x.tahun >= 70" },
] as const;

export type BarisLb1 = RowDataPacket & {
  code: string;
  nama_id: string;
  kelompok: string;
  /*
   * KASUS baru/lama, bukan kunjungan baru/lama: kasus baru bila diagnosa
   * ICD-10 ini BELUM PERNAH ditegakkan untuk pasien tersebut sebelumnya.
   * Kolom kelompok umur (u_<kode>_l / u_<kode>_p) menghitung kasus baru.
   */
  baru_l: number;
  baru_p: number;
  lama_l: number;
  lama_p: number;
  total: number;
};

/**
 * Rekap morbiditas per kode ICD-10, dipecah menurut jenis kelamin dan
 * status kunjungan (baru/lama) — bentuk yang diminta formulir LB1.
 *
 * DATANYA SUDAH ADA SEJAK AWAL
 *
 * `assessment_diagnoses` menyimpan ICD-10 karena `CLAUDE.md` §6 mewajibkan
 * standar itu untuk SatuSehat. Yang selama ini tidak ada hanyalah bentuk
 * keluarannya — sehingga laporan yang wajib dikirim ke Dinas Kesehatan
 * setiap bulan disusun ulang dengan tangan dari data yang sudah lengkap di
 * dalam sistem.
 *
 * Hanya diagnosa YANG DITEGAKKAN yang dihitung. Diagnosa banding adalah
 * kemungkinan yang sedang dipertimbangkan dokter, bukan penyakit yang
 * dilaporkan ke Dinkes — memasukkannya akan menggelembungkan angka
 * morbiditas kecamatan.
 */
export async function lb1Morbiditas(
  siteId: number,
  dari: string,
  sampai: string,
): Promise<BarisLb1[]> {
  /*
   * Dulu baru/lama diambil dari `visits.jenis_kunjungan` — "pertama kali
   * ke klinik". Pasien lama yang datang dengan ISPA baru tercatat kasus
   * LAMA, sehingga morbiditas kasus baru yang dipakai Dinkes terlalu kecil.
   * Kini: kasus baru bila tidak ada diagnosa final (bukan banding) dengan
   * kode yang sama untuk pasien itu pada kunjungan sebelumnya — di cabang
   * mana pun, karena rekam medisnya satu.
   */
  const kolomUmur = KELOMPOK_UMUR_LB1.flatMap((k) => [
    `SUM(x.baru = 1 AND x.jk = 'L' AND (${k.sql})) AS u_${k.kode}_l`,
    `SUM(x.baru = 1 AND x.jk = 'P' AND (${k.sql})) AS u_${k.kode}_p`,
  ]).join(", ");
  return query<BarisLb1>(
    `SELECT x.code, x.nama_id, x.kelompok,
            SUM(x.baru = 1 AND x.jk = 'L') AS baru_l,
            SUM(x.baru = 1 AND x.jk = 'P') AS baru_p,
            SUM(x.baru = 0 AND x.jk = 'L') AS lama_l,
            SUM(x.baru = 0 AND x.jk = 'P') AS lama_p,
            COUNT(*) AS total,
            ${kolomUmur}
       FROM (
         SELECT ad.icd10_code AS code, ic.nama_id, COALESCE(ic.bab, '-') AS kelompok,
                pa.jenis_kelamin AS jk,
                DATEDIFF(v.tanggal, pa.tanggal_lahir) AS hari,
                TIMESTAMPDIFF(YEAR, pa.tanggal_lahir, v.tanggal) AS tahun,
                NOT EXISTS (
                  SELECT 1 FROM assessment_diagnoses ad2
                    JOIN medical_assessments ma2 ON ma2.id = ad2.assessment_id
                    JOIN visits v2 ON v2.id = ma2.visit_id
                   WHERE v2.patient_id = v.patient_id
                     AND ad2.icd10_code = ad.icd10_code
                     AND ad2.tipe <> 'banding'
                     AND ma2.status = 'final'
                     AND v2.status <> 'batal'
                     AND (v2.tanggal < v.tanggal OR (v2.tanggal = v.tanggal AND v2.id < v.id))
                ) AS baru
           FROM assessment_diagnoses ad
           JOIN medical_assessments ma ON ma.id = ad.assessment_id
           JOIN visits v    ON v.id = ma.visit_id
           JOIN patients pa ON pa.id = v.patient_id
           JOIN icd10_codes ic ON ic.code = ad.icd10_code
          WHERE ma.site_id = ?
            AND v.tanggal BETWEEN ? AND ?
            AND v.status <> 'batal'
            AND ma.status = 'final'
            AND ad.tipe <> 'banding'
       ) x
      GROUP BY x.code, x.nama_id, x.kelompok
      ORDER BY total DESC, x.nama_id`,
    [siteId, dari, sampai],
  );
}

export type RingkasanLb1 = {
  kunjungan: number;
  kunjunganBaru: number;
  kunjunganLama: number;
  /** Kunjungan selesai yang asesmennya tidak final — tidak masuk LB1. */
  tanpaAsesmenFinal: number;
  /** Asesmen final tanpa satu pun diagnosa ditegakkan. */
  tanpaDiagnosaDitegakkan: number;
  jumlahKodeIcd: number;
  totalKasus: number;
};

/**
 * Kesiapan LB1.
 *
 * Dua angka pertama yang perlu dilihat justru angka yang HILANG:
 * kunjungan tanpa asesmen final dan asesmen tanpa diagnosa ditegakkan.
 * Keduanya tidak akan muncul di laporan, dan tanpa dihitung di sini
 * ketidaklengkapan itu tidak terlihat sama sekali — laporan tetap tercetak
 * rapi dengan angka yang terlalu kecil.
 */
export async function kesiapanLb1(
  siteId: number,
  dari: string,
  sampai: string,
  /** Baris LB1 yang sudah dimiliki pemanggil — lihat `kesiapanSipnap()`. */
  barisSiap?: BarisLb1[],
): Promise<RingkasanLb1> {
  const v = await queryOne<RowDataPacket & {
    kunjungan: number; baru: number; lama: number; tanpa_final: number;
  }>(
    `SELECT COUNT(*) AS kunjungan,
            SUM(v.jenis_kunjungan = 'baru') AS baru,
            SUM(v.jenis_kunjungan = 'lama') AS lama,
            SUM(NOT EXISTS (
              SELECT 1 FROM medical_assessments ma
               WHERE ma.visit_id = v.id AND ma.status = 'final'
            )) AS tanpa_final
       FROM visits v
      WHERE v.site_id = ? AND v.tanggal BETWEEN ? AND ? AND v.status <> 'batal'`,
    [siteId, dari, sampai],
  );

  const d = await queryOne<RowDataPacket & { tanpa_dx: number }>(
    `SELECT COUNT(*) AS tanpa_dx
       FROM medical_assessments ma
       JOIN visits v ON v.id = ma.visit_id
      WHERE ma.site_id = ? AND v.tanggal BETWEEN ? AND ?
        AND ma.status = 'final' AND v.status <> 'batal'
        AND NOT EXISTS (
          SELECT 1 FROM assessment_diagnoses ad
           WHERE ad.assessment_id = ma.id AND ad.tipe <> 'banding'
        )`,
    [siteId, dari, sampai],
  );

  const baris = barisSiap ?? (await lb1Morbiditas(siteId, dari, sampai));

  return {
    kunjungan: Number(v?.kunjungan ?? 0),
    kunjunganBaru: Number(v?.baru ?? 0),
    kunjunganLama: Number(v?.lama ?? 0),
    tanpaAsesmenFinal: Number(v?.tanpa_final ?? 0),
    tanpaDiagnosaDitegakkan: Number(d?.tanpa_dx ?? 0),
    jumlahKodeIcd: baris.length,
    totalKasus: baris.reduce((n, b) => n + Number(b.total), 0),
  };
}

// ---------------------------------------------------------------------
// Profil cabang
// ---------------------------------------------------------------------

export type ProfilCabang = RowDataPacket & {
  id: number;
  kode: string;
  nama: string;
  nama_legal: string | null;
  no_izin_klinik: string | null;
  npwp: string | null;
  alamat: string | null;
  kelurahan: string | null;
  kecamatan: string | null;
  kota: string | null;
  provinsi: string | null;
  kode_pos: string | null;
  telepon: string | null;
  email: string | null;
  header_cetak: string | null;
  footer_cetak: string | null;
  timezone: string;
  is_active: number;
};

export async function getProfilCabang(siteId: number): Promise<ProfilCabang | null> {
  return queryOne<ProfilCabang>(`SELECT * FROM sites WHERE id = ?`, [siteId]);
}

/**
 * Admin Cabang hanya boleh memperbarui identitas yang tercetak di kop surat.
 *
 * `kode` sengaja TIDAK termasuk: kode adalah awalan seluruh nomor dokumen
 * yang sudah terbit (No. RM, invoice, resep). Mengubahnya membuat dokumen
 * lama dan baru tampak berasal dari cabang yang berbeda.
 */
export async function simpanProfilCabang(
  siteId: number,
  input: {
    nama: string;
    nama_legal?: string;
    no_izin_klinik?: string;
    npwp?: string;
    alamat?: string;
    kelurahan?: string;
    kecamatan?: string;
    kota?: string;
    provinsi?: string;
    kode_pos?: string;
    telepon?: string;
    email?: string;
    header_cetak?: string;
    footer_cetak?: string;
  },
): Promise<void> {
  await execute(
    `UPDATE sites SET nama=?, nama_legal=?, no_izin_klinik=?, npwp=?, alamat=?,
            kelurahan=?, kecamatan=?, kota=?, provinsi=?, kode_pos=?,
            telepon=?, email=?, header_cetak=?, footer_cetak=?
      WHERE id = ?`,
    [
      input.nama, input.nama_legal ?? null, input.no_izin_klinik ?? null,
      input.npwp ?? null, input.alamat ?? null, input.kelurahan ?? null,
      input.kecamatan ?? null, input.kota ?? null, input.provinsi ?? null,
      input.kode_pos ?? null, input.telepon ?? null, input.email ?? null,
      input.header_cetak ?? null, input.footer_cetak ?? null,
      siteId,
    ],
  );
}

/** Statistik ringkas cabang untuk halaman profil. */
export async function statistikCabang(siteId: number) {
  return queryOne<RowDataPacket & {
    pengguna: number; dokter: number; pasien: number; poli: number; kunjungan: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM users u WHERE u.site_id = ? AND u.is_active = 1 AND u.deleted_at IS NULL) AS pengguna,
       (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.site_id = ? AND r.code = 'dokter' AND u.is_active = 1 AND u.deleted_at IS NULL) AS dokter,
       (SELECT COUNT(*) FROM patients p WHERE p.site_id = ? AND p.is_active = 1) AS pasien,
       -- polis.site_id NULL berarti master global yang dipakai semua cabang.
       (SELECT COUNT(*) FROM polis pl
         WHERE (pl.site_id = ? OR pl.site_id IS NULL) AND pl.is_active = 1) AS poli,
       (SELECT COUNT(*) FROM visits v WHERE v.site_id = ?) AS kunjungan`,
    [siteId, siteId, siteId, siteId, siteId],
  );
}
