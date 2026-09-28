"use server";

import { revalidatePath } from "next/cache";
import { auditLog, requireRole } from "@/lib/auth";
import {
  batalkanTerimaResep, batalkanValidasiResep, serahkanResep, terimaResep,
  validasiResep,
} from "@/lib/pharmacy";
import { StokTidakCukupError } from "@/lib/stock";

const ROLE_FARMASI = ["farmasi", "super_admin"] as const;

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function terimaResepAction(
  prescriptionId: number,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_FARMASI);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  try {
    await terimaResep(prescriptionId, siteId, session.id);
    await auditLog({
      session,
      aksi: "receive",
      entity: "prescriptions",
      entityId: prescriptionId,
    });
    revalidatePath("/farmasi");
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal menerima resep.",
    };
  }
}

/** Panjang minimum alasan pengembalian. */
const MIN_ALASAN = 10;

/**
 * Mengembalikan klaim resep supaya dokter bisa merevisinya.
 *
 * Alasannya wajib dan tidak boleh basa-basi: dokter menerima resep yang
 * dipantulkan balik, dan tanpa keterangan ia tidak tahu apa yang harus
 * diperbaiki — pasien menunggu sementara dua petugas saling menebak.
 */
export async function batalkanTerimaResepAction(
  prescriptionId: number,
  alasan: string,
): Promise<ActionResult<{ no_resep: string }>> {
  const session = await requireRole(...ROLE_FARMASI);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  const teks = (alasan ?? "").trim();
  if (teks.length < MIN_ALASAN) {
    return {
      ok: false,
      error: `Tuliskan alasan pengembalian minimal ${MIN_ALASAN} karakter — dokter perlu tahu apa yang harus direvisi.`,
    };
  }

  try {
    const hasil = await batalkanTerimaResep(
      prescriptionId, siteId, session.nama, teks.slice(0, 500),
    );

    await auditLog({
      session,
      aksi: "unreceive",
      entity: "prescriptions",
      entityId: prescriptionId,
      after: { no_resep: hasil.noResep, alasan: teks, visit_id: hasil.visitId },
    });

    revalidatePath("/farmasi");
    revalidatePath(`/farmasi/${prescriptionId}`);
    revalidatePath(`/rme/${hasil.visitId}`);
    return { ok: true, data: { no_resep: hasil.noResep } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal mengembalikan resep.",
    };
  }
}

/**
 * Tahap PERTAMA farmasi: kunci stok & harga, lalu dorong pasien ke kasir.
 * Stok belum dipotong — obatnya masih di rak sampai pasien membayar.
 */
export async function validasiResepAction(
  prescriptionId: number,
): Promise<ActionResult<{ total: number }>> {
  const session = await requireRole(...ROLE_FARMASI);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  try {
    const hasil = await validasiResep(prescriptionId, siteId, session.id);

    await auditLog({
      session,
      aksi: "validate",
      entity: "prescriptions",
      entityId: prescriptionId,
      after: hasil,
    });

    revalidatePath("/farmasi");
    revalidatePath("/farmasi/stok");
    return {
      ok: true,
      data: { total: hasil.totalObat + hasil.totalRacikan + hasil.totalJasaRacik },
    };
  } catch (err) {
    if (err instanceof StokTidakCukupError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal memvalidasi resep.",
    };
  }
}

/** Tahap KEDUA farmasi: potong stok dan serahkan obat. Wajib sudah lunas. */
export async function serahkanResepAction(
  prescriptionId: number,
): Promise<ActionResult<{ jumlahItem: number }>> {
  const session = await requireRole(...ROLE_FARMASI);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  try {
    const hasil = await serahkanResep(prescriptionId, siteId, session.id);

    await auditLog({
      session,
      aksi: "dispense",
      entity: "prescriptions",
      entityId: prescriptionId,
      after: hasil,
    });

    revalidatePath("/farmasi");
    revalidatePath("/farmasi/stok");
    return { ok: true, data: hasil };
  } catch (err) {
    // Stok kurang adalah kondisi operasional biasa, bukan kegagalan sistem.
    // Pesannya menyebut item dan sisa stoknya agar apoteker tahu harus apa.
    if (err instanceof StokTidakCukupError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal menyerahkan resep.",
    };
  }
}

/**
 * Membatalkan validasi — satu anak tangga turun, bukan dua.
 *
 * Setelah ini resep kembali berstatus "diterima" dan barulah bisa
 * dikembalikan ke dokter. Memisahkannya begini membuat setiap pembatalan
 * menjadi kebalikan persis dari satu langkah maju, sehingga tidak ada
 * kombinasi yang meninggalkan stok terkunci atau tagihan setengah jadi.
 */
export async function batalkanValidasiAction(
  prescriptionId: number,
): Promise<ActionResult<{ noResep: string }>> {
  const session = await requireRole(...ROLE_FARMASI);
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  try {
    const hasil = await batalkanValidasiResep(prescriptionId, siteId);
    await auditLog({
      session,
      aksi: "unvalidate",
      entity: "prescriptions",
      entityId: prescriptionId,
      after: { no_resep: hasil.noResep, visit_id: hasil.visitId },
    });
    revalidatePath("/farmasi");
    revalidatePath(`/farmasi/${prescriptionId}`);
    revalidatePath("/farmasi/stok");
    return { ok: true, data: { noResep: hasil.noResep } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal membatalkan validasi.",
    };
  }
}
