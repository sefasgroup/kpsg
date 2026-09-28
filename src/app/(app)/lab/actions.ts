"use server";

import { revalidatePath } from "next/cache";
import { auditLog, requireRole } from "@/lib/auth";
import {
  batalkanOrderLab, buatOrderLab, cariPanel, simpanHasilLab,
} from "@/lib/lab";
import { hasilLabSchema, orderLabSchema } from "@/lib/validations/lab";

const ROLE_LAB = ["petugas_lab", "super_admin"] as const;

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function simpanHasilAction(
  orderId: number,
  raw: unknown,
): Promise<ActionResult<{ jumlahKritis: number; selesai: boolean }>> {
  const session = await requireRole(...ROLE_LAB);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  const parsed = hasilLabSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  try {
    const hasil = await simpanHasilLab(orderId, siteId, session.id, parsed.data);

    await auditLog({
      session,
      aksi: parsed.data.finalkan ? "finalize" : "update",
      entity: "lab_results",
      entityId: orderId,
      after: {
        jumlah_parameter: parsed.data.hasil.filter((h) => h.nilai !== "").length,
        jumlah_kritis: hasil.jumlahKritis,
        status_kunjungan: hasil.statusKunjungan,
      },
    });

    revalidatePath("/lab");
    revalidatePath("/lab/riwayat");
    return {
      ok: true,
      data: { jumlahKritis: hasil.jumlahKritis, selesai: hasil.selesai },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal menyimpan hasil.",
    };
  }
}

/** Panjang minimum alasan pembatalan order. */
const MIN_ALASAN = 10;

/**
 * Petugas lab membatalkan order.
 *
 * Sebabnya nyata dan sering: sampel lisis, volume kurang, tabung pecah, atau
 * pasien menolak diambil darah. Sebelum ini satu-satunya yang bisa
 * membatalkan adalah dokter — yang justru tidak berada di ruang lab dan tidak
 * tahu sampelnya gagal.
 *
 * Dokter pemesan otomatis dinotifikasi di dalam `batalkanOrderLab()`; tanpa
 * itu ia menunggu hasil yang tidak akan pernah datang.
 */
export async function batalkanOrderAction(
  orderId: number,
  alasan: string,
): Promise<ActionResult<{ noOrder: string; statusKunjungan: string }>> {
  const session = await requireRole(...ROLE_LAB);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  const teks = (alasan ?? "").trim();
  if (teks.length < MIN_ALASAN) {
    return {
      ok: false,
      error: `Tuliskan alasan pembatalan minimal ${MIN_ALASAN} karakter — dokter pemesan hanya akan membaca kalimat ini.`,
    };
  }

  try {
    const hasil = await batalkanOrderLab(
      orderId, siteId, teks.slice(0, 200), session.id, session.nama,
    );
    await auditLog({
      session,
      aksi: "cancel",
      entity: "lab_orders",
      entityId: orderId,
      after: { no_order: hasil.noOrder, visit_id: hasil.visitId, alasan: teks },
    });
    revalidatePath("/lab");
    revalidatePath(`/lab/${orderId}`);
    revalidatePath(`/rme/${hasil.visitId}`);
    return {
      ok: true,
      data: { noOrder: hasil.noOrder, statusKunjungan: hasil.statusKunjungan },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal membatalkan order.",
    };
  }
}

/**
 * Pemeriksaan ATAS PERMINTAAN SENDIRI (APS) — diminta pasien, bukan dokter.
 *
 * Dibuat sebagai order TERSENDIRI dengan `ordered_by` petugas lab. Menempelkan
 * panel tambahan ke order dokter akan membuat rekam medis menunjukkan dokter
 * memesan sesuatu yang tidak pernah ia pesan — dan nama beserta No. SIP-nya
 * ada di bawah dokumen itu.
 *
 * Sifat hasilnya dipaksa `menyusul`: pemeriksaan yang bukan dasar keputusan
 * dokter tidak boleh menahan pasien di antrean.
 */
export async function orderApsAction(
  visitId: number,
  raw: unknown,
): Promise<ActionResult<{ noOrder: string; total: number }>> {
  const session = await requireRole(...ROLE_LAB);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  const parsed = orderLabSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  try {
    const hasil = await buatOrderLab(
      visitId,
      siteId,
      session.id,
      { ...parsed.data, prioritas: "rutin", sifat_hasil: "menyusul" },
      true,
    );
    await auditLog({
      session,
      aksi: "create",
      entity: "lab_orders",
      entityId: hasil.orderId,
      after: {
        visit_id: visitId,
        no_order: hasil.noOrder,
        aps: true,
        panel: parsed.data.panels.map((p) => p.nama),
      },
    });
    revalidatePath("/lab");
    revalidatePath(`/rme/${visitId}`);
    return { ok: true, data: { noOrder: hasil.noOrder, total: hasil.total } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal membuat order APS.",
    };
  }
}

/** Pencarian panel untuk order APS di layar lab. */
export async function cariPanelLabAction(keyword: string) {
  await requireRole(...ROLE_LAB);
  return cariPanel(keyword);
}
