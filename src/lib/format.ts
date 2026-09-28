/** Format tampilan Indonesia — dipakai di layar maupun dokumen cetak. */

const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const angka = new Intl.NumberFormat("id-ID");

export const formatRupiah = (n: number | string | null | undefined) =>
  rupiah.format(Number(n ?? 0));

export const formatAngka = (n: number | string | null | undefined) =>
  angka.format(Number(n ?? 0));

/**
 * Angka desimal tanpa nol yang tidak berarti: "15.000" → "15", "7.2000" → "7.2".
 *
 * MySQL mengembalikan DECIMAL sebagai string dengan skala penuh, jadi qty 15
 * pada DECIMAL(14,3) sampai ke layar sebagai "15.000" — yang di Indonesia
 * terbaca lima belas ribu. Pada dosis obat, salah baca seperti itu bukan
 * sekadar jelek dipandang.
 *
 * Sengaja bekerja pada STRING, bukan lewat Number(). DECIMAL(14,3) bisa
 * memuat nilai di luar jangkauan presisi double, dan angka yang dipangkas di
 * sini adalah dosis — tidak boleh ada pembulatan sama sekali. Nilai yang bukan
 * angka murni (hasil lab tekstual seperti "Negatif") dikembalikan apa adanya.
 */
export function formatDesimal(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "";
  const teks = String(v).trim();
  if (!/^-?\d+\.\d+$/.test(teks)) return teks;
  return teks.replace(/0+$/, "").replace(/\.$/, "");
}

export const formatTanggal = (d: Date | string, opts?: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeZone: "Asia/Jakarta",
    ...opts,
  }).format(typeof d === "string" ? new Date(d) : d);

export const formatTanggalPendek = (d: Date | string) =>
  new Intl.DateTimeFormat("id-ID", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(typeof d === "string" ? new Date(d) : d);

export const formatJam = (d: Date | string) =>
  new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(typeof d === "string" ? new Date(d) : d);

/** Umur dalam tahun — dipakai di header pasien & dokumen medis. */
export function hitungUmur(tanggalLahir: Date | string): number {
  const lahir = typeof tanggalLahir === "string" ? new Date(tanggalLahir) : tanggalLahir;
  const now = new Date();
  let umur = now.getFullYear() - lahir.getFullYear();
  const m = now.getMonth() - lahir.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < lahir.getDate())) umur--;
  return umur;
}

/** Inisial untuk avatar. */
export const inisial = (nama: string) =>
  nama
    .replace(/^(dr\.|drg\.|Ns\.|apt\.)\s*/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
