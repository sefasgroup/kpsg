"use server";

import { requireRole } from "@/lib/auth";
import { tagihanBelumDiklaim } from "@/lib/klaim";
import type { KandidatBaris } from "./klaim-client";

/**
 * Pratinjau isi klaim sebelum berkasnya dibuat.
 *
 * Memakai fungsi yang SAMA dengan `buatKlaim()` untuk menentukan kelayakan
 * tagihan — bukan kueri terpisah yang mirip. Pratinjau yang menampilkan
 * daftar berbeda dari yang akhirnya masuk berkas lebih buruk daripada tidak
 * ada pratinjau: petugas menyetujui satu hal dan mendapatkan hal lain.
 */
export async function cariKandidatAction(
  payerId: number,
  dari: string,
  sampai: string,
): Promise<KandidatBaris[]> {
  const session = await requireRole("admin_cabang", "super_admin");
  if (!session.siteId) return [];

  const rows = await tagihanBelumDiklaim(session.siteId, payerId, dari, sampai);
  return rows.map((r) => ({
    billingId: Number(r.billing_id),
    noInvoice: r.no_invoice,
    tanggal: String(r.tanggal),
    noRm: r.no_rm,
    pasien: r.pasien,
    noAnggota: r.no_anggota,
    nilai: Number(r.tanggung_penjamin),
  }));
}
