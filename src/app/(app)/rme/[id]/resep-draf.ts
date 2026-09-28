import { create } from "zustand";

/**
 * Apakah e-resep di layar pemeriksaan punya perubahan yang BELUM disimpan.
 *
 * Resep disimpan dengan tombolnya sendiri, sedangkan Finalkan Asesmen hanya
 * melihat resep yang sudah tersimpan di database. Tanpa penanda bersama ini,
 * dokter yang mengisi resep lalu langsung menekan Finalkan mengirim pasien
 * ke kasir TANPA resep — form resep terkunci setelah halaman dimuat ulang,
 * isinya hilang, dan pasien pulang tanpa obat tanpa ada yang tahu.
 */
export const useResepDraf = create<{
  belumDisimpan: boolean;
  setBelumDisimpan: (v: boolean) => void;
}>((set) => ({
  belumDisimpan: false,
  setBelumDisimpan: (v) => set({ belumDisimpan: v }),
}));
