import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Penyimpanan berkas unggahan.
 *
 * ==========================================================================
 * BERKAS TIDAK PERNAH DISIMPAN DI `public/`.
 *
 * Apa pun di `public/` dilayani Next.js tanpa pemeriksaan sesi sama sekali.
 * Lampiran cuti sakit adalah dokumen medis pegawai: menaruhnya di sana
 * berarti siapa pun yang menebak (atau mendapat) URL-nya bisa membacanya,
 * selamanya, tanpa jejak. Berkas disimpan di `storage/` dan hanya keluar
 * lewat route handler yang memeriksa sesi — lihat `app/api/berkas/`.
 * ==========================================================================
 */

const AKAR = path.join(process.cwd(), "storage");

/** Kategori berkas menentukan siapa yang boleh membacanya. */
export const KATEGORI_BERKAS = ["lampiran", "rekam", "logo", "ttd"] as const;
export type KategoriBerkas = (typeof KATEGORI_BERKAS)[number];

type Aturan = {
  maksBytes: number;
  /** MIME yang diterima, dipetakan ke ekstensi kanonisnya. */
  tipe: Record<string, string>;
};

const ATURAN: Record<KategoriBerkas, Aturan> = {
  lampiran: {
    maksBytes: 5 * 1024 * 1024,
    tipe: {
      "application/pdf": "pdf",
      "image/jpeg": "jpg",
      "image/png": "png",
    },
  },
  /*
   * Dokumen pendukung rekam medis. Kategorinya DIPISAH dari `lampiran`
   * (lampiran cuti pegawai) meski aturan berkasnya kebetulan sama — yang
   * berbeda adalah siapa yang berhak membacanya, dan `berhak()` di
   * app/api/berkas/ menentukan itu dari nama kategorinya. Menyatukan
   * keduanya berarti hak akses cuti dan rekam medis ikut menyatu.
   */
  rekam: {
    maksBytes: 5 * 1024 * 1024,
    tipe: {
      "application/pdf": "pdf",
      "image/jpeg": "jpg",
      "image/png": "png",
    },
  },
  logo: {
    maksBytes: 1 * 1024 * 1024,
    tipe: { "image/png": "png", "image/jpeg": "jpg" },
  },
  ttd: {
    maksBytes: 512 * 1024,
    tipe: { "image/png": "png" },
  },
};

/**
 * Tanda tangan berkas (*magic bytes*).
 *
 * `File.type` berasal dari peramban dan bisa dibuat sesuka pengunggah —
 * berkas apa pun bisa mengaku `image/png`. Isinya karena itu diperiksa
 * sendiri, dan yang tidak cocok ditolak.
 */
const TANDA: { ext: string; cocok: (b: Buffer) => boolean }[] = [
  { ext: "pdf", cocok: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  {
    ext: "png",
    cocok: (b) =>
      b.length > 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  { ext: "jpg", cocok: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

export class BerkasDitolak extends Error {
  constructor(pesan: string) {
    super(pesan);
    this.name = "BerkasDitolak";
  }
}

/** Membaca ekstensi sebenarnya dari isi berkas, bukan dari namanya. */
function ekstensiSebenarnya(buf: Buffer): string | null {
  return TANDA.find((t) => t.cocok(buf))?.ext ?? null;
}

/**
 * Menyimpan berkas dan mengembalikan kuncinya (relatif, tanpa akar).
 *
 * Nama berkas SELALU dibuat sendiri dari byte acak. Nama asli dari
 * pengunggah tidak pernah ikut ke sistem berkas — di situlah lubang
 * *path traversal* (`../../`) dan nama berbahaya lain masuk.
 */
export async function simpanBerkas(
  file: File,
  kategori: KategoriBerkas,
): Promise<{ kunci: string; ukuran: number; ext: string; sha256: string }> {
  const aturan = ATURAN[kategori];

  if (file.size === 0) throw new BerkasDitolak("Berkas kosong.");
  if (file.size > aturan.maksBytes) {
    throw new BerkasDitolak(
      `Ukuran berkas melebihi ${Math.round(aturan.maksBytes / 1024 / 1024)} MB.`,
    );
  }

  const diterima = Object.values(aturan.tipe);
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = ekstensiSebenarnya(buf);

  if (!ext || !diterima.includes(ext)) {
    throw new BerkasDitolak(
      `Jenis berkas tidak didukung. Yang diterima: ${diterima.join(", ").toUpperCase()}.`,
    );
  }

  // Nama acak 16 byte; ditaruh per kategori dan per bulan agar direktori
  // tidak membengkak jadi satu folder berisi puluhan ribu berkas.
  const bulan = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .replace("-", "");

  const nama = `${randomBytes(16).toString("hex")}.${ext}`;
  const kunci = `${kategori}/${bulan}/${nama}`;
  const tujuan = path.join(AKAR, kunci);

  await mkdir(path.dirname(tujuan), { recursive: true });
  await writeFile(tujuan, buf);

  return {
    kunci,
    ukuran: buf.length,
    ext,
    sha256: createHash("sha256").update(buf).digest("hex"),
  };
}

/**
 * Membaca berkas dari kuncinya.
 *
 * Kunci divalidasi ketat lalu jalur hasilnya diperiksa ulang harus berada
 * di dalam `storage/`. Pemeriksaan ganda ini disengaja: satu lapis pola
 * saja pernah jadi sumber banyak celah *path traversal*.
 */
export async function bacaBerkas(
  kunci: string,
): Promise<{ isi: Buffer; mime: string } | null> {
  if (!/^[a-z]+\/\d{6}\/[a-f0-9]{32}\.(pdf|png|jpg)$/.test(kunci)) return null;

  const tujuan = path.resolve(AKAR, kunci);
  if (tujuan !== path.normalize(tujuan) || !tujuan.startsWith(path.resolve(AKAR) + path.sep)) {
    return null;
  }

  try {
    const isi = await readFile(tujuan);
    const ext = kunci.slice(kunci.lastIndexOf(".") + 1);
    const mime =
      ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg";
    return { isi, mime };
  } catch {
    return null;
  }
}

/** Menghapus berkas. Gagal-diam: berkas yang sudah tidak ada bukan galat. */
export async function hapusBerkas(kunci: string | null | undefined): Promise<void> {
  if (!kunci) return;
  if (!/^[a-z]+\/\d{6}\/[a-f0-9]{32}\.(pdf|png|jpg)$/.test(kunci)) return;
  try {
    await unlink(path.join(AKAR, kunci));
  } catch {
    /* sudah tidak ada */
  }
}

export const ukuranMaks = (kategori: KategoriBerkas) => ATURAN[kategori].maksBytes;
export const tipeDiterima = (kategori: KategoriBerkas) =>
  Object.keys(ATURAN[kategori].tipe);
