"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { bolehKeCabang, setActiveSite } from "@/lib/session";

/**
 * Mengubah cabang aktif.
 *
 * Haknya diperiksa ulang di sini, bukan sekadar tidak diberi tombolnya:
 * Server Action bisa dipanggil langsung, dan cabang adalah batas isolasi
 * seluruh data. Pemeriksaan memakai daftar penugasan di dalam token
 * bertanda tangan, jadi tidak bisa dipalsukan dari klien.
 */
export async function pilihCabangAction(siteId: number | null): Promise<void> {
  const session = await requireSession();

  if (siteId !== null) {
    if (!bolehKeCabang(session, siteId)) {
      throw new Error("Anda tidak ditugaskan di cabang tersebut.");
    }

    const ada = await queryOne<import("mysql2").RowDataPacket & { id: number }>(
      `SELECT id FROM sites WHERE id = ? AND is_active = 1 AND deleted_at IS NULL`,
      [siteId],
    );
    if (!ada) throw new Error("Cabang tidak ditemukan atau tidak aktif.");
  } else if (session.role !== "super_admin") {
    // "Semua Cabang" hanya bermakna bagi Super Admin. Role operasional
    // harus selalu berada di satu cabang — itulah batas isolasi datanya.
    throw new Error("Pilih salah satu cabang penugasan Anda.");
  }

  await setActiveSite(siteId);
  revalidatePath("/", "layout");
}
