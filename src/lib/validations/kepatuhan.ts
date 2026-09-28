import { z } from "zod";

// ---------------------------------------------------------------------
// Persetujuan (informed & general consent)
// ---------------------------------------------------------------------

export const JENIS_CONSENT = ["umum", "tindakan", "penolakan", "privasi"] as const;

export const LABEL_JENIS_CONSENT: Record<(typeof JENIS_CONSENT)[number], string> = {
  umum: "Persetujuan Umum",
  tindakan: "Persetujuan Tindakan",
  penolakan: "Penolakan Tindakan",
  privasi: "Persetujuan Pelepasan Informasi",
};

export const consentSchema = z
  .object({
    visit_id: z.coerce.number().int().positive(),
    jenis: z.enum(JENIS_CONSENT),
    judul: z.string().trim().min(3, "Judul wajib diisi").max(180),
    /*
     * Isi persetujuan disimpan apa adanya, bukan sebagai rujukan ke
     * templat. Kalimat yang ditandatangani pasien tahun ini harus tetap
     * terbaca sama meski templatnya diubah tahun depan — itulah gunanya
     * dokumen persetujuan.
     */
    isi: z.string().trim().min(20, "Isi persetujuan terlalu pendek untuk ditandatangani"),
    procedure_id: z.coerce.number().int().positive().nullable().default(null),
    penjelasan_oleh: z.coerce.number().int().positive().nullable().default(null),
    penandatangan: z.string().trim().min(3, "Nama penandatangan wajib diisi").max(150),
    hubungan: z.string().trim().min(2).max(60).default("Pasien sendiri"),
    saksi_nama: z
      .string()
      .trim()
      .max(150)
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
    status: z.enum(["setuju", "menolak"]).default("setuju"),
  })
  /*
   * Persetujuan TINDAKAN tanpa menyebut tindakannya bukan persetujuan —
   * pasien tidak bisa menyetujui sesuatu yang tidak dinamai. Aturan ini
   * tidak berlaku bagi persetujuan umum, yang justru sengaja luas.
   */
  .refine((v) => v.jenis !== "tindakan" || v.procedure_id !== null, {
    message: "Persetujuan tindakan wajib menyebut tindakan yang disetujui",
    path: ["procedure_id"],
  })
  .refine((v) => v.jenis !== "tindakan" || v.penjelasan_oleh !== null, {
    message: "Wajib mencatat siapa yang memberi penjelasan sebelum pasien setuju",
    path: ["penjelasan_oleh"],
  })
  /*
   * Penolakan yang dicatat sebagai "setuju" adalah dokumen yang berkata
   * kebalikan dari kenyataan — justru dokumen inilah yang dicari kalau
   * kelak terjadi sengketa.
   */
  .refine((v) => v.jenis !== "penolakan" || v.status === "menolak", {
    message: "Formulir penolakan harus berstatus menolak",
    path: ["status"],
  });

export type ConsentFormValues = z.input<typeof consentSchema>;
export type ConsentInput = z.output<typeof consentSchema>;

// ---------------------------------------------------------------------
// Insiden Keselamatan Pasien (IKP)
// ---------------------------------------------------------------------

export const JENIS_IKP = ["kpc", "knc", "ktc", "ktd", "sentinel"] as const;

export const LABEL_JENIS_IKP: Record<(typeof JENIS_IKP)[number], string> = {
  kpc: "KPC — Kondisi Potensial Cedera",
  knc: "KNC — Nyaris Cedera",
  ktc: "KTC — Cedera Tidak Terjadi",
  ktd: "KTD — Kejadian Tidak Diharapkan",
  sentinel: "Sentinel — Kematian / Cedera Permanen",
};

export const GRADING_IKP = ["biru", "hijau", "kuning", "merah"] as const;

export const LABEL_GRADING_IKP: Record<(typeof GRADING_IKP)[number], string> = {
  biru: "Biru — risiko rendah",
  hijau: "Hijau — risiko sedang",
  kuning: "Kuning — risiko tinggi, wajib RCA",
  merah: "Merah — risiko ekstrem, wajib RCA segera",
};

export const STATUS_IKP = ["baru", "investigasi", "selesai", "ditutup"] as const;

export const LABEL_STATUS_IKP: Record<(typeof STATUS_IKP)[number], string> = {
  baru: "Baru dilaporkan",
  investigasi: "Investigasi",
  selesai: "Analisis selesai",
  ditutup: "Ditutup",
};

export const ikpSchema = z.object({
  visit_id: z.coerce.number().int().positive().nullable().default(null),
  tanggal: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus YYYY-MM-DD"),
  waktu: z
    .union([z.literal(""), z.string().trim().regex(/^\d{2}:\d{2}$/, "Waktu harus HH:MM")])
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  lokasi: z.string().trim().min(2, "Lokasi kejadian wajib diisi").max(120),
  jenis: z.enum(JENIS_IKP),
  grading: z.enum(GRADING_IKP).nullable().default(null),
  /*
   * Kronologi diminta panjang dengan sengaja. Laporan satu baris
   * ("pasien jatuh") tidak bisa dianalisis, dan insiden yang tidak bisa
   * dianalisis tidak mencegah insiden berikutnya.
   */
  kronologi: z
    .string()
    .trim()
    .min(30, "Kronologi terlalu singkat untuk bisa dianalisis — tuliskan urutan kejadiannya"),
  dampak: z.string().trim().max(1000).optional().transform((v) => (v === "" ? undefined : v)),
  tindakan_segera: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  /*
   * Pelaporan anonim harus mungkin. Budaya keselamatan pasien runtuh
   * begitu melapor terasa seperti mengaku salah, dan sistem yang
   * mewajibkan nama pelapor memastikan hal itu terjadi.
   */
  anonim: z.coerce.boolean().default(false),
});

export type IkpFormValues = z.input<typeof ikpSchema>;
export type IkpInput = z.output<typeof ikpSchema>;

export const tindakLanjutIkpSchema = z
  .object({
    grading: z.enum(GRADING_IKP),
    analisis: z.string().trim().max(4000).optional().transform((v) => (v === "" ? undefined : v)),
    rekomendasi: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
    status: z.enum(STATUS_IKP),
  })
  /*
   * Grading kuning dan merah WAJIB disertai akar masalah sebelum boleh
   * ditutup. Inilah satu-satunya penjaga yang membedakan tindak lanjut
   * dari sekadar mengarsipkan laporan.
   */
  .refine(
    (v) =>
      !(["kuning", "merah"] as string[]).includes(v.grading) ||
      v.status !== "ditutup" ||
      Boolean(v.analisis),
    {
      message:
        "Insiden grading kuning/merah tidak boleh ditutup tanpa analisis akar masalah (RCA)",
      path: ["analisis"],
    },
  );

export type TindakLanjutIkpInput = z.output<typeof tindakLanjutIkpSchema>;
