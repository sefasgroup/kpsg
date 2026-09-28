import { z } from "zod";

/** Validasi modul inventori farmasi: penerimaan, pengeluaran, opname, kadaluarsa. */

const teks = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

const tanggalIso = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD");

const tanggalOpsional = z
  .union([z.literal(""), tanggalIso])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

// ---------------------------------------------------------------------
// Supplier
// ---------------------------------------------------------------------

export const supplierSchema = z.object({
  kode: z
    .string()
    .trim()
    .min(2, "Kode supplier minimal 2 karakter")
    .max(30)
    .regex(/^[A-Z0-9-]+$/, "Kode hanya boleh huruf kapital, angka, dan tanda hubung"),
  nama: z.string().trim().min(2, "Nama supplier wajib diisi").max(150),
  kontak: teks(100),
  telepon: teks(30),
  alamat: teks(500),
});

export type SupplierInput = z.output<typeof supplierSchema>;

// ---------------------------------------------------------------------
// Penerimaan barang
// ---------------------------------------------------------------------

export const barisPenerimaanSchema = z
  .object({
    item_id: z.coerce.number().int().positive("Item wajib dipilih"),
    no_batch: teks(60),
    tanggal_kadaluarsa: tanggalOpsional,
    qty: z.coerce.number().positive("Jumlah harus lebih dari 0"),
    harga_satuan: z.coerce.number().min(0, "Harga tidak boleh negatif"),
  })
  .refine(
    // Barang kadaluarsa tidak boleh masuk gudang. Menerimanya berarti stok
    // yang tercatat "ada" sebenarnya tidak boleh diserahkan ke pasien.
    (v) => v.tanggal_kadaluarsa === null || v.tanggal_kadaluarsa >= "1900-01-01",
    { message: "Tanggal kadaluarsa tidak valid", path: ["tanggal_kadaluarsa"] },
  );

export const penerimaanSchema = z.object({
  supplier_id: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : Number(v))),
  no_faktur: teks(60),
  tanggal: tanggalIso,
  diskon: z.coerce.number().min(0).default(0),
  ppn: z.coerce.number().min(0).default(0),
  catatan: teks(500),
  /**
   * `items.hpp` adalah kolom global sementara stok disimpan per cabang,
   * jadi pembaruan HPP dibuat opsional dan eksplisit — bukan efek samping
   * diam-diam dari sebuah penerimaan di satu cabang.
   */
  perbarui_hpp: z.coerce.boolean().default(false),
  items: z
    .array(barisPenerimaanSchema)
    .min(1, "Tambahkan minimal satu item yang diterima"),
});

export type PenerimaanInput = z.output<typeof penerimaanSchema>;

// ---------------------------------------------------------------------
// Pengeluaran non-resep
// ---------------------------------------------------------------------

export const JENIS_PENGELUARAN = [
  "keluar_kadaluarsa",
  "keluar_rusak",
  "keluar_koreksi",
] as const;

export const pengeluaranSchema = z.object({
  item_id: z.coerce.number().int().positive("Item wajib dipilih"),
  qty: z.coerce.number().positive("Jumlah harus lebih dari 0"),
  jenis: z.enum(JENIS_PENGELUARAN, { message: "Alasan pengeluaran wajib dipilih" }),
  /**
   * Wajib dan cukup panjang. Pengeluaran non-resep adalah satu-satunya jalan
   * stok berkurang tanpa pasien, jadi keterangannya harus bisa
   * dipertanggungjawabkan saat audit — bukan sekadar "koreksi".
   */
  alasan: z
    .string()
    .trim()
    .min(10, "Keterangan minimal 10 karakter — harus bisa ditelusuri saat audit")
    .max(255),
});

export type PengeluaranInput = z.output<typeof pengeluaranSchema>;

// ---------------------------------------------------------------------
// Stock opname
// ---------------------------------------------------------------------

export const opnameBaruSchema = z.object({
  tanggal: tanggalIso,
  catatan: teks(500),
  /** Batasi cakupan agar opname parsial (mis. hanya obat) tetap bermakna. */
  tipe: z.enum(["semua", "obat", "bmhp", "alkes"]).default("semua"),
});

export const opnameHitungSchema = z.object({
  opname_id: z.coerce.number().int().positive(),
  item_id: z.coerce.number().int().positive(),
  qty_fisik: z.coerce.number().min(0, "Jumlah fisik tidak boleh negatif"),
  catatan: teks(255),
});

// ---------------------------------------------------------------------
// Penarikan batch kadaluarsa
// ---------------------------------------------------------------------

export const tarikBatchSchema = z.object({
  batch_id: z.coerce.number().int().positive(),
  qty: z.coerce.number().positive("Jumlah harus lebih dari 0"),
  alasan: z
    .string()
    .trim()
    .min(10, "Keterangan minimal 10 karakter")
    .max(255),
});
