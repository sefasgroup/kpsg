import "server-only";
import type { RowDataPacket } from "mysql2";
import { execute, nextSequence, query, queryOne, transaction, limitAman } from "./db";
import type { PatientInput } from "./validations/patient";

export type PatientRow = RowDataPacket & {
  id: number;
  no_rm: string;
  nik: string;
  nama: string;
  tanggal_lahir: string;
  jenis_kelamin: "L" | "P";
  alamat: string | null;
  telepon: string | null;
  jenis_pasien: string;
  /** Penjamin bawaan pasien — titik awal isian kunjungan, bukan pengikat. */
  payer_id: number | null;
  no_anggota: string | null;
  site_id: number;
  site_nama: string | null;
  alergi: string | null;
};

const SELECT_PASIEN = `
  SELECT p.id, p.no_rm, p.nik, p.nama, p.tanggal_lahir, p.jenis_kelamin,
         p.alamat, p.telepon, p.jenis_pasien, p.payer_id, p.no_anggota, p.site_id,
         s.nama AS site_nama,
         (SELECT GROUP_CONCAT(a.nama_alergen SEPARATOR ', ')
            FROM patient_allergies a
           WHERE a.patient_id = p.id AND a.is_active = 1) AS alergi
    FROM patients p
    LEFT JOIN sites s ON s.id = p.site_id
`;

/**
 * Pencarian pasien untuk frontdesk.
 *
 * Sengaja LINTAS CABANG: satu NIK = satu pasien di seluruh jaringan
 * (docs/DATABASE.md §3.7). Pasien yang pernah berobat di cabang lain harus
 * ketemu, bukan dibuatkan RM ganda.
 */
export async function cariPasien(keyword: string, limit = 20): Promise<PatientRow[]> {
  const q = keyword.trim();
  if (q.length < 2) return [];

  // NIK dan No. RM dicocokkan persis dari awal; nama dicocokkan di mana saja.
  return query<PatientRow>(
    `${SELECT_PASIEN}
      WHERE p.is_active = 1
        AND (p.nik LIKE ? OR p.no_rm LIKE ? OR p.nama LIKE ?)
      ORDER BY (p.nik = ?) DESC, p.nama
      LIMIT ${limitAman(limit)}`,
    [`${q}%`, `${q}%`, `%${q}%`, q],
  );
}

export async function getPasien(id: number): Promise<PatientRow | null> {
  return queryOne<PatientRow>(`${SELECT_PASIEN} WHERE p.id = ?`, [id]);
}

export async function getPasienByNik(nik: string): Promise<PatientRow | null> {
  return queryOne<PatientRow>(`${SELECT_PASIEN} WHERE p.nik = ?`, [nik]);
}

/**
 * Membuat pasien baru beserta No. RM-nya.
 *
 * No. RM diambil dari `sequences` di dalam transaksi yang sama agar dua
 * petugas yang mendaftar bersamaan tidak mendapat nomor kembar
 * (docs/DATABASE.md §3.8).
 */
export async function buatPasien(
  input: PatientInput,
  siteId: number,
  userId: number,
): Promise<{ id: number; no_rm: string }> {
  return transaction(async (conn) => {
    const [siteRows] = await conn.execute<RowDataPacket[]>(
      `SELECT kode FROM sites WHERE id = ?`,
      [siteId],
    );
    const kodeSite = String(siteRows[0]?.kode ?? "KPSG");

    const nomor = await nextSequence(conn, siteId, "rm");
    const noRm = `${kodeSite}-${String(nomor).padStart(6, "0")}`;

    const [res] = await conn.execute<import("mysql2").ResultSetHeader>(
      `INSERT INTO patients
         (site_id, no_rm, nik, no_kk, nama, tempat_lahir, tanggal_lahir, jenis_kelamin,
          gol_darah, agama, status_perkawinan, pendidikan, pekerjaan,
          alamat, rt, rw, kelurahan, kecamatan, kota, provinsi,
          telepon, pj_nama, pj_hubungan, pj_telepon, jenis_pasien, no_bpjs, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        siteId, noRm, input.nik, input.no_kk ?? null, input.nama,
        input.tempat_lahir ?? null, input.tanggal_lahir, input.jenis_kelamin,
        input.gol_darah ?? null, input.agama ?? null,
        input.status_perkawinan ?? null, input.pendidikan ?? null,
        input.pekerjaan ?? null,
        input.alamat ?? null, input.rt ?? null, input.rw ?? null,
        input.kelurahan ?? null, input.kecamatan ?? null, input.kota ?? null,
        input.provinsi ?? null, input.telepon ?? null,
        input.pj_nama ?? null, input.pj_hubungan ?? null, input.pj_telepon ?? null,
        input.jenis_pasien, input.no_bpjs ?? null, userId,
      ],
    );

    return { id: res.insertId, no_rm: noRm };
  });
}

export async function hitungPasien(siteId: number | null): Promise<number> {
  const row = await queryOne<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM patients
      WHERE is_active = 1 AND (? IS NULL OR site_id = ?)`,
    [siteId, siteId],
  );
  return Number(row?.n ?? 0);
}

/** Menonaktifkan pasien (rekam medis tidak pernah dihapus — DATABASE §3.10). */
export async function nonaktifkanPasien(id: number) {
  await execute(`UPDATE patients SET is_active = 0 WHERE id = ?`, [id]);
}
