"use server";

import { revalidatePath } from "next/cache";
import { auditLog, requireRole } from "@/lib/auth";
import {
  batalkanOpname,
  buatOpname,
  cariItemStok,
  catatPenerimaan,
  catatPengeluaran,
  finalkanOpname,
  simpanHitungan,
  simpanSupplier,
  tarikBatch,
  type HasilPenerimaan,
  type ItemStok,
} from "@/lib/inventory";
import { StokTidakCukupError } from "@/lib/stock";
import {
  opnameBaruSchema,
  opnameHitungSchema,
  penerimaanSchema,
  pengeluaranSchema,
  supplierSchema,
  tarikBatchSchema,
} from "@/lib/validations/inventory";

/** Inventori adalah wewenang eksklusif Petugas Farmasi (CLAUDE.md §2.1 poin 6). */
const ROLE_FARMASI = ["farmasi", "super_admin"] as const;

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

function invalid(e: { issues: { message: string; path: PropertyKey[] }[] }) {
  const first = e.issues[0];
  return { ok: false as const, error: first.message, field: String(first.path[0] ?? "") };
}

function gagal(err: unknown, fallback: string): ActionResult<never> {
  // Stok kurang adalah kondisi operasional biasa; pesannya sudah menyebut
  // item dan sisa stok, jadi diteruskan apa adanya.
  if (err instanceof StokTidakCukupError) return { ok: false, error: err.message };
  return { ok: false, error: err instanceof Error ? err.message : fallback };
}

/**
 * Cabang aktif wajib. Super Admin bisa membuka layar ini tanpa cabang,
 * tapi stok selalu milik satu cabang — menulis tanpa cabang berarti
 * menebak gudang mana yang berkurang.
 */
async function sesiDenganCabang() {
  const session = await requireRole(...ROLE_FARMASI);
  if (!session.siteId) return { session, siteId: null as number | null };
  return { session, siteId: session.siteId };
}

const TANPA_CABANG = "Pilih cabang terlebih dahulu — stok selalu milik satu cabang.";

// --- Autocomplete -----------------------------------------------------

export async function cariItemAction(keyword: string): Promise<ItemStok[]> {
  const session = await requireRole(...ROLE_FARMASI);
  return cariItemStok(keyword, session.siteId);
}

// --- Supplier ---------------------------------------------------------

export async function simpanSupplierAction(
  raw: unknown,
  id?: number,
): Promise<ActionResult<{ id: number }>> {
  const session = await requireRole(...ROLE_FARMASI);
  const parsed = supplierSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  try {
    const supplierId = await simpanSupplier(parsed.data, id);
    await auditLog({
      session,
      aksi: id ? "update" : "create",
      entity: "suppliers",
      entityId: supplierId,
      after: parsed.data,
    });
    revalidatePath("/farmasi/penerimaan");
    return { ok: true, data: { id: supplierId } };
  } catch (err) {
    return gagal(err, "Gagal menyimpan supplier.");
  }
}

// --- Penerimaan -------------------------------------------------------

export async function catatPenerimaanAction(
  raw: unknown,
): Promise<ActionResult<HasilPenerimaan>> {
  const { session, siteId } = await sesiDenganCabang();
  if (!siteId) return { ok: false, error: TANPA_CABANG };

  const parsed = penerimaanSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  try {
    const hasil = await catatPenerimaan(parsed.data, siteId, session.id);
    await auditLog({
      session,
      aksi: "receive_stock",
      entity: "purchases",
      entityId: hasil.id,
      after: {
        no_penerimaan: hasil.no_penerimaan,
        total: hasil.total,
        item: parsed.data.items.length,
      },
    });
    revalidatePath("/farmasi/penerimaan");
    revalidatePath("/farmasi/stok");
    revalidatePath("/farmasi/kadaluarsa");
    return { ok: true, data: hasil };
  } catch (err) {
    return gagal(err, "Gagal mencatat penerimaan.");
  }
}

// --- Pengeluaran ------------------------------------------------------

export async function catatPengeluaranAction(
  raw: unknown,
): Promise<ActionResult<{ nama: string; sisa: number }>> {
  const { session, siteId } = await sesiDenganCabang();
  if (!siteId) return { ok: false, error: TANPA_CABANG };

  const parsed = pengeluaranSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  try {
    const hasil = await catatPengeluaran(parsed.data, siteId, session.id);
    await auditLog({
      session,
      aksi: "stock_out",
      entity: "stock_movements",
      entityId: hasil.movementId,
      after: parsed.data,
    });
    revalidatePath("/farmasi/pengeluaran");
    revalidatePath("/farmasi/stok");
    return { ok: true, data: { nama: hasil.nama, sisa: hasil.sisa } };
  } catch (err) {
    return gagal(err, "Gagal mencatat pengeluaran.");
  }
}

// --- Stock opname -----------------------------------------------------

export async function buatOpnameAction(
  raw: unknown,
): Promise<ActionResult<{ id: number; no_opname: string; jumlahItem: number }>> {
  const { session, siteId } = await sesiDenganCabang();
  if (!siteId) return { ok: false, error: TANPA_CABANG };

  const parsed = opnameBaruSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  try {
    const hasil = await buatOpname(parsed.data, siteId, session.id);
    await auditLog({
      session,
      aksi: "create",
      entity: "stock_opnames",
      entityId: hasil.id,
      after: hasil,
    });
    revalidatePath("/farmasi/opname");
    return { ok: true, data: hasil };
  } catch (err) {
    return gagal(err, "Gagal membuka lembar opname.");
  }
}

export async function simpanHitunganAction(
  raw: unknown,
): Promise<ActionResult> {
  const { siteId } = await sesiDenganCabang();
  if (!siteId) return { ok: false, error: TANPA_CABANG };

  const parsed = opnameHitungSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await simpanHitungan(parsed.data, siteId);
    revalidatePath("/farmasi/opname");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal menyimpan hitungan.");
  }
}

export async function finalkanOpnameAction(
  opnameId: number,
): Promise<ActionResult<{ no_opname: string; dikoreksi: number; naik: number; turun: number }>> {
  const { session, siteId } = await sesiDenganCabang();
  if (!siteId) return { ok: false, error: TANPA_CABANG };

  try {
    const hasil = await finalkanOpname(opnameId, siteId, session.id);
    await auditLog({
      session,
      aksi: "finalize",
      entity: "stock_opnames",
      entityId: opnameId,
      after: hasil,
    });
    revalidatePath("/farmasi/opname");
    revalidatePath("/farmasi/stok");
    return { ok: true, data: hasil };
  } catch (err) {
    return gagal(err, "Gagal memfinalkan opname.");
  }
}

export async function batalkanOpnameAction(
  opnameId: number,
): Promise<ActionResult<{ no_opname: string }>> {
  const { session, siteId } = await sesiDenganCabang();
  if (!siteId) return { ok: false, error: TANPA_CABANG };

  try {
    const no = await batalkanOpname(opnameId, siteId);
    await auditLog({
      session,
      aksi: "cancel",
      entity: "stock_opnames",
      entityId: opnameId,
      after: { no_opname: no },
    });
    revalidatePath("/farmasi/opname");
    return { ok: true, data: { no_opname: no } };
  } catch (err) {
    return gagal(err, "Gagal membatalkan opname.");
  }
}

// --- Penarikan batch --------------------------------------------------

export async function tarikBatchAction(
  raw: unknown,
): Promise<ActionResult<{ nama: string; sisaBatch: number; sisaStok: number }>> {
  const { session, siteId } = await sesiDenganCabang();
  if (!siteId) return { ok: false, error: TANPA_CABANG };

  const parsed = tarikBatchSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  try {
    const hasil = await tarikBatch(parsed.data, siteId, session.id);
    await auditLog({
      session,
      aksi: "withdraw_batch",
      entity: "item_batches",
      entityId: parsed.data.batch_id,
      after: { ...parsed.data, sisaBatch: hasil.sisaBatch },
    });
    revalidatePath("/farmasi/kadaluarsa");
    revalidatePath("/farmasi/stok");
    return { ok: true, data: hasil };
  } catch (err) {
    return gagal(err, "Gagal menarik batch.");
  }
}
