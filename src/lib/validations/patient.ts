import { z } from "zod";

/**
 * Validasi pasien. NIK wajib dan divalidasi ketat — syarat SatuSehat
 * (CLAUDE.md §6). Aturan yang sama juga ditegakkan di database lewat
 * CHECK constraint `ck_pat_nik`, karena validasi klien bisa dilewati.
 */

const teks = (max: number) => z.string().trim().max(max);
const teksOpsional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

export const nikSchema = z
  .string()
  .trim()
  .regex(/^\d{16}$/, "NIK harus tepat 16 digit angka");

/*
 * Pilihan demografi dikunci di sini, bukan diketik bebas.
 *
 * Isian bebas menghasilkan "SMA", "SMU", "sma/k", dan "Sekolah Menengah Atas"
 * sebagai empat nilai berbeda untuk hal yang sama, dan pengelompokan laporan
 * demografi jadi tidak bisa dipercaya. Karena daftarnya juga dipakai form,
 * keduanya tidak mungkin melenceng satu sama lain.
 */
export const PENDIDIKAN = [
  "SD", "SMP", "SMA/K", "Diploma", "Sarjana",
] as const;

export const STATUS_PERKAWINAN = [
  "Belum Menikah", "Menikah", "Cerai Mati", "Cerai Hidup",
] as const;

/** Pilihan terbatas yang boleh kosong — kosong berarti "tidak diisi". */
const pilihanOpsional = <T extends readonly [string, ...string[]]>(daftar: T) =>
  z.enum(daftar).optional().or(z.literal("").transform(() => undefined));

export const patientSchema = z.object({
  nik: nikSchema,
  no_kk: z
    .string()
    .trim()
    .regex(/^\d{16}$/, "No. KK harus 16 digit angka")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  nama: teks(150).min(2, "Nama wajib diisi"),
  tempat_lahir: teksOpsional(100),
  tanggal_lahir: z
    .string()
    .min(1, "Tanggal lahir wajib diisi")
    .refine((v) => {
      const d = new Date(v);
      return !Number.isNaN(d.getTime()) && d <= new Date();
    }, "Tanggal lahir tidak valid atau melebihi hari ini"),
  jenis_kelamin: z.enum(["L", "P"], { message: "Pilih jenis kelamin" }),
  gol_darah: z.enum(["A", "B", "AB", "O"]).optional().or(z.literal("").transform(() => undefined)),
  agama: teksOpsional(30),
  status_perkawinan: pilihanOpsional(STATUS_PERKAWINAN),
  pendidikan: pilihanOpsional(PENDIDIKAN),
  pekerjaan: teksOpsional(80),
  alamat: teksOpsional(500),
  rt: teksOpsional(5),
  rw: teksOpsional(5),
  kelurahan: teksOpsional(100),
  kecamatan: teksOpsional(100),
  kota: teksOpsional(100),
  provinsi: teksOpsional(100),
  telepon: teksOpsional(30),
  pj_nama: teksOpsional(150),
  pj_hubungan: teksOpsional(40),
  pj_telepon: teksOpsional(30),
  jenis_pasien: z.enum(["umum", "bpjs", "asuransi", "perusahaan"]).default("umum"),
  no_bpjs: teksOpsional(20),
});

/**
 * Skema ini memakai `.transform()` dan `.default()`, sehingga bentuk data
 * SEBELUM dan SESUDAH validasi berbeda. Keduanya diekspor terpisah:
 * `*FormValues` untuk react-hook-form (apa yang diketik pengguna),
 * `*Input` untuk hasil parse yang masuk ke database.
 */
export type PatientFormValues = z.input<typeof patientSchema>;
export type PatientInput = z.output<typeof patientSchema>;

/** Pendaftaran kunjungan — dipakai untuk pasien baru maupun lama. */
/** Panjang minimum alasan didahulukan — cukup untuk satu keterangan nyata. */
export const MIN_ALASAN_DIDAHULUKAN = 5;

export const visitSchema = z
  .object({
    patient_id: z.coerce.number().int().positive("Pasien belum dipilih"),
    poli_id: z.coerce.number().int().positive("Poli wajib dipilih"),
    doctor_id: z.coerce.number().int().positive("Dokter wajib dipilih"),
    cara_bayar: z.enum(["umum", "bpjs", "asuransi", "perusahaan"]).default("umum"),
    /*
     * Penjamin yang benar-benar berlaku untuk kunjungan ini.
     *
     * Dipisah dari `cara_bayar` dengan sengaja: `cara_bayar` hanya
     * menyebut JENIS pembiayaan, sementara tagihan perlu tahu KEPADA SIAPA
     * berkasnya nanti ditagihkan. "Asuransi" tanpa nama perusahaannya
     * adalah tagihan yang tidak bisa dikirim ke mana pun.
     */
    payer_id: z.coerce.number().int().positive().nullable().default(null),
    no_anggota: z
      .string()
      .trim()
      .max(40)
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
    rujukan_dari: z
      .string()
      .trim()
      .max(150)
      .optional()
      .transform((v) => (v === "" ? undefined : v)),

    /*
     * Penanda "perlu didahulukan" dari Pendaftaran. BUKAN triase — petugas
     * pendaftaran tidak menilai secara klinis, ia hanya menandai bahwa
     * kondisi pasien terlihat tidak bisa menunggu antrean. Penilaian klinis
     * tetap wewenang perawat lewat kolom `triase`.
     */
    didahulukan: z.coerce.boolean().default(false),
    alasan_didahulukan: z
      .string()
      .trim()
      .max(160)
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
  })
  .superRefine((v, ctx) => {
    /*
     * Alasan wajib bila ditandai. Penanda tanpa keterangan tidak bisa
     * dipertanggungjawabkan, dan perawat yang memanggil tidak tahu apa yang
     * harus dilihat lebih dulu. Aturan yang sama ditegakkan ulang di database
     * lewat CHECK `ck_v_didahulukan` — validasi klien bisa dilewati lewat API.
     */
    /*
     * Cara bayar selain `umum` WAJIB menyebut penjaminnya.
     *
     * Tanpa aturan ini, kunjungan bisa ditandai "perusahaan" tanpa satu
     * pun perusahaan — dan tagihannya lolos dari kandidat klaim mana pun
     * karena `payer_id`-nya NULL. Pekerjaannya sudah dilakukan, uangnya
     * tidak pernah tertagih, dan tidak ada satu layar pun yang mengeluh.
     */
    if (v.cara_bayar !== "umum" && v.payer_id === null) {
      ctx.addIssue({
        code: "custom",
        path: ["payer_id"],
        message: "Cara bayar selain Umum wajib memilih penjaminnya",
      });
    }

    if (v.didahulukan && (v.alasan_didahulukan ?? "").length < MIN_ALASAN_DIDAHULUKAN) {
      ctx.addIssue({
        code: "custom",
        path: ["alasan_didahulukan"],
        message: "Sebutkan alasannya — mis. sesak napas, nyeri dada, perdarahan.",
      });
    }
  });

export type VisitFormValues = z.input<typeof visitSchema>;
export type VisitInput = z.output<typeof visitSchema>;
