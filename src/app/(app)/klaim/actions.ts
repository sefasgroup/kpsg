"use server";

import { revalidatePath } from "next/cache";
import { auditLog, requireRole } from "@/lib/auth";
import {
  ajukanKlaim,
  batalkanKlaim,
  buatKlaim,
  catatPembayaranKlaim,
  hapusKlaimDraft,
  verifikasiKlaim,
} from "@/lib/klaim";
import {
  bayarKlaimSchema,
  klaimBaruSchema,
  verifikasiKlaimSchema,
} from "@/lib/validations/klaim";

/**
 * Klaim ditangani Admin Cabang, bukan Kasir.
 *
 * Pemisahan ini sengaja: kasir memegang UANG TUNAI dari pasien, sedangkan
 * klaim adalah penagihan ke pihak ketiga yang uangnya masuk ke rekening
 * klinik. Satu orang yang bisa menerima tunai sekaligus menyatakan sebuah
 * klaim lunas bisa menutupi kekurangan kas dengan klaim fiktif — dan itulah
 * jenis kecurangan yang paling sulit ditemukan tanpa pemisahan tugas
 * (`CLAUDE.md` §2.1).
 */
const ROLE = ["admin_cabang", "super_admin"] as const;

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

function gagal(err: unknown, fallback: string): ActionResult<never> {
  return { ok: false, error: err instanceof Error ? err.message : fallback };
}

async function sesiCabang() {
  const session = await requireRole(...ROLE);
  return { session, siteId: session.siteId };
}

export async function buatKlaimAction(
  raw: unknown,
): Promise<ActionResult<{ id: number; noKlaim: string; jumlahBaris: number; total: number }>> {
  const { session, siteId } = await sesiCabang();
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  const parsed = klaimBaruSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  try {
    const hasil = await buatKlaim(parsed.data, siteId, session.id);
    await auditLog({
      session, aksi: "create", entity: "claims", entityId: hasil.id,
      after: { ...parsed.data, total: hasil.total, baris: hasil.jumlahBaris },
    });
    revalidatePath("/klaim");
    return { ok: true, data: hasil };
  } catch (err) {
    return gagal(err, "Gagal membuat klaim.");
  }
}

export async function ajukanKlaimAction(
  claimId: number,
): Promise<ActionResult<{ noKlaim: string; jatuhTempo: string }>> {
  const { session, siteId } = await sesiCabang();
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  try {
    const hasil = await ajukanKlaim(claimId, siteId, session.id);
    await auditLog({
      session, aksi: "submit", entity: "claims", entityId: claimId, after: hasil,
    });
    revalidatePath("/klaim");
    revalidatePath(`/klaim/${claimId}`);
    return { ok: true, data: hasil };
  } catch (err) {
    return gagal(err, "Gagal mengajukan klaim.");
  }
}

export async function verifikasiKlaimAction(
  claimId: number,
  raw: unknown,
): Promise<ActionResult<{ totalDisetujui: number; dikoreksi: number }>> {
  const { session, siteId } = await sesiCabang();
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  const parsed = verifikasiKlaimSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  try {
    const hasil = await verifikasiKlaim(claimId, siteId, parsed.data);
    await auditLog({
      session, aksi: "verify", entity: "claims", entityId: claimId, after: hasil,
    });
    revalidatePath(`/klaim/${claimId}`);
    revalidatePath("/klaim");
    return { ok: true, data: hasil };
  } catch (err) {
    return gagal(err, "Gagal menyimpan hasil verifikasi.");
  }
}

export async function bayarKlaimAction(
  claimId: number,
  raw: unknown,
): Promise<ActionResult<{ dibayar: number; sisa: number; lunas: boolean }>> {
  const { session, siteId } = await sesiCabang();
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  const parsed = bayarKlaimSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  try {
    const hasil = await catatPembayaranKlaim(claimId, siteId, parsed.data, session.id);
    await auditLog({
      session, aksi: "payment", entity: "claims", entityId: claimId,
      after: { ...parsed.data, ...hasil },
    });
    revalidatePath(`/klaim/${claimId}`);
    revalidatePath("/klaim");
    return { ok: true, data: hasil };
  } catch (err) {
    return gagal(err, "Gagal mencatat pembayaran klaim.");
  }
}

export async function batalkanKlaimAction(
  claimId: number,
  alasan: string,
): Promise<ActionResult<{ noKlaim: string; barisDilepas: number }>> {
  const { session, siteId } = await sesiCabang();
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };
  if (alasan.trim().length < 3) {
    return { ok: false, error: "Alasan pembatalan wajib diisi." };
  }

  try {
    const hasil = await batalkanKlaim(claimId, siteId, alasan.trim());
    await auditLog({
      session, aksi: "void", entity: "claims", entityId: claimId,
      after: { alasan, ...hasil },
    });
    revalidatePath("/klaim");
    revalidatePath(`/klaim/${claimId}`);
    return { ok: true, data: hasil };
  } catch (err) {
    return gagal(err, "Gagal membatalkan klaim.");
  }
}

export async function hapusKlaimDraftAction(claimId: number): Promise<ActionResult> {
  const { session, siteId } = await sesiCabang();
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  try {
    await hapusKlaimDraft(claimId, siteId);
    await auditLog({
      session, aksi: "delete", entity: "claims", entityId: claimId,
    });
    revalidatePath("/klaim");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal menghapus klaim draft.");
  }
}
