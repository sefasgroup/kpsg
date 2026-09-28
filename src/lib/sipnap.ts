import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { query, queryOne } from "./db";

/**
 * Laporan narkotika & psikotropika (SIPNAP).
 *
 * Laporan bulanan ke Kemenkes adalah **kewajiban hukum** apotek yang
 * menyimpan atau menyerahkan narkotika/psikotropika, bukan pilihan.
 *
 * ANGKANYA TIDAK DITABELKAN
 *
 * Saldo awal, pemasukan, pengeluaran, dan saldo akhir seluruhnya sudah
 * terkandung di `stock_movements`, yang menurut docs/DATABASE.md §3.3
 * adalah satu-satunya sumber kebenaran stok. Menyalinnya ke tabel laporan
 * berarti menciptakan angka kedua yang bisa berbeda dari kartu stok — dan
 * pada laporan yang bisa diaudit petugas Dinkes, dua angka yang berbeda
 * lebih buruk daripada tidak ada laporan sama sekali.
 *
 * Yang ditambahkan ke skema karena itu hanya penggolongannya:
 * `is_psikotropika`, `golongan_narkotika`, dan `no_izin_edar`.
 */

export type BarisSipnap = RowDataPacket & {
  item_id: number;
  kode: string;
  nama: string;
  nama_generik: string | null;
  satuan_dasar: string;
  golongan: string;
  golongan_narkotika: string | null;
  no_izin_edar: string | null;
  saldo_awal: string;
  masuk: string;
  keluar: string;
  /** Saldo awal + masuk − keluar. Dihitung SQL, bukan di klien. */
  saldo_akhir: string;
  /** Saldo tercatat sekarang — pembanding untuk menguji kebocoran. */
  saldo_sistem: string;
};

/**
 * Rekap satu periode untuk seluruh item narkotika & psikotropika.
 *
 * `saldo_sistem` sengaja ikut ditarik meski bukan bagian formulir SIPNAP.
 * Ia adalah alat uji: pada periode yang berakhir hari ini, `saldo_akhir`
 * hasil hitungan pergerakan HARUS sama dengan saldo yang tercatat. Kalau
 * berbeda, ada pergerakan yang tidak tercatat di kartu stok — dan itu
 * ditemukan di sini, sebelum laporannya dikirim, bukan setelahnya.
 */
export async function rekapSipnap(
  siteId: number,
  dari: string,
  sampai: string,
): Promise<BarisSipnap[]> {
  return query<BarisSipnap>(
    `SELECT i.id AS item_id, i.kode, i.nama, i.nama_generik, i.satuan_dasar,
            CASE WHEN i.is_narkotika = 1 THEN 'narkotika' ELSE 'psikotropika' END AS golongan,
            i.golongan_narkotika, i.no_izin_edar,

            COALESCE((SELECT SUM(m.qty_delta) FROM stock_movements m
                       WHERE m.site_id = ? AND m.item_id = i.id
                         AND DATE(m.created_at) < ?), 0) AS saldo_awal,

            COALESCE((SELECT SUM(m.qty) FROM stock_movements m
                       WHERE m.site_id = ? AND m.item_id = i.id
                         AND m.qty_delta > 0
                         AND DATE(m.created_at) BETWEEN ? AND ?), 0) AS masuk,

            COALESCE((SELECT SUM(m.qty) FROM stock_movements m
                       WHERE m.site_id = ? AND m.item_id = i.id
                         AND m.qty_delta < 0
                         AND DATE(m.created_at) BETWEEN ? AND ?), 0) AS keluar,

            COALESCE((SELECT SUM(m.qty_delta) FROM stock_movements m
                       WHERE m.site_id = ? AND m.item_id = i.id
                         AND DATE(m.created_at) <= ?), 0) AS saldo_akhir,

            COALESCE((SELECT s.qty_on_hand FROM item_stocks s
                       WHERE s.site_id = ? AND s.item_id = i.id), 0) AS saldo_sistem
       FROM items i
      WHERE (i.is_narkotika = 1 OR i.is_psikotropika = 1)
        AND i.deleted_at IS NULL
      /*
       * Item yang tidak pernah bergerak DAN saldonya nol tidak perlu
       * dilaporkan — formulir SIPNAP hanya memuat yang benar-benar ada
       * atau bergerak. Item yang saldonya nol tetapi pernah bergerak
       * JUSTRU wajib ikut: itulah yang habis diserahkan bulan ini.
       */
      HAVING saldo_awal <> 0 OR masuk <> 0 OR keluar <> 0 OR saldo_sistem <> 0
      ORDER BY golongan, i.nama`,
    [
      siteId, dari,
      siteId, dari, sampai,
      siteId, dari, sampai,
      siteId, sampai,
      siteId,
    ],
  );
}

export type RincianSipnap = RowDataPacket & {
  tanggal: string;
  jenis: string;
  qty: string;
  qty_delta: string;
  qty_after: string;
  catatan: string | null;
  /** No. resep bila pengeluarannya lewat resep — wajib pada register. */
  no_resep: string | null;
  pasien: string | null;
  dokter: string | null;
  petugas: string;
};

/**
 * Register rinci satu item — kartu yang diminta petugas saat pemeriksaan.
 *
 * Nama pasien dan dokter penulis resep ikut ditarik karena register
 * narkotika wajib menunjukkan **kepada siapa** obat itu diserahkan dan
 * **atas resep siapa**. Rekap jumlah saja tidak pernah cukup untuk
 * pemeriksaan; yang ditelusuri justru barisnya satu per satu.
 */
export async function registerSipnap(
  siteId: number,
  itemId: number,
  dari: string,
  sampai: string,
): Promise<RincianSipnap[]> {
  return query<RincianSipnap>(
    `SELECT DATE(m.created_at) AS tanggal, m.jenis, m.qty, m.qty_delta,
            m.qty_after, m.catatan,
            rx.no_resep, pa.nama AS pasien, du.nama AS dokter,
            u.nama AS petugas
       FROM stock_movements m
       JOIN users u ON u.id = m.created_by
       /*
        * Rantai penelusuran pengeluaran resep: pergerakan → item resep →
        * resep → kunjungan → pasien. Racikan memakai jalur berbeda
        * ('racikan_ingredient'), jadi kolom resepnya kosong di situ —
        * lebih baik kosong daripada salah menautkan.
        */
       LEFT JOIN prescription_items pi
              ON m.ref_type = 'prescription_item' AND pi.id = m.ref_id
       LEFT JOIN prescriptions rx ON rx.id = pi.prescription_id
       LEFT JOIN visits v    ON v.id = rx.visit_id
       LEFT JOIN patients pa ON pa.id = v.patient_id
       LEFT JOIN users du    ON du.id = rx.doctor_id
      WHERE m.site_id = ? AND m.item_id = ?
        AND DATE(m.created_at) BETWEEN ? AND ?
      ORDER BY m.created_at, m.id`,
    [siteId, itemId, dari, sampai],
  );
}

export type RingkasanSipnap = {
  jumlahItem: number;
  narkotika: number;
  psikotropika: number;
  /** Item yang saldo hitungannya tidak cocok dengan saldo tercatat. */
  selisih: number;
  /** Item golongan narkotika yang belum diisi golongannya — wajib SIPNAP. */
  tanpaGolongan: number;
  tanpaIzinEdar: number;
};

/**
 * Kesiapan pelaporan. Dipanggil layarnya sebelum laporan dicetak, supaya
 * data yang belum lengkap ditemukan sekarang — bukan oleh petugas Dinkes.
 */
export async function kesiapanSipnap(
  siteId: number,
  dari: string,
  sampai: string,
  /*
   * Baris rekap yang SUDAH dimiliki pemanggil.
   *
   * Tanpa parameter ini, layar SIPNAP menjalankan `rekapSipnap()` dua kali
   * setiap kali dibuka — sekali untuk tabelnya, sekali lagi dari dalam sini
   * — dan kueri itu memuat lima subkueri berkorelasi per item. Angkanya
   * pasti sama; yang berbeda hanya waktu tunggu petugas.
   */
  barisSiap?: BarisSipnap[],
): Promise<RingkasanSipnap> {
  const baris = barisSiap ?? (await rekapSipnap(siteId, dari, sampai));

  const r = await queryOne<RowDataPacket & {
    tanpa_golongan: number; tanpa_nie: number;
  }>(
    `SELECT SUM(i.is_narkotika = 1 AND i.golongan_narkotika IS NULL) AS tanpa_golongan,
            SUM(i.no_izin_edar IS NULL) AS tanpa_nie
       FROM items i
      WHERE (i.is_narkotika = 1 OR i.is_psikotropika = 1)
        AND i.deleted_at IS NULL AND i.is_active = 1`,
  );

  return {
    jumlahItem: baris.length,
    narkotika: baris.filter((b) => b.golongan === "narkotika").length,
    psikotropika: baris.filter((b) => b.golongan === "psikotropika").length,
    selisih: baris.filter(
      (b) =>
        // Selisih hanya bermakna bila periodenya berakhir hari ini atau
        // sesudahnya; periode lampau memang boleh berbeda dari saldo kini.
        Number(b.saldo_akhir) !== Number(b.saldo_sistem),
    ).length,
    tanpaGolongan: Number(r?.tanpa_golongan ?? 0),
    tanpaIzinEdar: Number(r?.tanpa_nie ?? 0),
  };
}
