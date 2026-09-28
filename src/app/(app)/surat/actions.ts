"use server";

import { revalidatePath } from "next/cache";
import { auditLog, requireRole, tolakSuperAdmin } from "@/lib/auth";
import { kunjunganUntukSurat, terbitkanSurat, type KunjunganSurat } from "@/lib/dokumen";
import { suratSchema } from "@/lib/validations/dokumen";

/** Surat keterangan adalah wewenang klinis dokter (CLAUDE.md §2.1 poin 3). */
const ROLE_DOKTER = ["dokter", "super_admin"] as const;

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

export async function cariKunjunganAction(keyword: string): Promise<KunjunganSurat[]> {
  const session = await requireRole(...ROLE_DOKTER);
  return kunjunganUntukSurat(session.id, session.siteId, { keyword, hari: 30 });
}

export async function terbitkanSuratAction(
  raw: unknown,
): Promise<ActionResult<{ id: number; no_surat: string }>> {
  const session = await requireRole(...ROLE_DOKTER);
  const tolak = tolakSuperAdmin(session);
  if (tolak) return tolak;
  if (!session.siteId) {
    return { ok: false, error: "Pilih cabang terlebih dahulu." };
  }

  const parsed = suratSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  try {
    const hasil = await terbitkanSurat(parsed.data, session.siteId, session.id);
    await auditLog({
      session,
      aksi: "issue_certificate",
      entity: "medical_certificates",
      entityId: hasil.id,
      after: { no_surat: hasil.no_surat, jenis: parsed.data.jenis, visit_id: parsed.data.visit_id },
    });
    revalidatePath("/surat");
    return { ok: true, data: hasil };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal menerbitkan surat.",
    };
  }
}
