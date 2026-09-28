"use server";

import { revalidatePath } from "next/cache";
import { auditLog, requireRole } from "@/lib/auth";
import {
  alergiPasien, cariBmhp, simpanPengkajian, tambahAlergi,
  type AlergiRow, type ItemBmhp,
} from "@/lib/nurse";
import { StokTidakCukupError } from "@/lib/stock";
import { alergiSchema, nurseAssessmentSchemaFinal } from "@/lib/validations/nurse";
import { queryOne } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

const ROLE_PERAWAT = ["perawat", "super_admin"] as const;

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

export async function cariBmhpAction(
  keyword: string,
): Promise<ActionResult<ItemBmhp[]>> {
  const session = await requireRole(...ROLE_PERAWAT);
  try {
    return { ok: true, data: await cariBmhp(keyword, session.siteId) };
  } catch {
    return { ok: false, error: "Gagal mencari BMHP." };
  }
}

/**
 * Mencatat alergi baru yang disebutkan pasien saat triase.
 *
 * Terpisah dari penyimpanan pengkajian dan langsung tersimpan, bukan menunggu
 * tombol Simpan: alergi adalah data keselamatan yang harus segera terlihat
 * dokter dan farmasi. Menahannya sampai form disimpan berarti perawat yang
 * menutup halaman tanpa menyimpan membuang informasi itu diam-diam.
 */
export async function tambahAlergiAction(
  visitId: number,
  raw: unknown,
): Promise<ActionResult<AlergiRow[]>> {
  const session = await requireRole(...ROLE_PERAWAT);

  const parsed = alergiSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  /*
   * Pasien ditentukan dari KUNJUNGAN, bukan dari id yang dikirim klien —
   * dan kunjungan itu harus milik cabang penggunanya. Menerima patientId
   * apa adanya akan memungkinkan perawat menempelkan alergi ke rekam medis
   * pasien mana pun, termasuk di cabang lain.
   */
  const visit = await queryOne<RowDataPacket & { patient_id: number }>(
    `SELECT patient_id FROM visits WHERE id = ? AND (? IS NULL OR site_id = ?)`,
    [visitId, session.siteId, session.siteId],
  );
  if (!visit) {
    return { ok: false, error: "Kunjungan tidak ditemukan di cabang Anda." };
  }
  const patientId = Number(visit.patient_id);

  try {
    const id = await tambahAlergi(patientId, parsed.data, session.id);

    await auditLog({
      session,
      aksi: "create",
      entity: "patient_allergies",
      entityId: id,
      after: { patient_id: patientId, ...parsed.data },
    });

    revalidatePath(`/pengkajian/${visitId}`);
    return { ok: true, data: await alergiPasien(patientId) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal menyimpan alergi.",
    };
  }
}

export async function simpanPengkajianAction(
  visitId: number,
  raw: unknown,
): Promise<ActionResult<{ totalBmhp: number }>> {
  const session = await requireRole(...ROLE_PERAWAT);

  const parsed = nurseAssessmentSchemaFinal.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  const siteId = session.siteId;
  if (!siteId) {
    return {
      ok: false,
      error: "Super Admin harus memilih cabang terlebih dahulu.",
    };
  }

  try {
    const hasil = await simpanPengkajian(visitId, siteId, session.id, parsed.data);

    await auditLog({
      session,
      aksi: "update",
      entity: "nurse_assessments",
      entityId: hasil.assessmentId,
      after: {
        visit_id: visitId,
        triase: parsed.data.triase,
        jumlah_bmhp: parsed.data.bmhp.length,
        total_bmhp: hasil.totalBmhp,
      },
    });

    revalidatePath("/pengkajian");
    revalidatePath("/bmhp");
    return { ok: true, data: { totalBmhp: hasil.totalBmhp } };
  } catch (err) {
    // Stok tidak cukup adalah kondisi yang wajar terjadi, bukan kegagalan
    // sistem — pesannya harus menyebut item dan sisa stoknya.
    if (err instanceof StokTidakCukupError) {
      return { ok: false, error: err.message, field: "bmhp" };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal menyimpan pengkajian.",
    };
  }
}
