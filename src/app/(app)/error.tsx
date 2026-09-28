"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Home, RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Batas kesalahan untuk seluruh modul aplikasi.
 *
 * MASALAH YANG DITUTUP BERKAS INI
 *
 * Satu koneksi MySQL yang putus sedetik cukup untuk melempar pengguna ke
 * layar kesalahan bawaan Next.js: berbahasa Inggris, tanpa tombol kembali,
 * tanpa petunjuk apa pun. Bagi petugas yang sedang melayani pasien itu
 * jalan buntu — dan yang ia lakukan berikutnya adalah menutup peramban,
 * bukan mencoba lagi.
 *
 * DUA HAL YANG SENGAJA DIPILIH
 *
 * 1. Pesan galat aslinya TIDAK ditampilkan. Isinya bisa berupa potongan
 *    kueri SQL beserta nama kolom — informasi yang tidak berguna bagi
 *    petugas dan tidak seharusnya terbaca di layar depan klinik.
 *
 * 2. `error.digest` JUSTRU ditampilkan. Itulah satu-satunya benang yang
 *    menghubungkan layar yang dilihat petugas dengan baris di log server.
 *    Tanpanya, laporan yang sampai ke IT berbunyi "tadi error" — dan tidak
 *    ada yang bisa dikerjakan dengan itu.
 *
 * Data pengguna tidak hilang saat batas ini aktif: `reset()` merender
 * ulang segmen yang gagal, bukan memuat ulang halaman.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Tetap dicatat di konsol peramban: sebagian galat hanya terjadi di
    // sisi klien dan tidak pernah muncul di log server.
    console.error("[SIM Klinik]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center rounded-lg border border-danger/25 bg-surface px-5 py-11 text-center">
      <TriangleAlert
        className="size-11 text-danger"
        aria-hidden
        strokeWidth={1.5}
      />

      <p className="mt-2.5 text-h1 text-ink">Halaman ini gagal dimuat</p>

      <p className="mt-1 max-w-md text-meta text-ink-muted">
        Gangguan terjadi saat mengambil data dari server. Data yang sudah
        tersimpan tidak terpengaruh — coba muat ulang halaman ini. Bila
        berulang, hubungi IT dan sebutkan kode di bawah.
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Button type="button" variant="primary" onClick={reset}>
          <RotateCw />
          Coba Lagi
        </Button>
        <Link href="/dashboard">
          <Button type="button">
            <Home />
            Kembali ke Beranda
          </Button>
        </Link>
      </div>

      {error.digest ? (
        <p className="mt-4 text-micro text-ink-faint">
          Kode gangguan{" "}
          <span className="font-mono text-ink-muted select-all">
            {error.digest}
          </span>
        </p>
      ) : null}
    </div>
  );
}
