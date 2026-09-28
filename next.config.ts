import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
