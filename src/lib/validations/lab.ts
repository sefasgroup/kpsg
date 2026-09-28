import { z } from "zod";

export const SIFAT_HASIL = ["ditunggu", "menyusul"] as const;
export type SifatHasil = (typeof SIFAT_HASIL)[number];

export const LABEL_SIFAT: Record<SifatHasil, string> = {
  ditunggu: "Hasil ditunggu",
  menyusul: "Hasil menyusul",
};

export const JELAS_SIFAT: Record<SifatHasil, string> = {
  ditunggu:
    "Pasien menunggu di klinik. Asesmen belum bisa difinalkan sampai hasilnya keluar, lalu pasien kembali ke Anda untuk dinilai.",
  menyusul:
    "Pasien lanjut ke farmasi/kasir sekarang. Hasilnya masuk kapan pun dan Anda dinotifikasi — tindak lanjutnya lewat kunjungan kontrol.",
};

/** Order laboratorium dari dokter. */
export const orderLabSchema = z.object({
  prioritas: z.enum(["rutin", "cito"]).default("rutin"),
  /*
   * Menentukan apakah pasien TERTAHAN menunggu hasil. Bukan turunan dari
   * `prioritas`: order cito pun bisa hasilnya menyusul (dikirim ke lab
   * rujukan hari itu juga tetapi jadi tiga hari), dan order rutin bisa
   * ditunggu (darah rutin 20 menit). Yang menentukan adalah apakah hasilnya
   * dibutuhkan untuk keputusan HARI INI.
   */
  sifat_hasil: z.enum(SIFAT_HASIL).default("ditunggu"),
  catatan_klinis: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  panels: z
    .array(
      z.object({
        panel_id: z.coerce.number().int().positive(),
        nama: z.string().trim().max(150),
        tarif: z.coerce.number().min(0),
      }),
    )
    .min(1, "Pilih minimal satu pemeriksaan"),
});

export type OrderLabFormValues = z.input<typeof orderLabSchema>;
export type OrderLabInput = z.output<typeof orderLabSchema>;

/**
 * Hasil pemeriksaan. Nilai dibiarkan sebagai string di sini karena satu
 * parameter bisa numerik, teks, atau pilihan — konversi dan penandaan
 * L/H/kritis dilakukan di server berdasarkan tipe parameternya.
 */
export const hasilLabSchema = z.object({
  hasil: z
    .array(
      z.object({
        parameter_id: z.coerce.number().int().positive(),
        panel_id: z.coerce.number().int().positive(),
        nilai: z.string().trim().max(255),
        catatan: z
          .string()
          .trim()
          .max(255)
          .optional()
          .transform((v) => (v === "" ? undefined : v)),
      }),
    )
    .default([]),
  /** Menutup order: semua parameter wajib terisi (dicek di server). */
  finalkan: z.coerce.boolean().default(false),
});

export type HasilLabFormValues = z.input<typeof hasilLabSchema>;
export type HasilLabInput = z.output<typeof hasilLabSchema>;

export const FLAG_LABEL: Record<string, string> = {
  N: "Normal",
  L: "Rendah",
  H: "Tinggi",
  LL: "Kritis rendah",
  HH: "Kritis tinggi",
};
