import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { limitAman, nextSequence, query, queryOne, transaction } from "./db";
import { periodeSekarang } from "./tanggal";
import type { SuratInput } from "./validations/dokumen";

/**
 * Surat keterangan medis (CLAUDE.md §5.2).
 *
 * Isi spesifik per jenis disimpan sebagai JSON di `medical_certificates.isi`
 * agar penambahan jenis surat baru tidak memerlukan migrasi kolom. Yang
 * tetap berupa kolom adalah hal yang dipakai untuk mencari dan menomori:
 * jenis, nomor, kunjungan, dan penerbitnya.
 *
 * Surat SELALU terikat pada satu `visit_id`. Tanpa itu, surat keterangan
 * bisa terbit untuk pasien yang tidak pernah diperiksa hari itu.
 */

export type SuratRow = RowDataPacket & {
  id: number;
  site_id: number;
  no_surat: string;
  jenis: string;
  isi: Record<string, unknown> | string;
  issued_at: string;
  visit_id: number;
  tanggal: string;
  no_rm: string;
  nik: string;
  nama: string;
  tanggal_lahir: string;
  jenis_kelamin: "L" | "P";
  alamat: string | null;
  pekerjaan: string | null;
  dokter: string;
  dokter_gelar: string | null;
  no_sip: string | null;
};

/*
 * `issued_at` diformat di SQL, bukan dibiarkan apa adanya.
 *
 * Kolomnya DATETIME, sementara `dateStrings` di lib/db.ts hanya mencakup
 * `DATE` — jadi mysql2 mengembalikannya sebagai OBJEK Date. Tipe di atas
 * menyatakannya `string`, dan TypeScript mempercayai pernyataan itu tanpa
 * bisa memeriksanya: pemanggilan `.slice()` di layar Surat lolos kompilasi
 * lalu meledak saat dijalankan — tetapi HANYA setelah dokter yang
 * bersangkutan pernah menerbitkan satu surat. Dengan riwayat kosong,
 * halamannya tampak sehat.
 *
 * Memformat di SQL membuat tipenya jujur, dan tidak bergantung pada
 * konfigurasi driver yang bisa berubah.
 */
const SELECT_SURAT = `
  SELECT mc.id, mc.site_id, mc.no_surat, mc.jenis, mc.isi, mc.visit_id,
         DATE_FORMAT(mc.issued_at, '%Y-%m-%d %H:%i:%s') AS issued_at,
         v.tanggal, p.no_rm, p.nik, p.nama, p.tanggal_lahir, p.jenis_kelamin,
         p.alamat, p.pekerjaan,
         u.nama AS dokter, dp.gelar_depan AS dokter_gelar, dp.no_sip
    FROM medical_certificates mc
    JOIN visits v   ON v.id = mc.visit_id
    JOIN patients p ON p.id = v.patient_id
    JOIN users u    ON u.id = mc.issued_by
    LEFT JOIN doctor_profiles dp ON dp.user_id = u.id
`;

/** Isi JSON dikembalikan mysql2 sebagai objek atau string tergantung driver. */
function bacaIsi(isi: SuratRow["isi"]): Record<string, unknown> {
  if (typeof isi === "string") {
    try {
      return JSON.parse(isi) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return isi ?? {};
}

export async function daftarSurat(
  siteId: number | null,
  opts: { doctorId?: number; jenis?: string; visitId?: number; limit?: number } = {},
): Promise<(SuratRow & { data: Record<string, unknown> })[]> {
  const rows = await query<SuratRow>(
    `${SELECT_SURAT}
      WHERE (? IS NULL OR mc.site_id = ?)
        AND (? IS NULL OR mc.issued_by = ?)
        AND (? IS NULL OR mc.jenis = ?)
        AND (? IS NULL OR mc.visit_id = ?)
      ORDER BY mc.id DESC
      LIMIT ${limitAman(opts.limit, 100)}`,
    [
      siteId, siteId,
      opts.doctorId ?? null, opts.doctorId ?? null,
      opts.jenis ?? null, opts.jenis ?? null,
      opts.visitId ?? null, opts.visitId ?? null,
    ],
  );
  return rows.map((r) => ({ ...r, data: bacaIsi(r.isi) }));
}

export async function getSurat(
  id: number,
  siteId: number | null,
): Promise<(SuratRow & { data: Record<string, unknown> }) | null> {
  const row = await queryOne<SuratRow>(
    `${SELECT_SURAT} WHERE mc.id = ? AND (? IS NULL OR mc.site_id = ?)`,
    [id, siteId, siteId],
  );
  return row ? { ...row, data: bacaIsi(row.isi) } : null;
}

export type KunjunganSurat = RowDataPacket & {
  id: number;
  no_visit: string;
  tanggal: string;
  status: string;
  no_rm: string;
  nik: string;
  nama: string;
  tanggal_lahir: string;
  jenis_kelamin: "L" | "P";
  alamat: string | null;
  pekerjaan: string | null;
  poli: string;
  diagnosa: string | null;
  jumlah_surat: number;
};

/**
 * Kunjungan yang boleh diterbitkan suratnya oleh dokter ini.
 *
 * Dibatasi pada kunjungan yang benar-benar ia tangani — termasuk saat ia
 * bertugas sebagai dokter pengganti. Dokter lain tidak boleh menerbitkan
 * surat atas pemeriksaan yang tidak ia lakukan.
 */
export async function kunjunganUntukSurat(
  doctorId: number,
  siteId: number | null,
  opts: { keyword?: string; hari?: number; limit?: number } = {},
): Promise<KunjunganSurat[]> {
  const q = (opts.keyword ?? "").trim();
  const hari = limitAman(opts.hari, 30, 365);

  return query<KunjunganSurat>(
    `SELECT v.id, v.no_visit, v.tanggal, v.status,
            p.no_rm, p.nik, p.nama, p.tanggal_lahir, p.jenis_kelamin,
            p.alamat, p.pekerjaan, pl.nama AS poli,
            (SELECT GROUP_CONCAT(CONCAT(ad.icd10_code, ' — ', ic.nama_id) SEPARATOR '; ')
               FROM assessment_diagnoses ad
               JOIN medical_assessments ma ON ma.id = ad.assessment_id
               JOIN icd10_codes ic ON ic.code = ad.icd10_code
              WHERE ma.visit_id = v.id) AS diagnosa,
            (SELECT COUNT(*) FROM medical_certificates mc WHERE mc.visit_id = v.id) AS jumlah_surat
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       JOIN polis pl   ON pl.id = v.poli_id
      WHERE (v.doctor_id = ? OR v.substitute_doctor_id = ?)
        AND v.status <> 'batal'
        AND v.tanggal >= DATE_SUB(CURDATE(), INTERVAL ${hari} DAY)
        AND (? IS NULL OR v.site_id = ?)
        AND (? = '' OR p.nama LIKE ? OR p.no_rm LIKE ? OR p.nik LIKE ?)
      ORDER BY v.tanggal DESC, v.id DESC
      LIMIT ${limitAman(opts.limit, 50)}`,
    [
      doctorId, doctorId, siteId, siteId,
      q, `%${q}%`, `${q}%`, `${q}%`,
    ],
  );
}

/**
 * Menerbitkan surat. Nomor diambil dari `sequences` di dalam transaksi
 * yang sama supaya dua dokter yang menerbitkan bersamaan tidak mendapat
 * nomor kembar (docs/DATABASE.md §3.8).
 */
export async function terbitkanSurat(
  input: SuratInput,
  siteId: number,
  doctorId: number,
): Promise<{ id: number; no_surat: string }> {
  return transaction(async (conn) => {
    const [visitRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, doctor_id, substitute_doctor_id, status
         FROM visits WHERE id = ? AND site_id = ?`,
      [input.visit_id, siteId],
    );
    const visit = visitRows[0];
    if (!visit) throw new Error("Kunjungan tidak ditemukan di cabang ini.");
    if (visit.status === "batal") {
      throw new Error("Kunjungan ini dibatalkan — suratnya tidak bisa diterbitkan.");
    }
    if (
      Number(visit.doctor_id) !== doctorId &&
      Number(visit.substitute_doctor_id ?? 0) !== doctorId
    ) {
      throw new Error(
        "Surat hanya boleh diterbitkan oleh dokter yang menangani kunjungan ini.",
      );
    }

    const [siteRows] = await conn.execute<RowDataPacket[]>(
      `SELECT kode FROM sites WHERE id = ?`,
      [siteId],
    );
    const kode = String(siteRows[0]?.kode ?? "KPSG");
    const periode = periodeSekarang();
    const nomor = await nextSequence(conn, siteId, "surat", periode);
    const noSurat = `${kode}/SKET/${periode}/${String(nomor).padStart(4, "0")}`;

    // Hanya field yang relevan bagi jenisnya yang disimpan, supaya isi surat
    // tidak memuat sisa isian jenis lain yang sempat terketik di form.
    const isi = ringkasIsi(input);

    const [res] = await conn.execute<import("mysql2").ResultSetHeader>(
      `INSERT INTO medical_certificates (site_id, visit_id, jenis, no_surat, isi, issued_by)
       VALUES (?,?,?,?,?,?)`,
      [siteId, input.visit_id, input.jenis, noSurat, JSON.stringify(isi), doctorId],
    );

    return { id: res.insertId, no_surat: noSurat };
  });
}

function ringkasIsi(v: SuratInput): Record<string, unknown> {
  switch (v.jenis) {
    case "sakit":
      return {
        mulai: v.mulai,
        lama_hari: v.lama_hari,
        diagnosa_ditulis: v.diagnosa_ditulis ?? null,
      };
    case "sehat":
      return {
        keperluan: v.keperluan,
        tinggi_badan: v.tinggi_badan,
        berat_badan: v.berat_badan,
        tekanan_darah: v.tekanan_darah ?? null,
        gol_darah: v.gol_darah ?? null,
        buta_warna: v.buta_warna ?? null,
      };
    case "rujukan":
      return {
        tujuan_faskes: v.tujuan_faskes,
        tujuan_bagian: v.tujuan_bagian ?? null,
        alasan_rujukan: v.alasan_rujukan,
        ringkasan_klinis: v.ringkasan_klinis ?? null,
      };
    default:
      return { perihal: v.perihal, isi_bebas: v.isi_bebas };
  }
}

/** Identitas cabang untuk kop surat — sama sumbernya dengan lembar hasil lab. */
export type KopKlinik = {
  nama: string;
  namaLegal: string | null;
  alamat: string | null;
  telepon: string | null;
  noIzin: string | null;
};

export async function kopKlinik(siteId: number | null): Promise<KopKlinik> {
  const row = await queryOne<RowDataPacket & {
    nama: string; nama_legal: string | null; alamat: string | null;
    telepon: string | null; no_izin_klinik: string | null;
  }>(
    `SELECT nama, nama_legal, alamat, telepon, no_izin_klinik
       FROM sites WHERE (? IS NULL OR id = ?) ORDER BY id LIMIT 1`,
    [siteId, siteId],
  );
  return {
    nama: row?.nama ?? "Klinik Pratama Sahabat Gamma",
    namaLegal: row?.nama_legal ?? null,
    alamat: row?.alamat ?? null,
    telepon: row?.telepon ?? null,
    noIzin: row?.no_izin_klinik ?? null,
  };
}
