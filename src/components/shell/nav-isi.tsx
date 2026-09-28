"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeyRound, LogOut } from "lucide-react";
import { NAV, ROLE_LABEL, menuAktif, type RoleCode } from "@/lib/rbac";
import { inisial } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Isi navigasi — dipakai oleh KETIGA bentuk sidebar (penuh, rel ringkas,
 * dan laci seluler) supaya menu tidak pernah menyimpang di antara ketiganya.
 *
 * Daftar menunya tetap di-generate dari matriks izin per role: menu yang
 * bukan hak role TIDAK dirender sama sekali, bukan sekadar disabled.
 */
export function IsiNav({
  role,
  ringkas = false,
  onPilih,
}: {
  role: RoleCode;
  /** Rel 64px: hanya ikon, judul bagian disembunyikan. */
  ringkas?: boolean;
  /** Dipanggil saat menu ditekan — dipakai laci untuk menutup dirinya. */
  onPilih?: () => void;
}) {
  const pathname = usePathname();
  const aktif = menuAktif(role, pathname);

  return (
    <nav className="flex-1 overflow-y-auto py-2">
      {NAV[role].map((section) => (
        <div key={section.title} className="mb-1">
          {ringkas ? (
            /*
             * Judul bagian diganti garis, bukan dihilangkan begitu saja.
             * Pengelompokan menu adalah informasi tersendiri — tanpa
             * pemisah, sepuluh ikon berderet jadi satu tumpukan tak
             * berstruktur.
             */
            <div className="mx-3 my-1.5 border-t border-line" aria-hidden />
          ) : (
            <p className="px-4 pt-2 pb-1 text-micro tracking-wide text-ink-faint uppercase">
              {section.title}
            </p>
          )}

          {section.items.map((item) => {
            const active = item.href === aktif?.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onPilih}
                aria-current={active ? "page" : undefined}
                /*
                 * Pada rel ringkas, label tetap ada sebagai `title` DAN
                 * sebagai teks `sr-only`. Ikon tanpa nama bisa ditebak
                 * salah, dan pembaca layar tidak boleh kehilangan menunya
                 * hanya karena layarnya sempit.
                 */
                title={ringkas ? item.label : undefined}
                className={cn(
                  "flex items-center gap-2.5 text-body transition-colors",
                  ringkas ? "mx-2 justify-center rounded-md p-2.5" : "px-4 py-2",
                  active
                    ? "bg-brand-50 font-medium text-brand-700"
                    : "text-ink-muted hover:bg-surface-alt hover:text-ink",
                )}
              >
                <item.icon className="size-4 shrink-0" aria-hidden />
                <span className={ringkas ? "sr-only" : undefined}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Blok identitas + keluar di kaki sidebar. */
export function KakiNav({
  role,
  nama,
  roleNama,
  ringkas = false,
}: {
  role: RoleCode;
  nama: string;
  roleNama: string;
  ringkas?: boolean;
}) {
  if (ringkas) {
    return (
      <div className="flex flex-col items-center gap-1.5 border-t border-line p-2">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-meta font-semibold text-brand-700"
          title={`${nama} — ${roleNama || ROLE_LABEL[role]}`}
        >
          {inisial(nama)}
        </span>
        <Link
          href="/akun"
          aria-label="Ganti password"
          title="Ganti password"
          className="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-alt hover:text-ink"
        >
          <KeyRound className="size-4" aria-hidden />
        </Link>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            aria-label="Keluar"
            title="Keluar"
            className="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-alt hover:text-danger"
          >
            <LogOut className="size-4" aria-hidden />
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="border-t border-line p-3">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-meta font-semibold text-brand-700">
          {inisial(nama)}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-body font-medium text-ink">{nama}</p>
          <p className="truncate text-meta text-ink-muted">
            {roleNama || ROLE_LABEL[role]}
          </p>
        </div>
        <Link
          href="/akun"
          aria-label="Ganti password"
          title="Ganti password"
          className="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-alt hover:text-ink"
        >
          <KeyRound className="size-4" aria-hidden />
        </Link>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            aria-label="Keluar"
            title="Keluar"
            className="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-alt hover:text-danger"
          >
            <LogOut className="size-4" aria-hidden />
          </button>
        </form>
      </div>
    </div>
  );
}
