import { z } from "zod";

export const STATUS_KLAIM = [
  "draft",
  "diajukan",
  "disetujui",
  "lunas",
  "batal",
] as const;

export const LABEL_STATUS_KLAIM: Record<(typeof STATUS_KLAIM)[number], string> = {
  draft: "Draft",
  diajukan: "Diajukan",
  disetujui: "Disetujui",
  lunas: "Lunas",
  batal: "Batal",
};

const tanggal = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus YYYY-MM-DD");

export const klaimBaruSchema = z
  .object({
    payer_id: z.coerce.number().int().positive("Penjamin wajib dipilih"),
    periode_dari: tanggal,
    periode_sampai: tanggal,
    catatan: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
  })
  .refine((v) => v.periode_dari <= v.periode_sampai, {
    message: "Tanggal awal tidak boleh setelah tanggal akhir",
    path: ["periode_sampai"],
  });

export type KlaimBaruInput = z.output<typeof klaimBaruSchema>;

/**
 * Hasil verifikasi penjamin per baris.
 *
 * `nilai_disetujui` boleh nol — penjamin memang bisa menolak satu baris
 * sepenuhnya. Yang tidak boleh adalah melebihi nilai yang diajukan;
 * penjamin yang membayar lebih dari tagihan bukan koreksi, melainkan
 * kesalahan input yang akan merusak rekonsiliasi.
 */
export const verifikasiBarisSchema = z.object({
  claim_item_id: z.coerce.number().int().positive(),
  nilai_disetujui: z.coerce.number().min(0, "Nilai tidak boleh negatif"),
  alasan_koreksi: z
    .string()
    .trim()
    .max(255)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export const verifikasiKlaimSchema = z.object({
  baris: z.array(verifikasiBarisSchema).min(1, "Tidak ada baris untuk diverifikasi"),
});

export type VerifikasiKlaimInput = z.output<typeof verifikasiKlaimSchema>;

export const METODE_BAYAR_KLAIM = ["transfer", "tunai", "cek", "lainnya"] as const;

export const LABEL_METODE_KLAIM: Record<
  (typeof METODE_BAYAR_KLAIM)[number],
  string
> = {
  transfer: "Transfer Bank",
  tunai: "Tunai",
  cek: "Cek / Giro",
  lainnya: "Lainnya",
};

export const bayarKlaimSchema = z.object({
  tanggal,
  jumlah: z.coerce.number().positive("Jumlah pembayaran harus lebih dari 0"),
  metode: z.enum(METODE_BAYAR_KLAIM).default("transfer"),
  ref: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  catatan: z
    .string()
    .trim()
    .max(255)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export type BayarKlaimInput = z.output<typeof bayarKlaimSchema>;
