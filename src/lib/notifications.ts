import "server-only";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { execute, limitAman, pool, query, queryOne } from "./db";
import type { RoleCode } from "./rbac";
import type { SessionUser } from "./session";

/**
 * Notifikasi dalam aplikasi.
 *
 * Dua bentuk sasaran, dan bedanya penting:
 *
 *   - **Perorangan** (`user_id`) — untuk hal yang menjadi tanggung jawab
 *     satu orang tertentu, mis. hasil lab yang dipesan seorang dokter.
 *   - **Peran di satu cabang** (`role_id` + `site_id`) — untuk antrean
 *     kerja yang siapa pun di peran itu boleh ambil, mis. resep masuk ke
 *     farmasi. Menujukannya ke satu orang justru berbahaya: bila orang itu
 *     sedang libur, tidak ada yang tahu ada resep menunggu.
 *
 * ATURAN PENTING: pengiriman notifikasi TIDAK BOLEH menggagalkan operasi
 * bisnisnya. Resep yang sudah tersimpan tidak boleh ikut batal hanya
 * karena baris notifikasi gagal ditulis. Karena itu `kirimNotifikasi()`
 * menelan galatnya sendiri dan mencatatnya ke console.
 */

export type JenisNotifikasi =
  // --- Estafet pelayanan pasien, berurutan sesuai CLAUDE.md §3.1 ---
  | "pasien_baru"       // Pendaftaran -> Perawat
  | "triase_selesai"    // Perawat     -> Dokter
  | "order_lab"         // Dokter      -> Petugas Lab
  | "hasil_lab"         // Petugas Lab -> Dokter
  | "hasil_lab_kritis"
  | "resep_masuk"       // Dokter      -> Farmasi
  | "resep_dikembalikan" // Farmasi    -> Dokter (estafet mundur, minta revisi)
  | "obat_siap"         // Farmasi     -> Kasir
  | "order_lab_batal"   // Petugas Lab -> Dokter (pemeriksaan tidak jadi)
  | "kunjungan_batal"   // Pendaftaran -> unit yang sedang menunggu pasien
  | "kunjungan_tertunda" // Sapuan harian -> Admin Cabang
  // --- Peringatan gudang ---
  | "stok_menipis"
  | "stok_habis"
  | "kadaluarsa"
  // --- Kepegawaian ---
  | "cuti_diajukan"
  | "cuti_diputuskan"
  | "tanpa_pengganti"
  // --- Kepatuhan & keuangan penjamin ---
  | "ikp_baru"          // Pelapor      -> Admin Cabang (KTD & sentinel saja)
  | "klaim_terlambat"   // Sapuan harian -> Admin Cabang
  | "pengembalian_dana"; // Lab membatalkan order yang sudah dibayar -> Admin Cabang

type Sasaran =
  | { userId: number }
  | { roleCode: RoleCode; siteId: number };

export type IsiNotifikasi = {
  jenis: JenisNotifikasi;
  judul: string;
  pesan?: string | null;
  /** Route tujuan saat notifikasi diklik. */
  link?: string | null;
  siteId?: number | null;
};

/**
 * Mengirim notifikasi. Aman dipanggil di dalam transaksi (teruskan `conn`)
 * maupun di luarnya.
 *
 * Bila dipanggil DI DALAM transaksi, notifikasi ikut ter-rollback bila
 * transaksinya gagal — itu memang yang diinginkan: jangan memberi tahu
 * farmasi ada resep masuk kalau resepnya sendiri batal tersimpan.
 *
 * Sebaliknya TIDAK berlaku: kegagalan notifikasi sendiri tidak pernah
 * membatalkan pekerjaan pemanggilnya. Lihat catatan di blok `catch`.
 */
/**
 * Memangkas teks agar muat di kolomnya.
 *
 * Judul notifikasi hampir selalu memuat nama pasien, dan `patients.nama`
 * sendiri menampung 150 karakter — sama dengan `notifications.judul`. Begitu
 * judulnya diberi awalan apa pun ("A001 — ", "CITO — "), nama yang panjang
 * membuatnya meluap. Dengan `sql_mode` ketat (bawaan MySQL 8) luapan itu
 * BUKAN pemotongan diam-diam melainkan galat `ER_DATA_TOO_LONG`.
 */
function pas(teks: string, maks: number): string {
  return teks.length <= maks ? teks : teks.slice(0, maks - 1) + "…";
}

export async function kirimNotifikasi(
  sasaran: Sasaran,
  isi: IsiNotifikasi,
  conn?: PoolConnection,
): Promise<void> {
  const sql = `
    INSERT INTO notifications (site_id, user_id, role_id, jenis, judul, pesan, link)
    VALUES (?, ?, ?, ?, ?, ?, ?)`;

  // Dipangkas di SATU tempat, bukan di tiap pemanggil: pemanggil berikutnya
  // pasti lupa, dan akibatnya bukan judul terpotong melainkan pendaftaran
  // pasien yang gagal.
  const judul = pas(isi.judul, 150);
  const pesan = isi.pesan == null ? null : pas(isi.pesan, 2000);
  const link = isi.link == null ? null : pas(isi.link, 255);

  try {
    if ("userId" in sasaran) {
      const params = [
        isi.siteId ?? null, sasaran.userId, null,
        isi.jenis, judul, pesan, link,
      ];
      if (conn) await conn.execute(sql, params);
      else await execute(sql, params);
      return;
    }

    // role_id dicari dari kodenya supaya pemanggil tidak perlu tahu id
    // numeriknya — kode peran itulah yang stabil di seluruh sistem.
    const cari = `SELECT id FROM roles WHERE code = ?`;
    const roleId = conn
      ? Number(
          (await conn.execute<RowDataPacket[]>(cari, [sasaran.roleCode]))[0][0]?.id,
        )
      : Number(
          (await queryOne<RowDataPacket & { id: number }>(cari, [sasaran.roleCode]))?.id,
        );
    if (!roleId) return;

    const params = [
      sasaran.siteId, null, roleId,
      isi.jenis, judul, pesan, link,
    ];
    if (conn) await conn.execute(sql, params);
    else await execute(sql, params);
  } catch (err) {
    /*
     * TIDAK PERNAH dilempar ulang — termasuk di dalam transaksi.
     *
     * Sebelumnya galat di dalam transaksi diteruskan, dan akibatnya sebuah
     * notifikasi yang gagal MEMBATALKAN pekerjaan klinis yang sudah sah:
     * pasien bernama panjang tidak bisa didaftarkan sama sekali, dengan
     * pesan galat yang tidak menyebut-nyebut notifikasi. Tidak ada
     * pemberitahuan yang lebih penting daripada pendaftarannya sendiri —
     * perawat toh tetap melihat pasien itu di papan antrean.
     *
     * Arah sebaliknya tetap terjaga tanpa perlu melempar: bila transaksi
     * pemanggil gagal, baris notifikasi yang sudah di-INSERT lewat `conn`
     * yang sama ikut ter-rollback. Jadi farmasi tetap tidak akan diberi
     * tahu soal resep yang batal tersimpan.
     *
     * Aman di MySQL: galat tingkat pernyataan tidak membatalkan transaksi
     * yang sedang berjalan, sehingga pemanggil bisa lanjut dan commit.
     */
    console.error("[notifikasi] gagal mengirim:", err);
  }
}

export type NotifikasiRow = RowDataPacket & {
  id: number;
  jenis: string;
  judul: string;
  pesan: string | null;
  link: string | null;
  is_read: number;
  created_at: string;
  /** 1 = ditujukan ke peran (bersama), 0 = perorangan. */
  untuk_peran: number;
  /** Cabang tempat peristiwanya terjadi — menentukan ke mana tautannya sah. */
  site_id: number | null;
  site_nama: string | null;
};

/**
 * Notifikasi untuk pengguna ini: miliknya sendiri, ditambah siaran untuk
 * perannya di cabang yang sedang aktif.
 *
 * Notifikasi PERORANGAN tidak disaring per cabang. Dokter yang ditugaskan di
 * beberapa cabang tetap harus melihat "pasien siap diperiksa" dari cabang
 * lain — kalau disaring ke cabang aktif saja, notifikasinya menghilang tanpa
 * jejak dan pasien menunggu tanpa ada yang tahu. Cabang asalnya ikut dibawa
 * (`site_id`) supaya membukanya bisa sekalian berpindah ke sana.
 *
 * Siaran ke peran tetap disaring per cabang: itu memang antrean kerja
 * bersama satu cabang.
 *
 * Super Admin tanpa cabang aktif hanya melihat notifikasi perorangannya —
 * menampilkan antrean kerja seluruh cabang justru mengubur yang penting.
 */
export async function notifikasiSaya(
  session: SessionUser,
  opts: { hanyaBelumDibaca?: boolean; limit?: number } = {},
): Promise<NotifikasiRow[]> {
  return query<NotifikasiRow>(
    `SELECT n.id, n.jenis, n.judul, n.pesan, n.link, n.is_read, n.created_at,
            (n.role_id IS NOT NULL) AS untuk_peran,
            n.site_id, s.nama AS site_nama
       FROM notifications n
       LEFT JOIN roles r ON r.id = n.role_id
       LEFT JOIN sites s ON s.id = n.site_id
      WHERE (
              n.user_id = ?
              OR (n.user_id IS NULL AND r.code = ? AND n.site_id = ?)
            )
        AND (? = 0 OR n.is_read = 0)
      ORDER BY n.is_read, n.id DESC
      LIMIT ${limitAman(opts.limit, 30, 100)}`,
    [session.id, session.role, session.siteId, opts.hanyaBelumDibaca ? 1 : 0],
  );
}

export async function hitungBelumDibaca(session: SessionUser): Promise<number> {
  const row = await queryOne<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n
       FROM notifications n
       LEFT JOIN roles r ON r.id = n.role_id
      WHERE n.is_read = 0
        AND (
              n.user_id = ?
              OR (n.user_id IS NULL AND r.code = ? AND n.site_id = ?)
            )`,
    [session.id, session.role, session.siteId],
  );
  return Number(row?.n ?? 0);
}

/**
 * Menandai satu notifikasi terbaca.
 *
 * Syarat kepemilikannya ikut di klausa WHERE, bukan dicek terpisah —
 * pengguna tidak boleh menandai notifikasi milik orang lain, dan
 * memeriksanya dalam satu perintah menghilangkan celah antara cek dan
 * tulis.
 */
export async function tandaiDibaca(
  id: number,
  session: SessionUser,
): Promise<boolean> {
  const res = await execute(
    `UPDATE notifications n
       LEFT JOIN roles r ON r.id = n.role_id
        SET n.is_read = 1
      WHERE n.id = ?
        AND (
              n.user_id = ?
              OR (n.user_id IS NULL AND r.code = ? AND n.site_id = ?)
            )`,
    [id, session.id, session.role, session.siteId],
  );
  return res.affectedRows > 0;
}

export async function tandaiSemuaDibaca(session: SessionUser): Promise<number> {
  const res = await execute(
    `UPDATE notifications n
       LEFT JOIN roles r ON r.id = n.role_id
        SET n.is_read = 1
      WHERE n.is_read = 0
        AND (
              n.user_id = ?
              OR (n.user_id IS NULL AND r.code = ? AND n.site_id = ?)
            )`,
    [session.id, session.role, session.siteId],
  );
  return res.affectedRows;
}

/**
 * Membuang notifikasi terbaca yang sudah lama.
 *
 * Tabel ini tumbuh terus tanpa batas alami; dipanggil dari layar
 * Pengaturan agar operator punya kendali, bukan lewat cron tersembunyi.
 */
export async function bersihkanNotifikasi(hariSimpan = 30): Promise<number> {
  const hari = limitAman(hariSimpan, 30, 365);
  const res = await execute(
    `DELETE FROM notifications
      WHERE is_read = 1 AND created_at < DATE_SUB(NOW(), INTERVAL ${hari} DAY)`,
  );
  return res.affectedRows;
}

// ---------------------------------------------------------------------
// Pemicu khusus — dipanggil dari modul terkait
// ---------------------------------------------------------------------

/**
 * Peringatan stok setelah pemotongan.
 *
 * Sengaja TIDAK dipanggil dari dalam `kurangiStok()`: fungsi itu berjalan
 * di dalam transaksi penyerahan resep, dan membanjiri antrean farmasi
 * dengan peringatan yang identik setiap kali satu tablet keluar tidak
 * membantu siapa pun. Pemanggilnya memutuskan kapan peringatan layak
 * dikirim — yaitu saat saldo BARU SAJA melewati ambang.
 */
export async function periksaAmbangStok(
  siteId: number,
  itemIds: number[],
): Promise<void> {
  if (itemIds.length === 0) return;

  try {
    const ids = itemIds
      .map((n) => Math.trunc(Number(n)))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 0) return;

    const kritis = await query<RowDataPacket & {
      id: number; nama: string; satuan_dasar: string; stok: string; min_stock: number;
    }>(
      /*
       * Ambang dihitung dari yang TERSEDIA, bukan yang ada di rak. Barang
       * yang sudah dikunci untuk resep pasien lain tidak bisa dipakai —
       * menghitungnya sebagai stok aman membuat peringatan datang terlambat,
       * tepat ketika stok sebenarnya sudah tidak bisa melayani siapa pun.
       */
      `SELECT i.id, i.nama, i.satuan_dasar, i.min_stock,
              GREATEST(0, s.qty_on_hand - s.qty_reserved) AS stok
         FROM item_stocks s JOIN items i ON i.id = s.item_id
        WHERE s.site_id = ? AND i.id IN (${ids.join(",")})
          AND (s.qty_on_hand - s.qty_reserved) <= i.min_stock`,
      [siteId],
    );

    for (const k of kritis) {
      const habis = Number(k.stok) <= 0;
      // Hindari notifikasi kembar: bila peringatan untuk item ini masih
      // ada dan belum dibaca, jangan tambah baris baru.
      const sudahAda = await queryOne<RowDataPacket & { id: number }>(
        `SELECT n.id FROM notifications n
           JOIN roles r ON r.id = n.role_id
          WHERE n.site_id = ? AND r.code = 'farmasi' AND n.is_read = 0
            AND n.jenis IN ('stok_menipis','stok_habis')
            AND n.link = ?
          LIMIT 1`,
        [siteId, `/farmasi/stok#item-${k.id}`],
      );
      if (sudahAda) continue;

      await kirimNotifikasi(
        { roleCode: "farmasi", siteId },
        {
          jenis: habis ? "stok_habis" : "stok_menipis",
          judul: habis ? `Stok habis: ${k.nama}` : `Stok menipis: ${k.nama}`,
          pesan: habis
            ? `Saldo gudang 0 ${k.satuan_dasar}. Resep yang memuat item ini tidak bisa diserahkan.`
            : `Sisa ${Number(k.stok)} ${k.satuan_dasar}, di bawah stok minimum ${k.min_stock}.`,
          link: `/farmasi/stok#item-${k.id}`,
          siteId,
        },
      );
    }
  } catch (err) {
    console.error("[notifikasi] gagal memeriksa ambang stok:", err);
  }
}

export type RingkasanTertunda = {
  siteId: number;
  siteNama: string;
  jumlah: number;
  hariTertua: number;
  terkirim: boolean;
};

/**
 * Sapuan harian kunjungan yang menggantung.
 *
 * ==========================================================================
 * KENAPA PERLU DISAPU, BUKAN CUKUP DITAMPILKAN.
 *
 * Kunjungan yang tertinggal semalam sekarang muncul di bagian "Tertunda dari
 * Hari Sebelumnya" pada layar Dokter, Perawat, dan Pendaftaran. Tetapi tidak
 * ada yang punya alasan membuka layar itu kalau ia tidak tahu ada yang perlu
 * dibereskan — dan justru kunjungan yang menggantung berminggu-minggu yang
 * paling tidak akan ditemukan siapa pun.
 *
 * Ditujukan ke ADMIN CABANG karena merekalah satu-satunya yang bisa
 * membatalkan kunjungan. Memberi tahu peran yang tidak bisa bertindak hanya
 * menambah bunyi.
 * ==========================================================================
 *
 * SATU notifikasi per cabang, berisi jumlah — bukan satu per kunjungan. Tiga
 * pemberitahuan terpisah untuk tiga kunjungan tertunda adalah tiga kali
 * gangguan untuk satu keputusan yang sama.
 *
 * Aman dijalankan berkali-kali: cabang yang sudah diberi tahu HARI INI
 * dilewati. Penjadwal tugas yang mengulang percobaan, atau admin yang
 * penasaran menjalankannya lagi, tidak boleh menghasilkan tumpukan
 * notifikasi yang sama.
 */
export async function sapuKunjunganTertunda(
  /** Umur minimum dalam hari. 1 = sejak kemarin, sama persis dengan isi
   *  daftar "Tertunda dari Hari Sebelumnya" di layar. */
  ambangHari = 1,
): Promise<RingkasanTertunda[]> {
  const hari = limitAman(ambangHari, 1, 365);

  const cabang = await query<RowDataPacket & {
    site_id: number; site_nama: string; jumlah: number; hari_tertua: number;
    sudah_dikirim: number;
  }>(
    `SELECT v.site_id, s.nama AS site_nama, COUNT(*) AS jumlah,
            MAX(DATEDIFF(CURDATE(), v.tanggal)) AS hari_tertua,
            EXISTS (
              SELECT 1 FROM notifications n
               WHERE n.site_id = v.site_id
                 AND n.jenis = 'kunjungan_tertunda'
                 AND DATE(n.created_at) = CURDATE()
            ) AS sudah_dikirim
       FROM visits v
       JOIN sites s ON s.id = v.site_id
      WHERE v.status NOT IN ('selesai','batal')
        AND v.tanggal <= DATE_SUB(CURDATE(), INTERVAL ${hari} DAY)
      GROUP BY v.site_id, s.nama
      ORDER BY s.nama`,
  );

  const hasil: RingkasanTertunda[] = [];

  for (const c of cabang) {
    const sudah = Number(c.sudah_dikirim) === 1;
    if (!sudah) {
      await kirimNotifikasi(
        { roleCode: "admin_cabang", siteId: Number(c.site_id) },
        {
          jenis: "kunjungan_tertunda",
          judul: `${Number(c.jumlah)} kunjungan tertunda belum dibereskan`,
          pesan:
            `Kunjungan tertua sudah ${Number(c.hari_tertua)} hari menggantung. ` +
            "Selesaikan pelayanannya atau batalkan kunjungannya di Pendaftaran — " +
            "selama dibiarkan, resep yang sudah divalidasi tetap mengunci stok.",
          link: "/pendaftaran",
          siteId: Number(c.site_id),
        },
      );
    }
    hasil.push({
      siteId: Number(c.site_id),
      siteNama: String(c.site_nama),
      jumlah: Number(c.jumlah),
      hariTertua: Number(c.hari_tertua),
      terkirim: !sudah,
    });
  }

  return hasil;
}

/** Dipakai skrip pemeliharaan / layar Pengaturan, bukan alur harian. */
export async function sapuNotifikasiKadaluarsa(
  siteId: number,
  ambangHari: number,
): Promise<number> {
  const hari = limitAman(ambangHari, 30, 365);
  const batch = await query<RowDataPacket & {
    item_id: number; nama: string; no_batch: string | null; sisa: number; qty: string;
  }>(
    `SELECT b.item_id, i.nama, b.no_batch, b.qty,
            DATEDIFF(b.tanggal_kadaluarsa, CURDATE()) AS sisa
       FROM item_batches b JOIN items i ON i.id = b.item_id
      WHERE b.site_id = ? AND b.qty > 0 AND b.tanggal_kadaluarsa IS NOT NULL
        AND DATEDIFF(b.tanggal_kadaluarsa, CURDATE()) <= ${hari}`,
    [siteId],
  );

  let terkirim = 0;
  for (const b of batch) {
    const lewat = Number(b.sisa) < 0;
    await kirimNotifikasi(
      { roleCode: "farmasi", siteId },
      {
        jenis: "kadaluarsa",
        judul: lewat
          ? `Kadaluarsa: ${b.nama}`
          : `${b.nama} kadaluarsa ${Number(b.sisa)} hari lagi`,
        pesan: `Batch ${b.no_batch ?? "tanpa nomor"}, ${Number(b.qty)} unit.`,
        link: "/farmasi/kadaluarsa",
        siteId,
      },
    );
    terkirim++;
  }
  return terkirim;
}

/** Ditutup di akhir skrip pemeliharaan. */
export { pool as poolNotifikasi };
