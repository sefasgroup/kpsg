/**
 * Perhitungan tanggal untuk seluruh sistem.
 *
 * ==========================================================================
 * JANGAN memakai `new Date().toISOString().slice(0, 10)` untuk "hari ini".
 *
 * `toISOString()` mengembalikan tanggal UTC. Di WIB (UTC+7), antara pukul
 * 00:00 dan 07:00 waktu setempat ia mengembalikan tanggal KEMARIN —
 * sementara MySQL `CURDATE()` sudah berganti hari. Akibatnya seluruh
 * worklist yang memfilter `tanggal = ?` menampilkan data kemarin, sedangkan
 * pendaftaran baru masuk ke hari ini. Klinik yang buka pagi tepat berada di
 * rentang jam itu.
 * ==========================================================================
 *
 * Zona diambil dari `sites.timezone` (default `Asia/Jakarta`). Bila nanti
 * ada cabang di WITA/WIT, teruskan zonanya sebagai argumen.
 */

export const ZONA_KLINIK = "Asia/Jakarta";

/** Tanggal hari ini di zona klinik, format `YYYY-MM-DD`. */
export function tanggalHariIni(zona: string = ZONA_KLINIK): string {
  // en-CA menghasilkan format YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(new Date());
}

/** Periode penomoran dokumen, format `YYYYMM`. */
export function periodeSekarang(zona: string = ZONA_KLINIK): string {
  return tanggalHariIni(zona).slice(0, 7).replace("-", "");
}

/** Tanggal hari ini tanpa pemisah, format `YYYYMMDD` — untuk reset antrean harian. */
export function tanggalKompak(zona: string = ZONA_KLINIK): string {
  return tanggalHariIni(zona).replace(/-/g, "");
}

/**
 * Aritmetika tanggal murni pada string `YYYY-MM-DD`.
 * Memakai UTC secara internal supaya pergeseran zona tidak pernah
 * menggeser hasilnya.
 */
export function tambahHari(tanggal: string, hari: number): string {
  const d = new Date(`${tanggal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + hari);
  return d.toISOString().slice(0, 10);
}

/** Daftar tanggal dari `mulai` sampai `akhir` (inklusif). */
export function rentangTanggal(mulai: string, akhir: string): string[] {
  const hasil: string[] = [];
  for (let t = mulai; t <= akhir; t = tambahHari(t, 1)) {
    hasil.push(t);
    if (hasil.length > 366) break; // jaring pengaman terhadap rentang tak wajar
  }
  return hasil;
}

/** Hari dalam seminggu: 1 = Senin … 7 = Minggu, sesuai kolom `doctor_schedules.hari`. */
export function hariDalamMinggu(tanggal: string): number {
  const d = new Date(`${tanggal}T00:00:00Z`);
  return ((d.getUTCDay() + 6) % 7) + 1;
}

/** Validasi format tanggal dari query string. */
export function tanggalValid(v: string | undefined | null): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Tanggal 1 pada bulan yang sama.
 *
 * Dipakai laporan yang periodenya BULAN TAKWIM — SIPNAP dan LB1 keduanya
 * dilaporkan per bulan, bukan per 30 hari bergulir. Rentang bergulir
 * menghasilkan angka yang tidak akan pernah cocok dengan formulir yang
 * harus dikirim.
 */
export function awalBulan(tanggal: string): string {
  return `${tanggal.slice(0, 7)}-01`;
}

/** Hari terakhir pada bulan yang sama — pasangan `awalBulan()`. */
export function akhirBulan(tanggal: string): string {
  const [t, b] = tanggal.split("-").map(Number);
  // Hari ke-0 bulan berikutnya = hari terakhir bulan ini, tanpa tabel
  // jumlah hari dan tanpa perlu tahu tahun kabisat.
  const d = new Date(Date.UTC(t, b, 0));
  return d.toISOString().slice(0, 10);
}
