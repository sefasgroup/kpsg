import "server-only";

/**
 * Pembatas percobaan login.
 *
 * Tanpa batas, password bisa ditebak tanpa henti — username di klinik mudah
 * diterka (dr.nama, kasir.cabang) dan syarat panjang password hanya 8.
 *
 * Disimpan di memori proses: aplikasi berjalan sebagai SATU proses pm2,
 * jadi tidak perlu tabel baru. Restart mengosongkan hitungannya — harga
 * yang wajar untuk tidak menambah migrasi. Bila kelak dijalankan dalam
 * beberapa proses (cluster), pindahkan ke tabel atau Redis.
 *
 * Dua kunci sekaligus:
 *   - username+IP : menghentikan tebakan terhadap satu akun;
 *   - IP saja     : menghentikan penyemprotan satu password ke banyak akun.
 */
const JENDELA_MS = 15 * 60 * 1000;
const MAKS_PER_AKUN = 5;
const MAKS_PER_IP = 20;

type Catatan = { gagal: number; mulai: number };
const catatan = new Map<string, Catatan>();

function ambil(kunci: string, sekarang: number): Catatan {
  const c = catatan.get(kunci);
  if (!c || sekarang - c.mulai > JENDELA_MS) {
    const baru = { gagal: 0, mulai: sekarang };
    catatan.set(kunci, baru);
    return baru;
  }
  return c;
}

const kunciAkun = (ip: string, username: string) => `a|${ip}|${username.toLowerCase()}`;
const kunciIp = (ip: string) => `i|${ip}`;

/** Sisa menit penguncian, atau 0 bila boleh mencoba. */
export function menitTerkunci(ip: string, username: string, sekarang = Date.now()): number {
  for (const [kunci, maks] of [
    [kunciAkun(ip, username), MAKS_PER_AKUN],
    [kunciIp(ip), MAKS_PER_IP],
  ] as const) {
    const c = ambil(kunci, sekarang);
    if (c.gagal >= maks) return Math.max(1, Math.ceil((c.mulai + JENDELA_MS - sekarang) / 60000));
  }
  return 0;
}

export function catatGagal(ip: string, username: string, sekarang = Date.now()): void {
  ambil(kunciAkun(ip, username), sekarang).gagal++;
  ambil(kunciIp(ip), sekarang).gagal++;
  // Bersihkan catatan kedaluwarsa sesekali supaya peta tidak tumbuh tanpa batas.
  if (catatan.size > 5000) {
    for (const [k, c] of catatan) if (sekarang - c.mulai > JENDELA_MS) catatan.delete(k);
  }
}

/** Login berhasil menghapus hitungan akun itu (bukan hitungan IP-nya). */
export function catatBerhasil(ip: string, username: string): void {
  catatan.delete(kunciAkun(ip, username));
}

/**
 * IP klien yang bisa dipercaya di balik reverse proxy.
 *
 * Nilai PALING KANAN dari X-Forwarded-For adalah yang ditambahkan nginx
 * sendiri (`$proxy_add_x_forwarded_for`); nilai di kirinya dikirim klien
 * dan bisa dipalsukan — memakainya membuat pembatas di atas bisa dilewati
 * dan IP di audit log bisa dikarang.
 */
export function ipKlien(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const bagian = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (bagian.length) return bagian[bagian.length - 1];
  }
  return headers.get("x-real-ip") ?? "tidak-diketahui";
}
