"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/**
 * Menyegarkan worklist secara berkala.
 *
 * MASALAH YANG DITUTUP KOMPONEN INI
 *
 * Setiap layar antrean di sistem ini dirender sekali di server lalu diam.
 * Perawat menyelesaikan pengkajian, dan layar dokter tidak berubah. Kasir
 * menerima pembayaran, dan layar farmasi tetap menulis "menunggu
 * pembayaran". Petugas menyimpulkan sistemnya terlambat, lalu berteriak
 * lintas ruangan — persis pekerjaan yang seharusnya dihapus oleh sistem
 * ini.
 *
 * TIGA HAL YANG SENGAJA DIPILIH
 *
 * 1. **Berhenti saat tab tidak terlihat.** Klinik meninggalkan layar
 *    antrean terbuka sepanjang hari. Tanpa jeda ini, satu tab yang
 *    terlupakan memukul MySQL 2.880 kali sehari untuk data yang tidak
 *    dilihat siapa pun. Saat tab kembali terlihat, penyegaran dijalankan
 *    SEKETIKA — justru pada saat itulah datanya paling basi.
 *
 * 2. **Terlihat, bukan diam-diam.** Layar yang berubah sendiri tanpa
 *    penjelasan membuat orang ragu pada matanya. Cip kecil ini menyatakan
 *    bahwa halaman memang memperbarui dirinya, dan berapa lama sejak
 *    terakhir kali.
 *
 * 3. **Sekaligus tombol.** Petugas yang baru saja meminta rekannya
 *    mengerjakan sesuatu tidak mau menunggu satu putaran penuh. Menekan
 *    cip menyegarkan seketika.
 *
 * `router.refresh()` hanya mengambil ulang Server Component; state klien
 * — isian form, modal yang terbuka, posisi gulir — tidak tersentuh.
 */
export function SegarkanBerkala({ detik = 30 }: { detik?: number }) {
  const router = useRouter();
  const [proses, mulai] = useTransition();

  /*
   * `null` sampai komponen ter-mount. Render pertama di server dan di klien
   * karena itu identik, sehingga tidak ada ketidakcocokan hidrasi — waktu
   * adalah nilai yang tidak pernah sama di kedua sisi.
   */
  const [terakhir, setTerakhir] = useState<number | null>(null);
  const [sekarang, setSekarang] = useState<number | null>(null);
  const terakhirRef = useRef(0);

  const segarkan = useCallback(() => {
    terakhirRef.current = Date.now();
    setTerakhir(terakhirRef.current);
    setSekarang(terakhirRef.current);
    mulai(() => router.refresh());
  }, [router]);

  useEffect(() => {
    terakhirRef.current = Date.now();
    setTerakhir(terakhirRef.current);
    setSekarang(terakhirRef.current);

    const jeda = Math.max(10, detik) * 1000;

    const putaran = setInterval(() => {
      if (document.hidden) return;
      segarkan();
    }, jeda);

    // Penghitung label — terpisah dari putaran penyegaran supaya angka
    // "x dtk lalu" tetap berjalan meski penyegarannya sedang dijeda.
    const jam = setInterval(() => setSekarang(Date.now()), 5000);

    function saatTerlihat() {
      if (document.hidden) return;
      // Hanya bila memang sudah lewat satu putaran; berpindah tab
      // sebentar tidak seharusnya memicu kueri.
      if (Date.now() - terakhirRef.current >= jeda) segarkan();
      else setSekarang(Date.now());
    }
    document.addEventListener("visibilitychange", saatTerlihat);

    return () => {
      clearInterval(putaran);
      clearInterval(jam);
      document.removeEventListener("visibilitychange", saatTerlihat);
    };
  }, [detik, segarkan]);

  const lalu =
    terakhir === null || sekarang === null
      ? null
      : Math.floor((sekarang - terakhir) / 1000);

  return (
    <button
      type="button"
      onClick={segarkan}
      disabled={proses}
      title="Halaman ini memperbarui dirinya sendiri. Tekan untuk memperbarui sekarang."
      className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-meta text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-60"
    >
      <RefreshCw
        className={`size-3.5 ${proses ? "animate-spin" : ""}`}
        aria-hidden
      />
      <span aria-live="polite">
        {proses
          ? "Memperbarui…"
          : lalu === null
            ? `Perbarui otomatis tiap ${detik} dtk`
            : lalu < 10
              ? "Baru diperbarui"
              : `Diperbarui ${lalu} dtk lalu`}
      </span>
    </button>
  );
}
