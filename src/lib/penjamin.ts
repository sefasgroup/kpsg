import "server-only";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { execute, limitAman, query, queryOne } from "./db";
import type { PenjaminInput, TarifPenjaminInput } from "./validations/penjamin";

/**
 * Penjamin: BPJS, asuransi, dan perusahaan.
 *
 * MENGAPA MODUL INI ADA
 *
 * Sebelumnya `cara_bayar` hanya label empat pilihan. Tagihan pasien
 * perusahaan terbentuk dengan benar, tetapi **tidak ada satu pun layar
 * yang bisa menagihkannya sebagai berkas ke perusahaannya** — padahal bagi
 * Klinik Pratama, penjamin biasanya adalah sumber pendapatan terbesar,
 * bukan pasien tunai.
 *
 * Global, bukan per cabang: satu kontrak berlaku untuk seluruh jaringan,
 * sama seperti `suppliers` dan katalog obat. Yang per cabang adalah
 * klaimnya (`lib/klaim.ts`), karena tagihannya memang lahir di cabang.
 */

export type PenjaminRow = RowDataPacket & {
  id: number;
  kode: string;
  nama: string;
  jenis: "bpjs" | "asuransi" | "perusahaan";
  npwp: string | null;
  alamat: string | null;
  telepon: string | null;
  email: string | null;
  pic_nama: string | null;
  pic_telepon: string | null;
  termin_hari: number;
  plafon_per_kunjungan: string;
  catatan: string | null;
  is_active: number;
  jumlah_tarif: number;
  jumlah_pasien: number;
};

const SELECT_PENJAMIN = `
  SELECT p.id, p.kode, p.nama, p.jenis, p.npwp, p.alamat, p.telepon, p.email,
         p.pic_nama, p.pic_telepon, p.termin_hari, p.plafon_per_kunjungan,
         p.catatan, p.is_active,
         (SELECT COUNT(*) FROM payer_tariffs t WHERE t.payer_id = p.id) AS jumlah_tarif,
         (SELECT COUNT(*) FROM patients pa WHERE pa.payer_id = p.id AND pa.is_active = 1) AS jumlah_pasien
    FROM payers p
   WHERE p.deleted_at IS NULL
`;

export async function daftarPenjamin(
  opts: { hanyaAktif?: boolean } = {},
): Promise<PenjaminRow[]> {
  return query<PenjaminRow>(
    `${SELECT_PENJAMIN}
       ${opts.hanyaAktif ? "AND p.is_active = 1" : ""}
     ORDER BY p.is_active DESC, p.jenis, p.nama`,
  );
}

export async function getPenjamin(id: number): Promise<PenjaminRow | null> {
  return queryOne<PenjaminRow>(`${SELECT_PENJAMIN} AND p.id = ?`, [id]);
}

export async function simpanPenjamin(
  input: PenjaminInput,
  id?: number,
): Promise<number> {
  if (id) {
    await execute(
      `UPDATE payers SET kode=?, nama=?, jenis=?, npwp=?, alamat=?, telepon=?,
              email=?, pic_nama=?, pic_telepon=?, termin_hari=?,
              plafon_per_kunjungan=?, catatan=?, is_active=?
        WHERE id = ? AND deleted_at IS NULL`,
      [
        input.kode, input.nama, input.jenis, input.npwp ?? null,
        input.alamat ?? null, input.telepon ?? null, input.email ?? null,
        input.pic_nama ?? null, input.pic_telepon ?? null, input.termin_hari,
        input.plafon_per_kunjungan, input.catatan ?? null,
        input.is_active ? 1 : 0, id,
      ],
    );
    return id;
  }

  const res = await execute(
    `INSERT INTO payers (kode, nama, jenis, npwp, alamat, telepon, email,
                         pic_nama, pic_telepon, termin_hari, plafon_per_kunjungan,
                         catatan, is_active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.kode, input.nama, input.jenis, input.npwp ?? null,
      input.alamat ?? null, input.telepon ?? null, input.email ?? null,
      input.pic_nama ?? null, input.pic_telepon ?? null, input.termin_hari,
      input.plafon_per_kunjungan, input.catatan ?? null, input.is_active ? 1 : 0,
    ],
  );
  return res.insertId;
}

/**
 * Penjamin **dinonaktifkan, tidak dihapus**.
 *
 * Alasannya sama dengan parameter lab: `visits.payer_id` dan
 * `billing_transactions.payer_id` adalah *foreign key* tanpa `ON DELETE`,
 * sehingga penghapusan akan memusnahkan riwayat penagihan bertahun-tahun —
 * termasuk klaim yang sudah dibayar.
 */
export async function nonaktifkanPenjamin(id: number): Promise<void> {
  await execute(`UPDATE payers SET is_active = 0 WHERE id = ?`, [id]);
}

// ---------------------------------------------------------------------
// Tarif kontrak
// ---------------------------------------------------------------------

export type TarifPenjaminRow = RowDataPacket & {
  id: number;
  payer_id: number;
  procedure_id: number | null;
  item_id: number | null;
  sasaran: string;
  kode_sasaran: string;
  jenis_sasaran: "tindakan" | "barang";
  harga: string;
  harga_normal: string;
};

/**
 * Tarif kontrak beserta tarif normalnya, supaya selisihnya langsung
 * terbaca. Kontrak yang justru lebih mahal daripada tarif umum hampir
 * selalu salah input, dan tanpa pembanding di baris yang sama tidak ada
 * yang akan menyadarinya.
 */
export async function tarifPenjamin(payerId: number): Promise<TarifPenjaminRow[]> {
  return query<TarifPenjaminRow>(
    `SELECT t.id, t.payer_id, t.procedure_id, t.item_id, t.harga,
            mp.nama AS nama_tindakan, mp.kode AS kode_tindakan, mp.tarif AS tarif_tindakan,
            i.nama AS nama_barang, i.kode AS kode_barang, i.harga_jual AS harga_barang,
            COALESCE(mp.nama, i.nama) AS sasaran,
            COALESCE(mp.kode, i.kode) AS kode_sasaran,
            IF(t.procedure_id IS NOT NULL, 'tindakan', 'barang') AS jenis_sasaran,
            COALESCE(mp.tarif, i.harga_jual) AS harga_normal
       FROM payer_tariffs t
       LEFT JOIN medical_procedures mp ON mp.id = t.procedure_id
       LEFT JOIN items i ON i.id = t.item_id
      WHERE t.payer_id = ?
      ORDER BY jenis_sasaran, sasaran`,
    [payerId],
  );
}

export async function simpanTarifPenjamin(
  input: TarifPenjaminInput,
): Promise<number> {
  /*
   * `ON DUPLICATE KEY UPDATE` dipakai supaya menyimpan tarif yang sudah
   * ada berarti mengubahnya, bukan gagal. Dua kunci unik parsial
   * (`uq_ptar_proc` dan `uq_ptar_item`) sama-sama tertangani karena hanya
   * satu di antaranya yang pernah punya nilai bukan NULL per baris.
   */
  const res = await execute(
    `INSERT INTO payer_tariffs (payer_id, procedure_id, item_id, harga)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE harga = VALUES(harga)`,
    [input.payer_id, input.procedure_id, input.item_id, input.harga],
  );
  return res.insertId;
}

export async function hapusTarifPenjamin(id: number, payerId: number): Promise<void> {
  await execute(`DELETE FROM payer_tariffs WHERE id = ? AND payer_id = ?`, [id, payerId]);
}

/**
 * Harga yang berlaku untuk satu tindakan, dengan urutan kewenangan:
 *
 *   1. tarif kontrak penjamin   (paling khusus)
 *   2. tarif cabang             (`site_procedure_tariffs`)
 *   3. tarif global             (`medical_procedures.tarif`)
 *
 * Urutan ini penting dan tidak boleh dibalik: kontrak adalah kesepakatan
 * tertulis dengan pihak luar, sedangkan tarif cabang hanya kebijakan
 * internal. Menagih penjamin di atas harga kontrak adalah cara tercepat
 * membuat seluruh berkas klaim ditolak.
 */
export async function tarifTindakanBerlaku(
  conn: PoolConnection,
  procedureId: number,
  siteId: number,
  payerId: number | null,
): Promise<number | null> {
  if (payerId) {
    const [kontrak] = await conn.execute<RowDataPacket[]>(
      `SELECT harga FROM payer_tariffs WHERE payer_id = ? AND procedure_id = ?`,
      [payerId, procedureId],
    );
    if (kontrak[0]) return Number(kontrak[0].harga);
  }

  const [cabang] = await conn.execute<RowDataPacket[]>(
    `SELECT tarif FROM site_procedure_tariffs WHERE site_id = ? AND procedure_id = ?`,
    [siteId, procedureId],
  );
  if (cabang[0]) return Number(cabang[0].tarif);

  const [global] = await conn.execute<RowDataPacket[]>(
    `SELECT tarif FROM medical_procedures WHERE id = ?`,
    [procedureId],
  );
  return global[0] ? Number(global[0].tarif) : null;
}

/** Versi tanpa transaksi, untuk layar yang hanya menampilkan harga. */
export async function tarifTindakanUntukPenjamin(
  procedureId: number,
  siteId: number,
  payerId: number | null,
): Promise<number | null> {
  const row = await queryOne<RowDataPacket & { harga: string }>(
    `SELECT COALESCE(
              (SELECT t.harga FROM payer_tariffs t
                WHERE t.payer_id = ? AND t.procedure_id = mp.id),
              (SELECT s.tarif FROM site_procedure_tariffs s
                WHERE s.site_id = ? AND s.procedure_id = mp.id),
              mp.tarif
            ) AS harga
       FROM medical_procedures mp WHERE mp.id = ?`,
    [payerId, siteId, procedureId],
  );
  return row ? Number(row.harga) : null;
}

// ---------------------------------------------------------------------
// Pembagian tanggungan
// ---------------------------------------------------------------------

export type Tanggungan = {
  penjamin: number;
  pasien: number;
  /** Plafon penjamin terlampaui — dipakai untuk pesan di kasir. */
  melebihiPlafon: boolean;
};

/**
 * Membagi total tagihan antara penjamin dan pasien.
 *
 * SATU-SATUNYA tempat aturan ini hidup. `hitungUlangTagihan()` di
 * `billing.ts` memanggilnya, bukan menyalinnya: aturan pembagian uang yang
 * ditulis dua kali adalah dua aturan yang akan menyimpang, dan sistem ini
 * sudah pernah kena akibatnya sekali (aturan status pasca-lab yang
 * terduplikasi berujung kunjungan yang tidak bisa maju maupun tutup).
 *
 * Arti nilai `plafon`:
 *
 *   plafon < 0  → tidak ada penjamin; pasien menanggung seluruhnya
 *   plafon = 0  → penjamin menanggung seluruhnya (tanpa batas)
 *   plafon > 0  → penjamin menanggung sampai plafon, sisanya ke pasien
 *
 * `0` yang berarti "tanpa batas" perlu dieja karena ia juga bisa dibaca
 * "tidak menanggung apa pun" — dan salah tafsir di sini berarti menagih
 * pasien penuh atas tagihan yang seharusnya ditanggung penjamin.
 */
export function bagiTanggungan(total: number, plafon: number): Tanggungan {
  if (plafon < 0) return { penjamin: 0, pasien: total, melebihiPlafon: false };
  if (plafon === 0) return { penjamin: total, pasien: 0, melebihiPlafon: false };
  const penjamin = Math.min(total, plafon);
  return { penjamin, pasien: total - penjamin, melebihiPlafon: total > plafon };
}

export type PenjaminRingkas = {
  id: number;
  kode: string;
  nama: string;
  jenis: string;
  terminHari: number;
  plafon: number;
};

/** Penjamin yang berlaku untuk satu kunjungan, dari `visits.payer_id`. */
export async function penjaminKunjungan(
  visitId: number,
): Promise<PenjaminRingkas | null> {
  const row = await queryOne<RowDataPacket & {
    id: number; kode: string; nama: string; jenis: string;
    termin_hari: number; plafon_per_kunjungan: string;
  }>(
    `SELECT p.id, p.kode, p.nama, p.jenis, p.termin_hari, p.plafon_per_kunjungan
       FROM visits v JOIN payers p ON p.id = v.payer_id
      WHERE v.id = ?`,
    [visitId],
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    kode: row.kode,
    nama: row.nama,
    jenis: row.jenis,
    terminHari: Number(row.termin_hari),
    plafon: Number(row.plafon_per_kunjungan),
  };
}

/** Opsi untuk pemilih penjamin di layar pendaftaran. */
export async function opsiPenjamin(limit = 200) {
  return query<RowDataPacket & { id: number; kode: string; nama: string; jenis: string }>(
    `SELECT id, kode, nama, jenis FROM payers
      WHERE is_active = 1 AND deleted_at IS NULL
      ORDER BY jenis, nama
      LIMIT ${limitAman(limit, 200, 500)}`,
  );
}
