"use server";

import { revalidatePath } from "next/cache";
import { auditLog, requireRole, tolakSuperAdmin } from "@/lib/auth";
import { batalkanConsent, simpanConsent } from "@/lib/kepatuhan";
import { consentSchema } from "@/lib/validations/kepatuhan";

/**
 * Persetujuan dicatat oleh peran KLINIS — dokter dan perawat.
 *
 * `penjelasan_oleh` dipaksa menjadi pengguna yang sedang masuk, bukan nilai
 * dari formulir. Kolom itu menyatakan siapa yang memberi penjelasan sebelum
 * pasien setuju; kalau bisa dipilih dari daftar, ia akan berisi nama yang
 * tampak paling pantas alih-alih nama yang benar — dan justru kolom inilah
 * yang ditanya kalau kelak terjadi sengketa.
 */
const ROLE = ["dokter", "perawat", "super_admin"] as const;

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

export async function simpanConsentAction(
  raw: unknown,
): Promise<ActionResult<{ id: number }>> {
  const session = await requireRole(...ROLE);
  const tolak = tolakSuperAdmin(session);
  if (tolak) return tolak;
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  const isi = raw as Record<string, unknown>;
  const parsed = consentSchema.safeParse({
    ...isi,
    penjelasan_oleh: session.id,
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  try {
    const id = await simpanConsent(parsed.data, siteId, session.id);
    await auditLog({
      session,
      aksi: "create",
      entity: "consents",
      entityId: id,
      after: {
        jenis: parsed.data.jenis,
        judul: parsed.data.judul,
        status: parsed.data.status,
        penandatangan: parsed.data.penandatangan,
      },
    });
    revalidatePath(`/rme/${parsed.data.visit_id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal menyimpan persetujuan.",
    };
  }
}

export async function batalkanConsentAction(
  id: number,
  alasan: string,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE);
  const tolak = tolakSuperAdmin(session);
  if (tolak) return tolak;
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };
  if (alasan.trim().length < 3) {
    return { ok: false, error: "Alasan wajib diisi." };
  }

  try {
    await batalkanConsent(id, siteId, alasan.trim());
    await auditLog({
      session, aksi: "void", entity: "consents", entityId: id, after: { alasan },
    });
    revalidatePath("/rme");
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal membatalkan persetujuan.",
    };
  }
}
