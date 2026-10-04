import { z } from "zod";
import { formatRupiah } from "../format";

export const METODE_BAYAR = [
  "tunai",
  "qris",
  "transfer",
  "kartu_debit",
  "kartu_kredit",
  "bpjs",
  /*
   * `penjamin` dipakai saat SELURUH tagihan ditanggung penjamin sehingga
   * pasien tidak mengeluarkan uang sama sekali. Tagihannya tetap ditandai
   * lunas — supaya gerbang farmasi (obat hanya keluar setelah lunas) tidak
   * perlu diutak-atik — dan piutangnya hidup di klaim, bukan dengan
   * menahan pasien di kasir.
   */
  "penjamin",
  "lainnya",
] as const;

export const METODE_LABEL: Record<(typeof METODE_BAYAR)[number], string> = {
  tunai: "Tunai",
  qris: "QRIS",
  transfer: "Transfer Bank",
  kartu_debit: "Kartu Debit",
  kartu_kredit: "Kartu Kredit",
  bpjs: "BPJS",
  penjamin: "Ditanggung Penjamin",
  lainnya: "Lainnya",
};

/**
 * Metode non-tunai wajib punya nomor referensi untuk rekonsiliasi.
 * `lainnya` ikut: tanpa keterangan, tagihan lunas lewat "lainnya" adalah
 * pendapatan yang hilang tanpa jejak ke mana uangnya masuk.
 */
export const BUTUH_REFERENSI: readonly string[] = [
  "qris",
  "transfer",
  "kartu_debit",
  "kartu_kredit",
  "lainnya",
];

/**
 * Pembulatan paket — total yang dibayar pasien ditetapkan ke salah satu
 * nominal ini, apa pun rinciannya.
 *
 * Nominal terkecil sekaligus menjadi BIAYA MINIMUM: pasien tanpa penjamin
 * yang tagihannya di bawahnya wajib memakai salah satu paket. Pembulatan
 * selalu ke ATAS (paket < total ditolak) — paket bukan jalan pintas diskon.
 *
 * Pasien berpenjamin dikecualikan: menaikkan tagihannya berarti mengklaim
 * ke penjamin biaya yang tidak pernah terjadi.
 *
 * Daftarnya disetel per cabang lewat `billing.paket` (dipisah koma; kosong =
 * tanpa paket dan tanpa biaya minimum). Ini nilai bawaan bila barisnya belum ada.
 */
export const PAKET_BAWAAN: readonly number[] = [125000, 130000, 170000, 175000];

/** Mengurai setelan `billing.paket`; `null` (baris tidak ada) = bawaan. */
export function uraiPaket(svalue: string | null | undefined): number[] {
  if (svalue === null || svalue === undefined) return [...PAKET_BAWAAN];
  const angka = svalue
    .split(",")
    // "125.000" ditulis dengan titik ribuan pun tetap terbaca.
    .map((x) => Number(x.trim().replace(/\./g, "")))
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(angka)].sort((x, y) => x - y);
}

/**
 * Total yang ditagih — SATU-SATUNYA tempat aturan pembulatan hidup. Layar
 * kasir memakainya untuk pratinjau, `prosesPembayaran()` untuk menyimpan,
 * sehingga angka di layar tidak mungkin berbeda dari yang tercatat.
 *
 * `galat` bukan null bila tagihan belum boleh dibayar dengan pilihan ini.
 */
export function hitungTotalBayar(a: {
  subtotal: number;
  diskon: number;
  /** Nominal paket yang dipilih, 0 = tanpa paket. */
  paket: number;
  /** Paket yang berlaku di cabang ini (terurut naik); kosong = fitur mati. */
  daftarPaket: readonly number[];
  /** Kelipatan pembulatan ke bawah dari setelan cabang (`billing.pembulatan`). */
  pembulatanKe: number;
  berpenjamin: boolean;
}): { pembulatan: number; total: number; galat: string | null } {
  const setelahDiskon = Math.max(0, a.subtotal - a.diskon);

  if (a.paket > 0) {
    const total = a.paket;
    const hasil = { pembulatan: total - a.subtotal, total };
    if (!a.daftarPaket.includes(a.paket)) {
      return { ...hasil, galat: "Pilihan pembulatan tidak berlaku di cabang ini." };
    }
    if (a.berpenjamin) {
      return {
        ...hasil,
        galat: "Pembulatan paket hanya untuk pasien tanpa penjamin — tagihan penjamin tidak boleh dinaikkan.",
      };
    }
    if (a.diskon > 0) {
      return { ...hasil, galat: "Diskon tidak bisa digabung dengan pembulatan paket." };
    }
    if (a.paket < a.subtotal) {
      return {
        ...hasil,
        galat: `Pembulatan ${formatRupiah(a.paket)} di bawah total tagihan ${formatRupiah(a.subtotal)}.`,
      };
    }
    return { ...hasil, galat: null };
  }

  // Pembulatan cabang ke bawah agar pasien tidak pernah membayar lebih dari rincian.
  const pembulatan = a.pembulatanKe > 1 ? -(setelahDiskon % a.pembulatanKe) : 0;
  const total = setelahDiskon + pembulatan;
  const minimum = a.daftarPaket[0];
  const galat =
    !a.berpenjamin && minimum !== undefined && setelahDiskon < minimum
      ? `Total di bawah ${formatRupiah(minimum)} — pilih salah satu pembulatan.`
      : null;
  return { pembulatan, total, galat };
}

/**
 * Struk ringkas berlaku bila tagihan dibayar dengan paket. Pembulatan cabang
 * selalu ke bawah (≤ 0), sehingga pembulatan POSITIF hanya bisa berasal dari
 * paket — cukup untuk mengenali struk paket saat dicetak ulang tanpa kolom baru.
 */
export const pakaiPaket = (pembulatan: number) => pembulatan > 0;

export const pembayaranSchema = z
  .object({
    payment_method: z.enum(METODE_BAYAR, { message: "Metode bayar wajib dipilih" }),
    paket: z.coerce.number().int().min(0).default(0),
    payment_ref: z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
    diskon: z.coerce.number().min(0, "Diskon tidak boleh negatif").default(0),
    /** Uang yang diterima. Hanya bermakna untuk pembayaran tunai. */
    dibayar: z.coerce.number().min(0).default(0),
    catatan: z
      .string()
      .trim()
      .max(255)
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
  })
  .refine(
    (v) => !BUTUH_REFERENSI.includes(v.payment_method) || Boolean(v.payment_ref),
    {
      message: "Nomor referensi/approval wajib diisi untuk pembayaran non-tunai",
      path: ["payment_ref"],
    },
  );

export type PembayaranFormValues = z.input<typeof pembayaranSchema>;
export type PembayaranInput = z.output<typeof pembayaranSchema>;

export const shiftSchema = z.object({
  kas_awal: z.coerce.number().min(0).default(0),
});

export const tutupShiftSchema = z.object({
  kas_akhir_fisik: z.coerce.number().min(0),
  catatan: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});
