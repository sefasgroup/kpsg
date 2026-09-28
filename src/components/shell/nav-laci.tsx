"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { BrandLockup } from "@/components/brand/logo";
import type { RoleCode } from "@/lib/rbac";
import { IsiNav, KakiNav } from "./nav-isi";

/**
 * Tombol menu + laci navigasi untuk layar sempit.
 *
 * Tampil sampai `lg`, jadi ia melayani DUA keadaan sekaligus: ponsel yang
 * tidak punya navigasi sama sekali, dan tablet yang hanya punya rel ikon.
 * Pada keduanya laci menampilkan menu bernama lengkap.
 *
 * Tiga hal kecil yang membuatnya tidak menyebalkan dipakai:
 *
 * 1. **Menutup sendiri saat berpindah halaman.** Laci yang menutupi layar
 *    tujuan setelah menunya ditekan hanya menambah satu ketukan.
 * 2. **Esc menutup, dan gulir latar dikunci selagi terbuka.** Menggulir
 *    laci lalu mendapati halaman di belakangnya ikut bergeser adalah cara
 *    tercepat kehilangan tempat.
 * 3. **Latar gelap bisa ditekan.** Menutup sesuatu dengan menekan di luar
 *    adalah gerakan pertama yang dicoba semua orang.
 */
export function NavLaci({
  role,
  nama,
  roleNama,
}: {
  role: RoleCode;
  nama: string;
  roleNama: string;
}) {
  const pathname = usePathname();

  /*
   * Keadaan laci disimpan BERSAMA halaman tempat ia dibuka.
   *
   * Begitu `pathname` berganti, `dari` tidak lagi cocok dan laci tertutup
   * dengan sendirinya — tanpa efek yang memanggil `setState`, yang akan
   * memicu satu render tambahan dan ditolak React Compiler. Pola yang sama
   * dipakai penimpaan lokal di `notif-bell.tsx`.
   *
   * Ini juga menangani perpindahan yang tidak berasal dari menu, mis.
   * tombol kembali peramban.
   */
  const [lokal, setLokal] = useState({ dari: pathname, buka: false });
  const buka = lokal.dari === pathname && lokal.buka;
  const setBuka = (nilai: boolean) => setLokal({ dari: pathname, buka: nilai });

  useEffect(() => {
    if (!buka) return;
    function esc(e: KeyboardEvent) {
      // Bentuk fungsional dipakai supaya efek ini tidak perlu bergantung
      // pada `setBuka` — yang dibuat ulang tiap render.
      if (e.key === "Escape") setLokal((l) => ({ ...l, buka: false }));
    }
    document.addEventListener("keydown", esc);
    const gulirLama = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = gulirLama;
    };
  }, [buka]);

  return (
    <>
      <button
        type="button"
        onClick={() => setBuka(true)}
        aria-label="Buka menu"
        aria-expanded={buka}
        className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-surface-alt hover:text-ink lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      {buka ? (
        <div className="fixed inset-0 z-60 lg:hidden">
          <button
            type="button"
            aria-label="Tutup menu"
            onClick={() => setBuka(false)}
            className="absolute inset-0 bg-ink/40"
          />
          <aside className="absolute inset-y-0 left-0 flex w-59 max-w-[85vw] flex-col border-r border-line bg-surface shadow-overlay">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3.5">
              <BrandLockup />
              <button
                type="button"
                onClick={() => setBuka(false)}
                aria-label="Tutup menu"
                className="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-alt hover:text-ink"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <IsiNav role={role} onPilih={() => setBuka(false)} />
            <KakiNav role={role} nama={nama} roleNama={roleNama} />
          </aside>
        </div>
      ) : null}
    </>
  );
}
