import { z } from "zod";

export const JENIS_PENJAMIN = ["bpjs", "asuransi", "perusahaan"] as const;

export const LABEL_JENIS_PENJAMIN: Record<
  (typeof JENIS_PENJAMIN)[number],
  string
> = {
  bpjs: "BPJS Kesehatan",
  asuransi: "Asuransi",
  perusahaan: "Perusahaan",
};

export const penjaminSchema = z.object({
  kode: z
    .string()
    .trim()
    .min(2, "Kode minimal 2 karakter")
    .max(30)
    .regex(/^[A-Z0-9.-]+$/, "Kode hanya boleh huruf kapital, angka, titik, dan tanda hubung"),
  nama: z.string().trim().min(3, "Nama penjamin wajib diisi").max(180),
  jenis: z.enum(JENIS_PENJAMIN),
  npwp: z.string().trim().max(30).optional().transform((v) => (v === "" ? undefined : v)),
  alamat: z.string().trim().max(500).optional().transform((v) => (v === "" ? undefined : v)),
  telepon: z.string().trim().max(30).optional().transform((v) => (v === "" ? undefined : v)),
  email: z
    .union([z.literal(""), z.string().trim().email("Format email tidak valid").max(150)])
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  pic_nama: z.string().trim().max(150).optional().transform((v) => (v === "" ? undefined : v)),
  pic_telepon: z.string().trim().max(30).optional().transform((v) => (v === "" ? undefined : v)),
  /*
   * Termin dibatasi 1–365 hari. Nol akan berarti "jatuh tempo hari ini
   * juga", yang membuat setiap klaim langsung tampak terlambat sejak
   * detik diajukan — laporan umur piutang jadi tidak bisa dibaca.
   */
  termin_hari: z.coerce
    .number()
    .int("Termin harus bilangan bulat")
    .min(1, "Termin minimal 1 hari")
    .max(365, "Termin maksimal 365 hari")
    .default(30),
  /** 0 = tanpa batas. Selisih di atas plafon jadi tanggungan pasien. */
  plafon_per_kunjungan: z.coerce
    .number()
    .min(0, "Plafon tidak boleh negatif")
    .default(0),
  catatan: z.string().trim().max(500).optional().transform((v) => (v === "" ? undefined : v)),
  is_active: z.coerce.boolean().default(true),
});

export type PenjaminFormValues = z.input<typeof penjaminSchema>;
export type PenjaminInput = z.output<typeof penjaminSchema>;

/**
 * Satu baris tarif kontrak menunjuk TEPAT SATU sasaran.
 *
 * Aturan yang sama ditegakkan `ck_ptar_sasaran` di database. Ditulis dua
 * kali dengan sengaja: pesan yang bisa dibaca manusia di sini, dan jaminan
 * yang tidak bisa dilewati siapa pun di sana.
 */
export const tarifPenjaminSchema = z
  .object({
    payer_id: z.coerce.number().int().positive(),
    procedure_id: z.coerce.number().int().positive().nullable().default(null),
    item_id: z.coerce.number().int().positive().nullable().default(null),
    harga: z.coerce.number().min(0, "Harga tidak boleh negatif"),
  })
  .refine((v) => (v.procedure_id === null) !== (v.item_id === null), {
    message: "Pilih tepat satu: tindakan atau barang",
    path: ["procedure_id"],
  });

export type TarifPenjaminInput = z.output<typeof tarifPenjaminSchema>;
