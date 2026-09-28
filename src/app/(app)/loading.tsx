import {
  KerangkaDaftar,
  KerangkaKeterangan,
  KerangkaStat,
} from "@/components/ui/skeleton";

/**
 * Umpan balik perpindahan halaman untuk SELURUH modul.
 *
 * Setiap layar di aplikasi ini `force-dynamic` dan langsung memukul MySQL.
 * Tanpa berkas ini, Next.js menahan layar lama tanpa perubahan apa pun
 * sampai kueri server selesai — dan perawat yang mengklik baris pasien
 * melihat persis apa yang ia lihat sebelum mengklik. Ia menyimpulkan
 * kliknya tidak terbaca, lalu mengklik lagi.
 *
 * Diletakkan di tingkat grup `(app)`, bukan per modul: bentuk "ringkasan
 * di atas, daftar di bawah" berlaku di hampir semua worklist, dan satu
 * berkas yang benar lebih baik daripada dua puluh berkas yang menyimpang
 * satu per satu. Modul yang bentuknya sungguh berbeda boleh menimpanya
 * dengan `loading.tsx` sendiri — lihat `rme/[id]/loading.tsx`.
 *
 * Sidebar dan topbar TIDAK ikut hilang: keduanya hidup di layout, dan
 * layout tidak dirender ulang saat berpindah halaman.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <KerangkaStat />
      <KerangkaDaftar />
      <KerangkaKeterangan>Memuat data…</KerangkaKeterangan>
    </div>
  );
}
