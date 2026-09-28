import { z } from "zod";

/**
 * Pengkajian awal perawat (CLAUDE.md §3.1 & §4).
 *
 * Rentang TTV sengaja dibuat lebar — batasnya adalah "mustahil secara
 * fisiologis", bukan "di luar normal". Nilai ekstrem yang nyata harus tetap
 * bisa diinput; menandai abnormal adalah tugas UI, bukan validasi.
 */

const angkaOpsional = (min: number, max: number, label: string) =>
  z
    .union([z.literal(""), z.coerce.number()])
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : Number(v)))
    .refine((v) => v === undefined || (v >= min && v <= max), {
      message: `${label} harus antara ${min} dan ${max}`,
    });

/**
 * Alergi baru yang dicatat perawat saat triase.
 *
 * Sengaja TERPISAH dari pengkajian dan menulis ke `patient_allergies`, bukan
 * ke baris kunjungan: alergi melekat pada PASIEN, bukan pada satu kunjungan.
 * Alergi yang dicatat sebagai teks bebas di pengkajian tidak akan muncul saat
 * pasien datang bulan depan, dan tidak terbaca farmasi saat memeriksa resep —
 * padahal justru di situ gunanya.
 */
export const alergiSchema = z.object({
  jenis: z.enum(["obat", "makanan", "lingkungan", "lainnya"]).default("obat"),
  nama_alergen: z
    .string()
    .trim()
    .min(2, "Nama alergen wajib diisi")
    .max(150),
  reaksi: z
    .string()
    .trim()
    .max(255)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  keparahan: z
    .enum(["ringan", "sedang", "berat"])
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type AlergiInput = z.output<typeof alergiSchema>;

export const nurseAssessmentSchema = z.object({
  triase: z.enum(["merah", "kuning", "hijau", "hitam"], {
    message: "Triase wajib dipilih",
  }),
  keluhan_utama: z
    .string()
    .trim()
    .min(3, "Keluhan utama wajib diisi")
    .max(2000),
  riwayat_singkat: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  riwayat_pengobatan: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),

  // Tanda-tanda vital
  td_sistolik: angkaOpsional(40, 300, "Tekanan sistolik"),
  td_diastolik: angkaOpsional(20, 200, "Tekanan diastolik"),
  nadi: angkaOpsional(20, 250, "Nadi"),
  respirasi: angkaOpsional(5, 80, "Respirasi"),
  suhu: angkaOpsional(30, 45, "Suhu"),
  spo2: angkaOpsional(50, 100, "SpO2"),
  kesadaran: z
    .enum(["compos_mentis", "apatis", "somnolen", "sopor", "koma"])
    .optional()
    .or(z.literal("").transform(() => undefined)),
  keadaan_umum: z
    .enum(["baik", "sedang", "buruk"])
    .optional()
    .or(z.literal("").transform(() => undefined)),
  keadaan_gizi: z
    .enum(["baik", "kurang", "buruk"])
    .optional()
    .or(z.literal("").transform(() => undefined)),

  /*
   * GCS: rentang per komponen BERBEDA (E 1-4, V 1-5, M 1-6) dan bukan sekadar
   * "angka kecil". Membatasinya seragam 1-6 akan meloloskan E5 — nilai yang
   * tidak ada dalam skala, tapi tetap menghasilkan total yang tampak masuk
   * akal. Aturan ini juga ditegakkan ulang di database.
   */
  gcs_e: angkaOpsional(1, 4, "GCS Eye"),
  gcs_v: angkaOpsional(1, 5, "GCS Verbal"),
  gcs_m: angkaOpsional(1, 6, "GCS Motorik"),

  // Antropometri — IMT dihitung otomatis oleh database (generated column)
  berat_badan: angkaOpsional(0.5, 400, "Berat badan"),
  tinggi_badan: angkaOpsional(20, 250, "Tinggi badan"),
  lingkar_perut: angkaOpsional(20, 250, "Lingkar perut"),

  skala_nyeri: angkaOpsional(0, 10, "Skala nyeri"),
  risiko_jatuh: z
    .enum(["rendah", "sedang", "tinggi"])
    .optional()
    .or(z.literal("").transform(() => undefined)),
  status_alergi_dikonfirmasi: z.coerce.boolean().default(false),
  catatan: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),

  /**
   * BMHP yang dipakai selama pengkajian. Setiap baris memicu pemotongan
   * stok dan satu baris tagihan (CLAUDE.md §3.1 "Automasi Sistem Backend").
   */
  bmhp: z
    .array(
      z.object({
        item_id: z.coerce.number().int().positive(),
        nama: z.string(),
        satuan: z.string(),
        harga_satuan: z.coerce.number().min(0),
        qty: z.coerce.number().positive("Jumlah BMHP harus lebih dari 0"),
      }),
    )
    .default([]),
});

export type NurseAssessmentFormValues = z.input<typeof nurseAssessmentSchema>;
export type NurseAssessmentInput = z.output<typeof nurseAssessmentSchema>;

/** Tekanan darah dicatat berpasangan — satu sisi saja tidak bermakna klinis. */
export const nurseAssessmentSchemaFinal = nurseAssessmentSchema.refine(
  (v) =>
    (v.td_sistolik === undefined) === (v.td_diastolik === undefined),
  {
    message: "Tekanan darah harus diisi lengkap (sistolik dan diastolik)",
    path: ["td_diastolik"],
  },
);
