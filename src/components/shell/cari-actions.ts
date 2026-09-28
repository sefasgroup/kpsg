"use server";

import { requireSession } from "@/lib/auth";
import { cariCepat, type BarisCari } from "@/lib/pencarian";

/**
 * Peran dan cabang aktif diambil dari SESI, tidak pernah dari parameter.
 *
 * Kotak pencarian adalah satu-satunya tempat di aplikasi yang menyentuh
 * semua modul sekaligus, jadi justru di sinilah pembatas peran paling
 * mudah bocor kalau tujuannya ditentukan dari sisi klien.
 */
export async function cariCepatAction(q: string): Promise<BarisCari[]> {
  const session = await requireSession();
  return cariCepat(q, session.role, session.siteId);
}
