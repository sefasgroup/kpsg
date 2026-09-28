"use server";

import { revalidatePath } from "next/cache";
import { auditLog, requireRole } from "@/lib/auth";
import { BerkasDitolak, hapusBerkas, simpanBerkas } from "@/lib/berkas";
import {
  ajukanCuti,
  catatAbsensi,
  nonaktifkanJadwal,
  putuskanCuti,
  putuskanPengecualian,
  setStatusAbsensi,
  tambahJadwal,
  tambahPengecualian,
} from "@/lib/hr";
import { cutiSchema, jadwalSchema, pengecualianSchema } from "@/lib/validations/hr";

const ROLE_HR = ["admin_cabang", "super_admin"] as const;

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

function gagal(err: unknown, fallback: string): ActionResult<never> {
  return { ok: false, error: err instanceof Error ? err.message : fallback };
}

// --- Jadwal praktik ---------------------------------------------------

export async function tambahJadwalAction(raw: unknown): Promise<ActionResult> {
  const session = await requireRole(...ROLE_HR);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  const parsed = jadwalSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  try {
    const id = await tambahJadwal(parsed.data, siteId, session.id);
    await auditLog({
      session,
      aksi: "create",
      entity: "doctor_schedules",
      entityId: id,
      after: parsed.data,
    });
    revalidatePath("/hr/jadwal");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal menambah jadwal.");
  }
}

export async function hapusJadwalAction(id: number): Promise<ActionResult> {
  const session = await requireRole(...ROLE_HR);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  try {
    await nonaktifkanJadwal(id, siteId);
    await auditLog({ session, aksi: "delete", entity: "doctor_schedules", entityId: id });
    revalidatePath("/hr/jadwal");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal menghapus jadwal.");
  }
}

// --- Pengecualian & dokter pengganti ---------------------------------

export async function tambahPengecualianAction(raw: unknown): Promise<ActionResult> {
  const session = await requireRole(...ROLE_HR);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  const parsed = pengecualianSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  try {
    const id = await tambahPengecualian(parsed.data, siteId, session.id);
    await auditLog({
      session,
      aksi: "create",
      entity: "schedule_exceptions",
      entityId: id,
      after: parsed.data,
    });
    revalidatePath("/hr/pengganti");
    revalidatePath("/pendaftaran");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal menyimpan pengecualian.");
  }
}

export async function putuskanPengecualianAction(
  id: number,
  setuju: boolean,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_HR);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  try {
    await putuskanPengecualian(id, siteId, session.id, setuju);
    await auditLog({
      session,
      aksi: setuju ? "approve" : "reject",
      entity: "schedule_exceptions",
      entityId: id,
    });
    revalidatePath("/hr/pengganti");
    // Keputusan ini langsung mengubah daftar dokter di layar pendaftaran.
    revalidatePath("/pendaftaran");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal memutuskan pengecualian.");
  }
}

// --- Cuti & izin ------------------------------------------------------

/**
 * Pengajuan cuti, dengan lampiran opsional (mis. surat dokter).
 *
 * Menerima `FormData` — berkas tidak bisa dikirim lewat objek biasa ke
 * Server Action. Berkasnya disimpan LEBIH DULU; bila penyimpanan pengajuan
 * gagal, berkas yatim itu dihapus lagi supaya `storage/` tidak menumpuk
 * lampiran yang tidak dirujuk siapa pun.
 */
export async function ajukanCutiAction(form: FormData): Promise<ActionResult> {
  const session = await requireRole(...ROLE_HR);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  const raw = Object.fromEntries(
    [...form.entries()].filter(([k]) => k !== "lampiran"),
  );
  const parsed = cutiSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  const berkas = form.get("lampiran");
  let kunci: string | null = null;

  if (berkas instanceof File && berkas.size > 0) {
    try {
      kunci = (await simpanBerkas(berkas, "lampiran")).kunci;
    } catch (err) {
      if (err instanceof BerkasDitolak) {
        return { ok: false, error: err.message, field: "lampiran" };
      }
      return { ok: false, error: "Gagal menyimpan lampiran." };
    }
  }

  try {
    const id = await ajukanCuti({ ...parsed.data, lampiran_path: kunci }, siteId);
    await auditLog({
      session,
      aksi: "create",
      entity: "leave_requests",
      entityId: id,
      after: parsed.data,
    });
    revalidatePath("/hr/cuti");
    return { ok: true, data: undefined };
  } catch (err) {
    await hapusBerkas(kunci);
    return gagal(err, "Gagal mengajukan cuti.");
  }
}

export async function putuskanCutiAction(
  id: number,
  setuju: boolean,
  catatan?: string,
): Promise<ActionResult<{ pengecualianDibuat: number }>> {
  const session = await requireRole(...ROLE_HR);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  try {
    const hasil = await putuskanCuti(id, siteId, session.id, setuju, catatan);
    await auditLog({
      session,
      aksi: setuju ? "approve" : "reject",
      entity: "leave_requests",
      entityId: id,
      after: hasil,
    });
    revalidatePath("/hr/cuti");
    revalidatePath("/hr/pengganti");
    revalidatePath("/pendaftaran");
    return { ok: true, data: hasil };
  } catch (err) {
    return gagal(err, "Gagal memutuskan pengajuan.");
  }
}

// --- Absensi ----------------------------------------------------------

export async function absenAction(
  userId: number,
  tanggal: string,
  aksi: "masuk" | "pulang",
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_HR);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  try {
    await catatAbsensi(siteId, userId, tanggal, aksi);
    await auditLog({
      session,
      aksi: `absen_${aksi}`,
      entity: "attendances",
      entityId: userId,
      after: { tanggal },
    });
    revalidatePath("/hr/absensi");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal mencatat absensi.");
  }
}

export async function setStatusAbsensiAction(
  userId: number,
  tanggal: string,
  status: string,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_HR);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  try {
    await setStatusAbsensi(siteId, userId, tanggal, status);
    await auditLog({
      session,
      aksi: "update",
      entity: "attendances",
      entityId: userId,
      after: { tanggal, status },
    });
    revalidatePath("/hr/absensi");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal mengubah status absensi.");
  }
}
