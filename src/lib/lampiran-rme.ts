import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { execute, query, queryOne } from "./db";
import { BerkasDitolak, simpanBerkas, ukuranMaks } from "./berkas";

/**
 * Dokumen pendukung rekam medis: hasil USG dari luar, rontgen, surat rujukan
 * balik, hasil lab laboratorium lain, dan sejenisnya.
 *
 * Berkasnya disimpan di `storage/rekam/` lewat `simpanBerkas()`; yang masuk
 * database hanya kuncinya. Satu-satunya jalan membacanya kembali adalah
 * `app/api/berkas/`, yang memeriksa sesi DAN hak atas berkas itu — lihat
 * catatan panjang di src/lib/berkas.ts tentang mengapa tidak di `public/`.
 */

export const MAKS_DOKUMEN_SEKALI = 10;
export const MAKS_KETERANGAN = 255;

export type LampiranRme = RowDataPacket & {
  id: number;
  kunci: string;
  nama_asli: string;
  keterangan: string | null;
  mime: string;
  ukuran: number;
  created_at: string;
  uploaded_by: number;
  pengunggah: string;
};

export async function daftarLampiran(visitId: number): Promise<LampiranRme[]> {
  return query<LampiranRme>(
    `SELECT d.id, d.kunci, d.nama_asli, d.keterangan, d.mime, d.ukuran,
            d.uploaded_by, u.nama AS pengunggah,
            DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
       FROM visit_documents d
       JOIN users u ON u.id = d.uploaded_by
      WHERE d.visit_id = ? AND d.deleted_at IS NULL
      ORDER BY d.id`,
    [visitId],
  );
}

/** Dipakai `app/api/berkas/` untuk menentukan hak baca. */
export async function pemilikLampiran(
  kunci: string,
): Promise<{ siteId: number } | null> {
  const row = await queryOne<RowDataPacket & { site_id: number }>(
    `SELECT site_id FROM visit_documents WHERE kunci = ? AND deleted_at IS NULL`,
    [kunci],
  );
  return row ? { siteId: Number(row.site_id) } : null;
}

export type HasilUnggah = {
  tersimpan: number;
  ditolak: { nama: string; alasan: string }[];
};

/**
 * Mengunggah beberapa dokumen sekaligus, masing-masing dengan keterangannya.
 *
 * Berkas yang ditolak TIDAK menggagalkan yang lain. Dokter mengunggah lima
 * dokumen sekaligus; membatalkan seluruhnya hanya karena satu berkas
 * berformat salah berarti ia harus mengulang semuanya — dan pasien menunggu.
 * Yang gagal dilaporkan per berkas beserta alasannya.
 *
 * Tiap berkas disimpan ke disk lebih dulu, baru barisnya ditulis. Kalau
 * penulisan baris gagal, yang tertinggal hanyalah berkas yatim di storage —
 * jauh lebih baik daripada baris database yang menunjuk ke berkas yang tidak
 * pernah ada, karena yang kedua tampak sebagai dokumen yang hilang.
 */
export async function unggahLampiran(
  visitId: number,
  siteId: number,
  patientId: number,
  userId: number,
  berkas: { file: File; keterangan: string }[],
): Promise<HasilUnggah> {
  const ditolak: { nama: string; alasan: string }[] = [];
  let tersimpan = 0;

  for (const { file, keterangan } of berkas.slice(0, MAKS_DOKUMEN_SEKALI)) {
    const nama = namaAman(file.name);
    try {
      const hasil = await simpanBerkas(file, "rekam");
      await execute(
        `INSERT INTO visit_documents
           (site_id, visit_id, patient_id, kunci, nama_asli, keterangan,
            mime, ukuran, sha256, uploaded_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          siteId, visitId, patientId, hasil.kunci, nama,
          keterangan.trim().slice(0, MAKS_KETERANGAN) || null,
          mimeDari(hasil.ext), hasil.ukuran, hasil.sha256, userId,
        ],
      );
      tersimpan++;
    } catch (err) {
      ditolak.push({
        nama,
        alasan:
          err instanceof BerkasDitolak
            ? err.message
            : "Gagal menyimpan berkas.",
      });
    }
  }

  return { tersimpan, ditolak };
}

export async function ubahKeterangan(
  id: number,
  visitId: number,
  keterangan: string,
): Promise<void> {
  await execute(
    `UPDATE visit_documents SET keterangan = ?
      WHERE id = ? AND visit_id = ? AND deleted_at IS NULL`,
    [keterangan.trim().slice(0, MAKS_KETERANGAN) || null, id, visitId],
  );
}

/**
 * Menghapus dokumen — hanya menandainya, tidak membuang barisnya.
 *
 * Berkas fisiknya pun dibiarkan. Dokumen medis yang pernah masuk rekam medis
 * tidak boleh lenyap tanpa jejak; yang dibutuhkan dokter adalah dokumen itu
 * tidak lagi tampil sebagai bagian dari pemeriksaan, bukan penghancurannya.
 * Bila ada unggahan yang benar-benar harus dimusnahkan (mis. dokumen milik
 * pasien lain), itu keputusan sadar yang ditangani terpisah — bukan efek
 * samping dari tombol di layar.
 */
export async function hapusLampiran(
  id: number,
  visitId: number,
  userId: number,
): Promise<boolean> {
  const r = await execute(
    `UPDATE visit_documents SET deleted_at = NOW(), deleted_by = ?
      WHERE id = ? AND visit_id = ? AND deleted_at IS NULL`,
    [userId, id, visitId],
  );
  return r.affectedRows > 0;
}

/** Nama tampilan saja — TIDAK pernah dipakai sebagai jalur berkas. */
function namaAman(nama: string): string {
  const bersih = (nama || "dokumen")
    .replace(/[\r\n\t]/g, " ")
    .replace(/[/\\]/g, "-")
    .trim();
  return (bersih || "dokumen").slice(0, 255);
}

const mimeDari = (ext: string) =>
  ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg";

export const maksUkuranDokumen = () => ukuranMaks("rekam");
