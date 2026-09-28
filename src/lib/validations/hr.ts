import { z } from "zod";

export const HARI = [
  { value: 1, label: "Senin" },
  { value: 2, label: "Selasa" },
  { value: 3, label: "Rabu" },
  { value: 4, label: "Kamis" },
  { value: 5, label: "Jumat" },
  { value: 6, label: "Sabtu" },
  { value: 7, label: "Minggu" },
] as const;

export const HARI_LABEL: Record<number, string> = Object.fromEntries(
  HARI.map((h) => [h.value, h.label]),
);

const jam = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Format jam harus HH:MM");

const tanggal = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid");

export const jadwalSchema = z
  .object({
    doctor_id: z.coerce.number().int().positive("Dokter wajib dipilih"),
    poli_id: z.coerce.number().int().positive("Poli wajib dipilih"),
    hari: z.coerce.number().int().min(1).max(7),
    jam_mulai: jam,
    jam_selesai: jam,
    kuota: z.coerce.number().int().min(0).default(0),
  })
  .refine((v) => v.jam_selesai > v.jam_mulai, {
    message: "Jam selesai harus setelah jam mulai",
    path: ["jam_selesai"],
  });

export type JadwalFormValues = z.input<typeof jadwalSchema>;
export type JadwalInput = z.output<typeof jadwalSchema>;

/**
 * Pengecualian jadwal — inti fitur Dokter Pengganti (CLAUDE.md §4).
 *
 * `jenis` menentukan apakah pengganti relevan: dokter yang berhalangan
 * (libur/cuti/izin/sakit) boleh digantikan; `tambahan` justru menambah
 * jadwal, jadi tidak butuh pengganti.
 */
export const JENIS_BUTUH_PENGGANTI = ["libur", "cuti", "izin", "sakit"] as const;

export const pengecualianSchema = z
  .object({
    doctor_id: z.coerce.number().int().positive("Dokter wajib dipilih"),
    tanggal,
    jenis: z.enum(["libur", "cuti", "izin", "sakit", "ganti_jam", "tambahan"]),
    substitute_doctor_id: z
      .union([z.literal(""), z.coerce.number().int().positive()])
      .optional()
      .transform((v) => (v === "" || v === undefined ? null : Number(v))),
    jam_mulai: z.union([z.literal(""), jam]).optional().transform((v) => (v === "" ? undefined : v)),
    jam_selesai: z.union([z.literal(""), jam]).optional().transform((v) => (v === "" ? undefined : v)),
    alasan: z
      .string()
      .trim()
      .max(255)
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
  })
  .refine((v) => v.substitute_doctor_id !== v.doctor_id, {
    message: "Dokter pengganti tidak boleh sama dengan dokter yang berhalangan",
    path: ["substitute_doctor_id"],
  })
  .refine(
    (v) =>
      v.jenis !== "ganti_jam" ||
      (Boolean(v.jam_mulai) && Boolean(v.jam_selesai)),
    {
      message: "Ganti jam menuntut jam mulai dan jam selesai diisi",
      path: ["jam_mulai"],
    },
  );

export type PengecualianFormValues = z.input<typeof pengecualianSchema>;
export type PengecualianInput = z.output<typeof pengecualianSchema>;

export const cutiSchema = z
  .object({
    user_id: z.coerce.number().int().positive("Pegawai wajib dipilih"),
    jenis: z.enum(["cuti_tahunan", "izin", "sakit", "cuti_melahirkan", "lainnya"]),
    tanggal_mulai: tanggal,
    tanggal_akhir: tanggal,
    alasan: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
  })
  .refine((v) => v.tanggal_akhir >= v.tanggal_mulai, {
    message: "Tanggal akhir tidak boleh sebelum tanggal mulai",
    path: ["tanggal_akhir"],
  });

export type CutiFormValues = z.input<typeof cutiSchema>;
export type CutiInput = z.output<typeof cutiSchema>;

export const JENIS_CUTI_LABEL: Record<string, string> = {
  cuti_tahunan: "Cuti Tahunan",
  izin: "Izin",
  sakit: "Sakit",
  cuti_melahirkan: "Cuti Melahirkan",
  lainnya: "Lainnya",
};

export const JENIS_PENGECUALIAN_LABEL: Record<string, string> = {
  libur: "Libur",
  cuti: "Cuti",
  izin: "Izin",
  sakit: "Sakit",
  ganti_jam: "Ganti Jam",
  tambahan: "Jadwal Tambahan",
};

export const STATUS_ABSEN_LABEL: Record<string, string> = {
  hadir: "Hadir",
  terlambat: "Terlambat",
  izin: "Izin",
  sakit: "Sakit",
  cuti: "Cuti",
  alpha: "Alpha",
  libur: "Libur",
};
