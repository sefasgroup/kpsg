import { BrandLockup, BrandMark } from "@/components/brand/logo";
import type { RoleCode } from "@/lib/rbac";
import { IsiNav, KakiNav } from "./nav-isi";

/**
 * Sidebar tetap — dua bentuk, dipilih murni oleh lebar layar.
 *
 * MASALAH YANG DITUTUP BERKAS INI
 *
 * Sebelumnya sidebar berlebar mati 236px tanpa satu pun breakpoint,
 * di dalam cangkang `overflow-hidden`. Di tablet ruang perawat (768px
 * potret) navigasi memakan sepertiga layar; di ponsel praktis tidak
 * menyisakan ruang untuk isinya. Sementara itu 56 dari 103 komponen sudah
 * responsif — kerja itu batal seluruhnya karena cangkangnya tidak.
 *
 * | Lebar | Bentuk | Alasan |
 * |---|---|---|
 * | `< md` (<768) | disembunyikan; dijangkau lewat laci | Layar sesempit itu tidak punya ruang untuk navigasi permanen |
 * | `md`–`lg` | rel 64px, hanya ikon | Berpindah modul tetap satu ketukan, isi layar tetap lapang |
 * | `≥ lg` | penuh 236px | Bentuk aslinya |
 *
 * Rel ikon tidak berdiri sendiri: tombol laci tetap tersedia sampai `lg`,
 * sehingga petugas yang lupa arti sebuah ikon selalu punya jalan melihat
 * namanya. Ikon tanpa nama boleh jadi jalan pintas, tidak boleh jadi
 * satu-satunya jalan.
 */
export function Sidebar({
  role,
  nama,
  roleNama,
}: {
  role: RoleCode;
  nama: string;
  roleNama: string;
}) {
  return (
    <>
      {/* Rel ringkas — tablet */}
      <aside className="hidden w-16 shrink-0 flex-col border-r border-line bg-surface md:flex lg:hidden">
        <div className="flex justify-center border-b border-line px-2 py-3.5">
          <BrandMark size={28} />
        </div>
        <IsiNav role={role} ringkas />
        <KakiNav role={role} nama={nama} roleNama={roleNama} ringkas />
      </aside>

      {/* Penuh — desktop */}
      <aside className="hidden w-59 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="border-b border-line px-4 py-3.5">
          <BrandLockup />
        </div>
        <IsiNav role={role} />
        <KakiNav role={role} nama={nama} roleNama={roleNama} />
      </aside>
    </>
  );
}
