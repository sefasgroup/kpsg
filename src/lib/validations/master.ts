import { z } from "zod";
import { ROLES } from "../rbac";

const teks = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

// ---------------------------------------------------------------------
// Cabang
// ---------------------------------------------------------------------

export const cabangSchema = z.object({
  kode: z
    .string()
    .trim()
    .min(2, "Kode cabang minimal 2 karakter")
    .max(20)
    .regex(/^[A-Z0-9-]+$/, "Kode hanya boleh huruf kapital, angka, dan tanda hubung"),
  nama: z.string().trim().min(2, "Nama cabang wajib diisi").max(150),
  nama_legal: teks(200),
  no_izin_klinik: teks(100),
  alamat: teks(500),
  kota: teks(100),
  provinsi: teks(100),
  telepon: teks(30),
  email: z
    .union([z.literal(""), z.string().trim().email("Format email tidak valid")])
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
});

export type CabangInput = z.output<typeof cabangSchema>;

// ---------------------------------------------------------------------
// Pengguna
// ---------------------------------------------------------------------

export const penggunaSchema = z
  .object({
    nama: z.string().trim().min(2, "Nama wajib diisi").max(150),
    username: z
      .string()
      .trim()
      .min(3, "Username minimal 3 karakter")
      .max(60)
      .regex(/^[a-z0-9._-]+$/, "Username hanya boleh huruf kecil, angka, titik, dan tanda hubung"),
    role_code: z.enum(ROLES, { message: "Peran wajib dipilih" }),
    site_id: z
      .union([z.literal(""), z.coerce.number().int().positive()])
      .optional()
      .transform((v) => (v === "" || v === undefined ? null : Number(v))),
    nip: teks(40),
    email: z
      .union([z.literal(""), z.string().trim().email("Format email tidak valid")])
      .optional()
      .transform((v) => (v === "" || v === undefined ? undefined : v)),
    telepon: teks(30),
    /**
     * Penugasan cabang TAMBAHAN — mis. dokter yang praktik di dua cabang.
     * Cabang induk (`site_id`) tidak perlu ikut disebut di sini.
     */
    site_ids: z
      .array(z.coerce.number().int().positive())
      .optional()
      .default([]),
    password: z
      .union([z.literal(""), z.string().min(8, "Password minimal 8 karakter")])
      .optional()
      .transform((v) => (v === "" || v === undefined ? undefined : v)),
    // Profil dokter — hanya dipakai bila role_code = dokter
    no_str: teks(60),
    no_sip: teks(60),
    spesialisasi: teks(100),
    gelar_depan: teks(30),
    tarif_konsultasi: z.coerce.number().min(0).default(0),
  })
  .refine((v) => v.role_code === "super_admin" || v.site_id !== null, {
    // Hanya Super Admin yang boleh tanpa cabang; role operasional TIDAK,
    // karena `site_id` adalah batas isolasi datanya.
    message: "Cabang wajib dipilih untuk peran selain Super Admin",
    path: ["site_id"],
  });

export type PenggunaInput = z.output<typeof penggunaSchema>;

export const resetPasswordSchema = z.object({
  password: z.string().min(8, "Password minimal 8 karakter").max(72),
});

// ---------------------------------------------------------------------
// Poli & tindakan
// ---------------------------------------------------------------------

export const poliSchema = z.object({
  kode: z.string().trim().min(2).max(20).regex(/^[A-Z0-9-]+$/, "Kode huruf kapital"),
  nama: z.string().trim().min(2, "Nama poli wajib diisi").max(100),
  prefix_antrean: z
    .string()
    .trim()
    .min(1)
    .max(2)
    .regex(/^[A-Z]{1,2}$/, "Prefix antrean 1–2 huruf kapital"),
});

export const tindakanMasterSchema = z.object({
  kode: z.string().trim().min(2).max(30),
  nama: z.string().trim().min(2, "Nama tindakan wajib diisi").max(150),
  kategori: teks(60),
  /**
   * Menandai tindakan yang ter-select otomatis di form dokter dan satu-satunya
   * yang boleh didiskon. Boleh lebih dari satu — klinik biasanya punya
   * konsultasi umum dan konsultasi gigi; yang dipakai adalah yang paling
   * cocok dengan poli kunjungan.
   */
  is_konsultasi: z.coerce.boolean().default(false),
  tarif: z.coerce.number().min(0),
  icd9cm: teks(10),
});

// ---------------------------------------------------------------------
// Katalog obat & BMHP
// ---------------------------------------------------------------------

export const itemSchema = z.object({
  kode: z.string().trim().min(2, "Kode wajib diisi").max(30),
  tipe: z.enum(["obat", "bmhp", "alkes"]),
  nama: z.string().trim().min(2, "Nama wajib diisi").max(180),
  nama_generik: teks(180),
  kandungan: teks(255),
  category_id: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : Number(v))),
  bentuk_sediaan: teks(40),
  satuan_dasar: z.string().trim().min(1, "Satuan wajib diisi").max(20),
  hpp: z.coerce.number().min(0),
  harga_jual: z.coerce.number().min(0),
  min_stock: z.coerce.number().int().min(0).default(0),
  is_racikable: z.coerce.boolean().default(false),
  butuh_resep: z.coerce.boolean().default(true),
  kfa_code: teks(40),
});

export type ItemInput = z.output<typeof itemSchema>;

// ---------------------------------------------------------------------
// Panel & parameter lab
// ---------------------------------------------------------------------

export const panelSchema = z.object({
  kode: z.string().trim().min(2).max(30),
  nama: z.string().trim().min(2, "Nama panel wajib diisi").max(150),
  kategori: teks(60),
  tarif: z.coerce.number().min(0),
});

const angkaOpsional = z
  .union([z.literal(""), z.coerce.number()])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : Number(v)));

export const parameterSchema = z
  .object({
    panel_id: z.coerce.number().int().positive(),
    kode: z.string().trim().min(1).max(30),
    nama: z.string().trim().min(1, "Nama parameter wajib diisi").max(150),
    satuan: teks(30),
    tipe_nilai: z.enum(["numerik", "teks", "pilihan"]).default("numerik"),
    pilihan: teks(500),
    ref_low: angkaOpsional,
    ref_high: angkaOpsional,
    ref_teks: teks(100),
    kritis_low: angkaOpsional,
    kritis_high: angkaOpsional,
    urutan: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    (v) => v.ref_low === null || v.ref_high === null || v.ref_low <= v.ref_high,
    { message: "Batas bawah rujukan tidak boleh melebihi batas atas", path: ["ref_low"] },
  )
  .refine(
    (v) =>
      v.kritis_low === null || v.ref_low === null || v.kritis_low <= v.ref_low,
    {
      // Ambang kritis harus di LUAR rentang rujukan; kalau tidak, nilai
      // normal bisa ikut tertandai kritis.
      message: "Ambang kritis bawah harus di bawah atau sama dengan batas rujukan bawah",
      path: ["kritis_low"],
    },
  )
  .refine(
    (v) =>
      v.kritis_high === null || v.ref_high === null || v.kritis_high >= v.ref_high,
    {
      message: "Ambang kritis atas harus di atas atau sama dengan batas rujukan atas",
      path: ["kritis_high"],
    },
  );

// ---------------------------------------------------------------------
// ICD-10
// ---------------------------------------------------------------------

export const icd10Schema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(10)
    .regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/, "Format kode ICD-10 tidak valid"),
  nama_id: z.string().trim().min(2, "Nama diagnosa wajib diisi").max(255),
  nama_en: teks(255),
  bab: teks(120),
});

/**
 * Impor massal ICD-10 dari teks CSV/TSV. Seed hanya memuat 10 kode
 * tersering; daftar resmi Kemenkes berisi puluhan ribu baris.
 */
export const imporIcd10Schema = z.object({
  isi: z.string().trim().min(1, "Tempelkan isi berkas terlebih dahulu"),
  pemisah: z.enum([",", "\t", ";"]).default(","),
});
