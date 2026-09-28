/**
 * Label status kunjungan — modul netral, aman diimpor dari Client Component.
 *
 * Sengaja dipisah dari `lib/visits.ts`: modul itu `server-only` dan menarik
 * mysql2. Kalau label ikut di sana, driver database masuk ke bundle browser.
 */
export const STATUS_LABEL: Record<string, string> = {
  terdaftar: "Terdaftar",
  menunggu_perawat: "Menunggu Perawat",
  dikaji_perawat: "Dikaji Perawat",
  menunggu_dokter: "Menunggu Dokter",
  dalam_pemeriksaan: "Dalam Pemeriksaan",
  menunggu_lab: "Menunggu Lab",
  menunggu_farmasi: "Menunggu Farmasi",
  menunggu_kasir: "Menunggu Kasir",
  menunggu_obat: "Menunggu Ambil Obat",
  selesai: "Selesai",
  batal: "Batal",
};

/** Urutan alur kunjungan, dipakai untuk indikator progres. */
export const STATUS_ALUR = [
  "terdaftar",
  "menunggu_perawat",
  "dikaji_perawat",
  "menunggu_dokter",
  "dalam_pemeriksaan",
  "menunggu_lab",
  "menunggu_farmasi",
  "menunggu_kasir",
  "menunggu_obat",
  "selesai",
] as const;
