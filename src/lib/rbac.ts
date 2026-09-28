import type { LucideIcon } from "lucide-react";
import {
  Activity, AlertTriangle, Banknote, Barcode, Building2, CalendarClock, CalendarDays,
  ClipboardCheck, ClipboardList, FileBadge, FileSearch, FileSpreadsheet, HandCoins,
  History, LayoutDashboard, ListOrdered, Microscope, Package, PackageMinus,
  PackagePlus, Pill, Receipt, ScrollText, Settings, ShieldAlert, ShieldCheck,
  Stethoscope, Syringe, TestTubes, UserCog, UserPlus, Users, Wallet,
} from "lucide-react";

/**
 * 7 role tetap sesuai CLAUDE.md §2.1 (strict segregation of duties).
 * `code` harus identik dengan kolom roles.code di database.
 */
export const ROLES = [
  "super_admin",
  "admin_cabang",
  "dokter",
  "perawat",
  "petugas_lab",
  "farmasi",
  "kasir",
] as const;

export type RoleCode = (typeof ROLES)[number];

export const ROLE_LABEL: Record<RoleCode, string> = {
  super_admin: "Super Admin",
  admin_cabang: "Admin Cabang / HR",
  dokter: "Dokter",
  perawat: "Perawat",
  petugas_lab: "Petugas Laboratorium",
  farmasi: "Petugas Farmasi",
  kasir: "Kasir / Billing",
};

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

/**
 * Navigasi per role — menggantikan sidebar tunggal pada prototipe klinik.html.
 *
 * Role TIDAK PERNAH melihat menu yang bukan haknya: menu tidak dirender,
 * dan route-nya juga ditolak di middleware + dicek ulang di layer data.
 * Lihat docs/DESIGN-SYSTEM.md §5.
 */
export const NAV: Record<RoleCode, NavSection[]> = {
  super_admin: [
    {
      title: "Sistem",
      items: [
        { label: "Dashboard Sistem", href: "/dashboard", icon: LayoutDashboard },
        { label: "Cabang", href: "/cabang", icon: Building2 },
        { label: "Pengguna & Role", href: "/pengguna", icon: UserCog },
      ],
    },
    {
      title: "Master Data",
      items: [
        { label: "Poli & Tindakan", href: "/master/tindakan", icon: Stethoscope },
        { label: "ICD-10", href: "/master/icd10", icon: ScrollText },
        { label: "Katalog Obat & BMHP", href: "/master/katalog", icon: Barcode },
        { label: "Panel Laboratorium", href: "/master/lab", icon: TestTubes },
        // Penjamin bersifat GLOBAL seperti katalog obat: satu kontrak
        // perusahaan berlaku untuk seluruh jaringan cabang.
        { label: "Penjamin & Tarif Kontrak", href: "/master/penjamin", icon: HandCoins },
      ],
    },
    {
      title: "Kontrol",
      items: [
        { label: "Audit Log", href: "/audit", icon: ShieldCheck },
        { label: "Pengaturan", href: "/pengaturan", icon: Settings },
      ],
    },
  ],

  admin_cabang: [
    {
      title: "Operasional",
      items: [
        { label: "Dashboard Cabang", href: "/dashboard", icon: LayoutDashboard },
        { label: "Pendaftaran Pasien", href: "/pendaftaran", icon: UserPlus },
        { label: "Antrean", href: "/antrean", icon: ListOrdered },
      ],
    },
    {
      title: "Sumber Daya Manusia",
      items: [
        { label: "Jadwal Praktik", href: "/hr/jadwal", icon: CalendarDays },
        { label: "Dokter Pengganti", href: "/hr/pengganti", icon: CalendarClock },
        { label: "Absensi", href: "/hr/absensi", icon: ClipboardCheck },
        { label: "Cuti & Izin", href: "/hr/cuti", icon: FileBadge },
      ],
    },
    {
      title: "Penjamin & Klaim",
      items: [
        { label: "Klaim & Piutang", href: "/klaim", icon: HandCoins },
      ],
    },
    {
      title: "Mutu & Kepatuhan",
      items: [
        { label: "Insiden Keselamatan", href: "/mutu/ikp", icon: ShieldAlert },
        { label: "Laporan LB1", href: "/laporan/lb1", icon: FileSpreadsheet },
      ],
    },
    {
      title: "Lainnya",
      items: [
        { label: "Laporan Cabang", href: "/laporan", icon: Activity },
        { label: "Profil Cabang", href: "/profil-cabang", icon: Building2 },
      ],
    },
  ],

  dokter: [
    {
      title: "Pelayanan",
      items: [
        // Antrean, RME, dan E-Resep berbagi satu route: layar pemeriksaan
        // memuat semuanya dalam satu alur, jadi memisahkannya jadi menu
        // terpisah justru memaksa dokter berpindah-pindah.
        { label: "Antrean Saya", href: "/rme", icon: ListOrdered },
        { label: "Riwayat Pasien", href: "/riwayat-pasien", icon: FileSearch },
      ],
    },
    {
      title: "Dokumen",
      items: [
        { label: "Surat Keterangan", href: "/surat", icon: ScrollText },
        { label: "Jadwal Saya", href: "/jadwal-saya", icon: CalendarDays },
      ],
    },
    {
      title: "Keselamatan Pasien",
      items: [
        { label: "Lapor Insiden", href: "/mutu/ikp", icon: ShieldAlert },
      ],
    },
  ],

  perawat: [
    {
      title: "Pengkajian Awal",
      items: [
        // Worklist dan form pengkajian berbagi satu route: daftar antrean
        // langsung menuntun ke formulir pasiennya, jadi tidak perlu dua menu.
        { label: "Antrean & Triase", href: "/pengkajian", icon: ListOrdered },
        { label: "Pemakaian BMHP", href: "/bmhp", icon: Syringe },
      ],
    },
    {
      title: "Keselamatan Pasien",
      items: [
        /*
         * Menu ini ada pada SETIAP peran operasional — perawat, dokter,
         * lab, farmasi, dan kasir — bukan hanya Admin Cabang.
         *
         * Yang melihat insiden adalah yang sedang bekerja di lapangan, dan
         * laporan yang harus dititipkan lewat atasan tidak akan pernah
         * dibuat. Grading, analisis akar masalah, dan penutupannya tetap
         * wewenang Admin Cabang — dibatasi di `mutu/ikp/actions.ts`, bukan
         * dengan menyembunyikan menunya.
         *
         * Daftar peran di sini WAJIB sama dengan `ROLE_LAPOR` pada aksinya.
         * Sebelumnya menu ini hanya dipasang untuk perawat & dokter
         * sementara aksinya mengizinkan lima peran — apoteker yang menemukan
         * insiden dilempar ke dashboard oleh middleware.
         */
        { label: "Lapor Insiden", href: "/mutu/ikp", icon: ShieldAlert },
      ],
    },
  ],

  petugas_lab: [
    {
      title: "Laboratorium",
      items: [
        // Input hasil dibuka dari order-nya, jadi tidak perlu menu sendiri.
        { label: "Order Masuk", href: "/lab", icon: Microscope },
        { label: "Riwayat & Cetak", href: "/lab/riwayat", icon: History },
      ],
    },
    {
      title: "Keselamatan Pasien",
      items: [
        { label: "Lapor Insiden", href: "/mutu/ikp", icon: ShieldAlert },
      ],
    },
  ],

  farmasi: [
    {
      title: "Pelayanan Resep",
      items: [
        // Racikan tidak jadi menu terpisah: apoteker menyiapkan satu resep
        // utuh sekaligus, jadi memisahkannya justru memecah pekerjaan yang
        // sebenarnya satu.
        { label: "Resep Masuk", href: "/farmasi", icon: ClipboardList },
      ],
    },
    {
      title: "Inventori",
      items: [
        { label: "Stok Obat & BMHP", href: "/farmasi/stok", icon: Package },
        { label: "Penerimaan", href: "/farmasi/penerimaan", icon: PackagePlus },
        { label: "Pengeluaran", href: "/farmasi/pengeluaran", icon: PackageMinus },
        { label: "Stock Opname", href: "/farmasi/opname", icon: ClipboardCheck },
        { label: "Monitoring Kadaluarsa", href: "/farmasi/kadaluarsa", icon: AlertTriangle },
      ],
    },
    {
      title: "Pelaporan Wajib",
      items: [
        // Laporan bulanan narkotika & psikotropika ke Kemenkes. Ada di
        // menu FARMASI, bukan Admin Cabang: yang bertanda tangan dan
        // bertanggung jawab atas isinya adalah apotekernya.
        { label: "SIPNAP", href: "/farmasi/sipnap", icon: FileSpreadsheet },
      ],
    },
    {
      title: "Keselamatan Pasien",
      items: [
        { label: "Lapor Insiden", href: "/mutu/ikp", icon: ShieldAlert },
      ],
    },
  ],

  kasir: [
    {
      title: "Pembayaran",
      items: [
        { label: "Tagihan Menunggu", href: "/kasir", icon: Receipt },
        { label: "Riwayat Transaksi", href: "/kasir/riwayat", icon: History },
        { label: "Tutup Kasir", href: "/kasir/tutup", icon: Wallet },
      ],
    },
    {
      title: "Keselamatan Pasien",
      items: [
        { label: "Lapor Insiden", href: "/mutu/ikp", icon: ShieldAlert },
      ],
    },
  ],
};

/** Halaman awal setiap role setelah login. */
export const HOME_ROUTE: Record<RoleCode, string> = {
  super_admin: "/dashboard",
  admin_cabang: "/dashboard",
  dokter: "/dashboard",
  perawat: "/dashboard",
  petugas_lab: "/dashboard",
  farmasi: "/dashboard",
  kasir: "/dashboard",
};

/*
 * Perpindahan cabang ditentukan oleh PENUGASAN, bukan oleh peran, jadi
 * aturannya TIDAK tinggal di berkas ini.
 *
 * Sebelumnya ada `canSwitchSite(role)` di sini dan hanya Super Admin yang
 * boleh; nyatanya dokter memang bisa ditugaskan di lebih dari satu cabang.
 * Sumber kebenarannya kini `bolehPindahCabang()` di lib/session.ts, yang
 * bekerja atas daftar penugasan di dalam token bertanda tangan.
 *
 * Berkas ini sengaja tetap bebas dari impor server: ia menyusun menu dan
 * ikut terbawa ke bundel klien. Mengimpor lib/session.ts dari sini menarik
 * `next/headers` ke browser dan menggagalkan build — persoalan yang sama
 * dengan pemisahan `*-labels.ts`.
 */

/** Daftar route yang boleh diakses sebuah role (dipakai middleware). */
export function allowedPrefixes(role: RoleCode): string[] {
  return NAV[role].flatMap((s) => s.items.map((i) => i.href));
}

export function canAccess(role: RoleCode, pathname: string): boolean {
  if (pathname === "/dashboard" || pathname === "/akun") return true;

  /*
   * Route Handler di bawah /api menegakkan haknya SENDIRI, per objek —
   * mis. `/api/berkas/...` memeriksa siapa yang berhak atas berkas itu,
   * bukan sekadar peran apa yang boleh membuka menu apa. Matriks menu di
   * berkas ini tidak punya entri untuk route seperti itu, sehingga
   * menyaringnya di sini justru memblokir semua orang.
   *
   * Proxy tetap memastikan pemanggilnya SUDAH LOGIN sebelum sampai sini.
   */
  if (pathname.startsWith("/api/")) return true;

  return allowedPrefixes(role).some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

/** Peran umum di banyak modul: siapa yang boleh membuka detail pasien. */
export const CLINICAL_ROLES: RoleCode[] = ["dokter", "perawat"];

export const ROLE_ICON: Record<RoleCode, LucideIcon> = {
  super_admin: ShieldCheck,
  admin_cabang: Users,
  dokter: Stethoscope,
  perawat: Activity,
  petugas_lab: Microscope,
  farmasi: Pill,
  kasir: Banknote,
};
