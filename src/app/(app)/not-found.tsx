import Link from "next/link";
import { FileQuestion, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Jawaban untuk `notFound()` yang dipanggil di layar detail.
 *
 * Di sistem ini "tidak ditemukan" jarang berarti tautannya salah ketik.
 * Layar detail menyaring `WHERE site_id = <cabang aktif>`, sehingga
 * penyebab yang jauh lebih sering adalah **cabang aktifnya berpindah** —
 * misalnya setelah membuka notifikasi dari cabang lain, atau membuka
 * penanda tautan lama. Kalimat di bawah menyebut kemungkinan itu
 * terang-terangan; tanpa itu petugas menyimpulkan datanya terhapus.
 */
export default function NotFound() {
  return (
    <div className="flex flex-col items-center rounded-lg border border-line bg-surface px-5 py-11 text-center">
      <FileQuestion
        className="size-11 text-ink-faint"
        aria-hidden
        strokeWidth={1.5}
      />

      <p className="mt-2.5 text-h1 text-ink">Data tidak ditemukan</p>

      <p className="mt-1 max-w-md text-meta text-ink-muted">
        Halaman yang Anda tuju tidak ada, atau datanya bukan milik cabang
        yang sedang aktif. Periksa pemilih cabang di kanan atas — data
        kunjungan, stok, dan tagihan selalu terikat pada satu cabang.
      </p>

      <Link href="/dashboard" className="mt-4">
        <Button type="button" variant="primary">
          <Home />
          Kembali ke Beranda
        </Button>
      </Link>
    </div>
  );
}
