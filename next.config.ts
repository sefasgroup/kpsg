import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Deploy membangun ke folder terpisah (NEXT_DIST_DIR=.next-baru) lalu
   * menukarnya ke `.next` hanya bila build berhasil — lihat
   * .github/workflows/deploy.yml. Membangun langsung ke `.next` menimpa
   * berkas yang sedang dilayani `next start`, dan build yang gagal
   * meninggalkan situs tanpa berkas yang utuh.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverActions: {
      /*
       * Bawaan Next.js adalah 1 MB.
       *
       * Unggahan dokumen rekam medis (`/rme/[id]`) menerima berkas sampai
       * 5 MB per berkas, beberapa sekaligus. Tanpa batas yang dinaikkan,
       * permintaannya ditolak SEBELUM sampai ke validasi kita — dokter hanya
       * melihat galat server tanpa penjelasan, dan pesan "ukuran melebihi
       * 5 MB" yang sudah ditulis rapi tidak pernah sempat muncul.
       *
       * Batas total sisi klien dijaga lebih rendah (lihat MAKS_TOTAL_BYTES
       * di dokumen-card.tsx) agar penolakan terjadi di peramban, dengan
       * pesan yang bisa ditindaklanjuti, bukan di sini.
       */
      bodySizeLimit: "25mb",
    },
  },

  /*
   * Header keamanan dasar untuk setiap halaman.
   *
   * - X-Frame-Options / frame-ancestors: layar kasir dan resep tidak boleh
   *   disematkan di situs lain (clickjacking — pengguna dikelabui menekan
   *   "Bayar" atau "Serahkan" di balik tampilan palsu).
   * - nosniff: berkas unggahan rekam medis tidak ditafsirkan ulang sebagai
   *   skrip oleh peramban.
   * - Referrer-Policy: URL berisi id kunjungan/pasien tidak bocor ke situs
   *   luar lewat header Referer.
   *
   * CSP lengkap (script-src) sengaja belum dipasang: Next.js menyisipkan
   * skrip inline dan menegakkannya butuh nonce — perlu diuji tersendiri.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // SAMEORIGIN, bukan DENY: react-to-print mencetak lewat iframe di halaman sendiri.
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
