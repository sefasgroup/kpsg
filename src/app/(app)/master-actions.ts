"use server";

import { revalidatePath } from "next/cache";
import { auditLog, requireRole } from "@/lib/auth";
import { execute, queryOne } from "@/lib/db";
import { z } from "zod";
import {
  imporIcd10,
  imporItem,
  imporTindakan,
  type HasilImpor,
  resetPasswordPengguna,
  setAktifCabang,
  setAktifItem,
  setAktifPengguna,
  simpanCabang,
  simpanItem,
  simpanPengguna,
  simpanSetting,
} from "@/lib/master";
import {
  cabangSchema,
  icd10Schema,
  imporIcd10Schema,
  itemSchema,
  panelSchema,
  parameterSchema,
  penggunaSchema,
  poliSchema,
  resetPasswordSchema,
  tindakanMasterSchema,
} from "@/lib/validations/master";

/** Seluruh master data adalah wewenang Super Admin (CLAUDE.md §2.1 poin 1). */
const ROLE_SA = ["super_admin"] as const;

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

function gagal(err: unknown, fallback: string): ActionResult<never> {
  return { ok: false, error: err instanceof Error ? err.message : fallback };
}

function invalid(e: { issues: { message: string; path: PropertyKey[] }[] }) {
  const first = e.issues[0];
  return { ok: false as const, error: first.message, field: String(first.path[0] ?? "") };
}

// --- Cabang -----------------------------------------------------------

export async function simpanCabangAction(
  raw: unknown,
  id?: number,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_SA);
  const parsed = cabangSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  try {
    const siteId = await simpanCabang(parsed.data, id);
    await auditLog({
      session,
      aksi: id ? "update" : "create",
      entity: "sites",
      entityId: siteId,
      after: parsed.data,
    });
    revalidatePath("/cabang");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal menyimpan cabang.");
  }
}

export async function setAktifCabangAction(
  id: number,
  aktif: boolean,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_SA);
  try {
    await setAktifCabang(id, aktif);
    await auditLog({ session, aksi: "update", entity: "sites", entityId: id, after: { aktif } });
    revalidatePath("/cabang");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal mengubah status cabang.");
  }
}

// --- Pengguna ---------------------------------------------------------

export async function simpanPenggunaAction(
  raw: unknown,
  id?: number,
): Promise<ActionResult<{ passwordBaru: string | null }>> {
  const session = await requireRole(...ROLE_SA);
  const parsed = penggunaSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  try {
    const hasil = await simpanPengguna(parsed.data, id);
    await auditLog({
      session,
      aksi: id ? "update" : "create",
      entity: "users",
      entityId: hasil.id,
      // Password TIDAK pernah masuk audit log.
      after: {
        nama: parsed.data.nama,
        username: parsed.data.username,
        role: parsed.data.role_code,
        site_id: parsed.data.site_id,
      },
    });
    revalidatePath("/pengguna");
    return { ok: true, data: { passwordBaru: hasil.passwordBaru } };
  } catch (err) {
    return gagal(err, "Gagal menyimpan pengguna.");
  }
}

export async function resetPasswordAction(
  id: number,
  raw: unknown,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_SA);
  const parsed = resetPasswordSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await resetPasswordPengguna(id, parsed.data.password);
    await auditLog({ session, aksi: "reset_password", entity: "users", entityId: id });
    revalidatePath("/pengguna");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal mengatur ulang password.");
  }
}

export async function setAktifPenggunaAction(
  id: number,
  aktif: boolean,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_SA);
  try {
    await setAktifPengguna(id, aktif, session.id);
    await auditLog({ session, aksi: "update", entity: "users", entityId: id, after: { aktif } });
    revalidatePath("/pengguna");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal mengubah status pengguna.");
  }
}

// --- Poli & tindakan --------------------------------------------------

export async function simpanPoliAction(
  raw: unknown,
  id?: number,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_SA);
  const parsed = poliSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  try {
    if (id) {
      await execute(
        `UPDATE polis SET kode=?, nama=?, prefix_antrean=? WHERE id=?`,
        [parsed.data.kode, parsed.data.nama, parsed.data.prefix_antrean, id],
      );
    } else {
      await execute(
        `INSERT INTO polis (site_id, kode, nama, prefix_antrean) VALUES (?,?,?,?)`,
        [session.siteId, parsed.data.kode, parsed.data.nama, parsed.data.prefix_antrean],
      );
    }
    await auditLog({ session, aksi: id ? "update" : "create", entity: "polis", entityId: id ?? null, after: parsed.data });
    revalidatePath("/master/tindakan");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal menyimpan poli.");
  }
}

export async function simpanTindakanAction(
  raw: unknown,
  id?: number,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_SA);
  const parsed = tindakanMasterSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const d = parsed.data;

  try {
    if (id) {
      await execute(
        `UPDATE medical_procedures
            SET kode=?, nama=?, kategori=?, is_konsultasi=?, tarif=?, icd9cm=?
          WHERE id=?`,
        [
          d.kode, d.nama, d.kategori ?? null, d.is_konsultasi ? 1 : 0,
          d.tarif, d.icd9cm ?? null, id,
        ],
      );
    } else {
      await execute(
        `INSERT INTO medical_procedures (kode, nama, kategori, is_konsultasi, tarif, icd9cm)
         VALUES (?,?,?,?,?,?)`,
        [
          d.kode, d.nama, d.kategori ?? null, d.is_konsultasi ? 1 : 0,
          d.tarif, d.icd9cm ?? null,
        ],
      );
    }
    await auditLog({ session, aksi: id ? "update" : "create", entity: "medical_procedures", entityId: id ?? null, after: d });
    revalidatePath("/master/tindakan");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal menyimpan tindakan.");
  }
}

// --- Katalog ----------------------------------------------------------

export async function simpanItemAction(
  raw: unknown,
  id?: number,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_SA);
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  try {
    const itemId = await simpanItem(parsed.data, id);
    await auditLog({
      session,
      aksi: id ? "update" : "create",
      entity: "items",
      entityId: itemId,
      after: parsed.data,
    });
    revalidatePath("/master/katalog");
    revalidatePath("/farmasi/stok");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal menyimpan item.");
  }
}

export async function setAktifItemAction(
  id: number,
  aktif: boolean,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_SA);
  try {
    await setAktifItem(id, aktif);
    await auditLog({ session, aksi: "update", entity: "items", entityId: id, after: { aktif } });
    revalidatePath("/master/katalog");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal mengubah status item.");
  }
}

// --- Lab --------------------------------------------------------------

export async function simpanPanelAction(
  raw: unknown,
  id?: number,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_SA);
  const parsed = panelSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const d = parsed.data;

  try {
    if (id) {
      await execute(
        `UPDATE lab_panels SET kode=?, nama=?, kategori=?, tarif=? WHERE id=?`,
        [d.kode, d.nama, d.kategori ?? null, d.tarif, id],
      );
    } else {
      await execute(
        `INSERT INTO lab_panels (kode, nama, kategori, tarif) VALUES (?,?,?,?)`,
        [d.kode, d.nama, d.kategori ?? null, d.tarif],
      );
    }
    await auditLog({ session, aksi: id ? "update" : "create", entity: "lab_panels", entityId: id ?? null, after: d });
    revalidatePath("/master/lab");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal menyimpan panel.");
  }
}

export async function simpanParameterAction(
  raw: unknown,
  id?: number,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_SA);
  const parsed = parameterSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const d = parsed.data;

  const pilihan =
    d.tipe_nilai === "pilihan" && d.pilihan
      ? JSON.stringify(d.pilihan.split(",").map((x) => x.trim()).filter(Boolean))
      : null;

  try {
    if (id) {
      await execute(
        `UPDATE lab_parameters SET kode=?, nama=?, satuan=?, tipe_nilai=?, pilihan=?,
                ref_low=?, ref_high=?, ref_teks=?, kritis_low=?, kritis_high=?, urutan=?
          WHERE id=?`,
        [d.kode, d.nama, d.satuan ?? null, d.tipe_nilai, pilihan,
         d.ref_low, d.ref_high, d.ref_teks ?? null, d.kritis_low, d.kritis_high, d.urutan, id],
      );
    } else {
      await execute(
        `INSERT INTO lab_parameters (panel_id, kode, nama, satuan, tipe_nilai, pilihan,
                ref_low, ref_high, ref_teks, kritis_low, kritis_high, urutan)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [d.panel_id, d.kode, d.nama, d.satuan ?? null, d.tipe_nilai, pilihan,
         d.ref_low, d.ref_high, d.ref_teks ?? null, d.kritis_low, d.kritis_high, d.urutan],
      );
    }
    await auditLog({ session, aksi: id ? "update" : "create", entity: "lab_parameters", entityId: id ?? null, after: d });
    revalidatePath("/master/lab");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal menyimpan parameter.");
  }
}

// --- ICD-10 -----------------------------------------------------------

export async function simpanIcd10Action(raw: unknown): Promise<ActionResult> {
  const session = await requireRole(...ROLE_SA);
  const parsed = icd10Schema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const d = parsed.data;

  try {
    await execute(
      `INSERT INTO icd10_codes (code, nama_id, nama_en, bab) VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE nama_id=VALUES(nama_id), nama_en=VALUES(nama_en), bab=VALUES(bab)`,
      [d.code, d.nama_id, d.nama_en ?? null, d.bab ?? null],
    );
    await auditLog({ session, aksi: "create", entity: "icd10_codes", after: d });
    revalidatePath("/master/icd10");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal menyimpan kode ICD-10.");
  }
}

export async function imporIcd10Action(
  raw: unknown,
): Promise<ActionResult<{ masuk: number; diperbarui: number; dilewati: number }>> {
  const session = await requireRole(...ROLE_SA);
  const parsed = imporIcd10Schema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  try {
    const hasil = await imporIcd10(parsed.data.isi, parsed.data.pemisah);
    await auditLog({ session, aksi: "import", entity: "icd10_codes", after: hasil });
    revalidatePath("/master/icd10");
    return { ok: true, data: hasil };
  } catch (err) {
    return gagal(err, "Gagal mengimpor ICD-10.");
  }
}

// --- Pengaturan -------------------------------------------------------

export async function simpanSettingAction(
  id: number,
  nilai: string,
): Promise<ActionResult> {
  const session = await requireRole(...ROLE_SA);
  try {
    await simpanSetting(id, nilai);
    await auditLog({ session, aksi: "update", entity: "settings", entityId: id, after: { nilai } });
    revalidatePath("/pengaturan");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal menyimpan pengaturan.");
  }
}

// --- Impor massal katalog & tindakan ----------------------------------

const imporSchema = z.object({
  isi: z.string().trim().min(1, "Tempelkan isi berkas terlebih dahulu"),
  pemisah: z.enum([",", "\t", ";"]).default(","),
  lewati_header: z.coerce.boolean().default(true),
});

export async function imporItemAction(raw: unknown): Promise<ActionResult<HasilImpor>> {
  const session = await requireRole(...ROLE_SA);
  const parsed = imporSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  try {
    const hasil = await imporItem(
      parsed.data.isi,
      parsed.data.pemisah,
      parsed.data.lewati_header,
    );
    await auditLog({
      session,
      aksi: "import",
      entity: "items",
      // Isi berkasnya sendiri TIDAK dicatat — bisa ribuan baris dan akan
      // membuat audit log tidak terbaca. Yang penting jumlahnya.
      after: { masuk: hasil.masuk, diperbarui: hasil.diperbarui, dilewati: hasil.dilewati },
    });
    revalidatePath("/master/katalog");
    return { ok: true, data: hasil };
  } catch (err) {
    return gagal(err, "Gagal mengimpor katalog.");
  }
}

export async function imporTindakanAction(raw: unknown): Promise<ActionResult<HasilImpor>> {
  const session = await requireRole(...ROLE_SA);
  const parsed = imporSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  try {
    const hasil = await imporTindakan(
      parsed.data.isi,
      parsed.data.pemisah,
      parsed.data.lewati_header,
    );
    await auditLog({
      session,
      aksi: "import",
      entity: "medical_procedures",
      after: { masuk: hasil.masuk, diperbarui: hasil.diperbarui, dilewati: hasil.dilewati },
    });
    revalidatePath("/master/tindakan");
    return { ok: true, data: hasil };
  } catch (err) {
    return gagal(err, "Gagal mengimpor tindakan.");
  }
}

/**
 * Menghapus atau menonaktifkan parameter lab.
 *
 * Dua perilaku, dan yang menentukan bukan pilihan pengguna melainkan fakta:
 *
 *   - Belum pernah dipakai → benar-benar DIHAPUS. Salah ketik saat menyusun
 *     master data tidak perlu meninggalkan jejak selamanya.
 *   - Sudah pernah dipakai → DINONAKTIFKAN. `lab_results.parameter_id` adalah
 *     foreign key tanpa ON DELETE, jadi penghapusan akan ditolak database —
 *     dan memaksanya lewat CASCADE berarti memusnahkan hasil pemeriksaan
 *     pasien lama. Parameter hilang dari order baru, hasil lama tetap terbaca
 *     lengkap dengan satuan dan nilai rujukan yang berlaku saat itu.
 */
export async function hapusParameterAction(
  id: number,
): Promise<ActionResult<{ dihapus: boolean }>> {
  const session = await requireRole(...ROLE_SA);

  try {
    const dipakai = await queryOne<import("mysql2").RowDataPacket & { n: number }>(
      `SELECT COUNT(*) AS n FROM lab_results WHERE parameter_id = ?`,
      [id],
    );

    if (Number(dipakai?.n ?? 0) > 0) {
      await execute(`UPDATE lab_parameters SET is_active = 0 WHERE id = ?`, [id]);
      await auditLog({
        session, aksi: "deactivate", entity: "lab_parameters", entityId: id,
        after: { alasan: "sudah dipakai pada hasil pemeriksaan", hasil: Number(dipakai?.n) },
      });
      revalidatePath("/master/lab");
      return { ok: true, data: { dihapus: false } };
    }

    await execute(`DELETE FROM lab_parameters WHERE id = ?`, [id]);
    await auditLog({ session, aksi: "delete", entity: "lab_parameters", entityId: id });
    revalidatePath("/master/lab");
    return { ok: true, data: { dihapus: true } };
  } catch (err) {
    return gagal(err, "Gagal menghapus parameter.");
  }
}

/** Mengaktifkan kembali parameter yang pernah dinonaktifkan. */
export async function aktifkanParameterAction(id: number): Promise<ActionResult> {
  const session = await requireRole(...ROLE_SA);
  try {
    await execute(`UPDATE lab_parameters SET is_active = 1 WHERE id = ?`, [id]);
    await auditLog({ session, aksi: "activate", entity: "lab_parameters", entityId: id });
    revalidatePath("/master/lab");
    return { ok: true, data: undefined };
  } catch (err) {
    return gagal(err, "Gagal mengaktifkan parameter.");
  }
}
