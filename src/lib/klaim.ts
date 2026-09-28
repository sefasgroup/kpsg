import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { execute, limitAman, nextSequence, query, queryOne, transaction } from "./db";
import { periodeSekarang } from "./tanggal";
import type {
  BayarKlaimInput,
  KlaimBaruInput,
  VerifikasiKlaimInput,
} from "./validations/klaim";

/**
 * Klaim kolektif ke penjamin, beserta piutangnya.
 *
 * ALUR YANG DIWAKILI MODUL INI
 *
 *   draft → diajukan → disetujui → lunas
 *                  ↘ batal
 *
 * Setiap tahap adalah peristiwa nyata di dunia luar, bukan tombol hiasan:
 * *diajukan* berarti berkasnya sudah dikirim (dan sejak itu umur piutang
 * berjalan), *disetujui* berarti penjamin sudah memverifikasi baris per
 * baris dan mungkin mengoreksi nilainya, *lunas* berarti uangnya sudah
 * masuk seluruhnya.
 *
 * PIUTANG TIDAK DITABELKAN
 *
 * Ia diturunkan dari klaim dikurangi pembayarannya — pola yang sama dengan
 * saldo stok, yang selalu bisa dihitung ulang dari `stock_movements`. Angka
 * piutang yang disimpan terpisah adalah angka yang bisa menyimpang dari
 * sumbernya, dan ketika itu terjadi tidak ada cara mengetahui mana yang
 * benar.
 */

export type KlaimRow = RowDataPacket & {
  id: number;
  site_id: number;
  payer_id: number;
  payer_nama: string;
  payer_jenis: string;
  no_klaim: string;
  periode_dari: string;
  periode_sampai: string;
  status: string;
  total_diajukan: string;
  total_disetujui: string;
  jatuh_tempo: string | null;
  diajukan_at: string | null;
  alasan_batal: string | null;
  catatan: string | null;
  jumlah_baris: number;
  dibayar: string;
  /** Sisa yang masih harus dibayar penjamin. */
  sisa: string;
  /** Hari melewati jatuh tempo; negatif berarti belum jatuh tempo. */
  umur_hari: number | null;
};

const SELECT_KLAIM = `
  SELECT c.id, c.site_id, c.payer_id, p.nama AS payer_nama, p.jenis AS payer_jenis,
         c.no_klaim, c.periode_dari, c.periode_sampai, c.status,
         c.total_diajukan, c.total_disetujui, c.jatuh_tempo, c.diajukan_at,
         c.alasan_batal, c.catatan,
         (SELECT COUNT(*) FROM claim_items ci
           WHERE ci.claim_id = c.id AND ci.is_void = 0) AS jumlah_baris,
         COALESCE((SELECT SUM(cp.jumlah) FROM claim_payments cp
                    WHERE cp.claim_id = c.id), 0) AS dibayar,
         /*
          * Sisa dihitung dari total DISETUJUI bila sudah diverifikasi, dan
          * dari total diajukan bila belum. Memakai nilai ajuan setelah
          * penjamin memotongnya akan membuat piutang tampak lebih besar
          * daripada yang pernah disepakati.
          */
         GREATEST(0,
           IF(c.status IN ('disetujui','lunas'), c.total_disetujui, c.total_diajukan)
           - COALESCE((SELECT SUM(cp.jumlah) FROM claim_payments cp
                        WHERE cp.claim_id = c.id), 0)
         ) AS sisa,
         IF(c.jatuh_tempo IS NULL, NULL, DATEDIFF(CURDATE(), c.jatuh_tempo)) AS umur_hari
    FROM claims c
    JOIN payers p ON p.id = c.payer_id
`;

export async function daftarKlaim(
  siteId: number | null,
  opts: { status?: string; payerId?: number; limit?: number } = {},
): Promise<KlaimRow[]> {
  return query<KlaimRow>(
    `${SELECT_KLAIM}
      WHERE (? IS NULL OR c.site_id = ?)
        AND (? IS NULL OR c.status = ?)
        AND (? IS NULL OR c.payer_id = ?)
      ORDER BY FIELD(c.status,'draft','diajukan','disetujui','lunas','batal'),
               c.periode_dari DESC, c.id DESC
      LIMIT ${limitAman(opts.limit ?? 100, 100, 500)}`,
    [
      siteId, siteId,
      opts.status ?? null, opts.status ?? null,
      opts.payerId ?? null, opts.payerId ?? null,
    ],
  );
}

export async function getKlaim(
  id: number,
  siteId: number | null,
): Promise<KlaimRow | null> {
  return queryOne<KlaimRow>(
    `${SELECT_KLAIM} WHERE c.id = ? AND (? IS NULL OR c.site_id = ?)`,
    [id, siteId, siteId],
  );
}

export type BarisKlaimRow = RowDataPacket & {
  id: number;
  billing_id: number;
  no_invoice: string;
  visit_id: number;
  tanggal: string;
  no_rm: string;
  pasien: string;
  no_anggota: string | null;
  nilai_diajukan: string;
  nilai_disetujui: string | null;
  alasan_koreksi: string | null;
  is_void: number;
};

/**
 * Baris klaim TIDAK memuat diagnosa.
 *
 * Alasannya sama dengan layar kasir (`CLAUDE.md` §2.1): berkas penagihan
 * ditangani staf administrasi, dan diagnosa tidak dibutuhkan untuk
 * menagih. Bila kelak penjamin memintanya, itu keputusan tersendiri yang
 * harus disadari — bukan sesuatu yang kebetulan sudah ikut terbawa.
 */
export async function barisKlaim(claimId: number): Promise<BarisKlaimRow[]> {
  return query<BarisKlaimRow>(
    `SELECT ci.id, ci.billing_id, bt.no_invoice, bt.visit_id, v.tanggal,
            pa.no_rm, pa.nama AS pasien, v.no_anggota,
            ci.nilai_diajukan, ci.nilai_disetujui, ci.alasan_koreksi, ci.is_void
       FROM claim_items ci
       JOIN billing_transactions bt ON bt.id = ci.billing_id
       JOIN visits v   ON v.id = bt.visit_id
       JOIN patients pa ON pa.id = v.patient_id
      WHERE ci.claim_id = ?
      ORDER BY v.tanggal, bt.no_invoice`,
    [claimId],
  );
}

export type KandidatKlaim = RowDataPacket & {
  billing_id: number;
  no_invoice: string;
  visit_id: number;
  tanggal: string;
  no_rm: string;
  pasien: string;
  no_anggota: string | null;
  tanggung_penjamin: string;
};

/**
 * Tagihan yang layak masuk klaim.
 *
 * Empat syaratnya masing-masing menutup satu cara membuat berkas klaim
 * ditolak:
 *
 *   1. `status = 'lunas'` — kunjungannya sudah tuntas dan angkanya final.
 *   2. `tanggung_penjamin > 0` — pasien yang membayar sendiri seluruhnya
 *      tidak punya apa pun untuk ditagihkan.
 *   3. `payer_id` cocok — tagihan penjamin lain tidak boleh menyusup.
 *   4. Belum ada di klaim BERJALAN — tagihan yang ditagihkan dua kali
 *      adalah temuan audit, bukan sekadar kesalahan input.
 */
export async function tagihanBelumDiklaim(
  siteId: number,
  payerId: number,
  dari: string,
  sampai: string,
): Promise<KandidatKlaim[]> {
  return query<KandidatKlaim>(
    `SELECT bt.id AS billing_id, bt.no_invoice, bt.visit_id, v.tanggal,
            pa.no_rm, pa.nama AS pasien, v.no_anggota, bt.tanggung_penjamin
       FROM billing_transactions bt
       JOIN visits v    ON v.id = bt.visit_id
       JOIN patients pa ON pa.id = v.patient_id
      WHERE bt.site_id = ?
        AND bt.payer_id = ?
        AND bt.status = 'lunas'
        AND bt.tanggung_penjamin > 0
        AND v.tanggal BETWEEN ? AND ?
        AND NOT EXISTS (
          SELECT 1 FROM claim_items ci
           WHERE ci.billing_aktif = bt.id
        )
      ORDER BY v.tanggal, bt.no_invoice`,
    [siteId, payerId, dari, sampai],
  );
}

export async function buatKlaim(
  input: KlaimBaruInput,
  siteId: number,
  userId: number,
): Promise<{ id: number; noKlaim: string; jumlahBaris: number; total: number }> {
  return transaction(async (conn) => {
    /*
     * TANPA `FOR UPDATE`, dan itu disengaja.
     *
     * Versi sebelumnya mengunci seluruh tagihan sebulan beserta baris
     * kunjungannya — ratusan baris, ditahan sepanjang transaksi. Selama itu
     * kasir yang membatalkan pembayaran atas salah satu tagihan tersebut
     * ikut tertahan, dan penguncian seluas itu juga memperbesar peluang
     * bertabrakan dengan transaksi lain.
     *
     * Yang menjaga "satu tagihan hanya di satu klaim berjalan" bukan kunci
     * ini melainkan `uq_ci_billing_aktif` di database. Bila dua petugas
     * menyusun klaim bersamaan atas periode yang beririsan, yang kalah
     * gagal dengan duplicate key — jawaban yang benar, dan jauh lebih murah
     * daripada menahan sebulan tagihan.
     */
    const [kandidat] = await conn.execute<RowDataPacket[]>(
      `SELECT bt.id, bt.tanggung_penjamin
         FROM billing_transactions bt
         JOIN visits v ON v.id = bt.visit_id
        WHERE bt.site_id = ? AND bt.payer_id = ? AND bt.status = 'lunas'
          AND bt.tanggung_penjamin > 0
          AND v.tanggal BETWEEN ? AND ?
          AND NOT EXISTS (SELECT 1 FROM claim_items ci WHERE ci.billing_aktif = bt.id)`,
      [siteId, input.payer_id, input.periode_dari, input.periode_sampai],
    );

    if (kandidat.length === 0) {
      throw new Error(
        "Tidak ada tagihan yang bisa diklaim pada periode ini. " +
          "Tagihan harus sudah lunas, ditanggung penjamin ini, dan belum masuk klaim lain.",
      );
    }

    const [siteRows] = await conn.execute<RowDataPacket[]>(
      `SELECT kode FROM sites WHERE id = ?`,
      [siteId],
    );
    const kodeSite = String(siteRows[0]?.kode ?? "KPSG");
    const periode = periodeSekarang();
    const nomor = await nextSequence(conn, siteId, "klaim", periode);
    const noKlaim = `${kodeSite}/KLM/${periode}/${String(nomor).padStart(4, "0")}`;

    const total = kandidat.reduce((n, k) => n + Number(k.tanggung_penjamin), 0);

    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO claims (site_id, payer_id, no_klaim, periode_dari, periode_sampai,
                           status, total_diajukan, catatan, created_by)
       VALUES (?,?,?,?,?, 'draft', ?, ?, ?)`,
      [
        siteId, input.payer_id, noKlaim, input.periode_dari, input.periode_sampai,
        total, input.catatan ?? null, userId,
      ],
    );
    const claimId = res.insertId;

    /*
     * Satu INSERT untuk seluruh baris, bukan satu per baris. Klaim bulanan
     * klinik ramai memuat ratusan tagihan; N perjalanan bolak-balik ke
     * database menahan transaksinya jauh lebih lama daripada perlu.
     */
    await conn.execute(
      `INSERT INTO claim_items (claim_id, billing_id, nilai_diajukan)
       VALUES ${kandidat.map(() => "(?,?,?)").join(",")}`,
      kandidat.flatMap((k) => [claimId, Number(k.id), Number(k.tanggung_penjamin)]),
    );

    return { id: claimId, noKlaim, jumlahBaris: kandidat.length, total };
  });
}

/**
 * Mengajukan klaim: berkas dianggap sudah dikirim ke penjamin.
 *
 * `jatuh_tempo` DIBEKUKAN di sini, dihitung dari termin kontrak saat
 * pengajuan. Kalau ia dihitung ulang setiap kali laporan dibuka, mengubah
 * termin kontrak akan mengubah umur seluruh piutang lama — dan tagihan
 * yang sudah terlambat tiga bulan bisa mendadak tampak belum jatuh tempo.
 */
export async function ajukanKlaim(
  claimId: number,
  siteId: number,
  userId: number,
): Promise<{ noKlaim: string; jatuhTempo: string }> {
  return transaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT c.no_klaim, c.status, p.termin_hari
         FROM claims c JOIN payers p ON p.id = c.payer_id
        WHERE c.id = ? AND c.site_id = ? FOR UPDATE`,
      [claimId, siteId],
    );
    const c = rows[0];
    if (!c) throw new Error("Klaim tidak ditemukan.");
    if (c.status !== "draft") {
      throw new Error("Hanya klaim berstatus draft yang bisa diajukan.");
    }

    const [baris] = await conn.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM claim_items WHERE claim_id = ? AND is_void = 0`,
      [claimId],
    );
    if (Number(baris[0].n) === 0) {
      throw new Error("Klaim tanpa satu pun baris tagihan tidak bisa diajukan.");
    }

    await conn.execute(
      `UPDATE claims
          SET status = 'diajukan', diajukan_at = NOW(), diajukan_by = ?,
              jatuh_tempo = DATE_ADD(CURDATE(), INTERVAL ? DAY)
        WHERE id = ?`,
      [userId, Number(c.termin_hari), claimId],
    );

    const [after] = await conn.execute<RowDataPacket[]>(
      `SELECT jatuh_tempo FROM claims WHERE id = ?`,
      [claimId],
    );
    return {
      noKlaim: String(c.no_klaim),
      jatuhTempo: String(after[0].jatuh_tempo).slice(0, 10),
    };
  });
}

/**
 * Mencatat hasil verifikasi penjamin, baris per baris.
 *
 * Penjamin memotong per baris, bukan per berkas — dan alasan potongannya
 * adalah satu-satunya bahan untuk memperbaiki pengajuan berikutnya. Kalau
 * hanya total akhirnya yang disimpan, klinik tahu ia dipotong tetapi tidak
 * pernah tahu sebabnya.
 */
export async function verifikasiKlaim(
  claimId: number,
  siteId: number,
  input: VerifikasiKlaimInput,
): Promise<{ totalDisetujui: number; dikoreksi: number }> {
  return transaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT status FROM claims WHERE id = ? AND site_id = ? FOR UPDATE`,
      [claimId, siteId],
    );
    if (!rows[0]) throw new Error("Klaim tidak ditemukan.");
    if (!["diajukan", "disetujui"].includes(String(rows[0].status))) {
      throw new Error(
        "Verifikasi hanya berlaku untuk klaim yang sudah diajukan dan belum lunas.",
      );
    }

    /*
     * Verifikasi ULANG ditolak begitu penjamin mulai membayar. Memotong nilai
     * disetujui di bawah yang sudah dibayar membuat klaim macet: sisa tampil
     * 0 tetapi status tak pernah lunas, pembayaran berikutnya ditolak, dan
     * pembatalan juga ditolak karena sudah ada pembayaran.
     */
    const [bayar] = await conn.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM claim_payments WHERE claim_id = ?`,
      [claimId],
    );
    if (Number(bayar[0].n) > 0) {
      throw new Error(
        "Penjamin sudah mulai membayar klaim ini — nilai disetujuinya tidak bisa diverifikasi ulang.",
      );
    }

    /*
     * Seluruh baris diambil SEKALI, bukan satu kueri per baris.
     *
     * Verifikasi klaim bulanan menyentuh ratusan baris; pola lama berarti
     * 2N perjalanan bolak-balik sambil memegang kunci klaimnya. Sekarang
     * satu kueri di muka, dan sisanya perbandingan di memori.
     */
    const [semuaBaris] = await conn.execute<RowDataPacket[]>(
      `SELECT id, nilai_diajukan FROM claim_items
        WHERE claim_id = ? AND is_void = 0`,
      [claimId],
    );
    const nilaiAjuan = new Map<number, number>(
      semuaBaris.map((r) => [Number(r.id), Number(r.nilai_diajukan)]),
    );

    let dikoreksi = 0;
    for (const b of input.baris) {
      const diajukan = nilaiAjuan.get(b.claim_item_id);
      if (diajukan === undefined) continue;
      if (b.nilai_disetujui > diajukan) {
        throw new Error(
          `Nilai disetujui (${b.nilai_disetujui}) tidak boleh melebihi nilai diajukan (${diajukan}).`,
        );
      }
      if (b.nilai_disetujui < diajukan && !b.alasan_koreksi) {
        throw new Error(
          "Baris yang dipotong wajib disertai alasan koreksi dari penjamin.",
        );
      }

      await conn.execute(
        `UPDATE claim_items SET nilai_disetujui = ?, alasan_koreksi = ? WHERE id = ?`,
        [b.nilai_disetujui, b.alasan_koreksi ?? null, b.claim_item_id],
      );
      if (b.nilai_disetujui < diajukan) dikoreksi++;
    }

    const [total] = await conn.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(COALESCE(nilai_disetujui, nilai_diajukan)), 0) AS n
         FROM claim_items WHERE claim_id = ? AND is_void = 0`,
      [claimId],
    );
    const totalDisetujui = Number(total[0].n);

    // Ditolak seluruhnya → tidak ada yang tersisa untuk ditagih: klaim
    // selesai (lunas), bukan menggantung selamanya sebagai piutang terlambat.
    await conn.execute(
      `UPDATE claims SET total_disetujui = ?, status = ? WHERE id = ?`,
      [totalDisetujui, totalDisetujui > 0 ? "disetujui" : "lunas", claimId],
    );

    return { totalDisetujui, dikoreksi };
  });
}

/**
 * Mencatat pembayaran penjamin. Boleh dicicil — penjamin sering membayar
 * sebagian dulu, dan memaksa satu pembayaran penuh berarti staf akan
 * menuliskan angka yang tidak pernah masuk ke rekening.
 */
export async function catatPembayaranKlaim(
  claimId: number,
  siteId: number,
  input: BayarKlaimInput,
  userId: number,
): Promise<{ dibayar: number; sisa: number; lunas: boolean }> {
  return transaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT status, total_diajukan, total_disetujui
         FROM claims WHERE id = ? AND site_id = ? FOR UPDATE`,
      [claimId, siteId],
    );
    const c = rows[0];
    if (!c) throw new Error("Klaim tidak ditemukan.");
    if (c.status === "draft") {
      throw new Error("Klaim belum diajukan — pembayaran tidak mungkin sudah masuk.");
    }
    if (c.status === "batal") throw new Error("Klaim ini sudah dibatalkan.");
    if (c.status === "lunas") throw new Error("Klaim ini sudah lunas.");

    /*
     * Setelah diverifikasi, yang disepakati adalah total DISETUJUI — juga
     * bila nilainya 0 (seluruh baris ditolak). Dulu `> 0` dipakai sebagai
     * tanda "sudah diverifikasi", sehingga klaim yang ditolak total tetap
     * menerima pembayaran sampai nilai ajuan penuhnya.
     */
    const disepakati = ["disetujui", "lunas"].includes(String(c.status))
      ? Number(c.total_disetujui)
      : Number(c.total_diajukan);

    const [sudah] = await conn.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(jumlah), 0) AS n FROM claim_payments WHERE claim_id = ?`,
      [claimId],
    );
    const dibayarSebelum = Number(sudah[0].n);

    /*
     * Pembayaran berlebih DITOLAK, bukan diterima lalu dianggap kelebihan.
     * Angka yang melebihi kesepakatan hampir selalu salah ketik, dan bila
     * benar-benar penjamin membayar lebih, itu perlu diselesaikan sebagai
     * koreksi tersendiri — bukan disembunyikan di dalam satu klaim.
     */
    if (dibayarSebelum + input.jumlah > disepakati) {
      throw new Error(
        `Pembayaran melebihi nilai yang disepakati. Sisa yang belum dibayar hanya ${disepakati - dibayarSebelum}.`,
      );
    }

    await conn.execute(
      `INSERT INTO claim_payments (claim_id, tanggal, jumlah, metode, ref, catatan, created_by)
       VALUES (?,?,?,?,?,?,?)`,
      [
        claimId, input.tanggal, input.jumlah, input.metode,
        input.ref ?? null, input.catatan ?? null, userId,
      ],
    );

    const dibayar = dibayarSebelum + input.jumlah;
    const lunas = dibayar >= disepakati;
    if (lunas) {
      await conn.execute(`UPDATE claims SET status = 'lunas' WHERE id = ?`, [claimId]);
    }

    return { dibayar, sisa: disepakati - dibayar, lunas };
  });
}

export async function pembayaranKlaim(claimId: number) {
  return query<RowDataPacket & {
    id: number; tanggal: string; jumlah: string; metode: string;
    ref: string | null; catatan: string | null; pencatat: string;
  }>(
    `SELECT cp.id, cp.tanggal, cp.jumlah, cp.metode, cp.ref, cp.catatan,
            u.nama AS pencatat
       FROM claim_payments cp JOIN users u ON u.id = cp.created_by
      WHERE cp.claim_id = ?
      ORDER BY cp.tanggal, cp.id`,
    [claimId],
  );
}

/**
 * Membatalkan klaim, dan **melepaskan tagihannya supaya bisa diklaim
 * ulang**.
 *
 * Baris klaim ditandai `is_void`, bukan dihapus: berkas yang pernah
 * diajukan ke penjamin adalah peristiwa yang benar-benar terjadi, dan
 * riwayat pengajuan yang gagal justru yang paling dibutuhkan saat
 * mengajukan ulang.
 *
 * Ditolak bila sudah ada pembayaran masuk — uang yang sudah diterima tidak
 * bisa dianggap tidak pernah diterima, dan koreksinya harus lewat jalur
 * tersendiri.
 */
export async function batalkanKlaim(
  claimId: number,
  siteId: number,
  alasan: string,
): Promise<{ noKlaim: string; barisDilepas: number }> {
  return transaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT no_klaim, status FROM claims WHERE id = ? AND site_id = ? FOR UPDATE`,
      [claimId, siteId],
    );
    const c = rows[0];
    if (!c) throw new Error("Klaim tidak ditemukan.");
    if (c.status === "batal") throw new Error("Klaim ini sudah dibatalkan.");
    if (c.status === "lunas") {
      throw new Error(
        "Klaim yang sudah lunas tidak bisa dibatalkan — uangnya sudah diterima.",
      );
    }

    const [bayar] = await conn.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(jumlah), 0) AS n FROM claim_payments WHERE claim_id = ?`,
      [claimId],
    );
    if (Number(bayar[0].n) > 0) {
      throw new Error(
        `Klaim ini sudah menerima pembayaran ${Number(bayar[0].n)}. ` +
          "Batalkan pembayarannya lebih dulu, atau selesaikan lewat koreksi terpisah.",
      );
    }

    const [upd] = await conn.execute<ResultSetHeader>(
      `UPDATE claim_items SET is_void = 1 WHERE claim_id = ? AND is_void = 0`,
      [claimId],
    );

    await conn.execute(
      `UPDATE claims SET status = 'batal', alasan_batal = ? WHERE id = ?`,
      [alasan, claimId],
    );

    return { noKlaim: String(c.no_klaim), barisDilepas: upd.affectedRows };
  });
}

// ---------------------------------------------------------------------
// Piutang
// ---------------------------------------------------------------------

export type UmurPiutang = {
  penjaminId: number;
  penjamin: string;
  jenis: string;
  /** Belum jatuh tempo. */
  belumJatuhTempo: number;
  umur1_30: number;
  umur31_60: number;
  umur61_90: number;
  umurLebih90: number;
  total: number;
};

/**
 * Umur piutang per penjamin.
 *
 * Ember 1–30 / 31–60 / 61–90 / >90 hari adalah pengelompokan akuntansi
 * yang lazim. Yang penting bukan embernya melainkan bahwa **piutang yang
 * lewat 90 hari dipisahkan** — pada titik itu masalahnya bukan lagi
 * penjamin yang lambat membayar, melainkan berkas yang mungkin hilang atau
 * ditolak tanpa pemberitahuan.
 */
export async function umurPiutang(siteId: number | null): Promise<UmurPiutang[]> {
  const rows = await query<RowDataPacket & {
    payer_id: number; penjamin: string; jenis: string;
    belum: string; b1: string; b2: string; b3: string; b4: string; total: string;
  }>(
    `SELECT c.payer_id, p.nama AS penjamin, p.jenis,
            COALESCE(SUM(CASE WHEN u.hari <= 0 THEN u.sisa END), 0) AS belum,
            COALESCE(SUM(CASE WHEN u.hari BETWEEN 1 AND 30 THEN u.sisa END), 0) AS b1,
            COALESCE(SUM(CASE WHEN u.hari BETWEEN 31 AND 60 THEN u.sisa END), 0) AS b2,
            COALESCE(SUM(CASE WHEN u.hari BETWEEN 61 AND 90 THEN u.sisa END), 0) AS b3,
            COALESCE(SUM(CASE WHEN u.hari > 90 THEN u.sisa END), 0) AS b4,
            COALESCE(SUM(u.sisa), 0) AS total
       FROM claims c
       JOIN payers p ON p.id = c.payer_id
       JOIN (
         SELECT c2.id,
                IFNULL(DATEDIFF(CURDATE(), c2.jatuh_tempo), 0) AS hari,
                GREATEST(0,
                  IF(c2.status IN ('disetujui','lunas'), c2.total_disetujui, c2.total_diajukan)
                  - COALESCE((SELECT SUM(cp.jumlah) FROM claim_payments cp
                               WHERE cp.claim_id = c2.id), 0)
                ) AS sisa
           FROM claims c2
          WHERE c2.status IN ('diajukan','disetujui')
       ) u ON u.id = c.id
      WHERE (? IS NULL OR c.site_id = ?)
      GROUP BY c.payer_id, p.nama, p.jenis
     HAVING total > 0
      ORDER BY total DESC`,
    [siteId, siteId],
  );

  return rows.map((r) => ({
    penjaminId: Number(r.payer_id),
    penjamin: r.penjamin,
    jenis: r.jenis,
    belumJatuhTempo: Number(r.belum),
    umur1_30: Number(r.b1),
    umur31_60: Number(r.b2),
    umur61_90: Number(r.b3),
    umurLebih90: Number(r.b4),
    total: Number(r.total),
  }));
}

export type RingkasanKlaim = {
  draft: number;
  diajukan: number;
  nilaiDiajukan: number;
  piutang: number;
  terlambat: number;
  nilaiTerlambat: number;
};

export async function ringkasanKlaim(siteId: number | null): Promise<RingkasanKlaim> {
  const r = await queryOne<RowDataPacket & {
    draft: number; diajukan: number; nilai_diajukan: string;
    piutang: string; terlambat: number; nilai_terlambat: string;
  }>(
    `SELECT
       SUM(c.status = 'draft') AS draft,
       SUM(c.status IN ('diajukan','disetujui')) AS diajukan,
       COALESCE(SUM(CASE WHEN c.status IN ('diajukan','disetujui')
                    THEN IF(c.status IN ('disetujui','lunas'), c.total_disetujui, c.total_diajukan) END), 0) AS nilai_diajukan,
       COALESCE(SUM(CASE WHEN c.status IN ('diajukan','disetujui') THEN GREATEST(0,
                    IF(c.status IN ('disetujui','lunas'), c.total_disetujui, c.total_diajukan)
                    - COALESCE((SELECT SUM(cp.jumlah) FROM claim_payments cp WHERE cp.claim_id = c.id), 0)
                  ) END), 0) AS piutang,
       SUM(c.status IN ('diajukan','disetujui') AND c.jatuh_tempo < CURDATE()) AS terlambat,
       COALESCE(SUM(CASE WHEN c.status IN ('diajukan','disetujui') AND c.jatuh_tempo < CURDATE()
                    THEN GREATEST(0,
                      IF(c.status IN ('disetujui','lunas'), c.total_disetujui, c.total_diajukan)
                      - COALESCE((SELECT SUM(cp.jumlah) FROM claim_payments cp WHERE cp.claim_id = c.id), 0)
                    ) END), 0) AS nilai_terlambat
     FROM claims c
    WHERE (? IS NULL OR c.site_id = ?)`,
    [siteId, siteId],
  );

  return {
    draft: Number(r?.draft ?? 0),
    diajukan: Number(r?.diajukan ?? 0),
    nilaiDiajukan: Number(r?.nilai_diajukan ?? 0),
    piutang: Number(r?.piutang ?? 0),
    terlambat: Number(r?.terlambat ?? 0),
    nilaiTerlambat: Number(r?.nilai_terlambat ?? 0),
  };
}

/** Dipakai skrip pengingat harian: klaim yang sudah lewat jatuh tempo. */
export async function klaimTerlambat(siteId: number | null) {
  return query<RowDataPacket & {
    site_id: number; site_nama: string; no_klaim: string; penjamin: string;
    jatuh_tempo: string; umur_hari: number; sisa: string;
  }>(
    `SELECT c.site_id, s.nama AS site_nama, c.no_klaim, p.nama AS penjamin,
            c.jatuh_tempo, DATEDIFF(CURDATE(), c.jatuh_tempo) AS umur_hari,
            GREATEST(0,
              IF(c.status IN ('disetujui','lunas'), c.total_disetujui, c.total_diajukan)
              - COALESCE((SELECT SUM(cp.jumlah) FROM claim_payments cp
                           WHERE cp.claim_id = c.id), 0)
            ) AS sisa
       FROM claims c
       JOIN payers p ON p.id = c.payer_id
       JOIN sites  s ON s.id = c.site_id
      WHERE c.status IN ('diajukan','disetujui')
        AND c.jatuh_tempo < CURDATE()
        AND (? IS NULL OR c.site_id = ?)
      ORDER BY umur_hari DESC`,
    [siteId, siteId],
  );
}

/** Menghapus klaim draft yang ternyata tidak diperlukan. */
export async function hapusKlaimDraft(claimId: number, siteId: number): Promise<void> {
  const res = await execute(
    `DELETE FROM claims WHERE id = ? AND site_id = ? AND status = 'draft'`,
    [claimId, siteId],
  );
  if (res.affectedRows === 0) {
    throw new Error(
      "Hanya klaim draft yang bisa dihapus. Klaim yang sudah diajukan harus dibatalkan, bukan dihapus.",
    );
  }
}
