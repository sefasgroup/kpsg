"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Building2, CalendarDays, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { menuAktif, type RoleCode } from "@/lib/rbac";
import { formatTanggalPendek } from "@/lib/format";
import { pilihCabangAction } from "./site-actions";
import { NotifBell, type NotifItem } from "./notif-bell";
import { NavLaci } from "./nav-laci";
import { CariCepat } from "./cari-cepat";

export type SiteOption = { id: number; nama: string };

/** Judul halaman diambil dari entri menu yang sedang aktif. */
function useJudulHalaman(role: RoleCode): string {
  const pathname = usePathname();
  return menuAktif(role, pathname)?.label ?? "Beranda";
}

export function Topbar({
  role,
  nama,
  roleNama,
  siteNama,
  sites,
  activeSiteId,
  bolehPindah,
  lintasCabang,
  today,
  notifikasi,
  belumDibaca,
}: {
  role: RoleCode;
  /** Identitas ikut ke topbar hanya untuk mengisi kaki laci navigasi. */
  nama: string;
  roleNama: string;
  siteNama: string | null;
  sites: SiteOption[];
  activeSiteId: number | null;
  /** Dihitung di server dari penugasan, bukan dari peran. */
  bolehPindah: boolean;
  /** Hanya Super Admin yang boleh melihat semua cabang sekaligus. */
  lintasCabang: boolean;
  today: string;
  notifikasi: NotifItem[];
  belumDibaca: number;
}) {
  const judul = useJudulHalaman(role);
  const router = useRouter();
  const [berpindah, mulaiPindah] = useTransition();

  function gantiCabang(nilai: string) {
    mulaiPindah(async () => {
      await pilihCabangAction(nilai === "" ? null : Number(nilai));
      router.refresh();
    });
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        {/* Satu-satunya jalan ke navigasi di bawah `lg`. */}
        <NavLaci role={role} nama={nama} roleNama={roleNama} />
        <h1 className="truncate text-h1 text-ink">{judul}</h1>
        {siteNama ? (
          <Badge variant="brand" className="hidden sm:inline-flex">
            {siteNama}
          </Badge>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        {/* Pintasan lintas modul — Ctrl/⌘ + K. */}
        <CariCepat />

        {/*
          Pemilih cabang muncul bila pengguna memang ditugaskan di lebih
          dari satu cabang — mis. dokter yang praktik di dua cabang. Yang
          hanya punya satu penugasan melihat teks terkunci, bukan select
          yang disabled, agar jelas ini aturan (docs/DATABASE.md §3.7)
          dan bukan fitur yang kebetulan belum aktif.

          Pilihan "Semua Cabang" khusus Super Admin: peran operasional
          harus selalu berada di satu cabang, karena itulah batas isolasi
          datanya.
        */}
        {bolehPindah ? (
          <label className="flex items-center gap-1.5">
            <Building2 className="size-4 text-ink-faint" aria-hidden />
            <span className="sr-only">Pilih cabang</span>
            <select
              value={activeSiteId ?? ""}
              disabled={berpindah}
              onChange={(e) => gantiCabang(e.target.value)}
              className="h-8 rounded-md border border-line bg-surface px-2 text-meta text-ink disabled:opacity-60"
            >
              {lintasCabang ? (
                <option value="">Semua Cabang</option>
              ) : activeSiteId === null ? (
                <option value="">Pilih cabang…</option>
              ) : null}
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nama}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span
            className="flex items-center gap-1.5 rounded-md border border-line bg-surface-alt px-2.5 py-1.5 text-meta text-ink-muted"
            title="Cabang terkunci sesuai penugasan akun"
          >
            <Lock className="size-3.5" aria-hidden />
            {siteNama ?? "—"}
          </span>
        )}

        {/*
          Tanggal disembunyikan lebih dulu di layar sempit: setiap perangkat
          sudah menampilkan tanggal sendiri, sementara pemilih cabang dan
          lonceng tidak punya pengganti.
        */}
        <span className="hidden items-center gap-1.5 rounded-md border border-line bg-surface-alt px-2.5 py-1.5 text-meta text-ink-muted sm:flex">
          <CalendarDays className="size-3.5" aria-hidden />
          {formatTanggalPendek(today)}
        </span>

        <NotifBell awal={notifikasi} belumDibaca={belumDibaca} siteAktif={activeSiteId} />
      </div>
    </header>
  );
}
