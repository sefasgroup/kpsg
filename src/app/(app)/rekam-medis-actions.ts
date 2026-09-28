"use server";

import { requireRole } from "@/lib/auth";
import { detailRekamMedis, type DataRekamMedis } from "@/lib/rekam-medis";

/**
 * Mengambil rekam medis satu kunjungan untuk dicetak.
 *
 * Diletakkan di tingkat (app), bukan di dalam salah satu rute, karena dipakai
 * dari dua layar: pemeriksaan dokter dan Riwayat Pasien.
 *
 * TIDAK disaring per cabang — sama seperti layar Riwayat Pasien itu sendiri,
 * yang memang lintas cabang (docs/DATABASE.md §3.7): satu NIK adalah satu
 * pasien di seluruh jaringan, dan rekam medisnya tidak boleh terputus saat ia
 * berobat di cabang lain. Penjagaannya ada pada peran — hanya dokter dan
 * Super Admin, sama dengan yang boleh membuka riwayat pasien.
 */
export async function ambilRekamMedisAction(
  visitId: number,
): Promise<
  { ok: true; data: DataRekamMedis } | { ok: false; error: string }
> {
  const session = await requireRole("dokter", "super_admin");

  if (!Number.isInteger(visitId) || visitId <= 0) {
    return { ok: false, error: "Kunjungan tidak sah." };
  }

  const data = await detailRekamMedis(visitId, session.nama);
  if (!data) return { ok: false, error: "Kunjungan tidak ditemukan." };

  return { ok: true, data };
}
