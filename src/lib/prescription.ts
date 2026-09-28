import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { nextSequence, query, queryOne, transaction, limitAman } from "./db";
import { hapusBarisTagihanByRef, hitungUlangTagihan, pastikanTagihan } from "./billing";
import { lepasReservasiResep } from "./pharmacy";
import type { ResepInput } from "./validations/doctor";
import { periodeSekarang } from "./tanggal";

/**
 * E-Resep dengan struktur parent-child (CLAUDE.md §7):
 *
 *   prescriptions (header)
 *   ├── prescription_items                  ← obat paten
 *   └── prescription_racikans               ← header racikan
 *       └── prescription_racikan_ingredients ← bahan mentah
 *
 * Stok TIDAK dipotong di sini. Pemotongan terjadi saat farmasi menyiapkan
 * dan menyerahkan obat (CLAUDE.md §3.1 langkah Q1) — pasien membayar apa
 * yang benar-benar diserahkan, bukan apa yang diresepkan.
 */

export type ObatOption = RowDataPacket & {
  id: number;
  kode: string;
  nama: string;
  bentuk_sediaan: string | null;
  satuan_dasar: string;
  harga_jual: string;
  stok: string;
  is_racikable: number;
};

/** Pencarian obat untuk resep. `hanyaBahanRacikan` menyaring bahan yang boleh diracik. */
export async function cariObat(
  keyword: string,
  siteId: number | null,
  hanyaBahanRacikan = false,
  limit = 15,
): Promise<ObatOption[]> {
  const q = keyword.trim();
  if (q.length < 2) return [];
  return query<ObatOption>(
    /* Stok TERSEDIA, bukan stok fisik: bagian yang dikunci resep pasien lain
       tidak boleh ikut ditawarkan — dokter akan meresepkannya lalu farmasi
       menolak memvalidasinya. */
    `SELECT i.id, i.kode, i.nama, i.bentuk_sediaan, i.satuan_dasar,
            i.harga_jual, i.is_racikable,
            GREATEST(0, COALESCE(s.qty_on_hand, 0) - COALESCE(s.qty_reserved, 0)) AS stok
       FROM items i
       LEFT JOIN item_stocks s ON s.item_id = i.id AND s.site_id = ?
      WHERE i.tipe = 'obat' AND i.is_active = 1 AND i.deleted_at IS NULL
        AND (? = 0 OR i.is_racikable = 1)
        AND (i.nama LIKE ? OR i.nama_generik LIKE ? OR i.kode LIKE ?)
      ORDER BY (COALESCE(s.qty_on_hand,0) > 0) DESC, i.nama
      LIMIT ${limitAman(limit)}`,
    [siteId, hanyaBahanRacikan ? 1 : 0, `%${q}%`, `%${q}%`, `${q}%`],
  );
}

export type ResepHeader = RowDataPacket & {
  id: number;
  no_resep: string;
  status: string;
  catatan_umum: string | null;
  created_at: string;
  dokter_nama: string;
};

export async function getResep(visitId: number): Promise<ResepHeader | null> {
  return queryOne<ResepHeader>(
    `SELECT rx.id, rx.no_resep, rx.status, rx.catatan_umum, rx.created_at,
            u.nama AS dokter_nama
       FROM prescriptions rx
       JOIN users u ON u.id = rx.doctor_id
      WHERE rx.visit_id = ? AND rx.status <> 'batal'`,
    [visitId],
  );
}

export async function getResepItems(prescriptionId: number) {
  return query<RowDataPacket & {
    id: number; item_id: number; nama: string; qty: string; satuan: string;
    aturan_pakai: string; catatan: string | null; harga_satuan: string; stok: string;
  }>(
    `SELECT pi.id, pi.item_id, i.nama, pi.qty, pi.satuan, pi.aturan_pakai,
            pi.catatan, pi.harga_satuan,
            GREATEST(0, COALESCE(s.qty_on_hand, 0) - COALESCE(s.qty_reserved, 0)) AS stok
       FROM prescription_items pi
       JOIN items i ON i.id = pi.item_id
       JOIN prescriptions rx ON rx.id = pi.prescription_id
       LEFT JOIN item_stocks s ON s.item_id = pi.item_id AND s.site_id = rx.site_id
      WHERE pi.prescription_id = ?
      ORDER BY pi.urutan, pi.id`,
    [prescriptionId],
  );
}

export async function getResepRacikans(prescriptionId: number) {
  const racikans = await query<RowDataPacket & {
    id: number; nama_racikan: string; bentuk_sediaan: string; qty_jadi: string;
    satuan_jadi: string; aturan_pakai: string; biaya_jasa_racik: string;
    catatan: string | null;
  }>(
    `SELECT id, nama_racikan, bentuk_sediaan, qty_jadi, satuan_jadi,
            aturan_pakai, biaya_jasa_racik, catatan
       FROM prescription_racikans
      WHERE prescription_id = ?
      ORDER BY urutan, id`,
    [prescriptionId],
  );

  if (racikans.length === 0) return [];

  const bahan = await query<RowDataPacket & {
    racikan_id: number; item_id: number; nama: string; qty_bahan: string;
    satuan: string; harga_satuan: string; stok: string;
  }>(
    `SELECT ri.racikan_id, ri.item_id, i.nama, ri.qty_bahan, ri.satuan, ri.harga_satuan,
            GREATEST(0, COALESCE(s.qty_on_hand, 0) - COALESCE(s.qty_reserved, 0)) AS stok
       FROM prescription_racikan_ingredients ri
       JOIN items i ON i.id = ri.item_id
       JOIN prescription_racikans pr ON pr.id = ri.racikan_id
       JOIN prescriptions rx ON rx.id = pr.prescription_id
       LEFT JOIN item_stocks s ON s.item_id = ri.item_id AND s.site_id = rx.site_id
      WHERE pr.prescription_id = ?
      ORDER BY ri.id`,
    [prescriptionId],
  );

  return racikans.map((r) => ({
    ...r,
    ingredients: bahan.filter((b) => b.racikan_id === r.id),
  }));
}

/**
 * Menyimpan (atau menulis ulang) resep sebuah kunjungan.
 *
 * Resep yang sudah diterima farmasi tidak boleh diubah dokter — pada titik
 * itu obat mungkin sedang disiapkan. Revisi dilakukan lewat pembatalan
 * resep lalu penerbitan resep baru.
 */
export async function simpanResep(
  visitId: number,
  siteId: number,
  doctorId: number,
  input: ResepInput,
): Promise<{ prescriptionId: number; noResep: string }> {
  return transaction(async (conn) => {
    const [visitRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, site_id, status FROM visits WHERE id = ? FOR UPDATE`,
      [visitId],
    );
    const visit = visitRows[0];
    if (!visit) throw new Error("Kunjungan tidak ditemukan.");
    if (visit.site_id !== siteId) {
      throw new Error("Kunjungan ini bukan milik cabang Anda.");
    }
    /*
     * Resep hanya ditulis selama kunjungan di tahap dokter. Tanpa penjaga
     * server ini, tab kedua atau permintaan langsung bisa menerbitkan resep
     * setelah pasien membayar — obatnya masuk ke tagihan yang sudah lunas
     * dan diserahkan tanpa dibayar. Layar dokter sudah menguncinya; ini
     * lapis keduanya.
     */
    if (!["menunggu_dokter", "dalam_pemeriksaan", "menunggu_lab"].includes(String(visit.status))) {
      throw new Error("Kunjungan ini sudah lewat tahap dokter — resep tidak bisa diubah lagi.");
    }

    /*
     * Pembacaan biasa, BUKAN `FOR UPDATE`.
     *
     * Predikat `status <> 'batal'` tidak unik, jadi penguncian di sini
     * mengambil kunci rentang beserta gap-nya pada indeks kunjungan — dan
     * `INSERT INTO prescriptions` dari dokter lain, untuk PASIEN LAIN,
     * menabraknya. Terbukti 12 dari 12 percobaan pada `uji-konkurensi.ts`
     * §6, tanpa satu pun data yang mereka bagi.
     *
     * Kebenarannya tidak bersandar pada kunci ini: baris kunjungan sudah
     * dikunci pada pernyataan pertama transaksi ini, dan resep hanya bisa
     * lahir lewat jalur ini — jadi tidak ada yang bisa menyelipkan resep
     * untuk kunjungan yang sama selagi kita memegangnya.
     */
    const [adaRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, no_resep, status FROM prescriptions
        WHERE visit_id = ? AND status <> 'batal'`,
      [visitId],
    );
    const lama = adaRows[0];

    if (lama && lama.status !== "baru") {
      throw new Error(
        "Resep sudah diterima farmasi dan tidak bisa diubah. Batalkan resep lalu terbitkan resep baru.",
      );
    }

    let prescriptionId: number;
    let noResep: string;

    if (lama) {
      prescriptionId = Number(lama.id);
      noResep = String(lama.no_resep);
      await conn.execute(
        `UPDATE prescriptions SET catatan_umum = ?, doctor_id = ? WHERE id = ?`,
        [input.catatan_umum ?? null, doctorId, prescriptionId],
      );
      // ON DELETE CASCADE membersihkan item, racikan, dan bahannya sekaligus.
      await conn.execute(`DELETE FROM prescription_items WHERE prescription_id = ?`, [prescriptionId]);
      await conn.execute(`DELETE FROM prescription_racikans WHERE prescription_id = ?`, [prescriptionId]);
    } else {
      const [siteRows] = await conn.execute<RowDataPacket[]>(
        `SELECT kode FROM sites WHERE id = ?`,
        [siteId],
      );
      const kodeSite = String(siteRows[0]?.kode ?? "KPSG");
      const periode = periodeSekarang();
      const nomor = await nextSequence(conn, siteId, "resep", periode);
      noResep = `${kodeSite}/R/${periode}/${String(nomor).padStart(5, "0")}`;

      const [res] = await conn.execute<ResultSetHeader>(
        `INSERT INTO prescriptions (site_id, visit_id, no_resep, doctor_id, catatan_umum, status)
         VALUES (?,?,?,?,?, 'baru')`,
        [siteId, visitId, noResep, doctorId, input.catatan_umum ?? null],
      );
      prescriptionId = res.insertId;
    }

    // --- Obat paten ----------------------------------------------------
    let urutan = 0;
    for (const it of input.items) {
      await conn.execute(
        `INSERT INTO prescription_items
           (prescription_id, item_id, qty, satuan, aturan_pakai, catatan,
            harga_satuan, subtotal, urutan)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          prescriptionId, it.item_id, it.qty, it.satuan,
          it.aturan_pakai, it.catatan ?? null,
          it.harga_satuan, it.qty * it.harga_satuan, urutan++,
        ],
      );
    }

    // --- Racikan + komposisinya ----------------------------------------
    urutan = 0;
    for (const r of input.racikans) {
      const [rc] = await conn.execute<ResultSetHeader>(
        `INSERT INTO prescription_racikans
           (prescription_id, nama_racikan, bentuk_sediaan, qty_jadi, satuan_jadi,
            aturan_pakai, biaya_jasa_racik, catatan, urutan)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          prescriptionId, r.nama_racikan, r.bentuk_sediaan, r.qty_jadi,
          r.satuan_jadi, r.aturan_pakai, r.biaya_jasa_racik,
          r.catatan ?? null, urutan++,
        ],
      );

      for (const b of r.ingredients) {
        await conn.execute(
          `INSERT INTO prescription_racikan_ingredients
             (racikan_id, item_id, qty_bahan, satuan, harga_satuan, subtotal)
           VALUES (?,?,?,?,?,?)`,
          [
            rc.insertId, b.item_id, b.qty_bahan, b.satuan,
            b.harga_satuan, b.qty_bahan * b.harga_satuan,
          ],
        );
      }
    }

    /*
     * Farmasi TIDAK diberi tahu di sini. Resep yang disimpan masih draft
     * dokter; ia baru sampai di farmasi saat Finalkan Asesmen — notifikasi
     * "resep masuk" dikirim dari simpanAsesmen() di lib/doctor.ts.
     */
    return { prescriptionId, noResep };
  });
}

/** Membatalkan resep. Tidak menghapus baris — status berubah + alasan dicatat. */
export async function batalkanResep(
  visitId: number,
  siteId: number,
  alasan: string,
): Promise<void> {
  await transaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, status, stok_direservasi FROM prescriptions
        WHERE visit_id = ? AND site_id = ? AND status <> 'batal' FOR UPDATE`,
      [visitId, siteId],
    );
    if (!rows[0]) throw new Error("Tidak ada resep aktif pada kunjungan ini.");
    if (rows[0].status === "diserahkan") {
      throw new Error("Resep sudah diserahkan ke pasien dan tidak bisa dibatalkan.");
    }

    const prescriptionId = Number(rows[0].id);

    /*
     * Resep yang sudah divalidasi farmasi memegang KUNCI STOK dan sudah
     * menagih pasien. Keduanya harus ikut dibatalkan.
     *
     * Reservasi yang tidak dilepas menahan stok selamanya: barangnya ada di
     * rak, tetapi sistem menolak memakainya untuk pasien lain — dan tidak ada
     * satu pun layar yang menunjukkan sebabnya. Baris tagihan yang tertinggal
     * membuat pasien membayar obat yang tidak pernah ia terima.
     */
    if (Number(rows[0].stok_direservasi) === 1) {
      await lepasReservasiResep(conn, prescriptionId, siteId);
    }

    if (rows[0].status === "disiapkan") {
      const billingId = await pastikanTagihan(conn, visitId, siteId);
      await hapusBarisTagihanByRef(conn, billingId, "prescription_item");
      await hapusBarisTagihanByRef(conn, billingId, "prescription_racikan");
      await hapusBarisTagihanByRef(conn, billingId, "jasa_racik");
      await hitungUlangTagihan(conn, billingId);
      await conn.execute(
        `UPDATE billing_transactions SET status = 'draft'
          WHERE id = ? AND status = 'menunggu'`,
        [billingId],
      );
    }

    await conn.execute(
      `UPDATE prescriptions SET status = 'batal', stok_direservasi = 0, alasan_batal = ?
        WHERE id = ?`,
      [alasan, prescriptionId],
    );
  });
}
