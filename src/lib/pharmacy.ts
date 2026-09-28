import "server-only";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { query, queryOne, transaction, limitAman } from "./db";
import { StokTidakCukupError, kurangiStok, lepasReservasi, reservasiStok } from "./stock";
import { itemResep, kunciKunjungan, kunciStok, visitIdDariResep } from "./kunci";
import { kirimNotifikasi, periksaAmbangStok } from "./notifications";
import { formatDesimal } from "./format";
import {
  hapusBarisTagihanByRef,
  hitungUlangTagihan,
  pastikanTagihan,
  tambahBarisTagihan,
} from "./billing";

const REF_OBAT = "prescription_item";
const REF_RACIKAN = "prescription_racikan";
const REF_JASA_RACIK = "jasa_racik";

export type ResepMasuk = RowDataPacket & {
  id: number;
  no_resep: string;
  status: string;
  created_at: string;
  catatan_umum: string | null;
  visit_id: number;
  antrean: string | null;
  no_rm: string;
  nama: string;
  tanggal_lahir: string;
  jenis_kelamin: "L" | "P";
  alergi: string | null;
  dokter_nama: string;
  jumlah_paten: number;
  jumlah_racikan: number;
  /** Jumlah baris (paten + bahan racikan) yang stoknya kurang. */
  stok_kurang: number;
  /** Status tagihan kunjungan — menentukan resep boleh diserahkan atau belum. */
  status_tagihan: string | null;
};

const SELECT_RESEP = `
  SELECT rx.id, rx.no_resep, rx.status, rx.created_at, rx.catatan_umum,
         v.id AS visit_id,
         CONCAT(q.prefix, LPAD(q.nomor, 3, '0')) AS antrean,
         p.no_rm, p.nama, p.tanggal_lahir, p.jenis_kelamin,
         (SELECT GROUP_CONCAT(a.nama_alergen SEPARATOR ', ')
            FROM patient_allergies a
           WHERE a.patient_id = p.id AND a.is_active = 1) AS alergi,
         d.nama AS dokter_nama,
         (SELECT bt.status FROM billing_transactions bt WHERE bt.visit_id = v.id) AS status_tagihan,
         (SELECT COUNT(*) FROM prescription_items pi WHERE pi.prescription_id = rx.id) AS jumlah_paten,
         (SELECT COUNT(*) FROM prescription_racikans pr WHERE pr.prescription_id = rx.id) AS jumlah_racikan,
         -- Stok TERSEDIA bagi resep ini, bukan saldo fisik rak. Rumusnya sama
         -- persis dengan itemPaten()/racikanResep(): kunci milik resep LAIN
         -- dikurangkan, kunci miliknya sendiri ditambahkan kembali. Memakai
         -- qty_on_hand polos membuat lencana berbohong ke dua arah sekaligus —
         -- berkata "cukup" untuk barang yang sudah dijanjikan ke pasien lain
         -- sehingga validasi gagal mendadak, dan berkata "kurang" pada resep
         -- yang justru sudah mengamankan stoknya sendiri.
         (
           (SELECT COUNT(*) FROM prescription_items pi
              LEFT JOIN item_stocks s ON s.item_id = pi.item_id AND s.site_id = rx.site_id
             WHERE pi.prescription_id = rx.id
               AND GREATEST(0, COALESCE(s.qty_on_hand,0) - COALESCE(s.qty_reserved,0)
                               + IF(rx.stok_direservasi = 1, pi.qty, 0)) < pi.qty)
           +
           (SELECT COUNT(*) FROM prescription_racikan_ingredients ri
              JOIN prescription_racikans pr ON pr.id = ri.racikan_id
              LEFT JOIN item_stocks s ON s.item_id = ri.item_id AND s.site_id = rx.site_id
             WHERE pr.prescription_id = rx.id
               AND GREATEST(0, COALESCE(s.qty_on_hand,0) - COALESCE(s.qty_reserved,0)
                               + IF(rx.stok_direservasi = 1, ri.qty_bahan, 0)) < ri.qty_bahan)
         ) AS stok_kurang
    FROM prescriptions rx
    JOIN visits v   ON v.id = rx.visit_id
    JOIN patients p ON p.id = v.patient_id
    JOIN users d    ON d.id = rx.doctor_id
    LEFT JOIN queues q ON q.visit_id = v.id
`;

/** Resep yang menunggu disiapkan / diserahkan. */
export async function resepMasuk(siteId: number | null): Promise<ResepMasuk[]> {
  return query<ResepMasuk>(
    /* Resep `baru` baru sampai di farmasi setelah dokter menekan Finalkan
       Asesmen (kunjungan `menunggu_farmasi`). Sebelum itu ia masih draft
       dokter — asesmen, diagnosa, dan tindakannya belum lengkap. */
    `${SELECT_RESEP}
      WHERE (rx.status IN ('diterima_farmasi','disiapkan')
             OR (rx.status = 'baru' AND v.status = 'menunggu_farmasi'))
        AND (? IS NULL OR rx.site_id = ?)
      ORDER BY rx.created_at`,
    [siteId, siteId],
  );
}

export async function resepSelesaiHariIni(siteId: number | null): Promise<ResepMasuk[]> {
  return query<ResepMasuk>(
    `${SELECT_RESEP}
      WHERE rx.status = 'diserahkan'
        AND DATE(rx.dispensed_at) = CURDATE()
        AND (? IS NULL OR rx.site_id = ?)
      ORDER BY rx.dispensed_at DESC`,
    [siteId, siteId],
  );
}

export async function getResepFarmasi(
  prescriptionId: number,
  siteId: number | null,
): Promise<(ResepMasuk & { site_id: number; nik: string }) | null> {
  return queryOne<ResepMasuk & { site_id: number; nik: string }>(
    `${SELECT_RESEP.replace(
      "rx.catatan_umum,",
      "rx.catatan_umum, rx.site_id, p.nik,",
    )}
      WHERE rx.id = ? AND (? IS NULL OR rx.site_id = ?)`,
    [prescriptionId, siteId, siteId],
  );
}

export type BarisPaten = RowDataPacket & {
  id: number;
  item_id: number;
  nama: string;
  qty: string;
  satuan: string;
  aturan_pakai: string;
  catatan: string | null;
  harga_satuan: string;
  stok: string;
  stock_movement_id: number | null;
};

export async function itemPaten(prescriptionId: number): Promise<BarisPaten[]> {
  return query<BarisPaten>(
    /*
     * Stok tersedia BAGI RESEP INI — reservasi miliknya sendiri ditambahkan
     * kembali. Tanpa itu, resep yang sudah divalidasi dan mengunci seluruh
     * sisa stok akan tampil "stok kurang" di layarnya sendiri, padahal
     * barangnya justru sudah diamankan untuknya.
     */
    `SELECT pi.id, pi.item_id, i.nama, pi.qty, pi.satuan, pi.aturan_pakai,
            pi.catatan, pi.harga_satuan, pi.stock_movement_id,
            GREATEST(0, COALESCE(s.qty_on_hand, 0) - COALESCE(s.qty_reserved, 0)
                        + IF(rx.stok_direservasi = 1, pi.qty, 0)) AS stok
       FROM prescription_items pi
       JOIN prescriptions rx ON rx.id = pi.prescription_id
       JOIN items i ON i.id = pi.item_id
       LEFT JOIN item_stocks s ON s.item_id = pi.item_id AND s.site_id = rx.site_id
      WHERE pi.prescription_id = ?
      ORDER BY pi.urutan, pi.id`,
    [prescriptionId],
  );
}

export type BarisRacikan = {
  id: number;
  nama_racikan: string;
  bentuk_sediaan: string;
  qty_jadi: string;
  satuan_jadi: string;
  aturan_pakai: string;
  biaya_jasa_racik: string;
  catatan: string | null;
  is_disiapkan: number;
  ingredients: {
    id: number;
    item_id: number;
    nama: string;
    qty_bahan: string;
    satuan: string;
    harga_satuan: string;
    stok: string;
    stock_movement_id: number | null;
  }[];
};

export async function racikanResep(prescriptionId: number): Promise<BarisRacikan[]> {
  const header = await query<RowDataPacket & Omit<BarisRacikan, "ingredients">>(
    `SELECT id, nama_racikan, bentuk_sediaan, qty_jadi, satuan_jadi,
            aturan_pakai, biaya_jasa_racik, catatan, is_disiapkan
       FROM prescription_racikans
      WHERE prescription_id = ?
      ORDER BY urutan, id`,
    [prescriptionId],
  );
  if (header.length === 0) return [];

  const bahan = await query<RowDataPacket & {
    racikan_id: number; id: number; item_id: number; nama: string;
    qty_bahan: string; satuan: string; harga_satuan: string; stok: string;
    stock_movement_id: number | null;
  }>(
    /* Sama seperti `itemPaten()`: reservasi milik resep ini sendiri
       ditambahkan kembali supaya tidak tampil sebagai kekurangan. */
    `SELECT ri.racikan_id, ri.id, ri.item_id, i.nama, ri.qty_bahan, ri.satuan,
            ri.harga_satuan, ri.stock_movement_id,
            GREATEST(0, COALESCE(s.qty_on_hand, 0) - COALESCE(s.qty_reserved, 0)
                        + IF(rx.stok_direservasi = 1, ri.qty_bahan, 0)) AS stok
       FROM prescription_racikan_ingredients ri
       JOIN prescription_racikans pr ON pr.id = ri.racikan_id
       JOIN prescriptions rx ON rx.id = pr.prescription_id
       JOIN items i ON i.id = ri.item_id
       LEFT JOIN item_stocks s ON s.item_id = ri.item_id AND s.site_id = rx.site_id
      WHERE pr.prescription_id = ?
      ORDER BY ri.id`,
    [prescriptionId],
  );

  return header.map((h) => ({
    ...h,
    ingredients: bahan.filter((b) => b.racikan_id === h.id),
  }));
}

/**
 * Resep hanya boleh diterima/divalidasi saat kunjungan ada di tahap farmasi,
 * yaitu setelah dokter menekan Finalkan Asesmen (§3.1: tombol kirim ke
 * farmasi ADALAH Finalkan Asesmen). Tanpa penjaga ini farmasi bisa
 * memproses resep yang masih draft — pasien lalu dilempar ke kasir sebelum
 * diagnosa dan tindakannya tercatat, dan dokter terkunci dari kunjungannya.
 * Hal yang sama berlaku saat hasil lab DITUNGGU mengembalikan kunjungan ke
 * dokter: hasilnya wajib dinilai dokter dulu.
 */
function pastikanDiTahapFarmasi(statusKunjungan: string): void {
  if (statusKunjungan === "menunggu_farmasi") return;
  throw new Error(
    ["terdaftar", "menunggu_perawat", "menunggu_dokter", "dalam_pemeriksaan", "menunggu_lab"]
      .includes(statusKunjungan)
      ? "Resep belum dikirim dokter — tunggu sampai dokter menekan Finalkan Asesmen."
      : "Kunjungan ini tidak sedang di tahap farmasi.",
  );
}

/**
 * Farmasi menerima resep. Sejak titik ini dokter tidak bisa mengubahnya —
 * obat mungkin sudah mulai disiapkan.
 */
export async function terimaResep(
  prescriptionId: number,
  siteId: number,
  userId: number,
): Promise<void> {
  await transaction(async (conn) => {
    // Kunjungan dikunci lebih dulu — urutan yang sama dengan simpanResep()
    // dan validasiResep() (lib/kunci.ts), sehingga dokter tidak bisa
    // menulis ulang resep di sela pemeriksaan status di bawah.
    const kunjunganId = await visitIdDariResep(conn, prescriptionId);
    if (kunjunganId) await kunciKunjungan(conn, kunjunganId);

    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT rx.id, rx.status, v.status AS visit_status
         FROM prescriptions rx JOIN visits v ON v.id = rx.visit_id
        WHERE rx.id = ? AND rx.site_id = ? FOR UPDATE`,
      [prescriptionId, siteId],
    );
    if (!rows[0]) throw new Error("Resep tidak ditemukan.");
    if (rows[0].status !== "baru") {
      throw new Error("Resep ini sudah diterima sebelumnya.");
    }
    pastikanDiTahapFarmasi(String(rows[0].visit_status));
    await conn.execute(
      `UPDATE prescriptions
          SET status = 'diterima_farmasi', received_by = ?, received_at = NOW()
        WHERE id = ?`,
      [userId, prescriptionId],
    );
  });
}

/**
 * Melepas SELURUH kunci stok milik satu resep.
 *
 * Dipakai saat resep dikembalikan ke dokter atau dibatalkan — dua jalur yang
 * sama-sama berarti obatnya tidak jadi diserahkan. Reservasi yang tidak
 * dilepas akan menahan stok selamanya: barangnya ada di rak tetapi sistem
 * menolak memakainya untuk pasien lain, dan tidak ada layar yang
 * menunjukkan sebabnya.
 *
 * Harus dipanggil di dalam transaksi.
 */
export async function lepasReservasiResep(
  conn: PoolConnection,
  prescriptionId: number,
  siteId: number,
): Promise<void> {
  const [paten] = await conn.execute<RowDataPacket[]>(
    `SELECT item_id, qty FROM prescription_items WHERE prescription_id = ?`,
    [prescriptionId],
  );
  for (const p of paten) {
    await lepasReservasi(conn, {
      siteId, itemId: Number(p.item_id), qty: Number(p.qty),
    });
  }

  const [bahan] = await conn.execute<RowDataPacket[]>(
    `SELECT ri.item_id, ri.qty_bahan
       FROM prescription_racikan_ingredients ri
       JOIN prescription_racikans pr ON pr.id = ri.racikan_id
      WHERE pr.prescription_id = ?`,
    [prescriptionId],
  );
  for (const b of bahan) {
    await lepasReservasi(conn, {
      siteId, itemId: Number(b.item_id), qty: Number(b.qty_bahan),
    });
  }
}

/**
 * Mengembalikan resep yang sudah diklaim farmasi kepada dokter.
 *
 * ==========================================================================
 * HANYA DARI TAHAP VERIFIKASI (`diterima_farmasi`).
 *
 * Di sinilah pengembalian memang seharusnya terjadi: apoteker membaca resep,
 * menemukan kekeliruan — dosis salah, obat tidak sesuai indikasi, bentuk
 * sediaan keliru — dan memantulkannya balik SEBELUM apa pun terjadi. Belum
 * ada stok yang dikunci, belum ada baris tagihan, dan pasien belum dikirim
 * ke kasir.
 *
 * Resep yang sudah DIVALIDASI tidak dikembalikan langsung. Ia turun satu
 * anak tangga dulu lewat `batalkanValidasiResep()`, yang melepas kunci stok
 * dan membersihkan tagihannya. Setiap turunan adalah kebalikan persis dari
 * naiknya — satu operasi yang membatalkan dua langkah sekaligus adalah cara
 * paling mudah meninggalkan setengah keadaan yang tidak konsisten.
 * ==========================================================================
 *
 * AMAN karena `terimaResep` tidak menyentuh stok sama sekali — pemotongan
 * baru terjadi di `serahkanResep`. Jadi pengembalian ini murni perubahan
 * status: tidak ada saldo gudang yang perlu dikoreksi dan tidak ada baris
 * kartu stok yang perlu dibalik. Begitu resep berstatus `diserahkan`,
 * pengembalian DITOLAK — stok sudah keluar dan tagihan sudah terbentuk,
 * sehingga membalikkannya diam-diam justru merusak keduanya.
 *
 * Status kunjungan ikut dikembalikan ke `dalam_pemeriksaan`. Tanpa itu,
 * dokter membuka rekam medisnya dan menemukan seluruh form terkunci —
 * resepnya boleh diubah, tetapi layarnya tidak mengizinkan. Pengembalian
 * yang tidak bisa ditindaklanjuti sama saja dengan tidak ada.
 */
export async function batalkanTerimaResep(
  prescriptionId: number,
  siteId: number,
  /** Nama petugas farmasi — ikut disebut di notifikasi ke dokter. */
  dikembalikanOleh: string,
  alasan: string,
): Promise<{ noResep: string; pasien: string; visitId: number }> {
  return transaction(async (conn) => {
    /*
     * Kunjungan dikunci LEBIH DULU — lihat `lib/kunci.ts`.
     *
     * Transaksi ini menulis `visits`, sementara `simpanResep` mengunci
     * `visits` dahulu lalu meminta resepnya. Tanpa baris di bawah keduanya
     * membentuk siklus, dan MySQL melempar deadlock — sudah terbukti.
     */
    const kunjunganId = await visitIdDariResep(conn, prescriptionId);
    if (kunjunganId) await kunciKunjungan(conn, kunjunganId);

    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT rx.id, rx.status, rx.no_resep, rx.visit_id, rx.doctor_id,
              rx.stok_direservasi,
              v.status AS visit_status, v.substitute_doctor_id,
              bt.status AS billing_status,
              p.nama, p.no_rm
         FROM prescriptions rx
         JOIN visits v   ON v.id = rx.visit_id
         JOIN patients p ON p.id = v.patient_id
         LEFT JOIN billing_transactions bt ON bt.visit_id = rx.visit_id
        WHERE rx.id = ? AND rx.site_id = ?
        FOR UPDATE`,
      [prescriptionId, siteId],
    );
    const rx = rows[0];
    if (!rx) throw new Error("Resep tidak ditemukan.");

    if (rx.status === "diserahkan") {
      throw new Error(
        "Resep ini sudah diserahkan — stok sudah terpotong dan biayanya sudah masuk tagihan. " +
        "Perbaikan harus lewat retur obat, bukan pembatalan klaim.",
      );
    }
    if (rx.status === "batal") throw new Error("Resep ini sudah dibatalkan.");
    if (rx.status === "baru") {
      throw new Error("Resep ini belum diklaim, jadi tidak ada yang perlu dikembalikan.");
    }
    /*
     * Resep yang sudah DIVALIDASI turun satu anak tangga dulu.
     *
     * Pada tahap itu stok sudah dikunci, tagihan sudah terbentuk, dan pasien
     * sudah didorong ke kasir. Membatalkan ketiganya sekaligus dalam satu
     * operasi yang sama dengan pengembalian sederhana adalah cara paling
     * mudah meninggalkan setengah keadaan yang tidak konsisten — dan itulah
     * yang pernah terjadi: pasien tertinggal di antrean kasir dengan tagihan
     * yang baris obatnya sudah lenyap.
     */
    if (rx.status === "disiapkan") {
      throw new Error(
        "Resep ini sudah divalidasi — stoknya terkunci dan tagihannya sudah terbentuk. " +
        "Tekan “Batalkan Validasi” dulu untuk melepasnya, baru resepnya bisa " +
        "dikembalikan ke dokter.",
      );
    }

    await conn.execute(
      `UPDATE prescriptions
          SET status = 'baru', received_by = NULL, received_at = NULL
        WHERE id = ?`,
      [prescriptionId],
    );

    /*
     * Pasien ditarik kembali ke dokter. Yang sampai di sini pasti berstatus
     * `menunggu_farmasi` — resep `disiapkan` sudah ditolak di atas, dan resep
     * `baru` tidak bisa dikembalikan.
     *
     * Bila pasien masih tertahan di lab (`menunggu_lab`), statusnya
     * dibiarkan: memaksanya ke `dalam_pemeriksaan` akan menghilangkan pasien
     * dari antrean lab yang belum selesai.
     */
    if (rx.visit_status === "menunggu_farmasi") {
      await conn.execute(`UPDATE visits SET status = 'dalam_pemeriksaan' WHERE id = ?`, [
        rx.visit_id,
      ]);
    }

    // Dokter yang benar-benar menangani — termasuk bila ia dokter pengganti.
    const dokterId = Number(rx.substitute_doctor_id ?? rx.doctor_id);
    await kirimNotifikasi(
      { userId: dokterId },
      {
        jenis: "resep_dikembalikan",
        judul: `Resep dikembalikan — ${String(rx.nama)}`,
        pesan:
          `${String(rx.no_resep)} · No. RM ${String(rx.no_rm)} — ` +
          `dikembalikan ${dikembalikanOleh}: ${alasan}`,
        link: `/rme/${rx.visit_id}`,
        siteId,
      },
      conn,
    );

    return {
      noResep: String(rx.no_resep),
      pasien: String(rx.nama),
      visitId: Number(rx.visit_id),
    };
  });
}

/**
 * MEMBATALKAN VALIDASI — kebalikan persis dari `validasiResep()`.
 *
 * Satu anak tangga turun: `disiapkan` kembali ke `diterima_farmasi`. Kunci
 * stok dilepas, baris obat/racikan/jasa racik dikeluarkan dari tagihan, dan
 * pasien ditarik pulang dari antrean kasir.
 *
 * Dipakai ketika apoteker baru menyadari ada yang keliru SESUDAH memvalidasi
 * — harga salah, obat kosong padahal sistem bilang ada, atau dokter menelepon
 * minta revisi. Tanpa jalan ini satu-satunya pilihan adalah membatalkan resep
 * seluruhnya dan menerbitkan resep baru, membuang nomor resepnya.
 *
 * Ditolak bila pasien SUDAH MEMBAYAR: menghapus baris obat dari tagihan lunas
 * berarti menurunkan angka pada struk yang uangnya sudah diterima. Yang harus
 * dibatalkan lebih dulu adalah pembayarannya, di kasir.
 */
export async function batalkanValidasiResep(
  prescriptionId: number,
  siteId: number,
): Promise<{ noResep: string; visitId: number }> {
  return transaction(async (conn) => {
    /*
     * Kunjungan dikunci LEBIH DULU — lihat `lib/kunci.ts`.
     *
     * Transaksi ini menulis `visits`, sementara `simpanResep` mengunci
     * `visits` dahulu lalu meminta resepnya. Tanpa baris di bawah keduanya
     * membentuk siklus, dan MySQL melempar deadlock — sudah terbukti.
     */
    const kunjunganId = await visitIdDariResep(conn, prescriptionId);
    if (kunjunganId) await kunciKunjungan(conn, kunjunganId);

    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT rx.id, rx.status, rx.no_resep, rx.visit_id, rx.stok_direservasi,
              v.status AS visit_status, bt.status AS billing_status
         FROM prescriptions rx
         JOIN visits v ON v.id = rx.visit_id
         LEFT JOIN billing_transactions bt ON bt.visit_id = rx.visit_id
        WHERE rx.id = ? AND rx.site_id = ?
        FOR UPDATE`,
      [prescriptionId, siteId],
    );
    const rx = rows[0];
    if (!rx) throw new Error("Resep tidak ditemukan.");
    if (rx.status === "diserahkan") {
      throw new Error(
        "Resep ini sudah diserahkan — stoknya sudah keluar gudang. " +
        "Perbaikan harus lewat retur obat.",
      );
    }
    if (rx.status !== "disiapkan") {
      throw new Error("Resep ini belum divalidasi, jadi tidak ada yang perlu dibatalkan.");
    }
    if (rx.billing_status === "lunas") {
      throw new Error(
        "Pasien sudah membayar resep ini. Batalkan pembayarannya di kasir lebih " +
        "dulu — membongkar tagihan yang sudah lunas akan membuat struk dan " +
        "uang yang diterima tidak lagi cocok.",
      );
    }

    const visitId = Number(rx.visit_id);

    if (Number(rx.stok_direservasi) === 1) {
      await lepasReservasiResep(conn, prescriptionId, siteId);
    }

    const billingId = await pastikanTagihan(conn, visitId, siteId);
    await hapusBarisTagihanByRef(conn, billingId, REF_OBAT);
    await hapusBarisTagihanByRef(conn, billingId, REF_RACIKAN);
    await hapusBarisTagihanByRef(conn, billingId, REF_JASA_RACIK);
    await hitungUlangTagihan(conn, billingId);
    // Tagihannya bisa bertambah lagi → statusnya turun kembali ke draft.
    await conn.execute(
      `UPDATE billing_transactions SET status = 'draft'
        WHERE id = ? AND status = 'menunggu'`,
      [billingId],
    );

    await conn.execute(
      `UPDATE prescriptions SET status = 'diterima_farmasi', stok_direservasi = 0
        WHERE id = ?`,
      [prescriptionId],
    );

    /*
     * Pasien ditarik pulang dari antrean kasir — tagihannya belum final lagi.
     * Kalau masih di lab, statusnya dibiarkan: menariknya ke farmasi akan
     * menghilangkannya dari antrean lab yang belum selesai.
     */
    if (rx.visit_status === "menunggu_kasir") {
      await conn.execute(
        `UPDATE visits SET status = 'menunggu_farmasi' WHERE id = ?`,
        [visitId],
      );
    }

    return { noResep: String(rx.no_resep), visitId };
  });
}

/**
 * VALIDASI resep — tahap pertama farmasi, sebelum pasien membayar.
 *
 * Yang dikerjakan di sini:
 *   - memastikan stok benar-benar ada, lalu MENGUNCINYA (reservasi)
 *   - mengunci harga: obat paten, nilai bahan racikan, dan jasa racik
 *   - mendorong pasien ke kasir
 *
 * Yang TIDAK dikerjakan: memotong stok. Obatnya masih di rak — pasien belum
 * membayar dan belum menerimanya. `kurangiStok()` baru jalan di
 * `serahkanResep()`.
 *
 * Reservasi itulah inti alur bayar-dulu. Tanpanya, stok yang sudah ditagihkan
 * bisa habis terpakai resep berikutnya sementara pasien mengantre di kasir —
 * dan uang yang sudah diterima harus dikembalikan.
 */
export async function validasiResep(
  prescriptionId: number,
  siteId: number,
  userId: number,
): Promise<{ totalObat: number; totalRacikan: number; totalJasaRacik: number }> {
  return transaction(async (conn) => {
    /*
     * Kunjungan dikunci LEBIH DULU — lihat `lib/kunci.ts`.
     *
     * Transaksi ini menulis `visits`, sementara `simpanResep` mengunci
     * `visits` dahulu lalu meminta resepnya. Tanpa baris di bawah keduanya
     * membentuk siklus, dan MySQL melempar deadlock — sudah terbukti.
     */
    const kunjunganId = await visitIdDariResep(conn, prescriptionId);
    if (kunjunganId) await kunciKunjungan(conn, kunjunganId);

    const [rxRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, visit_id, status, stok_direservasi FROM prescriptions
        WHERE id = ? AND site_id = ? FOR UPDATE`,
      [prescriptionId, siteId],
    );
    const rx = rxRows[0];
    if (!rx) throw new Error("Resep tidak ditemukan.");
    if (rx.status === "diserahkan") throw new Error("Resep ini sudah diserahkan.");
    if (rx.status === "batal") throw new Error("Resep ini sudah dibatalkan dokter.");
    if (rx.status === "disiapkan") {
      throw new Error("Resep ini sudah divalidasi dan menunggu pembayaran.");
    }
    if (rx.status === "baru") {
      throw new Error("Terima resep terlebih dahulu sebelum memvalidasinya.");
    }

    const visitId = Number(rx.visit_id);

    /*
     * VALIDASI DITUNDA selama dokter masih menunggu hasil lab.
     *
     * Validasi mengunci stok dan mengunci harga. Keduanya sia-sia — bahkan
     * merugikan — bila resepnya masih mungkin berubah: hasil lab yang keluar
     * bisa membuat dokter mengganti antibiotiknya, menambah obat, atau
     * membatalkan salah satunya. Stok yang dikunci untuk resep yang belum
     * pasti persis kebalikan dari maksud reservasi, yang ada untuk menjamin
     * obat yang SUDAH ditagihkan.
     *
     * Sama seperti penjaga finalisasi di `simpanAsesmen()`, hanya order
     * `ditunggu` yang menahan. Order `menyusul` tidak: hasilnya memang tidak
     * dipakai untuk keputusan hari ini.
     */
    const [labDitunggu] = await conn.execute<RowDataPacket[]>(
      `SELECT no_order FROM lab_orders
        WHERE visit_id = ? AND status IN ('baru','diproses')
          AND sifat_hasil = 'ditunggu' LIMIT 1`,
      [visitId],
    );
    if (labDitunggu[0]) {
      throw new Error(
        `Dokter masih menunggu hasil ${String(labDitunggu[0].no_order)}. ` +
        "Resep belum boleh dikunci — hasilnya bisa mengubah obat yang diresepkan. " +
        "Tunggu sampai dokter memfinalkan asesmennya.",
      );
    }

    // Sesudah pemeriksaan lab di atas: pesan "menunggu hasil LAB-…" lebih
    // berguna bagi apoteker daripada pesan tahap yang umum.
    const [vRows] = await conn.execute<RowDataPacket[]>(
      `SELECT status FROM visits WHERE id = ?`,
      [visitId],
    );
    pastikanDiTahapFarmasi(String(vRows[0]?.status ?? ""));
    const billingId = await pastikanTagihan(conn, visitId, siteId);

    /*
     * Seluruh kunci stok diambil di sini, dalam urutan `item_id` yang pasti
     * — lihat `kunciStok()` di `lib/kunci.ts`. Loop di bawah tetap menyusuri
     * item menurut urutan yang diketik dokter, karena struk, etiket, dan
     * baris tagihan mengikuti urutan itu; yang diseragamkan hanya urutan
     * pengambilan kuncinya.
     */
    await kunciStok(conn, siteId, await itemResep(conn, prescriptionId));

    // Bersihkan baris lama supaya validasi ulang tidak menumpuk ganda.
    await hapusBarisTagihanByRef(conn, billingId, REF_OBAT);
    await hapusBarisTagihanByRef(conn, billingId, REF_RACIKAN);
    await hapusBarisTagihanByRef(conn, billingId, REF_JASA_RACIK);

    let totalObat = 0;
    let totalRacikan = 0;
    let totalJasaRacik = 0;

    // ---------- Obat paten ----------
    const [paten] = await conn.execute<RowDataPacket[]>(
      `SELECT pi.id, pi.item_id, pi.qty, pi.harga_satuan, i.nama
         FROM prescription_items pi JOIN items i ON i.id = pi.item_id
        WHERE pi.prescription_id = ?
        ORDER BY pi.urutan, pi.id`,
      [prescriptionId],
    );

    for (const p of paten) {
      const qty = Number(p.qty);
      const harga = Number(p.harga_satuan);

      await reservasiStok(conn, { siteId, itemId: Number(p.item_id), qty });

      await tambahBarisTagihan(conn, {
        billingId,
        kategori: "obat",
        deskripsi: String(p.nama),
        qty,
        hargaSatuan: harga,
        refType: REF_OBAT,
        refId: Number(p.id),
      });

      totalObat += qty * harga;
    }

    // ---------- Racikan ----------
    const [racikans] = await conn.execute<RowDataPacket[]>(
      `SELECT id, nama_racikan, qty_jadi, satuan_jadi, biaya_jasa_racik
         FROM prescription_racikans
        WHERE prescription_id = ?
        ORDER BY urutan, id`,
      [prescriptionId],
    );

    for (const r of racikans) {
      const [bahan] = await conn.execute<RowDataPacket[]>(
        `SELECT ri.id, ri.item_id, ri.qty_bahan, ri.harga_satuan, i.nama
           FROM prescription_racikan_ingredients ri JOIN items i ON i.id = ri.item_id
          WHERE ri.racikan_id = ?
          ORDER BY ri.id`,
        [r.id],
      );

      let nilaiBahan = 0;
      for (const b of bahan) {
        const qty = Number(b.qty_bahan);
        // Bahan mentah dikunci dari gudang yang sama dengan obat jadi —
        // tablet yang digerus tetap keluar dari saldo tablet itu.
        await reservasiStok(conn, { siteId, itemId: Number(b.item_id), qty });
        nilaiBahan += qty * Number(b.harga_satuan);
      }

      // Nilai bahan jadi satu baris tagihan atas nama racikannya — pasien
      // melihat "Puyer Batuk Anak", bukan daftar tablet penyusunnya.
      if (nilaiBahan > 0) {
        await tambahBarisTagihan(conn, {
          billingId,
          kategori: "racikan",
          deskripsi: `${String(r.nama_racikan)} (${formatDesimal(r.qty_jadi as string)} ${String(r.satuan_jadi)})`,
          qty: 1,
          hargaSatuan: nilaiBahan,
          refType: REF_RACIKAN,
          refId: Number(r.id),
        });
      }

      // Jasa racik SELALU baris tersendiri (CLAUDE.md §4) — bukan dilebur ke
      // harga bahan, supaya pendapatan jasa apoteker bisa ditarik langsung.
      const jasa = Number(r.biaya_jasa_racik);
      if (jasa > 0) {
        await tambahBarisTagihan(conn, {
          billingId,
          kategori: "jasa_racik",
          deskripsi: `Jasa racik — ${String(r.nama_racikan)}`,
          qty: 1,
          hargaSatuan: jasa,
          refType: REF_JASA_RACIK,
          refId: Number(r.id),
        });
        totalJasaRacik += jasa;
      }

      totalRacikan += nilaiBahan;
    }

    await hitungUlangTagihan(conn, billingId);

    await conn.execute(
      `UPDATE prescriptions SET status = 'disiapkan', stok_direservasi = 1 WHERE id = ?`,
      [prescriptionId],
    );
    void userId;

    /*
     * Order lab yang belum selesai menahan pasien di tahap lab: tagihannya
     * belum final karena panel yang berjalan masih akan menambah baris.
     * Menagih sekarang berarti pasien membayar, lalu hasil lab masuk dan
     * tagihannya berubah setelah struk tercetak.
     */
    /* Hanya order DITUNGGU yang menahan pasien — sama dengan doctor.ts dan
       lab.ts:statusSetelahLab. Order `menyusul` (mis. kultur 5 hari, APS)
       tidak boleh membuat pasien tidak bisa membayar dan mengambil obat. */
    const [labAktif] = await conn.execute<RowDataPacket[]>(
      `SELECT 1 FROM lab_orders
        WHERE visit_id = ? AND status IN ('baru','diproses')
          AND sifat_hasil = 'ditunggu' LIMIT 1`,
      [visitId],
    );
    const keKasir = labAktif.length === 0;

    if (keKasir) {
      await conn.execute(`UPDATE visits SET status = 'menunggu_kasir' WHERE id = ?`, [
        visitId,
      ]);
      // Tagihan tidak lagi bertambah — statusnya naik dari `draft` ke
      // `menunggu` supaya kasir tahu angkanya sudah final.
      await conn.execute(
        `UPDATE billing_transactions SET status = 'menunggu'
          WHERE id = ? AND status = 'draft'`,
        [billingId],
      );

      const [pasienRows] = await conn.execute<RowDataPacket[]>(
        `SELECT p.nama, p.no_rm FROM visits v
           JOIN patients p ON p.id = v.patient_id WHERE v.id = ?`,
        [visitId],
      );

      await kirimNotifikasi(
        { roleCode: "kasir", siteId },
        {
          jenis: "obat_siap",
          judul: `Siap dibayar — ${String(pasienRows[0]?.nama ?? "Pasien")}`,
          pesan:
            `No. RM ${String(pasienRows[0]?.no_rm ?? "-")} · ` +
            `${paten.length + racikans.length} item obat sudah dihargai`,
          link: `/kasir/${billingId}`,
          siteId,
        },
        conn,
      );
    }

    return { totalObat, totalRacikan, totalJasaRacik };
  });
}

/**
 * MENYERAHKAN resep — tahap kedua farmasi, sesudah pasien membayar.
 *
 * Baru di sinilah stok benar-benar berkurang: reservasi dilepas dan
 * `kurangiStok()` mencatatnya di kartu stok. Tagihan TIDAK disentuh lagi —
 * angkanya sudah dikunci saat validasi dan sudah dibayar pasien.
 *
 * Penyerahan ditolak bila tagihannya belum lunas. Itu seluruh maksud alur
 * ini: tidak ada obat keluar dari gudang sebelum dibayar.
 */
export async function serahkanResep(
  prescriptionId: number,
  siteId: number,
  userId: number,
): Promise<{ jumlahItem: number }> {
  // Item yang stoknya berkurang, dikumpulkan untuk diperiksa ambangnya
  // SETELAH transaksi berhasil — peringatan stok tidak boleh ikut
  // menggagalkan penyerahan obat yang sudah sah.
  const tersentuh = new Set<number>();

  const hasil = await transaction(async (conn) => {
    /*
     * Kunjungan dikunci LEBIH DULU — lihat `lib/kunci.ts`.
     *
     * Transaksi ini menulis `visits`, sementara `simpanResep` mengunci
     * `visits` dahulu lalu meminta resepnya. Tanpa baris di bawah keduanya
     * membentuk siklus, dan MySQL melempar deadlock — sudah terbukti.
     */
    const kunjunganId = await visitIdDariResep(conn, prescriptionId);
    if (kunjunganId) await kunciKunjungan(conn, kunjunganId);


    const [rxRows] = await conn.execute<RowDataPacket[]>(
      `SELECT rx.id, rx.visit_id, rx.status, rx.stok_direservasi,
              bt.id AS billing_id, bt.status AS billing_status
         FROM prescriptions rx
         LEFT JOIN billing_transactions bt ON bt.visit_id = rx.visit_id
        WHERE rx.id = ? AND rx.site_id = ?
        FOR UPDATE`,
      [prescriptionId, siteId],
    );
    const rx = rxRows[0];
    if (!rx) throw new Error("Resep tidak ditemukan.");
    if (rx.status === "diserahkan") throw new Error("Resep ini sudah diserahkan.");
    if (rx.status === "batal") throw new Error("Resep ini sudah dibatalkan dokter.");
    if (rx.status !== "disiapkan") {
      throw new Error(
        "Resep ini belum divalidasi. Validasi dulu supaya harganya terkunci dan pasien bisa membayar.",
      );
    }
    if (rx.billing_status !== "lunas") {
      throw new Error(
        "Pasien belum membayar. Obat baru boleh diserahkan setelah tagihan lunas di kasir.",
      );
    }

    const visitId = Number(rx.visit_id);
    const direservasi = Number(rx.stok_direservasi) === 1;

    /*
     * Seluruh kunci stok diambil di sini, dalam urutan `item_id` yang pasti
     * — lihat `kunciStok()` di `lib/kunci.ts`. Loop di bawah tetap menyusuri
     * item menurut urutan yang diketik dokter, karena struk, etiket, dan
     * baris tagihan mengikuti urutan itu; yang diseragamkan hanya urutan
     * pengambilan kuncinya.
     */
    await kunciStok(conn, siteId, await itemResep(conn, prescriptionId));

    // ---------- Obat paten ----------
    const [paten] = await conn.execute<RowDataPacket[]>(
      `SELECT pi.id, pi.item_id, pi.qty FROM prescription_items pi
        WHERE pi.prescription_id = ? ORDER BY pi.urutan, pi.id`,
      [prescriptionId],
    );

    for (const p of paten) {
      const qty = Number(p.qty);
      const itemId = Number(p.item_id);

      // Reservasi dilepas LEBIH DULU, lalu stok dipotong dengan menyebut
      // bahwa jumlah itu memang miliknya — kalau tidak, resep yang mengunci
      // seluruh sisa stok akan gagal menyerahkan obatnya sendiri.
      if (direservasi) await lepasReservasi(conn, { siteId, itemId, qty });

      const movementId = await kurangiStok(conn, {
        siteId, itemId, qty,
        jenis: "keluar_resep",
        refType: REF_OBAT,
        refId: Number(p.id),
        userId,
        dariReservasi: direservasi,
      });

      tersentuh.add(itemId);
      await conn.execute(
        `UPDATE prescription_items SET stock_movement_id = ?, qty_diserahkan = ? WHERE id = ?`,
        [movementId, qty, p.id],
      );
    }

    // ---------- Racikan ----------
    const [racikans] = await conn.execute<RowDataPacket[]>(
      `SELECT id, nama_racikan FROM prescription_racikans
        WHERE prescription_id = ? ORDER BY urutan, id`,
      [prescriptionId],
    );

    for (const r of racikans) {
      const [bahan] = await conn.execute<RowDataPacket[]>(
        `SELECT ri.id, ri.item_id, ri.qty_bahan
           FROM prescription_racikan_ingredients ri
          WHERE ri.racikan_id = ? ORDER BY ri.id`,
        [r.id],
      );

      for (const b of bahan) {
        const qty = Number(b.qty_bahan);
        const itemId = Number(b.item_id);

        if (direservasi) await lepasReservasi(conn, { siteId, itemId, qty });

        const movementId = await kurangiStok(conn, {
          siteId, itemId, qty,
          jenis: "keluar_racikan",
          refType: "racikan_ingredient",
          refId: Number(b.id),
          userId,
          catatan: `Bahan ${String(r.nama_racikan)}`,
          dariReservasi: direservasi,
        });

        tersentuh.add(itemId);
        await conn.execute(
          `UPDATE prescription_racikan_ingredients SET stock_movement_id = ? WHERE id = ?`,
          [movementId, b.id],
        );
      }

      await conn.execute(
        `UPDATE prescription_racikans
            SET is_disiapkan = 1, disiapkan_by = ?, disiapkan_at = NOW()
          WHERE id = ?`,
        [userId, r.id],
      );
    }

    await conn.execute(
      `UPDATE prescriptions
          SET status = 'diserahkan', stok_direservasi = 0,
              dispensed_by = ?, dispensed_at = NOW()
        WHERE id = ?`,
      [userId, prescriptionId],
    );

    // Obat sudah di tangan pasien dan tagihannya lunas — kunjungan selesai.
    await conn.execute(
      `UPDATE visits SET status = 'selesai', selesai_at = NOW() WHERE id = ?`,
      [visitId],
    );
    /*
     * Baris antreannya ikut ditutup DI SINI.
     *
     * Dulu penutupan itu hanya ada di kasir, karena kasir memang ujung alur.
     * Sejak pasien berresep berakhir di farmasi, jalur ini tidak pernah
     * melewati kasir sampai selesai — dan setiap pasien yang mengambil obat
     * meninggalkan baris antrean berstatus `dilayani` selamanya. Kolomnya
     * jadi kehilangan arti tepat pada mayoritas kunjungan.
     */
    await conn.execute(
      `UPDATE queues SET status = 'selesai' WHERE visit_id = ?`,
      [visitId],
    );

    return { jumlahItem: paten.length + racikans.length };
  });

  // Di luar transaksi: penyerahan sudah pasti tersimpan, jadi kegagalan di
  // sini tidak boleh membatalkannya.
  await periksaAmbangStok(siteId, [...tersentuh]);

  return hasil;
}

export { StokTidakCukupError };

// ---------------------------------------------------------------------
// Inventori
// ---------------------------------------------------------------------

export type BarisStok = RowDataPacket & {
  id: number;
  kode: string;
  nama: string;
  tipe: string;
  kategori: string | null;
  bentuk_sediaan: string | null;
  satuan_dasar: string;
  /** Saldo fisik di rak — termasuk yang sudah dikunci. */
  stok: string;
  /** Bagian yang dikunci resep menunggu bayar/diambil. */
  reserved: string;
  min_stock: number;
  hpp: string;
  harga_jual: string;
  kadaluarsa_terdekat: string | null;
};

/**
 * Laporan stok gudang.
 *
 * Di sini `stok` sengaja saldo FISIK, bukan tersedia — layar ini menjawab
 * "berapa barang yang ada di rak", dan itulah angka yang dicocokkan saat
 * opname. Bagian yang terkunci ditampilkan terpisah supaya perbedaannya
 * terbaca, bukan disembunyikan lewat satu angka yang sudah dikurangi.
 */
export async function daftarStok(siteId: number | null): Promise<BarisStok[]> {
  return query<BarisStok>(
    `SELECT i.id, i.kode, i.nama, i.tipe, ic.nama AS kategori,
            i.bentuk_sediaan, i.satuan_dasar, i.min_stock, i.hpp, i.harga_jual,
            COALESCE(s.qty_on_hand, 0) AS stok,
            COALESCE(s.qty_reserved, 0) AS reserved,
            (SELECT MIN(b.tanggal_kadaluarsa) FROM item_batches b
              WHERE b.item_id = i.id AND b.qty > 0
                AND (? IS NULL OR b.site_id = ?)) AS kadaluarsa_terdekat
       FROM items i
       LEFT JOIN item_categories ic ON ic.id = i.category_id
       /* Dijumlahkan per barang: tanpa cabang (Super Admin, "Semua Cabang")
          join biasa menghasilkan satu baris per cabang tanpa label cabangnya.
          Untuk satu cabang hasilnya sama — PK item_stocks (site_id, item_id). */
       LEFT JOIN (SELECT item_id, SUM(qty_on_hand) AS qty_on_hand,
                         SUM(qty_reserved) AS qty_reserved
                    FROM item_stocks
                   WHERE (? IS NULL OR site_id = ?)
                   GROUP BY item_id) s ON s.item_id = i.id
      WHERE i.is_active = 1 AND i.deleted_at IS NULL
      ORDER BY (COALESCE(s.qty_on_hand,0) <= i.min_stock) DESC, i.nama`,
    [siteId, siteId, siteId, siteId],
  );
}

export type KartuStok = RowDataPacket & {
  id: number;
  created_at: string;
  jenis: string;
  qty_delta: string;
  qty_after: string;
  ref_type: string | null;
  ref_id: number | null;
  catatan: string | null;
  petugas: string;
};

export async function kartuStok(
  itemId: number,
  siteId: number | null,
  limit = 50,
): Promise<KartuStok[]> {
  return query<KartuStok>(
    `SELECT m.id, m.created_at, m.jenis, m.qty_delta, m.qty_after,
            m.ref_type, m.ref_id, m.catatan, u.nama AS petugas
       FROM stock_movements m
       JOIN users u ON u.id = m.created_by
      WHERE m.item_id = ? AND (? IS NULL OR m.site_id = ?)
      ORDER BY m.id DESC
      LIMIT ${limitAman(limit)}`,
    [itemId, siteId, siteId],
  );
}
