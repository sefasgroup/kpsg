import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { execute, query, queryOne, transaction, limitAman } from "./db";
import { batalkanPemotongan, kurangiStok } from "./stock";
import { kunciStok } from "./kunci";
import { hargaBarangBerlaku, payerIdKunjungan } from "./penjamin";
import { kirimNotifikasi, periksaAmbangStok } from "./notifications";
import { URUT_ANTREAN } from "./visits";
import {
  hapusBarisTagihanByRef,
  hitungUlangTagihan,
  pastikanTagihan,
  tambahBarisTagihan,
} from "./billing";
import type { AlergiInput, NurseAssessmentInput } from "./validations/nurse";

const REF_BMHP = "nurse_bmhp_usage";

/** Status kunjungan yang boleh dikaji perawat. */
const STATUS_BOLEH_DIKAJI = ["terdaftar", "menunggu_perawat", "dikaji_perawat"];

export type WorklistRow = RowDataPacket & {
  visit_id: number;
  no_visit: string;
  waktu_daftar: string;
  status: string;
  antrean: string | null;
  patient_id: number;
  no_rm: string;
  nama: string;
  tanggal_lahir: string;
  jenis_kelamin: "L" | "P";
  poli_nama: string;
  dokter_nama: string;
  alergi: string | null;
  sudah_dikaji: number;
  triase: string | null;
  didahulukan: number;
  alasan_didahulukan: string | null;
};

const SELECT_WORKLIST = `
  SELECT v.id AS visit_id, v.no_visit, v.waktu_daftar, v.status,
         v.didahulukan, v.alasan_didahulukan,
         CONCAT(q.prefix, LPAD(q.nomor, 3, '0')) AS antrean,
         p.id AS patient_id, p.no_rm, p.nama, p.tanggal_lahir, p.jenis_kelamin,
         pol.nama AS poli_nama, d.nama AS dokter_nama,
         (SELECT GROUP_CONCAT(a.nama_alergen SEPARATOR ', ')
            FROM patient_allergies a
           WHERE a.patient_id = p.id AND a.is_active = 1) AS alergi,
         (na.id IS NOT NULL) AS sudah_dikaji,
         na.triase
    FROM visits v
    JOIN patients p ON p.id = v.patient_id
    JOIN polis pol  ON pol.id = v.poli_id
    JOIN users d    ON d.id = v.doctor_id
    LEFT JOIN queues q ON q.visit_id = v.id
    LEFT JOIN nurse_assessments na ON na.visit_id = v.id
`;

/** Antrean pasien yang menunggu / sedang dikaji perawat hari ini. */
export async function worklistPerawat(
  siteId: number | null,
  tanggal: string,
): Promise<WorklistRow[]> {
  return query<WorklistRow>(
    `${SELECT_WORKLIST}
      WHERE v.tanggal = ?
        AND (? IS NULL OR v.site_id = ?)
        AND v.status IN ('terdaftar','menunggu_perawat','dikaji_perawat')
      ORDER BY ${URUT_ANTREAN}`,
    [tanggal, siteId, siteId],
  );
}

/**
 * Pasien HARI SEBELUMNYA yang masih menunggu pengkajian.
 *
 * Sama seperti `tertundaDokter()`: tanpa ini, pasien yang tertinggal semalam
 * lenyap dari layar perawat sementara statusnya tetap `menunggu_perawat`.
 * Layar Pendaftaran pun hanya menampilkan hari ini, jadi kunjungan itu tidak
 * bisa dilanjutkan maupun dibatalkan oleh siapa pun.
 */
export async function tertundaPerawat(
  siteId: number | null,
  tanggal: string,
): Promise<WorklistRow[]> {
  return query<WorklistRow>(
    `${SELECT_WORKLIST}
      WHERE v.tanggal < ?
        AND (? IS NULL OR v.site_id = ?)
        AND v.status IN ('terdaftar','menunggu_perawat','dikaji_perawat')
      ORDER BY v.tanggal DESC, q.nomor`,
    [tanggal, siteId, siteId],
  );
}

/** Pasien yang sudah selesai dikaji hari ini — untuk koreksi cepat. */
export async function sudahDikajiHariIni(
  siteId: number | null,
  tanggal: string,
): Promise<WorklistRow[]> {
  return query<WorklistRow>(
    `${SELECT_WORKLIST}
      WHERE v.tanggal = ?
        AND (? IS NULL OR v.site_id = ?)
        AND na.id IS NOT NULL
        AND v.status NOT IN ('terdaftar','menunggu_perawat','dikaji_perawat')
      ORDER BY q.nomor`,
    [tanggal, siteId, siteId],
  );
}

export type DetailKunjungan = RowDataPacket & WorklistRow & { site_id: number };

export async function getKunjunganUntukPerawat(
  visitId: number,
  siteId: number | null,
): Promise<DetailKunjungan | null> {
  return queryOne<DetailKunjungan>(
    `${SELECT_WORKLIST}
      WHERE v.id = ? AND (? IS NULL OR v.site_id = ?)`,
    [visitId, siteId, siteId],
  );
}

export type PengkajianTersimpan = RowDataPacket & {
  id: number;
  triase: string;
  keluhan_utama: string;
  riwayat_singkat: string | null;
  riwayat_pengobatan: string | null;
  td_sistolik: number | null;
  td_diastolik: number | null;
  nadi: number | null;
  respirasi: number | null;
  suhu: string | null;
  spo2: number | null;
  kesadaran: string | null;
  keadaan_umum: string | null;
  keadaan_gizi: string | null;
  gcs_e: number | null;
  gcs_v: number | null;
  gcs_m: number | null;
  gcs_total: number | null;
  berat_badan: string | null;
  tinggi_badan: string | null;
  lingkar_perut: string | null;
  imt: string | null;
  skala_nyeri: number | null;
  risiko_jatuh: string | null;
  status_alergi_dikonfirmasi: number;
  catatan: string | null;
};

export async function getPengkajian(
  visitId: number,
): Promise<PengkajianTersimpan | null> {
  return queryOne<PengkajianTersimpan>(
    `SELECT * FROM nurse_assessments WHERE visit_id = ?`,
    [visitId],
  );
}

export type AlergiRow = RowDataPacket & {
  id: number;
  jenis: string;
  nama_alergen: string;
  reaksi: string | null;
  keparahan: string | null;
  dicatat_oleh: string | null;
  created_at: string;
};

/** Alergi aktif pasien — sumbernya `patient_allergies`, bukan pengkajian. */
export async function alergiPasien(patientId: number): Promise<AlergiRow[]> {
  return query<AlergiRow>(
    `SELECT a.id, a.jenis, a.nama_alergen, a.reaksi, a.keparahan,
            a.created_at, u.nama AS dicatat_oleh
       FROM patient_allergies a
       LEFT JOIN users u ON u.id = a.recorded_by
      WHERE a.patient_id = ? AND a.is_active = 1
      ORDER BY FIELD(a.keparahan,'berat','sedang','ringan'), a.nama_alergen`,
    [patientId],
  );
}

/**
 * Mencatat alergi baru yang disebutkan pasien saat triase.
 *
 * Ditulis ke `patient_allergies` sehingga melekat pada PASIEN: ikut terbaca
 * di layar dokter, di pemeriksaan resep farmasi, dan pada kunjungan
 * berikutnya. Sebelum ini alergi hanya bisa DIBACA di seluruh sistem —
 * perawat yang mendengar "saya alergi amoksisilin" tidak punya tempat
 * mencatatnya.
 */
export async function tambahAlergi(
  patientId: number,
  input: AlergiInput,
  userId: number,
): Promise<number> {
  const nama = input.nama_alergen.trim();

  // Alergen yang sama tidak digandakan: perawat berbeda pada kunjungan
  // berbeda akan mencatat hal yang sama, dan pita alergi yang mengulang
  // "Amoksisilin, Amoksisilin, Amoksisilin" justru jadi sulit dibaca.
  const ada = await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM patient_allergies
      WHERE patient_id = ? AND is_active = 1 AND LOWER(nama_alergen) = LOWER(?)`,
    [patientId, nama],
  );
  if (ada) {
    // Lengkapi keterangan yang sebelumnya kosong, jangan timpa yang sudah ada.
    await execute(
      `UPDATE patient_allergies
          SET reaksi = COALESCE(reaksi, ?), keparahan = COALESCE(keparahan, ?)
        WHERE id = ?`,
      [input.reaksi ?? null, input.keparahan ?? null, ada.id],
    );
    return Number(ada.id);
  }

  const res = await execute(
    `INSERT INTO patient_allergies
       (patient_id, jenis, nama_alergen, reaksi, keparahan, recorded_by)
     VALUES (?,?,?,?,?,?)`,
    [patientId, input.jenis, nama.slice(0, 150),
      input.reaksi ?? null, input.keparahan ?? null, userId],
  );
  return res.insertId;
}

export type BmhpTerpakai = RowDataPacket & {
  id: number;
  item_id: number;
  nama: string;
  qty: string;
  satuan: string;
  harga_satuan: string;
  subtotal: string;
};

/**
 * BMHP yang sudah tercatat pada kunjungan ini.
 *
 * `stok_tersedia` = saldo saat ini DITAMBAH jumlah yang sudah dipotong untuk
 * baris ini. Alasannya: penyimpanan ulang mengembalikan dulu pemakaian lama
 * sebelum memotong yang baru, jadi jumlah itu memang masih bisa dipakai.
 * Tanpa penambahan ini, membuka lalu menyimpan ulang tanpa perubahan akan
 * salah memunculkan peringatan "stok kurang".
 */
export async function getBmhpKunjungan(
  visitId: number,
  siteId: number | null,
): Promise<(BmhpTerpakai & { stok_tersedia: string })[]> {
  return query<BmhpTerpakai & { stok_tersedia: string }>(
    `SELECT u.id, u.item_id, i.nama, u.qty, u.satuan, u.harga_satuan, u.subtotal,
            (COALESCE(s.qty_on_hand, 0) + u.qty) AS stok_tersedia
       FROM nurse_bmhp_usage u
       JOIN items i ON i.id = u.item_id
       LEFT JOIN item_stocks s ON s.item_id = u.item_id AND s.site_id = u.site_id
      WHERE u.visit_id = ? AND (? IS NULL OR u.site_id = ?)
      ORDER BY u.id`,
    [visitId, siteId, siteId],
  );
}

export type ItemBmhp = RowDataPacket & {
  id: number;
  kode: string;
  nama: string;
  satuan_dasar: string;
  harga_jual: string;
  stok: string;
};

/** Autocomplete BMHP — menampilkan sisa stok agar perawat tidak memilih yang habis. */
export async function cariBmhp(
  keyword: string,
  siteId: number | null,
  limit = 15,
): Promise<ItemBmhp[]> {
  const q = keyword.trim();
  if (q.length < 2) return [];
  return query<ItemBmhp>(
    `SELECT i.id, i.kode, i.nama, i.satuan_dasar, i.harga_jual,
            GREATEST(0, COALESCE(s.qty_on_hand, 0) - COALESCE(s.qty_reserved, 0)) AS stok
       FROM items i
       LEFT JOIN item_stocks s ON s.item_id = i.id AND s.site_id = ?
      WHERE i.tipe = 'bmhp' AND i.is_active = 1 AND i.deleted_at IS NULL
        AND (i.nama LIKE ? OR i.kode LIKE ?)
      ORDER BY (COALESCE(s.qty_on_hand,0) > 0) DESC, i.nama
      LIMIT ${limitAman(limit)}`,
    [siteId, `%${q}%`, `${q}%`],
  );
}

/**
 * Menyimpan pengkajian awal beserta pemakaian BMHP.
 *
 * Satu transaksi mengerjakan empat hal sekaligus (CLAUDE.md §3.1):
 *   1. simpan/perbarui nurse_assessments
 *   2. potong stok tiap BMHP lewat kartu stok
 *   3. masukkan biaya BMHP ke tagihan kunjungan
 *   4. dorong status kunjungan ke `menunggu_dokter`
 *
 * Bila salah satu gagal — misalnya stok tidak cukup — SELURUHNYA dibatalkan.
 * Tidak mungkin ada stok terpotong tanpa tagihan, atau sebaliknya.
 *
 * Penyimpanan ulang menangani BMHP dengan cara mengembalikan seluruh
 * pemakaian sebelumnya (sebagai koreksi di kartu stok, bukan penghapusan
 * jejak) lalu menuliskan yang baru.
 */
export async function simpanPengkajian(
  visitId: number,
  siteId: number,
  nurseId: number,
  input: NurseAssessmentInput,
): Promise<{ assessmentId: number; totalBmhp: number }> {
  // Diperiksa ambangnya SETELAH transaksi berhasil — peringatan stok tidak
  // boleh ikut membatalkan pengkajian yang sudah sah.
  const tersentuh = new Set<number>();

  const hasil = await transaction(async (conn) => {
    const [visitRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, status, site_id FROM visits WHERE id = ? FOR UPDATE`,
      [visitId],
    );
    const visit = visitRows[0];
    if (!visit) throw new Error("Kunjungan tidak ditemukan.");
    if (visit.site_id !== siteId) {
      throw new Error("Kunjungan ini bukan milik cabang Anda.");
    }
    if (!STATUS_BOLEH_DIKAJI.includes(String(visit.status))) {
      throw new Error(
        "Kunjungan ini sudah lewat tahap perawat dan tidak bisa diubah dari sini.",
      );
    }

    // --- 1. Pengkajian -------------------------------------------------
    const kolom = [
      input.triase, input.keluhan_utama, input.riwayat_singkat ?? null,
      input.riwayat_pengobatan ?? null,
      input.td_sistolik ?? null, input.td_diastolik ?? null,
      input.nadi ?? null, input.respirasi ?? null, input.suhu ?? null,
      input.spo2 ?? null, input.kesadaran ?? null,
      input.keadaan_umum ?? null, input.keadaan_gizi ?? null,
      input.gcs_e ?? null, input.gcs_v ?? null, input.gcs_m ?? null,
      input.berat_badan ?? null, input.tinggi_badan ?? null,
      input.lingkar_perut ?? null, input.skala_nyeri ?? null,
      input.risiko_jatuh ?? null,
      input.status_alergi_dikonfirmasi ? 1 : 0,
      input.catatan ?? null,
    ];

    const [ass] = await conn.execute<ResultSetHeader>(
      `INSERT INTO nurse_assessments
         (visit_id, site_id, nurse_id, triase, keluhan_utama, riwayat_singkat,
          riwayat_pengobatan,
          td_sistolik, td_diastolik, nadi, respirasi, suhu, spo2, kesadaran,
          keadaan_umum, keadaan_gizi, gcs_e, gcs_v, gcs_m,
          berat_badan, tinggi_badan, lingkar_perut, skala_nyeri, risiko_jatuh,
          status_alergi_dikonfirmasi, catatan)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
          nurse_id = VALUES(nurse_id), triase = VALUES(triase),
          keluhan_utama = VALUES(keluhan_utama), riwayat_singkat = VALUES(riwayat_singkat),
          riwayat_pengobatan = VALUES(riwayat_pengobatan),
          td_sistolik = VALUES(td_sistolik), td_diastolik = VALUES(td_diastolik),
          nadi = VALUES(nadi), respirasi = VALUES(respirasi), suhu = VALUES(suhu),
          spo2 = VALUES(spo2), kesadaran = VALUES(kesadaran),
          keadaan_umum = VALUES(keadaan_umum), keadaan_gizi = VALUES(keadaan_gizi),
          gcs_e = VALUES(gcs_e), gcs_v = VALUES(gcs_v), gcs_m = VALUES(gcs_m),
          berat_badan = VALUES(berat_badan), tinggi_badan = VALUES(tinggi_badan),
          lingkar_perut = VALUES(lingkar_perut), skala_nyeri = VALUES(skala_nyeri),
          risiko_jatuh = VALUES(risiko_jatuh),
          status_alergi_dikonfirmasi = VALUES(status_alergi_dikonfirmasi),
          catatan = VALUES(catatan)`,
      [visitId, siteId, nurseId, ...kolom],
    );

    const [assRow] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM nurse_assessments WHERE visit_id = ?`,
      [visitId],
    );
    const assessmentId = Number(assRow[0]?.id ?? ass.insertId);

    // --- 2. Kembalikan BMHP lama (bila ini penyimpanan ulang) ----------
    const [lama] = await conn.execute<RowDataPacket[]>(
      `SELECT id, item_id, qty FROM nurse_bmhp_usage WHERE visit_id = ?`,
      [visitId],
    );
    for (const row of lama) {
      await batalkanPemotongan(conn, {
        siteId,
        itemId: Number(row.item_id),
        qty: Number(row.qty),
        refType: REF_BMHP,
        refId: Number(row.id),
        userId: nurseId,
        alasan: "pengkajian disimpan ulang",
      });
    }
    if (lama.length > 0) {
      await conn.execute(`DELETE FROM nurse_bmhp_usage WHERE visit_id = ?`, [visitId]);
    }

    // --- 3. BMHP baru: potong stok + catat pemakaian -------------------
    let totalBmhp = 0;
    const barisTagihan: {
      usageId: number;
      nama: string;
      qty: number;
      harga: number;
    }[] = [];

    /*
     * Kunci stok BMHP diambil lebih dulu menurut `item_id` — sama seperti
     * farmasi. Dua perawat yang mencatat kasa + plester dengan urutan
     * berbeda pada saat yang sama akan saling menunggu tanpa ini.
     */
    await kunciStok(conn, siteId, input.bmhp.map((b) => Number(b.item_id)));

    // Harga & nama BMHP dari katalog / kontrak penjamin, bukan formulir.
    const payerId = await payerIdKunjungan(conn, visitId);
    for (const b of input.bmhp) {
      const katalog = await hargaBarangBerlaku(conn, Number(b.item_id), payerId);
      const subtotal = b.qty * katalog.harga;
      totalBmhp += subtotal;

      const [use] = await conn.execute<ResultSetHeader>(
        `INSERT INTO nurse_bmhp_usage
           (visit_id, nurse_assessment_id, site_id, item_id, qty, satuan,
            harga_satuan, subtotal, recorded_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          visitId, assessmentId, siteId, b.item_id, b.qty, b.satuan,
          katalog.harga, subtotal, nurseId,
        ],
      );

      // Melempar StokTidakCukupError bila saldo kurang — seluruh transaksi
      // ikut dibatalkan, termasuk pengkajian di atas.
      const movementId = await kurangiStok(conn, {
        siteId,
        itemId: b.item_id,
        qty: b.qty,
        jenis: "keluar_bmhp",
        refType: REF_BMHP,
        refId: use.insertId,
        userId: nurseId,
      });

      tersentuh.add(Number(b.item_id));

      // Bukti pemotongan — NULL berarti stok belum dipotong.
      await conn.execute(
        `UPDATE nurse_bmhp_usage SET stock_movement_id = ? WHERE id = ?`,
        [movementId, use.insertId],
      );

      barisTagihan.push({
        usageId: use.insertId,
        nama: katalog.nama,
        qty: b.qty,
        harga: katalog.harga,
      });
    }

    // --- 4. Tagihan ----------------------------------------------------
    const billingId = await pastikanTagihan(conn, visitId, siteId);
    await hapusBarisTagihanByRef(conn, billingId, REF_BMHP);
    for (const b of barisTagihan) {
      await tambahBarisTagihan(conn, {
        billingId,
        kategori: "bmhp",
        deskripsi: b.nama,
        qty: b.qty,
        hargaSatuan: b.harga,
        refType: REF_BMHP,
        refId: b.usageId,
      });
    }
    await hitungUlangTagihan(conn, billingId);

    // --- 5. Dorong status kunjungan ------------------------------------
    await conn.execute(
      `UPDATE visits SET status = 'menunggu_dokter' WHERE id = ?`,
      [visitId],
    );
    await conn.execute(
      `UPDATE queues SET status = 'dilayani' WHERE visit_id = ? AND status IN ('menunggu','dipanggil')`,
      [visitId],
    );

    // --- 6. Serah terima ke dokter -------------------------------------
    /*
     * Ditujukan ke DOKTER TERTENTU, bukan siaran ke seluruh dokter di
     * cabang: satu poli bisa punya beberapa dokter praktik bersamaan, dan
     * memberi tahu semuanya membuat notifikasi jadi kebisingan yang lalu
     * diabaikan — termasuk saat isinya benar-benar penting.
     *
     * Yang dipilih adalah dokter yang BENAR-BENAR melayani: bila ada dokter
     * pengganti, dialah yang menerima, bukan dokter terjadwal yang sedang
     * berhalangan (docs/DATABASE.md §3.9).
     */
    const [tujuanRows] = await conn.execute<RowDataPacket[]>(
      `SELECT COALESCE(v.substitute_doctor_id, v.doctor_id) AS dokter,
              p.nama AS pasien, p.no_rm, q.prefix, q.nomor
         FROM visits v
         JOIN patients p ON p.id = v.patient_id
         LEFT JOIN queues q ON q.visit_id = v.id
        WHERE v.id = ?`,
      [visitId],
    );
    const tujuan = tujuanRows[0];

    if (tujuan?.dokter) {
      const antrean = tujuan.prefix
        ? `${String(tujuan.prefix)}${String(tujuan.nomor).padStart(3, "0")} — `
        : "";
      const ttv =
        input.td_sistolik && input.td_diastolik
          ? `TD ${input.td_sistolik}/${input.td_diastolik}`
          : null;

      await kirimNotifikasi(
        { userId: Number(tujuan.dokter) },
        {
          jenis: "triase_selesai",
          judul: `${antrean}${String(tujuan.pasien)}`,
          // Triase ikut disebut supaya dokter bisa mendahulukan yang gawat
          // tanpa harus membuka satu per satu.
          pesan: [
            `Triase ${input.triase}`,
            ttv,
            input.keluhan_utama.slice(0, 60),
          ].filter(Boolean).join(" · "),
          link: `/rme/${visitId}`,
          siteId,
        },
        conn,
      );
    }

    return { assessmentId, totalBmhp };
  });

  await periksaAmbangStok(siteId, [...tersentuh]);

  return hasil;
}

export type LogBmhp = RowDataPacket & {
  id: number;
  waktu: string;
  nama_item: string;
  kode: string;
  qty: string;
  satuan: string;
  subtotal: string;
  nama_pasien: string;
  no_rm: string;
  perawat: string;
  stock_movement_id: number | null;
  sisa_stok: string | null;
};

/** Log pemakaian BMHP + saldo stok setelah pemotongan (kartu stok). */
export async function logBmhp(
  siteId: number | null,
  tanggal: string,
): Promise<LogBmhp[]> {
  return query<LogBmhp>(
    `SELECT u.id, u.created_at AS waktu, i.nama AS nama_item, i.kode,
            u.qty, u.satuan, u.subtotal,
            p.nama AS nama_pasien, p.no_rm, n.nama AS perawat,
            u.stock_movement_id, m.qty_after AS sisa_stok
       FROM nurse_bmhp_usage u
       JOIN items i    ON i.id = u.item_id
       JOIN visits v   ON v.id = u.visit_id
       JOIN patients p ON p.id = v.patient_id
       JOIN users n    ON n.id = u.recorded_by
       LEFT JOIN stock_movements m ON m.id = u.stock_movement_id
      WHERE DATE(u.created_at) = ? AND (? IS NULL OR u.site_id = ?)
      ORDER BY u.created_at DESC`,
    [tanggal, siteId, siteId],
  );
}
