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
};

export default nextConfig;
