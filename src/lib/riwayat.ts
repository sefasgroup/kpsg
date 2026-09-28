import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { limitAman, query, queryOne } from "./db";

/**
 * Riwayat rekam medis pasien lintas kunjungan.
 *
 * Layar ini hanya MEMBACA. Tidak ada satu pun fungsi di sini yang menulis:
 * mengubah rekam medis kunjungan lama harus lewat layar pemeriksaannya
 * sendiri, sehingga jejak siapa mengubah apa tetap utuh.
 *
 * Sengaja LINTAS CABANG untuk pasien yang sama (docs/DATABASE.md §3.7) —
 * riwayat pengobatan pasien tidak terpotong saat ia berobat di cabang lain.
 */

export type RingkasanPasien = RowDataPacket & {
  id: number;
  no_rm: string;
  nik: string;
  nama: string;
  tanggal_lahir: string;
  jenis_kelamin: "L" | "P";
  alamat: string | null;
  telepon: string | null;
  gol_darah: string | null;
  jenis_pasien: string;
  alergi: string | null;
  jumlah_kunjungan: number;
  kunjungan_terakhir: string | null;
};

export async function ringkasanPasien(
  patientId: number,
): Promise<RingkasanPasien | null> {
  return queryOne<RingkasanPasien>(
    `SELECT p.id, p.no_rm, p.nik, p.nama, p.tanggal_lahir, p.jenis_kelamin,
            p.alamat, p.telepon, p.gol_darah, p.jenis_pasien,
            (SELECT GROUP_CONCAT(a.nama_alergen SEPARATOR ', ')
               FROM patient_allergies a
              WHERE a.patient_id = p.id AND a.is_active = 1) AS alergi,
            (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id AND v.status <> 'batal') AS jumlah_kunjungan,
            (SELECT MAX(v.tanggal) FROM visits v WHERE v.patient_id = p.id AND v.status <> 'batal') AS kunjungan_terakhir
       FROM patients p
      WHERE p.id = ?`,
    [patientId],
  );
}

export type KunjunganRiwayat = RowDataPacket & {
  id: number;
  no_visit: string;
  tanggal: string;
  status: string;
  poli: string;
  site_nama: string;
  dokter: string;
  dokter_pengganti: string | null;
  /** Ringkasan SOAP — bisa NULL bila kunjungan berhenti sebelum diperiksa. */
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  edukasi: string | null;
  status_asesmen: string | null;
  diagnosa: string | null;
  tindakan: string | null;
  obat: string | null;
  racikan: string | null;
  lab: string | null;
  ttv: string | null;
};

/**
 * Memangkas nol di belakang koma pada kolom DECIMAL, di dalam SQL.
 *
 * Dilakukan di SQL — bukan di JavaScript seperti `formatDesimal()` — karena
 * angkanya sudah terlanjur dirangkai menjadi kalimat oleh GROUP_CONCAT sebelum
 * sampai ke JavaScript. MySQL mencetak DECIMAL(14,3) apa adanya, sehingga qty
 * 15 menjadi "15.000" dan di layar terbaca lima belas ribu.
 *
 * Pemeriksaan titik desimal itu WAJIB, bukan kehati-hatian berlebihan: pada
 * kolom bilangan bulat seperti `assessment_procedures.qty` (SMALLINT),
 * memangkas nol di belakang akan mengubah 150 menjadi 15.
 */
export const tanpaNolEkor = (kolom: string) =>
  `IF(LOCATE('.', CAST(${kolom} AS CHAR)) = 0,
      CAST(${kolom} AS CHAR),
      TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM CAST(${kolom} AS CHAR))))`;

export async function riwayatKunjungan(
  patientId: number,
  limit = 50,
): Promise<KunjunganRiwayat[]> {
  return query<KunjunganRiwayat>(
    `SELECT v.id, v.no_visit, v.tanggal, v.status,
            pl.nama AS poli, s.nama AS site_nama,
            d.nama AS dokter, sub.nama AS dokter_pengganti,
            ma.subjective, ma.objective, ma.assessment, ma.plan, ma.edukasi,
            ma.status AS status_asesmen,

            (SELECT GROUP_CONCAT(CONCAT(ad.icd10_code, ' — ', ic.nama_id, ' (', ad.tipe, ')')
                       ORDER BY ad.tipe SEPARATOR '\n')
               FROM assessment_diagnoses ad
               JOIN icd10_codes ic ON ic.code = ad.icd10_code
              WHERE ad.assessment_id = ma.id) AS diagnosa,

            (SELECT GROUP_CONCAT(CONCAT(mp.nama, ' ×', ap.qty) SEPARATOR '\n')
               FROM assessment_procedures ap
               JOIN medical_procedures mp ON mp.id = ap.procedure_id
              WHERE ap.assessment_id = ma.id) AS tindakan,

            (SELECT GROUP_CONCAT(CONCAT(i.nama, ' ×', ${tanpaNolEkor("pi.qty")}, ' — ', pi.aturan_pakai) SEPARATOR '\n')
               FROM prescription_items pi
               JOIN prescriptions rx ON rx.id = pi.prescription_id
               JOIN items i ON i.id = pi.item_id
              WHERE rx.visit_id = v.id AND rx.status <> 'batal') AS obat,

            (SELECT GROUP_CONCAT(CONCAT(pr.nama_racikan, ' (', ${tanpaNolEkor("pr.qty_jadi")}, ' ', pr.satuan_jadi, ') — ', pr.aturan_pakai) SEPARATOR '\n')
               FROM prescription_racikans pr
               JOIN prescriptions rx ON rx.id = pr.prescription_id
              WHERE rx.visit_id = v.id AND rx.status <> 'batal') AS racikan,

            (SELECT GROUP_CONCAT(DISTINCT lp.nama SEPARATOR ', ')
               FROM lab_order_panels lop
               JOIN lab_orders lo ON lo.id = lop.order_id
               JOIN lab_panels lp ON lp.id = lop.panel_id
              WHERE lo.visit_id = v.id AND lo.status <> 'batal') AS lab,

            -- CONCAT_WS melewati NULL, jadi TTV yang tidak diisi tidak
            -- membuat seluruh baris ringkasan jadi kosong.
            (SELECT CONCAT_WS(' · ',
                      CONCAT('TD ', na.td_sistolik, '/', na.td_diastolik),
                      CONCAT('N ', na.nadi, '×/mnt'),
                      CONCAT('S ', na.suhu, '°C'),
                      CONCAT('BB ', ${tanpaNolEkor("na.berat_badan")}, ' kg'))
               FROM nurse_assessments na WHERE na.visit_id = v.id) AS ttv

       FROM visits v
       JOIN polis pl ON pl.id = v.poli_id
       JOIN sites s  ON s.id = v.site_id
       JOIN users d  ON d.id = v.doctor_id
       LEFT JOIN users sub ON sub.id = v.substitute_doctor_id
       LEFT JOIN medical_assessments ma ON ma.visit_id = v.id
      WHERE v.patient_id = ? AND v.status <> 'batal'
      ORDER BY v.tanggal DESC, v.id DESC
      LIMIT ${limitAman(limit)}`,
    [patientId],
  );
}

export type HasilLabRiwayat = RowDataPacket & {
  visit_id: number;
  tanggal: string;
  panel: string;
  parameter: string;
  nilai: string;
  satuan: string | null;
  ref_teks: string | null;
  flag: string;
};

/** Hasil lab numerik lintas kunjungan — dipakai untuk melihat tren. */
export async function riwayatLab(
  patientId: number,
  limit = 200,
): Promise<HasilLabRiwayat[]> {
  return query<HasilLabRiwayat>(
    `SELECT v.id AS visit_id, v.tanggal, lp.nama AS panel, par.nama AS parameter,
            COALESCE(lr.nilai_teks, ${tanpaNolEkor("lr.nilai_numerik")}) AS nilai,
            lr.satuan, lr.ref_teks, lr.flag
       FROM lab_results lr
       JOIN lab_orders lo   ON lo.id = lr.order_id
       JOIN visits v        ON v.id = lo.visit_id
       JOIN lab_parameters par ON par.id = lr.parameter_id
       JOIN lab_panels lp   ON lp.id = lr.panel_id
      WHERE v.patient_id = ? AND lo.status = 'selesai'
      ORDER BY v.tanggal DESC, lp.nama, par.urutan
      LIMIT ${limitAman(limit, 200)}`,
    [patientId],
  );
}

/** Alergi aktif — ditampilkan menonjol karena menentukan keamanan peresepan. */
export async function alergiPasien(patientId: number) {
  return query<RowDataPacket & {
    id: number; nama_alergen: string; jenis: string; reaksi: string | null;
    keparahan: string | null; dicatat: string;
  }>(
    `SELECT a.id, a.nama_alergen, a.jenis, a.reaksi, a.keparahan, a.created_at AS dicatat
       FROM patient_allergies a
      WHERE a.patient_id = ? AND a.is_active = 1
      ORDER BY FIELD(a.keparahan, 'berat', 'sedang', 'ringan'), a.nama_alergen`,
    [patientId],
  );
}
