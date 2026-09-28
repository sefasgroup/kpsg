"use server";

import { revalidatePath } from "next/cache";
import { auditLog, requireRole, tolakSuperAdmin } from "@/lib/auth";
import { bolehKeCabang, setActiveSite } from "@/lib/session";
import { cariIcd10, cariTindakan, simpanAsesmen } from "@/lib/doctor";
import { batalkanResep, cariObat, simpanResep, type ObatOption } from "@/lib/prescription";
import {
  batalkanOrderLab, buatOrderLab, cariPanel, ubahSifatHasil,
} from "@/lib/lab";
import {
  hapusLampiran, ubahKeterangan, unggahLampiran,
  MAKS_DOKUMEN_SEKALI, type HasilUnggah,
} from "@/lib/lampiran-rme";
import { queryOne } from "@/lib/db";
import { alergiPasien, tambahAlergi, type AlergiRow } from "@/lib/nurse";
import { alergiSchema } from "@/lib/validations/nurse";
import { asesmenSchema, resepSchema } from "@/lib/validations/doctor";
import { orderLabSchema } from "@/lib/validations/lab";

const ROLE_DOKTER = ["dokter", "super_admin"] as const;

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

export async function cariIcd10Action(keyword: string) {
  await requireRole(...ROLE_DOKTER);
  return cariIcd10(keyword);
}

/**
 * Berpindah ke cabang lain tempat dokter ini ditugaskan.
 *
 * Haknya diperiksa lewat `bolehKeCabang()` yang membaca daftar penugasan di
 * dalam token bertanda tangan — id cabang yang dikirim klien tidak pernah
 * dipercaya begitu saja.
 */
export async function pindahCabangAction(
  siteId: number,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_DOKTER);

  if (!bolehKeCabang(session, siteId)) {
    return { ok: false, error: "Anda tidak ditugaskan di cabang tersebut." };
  }

  await setActiveSite(siteId);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function cariTindakanAction(keyword: string) {
  const session = await requireRole(...ROLE_DOKTER);
  return cariTindakan(keyword, session.siteId);
}

export async function cariObatAction(
  keyword: string,
  hanyaBahanRacikan = false,
): Promise<ObatOption[]> {
  const session = await requireRole(...ROLE_DOKTER);
  return cariObat(keyword, session.siteId, hanyaBahanRacikan);
}

/**
 * Mencatat alergi pasien dari layar dokter.
 *
 * Menulis ke `patient_allergies` — daftar yang SAMA dengan yang diisi perawat.
 * Alergi melekat pada pasien, bukan pada kunjungan atau pada pemeriksanya:
 * tidak ada "versi perawat" dan "versi dokter" seperti pada keluhan utama.
 * Yang membedakan hanya penjaga perannya di sini.
 */
export async function tambahAlergiDokterAction(
  visitId: number,
  raw: unknown,
): Promise<{ ok: true; data: AlergiRow[] } | { ok: false; error: string }> {
  const session = await requireRole(...ROLE_DOKTER);
  const tolak = tolakSuperAdmin(session);
  if (tolak) return tolak;

  const parsed = alergiSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  /*
   * Pasien ditentukan dari KUNJUNGAN, bukan dari id yang dikirim klien — dan
   * kunjungan itu harus milik cabang penggunanya. Menerima patientId apa
   * adanya memungkinkan alergi ditempelkan ke rekam medis pasien mana pun.
   */
  const visit = await kunjunganDiCabang(visitId, session.siteId);
  if (!visit) return { ok: false, error: "Kunjungan tidak ditemukan di cabang ini." };

  try {
    const id = await tambahAlergi(Number(visit.patient_id), parsed.data, session.id);
    await auditLog({
      session, aksi: "create", entity: "patient_allergies", entityId: id,
      after: { ...parsed.data, visit_id: visitId },
    });
    revalidatePath(`/rme/${visitId}`);
    return { ok: true, data: await alergiPasien(Number(visit.patient_id)) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal mencatat alergi.",
    };
  }
}

// ---------------------------------------------------------------------
// Dokumen pendukung
// ---------------------------------------------------------------------

/**
 * Memastikan kunjungan itu ada DI CABANG AKTIF pengguna.
 *
 * Id kunjungan datang dari klien dan tidak pernah dipercaya begitu saja:
 * tanpa pemeriksaan ini, dokter cabang A bisa menempelkan dokumen ke rekam
 * medis pasien cabang B hanya dengan menebak nomornya.
 */
async function kunjunganDiCabang(visitId: number, siteId: number | null) {
  return queryOne<import("mysql2").RowDataPacket & {
    id: number; site_id: number; patient_id: number;
  }>(
    `SELECT id, site_id, patient_id FROM visits
      WHERE id = ? AND (? IS NULL OR site_id = ?)`,
    [visitId, siteId, siteId],
  );
}

export async function unggahDokumenAction(
  visitId: number,
  form: FormData,
): Promise<ActionResult<HasilUnggah>> {
  const session = await requireRole(...ROLE_DOKTER);
  const tolak = tolakSuperAdmin(session);
  if (tolak) return tolak;

  const visit = await kunjunganDiCabang(visitId, session.siteId);
  if (!visit) return { ok: false, error: "Kunjungan tidak ditemukan di cabang ini." };

  const berkas: { file: File; keterangan: string }[] = [];
  for (let i = 0; i < MAKS_DOKUMEN_SEKALI; i++) {
    const f = form.get(`berkas${i}`);
    if (!(f instanceof File)) continue;
    berkas.push({ file: f, keterangan: String(form.get(`keterangan${i}`) ?? "") });
  }

  if (berkas.length === 0) {
    return { ok: false, error: "Tidak ada berkas yang dipilih." };
  }

  const hasil = await unggahLampiran(
    visitId, Number(visit.site_id), Number(visit.patient_id), session.id, berkas,
  );

  if (hasil.tersimpan > 0) {
    await auditLog({
      session,
      aksi: "upload",
      entity: "visit_documents",
      entityId: visitId,
      after: { jumlah: hasil.tersimpan, ditolak: hasil.ditolak.length },
    });
    revalidatePath(`/rme/${visitId}`);
  }

  return { ok: true, data: hasil };
}

export async function ubahKeteranganDokumenAction(
  visitId: number,
  id: number,
  keterangan: string,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_DOKTER);
  const tolak = tolakSuperAdmin(session);
  if (tolak) return tolak;

  const visit = await kunjunganDiCabang(visitId, session.siteId);
  if (!visit) return { ok: false, error: "Kunjungan tidak ditemukan di cabang ini." };

  await ubahKeterangan(id, visitId, keterangan);
  await auditLog({
    session, aksi: "update", entity: "visit_documents", entityId: id,
    after: { keterangan },
  });
  revalidatePath(`/rme/${visitId}`);
  return { ok: true, data: undefined };
}

export async function hapusDokumenAction(
  visitId: number,
  id: number,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_DOKTER);
  const tolak = tolakSuperAdmin(session);
  if (tolak) return tolak;

  const visit = await kunjunganDiCabang(visitId, session.siteId);
  if (!visit) return { ok: false, error: "Kunjungan tidak ditemukan di cabang ini." };

  const terhapus = await hapusLampiran(id, visitId, session.id);
  if (!terhapus) return { ok: false, error: "Dokumen tidak ditemukan." };

  await auditLog({ session, aksi: "delete", entity: "visit_documents", entityId: id });
  revalidatePath(`/rme/${visitId}`);
  return { ok: true, data: undefined };
}

export async function simpanAsesmenAction(
  visitId: number,
  raw: unknown,
): Promise<ActionResult<{ final: boolean }>> {
  const session = await requireRole(...ROLE_DOKTER);
  const tolak = tolakSuperAdmin(session);
  if (tolak) return tolak;

  const parsed = asesmenSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  try {
    const hasil = await simpanAsesmen(visitId, siteId, session.id, parsed.data);
    await auditLog({
      session,
      aksi: parsed.data.finalkan ? "finalize" : "update",
      entity: "medical_assessments",
      entityId: hasil.assessmentId,
      after: {
        visit_id: visitId,
        diagnosa: parsed.data.diagnoses.map((d) => `${d.icd10_code} (${d.tipe})`),
        jumlah_tindakan: parsed.data.procedures.length,
      },
    });
    revalidatePath("/rme");
    return { ok: true, data: { final: parsed.data.finalkan } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal menyimpan asesmen.",
    };
  }
}

export async function simpanResepAction(
  visitId: number,
  raw: unknown,
): Promise<ActionResult<{ noResep: string }>> {
  const session = await requireRole(...ROLE_DOKTER);
  const tolak = tolakSuperAdmin(session);
  if (tolak) return tolak;

  const parsed = resepSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    // Aturan pakai kosong adalah kesalahan paling sering — pesannya harus
    // menunjuk obat mana yang bermasalah, bukan sekadar "tidak valid".
    const path = first.path.join(".");
    return { ok: false, error: first.message, field: path };
  }

  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  try {
    const hasil = await simpanResep(visitId, siteId, session.id, parsed.data);
    await auditLog({
      session,
      aksi: "update",
      entity: "prescriptions",
      entityId: hasil.prescriptionId,
      after: {
        visit_id: visitId,
        no_resep: hasil.noResep,
        obat_paten: parsed.data.items.length,
        racikan: parsed.data.racikans.length,
      },
    });
    revalidatePath("/rme");
    return { ok: true, data: { noResep: hasil.noResep } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal menyimpan resep.",
    };
  }
}

export async function batalkanResepAction(
  visitId: number,
  alasan: string,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_DOKTER);
  const tolak = tolakSuperAdmin(session);
  if (tolak) return tolak;
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };
  if (alasan.trim().length < 3) {
    return { ok: false, error: "Alasan pembatalan wajib diisi." };
  }

  try {
    await batalkanResep(visitId, siteId, alasan.trim());
    await auditLog({
      session,
      aksi: "void",
      entity: "prescriptions",
      entityId: visitId,
      after: { alasan: alasan.trim() },
    });
    revalidatePath("/rme");
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal membatalkan resep.",
    };
  }
}

export async function cariPanelAction(keyword: string) {
  await requireRole(...ROLE_DOKTER);
  return cariPanel(keyword);
}

export async function orderLabAction(
  visitId: number,
  raw: unknown,
): Promise<ActionResult<{ noOrder: string; total: number }>> {
  const session = await requireRole(...ROLE_DOKTER);
  const tolak = tolakSuperAdmin(session);
  if (tolak) return tolak;

  const parsed = orderLabSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  try {
    const hasil = await buatOrderLab(visitId, siteId, session.id, parsed.data);
    await auditLog({
      session,
      aksi: "create",
      entity: "lab_orders",
      entityId: hasil.orderId,
      after: {
        visit_id: visitId,
        no_order: hasil.noOrder,
        prioritas: parsed.data.prioritas,
        panel: parsed.data.panels.map((p) => p.nama),
      },
    });
    revalidatePath("/rme");
    revalidatePath("/lab");
    return { ok: true, data: { noOrder: hasil.noOrder, total: hasil.total } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal membuat order lab.",
    };
  }
}

/** Panjang minimum alasan pembatalan order lab. */
const MIN_ALASAN_LAB = 10;

/**
 * Membatalkan order lab yang salah dibuat.
 *
 * Alasannya ikut ditulis ke `catatan_klinis` order — petugas lab yang
 * sampelnya sudah terlanjur diambil perlu tahu mengapa pemeriksaannya
 * dihentikan, dan tarifnya menghilang dari tagihan tanpa jejak lain.
 */
export async function batalkanOrderLabAction(
  orderId: number,
  alasan: string,
): Promise<ActionResult<{ noOrder: string; statusKunjungan: string }>> {
  const session = await requireRole(...ROLE_DOKTER);
  const tolak = tolakSuperAdmin(session);
  if (tolak) return tolak;
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  const teks = (alasan ?? "").trim();
  if (teks.length < MIN_ALASAN_LAB) {
    return {
      ok: false,
      error: `Tuliskan alasan pembatalan minimal ${MIN_ALASAN_LAB} karakter — petugas lab perlu tahu mengapa pemeriksaannya dihentikan.`,
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
    revalidatePath(`/rme/${hasil.visitId}`);
    revalidatePath("/rme");
    revalidatePath("/lab");
    return {
      ok: true,
      data: { noOrder: hasil.noOrder, statusKunjungan: hasil.statusKunjungan },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal membatalkan order lab.",
    };
  }
}

/**
 * Mengubah sifat hasil order lab yang sedang berjalan.
 *
 * Jalan keluar dari kebuntuan yang paling mungkin terjadi: dokter memesan
 * pemeriksaan dengan niat menunggu hasilnya, lalu ternyata baru jadi besok.
 * Tanpa ini satu-satunya pilihan adalah membatalkan order dan memesan ulang —
 * membuang nomor order, dan bila sampelnya sudah diambil, membuang sampelnya.
 */
export async function ubahSifatHasilAction(
  orderId: number,
  sifat: "ditunggu" | "menyusul",
): Promise<ActionResult<{ noOrder: string; statusKunjungan: string }>> {
  const session = await requireRole(...ROLE_DOKTER);
  const tolak = tolakSuperAdmin(session);
  if (tolak) return tolak;
  const siteId = session.siteId;
  if (!siteId) return { ok: false, error: "Super Admin harus memilih cabang dahulu." };

  try {
    const hasil = await ubahSifatHasil(orderId, siteId, sifat);
    await auditLog({
      session,
      aksi: "update",
      entity: "lab_orders",
      entityId: orderId,
      after: { no_order: hasil.noOrder, sifat_hasil: sifat },
    });
    revalidatePath(`/rme/${hasil.visitId}`);
    revalidatePath("/lab");
    return {
      ok: true,
      data: { noOrder: hasil.noOrder, statusKunjungan: hasil.statusKunjungan },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal mengubah sifat hasil.",
    };
  }
}
