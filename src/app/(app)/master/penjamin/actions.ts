"use server";

import { revalidatePath } from "next/cache";
import { auditLog, requireRole } from "@/lib/auth";
import {
  hapusTarifPenjamin,
  nonaktifkanPenjamin,
  simpanPenjamin,
  simpanTarifPenjamin,
} from "@/lib/penjamin";
import { penjaminSchema, tarifPenjaminSchema } from "@/lib/validations/penjamin";

/**
 * Master penjamin adalah data GLOBAL — hanya Super Admin.
 *
 * Alasannya bukan hierarki: kontrak dengan sebuah perusahaan berlaku untuk
 * seluruh jaringan, dan tarif kontrak yang berbeda antar cabang untuk
 * penjamin yang sama akan membuat berkas klaim saling bertentangan.
 */
const ROLE = ["super_admin"] as const;

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

function gagal(err: unknown, fallback: string): ActionResult<never> {
  const pesan = err instanceof Error ? err.message : fallback;
  // Bentrok kode penjamin diterjemahkan; pesan MySQL mentah tidak berarti
  // apa pun bagi orang yang sedang mengisi formulir.
  if (/Duplicate entry/i.test(pesan) && /uq_payer_kode/i.test(pesan)) {
    return { ok: false, error: "Kode penjamin ini sudah dipakai.", field: "kode" };
  }
  return { ok: false, error: pesan };
}

export async function simpanPenjaminAction(
  raw: unknown,
  id?: number,
): Promise<ActionResult<{ id: number }>> {
  const session = await requireRole(...ROLE);

  const parsed = penjaminSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  try {
    const idBaru = await simpanPenjamin(parsed.data, id);
    await auditLog({
      session,
      aksi: id ? "update" : "create",
      entity: "payers",
      entityId: idBaru,
      after: parsed.data,
    });
    revalidatePath("/master/penjamin");
    return { ok: true, data: { id: idBaru } };
  } catch (err) {
    return gagal(err, "Gagal menyimpan penjamin.");
  }
}

export async function nonaktifkanPenjaminAction(id: number): Promise<ActionResult> {
  const session = await requireRole(...ROLE);
  try {
    await nonaktifkanPenjamin(id);
    await auditLog({
      session, aksi: "deactivate", entity: "payers", entityId: id,
    });
    revalidatePath("/master/penjamin");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal menonaktifkan penjamin.");
  }
}

export async function simpanTarifAction(raw: unknown): Promise<ActionResult> {
  const session = await requireRole(...ROLE);

  const parsed = tarifPenjaminSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  try {
    const id = await simpanTarifPenjamin(parsed.data);
    await auditLog({
      session, aksi: "upsert", entity: "payer_tariffs", entityId: id,
      after: parsed.data,
    });
    revalidatePath("/master/penjamin");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal menyimpan tarif kontrak.");
  }
}

export async function hapusTarifAction(
  id: number,
  payerId: number,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE);
  try {
    await hapusTarifPenjamin(id, payerId);
    await auditLog({
      session, aksi: "delete", entity: "payer_tariffs", entityId: id,
    });
    revalidatePath("/master/penjamin");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal menghapus tarif kontrak.");
  }
}
