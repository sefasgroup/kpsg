/**
 * Label kategori biaya — modul netral, aman diimpor dari Client Component.
 *
 * Sengaja dipisah dari `lib/cashier.ts` dan `lib/billing.ts`: keduanya
 * `server-only` dan menarik mysql2. Struk dan layar pembayaran adalah
 * komponen klien, jadi labelnya harus tinggal di sini.
 *
 * Urutannya juga menentukan urutan tampil di struk: jasa dulu, lalu
 * penunjang, lalu barang habis pakai dan obat.
 */
export const KATEGORI_TAGIHAN = [
  "jasa_dokter",
  "tindakan",
  "laboratorium",
  "bmhp",
  "obat",
  "racikan",
  "jasa_racik",
  "administrasi",
  "lainnya",
] as const;

export type KategoriTagihan = (typeof KATEGORI_TAGIHAN)[number];

export const KATEGORI_LABEL: Record<string, string> = {
  jasa_dokter: "Jasa Dokter",
  tindakan: "Tindakan Medis",
  laboratorium: "Laboratorium",
  bmhp: "Bahan Medis Habis Pakai",
  obat: "Obat",
  racikan: "Obat Racikan",
  jasa_racik: "Jasa Racik",
  administrasi: "Administrasi",
  lainnya: "Lainnya",
};
