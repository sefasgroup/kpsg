"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auditLog, requireRole } from "@/lib/auth";
import { getProfilCabang, simpanProfilCabang } from "@/lib/laporan";

const teks = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v === "" ? undefined : v));

/**
 * `kode` sengaja tidak ada di skema ini. Kode cabang adalah awalan seluruh
 * nomor dokumen yang sudah terbit (No. RM, invoice, resep) — mengubahnya
 * membuat dokumen lama dan baru tampak berasal dari cabang berbeda.
 * Perubahan kode hanya bisa dilakukan Super Admin lewat menu Cabang.
 */
const profilSchema = z.object({
  nama: z.string().trim().min(2, "Nama cabang wajib diisi").max(150),
  nama_legal: teks(200),
  no_izin_klinik: teks(100),
  npwp: teks(30),
  alamat: teks(500),
  kelurahan: teks(100),
  kecamatan: teks(100),
  kota: teks(100),
  provinsi: teks(100),
  kode_pos: teks(10),
  telepon: teks(30),
  email: z
    .union([z.literal(""), z.string().trim().email("Format email tidak valid")])
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
  header_cetak: teks(500),
  footer_cetak: teks(500),
});

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; field?: string };

export async function simpanProfilAction(raw: unknown): Promise<ActionResult> {
  const session = await requireRole("admin_cabang", "super_admin");
  if (!session.siteId) {
    return { ok: false, error: "Pilih cabang terlebih dahulu." };
  }

  const parsed = profilSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  try {
    // Nilai lama ikut dicatat: identitas cabang tercetak di setiap dokumen
    // medis, jadi perubahannya harus bisa ditelusuri.
    const sebelum = await getProfilCabang(session.siteId);
    await simpanProfilCabang(session.siteId, parsed.data);
    await auditLog({
      session,
      aksi: "update",
      entity: "sites",
      entityId: session.siteId,
      before: sebelum,
      after: parsed.data,
    });
    revalidatePath("/profil-cabang");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal menyimpan profil cabang.",
    };
  }
}
