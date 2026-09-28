import { z } from "zod";

export const METODE_BAYAR = [
  "tunai",
  "qris",
  "transfer",
  "kartu_debit",
  "kartu_kredit",
  "bpjs",
  /*
   * `penjamin` dipakai saat SELURUH tagihan ditanggung penjamin sehingga
   * pasien tidak mengeluarkan uang sama sekali. Tagihannya tetap ditandai
   * lunas — supaya gerbang farmasi (obat hanya keluar setelah lunas) tidak
   * perlu diutak-atik — dan piutangnya hidup di klaim, bukan dengan
   * menahan pasien di kasir.
   */
  "penjamin",
  "lainnya",
] as const;

export const METODE_LABEL: Record<(typeof METODE_BAYAR)[number], string> = {
  tunai: "Tunai",
  qris: "QRIS",
  transfer: "Transfer Bank",
  kartu_debit: "Kartu Debit",
  kartu_kredit: "Kartu Kredit",
  bpjs: "BPJS",
  penjamin: "Ditanggung Penjamin",
  lainnya: "Lainnya",
};

/**
 * Metode non-tunai wajib punya nomor referensi untuk rekonsiliasi.
 * `lainnya` ikut: tanpa keterangan, tagihan lunas lewat "lainnya" adalah
 * pendapatan yang hilang tanpa jejak ke mana uangnya masuk.
 */
export const BUTUH_REFERENSI: readonly string[] = [
  "qris",
  "transfer",
  "kartu_debit",
  "kartu_kredit",
  "lainnya",
];

export const pembayaranSchema = z
  .object({
    payment_method: z.enum(METODE_BAYAR, { message: "Metode bayar wajib dipilih" }),
    payment_ref: z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
    diskon: z.coerce.number().min(0, "Diskon tidak boleh negatif").default(0),
    /** Uang yang diterima. Hanya bermakna untuk pembayaran tunai. */
    dibayar: z.coerce.number().min(0).default(0),
    catatan: z
      .string()
      .trim()
      .max(255)
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
  })
  .refine(
    (v) => !BUTUH_REFERENSI.includes(v.payment_method) || Boolean(v.payment_ref),
    {
      message: "Nomor referensi/approval wajib diisi untuk pembayaran non-tunai",
      path: ["payment_ref"],
    },
  );

export type PembayaranFormValues = z.input<typeof pembayaranSchema>;
export type PembayaranInput = z.output<typeof pembayaranSchema>;

export const shiftSchema = z.object({
  kas_awal: z.coerce.number().min(0).default(0),
});

export const tutupShiftSchema = z.object({
  kas_akhir_fisik: z.coerce.number().min(0),
  catatan: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});
