import { z } from "zod";

/** Validasi surat keterangan medis (CLAUDE.md §5.2 — kertas A4/A5 berkop). */

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

export const JENIS_SURAT = ["sakit", "sehat", "rujukan", "keterangan_lain"] as const;
export type JenisSurat = (typeof JENIS_SURAT)[number];

/**
 * Hasil tes buta warna pada surat keterangan sehat.
 *
 * Yang disimpan adalah kodenya, bukan kalimatnya. Surat yang sudah terbit
 * tidak bisa diubah, jadi isinya akan dibaca ulang bertahun-tahun kemudian
 * saat kalimatnya mungkin sudah diperbaiki redaksinya — kode yang stabil
 * membuat surat lama tetap terbaca benar.
 */
export const BUTA_WARNA = ["tidak", "parsial", "total"] as const;
export type ButaWarna = (typeof BUTA_WARNA)[number];

export const LABEL_BUTA_WARNA: Record<ButaWarna, string> = {
  tidak: "Tidak buta warna",
  parsial: "Buta warna parsial",
  total: "Buta warna total",
};

export const suratSchema = z
  .object({
    visit_id: z.coerce.number().int().positive("Kunjungan wajib dipilih"),
    jenis: z.enum(JENIS_SURAT, { message: "Jenis surat wajib dipilih" }),

    // Surat sakit
    mulai: z.union([z.literal(""), tanggalIso]).optional().transform((v) => (v ? v : null)),
    lama_hari: z
      .union([z.literal(""), z.coerce.number().int().min(1).max(30)])
      .optional()
      .transform((v) => (v === "" || v === undefined ? null : Number(v))),
    diagnosa_ditulis: teks(255),

    // Surat sehat
    keperluan: teks(255),
    tinggi_badan: z.union([z.literal(""), z.coerce.number().min(0).max(300)]).optional()
      .transform((v) => (v === "" || v === undefined ? null : Number(v))),
    berat_badan: z.union([z.literal(""), z.coerce.number().min(0).max(500)]).optional()
      .transform((v) => (v === "" || v === undefined ? null : Number(v))),
    tekanan_darah: teks(20),
    gol_darah: teks(5),
    buta_warna: z
      .union([z.literal(""), z.enum(BUTA_WARNA)])
      .optional()
      .transform((v) => (v ? v : null)),

    // Rujukan
    tujuan_faskes: teks(200),
    tujuan_bagian: teks(120),
    alasan_rujukan: teks(500),
    ringkasan_klinis: teks(1000),

    // Keterangan lain
    perihal: teks(200),
    isi_bebas: teks(2000),
  })
  .superRefine((v, ctx) => {
    // Setiap jenis surat punya syarat minimumnya sendiri. Surat sakit tanpa
    // lama istirahat, atau rujukan tanpa faskes tujuan, adalah dokumen yang
    // tidak bisa dipakai penerimanya.
    if (v.jenis === "sakit") {
      if (v.lama_hari === null) {
        ctx.addIssue({ code: "custom", path: ["lama_hari"], message: "Lama istirahat wajib diisi" });
      }
      if (v.mulai === null) {
        ctx.addIssue({ code: "custom", path: ["mulai"], message: "Tanggal mulai istirahat wajib diisi" });
      }
    }
    if (v.jenis === "sehat" && !v.keperluan) {
      ctx.addIssue({ code: "custom", path: ["keperluan"], message: "Keperluan surat wajib diisi" });
    }
    if (v.jenis === "rujukan") {
      if (!v.tujuan_faskes) {
        ctx.addIssue({ code: "custom", path: ["tujuan_faskes"], message: "Faskes tujuan wajib diisi" });
      }
      if (!v.alasan_rujukan) {
        ctx.addIssue({ code: "custom", path: ["alasan_rujukan"], message: "Alasan rujukan wajib diisi" });
      }
    }
    if (v.jenis === "keterangan_lain") {
      if (!v.perihal) {
        ctx.addIssue({ code: "custom", path: ["perihal"], message: "Perihal wajib diisi" });
      }
      if (!v.isi_bebas) {
        ctx.addIssue({ code: "custom", path: ["isi_bebas"], message: "Isi surat wajib diisi" });
      }
    }
  });

export type SuratInput = z.output<typeof suratSchema>;
