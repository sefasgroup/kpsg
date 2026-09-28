/**
 * Label & ikon notifikasi — modul netral, aman diimpor Client Component.
 * (Pola yang sama seperti `billing-labels.ts` dan `inventory-labels.ts`.)
 */
import {
  AlertTriangle, CalendarCheck, CalendarClock, ClipboardList, FileClock,
  FlaskConical, Microscope, PackageX, Package, PillBottle, ShieldAlert,
  Siren, Stethoscope, Undo2, UserPlus, UserX, type LucideIcon,
} from "lucide-react";

type Gaya = {
  label: string;
  icon: LucideIcon;
  /** Kelas warna ikon. Warna TIDAK pernah jadi satu-satunya penanda. */
  warna: string;
  /** true = butuh perhatian segera; ditandai juga dengan teks, bukan warna saja. */
  mendesak?: boolean;
};

export const GAYA_NOTIFIKASI: Record<string, Gaya> = {
  // Estafet pelayanan pasien — urutannya mengikuti alur di CLAUDE.md §3.1.
  pasien_baru: { label: "Pasien menunggu", icon: UserPlus, warna: "text-info" },
  triase_selesai: { label: "Siap diperiksa", icon: Stethoscope, warna: "text-info" },
  order_lab: { label: "Order lab", icon: Microscope, warna: "text-info" },
  obat_siap: { label: "Obat siap", icon: PillBottle, warna: "text-success" },
  resep_masuk: { label: "Resep masuk", icon: ClipboardList, warna: "text-info" },
  // Estafet mundur: farmasi meminta dokter merevisi resepnya. Ditandai
  // mendesak karena pasien sedang menunggu dan alurnya berhenti total.
  resep_dikembalikan: {
    label: "Resep dikembalikan",
    icon: Undo2,
    warna: "text-warning",
    mendesak: true,
  },
  hasil_lab: { label: "Hasil lab", icon: FlaskConical, warna: "text-info" },
  hasil_lab_kritis: {
    label: "Nilai kritis",
    icon: Siren,
    warna: "text-danger",
    mendesak: true,
  },
  /*
   * Dua pembatalan, dua nada berbeda.
   *
   * Order lab batal MENDESAK bagi dokter: ia sedang menunggu hasil untuk
   * menegakkan diagnosa, dan kalau tidak tahu pemeriksaannya dibatalkan ia
   * akan menunggu sesuatu yang tidak akan pernah datang.
   *
   * Kunjungan batal tidak mendesak — pasiennya justru sudah tidak ada. Yang
   * dibutuhkan hanya supaya unit berhenti memanggil nama yang tak akan
   * menjawab.
   */
  order_lab_batal: {
    label: "Order lab dibatalkan",
    icon: Undo2,
    warna: "text-warning",
    mendesak: true,
  },
  kunjungan_batal: { label: "Kunjungan batal", icon: UserX, warna: "text-ink-muted" },
  /*
   * Tidak ditandai mendesak. Kunjungan yang menggantung memang perlu
   * dibereskan, tetapi pasiennya sudah lama tidak ada — menyalakan penanda
   * mendesak setiap pagi untuk pekerjaan administratif adalah cara tercepat
   * membuat penanda itu berhenti berarti apa-apa saat benar-benar dibutuhkan.
   */
  kunjungan_tertunda: {
    label: "Kunjungan tertunda",
    icon: CalendarClock,
    warna: "text-warning",
  },
  /*
   * Insiden keselamatan pasien MENDESAK, tetapi hanya jenis yang memang
   * mendesak yang pernah dikirim: KTD dan sentinel. Kondisi berpotensi
   * cedera masuk daftar untuk ditinjau berkala — menyalakan penanda
   * mendesak untuk semuanya akan membuat yang benar-benar mendesak ikut
   * diabaikan.
   */
  ikp_baru: {
    label: "Insiden keselamatan pasien",
    icon: ShieldAlert,
    warna: "text-danger",
    mendesak: true,
  },
  /*
   * Klaim terlambat tidak mendesak dalam hitungan menit, tetapi jumlahnya
   * uang klinik yang tertahan di penjamin. Ditandai warning, bukan
   * mendesak — yang dibutuhkan adalah ditindaklanjuti hari ini, bukan
   * detik ini.
   */
  klaim_terlambat: {
    label: "Klaim jatuh tempo",
    icon: FileClock,
    warna: "text-warning",
  },
  stok_menipis: { label: "Stok menipis", icon: Package, warna: "text-warning" },
  stok_habis: {
    label: "Stok habis",
    icon: PackageX,
    warna: "text-danger",
    mendesak: true,
  },
  kadaluarsa: { label: "Kadaluarsa", icon: AlertTriangle, warna: "text-warning" },
  cuti_diajukan: { label: "Pengajuan cuti", icon: CalendarCheck, warna: "text-ink-muted" },
  cuti_diputuskan: { label: "Keputusan cuti", icon: CalendarCheck, warna: "text-ink-muted" },
  tanpa_pengganti: {
    label: "Tanpa pengganti",
    icon: AlertTriangle,
    warna: "text-danger",
    mendesak: true,
  },
};

export const gayaNotifikasi = (jenis: string): Gaya =>
  GAYA_NOTIFIKASI[jenis] ?? {
    label: jenis,
    icon: ClipboardList,
    warna: "text-ink-muted",
  };

/** Waktu relatif ringkas — notifikasi dibaca sambil lalu. */
export function waktuRelatif(iso: string, sekarang = Date.now()): string {
  const selisih = Math.max(0, sekarang - new Date(iso).getTime());
  const menit = Math.floor(selisih / 60000);
  if (menit < 1) return "baru saja";
  if (menit < 60) return `${menit} mnt lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  const hari = Math.floor(jam / 24);
  if (hari < 7) return `${hari} hari lalu`;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}
