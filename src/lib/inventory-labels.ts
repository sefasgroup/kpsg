/**
 * Label pergerakan stok — modul netral, aman diimpor dari Client Component.
 *
 * Dipisah dari `lib/inventory.ts` dan `lib/stock.ts` yang keduanya
 * `server-only` dan menarik mysql2 (pola yang sama seperti
 * `billing-labels.ts` dan `visit-status.ts`).
 */

export const JENIS_GERAKAN: Record<string, string> = {
  masuk_pembelian: "Penerimaan",
  masuk_retur: "Retur Masuk",
  masuk_koreksi: "Koreksi Tambah",
  masuk_opname: "Opname (Lebih)",
  keluar_resep: "Resep",
  keluar_racikan: "Bahan Racikan",
  keluar_bmhp: "BMHP Perawat",
  keluar_kadaluarsa: "Kadaluarsa",
  keluar_rusak: "Rusak",
  keluar_koreksi: "Koreksi Kurang",
  keluar_opname: "Opname (Kurang)",
};

/**
 * Pengeluaran yang berasal dari pelayanan pasien tidak boleh diinput manual
 * di layar pengeluaran — jalurnya lewat resep dan pengkajian perawat, yang
 * sekaligus membentuk baris tagihan. Menginputnya di sini akan memotong
 * stok tanpa ada yang membayar.
 */
export const PENGELUARAN_PELAYANAN = [
  "keluar_resep",
  "keluar_racikan",
  "keluar_bmhp",
] as const;

export const ALASAN_PENGELUARAN: { nilai: string; label: string; hint: string }[] = [
  {
    nilai: "keluar_kadaluarsa",
    label: "Kadaluarsa",
    hint: "Obat melewati tanggal kadaluarsa dan dimusnahkan",
  },
  {
    nilai: "keluar_rusak",
    label: "Rusak / Tidak Layak",
    hint: "Kemasan rusak, berubah warna, atau salah penyimpanan",
  },
  {
    nilai: "keluar_koreksi",
    label: "Koreksi Pencatatan",
    hint: "Memperbaiki salah input sebelumnya — bukan pengganti opname",
  },
];

/** Nada warna badge per jenis pergerakan. */
export function toneGerakan(jenis: string): "success" | "danger" | "warning" | "info" | "neutral" {
  if (jenis.startsWith("masuk_")) return "success";
  if (jenis === "keluar_kadaluarsa" || jenis === "keluar_rusak") return "danger";
  if (jenis === "keluar_koreksi" || jenis === "keluar_opname") return "warning";
  if (jenis === "keluar_resep" || jenis === "keluar_racikan") return "info";
  return "neutral";
}
