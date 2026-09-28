import { z } from "zod";

/** Asesmen dokter (SOAP), diagnosa ICD-10, tindakan, dan E-Resep. */

const teksOpsional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

/**
 * Tipe diagnosa. `banding` adalah kemungkinan yang BELUM ditegakkan — ia
 * sengaja tidak ikut dihitung sebagai diagnosa primer, dan tidak boleh
 * dipakai sebagai dasar klaim.
 */
export const TIPE_DIAGNOSA = ["primer", "sekunder", "komplikasi", "banding"] as const;
export type TipeDiagnosa = (typeof TIPE_DIAGNOSA)[number];

export const LABEL_TIPE_DIAGNOSA: Record<TipeDiagnosa, string> = {
  primer: "Diagnosa Utama",
  sekunder: "Diagnosa Sekunder",
  komplikasi: "Komplikasi",
  banding: "Diagnosa Banding",
};

export const diagnosaSchema = z.object({
  icd10_code: z.string().trim().min(1, "Kode ICD-10 wajib diisi").max(10),
  nama: z.string().trim().max(255),
  tipe: z.enum(TIPE_DIAGNOSA).default("primer"),
  keterangan: teksOpsional(255),
});

export const JENIS_ANAMNESIS = ["auto", "allo"] as const;
export const LABEL_ANAMNESIS: Record<string, string> = {
  auto: "Autoanamnesis — langsung dari pasien",
  allo: "Alloanamnesis — dari pengantar/keluarga",
};

export const KEADAAN_UMUM = ["baik", "sedang", "buruk"] as const;
export const KEADAAN_GIZI = ["baik", "kurang", "buruk"] as const;

/** Satu titik keluhan pada body diagram status lokalis. */
export const titikLokalisSchema = z.object({
  sisi: z.enum(["depan", "belakang"]),
  /** Persen terhadap lebar/tinggi gambar, bukan piksel — supaya tetap tepat
      di layar mana pun dan pada hasil cetak. */
  x: z.coerce.number().min(0).max(100),
  y: z.coerce.number().min(0).max(100),
  keterangan: z.string().trim().max(255).default(""),
});

/**
 * Regio Status Lokalis, urut kepala → kulit sesuai formulir KPSG.
 *
 * Berbasis data supaya daftarnya bisa ditambah, dikurangi, atau diurutkan
 * ulang di SATU tempat — form, lembar cetak, dan penyimpanan semuanya membaca
 * dari sini. Yang tersimpan di database adalah `kunci`, jadi mengubah `label`
 * aman sedangkan mengubah `kunci` memutus data lama.
 */
export const REGIO_PEMERIKSAAN = [
  { kunci: "kepala", label: "Kepala", contoh: "Normosefali, jejas, nyeri tekan" },
  { kunci: "mata", label: "Mata", contoh: "Konjungtiva anemis, sklera ikterik, pupil" },
  { kunci: "hidung", label: "Hidung", contoh: "Sekret, deviasi septum, konka" },
  { kunci: "telinga", label: "Telinga", contoh: "Sekret, serumen, membran timpani" },
  { kunci: "tenggorokan", label: "Tenggorokan", contoh: "Faring hiperemis, tonsil T1/T1" },
  { kunci: "leher", label: "Leher", contoh: "Pembesaran KGB, JVP, kaku kuduk" },
  { kunci: "dada", label: "Dada", contoh: "Bentuk simetris, retraksi, jejas" },
  { kunci: "jantung", label: "Jantung", contoh: "BJ I–II reguler, murmur, gallop" },
  { kunci: "paru", label: "Paru", contoh: "Vesikuler, ronki, wheezing" },
  { kunci: "perut", label: "Perut", contoh: "Bising usus, nyeri tekan, distensi" },
  { kunci: "hati", label: "Hati", contoh: "Tidak teraba / teraba … jari bawah arcus costae" },
  { kunci: "limpa", label: "Limpa", contoh: "Tidak teraba / Schuffner …" },
  { kunci: "punggung", label: "Punggung", contoh: "Nyeri ketok CVA, deformitas, gibbus" },
  { kunci: "genitalia", label: "Genitalia", contoh: "Diisi hanya bila relevan dengan keluhan" },
  { kunci: "ekstremitas", label: "Ekstremitas", contoh: "Akral, edema, CRT, gerak, kekuatan" },
  { kunci: "kulit", label: "Kulit", contoh: "Turgor, ruam, lesi, sianosis" },
] as const;

export const KUNCI_REGIO = new Set<string>(REGIO_PEMERIKSAAN.map((r) => r.kunci));

export const regioSchema = z.object({
  /** Dalam Batas Normal — diperiksa dan tidak ditemukan kelainan. */
  dbn: z.coerce.boolean().default(false),
  temuan: z.string().trim().max(255).default(""),
});

export const statusLokalisSchema = z
  .object({
    catatan: teksOpsional(2000),
    titik: z.array(titikLokalisSchema).max(30).default([]),
    regio: z.record(z.string(), regioSchema).default({}),
  })
  .transform((v) => ({
    ...v,
    /*
     * Hanya kunci yang dikenal DAN benar-benar terisi yang disimpan.
     *
     * Regio yang dibiarkan kosong berarti "tidak diperiksa" — itu keadaan
     * yang sah dan berbeda dari "diperiksa, normal". Menyimpannya sebagai
     * baris kosong membuat setiap asesmen membawa tiga belas entri hampa,
     * dan menghapus perbedaan antara belum diperiksa dan tidak ada kelainan.
     */
    regio: Object.fromEntries(
      Object.entries(v.regio).filter(
        ([k, r]) => KUNCI_REGIO.has(k) && (r.dbn || r.temuan.length > 0),
      ),
    ),
  }));

export type TitikLokalis = z.output<typeof titikLokalisSchema>;
export type StatusLokalis = z.output<typeof statusLokalisSchema>;
export type RegioPemeriksaan = z.output<typeof regioSchema>;

export const tindakanSchema = z.object({
  procedure_id: z.coerce.number().int().positive(),
  nama: z.string().trim().max(150),
  qty: z.coerce.number().int().positive().default(1),
  tarif: z.coerce.number().min(0),
  /*
   * Potongan nominal. Hanya berlaku pada tindakan konsultasi — dan yang
   * menentukan mana konsultasi adalah DATABASE, bukan kiriman ini. Lihat
   * `simpanAsesmen()`: diskon pada tindakan lain dibuang, dan nilainya
   * dipotong pada nilai barisnya supaya subtotal tidak pernah negatif.
   */
  diskon: z.coerce.number().min(0).default(0),
  alasan_diskon: teksOpsional(160),
});

export const asesmenSchema = z
  .object({
    // --- S ---
    jenis_anamnesis: z
      .union([z.literal(""), z.enum(JENIS_ANAMNESIS)])
      .optional()
      .transform((v) => (v ? v : null)),
    sumber_anamnesis: teksOpsional(120),
    keluhan_utama: teksOpsional(2000),
    riwayat_penyakit: teksOpsional(4000),
    riwayat_pengobatan: teksOpsional(2000),
    /*
     * `riwayat_alergi` dan `subjective` TIDAK ada di sini.
     *
     * Alergi pindah ke `patient_allergies` lewat panel yang sama dengan form
     * perawat — ia melekat pada pasien, bukan pada satu asesmen. "Anamnesis
     * tambahan" dihapus atas permintaan; kolomnya dipertahankan di database
     * agar isi asesmen lama tidak hilang.
     */

    // --- O ---
    keadaan_umum: z
      .union([z.literal(""), z.enum(KEADAAN_UMUM)])
      .optional()
      .transform((v) => (v ? v : null)),
    keadaan_gizi: z
      .union([z.literal(""), z.enum(KEADAAN_GIZI)])
      .optional()
      .transform((v) => (v ? v : null)),
    status_lokalis: statusLokalisSchema.default({
      catatan: undefined, titik: [], regio: {},
    }),
    /*
     * `objective` (Pemeriksaan Fisik Umum) dihapus dari form — isinya dobel
     * dengan Status Lokalis per regio. Kolomnya tetap ada di database dan
     * tetap dicetak bila asesmen lama mengisinya.
     */

    // --- A ---
    assessment: teksOpsional(4000),

    // --- P ---
    terapi: teksOpsional(4000),
    plan: teksOpsional(4000),
    edukasi: teksOpsional(2000),

    /** `final` mengunci asesmen dan mendorong kunjungan ke tahap berikutnya. */
    finalkan: z.coerce.boolean().default(false),
    diagnoses: z.array(diagnosaSchema).default([]),
    procedures: z.array(tindakanSchema).default([]),
  })
  .superRefine((v, ctx) => {
    /*
     * Diagnosa BANDING tidak dihitung. Ia kemungkinan yang belum ditegakkan;
     * asesmen berisi tiga diagnosa banding dan nol diagnosa utama belum
     * menyatakan apa pun, dan tidak boleh lolos sebagai asesmen final.
     */
    const ditegakkan = v.diagnoses.filter((d) => d.tipe !== "banding");

    if (v.finalkan && ditegakkan.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["diagnoses"],
        // ICD-10 baru diwajibkan saat difinalkan, bukan saat draft — dokter
        // sering menulis anamnesis dulu sebelum menegakkan diagnosa.
        message: v.diagnoses.length > 0
          ? "Diagnosa banding saja belum cukup — tegakkan minimal satu diagnosa utama."
          : "Minimal satu diagnosa ICD-10 wajib diisi sebelum asesmen difinalkan",
      });
    }

    if (v.finalkan && ditegakkan.filter((d) => d.tipe === "primer").length !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["diagnoses"],
        message: "Harus ada tepat satu diagnosa utama",
      });
    }

    /*
     * Alloanamnesis tanpa menyebut sumbernya kehilangan maknanya: pembaca
     * rekam medis tidak tahu keterangan itu berasal dari siapa, dan bobot
     * klinisnya berbeda antara ibu kandung dan tetangga yang mengantar.
     */
    if (v.jenis_anamnesis === "allo" && !v.sumber_anamnesis) {
      ctx.addIssue({
        code: "custom",
        path: ["sumber_anamnesis"],
        message: "Sebutkan sumbernya — mis. ibu kandung, suami, pengantar.",
      });
    }
  });

export type AsesmenFormValues = z.input<typeof asesmenSchema>;
export type AsesmenInput = z.output<typeof asesmenSchema>;

// ---------------------------------------------------------------------
// E-RESEP — struktur parent-child (CLAUDE.md §7)
// ---------------------------------------------------------------------

/**
 * Aturan Pakai WAJIB untuk setiap obat maupun racikan (CLAUDE.md §4).
 * Aturan yang sama ditegakkan ulang di database lewat CHECK constraint
 * `ck_pit_signa` / `ck_prc_signa` — validasi klien bisa dilewati lewat API.
 */
const aturanPakai = z
  .string()
  .trim()
  .min(1, "Aturan pakai wajib diisi")
  .max(255);

export const resepItemSchema = z.object({
  item_id: z.coerce.number().int().positive(),
  nama: z.string().trim().max(180),
  qty: z.coerce.number().positive("Jumlah harus lebih dari 0"),
  satuan: z.string().trim().max(20),
  aturan_pakai: aturanPakai,
  catatan: teksOpsional(255),
  harga_satuan: z.coerce.number().min(0),
});

export const bahanRacikanSchema = z.object({
  item_id: z.coerce.number().int().positive(),
  nama: z.string().trim().max(180),
  /** Untuk KESELURUHAN racikan, bukan per bungkus. */
  qty_bahan: z.coerce.number().positive("Jumlah bahan harus lebih dari 0"),
  satuan: z.string().trim().max(20),
  harga_satuan: z.coerce.number().min(0),
});

export const racikanSchema = z.object({
  nama_racikan: z.string().trim().min(1, "Nama racikan wajib diisi").max(150),
  bentuk_sediaan: z
    .enum(["puyer", "kapsul", "sirup", "salep", "krim", "lainnya"])
    .default("puyer"),
  qty_jadi: z.coerce.number().positive("Jumlah jadi harus lebih dari 0"),
  satuan_jadi: z.string().trim().min(1).max(20).default("bungkus"),
  aturan_pakai: aturanPakai,
  biaya_jasa_racik: z.coerce.number().min(0).default(0),
  catatan: teksOpsional(255),
  ingredients: z
    .array(bahanRacikanSchema)
    .min(1, "Racikan harus punya minimal satu bahan"),
});

export const resepSchema = z
  .object({
    catatan_umum: teksOpsional(2000),
    items: z.array(resepItemSchema).default([]),
    racikans: z.array(racikanSchema).default([]),
  })
  .refine((v) => v.items.length + v.racikans.length > 0, {
    message: "Resep tidak boleh kosong",
    path: ["items"],
  });

export type ResepFormValues = z.input<typeof resepSchema>;
export type ResepInput = z.output<typeof resepSchema>;

/** Preset aturan pakai yang paling sering dipakai, untuk tombol cepat. */
export const PRESET_SIGNA = [
  "3 x sehari 1 tablet sesudah makan",
  "2 x sehari 1 tablet sesudah makan",
  "1 x sehari 1 tablet sesudah makan",
  "3 x sehari 1 bungkus sesudah makan",
  "3 x sehari 1 sendok teh sesudah makan",
  "Bila perlu, maksimal 3 x sehari",
] as const;
