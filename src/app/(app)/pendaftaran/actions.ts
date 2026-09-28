"use server";

import { revalidatePath } from "next/cache";
import { auditLog, requireRole } from "@/lib/auth";
import { buatPasien, cariPasien, getPasienByNik, type PatientRow } from "@/lib/patients";
import { batalkanKunjungan, daftarkanKunjungan } from "@/lib/visits";
import { patientSchema, visitSchema } from "@/lib/validations/patient";

/**
 * Semua aksi di modul ini mengulang pengecekan role di server.
 * Server Action bisa dipanggil langsung tanpa melewati proxy.ts,
 * jadi guard di sini bukan duplikasi yang bisa dihilangkan.
 */
const ROLE_PENDAFTARAN = ["admin_cabang", "super_admin"] as const;

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

export async function cariPasienAction(
  keyword: string,
): Promise<ActionResult<PatientRow[]>> {
  await requireRole(...ROLE_PENDAFTARAN);
  try {
    return { ok: true, data: await cariPasien(keyword) };
  } catch {
    return { ok: false, error: "Gagal mencari pasien." };
  }
}

export async function buatPasienAction(
  raw: unknown,
): Promise<ActionResult<{ id: number; no_rm: string }>> {
  const session = await requireRole(...ROLE_PENDAFTARAN);

  const parsed = patientSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  // Satu NIK = satu pasien di seluruh cabang (docs/DATABASE.md §3.7).
  // Dicek di sini agar pesannya jelas; UNIQUE key tetap jadi jaring terakhir.
  const duplikat = await getPasienByNik(parsed.data.nik);
  if (duplikat) {
    return {
      ok: false,
      field: "nik",
      error: `NIK ini sudah terdaftar atas nama ${duplikat.nama} (${duplikat.no_rm}).`,
    };
  }

  const siteId = session.siteId;
  if (!siteId) {
    return {
      ok: false,
      error: "Super Admin harus memilih cabang terlebih dahulu untuk mendaftarkan pasien.",
    };
  }

  try {
    const hasil = await buatPasien(parsed.data, siteId, session.id);
    await auditLog({
      session,
      aksi: "create",
      entity: "patients",
      entityId: hasil.id,
      after: { no_rm: hasil.no_rm, nik: parsed.data.nik, nama: parsed.data.nama },
    });
    revalidatePath("/pendaftaran");
    return { ok: true, data: hasil };
  } catch (err) {
    const pesan = err instanceof Error ? err.message : "Gagal menyimpan pasien.";
    return {
      ok: false,
      error: pesan.includes("uq_pat_nik")
        ? "NIK ini sudah terdaftar."
        : "Gagal menyimpan pasien.",
    };
  }
}

export async function daftarkanKunjunganAction(
  raw: unknown,
): Promise<ActionResult<{ id: number; no_visit: string; antrean: string }>> {
  const session = await requireRole(...ROLE_PENDAFTARAN);

  const parsed = visitSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  const siteId = session.siteId;
  if (!siteId) {
    return {
      ok: false,
      error: "Super Admin harus memilih cabang terlebih dahulu untuk mendaftarkan kunjungan.",
    };
  }

  try {
    const hasil = await daftarkanKunjungan(parsed.data, siteId, session.id);
    await auditLog({
      session,
      aksi: "create",
      entity: "visits",
      entityId: hasil.id,
      after: { no_visit: hasil.no_visit, antrean: hasil.antrean },
    });
    revalidatePath("/pendaftaran");
    revalidatePath("/antrean");
    return { ok: true, data: hasil };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal mendaftarkan kunjungan.",
    };
  }
}

/** Panjang minimum alasan pembatalan kunjungan. */
const MIN_ALASAN = 10;

/**
 * Membatalkan kunjungan yang tidak jadi dilayani.
 *
 * Wewenangnya di Pendaftaran, bukan di unit layanan. Yang membatalkan
 * kunjungan adalah yang mendaftarkannya — perawat, dokter, atau kasir yang
 * bisa menghapus pasien dari alur berarti tiap unit punya jalan keluar
 * sendiri-sendiri untuk pasien yang merepotkan.
 */
export async function batalkanKunjunganAction(
  visitId: number,
  alasan: string,
): Promise<ActionResult<{ noVisit: string; pasien: string }>> {
  const session = await requireRole(...ROLE_PENDAFTARAN);
  const siteId = session.siteId;
  if (!siteId) {
    return { ok: false, error: "Super Admin harus memilih cabang terlebih dahulu." };
  }

  const teks = (alasan ?? "").trim();
  if (teks.length < MIN_ALASAN) {
    return {
      ok: false,
      error: `Tuliskan alasan pembatalan minimal ${MIN_ALASAN} karakter — inilah satu-satunya keterangan mengapa pasien ini hilang dari antrean.`,
    };
  }

  try {
    const hasil = await batalkanKunjungan(visitId, siteId, session.id, teks);
    await auditLog({
      session,
      aksi: "cancel",
      entity: "visits",
      entityId: visitId,
      after: {
        no_visit: hasil.noVisit,
        status_sebelum: hasil.statusSebelum,
        alasan: teks,
      },
    });
    revalidatePath("/pendaftaran");
    revalidatePath("/antrean");
    return { ok: true, data: { noVisit: hasil.noVisit, pasien: hasil.pasien } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal membatalkan kunjungan.",
    };
  }
}
