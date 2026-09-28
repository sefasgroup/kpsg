import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { query, queryOne, transaction, limitAman } from "./db";
import { tarifTindakanBerlaku } from "./penjamin";
import { kirimNotifikasi } from "./notifications";
import {
  hapusBarisTagihanByRef,
  hitungUlangTagihan,
  pastikanTagihan,
  tambahBarisTagihan,
} from "./billing";
import {
  statusLokalisSchema,
  type AsesmenInput,
  type StatusLokalis,
} from "./validations/doctor";

const REF_TINDAKAN = "assessment_procedure";
const REF_JASA_DOKTER = "jasa_dokter";

/** Status kunjungan yang boleh dikerjakan dokter. */
const STATUS_BOLEH_DIPERIKSA = [
  "menunggu_dokter",
  "dalam_pemeriksaan",
  "menunggu_lab",
];

export type WorklistDokter = RowDataPacket & {
  visit_id: number;
  no_visit: string;
  waktu_daftar: string;
  status: string;
  antrean: string | null;
  no_rm: string;
  nama: string;
  tanggal_lahir: string;
  jenis_kelamin: "L" | "P";
  poli_nama: string;
  alergi: string | null;
  triase: string | null;
  keluhan_utama: string | null;
  sudah_diperiksa: number;
  ada_resep: number;
  didahulukan: number;
  alasan_didahulukan: string | null;
};

/**
 * Urutan antrean dokter.
 *
 * Berbeda dari antrean perawat: di sini triase SUDAH ada, dan triase adalah
 * penilaian klinis perawat — ia mengalahkan penanda Pendaftaran, yang hanya
 * pengamatan awam petugas depan. Penanda itu tetap dipakai untuk memilah
 * pasien dengan triase yang sama.
 *
 * `CASE`, bukan `FIELD()`. `FIELD()` mengembalikan 0 untuk nilai yang tidak
 * ada di daftarnya — termasuk NULL — sehingga pasien tanpa triase justru
 * naik ke urutan PALING ATAS, mendahului triase merah. Kebalikan dari yang
 * dimaksud, dan tidak terlihat sampai ada satu kunjungan yang lolos tanpa
 * pengkajian perawat.
 */
const URUT_DOKTER = `
  CASE na.triase
    WHEN 'merah'  THEN 1
    WHEN 'kuning' THEN 2
    WHEN 'hijau'  THEN 3
    WHEN 'hitam'  THEN 4
    ELSE 5
  END,
  v.didahulukan DESC,
  q.nomor`;

const SELECT_WORKLIST = `
  SELECT v.id AS visit_id, v.no_visit, v.waktu_daftar, v.status,
         v.didahulukan, v.alasan_didahulukan,
         CONCAT(q.prefix, LPAD(q.nomor, 3, '0')) AS antrean,
         p.no_rm, p.nama, p.tanggal_lahir, p.jenis_kelamin,
         pol.nama AS poli_nama,
         (SELECT GROUP_CONCAT(a.nama_alergen SEPARATOR ', ')
            FROM patient_allergies a
           WHERE a.patient_id = p.id AND a.is_active = 1) AS alergi,
         na.triase, na.keluhan_utama,
         (ma.id IS NOT NULL AND ma.status = 'final') AS sudah_diperiksa,
         (rx.id IS NOT NULL) AS ada_resep
    FROM visits v
    JOIN patients p ON p.id = v.patient_id
    JOIN polis pol  ON pol.id = v.poli_id
    LEFT JOIN queues q ON q.visit_id = v.id
    LEFT JOIN nurse_assessments na ON na.visit_id = v.id
    LEFT JOIN medical_assessments ma ON ma.visit_id = v.id
    LEFT JOIN prescriptions rx ON rx.visit_id = v.id AND rx.status <> 'batal'
`;

/**
 * Antrean dokter. Dokter hanya melihat pasien yang dijadwalkan padanya —
 * termasuk bila ia bertindak sebagai dokter pengganti.
 */
export async function worklistDokter(
  siteId: number | null,
  doctorId: number,
  tanggal: string,
  lihatSemua = false,
): Promise<WorklistDokter[]> {
  return query<WorklistDokter>(
    `${SELECT_WORKLIST}
      WHERE v.tanggal = ?
        AND (? IS NULL OR v.site_id = ?)
        AND v.status IN ('menunggu_dokter','dalam_pemeriksaan','menunggu_lab')
        AND (? = 1 OR v.doctor_id = ? OR v.substitute_doctor_id = ?)
      ORDER BY ${URUT_DOKTER}`,
    [tanggal, siteId, siteId, lihatSemua ? 1 : 0, doctorId, doctorId],
  );
}

/**
 * Kunjungan HARI SEBELUMNYA yang masih menggantung di tahap dokter.
 *
 * ==========================================================================
 * TANPA INI, KUNJUNGAN YANG TERTINGGAL SEMALAM HILANG SELAMANYA.
 *
 * `worklistDokter()` menyaring `v.tanggal = ?`, dan begitu tanggalnya
 * berganti pasien itu lenyap dari layar dokter — padahal statusnya masih
 * `menunggu_dokter` dan sistem tetap menganggapnya sedang dilayani. Layar
 * Pendaftaran dan Antrean juga hanya menampilkan hari ini, sehingga ia bahkan
 * tidak bisa dibatalkan. Kunjungan itu membeku: tidak maju, tidak tutup,
 * tidak terlihat siapa pun.
 *
 * Bandingkan dengan Lab, Farmasi, dan Kasir — ketiganya TIDAK menyaring
 * tanggal sama sekali, sehingga pekerjaan tertunda di sana tetap muncul.
 * Ketimpangan itulah sumber masalahnya.
 *
 * Alur lab asinkron memperbanyak kejadiannya: hasil `ditunggu` yang baru
 * difinalkan keesokan hari mendorong kunjungan ke `menunggu_dokter` pada
 * tanggal kemarin — langsung tak terlihat begitu ia dibuat.
 *
 * Dipisah dari antrean hari ini, BUKAN digabung: nomor antrean di-reset
 * setiap hari, jadi mencampurnya menghasilkan urutan yang tidak berarti.
 * ==========================================================================
 */
export async function tertundaDokter(
  siteId: number | null,
  doctorId: number,
  tanggal: string,
  lihatSemua = false,
): Promise<WorklistDokter[]> {
  return query<WorklistDokter>(
    `${SELECT_WORKLIST}
      WHERE v.tanggal < ?
        AND (? IS NULL OR v.site_id = ?)
        AND v.status IN ('menunggu_dokter','dalam_pemeriksaan','menunggu_lab')
        AND (? = 1 OR v.doctor_id = ? OR v.substitute_doctor_id = ?)
      ORDER BY v.tanggal DESC, q.nomor`,
    [tanggal, siteId, siteId, lihatSemua ? 1 : 0, doctorId, doctorId],
  );
}

export type PasienCabangLain = RowDataPacket & {
  site_id: number;
  site_nama: string;
  jumlah: number;
};

/**
 * Pasien yang menunggu dokter ini di cabang LAIN tempat ia ditugaskan.
 *
 * Antrean sengaja tetap terkurung pada cabang aktif — meresepkan memotong
 * stok cabang itu dan tagihannya masuk ke sana, jadi mencampur antrean
 * beberapa cabang dalam satu daftar mengundang salah cabang.
 *
 * Yang berbahaya bukan pengurungannya, melainkan DIAM-nya: dokter
 * multi-cabang membuka layar, melihat "Tidak ada pasien menunggu", lalu
 * menyimpulkan sistemnya rusak — padahal pasiennya menunggu satu cabang di
 * sebelah. Hitungan ini yang membuat layar kosong itu berkata jujur.
 */
export async function pasienDiCabangLain(
  siteAktif: number | null,
  doctorId: number,
  tanggal: string,
): Promise<PasienCabangLain[]> {
  return query<PasienCabangLain>(
    `SELECT v.site_id, s.nama AS site_nama, COUNT(*) AS jumlah
       FROM visits v
       JOIN sites s ON s.id = v.site_id
      WHERE v.tanggal = ?
        AND (? IS NULL OR v.site_id <> ?)
        AND v.status IN ('menunggu_dokter','dalam_pemeriksaan','menunggu_lab')
        AND (v.doctor_id = ? OR v.substitute_doctor_id = ?)
        -- Hanya cabang tempat dokter ini memang ditugaskan.
        AND (
          v.site_id = (SELECT u.site_id FROM users u WHERE u.id = ?)
          OR EXISTS (SELECT 1 FROM user_sites us
                      WHERE us.user_id = ? AND us.site_id = v.site_id)
        )
      GROUP BY v.site_id, s.nama
      ORDER BY s.nama`,
    [tanggal, siteAktif, siteAktif, doctorId, doctorId, doctorId, doctorId],
  );
}

export async function selesaiDokterHariIni(
  siteId: number | null,
  doctorId: number,
  tanggal: string,
  /** Super Admin: seluruh dokter, sama seperti worklistDokter(). */
  lihatSemua = false,
): Promise<WorklistDokter[]> {
  return query<WorklistDokter>(
    `${SELECT_WORKLIST}
      WHERE v.tanggal = ?
        AND (? IS NULL OR v.site_id = ?)
        AND ma.id IS NOT NULL AND ma.status = 'final'
        AND (? OR ma.doctor_id = ? OR v.doctor_id = ?)
      ORDER BY q.nomor`,
    [tanggal, siteId, siteId, lihatSemua ? 1 : 0, doctorId, doctorId],
  );
}

export type DetailPemeriksaan = RowDataPacket & WorklistDokter & {
  patient_id: number;
  nik: string;
  site_id: number;
  dokter_nama: string;
  /* ringkasan pengkajian perawat — read-only bagi dokter */
  td_sistolik: number | null;
  td_diastolik: number | null;
  nadi: number | null;
  respirasi: number | null;
  suhu: string | null;
  spo2: number | null;
  kesadaran: string | null;
  berat_badan: string | null;
  tinggi_badan: string | null;
  imt: string | null;
  skala_nyeri: number | null;
  riwayat_singkat: string | null;
  riwayat_pengobatan: string | null;
  keadaan_umum: string | null;
  keadaan_gizi: string | null;
  perawat_nama: string | null;
  /* identitas untuk kop surat keterangan — ikut ditarik agar Surat
     Keterangan bisa diterbitkan langsung dari layar pemeriksaan */
  alamat: string | null;
  pekerjaan: string | null;
  /* Siapa yang berhak menerbitkan surat atas kunjungan ini. Layar
     pemeriksaan boleh dibuka dokter mana pun di cabang yang sama, tetapi
     surat hanya boleh terbit dari dokter yang benar-benar memeriksa —
     lihat `terbitkanSurat()` di lib/dokumen.ts. */
  doctor_id: number;
  substitute_doctor_id: number | null;
  /** Tanggal pelayanan — dipakai sebagai tanggal rekam medis kunjungan ini. */
  tanggal: string;
};

export async function getPemeriksaan(
  visitId: number,
  siteId: number | null,
): Promise<DetailPemeriksaan | null> {
  return queryOne<DetailPemeriksaan>(
    `SELECT v.id AS visit_id, v.no_visit, v.waktu_daftar, v.status, v.site_id,
            v.tanggal, v.doctor_id, v.substitute_doctor_id,
            CONCAT(q.prefix, LPAD(q.nomor, 3, '0')) AS antrean,
            p.id AS patient_id, p.no_rm, p.nik, p.nama, p.tanggal_lahir, p.jenis_kelamin,
            p.alamat, p.pekerjaan,
            pol.nama AS poli_nama,
            COALESCE(sub.nama, d.nama) AS dokter_nama,
            (SELECT GROUP_CONCAT(a.nama_alergen SEPARATOR ', ')
               FROM patient_allergies a
              WHERE a.patient_id = p.id AND a.is_active = 1) AS alergi,
            na.triase, na.keluhan_utama, na.riwayat_singkat,
            na.riwayat_pengobatan, na.keadaan_umum, na.keadaan_gizi,
            na.td_sistolik, na.td_diastolik, na.nadi, na.respirasi, na.suhu,
            na.spo2, na.kesadaran, na.berat_badan, na.tinggi_badan, na.imt,
            na.skala_nyeri, nrs.nama AS perawat_nama,
            (ma.id IS NOT NULL AND ma.status = 'final') AS sudah_diperiksa,
            (rx.id IS NOT NULL) AS ada_resep
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       JOIN polis pol  ON pol.id = v.poli_id
       JOIN users d    ON d.id = v.doctor_id
       LEFT JOIN users sub ON sub.id = v.substitute_doctor_id
       LEFT JOIN queues q  ON q.visit_id = v.id
       LEFT JOIN nurse_assessments na ON na.visit_id = v.id
       LEFT JOIN users nrs ON nrs.id = na.nurse_id
       LEFT JOIN medical_assessments ma ON ma.visit_id = v.id
       LEFT JOIN prescriptions rx ON rx.visit_id = v.id AND rx.status <> 'batal'
      WHERE v.id = ? AND (? IS NULL OR v.site_id = ?)`,
    [visitId, siteId, siteId],
  );
}

export type AsesmenTersimpan = RowDataPacket & {
  id: number;
  /** Dokter yang benar-benar memeriksa (getAsesmen memakai SELECT *). */
  doctor_id: number;
  // --- S ---
  jenis_anamnesis: "auto" | "allo" | null;
  sumber_anamnesis: string | null;
  keluhan_utama: string | null;
  riwayat_penyakit: string | null;
  riwayat_pengobatan: string | null;
  riwayat_alergi: string | null;
  subjective: string | null;
  // --- O ---
  keadaan_umum: string | null;
  keadaan_gizi: string | null;
  /** JSON mentah; urai dengan `bacaStatusLokalis()`. */
  status_lokalis: string | null;
  objective: string | null;
  // --- A / P ---
  assessment: string | null;
  terapi: string | null;
  plan: string | null;
  edukasi: string | null;
  /**
   * Tidak lagi diisi lewat form dokter — kolomnya dipertahankan agar isi
   * asesmen lama tidak hilang, dan `getAsesmen()` memakai `SELECT *` sehingga
   * nilainya memang tetap terbaca.
   */
  prognosis: string | null;
  status: string;
};

/**
 * Mengurai `status_lokalis` yang tersimpan sebagai JSON.
 *
 * Gagal-diam ke bentuk kosong: kolom ini pernah kosong pada asesmen lama, dan
 * satu baris JSON rusak tidak boleh membuat seluruh layar pemeriksaan gagal
 * dimuat.
 */
export function bacaStatusLokalis(mentah: string | null): StatusLokalis {
  const kosong: StatusLokalis = { catatan: undefined, titik: [], regio: {} };
  if (!mentah) return kosong;
  try {
    const hasil = statusLokalisSchema.safeParse(JSON.parse(mentah));
    return hasil.success ? hasil.data : kosong;
  } catch {
    return kosong;
  }
}

export async function getAsesmen(visitId: number): Promise<AsesmenTersimpan | null> {
  return queryOne<AsesmenTersimpan>(
    `SELECT * FROM medical_assessments WHERE visit_id = ?`,
    [visitId],
  );
}

export async function getDiagnosa(visitId: number) {
  return query<RowDataPacket & { icd10_code: string; nama_id: string; tipe: string; keterangan: string | null }>(
    `SELECT ad.icd10_code, ic.nama_id, ad.tipe, ad.keterangan
       FROM assessment_diagnoses ad
       JOIN medical_assessments ma ON ma.id = ad.assessment_id
       JOIN icd10_codes ic ON ic.code = ad.icd10_code
      WHERE ma.visit_id = ?
      ORDER BY FIELD(ad.tipe,'primer','sekunder','komplikasi')`,
    [visitId],
  );
}

export async function getTindakan(visitId: number) {
  return query<RowDataPacket & {
    procedure_id: number; nama: string; qty: number; tarif: string;
    diskon: string; alasan_diskon: string | null; is_konsultasi: number;
  }>(
    `SELECT ap.procedure_id, mp.nama, ap.qty, ap.tarif,
            ap.diskon, ap.alasan_diskon, mp.is_konsultasi
       FROM assessment_procedures ap
       JOIN medical_assessments ma ON ma.id = ap.assessment_id
       JOIN medical_procedures mp ON mp.id = ap.procedure_id
      WHERE ma.visit_id = ?
      ORDER BY ap.id`,
    [visitId],
  );
}

/**
 * Dokter yang menandatangani rekam medis kunjungan ini.
 *
 * Bukan pengguna yang sedang membuka layar — layar pemeriksaan boleh dibuka
 * dokter mana pun di cabang yang sama. Yang menandatangani adalah yang
 * benar-benar memeriksa: `medical_assessments.doctor_id` bila asesmennya
 * sudah ada, jatuh ke dokter pengganti, lalu ke dokter terjadwal.
 *
 * Salah orang di blok tanda tangan bukan cacat kosmetik — rekam medis adalah
 * dokumen hukum, dan nama beserta No. SIP di bawahnya adalah pernyataan
 * siapa yang bertanggung jawab atas isinya.
 */
export async function dokterPemeriksa(visitId: number) {
  return queryOne<RowDataPacket & {
    id: number; nama: string; gelar_depan: string | null; no_sip: string | null;
  }>(
    `SELECT u.id, u.nama, dp.gelar_depan, dp.no_sip
       FROM visits v
       LEFT JOIN medical_assessments ma ON ma.visit_id = v.id
       JOIN users u
         ON u.id = COALESCE(ma.doctor_id, v.substitute_doctor_id, v.doctor_id)
       LEFT JOIN doctor_profiles dp ON dp.user_id = u.id
      WHERE v.id = ?`,
    [visitId],
  );
}

// --- pencarian master data -------------------------------------------

export async function cariIcd10(keyword: string, limit = 20) {
  const q = keyword.trim();
  if (q.length < 2) return [];
  return query<RowDataPacket & { code: string; nama_id: string; bab: string | null }>(
    `SELECT code, nama_id, bab FROM icd10_codes
      WHERE is_active = 1 AND (code LIKE ? OR nama_id LIKE ?)
      ORDER BY (code LIKE ?) DESC, nama_id
      LIMIT ${limitAman(limit)}`,
    [`${q}%`, `%${q}%`, `${q}%`],
  );
}

export async function cariTindakan(keyword: string, siteId: number | null, limit = 20) {
  const q = keyword.trim();
  if (q.length < 2) return [];
  // Tarif cabang menimpa tarif global bila ada barisnya.
  return query<RowDataPacket & {
    id: number; kode: string; nama: string; tarif: string; is_konsultasi: number;
  }>(
    `SELECT mp.id, mp.kode, mp.nama, mp.is_konsultasi,
            COALESCE(spt.tarif, mp.tarif) AS tarif
       FROM medical_procedures mp
       LEFT JOIN site_procedure_tariffs spt
              ON spt.procedure_id = mp.id AND spt.site_id = ?
      WHERE mp.is_active = 1 AND (mp.nama LIKE ? OR mp.kode LIKE ?)
      ORDER BY mp.nama
      LIMIT ${limitAman(limit)}`,
    [siteId, `%${q}%`, `${q}%`],
  );
}

/**
 * Tindakan konsultasi yang dipasang otomatis di form dokter.
 *
 * Klinik bisa punya lebih dari satu — Konsultasi Dokter Umum dan Konsultasi
 * Dokter Gigi. Yang dipilih adalah yang namanya paling cocok dengan poli
 * kunjungan; bila tidak ada yang cocok, jatuh ke konsultasi pertama yang
 * aktif. Pencocokan nama memang heuristik, tetapi salah pilih di sini hanya
 * berarti dokter mengganti barisnya sendiri — bukan data yang rusak.
 *
 * Mengembalikan `null` bila belum ada satu pun tindakan bertanda konsultasi.
 * Form dokter lalu tampil tanpa baris default, bukan gagal.
 */
export async function konsultasiDefault(visitId: number, siteId: number | null) {
  return queryOne<RowDataPacket & {
    id: number; kode: string; nama: string; tarif: string;
  }>(
    `SELECT mp.id, mp.kode, mp.nama,
            COALESCE(spt.tarif, mp.tarif) AS tarif
       FROM medical_procedures mp
       LEFT JOIN site_procedure_tariffs spt
              ON spt.procedure_id = mp.id AND spt.site_id = ?
       CROSS JOIN (
         SELECT TRIM(REPLACE(pol.nama, 'Poli', '')) AS kata
           FROM visits v JOIN polis pol ON pol.id = v.poli_id
          WHERE v.id = ?
       ) p
      WHERE mp.is_konsultasi = 1 AND mp.is_active = 1
      ORDER BY (p.kata <> '' AND mp.nama LIKE CONCAT('%', p.kata, '%')) DESC, mp.id
      LIMIT 1`,
    [siteId, visitId],
  );
}

/**
 * Menyimpan asesmen dokter beserta diagnosa dan tindakan.
 *
 * Biaya yang masuk tagihan di tahap ini hanya jasa dokter dan tindakan.
 * Biaya obat DITAMBAHKAN OLEH FARMASI saat penyerahan, bukan di sini —
 * pasien membayar apa yang benar-benar diserahkan (CLAUDE.md §3.1: rekap
 * tagihan terjadi setelah apotek menyiapkan obat).
 */
export async function simpanAsesmen(
  visitId: number,
  siteId: number,
  doctorId: number,
  input: AsesmenInput,
): Promise<{ assessmentId: number }> {
  return transaction(async (conn) => {
    const [visitRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, status, site_id FROM visits WHERE id = ? FOR UPDATE`,
      [visitId],
    );
    const visit = visitRows[0];
    if (!visit) throw new Error("Kunjungan tidak ditemukan.");
    if (visit.site_id !== siteId) {
      throw new Error("Kunjungan ini bukan milik cabang Anda.");
    }
    if (!STATUS_BOLEH_DIPERIKSA.includes(String(visit.status))) {
      throw new Error(
        "Kunjungan ini belum dikaji perawat atau sudah lewat tahap dokter.",
      );
    }

    /*
     * FINALISASI DITOLAK selama masih ada pemeriksaan yang hasilnya DITUNGGU.
     *
     * Finalisasi berarti "penilaian saya atas pasien ini sudah lengkap" —
     * pernyataan yang tidak benar bila dokter sendiri menyatakan sedang
     * menunggu hasil untuk menegakkan diagnosanya. Dulu ini dibiarkan, dan
     * akibatnya berlapis: pasien diteruskan ke farmasi membawa resep yang
     * disusun tanpa hasil lab, lalu hasilnya keluar dan tidak ada lagi yang
     * membacanya.
     *
     * Order `menyusul` TIDAK menghalangi. Hasilnya memang tidak dipakai untuk
     * keputusan hari ini — menahan finalisasi karenanya berarti kunjungan
     * tidak akan pernah bisa ditutup.
     */
    if (input.finalkan) {
      const [labDitunggu] = await conn.execute<RowDataPacket[]>(
        `SELECT lo.no_order,
                (SELECT GROUP_CONCAT(lp.nama SEPARATOR ', ')
                   FROM lab_order_panels lop JOIN lab_panels lp ON lp.id = lop.panel_id
                  WHERE lop.order_id = lo.id AND lop.status <> 'batal') AS panels
           FROM lab_orders lo
          WHERE lo.visit_id = ? AND lo.status IN ('baru','diproses')
            AND lo.sifat_hasil = 'ditunggu'
          LIMIT 1`,
        [visitId],
      );
      if (labDitunggu[0]) {
        throw new Error(
          `Hasil ${String(labDitunggu[0].no_order)} (${String(labDitunggu[0].panels ?? "pemeriksaan lab")}) ` +
          "masih ditunggu. Asesmen baru bisa difinalkan setelah hasilnya masuk dan Anda menilainya. " +
          "Simpan sebagai draft dulu — atau ubah order itu jadi “hasil menyusul” bila pasien " +
          "tidak perlu menunggu.",
        );
      }
    }

    const statusAsesmen = input.finalkan ? "final" : "draft";

    await conn.execute(
      /*
       * `prognosis` sengaja tidak ikut ditulis.
       *
       * Kolomnya masih ada di database dan asesmen lama tetap menyimpan
       * isinya — yang dihapus hanya isiannya di form dokter. Karena kolom itu
       * tidak lagi disebut di sini, UPDATE pada asesmen lama pun tidak akan
       * menimpanya menjadi NULL.
       */
      `INSERT INTO medical_assessments
         (visit_id, site_id, doctor_id,
          jenis_anamnesis, sumber_anamnesis, keluhan_utama, riwayat_penyakit,
          riwayat_pengobatan,
          keadaan_umum, keadaan_gizi, status_lokalis,
          assessment, terapi, plan, edukasi, status, finalized_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         doctor_id = VALUES(doctor_id),
         jenis_anamnesis = VALUES(jenis_anamnesis),
         sumber_anamnesis = VALUES(sumber_anamnesis),
         keluhan_utama = VALUES(keluhan_utama),
         riwayat_penyakit = VALUES(riwayat_penyakit),
         riwayat_pengobatan = VALUES(riwayat_pengobatan),
         keadaan_umum = VALUES(keadaan_umum),
         keadaan_gizi = VALUES(keadaan_gizi),
         status_lokalis = VALUES(status_lokalis),
         assessment = VALUES(assessment),
         terapi = VALUES(terapi), plan = VALUES(plan), edukasi = VALUES(edukasi),
         status = VALUES(status), finalized_at = VALUES(finalized_at)`,
      [
        visitId, siteId, doctorId,
        input.jenis_anamnesis,
        // Sumber hanya bermakna pada alloanamnesis; dibuang bila autoanamnesis
        // supaya tidak ada sisa isian yang sempat terketik lalu jenisnya diubah.
        input.jenis_anamnesis === "allo" ? (input.sumber_anamnesis ?? null) : null,
        input.keluhan_utama ?? null, input.riwayat_penyakit ?? null,
        input.riwayat_pengobatan ?? null,
        input.keadaan_umum, input.keadaan_gizi,
        // Disimpan sebagai NULL bila benar-benar kosong, bukan "{}" — kolom
        // kosong terbaca jelas di query, string JSON kosong tidak.
        input.status_lokalis.titik.length === 0 &&
        Object.keys(input.status_lokalis.regio).length === 0 &&
        !input.status_lokalis.catatan
          ? null
          : JSON.stringify(input.status_lokalis),
        input.assessment ?? null, input.terapi ?? null, input.plan ?? null,
        input.edukasi ?? null,
        statusAsesmen, input.finalkan ? new Date() : null,
      ],
    );

    const [assRow] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM medical_assessments WHERE visit_id = ?`,
      [visitId],
    );
    const assessmentId = Number(assRow[0].id);

    // Diagnosa & tindakan ditulis ulang seluruhnya — jumlahnya sedikit,
    // dan penulisan ulang menghindari logika selisih yang rawan.
    await conn.execute(`DELETE FROM assessment_diagnoses WHERE assessment_id = ?`, [assessmentId]);
    for (const d of input.diagnoses) {
      await conn.execute(
        `INSERT INTO assessment_diagnoses (assessment_id, icd10_code, tipe, keterangan)
         VALUES (?,?,?,?)`,
        [assessmentId, d.icd10_code, d.tipe, d.keterangan ?? null],
      );
    }

    /*
     * Tindakan mana yang berperan konsultasi dibaca dari DATABASE, bukan dari
     * yang dikirim klien. Diskon hanya sah pada tindakan konsultasi, dan
     * kalau penentuannya ikut kiriman klien, potongan bisa dipasang pada
     * tindakan apa pun lewat permintaan yang dirakit sendiri.
     */
    const idTindakan = input.procedures.map((t) => t.procedure_id);
    const konsultasi = new Set<number>();
    if (idTindakan.length > 0) {
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM medical_procedures
          WHERE is_konsultasi = 1 AND id IN (${idTindakan.map(() => "?").join(",")})`,
        idTindakan,
      );
      for (const r of rows) konsultasi.add(Number(r.id));
    }

    /*
     * TARIF DIHITUNG ULANG DI SERVER, tidak diambil dari kiriman klien.
     *
     * Dua hal sekaligus tertutup di sini.
     *
     * Pertama, integritas harga: `t.tarif` datang dari formulir, dan
     * permintaan yang dirakit sendiri bisa memasang angka apa pun. Pola ini
     * sudah dipakai untuk `is_konsultasi` beberapa baris di atas —
     * alasannya sama, dan tidak ada alasan harga diperlakukan lebih longgar
     * daripada penanda diskon.
     *
     * Kedua, TARIF KONTRAK PENJAMIN. Ia tersimpan di `payer_tariffs` dan
     * punya urutan kewenangan yang jelas (kontrak → cabang → global), tetapi
     * sebelum ini tidak ada satu pun jalur yang memakainya: formulir dokter
     * mengirim tarif global, dan berkas klaim berisi angka di atas harga
     * yang disepakati — cara tercepat membuat seluruh klaim ditolak.
     */
    const [vPayer] = await conn.execute<RowDataPacket[]>(
      `SELECT payer_id FROM visits WHERE id = ?`,
      [visitId],
    );
    const payerId = vPayer[0]?.payer_id ? Number(vPayer[0].payer_id) : null;

    const tarifResmi = new Map<number, number>();
    for (const id of new Set(idTindakan)) {
      const harga = await tarifTindakanBerlaku(conn, id, siteId, payerId);
      if (harga === null) throw new Error("Tindakan tidak ditemukan di master data.");
      tarifResmi.set(id, harga);
    }

    await conn.execute(`DELETE FROM assessment_procedures WHERE assessment_id = ?`, [assessmentId]);
    const tindakanTersimpan: {
      id: number; nama: string; qty: number; tarif: number; diskon: number;
    }[] = [];

    for (const t of input.procedures) {
      const tarif = tarifResmi.get(t.procedure_id) ?? 0;

      // Diskon dibuang diam-diam bila tindakannya bukan konsultasi, dan
      // dipotong pada nilai barisnya supaya subtotal tidak pernah negatif.
      const diskon = konsultasi.has(t.procedure_id)
        ? Math.min(Math.max(t.diskon ?? 0, 0), t.qty * tarif)
        : 0;

      const [res] = await conn.execute<ResultSetHeader>(
        `INSERT INTO assessment_procedures
           (assessment_id, procedure_id, qty, tarif, diskon, alasan_diskon,
            subtotal, executed_by)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          assessmentId, t.procedure_id, t.qty, tarif, diskon,
          diskon > 0 ? (t.alasan_diskon ?? null) : null,
          t.qty * tarif - diskon, doctorId,
        ],
      );
      tindakanTersimpan.push({
        id: res.insertId, nama: t.nama, qty: t.qty, tarif, diskon,
      });
    }

    // --- Tagihan: tindakan ---------------------------------------------
    const billingId = await pastikanTagihan(conn, visitId, siteId);

    await hapusBarisTagihanByRef(conn, billingId, REF_TINDAKAN);
    for (const t of tindakanTersimpan) {
      await tambahBarisTagihan(conn, {
        billingId,
        kategori: "tindakan",
        deskripsi: t.nama,
        qty: t.qty,
        hargaSatuan: t.tarif,
        diskon: t.diskon,
        refType: REF_TINDAKAN,
        refId: t.id,
      });
    }

    /*
     * Jasa dokter otomatis DIMATIKAN.
     *
     * Dulu baris ini terbit sendiri saat finalisasi, dari
     * `doctor_profiles.tarif_konsultasi`. Sejak konsultasi menjadi tindakan
     * yang ter-select otomatis, keduanya aktif berarti pasien tertagih
     * konsultasi DUA KALI. Dan baris otomatis itu tidak bisa dihapus maupun
     * didiskon dokter — justru dua hal yang dibutuhkan untuk pasien kurang
     * mampu.
     *
     * Penghapusannya tetap dijalankan agar asesmen lama yang sudah terlanjur
     * punya baris ini ikut bersih begitu disimpan ulang.
     */
    await hapusBarisTagihanByRef(conn, billingId, REF_JASA_DOKTER);

    await hitungUlangTagihan(conn, billingId);

    // --- Status kunjungan ----------------------------------------------
    if (input.finalkan) {
      /*
       * Ke mana pasien pergi setelah dokter selesai bergantung pada apakah
       * ada resep: bila ada, farmasi dulu; bila tidak, langsung kasir.
       *
       * Hanya order DITUNGGU yang menahan pasien di tahap lab — dan penjaga
       * di atas sudah memastikan tidak ada satu pun yang tersisa, sehingga
       * cabang ini praktis tidak pernah diambil. Ia dipertahankan sebagai
       * penjagaan berlapis: memakai `status IN ('baru','diproses')` polos di
       * sini akan mengurung pasien yang hanya punya order `menyusul` di
       * `menunggu_lab` — persis kebalikan dari maksud order itu.
       */
      const [labAktif] = await conn.execute<RowDataPacket[]>(
        `SELECT 1 FROM lab_orders
          WHERE visit_id = ? AND status IN ('baru','diproses')
            AND sifat_hasil = 'ditunggu' LIMIT 1`,
        [visitId],
      );
      /*
       * Hanya resep yang masih butuh kerja farmasi. Resep `disiapkan` sudah
       * divalidasi dan dihargai — yang tersisa tinggal pembayaran. Mengirim
       * pasien ke farmasi dalam keadaan itu membuatnya terjebak: farmasi tak
       * punya pekerjaan, kasir tak melihatnya (sama dengan statusSetelahLab).
       */
      const [adaResep] = await conn.execute<RowDataPacket[]>(
        `SELECT rx.id, rx.no_resep, p.nama,
                (SELECT COUNT(*) FROM prescription_items pi WHERE pi.prescription_id = rx.id) AS paten,
                (SELECT COUNT(*) FROM prescription_racikans pr WHERE pr.prescription_id = rx.id) AS racikan
           FROM prescriptions rx
           JOIN visits v   ON v.id = rx.visit_id
           JOIN patients p ON p.id = v.patient_id
          WHERE rx.visit_id = ? AND rx.status IN ('baru','diterima_farmasi')
          LIMIT 1`,
        [visitId],
      );

      const statusBerikut =
        labAktif.length > 0
          ? "menunggu_lab"
          : adaResep.length > 0
            ? "menunggu_farmasi"
            : "menunggu_kasir";

      await conn.execute(`UPDATE visits SET status = ? WHERE id = ?`, [
        statusBerikut,
        visitId,
      ]);

      /*
       * Finalkan Asesmen ADALAH tombol kirim ke farmasi (§3.1), jadi di
       * sinilah farmasi diberi tahu — juga setiap kali resep direvisi dan
       * difinalkan ulang setelah "Kembalikan ke Dokter". Ditujukan ke PERAN
       * supaya apoteker mana pun yang bertugas bisa mengambilnya, dan ikut
       * transaksi ini sehingga batal bersama finalisasinya.
       */
      if (statusBerikut === "menunggu_farmasi") {
        const rx = adaResep[0];
        const racikan = Number(rx.racikan);
        await kirimNotifikasi(
          { roleCode: "farmasi", siteId },
          {
            jenis: "resep_masuk",
            judul: `Resep baru — ${String(rx.nama ?? "Pasien")}`,
            pesan:
              `${String(rx.no_resep)} · ${Number(rx.paten) + racikan} item` +
              (racikan > 0 ? ` (termasuk ${racikan} racikan)` : ""),
            link: `/farmasi/${Number(rx.id)}`,
            siteId,
          },
          conn,
        );
      }

      /*
       * Kunjungan yang langsung ke kasir — tanpa lab dan tanpa resep — tidak
       * akan disentuh modul lain lagi, jadi angkanya sudah final di sini.
       *
       * Tanpa kenaikan ini tagihannya berhenti di `draft` selamanya. Layar
       * kasir tetap menampilkannya (query-nya menerima `draft` maupun
       * `menunggu`), tetapi penghitung "Tagihan Menunggu" di Dashboard hanya
       * membaca `menunggu` — sehingga justru pasien yang paling sederhana,
       * yang hanya konsultasi lalu membayar, tidak pernah ikut terhitung.
       */
      if (statusBerikut === "menunggu_kasir") {
        await conn.execute(
          `UPDATE billing_transactions SET status = 'menunggu'
            WHERE id = ? AND status = 'draft'`,
          [billingId],
        );
      }
    } else if (visit.status === "menunggu_dokter") {
      await conn.execute(
        `UPDATE visits SET status = 'dalam_pemeriksaan' WHERE id = ?`,
        [visitId],
      );
    }

    return { assessmentId };
  });
}
