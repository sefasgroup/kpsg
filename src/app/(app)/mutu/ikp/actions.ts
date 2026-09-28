"use server";

import { revalidatePath } from "next/cache";
import { auditLog, requireRole, tolakSuperAdmin } from "@/lib/auth";
import { laporkanIkp, tindakLanjutIkp } from "@/lib/kepatuhan";
import { ikpSchema, tindakLanjutIkpSchema } from "@/lib/validations/kepatuhan";

/**
 * MELAPOR dibuka lebar, MENUTUP dibatasi.
 *
 * Siapa pun yang bekerja di lapangan boleh melaporkan insiden — perawat,
 * dokter, farmasi, lab, kasir. Laporan yang harus dititipkan lewat atasan
 * tidak akan pernah dibuat, dan insiden yang tidak dilaporkan tidak pernah
 * diperbaiki.
 *
 * Sebaliknya grading, analisis akar masalah, dan penutupan hanya boleh
 * dilakukan Admin Cabang: itu penilaian dan pertanggungjawaban manajemen,
 * bukan pekerjaan orang yang kebetulan melihat kejadiannya.
 */
const ROLE_LAPOR = [
  "admin_cabang",
  "dokter",
  "perawat",
  "petugas_lab",
  "farmasi",
  "kasir",
  "super_admin",
] as const;

const ROLE_TINDAK = ["admin_cabang", "super_admin"] as const;

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

function gagal(err: unknown, fallback: string): ActionResult<never> {
  return { ok: false, error: err instanceof Error ? err.message : fallback };
}

export async function laporkanIkpAction(
  raw: unknown,
): Promise<ActionResult<{ id: number; noIkp: string }>> {
  const session = await requireRole(...ROLE_LAPOR);
  const tolak = tolakSuperAdmin(session);
  if (tolak) return tolak;
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  const parsed = ikpSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  try {
    const hasil = await laporkanIkp(parsed.data, siteId, session.id);
    /*
     * Jejak audit TETAP ditulis meski laporannya anonim.
     *
     * Anonim berarti nama pelapor tidak muncul di layar dan tidak tersimpan
     * di barisnya — bukan berarti tidak ada jejak sama sekali. `audit_logs`
     * hanya bisa dibuka Super Admin, dan tanpa jejak itu kolom anonim jadi
     * pintu untuk melaporkan insiden palsu tanpa konsekuensi apa pun.
     */
    await auditLog({
      session,
      aksi: "create",
      entity: "patient_safety_incidents",
      entityId: hasil.id,
      after: { no_ikp: hasil.noIkp, jenis: parsed.data.jenis, anonim: parsed.data.anonim },
    });
    revalidatePath("/mutu/ikp");
    return { ok: true, data: hasil };
  } catch (err) {
    return gagal(err, "Gagal menyimpan laporan insiden.");
  }
}

export async function tindakLanjutIkpAction(
  id: number,
  raw: unknown,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_TINDAK);
  const tolak = tolakSuperAdmin(session);
  if (tolak) return tolak;
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  const parsed = tindakLanjutIkpSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  try {
    await tindakLanjutIkp(id, siteId, parsed.data, session.id);
    await auditLog({
      session,
      aksi: "update",
      entity: "patient_safety_incidents",
      entityId: id,
      after: parsed.data,
    });
    revalidatePath("/mutu/ikp");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal menyimpan tindak lanjut.");
  }
}
