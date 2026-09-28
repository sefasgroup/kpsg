"use server";

import { revalidatePath } from "next/cache";
import { auditLog, requireRole } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import {
  batalkanPembayaran,
  bukaShift,
  prosesPembayaran,
  shiftAktif,
  tutupShift,
} from "@/lib/cashier";
import { pembayaranSchema, tutupShiftSchema } from "@/lib/validations/cashier";

const ROLE_KASIR = ["kasir", "super_admin"] as const;

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

async function pembulatanCabang(siteId: number): Promise<number> {
  const row = await queryOne<import("mysql2").RowDataPacket & { svalue: string }>(
    `SELECT svalue FROM settings WHERE skey = 'billing.pembulatan'
      AND (site_id = ? OR site_id IS NULL) ORDER BY site_id IS NULL LIMIT 1`,
    [siteId],
  );
  return Number(row?.svalue ?? 0);
}

export async function bayarAction(
  billingId: number,
  raw: unknown,
): Promise<ActionResult<{ total: number; kembalian: number; noInvoice: string }>> {
  const session = await requireRole(...ROLE_KASIR);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  const parsed = pembayaranSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  try {
    // Shift dibuka otomatis bila kasir lupa — lebih baik daripada menahan
    // antrean pasien, dan tetap tercatat sebagai shift dengan kas awal 0.
    const shift = await shiftAktif(siteId, session.id);
    const shiftId = shift?.id ?? (await bukaShift(siteId, session.id, 0));

    const hasil = await prosesPembayaran(
      billingId,
      siteId,
      session.id,
      shiftId,
      parsed.data,
      await pembulatanCabang(siteId),
    );

    await auditLog({
      session,
      aksi: "pay",
      entity: "billing_transactions",
      entityId: billingId,
      after: {
        no_invoice: hasil.noInvoice,
        total: hasil.total,
        metode: parsed.data.payment_method,
        ref: parsed.data.payment_ref ?? null,
      },
    });

    revalidatePath("/kasir");
    revalidatePath("/kasir/riwayat");
    return { ok: true, data: hasil };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal memproses pembayaran.",
    };
  }
}

export async function bukaShiftAction(kasAwal: number): Promise<ActionResult> {
  const session = await requireRole(...ROLE_KASIR);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  try {
    const id = await bukaShift(siteId, session.id, Math.max(0, kasAwal));
    await auditLog({
      session,
      aksi: "open_shift",
      entity: "cashier_shifts",
      entityId: id,
      after: { kas_awal: kasAwal },
    });
    revalidatePath("/kasir/tutup");
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal membuka shift.",
    };
  }
}

export async function tutupShiftAction(
  shiftId: number,
  raw: unknown,
): Promise<ActionResult<{ kasSistem: number; selisih: number }>> {
  const session = await requireRole(...ROLE_KASIR);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  const parsed = tutupShiftSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  try {
    const hasil = await tutupShift(
      shiftId,
      siteId,
      parsed.data.kas_akhir_fisik,
      parsed.data.catatan,
    );
    await auditLog({
      session,
      aksi: "close_shift",
      entity: "cashier_shifts",
      entityId: shiftId,
      after: hasil,
    });
    revalidatePath("/kasir/tutup");
    return { ok: true, data: hasil };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal menutup shift.",
    };
  }
}

/** Panjang minimum alasan pembatalan pembayaran. */
const MIN_ALASAN = 10;

/**
 * Membatalkan pembayaran yang sudah diproses.
 *
 * Alasannya wajib dan panjangnya dijaga: ini satu-satunya jejak mengapa uang
 * yang sudah masuk dikembalikan ke antrean, dan yang membacanya nanti adalah
 * penanggung jawab kas — bukan kasir yang mengetiknya.
 */
export async function batalkanPembayaranAction(
  billingId: number,
  alasan: string,
): Promise<ActionResult<{ noInvoice: string; total: number }>> {
  const session = await requireRole(...ROLE_KASIR);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  const teks = (alasan ?? "").trim();
  if (teks.length < MIN_ALASAN) {
    return {
      ok: false,
      error: `Tuliskan alasan pembatalan minimal ${MIN_ALASAN} karakter — ini satu-satunya catatan mengapa uang yang sudah diterima dikembalikan ke antrean.`,
    };
  }

  try {
    const hasil = await batalkanPembayaran(billingId, siteId, teks);
    await auditLog({
      session,
      aksi: "void_payment",
      entity: "billing_transactions",
      entityId: billingId,
      after: { no_invoice: hasil.noInvoice, total: hasil.total, alasan: teks },
    });
    revalidatePath("/kasir");
    revalidatePath(`/kasir/${billingId}`);
    revalidatePath("/kasir/riwayat");
    return { ok: true, data: hasil };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal membatalkan pembayaran.",
    };
  }
}
