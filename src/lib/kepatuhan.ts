import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { execute, limitAman, nextSequence, query, queryOne, transaction } from "./db";
import { kirimNotifikasi } from "./notifications";
import { periodeSekarang } from "./tanggal";
import type {
  ConsentInput,
  IkpInput,
  TindakLanjutIkpInput,
} from "./validations/kepatuhan";

/**
 * Dua kewajiban akreditasi klinik yang sebelumnya tidak punya tempat sama
 * sekali di sistem ini: **persetujuan pasien** dan **insiden keselamatan
 * pasien**.
 *
 * Keduanya digabung dalam satu modul karena sifatnya sama — dokumen yang
 * dibuat untuk dibaca kembali di kemudian hari, bukan data yang dipakai
 * mengalirkan pekerjaan hari ini. Yang menentukan nilainya bukan
 * kelengkapan kolom, melainkan apakah isinya masih bisa dipertanggungkan
 * bertahun-tahun setelah ditulis.
 */

// =====================================================================
// Persetujuan (informed & general consent)
// =====================================================================

export type ConsentRow = RowDataPacket & {
  id: number;
  visit_id: number;
  patient_id: number;
  jenis: string;
  judul: string;
  isi: string;
  procedure_id: number | null;
  tindakan_nama: string | null;
  penjelasan_oleh: number | null;
  pemberi_penjelasan: string | null;
  penandatangan: string;
  hubungan: string;
  saksi_nama: string | null;
  status: string;
  alasan_batal: string | null;
  ditandatangani_at: string;
  pencatat: string;
  /** Identitas pasien untuk kop dokumen. */
  no_rm: string;
  pasien: string;
  nik: string;
  tanggal_lahir: string;
  jenis_kelamin: "L" | "P";
};

const SELECT_CONSENT = `
  SELECT c.id, c.visit_id, c.patient_id, c.jenis, c.judul, c.isi,
         c.procedure_id, mp.nama AS tindakan_nama,
         c.penjelasan_oleh, pj.nama AS pemberi_penjelasan,
         c.penandatangan, c.hubungan, c.saksi_nama, c.status, c.alasan_batal,
         c.ditandatangani_at, u.nama AS pencatat,
         pa.no_rm, pa.nama AS pasien, pa.nik, pa.tanggal_lahir, pa.jenis_kelamin
    FROM consents c
    JOIN patients pa ON pa.id = c.patient_id
    JOIN users u     ON u.id = c.created_by
    LEFT JOIN medical_procedures mp ON mp.id = c.procedure_id
    LEFT JOIN users pj ON pj.id = c.penjelasan_oleh
`;

export async function consentKunjungan(visitId: number): Promise<ConsentRow[]> {
  return query<ConsentRow>(
    `${SELECT_CONSENT}
      WHERE c.visit_id = ?
      ORDER BY c.ditandatangani_at DESC, c.id DESC`,
    [visitId],
  );
}

export async function getConsent(
  id: number,
  siteId: number | null,
): Promise<ConsentRow | null> {
  return queryOne<ConsentRow>(
    `${SELECT_CONSENT} WHERE c.id = ? AND (? IS NULL OR c.site_id = ?)`,
    [id, siteId, siteId],
  );
}

/**
 * Riwayat persetujuan pasien LINTAS KUNJUNGAN.
 *
 * Persetujuan umum biasanya ditandatangani sekali dan berlaku untuk
 * kunjungan berikutnya, jadi petugas perlu bisa melihat bahwa pasien ini
 * sudah pernah menandatanganinya — tanpa itu, pasien lama diminta
 * menandatangani ulang setiap kali datang.
 */
export async function consentPasien(
  patientId: number,
  limit = 30,
): Promise<ConsentRow[]> {
  return query<ConsentRow>(
    `${SELECT_CONSENT}
      WHERE c.patient_id = ?
      ORDER BY c.ditandatangani_at DESC
      LIMIT ${limitAman(limit, 30, 200)}`,
    [patientId],
  );
}

export async function simpanConsent(
  input: ConsentInput,
  siteId: number,
  userId: number,
): Promise<number> {
  return transaction(async (conn) => {
    const [v] = await conn.execute<RowDataPacket[]>(
      `SELECT patient_id, site_id, status FROM visits WHERE id = ?`,
      [input.visit_id],
    );
    const visit = v[0];
    if (!visit) throw new Error("Kunjungan tidak ditemukan.");
    if (Number(visit.site_id) !== siteId) {
      throw new Error("Kunjungan ini bukan milik cabang Anda.");
    }
    /*
     * Persetujuan pada kunjungan yang sudah dibatalkan ditolak. Dokumen
     * yang menyatakan pasien menyetujui tindakan pada pelayanan yang tidak
     * pernah terjadi adalah dokumen yang menyesatkan, dan justru dokumen
     * inilah yang dicari kalau kelak terjadi sengketa.
     */
    if (visit.status === "batal") {
      throw new Error("Kunjungan ini sudah dibatalkan — persetujuan tidak bisa dicatat.");
    }

    /*
     * Nama tindakan dan nama pemberi penjelasan DIBEKUKAN ke dalam `isi`.
     *
     * Templatnya hanya berbunyi "tindakan tersebut"; nama tindakan dan nama
     * dokter dulu baru digabungkan saat dokumen ditampilkan, dari master
     * data. Mengganti nama tindakan atau memperbaiki nama staf lalu diam-diam
     * mengubah dokumen yang sudah ditandatangani pasien — padahal §4
     * mewajibkan kalimat persetujuan disimpan apa adanya.
     */
    let isi = input.isi;
    const rincian: string[] = [];
    if (input.procedure_id) {
      const [p] = await conn.execute<RowDataPacket[]>(
        `SELECT kode, nama FROM medical_procedures WHERE id = ?`,
        [input.procedure_id],
      );
      if (!p[0]) throw new Error("Tindakan tidak ditemukan.");
      rincian.push(`Tindakan: ${String(p[0].nama)} (${String(p[0].kode)})`);
    }
    if (input.penjelasan_oleh) {
      const [u] = await conn.execute<RowDataPacket[]>(
        `SELECT nama FROM users WHERE id = ?`,
        [input.penjelasan_oleh],
      );
      if (!u[0]) throw new Error("Pemberi penjelasan tidak ditemukan.");
      rincian.push(`Penjelasan diberikan oleh: ${String(u[0].nama)}`);
    }
    if (rincian.length > 0) isi = `${isi}\n\n${rincian.join("\n")}`;

    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO consents
         (site_id, visit_id, patient_id, jenis, judul, isi, penjelasan_oleh,
          procedure_id, penandatangan, hubungan, saksi_nama, status, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        siteId, input.visit_id, Number(visit.patient_id), input.jenis,
        input.judul, isi, input.penjelasan_oleh, input.procedure_id,
        input.penandatangan, input.hubungan, input.saksi_nama ?? null,
        input.status, userId,
      ],
    );
    return res.insertId;
  });
}

/**
 * Persetujuan **dibatalkan, tidak dihapus**.
 *
 * Alasannya sama dengan rekam medis (docs/DATABASE.md §3.10): dokumen yang
 * pernah ditandatangani pasien adalah peristiwa yang benar-benar terjadi.
 * Yang bisa dilakukan hanyalah menyatakan bahwa ia tidak lagi berlaku, dan
 * menyebut sebabnya.
 */
export async function batalkanConsent(
  id: number,
  siteId: number,
  alasan: string,
): Promise<void> {
  const res = await execute(
    `UPDATE consents SET status = 'dibatalkan', alasan_batal = ?
      WHERE id = ? AND site_id = ? AND status <> 'dibatalkan'`,
    [alasan, id, siteId],
  );
  if (res.affectedRows === 0) {
    throw new Error("Persetujuan tidak ditemukan atau sudah dibatalkan.");
  }
}

/**
 * Templat kalimat persetujuan.
 *
 * Disimpan sebagai konstanta kode, bukan tabel master. Alasannya: yang
 * disimpan di `consents.isi` adalah kalimat UTUH hasil isian, sehingga
 * templat tidak pernah dirujuk oleh dokumen yang sudah ditandatangani.
 * Sebuah tabel master di sini hanya akan memberi kesan bahwa mengubah
 * templat mengubah dokumen lama — kesan yang justru harus dihindari.
 */
export const TEMPLAT_CONSENT: Record<string, { judul: string; isi: string }> = {
  umum: {
    judul: "Persetujuan Umum Pelayanan Kesehatan",
    isi:
      "Saya menyatakan bersedia menjalani pemeriksaan, pengobatan, dan " +
      "tindakan kedokteran dasar di Klinik Pratama Sahabat Gamma sesuai " +
      "kebutuhan medis saya. Saya memahami bahwa untuk tindakan tertentu " +
      "akan dimintakan persetujuan tersendiri setelah diberikan penjelasan. " +
      "Saya juga menyetujui pemrosesan data kesehatan saya untuk keperluan " +
      "pelayanan, penagihan, dan pelaporan sesuai ketentuan yang berlaku.",
  },
  tindakan: {
    judul: "Persetujuan Tindakan Kedokteran",
    isi:
      "Setelah mendapat penjelasan mengenai diagnosis, tujuan tindakan, " +
      "tata cara, risiko, komplikasi yang mungkin terjadi, serta alternatif " +
      "tindakan lain beserta risikonya, dan setelah diberi kesempatan " +
      "bertanya, saya menyatakan MENYETUJUI dilakukannya tindakan tersebut.",
  },
  penolakan: {
    judul: "Penolakan Tindakan Kedokteran",
    isi:
      "Setelah mendapat penjelasan mengenai diagnosis, tujuan tindakan, " +
      "risiko bila tindakan tidak dilakukan, serta alternatif yang tersedia, " +
      "saya menyatakan MENOLAK dilakukannya tindakan tersebut. Saya " +
      "memahami dan menerima segala akibat dari keputusan saya ini, dan " +
      "membebaskan klinik beserta tenaga kesehatannya dari tanggung jawab " +
      "atas akibat penolakan tersebut.",
  },
  privasi: {
    judul: "Persetujuan Pelepasan Informasi Kesehatan",
    isi:
      "Saya menyetujui pemberian informasi mengenai kondisi kesehatan saya " +
      "kepada pihak yang saya sebutkan di bawah ini, untuk keperluan yang " +
      "saya nyatakan. Saya memahami bahwa persetujuan ini dapat saya tarik " +
      "kembali sewaktu-waktu secara tertulis.",
  },
};

// =====================================================================
// Insiden Keselamatan Pasien (IKP)
// =====================================================================

export type IkpRow = RowDataPacket & {
  id: number;
  no_ikp: string;
  visit_id: number | null;
  patient_id: number | null;
  pasien: string | null;
  no_rm: string | null;
  tanggal: string;
  waktu: string | null;
  lokasi: string;
  jenis: string;
  grading: string | null;
  kronologi: string;
  dampak: string | null;
  tindakan_segera: string | null;
  analisis: string | null;
  rekomendasi: string | null;
  status: string;
  pelapor: string | null;
  ditutup_oleh: string | null;
  ditutup_at: string | null;
  created_at: string;
};

const SELECT_IKP = `
  SELECT k.id, k.no_ikp, k.visit_id, k.patient_id,
         pa.nama AS pasien, pa.no_rm,
         k.tanggal, k.waktu, k.lokasi, k.jenis, k.grading, k.kronologi,
         k.dampak, k.tindakan_segera, k.analisis, k.rekomendasi, k.status,
         pl.nama AS pelapor, tu.nama AS ditutup_oleh, k.ditutup_at, k.created_at
    FROM patient_safety_incidents k
    LEFT JOIN patients pa ON pa.id = k.patient_id
    LEFT JOIN users pl    ON pl.id = k.pelapor_id
    LEFT JOIN users tu    ON tu.id = k.ditutup_by
`;

export async function daftarIkp(
  siteId: number | null,
  opts: {
    status?: string; dari?: string; sampai?: string; limit?: number;
    /** Hanya laporan milik pelapor ini (peran selain Admin Cabang/Super Admin). */
    pelaporId?: number;
  } = {},
): Promise<IkpRow[]> {
  return query<IkpRow>(
    `${SELECT_IKP}
      WHERE (? IS NULL OR k.site_id = ?)
        AND (? IS NULL OR k.pelapor_id = ?)
        AND (? IS NULL OR k.status = ?)
        AND (? IS NULL OR k.tanggal >= ?)
        AND (? IS NULL OR k.tanggal <= ?)
      ORDER BY FIELD(k.status,'baru','investigasi','selesai','ditutup'),
               FIELD(k.grading,'merah','kuning','hijau','biru'),
               k.tanggal DESC, k.id DESC
      LIMIT ${limitAman(opts.limit ?? 100, 100, 500)}`,
    [
      siteId, siteId,
      opts.pelaporId ?? null, opts.pelaporId ?? null,
      opts.status ?? null, opts.status ?? null,
      opts.dari ?? null, opts.dari ?? null,
      opts.sampai ?? null, opts.sampai ?? null,
    ],
  );
}

export async function getIkp(
  id: number,
  siteId: number | null,
): Promise<IkpRow | null> {
  return queryOne<IkpRow>(
    `${SELECT_IKP} WHERE k.id = ? AND (? IS NULL OR k.site_id = ?)`,
    [id, siteId, siteId],
  );
}

export async function laporkanIkp(
  input: IkpInput,
  siteId: number,
  userId: number,
): Promise<{ id: number; noIkp: string }> {
  return transaction(async (conn) => {
    let patientId: number | null = null;
    if (input.visit_id) {
      const [v] = await conn.execute<RowDataPacket[]>(
        `SELECT patient_id, site_id FROM visits WHERE id = ?`,
        [input.visit_id],
      );
      if (!v[0]) throw new Error("Kunjungan tidak ditemukan.");
      if (Number(v[0].site_id) !== siteId) {
        throw new Error("Kunjungan ini bukan milik cabang Anda.");
      }
      patientId = Number(v[0].patient_id);
    }

    const [siteRows] = await conn.execute<RowDataPacket[]>(
      `SELECT kode FROM sites WHERE id = ?`,
      [siteId],
    );
    const kode = String(siteRows[0]?.kode ?? "KPSG");
    const periode = periodeSekarang();
    const nomor = await nextSequence(conn, siteId, "ikp", periode);
    const noIkp = `${kode}/IKP/${periode}/${String(nomor).padStart(4, "0")}`;

    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO patient_safety_incidents
         (site_id, no_ikp, visit_id, patient_id, tanggal, waktu, lokasi, jenis,
          kronologi, dampak, tindakan_segera, pelapor_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        siteId, noIkp, input.visit_id, patientId, input.tanggal,
        input.waktu ?? null, input.lokasi, input.jenis, input.kronologi,
        input.dampak ?? null, input.tindakan_segera ?? null,
        /*
         * Pelaporan anonim menyimpan NULL, bukan id yang disembunyikan di
         * layar. Penyamaran yang hanya di tampilan bukan anonim — dan
         * begitu satu orang tahu datanya tetap tersimpan, tidak ada lagi
         * yang mau melapor.
         */
        input.anonim ? null : userId,
      ],
    );

    /*
     * Insiden sentinel dan KTD diberitahukan SEGERA ke Admin Cabang.
     * Sisanya masuk daftar untuk ditinjau berkala — memberitahukan setiap
     * kondisi berpotensi cedera secara mendesak akan membuat pemberitahuan
     * yang benar-benar mendesak ikut diabaikan.
     */
    if (input.jenis === "sentinel" || input.jenis === "ktd") {
      await kirimNotifikasi(
        { roleCode: "admin_cabang", siteId },
        {
          jenis: "ikp_baru",
          judul:
            input.jenis === "sentinel"
              ? `Insiden SENTINEL dilaporkan — ${noIkp}`
              : `Kejadian tidak diharapkan dilaporkan — ${noIkp}`,
          pesan: `${input.lokasi}, ${input.tanggal}. Perlu grading dan investigasi.`,
          link: "/mutu/ikp",
          siteId,
        },
        conn,
      );
    }

    return { id: res.insertId, noIkp };
  });
}

export async function tindakLanjutIkp(
  id: number,
  siteId: number,
  input: TindakLanjutIkpInput,
  userId: number,
): Promise<void> {
  await transaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT status FROM patient_safety_incidents
        WHERE id = ? AND site_id = ? FOR UPDATE`,
      [id, siteId],
    );
    if (!rows[0]) throw new Error("Laporan insiden tidak ditemukan.");
    if (rows[0].status === "ditutup") {
      throw new Error(
        "Laporan yang sudah ditutup tidak bisa diubah. Buka laporan baru bila ada temuan tambahan.",
      );
    }

    const menutup = input.status === "ditutup";
    await conn.execute(
      `UPDATE patient_safety_incidents
          SET grading = ?, analisis = ?, rekomendasi = ?, status = ?,
              ditutup_by = ?, ditutup_at = ?
        WHERE id = ?`,
      [
        input.grading, input.analisis ?? null, input.rekomendasi ?? null,
        input.status,
        menutup ? userId : null,
        menutup ? new Date() : null,
        id,
      ],
    );
  });
}

export type RekapIkp = {
  total: number;
  perJenis: Record<string, number>;
  perGrading: Record<string, number>;
  belumDigrading: number;
  /** Grading kuning/merah yang belum punya analisis akar masalah. */
  tanpaRca: number;
  terbuka: number;
};

/**
 * Rekap untuk laporan mutu.
 *
 * `tanpaRca` adalah angka yang paling perlu dilihat pimpinan: insiden
 * risiko tinggi yang dicatat tetapi tidak pernah dianalisis. Insiden yang
 * hanya diarsipkan tidak mencegah insiden berikutnya — dan itulah satu-satunya
 * alasan pencatatan ini ada.
 */
export async function rekapIkp(
  siteId: number,
  dari: string,
  sampai: string,
): Promise<RekapIkp> {
  const rows = await query<RowDataPacket & {
    jenis: string; grading: string | null; status: string;
    analisis: string | null; n: number;
  }>(
    `SELECT jenis, grading, status, analisis, COUNT(*) AS n
       FROM patient_safety_incidents
      WHERE site_id = ? AND tanggal BETWEEN ? AND ?
      GROUP BY jenis, grading, status, analisis`,
    [siteId, dari, sampai],
  );

  const perJenis: Record<string, number> = {};
  const perGrading: Record<string, number> = {};
  let total = 0;
  let belumDigrading = 0;
  let tanpaRca = 0;
  let terbuka = 0;

  for (const r of rows) {
    const n = Number(r.n);
    total += n;
    perJenis[r.jenis] = (perJenis[r.jenis] ?? 0) + n;
    if (r.grading) perGrading[r.grading] = (perGrading[r.grading] ?? 0) + n;
    else belumDigrading += n;
    if ((r.grading === "kuning" || r.grading === "merah") && !r.analisis) tanpaRca += n;
    if (r.status !== "ditutup") terbuka += n;
  }

  return { total, perJenis, perGrading, belumDigrading, tanpaRca, terbuka };
}
