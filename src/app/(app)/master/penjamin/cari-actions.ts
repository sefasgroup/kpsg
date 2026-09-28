"use server";

import { requireRole } from "@/lib/auth";
import { cariTindakan } from "@/lib/doctor";
import { cariItemStok } from "@/lib/inventory";

/**
 * Pencarian sasaran tarif kontrak.
 *
 * `siteId` sengaja diberikan `null`: yang dicari adalah tarif GLOBAL untuk
 * dibandingkan dengan harga kontrak, bukan tarif cabang tertentu. Kontrak
 * berlaku untuk seluruh jaringan, jadi pembandingnya juga harus global —
 * kalau tidak, harga acuan yang tampil berubah-ubah menurut cabang aktif
 * Super Admin saat itu.
 */
export type OpsiSasaran = { id: number; kode: string; nama: string; harga: number };

export async function cariTindakanAction(q: string): Promise<OpsiSasaran[]> {
  await requireRole("super_admin");
  const rows = await cariTindakan(q, null, 20);
  return rows.map((r) => ({
    id: Number(r.id),
    kode: r.kode,
    nama: r.nama,
    harga: Number(r.tarif),
  }));
}

export async function cariBarangAction(q: string): Promise<OpsiSasaran[]> {
  await requireRole("super_admin");
  const rows = await cariItemStok(q, null, 20);
  return rows.map((r) => ({
    id: Number(r.id),
    kode: r.kode,
    nama: r.nama,
    harga: Number(r.harga_jual),
  }));
}
