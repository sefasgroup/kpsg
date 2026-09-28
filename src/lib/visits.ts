import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { nextSequence, query, transaction } from "./db";
import { SQL_BERTUGAS_DI_CABANG } from "./auth";
import { kirimNotifikasi } from "./notifications";
import { lepasReservasiResep } from "./pharmacy";
import type { RoleCode } from "./rbac";
import type { VisitInput } from "./validations/patient";
import { periodeSekarang, tanggalKompak } from "./tanggal";

export type VisitRow = RowDataPacket & {
  id: number;
  no_visit: string;
  tanggal: string;
  waktu_daftar: string;
  status: string;
  jenis_kunjungan: "baru" | "lama";
  cara_bayar: string;
  patient_id: number;
  no_rm: string;
  nama: string;
  nik: string;
  tanggal_lahir: string;
  jenis_kelamin: "L" | "P";
  poli_nama: string;
  dokter_nama: string;
  dokter_pengganti: string | null;
  antrean: string | null;
  triase: string | null;
  didahulukan: number;
  alasan_didahulukan: string | null;
};

/**
 * Urutan antrean.
 *
 * Pasien yang ditandai Pendaftaran naik ke atas; sisanya tetap urut nomor.
 * Penanda ini dipakai — bukan `na.triase` — karena triase baru ada SETELAH
 * perawat memeriksa. Pada saat perawat memilih siapa yang dipanggil
 * berikutnya, triase seluruh pasien yang menunggu masih NULL.
 */
export const URUT_ANTREAN = `v.didahulukan DESC, q.nomor`;

const SELECT_VISIT = `
  SELECT v.id, v.no_visit, v.tanggal, v.waktu_daftar, v.status,
         v.jenis_kunjungan, v.cara_bayar, v.patient_id,
         v.didahulukan, v.alasan_didahulukan,
         p.no_rm, p.nama, p.nik, p.tanggal_lahir, p.jenis_kelamin,
         pol.nama AS poli_nama,
         d.nama AS dokter_nama,
         sub.nama AS dokter_pengganti,
         CONCAT(q.prefix, LPAD(q.nomor, 3, '0')) AS antrean,
         na.triase
    FROM visits v
    JOIN patients p  ON p.id = v.patient_id
    JOIN polis pol   ON pol.id = v.poli_id
    JOIN users d     ON d.id = v.doctor_id
    LEFT JOIN users sub ON sub.id = v.substitute_doctor_id
    LEFT JOIN queues q  ON q.visit_id = v.id
    LEFT JOIN nurse_assessments na ON na.visit_id = v.id
`;

/** Daftar kunjungan pada satu tanggal, untuk layar pendaftaran. */
export async function kunjunganTanggal(
  siteId: number | null,
  tanggal: string,
): Promise<VisitRow[]> {
  return query<VisitRow>(
    `${SELECT_VISIT}
      WHERE v.tanggal = ? AND (? IS NULL OR v.site_id = ?)
      ORDER BY v.waktu_daftar DESC`,
    [tanggal, siteId, siteId],
  );
}

/** Papan antrean: hanya yang belum selesai, urut nomor antrean. */
export async function antreanAktif(
  siteId: number | null,
  tanggal: string,
): Promise<VisitRow[]> {
  return query<VisitRow>(
    `${SELECT_VISIT}
      WHERE v.tanggal = ?
        AND (? IS NULL OR v.site_id = ?)
        AND v.status NOT IN ('selesai', 'batal')
      ORDER BY pol.nama, ${URUT_ANTREAN}`,
    [tanggal, siteId, siteId],
  );
}

/**
 * Kunjungan hari SEBELUMNYA yang belum selesai maupun dibatalkan.
 *
 * Layar Pendaftaran hanya menampilkan kunjungan hari ini — dan itu benar
 * untuk pekerjaan sehari-hari. Tetapi ia juga satu-satunya tempat kunjungan
 * bisa DIBATALKAN, sehingga kunjungan yang tertinggal semalam tidak punya
 * jalan keluar sama sekali: tidak muncul di unit mana pun, dan tidak bisa
 * ditutup dari mana pun.
 *
 * Daftar ini yang membuka jalan itu. Sengaja tidak dibatasi rentang hari:
 * kunjungan yang menggantung tiga minggu justru yang paling perlu dilihat.
 */
export async function kunjunganTertunda(
  siteId: number | null,
  tanggal: string,
): Promise<VisitRow[]> {
  return query<VisitRow>(
    `${SELECT_VISIT}
      WHERE v.tanggal < ?
        AND (? IS NULL OR v.site_id = ?)
        AND v.status NOT IN ('selesai','batal')
      ORDER BY v.tanggal DESC, v.waktu_daftar DESC`,
    [tanggal, siteId, siteId],
  );
}

export type PoliOption = RowDataPacket & {
  id: number;
  nama: string;
  prefix_antrean: string;
};

export async function daftarPoli(siteId: number | null): Promise<PoliOption[]> {
  return query<PoliOption>(
    `SELECT id, nama, prefix_antrean FROM polis
      WHERE is_active = 1 AND (site_id IS NULL OR ? IS NULL OR site_id = ?)
      ORDER BY nama`,
    [siteId, siteId],
  );
}

export type DokterOption = RowDataPacket & {
  id: number;
  nama: string;
  gelar_depan: string | null;
  spesialisasi: string | null;
  berhalangan: number;
  pengganti_nama: string | null;
  tanpa_pengganti: number;
};

/**
 * Daftar dokter untuk layar pendaftaran.
 *
 * `berhalangan` menandai dokter yang punya pengecualian jadwal disetujui
 * hari ini, dan `pengganti_nama` menyebut siapa yang menggantikannya.
 * Petugas frontdesk jadi tahu situasinya sebelum memilih — dan pilihan
 * tanpa pengganti ditolak di server (lihat daftarkanKunjungan).
 */
export async function daftarDokter(siteId: number | null): Promise<DokterOption[]> {
  return query<DokterOption>(
    `SELECT u.id, u.nama, dp.gelar_depan, dp.spesialisasi,
            (se.id IS NOT NULL) AS berhalangan,
            s.nama AS pengganti_nama,
            (se.id IS NOT NULL AND se.substitute_doctor_id IS NULL) AS tanpa_pengganti
       FROM users u
       JOIN roles r ON r.id = u.role_id AND r.code = 'dokter'
       LEFT JOIN doctor_profiles dp ON dp.user_id = u.id
       LEFT JOIN schedule_exceptions se
              ON se.doctor_id = u.id AND se.tanggal = CURDATE()
             AND se.status = 'disetujui'
             AND se.jenis IN ('libur','cuti','izin','sakit')
       LEFT JOIN users s ON s.id = se.substitute_doctor_id
      WHERE u.is_active = 1 AND u.deleted_at IS NULL
        AND ${SQL_BERTUGAS_DI_CABANG}
      ORDER BY (se.id IS NOT NULL), u.nama`,
    [siteId, siteId, siteId],
  );
}

/**
 * Mendaftarkan kunjungan + nomor antrean dalam satu transaksi.
 *
 * Nomor kunjungan dan nomor antrean sama-sama diambil dari `sequences`
 * dengan penguncian baris, jadi dua petugas frontdesk yang mendaftar
 * bersamaan tidak bisa mendapat nomor yang sama.
 *
 * `jenis_kunjungan` dihitung dari riwayat, bukan diinput petugas —
 * supaya tidak bisa salah isi.
 */
export async function daftarkanKunjungan(
  input: VisitInput,
  siteId: number,
  userId: number,
): Promise<{ id: number; no_visit: string; antrean: string }> {
  return transaction(async (conn) => {
    const [siteRows] = await conn.execute<RowDataPacket[]>(
      `SELECT kode FROM sites WHERE id = ?`,
      [siteId],
    );
    const kodeSite = String(siteRows[0]?.kode ?? "KPSG");

    /*
     * Pasien BOLEH datang lebih dari sekali dalam sehari — pagi dengan satu
     * keluhan, sore dengan keluhan lain. Itu dua kunjungan yang berbeda:
     * dua nomor antrean, dua rekam medis, dua tagihan.
     *
     * Yang tetap dilarang hanya berada di antrean poli yang SAMA dua kali
     * SEKALIGUS. Penjaga ini semula menolak semua pendaftaran kedua di poli
     * yang sama hari itu, termasuk ketika kunjungan pertamanya sudah tuntas —
     * dan itu memblokir pasien yang benar-benar kembali, bukan hanya salah
     * klik petugas.
     */
    const [dobel] = await conn.execute<RowDataPacket[]>(
      `SELECT v.id, CONCAT(q.prefix, LPAD(q.nomor, 3, '0')) AS antrean, v.status
         FROM visits v
         LEFT JOIN queues q ON q.visit_id = v.id
        WHERE v.site_id = ? AND v.patient_id = ? AND v.poli_id = ?
          AND v.tanggal = CURDATE()
          AND v.status NOT IN ('selesai','batal')
        LIMIT 1`,
      [siteId, input.patient_id, input.poli_id],
    );
    if (dobel.length > 0) {
      throw new Error(
        `Pasien masih dalam antrean poli ini hari ini (${String(dobel[0].antrean ?? "-")}, ` +
        `status ${String(dobel[0].status).replace(/_/g, " ")}). ` +
        "Selesaikan atau batalkan kunjungan itu dulu sebelum mendaftarkan yang baru.",
      );
    }

    const [riwayat] = await conn.execute<RowDataPacket[]>(
      `SELECT 1 FROM visits WHERE patient_id = ? AND status <> 'batal' LIMIT 1`,
      [input.patient_id],
    );
    const jenisKunjungan = riwayat.length > 0 ? "lama" : "baru";

    /*
     * Dokter pengganti diisi OTOMATIS dari pengecualian jadwal yang sudah
     * disetujui (CLAUDE.md §4). `doctor_id` tetap dokter terjadwal supaya
     * laporan produktivitas akurat; `substitute_doctor_id` mencatat siapa
     * yang benar-benar melayani (docs/DATABASE.md §3.9).
     */
    /*
     * Halangan dicari LINTAS CABANG, bukan hanya di cabang ini.
     *
     * Dokter yang cuti tidak setengah cuti: ia tidak ada di mana pun. Tetapi
     * `putuskanCuti()` hanya membuat pengecualian di cabang tempat cutinya
     * diajukan, sehingga sebelumnya dokter lintas cabang yang cuti di Pusat
     * tetap bisa didaftari pasien di Cimahi.
     *
     * Yang membuatnya bukan sekadar celah melainkan kontradiksi: layar
     * pendaftaran (`daftarDokter`) memang sudah menandainya "berhalangan"
     * TANPA penyaringan cabang. Jadi petugas melihat peringatan merah,
     * menekan Daftar, dan server menerimanya. Peringatan yang boleh
     * diabaikan lebih buruk daripada tidak ada peringatan.
     *
     * Pengecualian cabang ini didahulukan karena hanya pengganti dari
     * cabang inilah yang benar-benar bisa melayani pasiennya.
     */
    const [pengganti] = await conn.execute<RowDataPacket[]>(
      `SELECT se.site_id, se.substitute_doctor_id, s.nama AS cabang
         FROM schedule_exceptions se
         JOIN sites s ON s.id = se.site_id
        WHERE se.doctor_id = ? AND se.tanggal = CURDATE()
          AND se.status = 'disetujui'
          AND se.jenis IN ('libur','cuti','izin','sakit')
        ORDER BY (se.site_id = ?) DESC
        LIMIT 1`,
      [input.doctor_id, siteId],
    );

    const halangan = pengganti[0];
    if (halangan && Number(halangan.site_id) !== siteId) {
      throw new Error(
        `Dokter ini berhalangan hari ini menurut catatan cabang ${String(halangan.cabang)}. ` +
          "Tetapkan penggantinya di cabang ini lewat menu Dokter Pengganti, atau pilih dokter lain.",
      );
    }
    if (halangan && halangan.substitute_doctor_id === null) {
      throw new Error(
        "Dokter ini berhalangan hari ini dan belum ada penggantinya. Tetapkan pengganti dulu di menu Dokter Pengganti.",
      );
    }
    const substituteId = halangan?.substitute_doctor_id ?? null;

    const periode = periodeSekarang();
    const nomorVisit = await nextSequence(conn, siteId, "visit", periode);
    const noVisit = `${kodeSite}/V/${periode}/${String(nomorVisit).padStart(5, "0")}`;

    /*
     * Penjamin & nomor kepesertaan DIBEKUKAN di kunjungan.
     *
     * Keduanya bisa dibiarkan kosong lalu diambil dari data pasien — dan
     * itu justru yang harus dihindari. Kepesertaan berubah; kunjungan yang
     * sudah ditagihkan tidak boleh berpindah penjamin setahun kemudian
     * hanya karena kartu pasiennya diperbarui. Yang tercetak di berkas
     * klaim harus tetap sama dengan yang berlaku saat pasien dilayani.
     *
     * Bila petugas tidak mengisinya, nilai bawaan pasien dipakai sebagai
     * titik awal — tetapi disalin, bukan dirujuk.
     */
    const [bawaan] = await conn.execute<RowDataPacket[]>(
      `SELECT payer_id, no_anggota FROM patients WHERE id = ?`,
      [input.patient_id],
    );
    const payerId = input.payer_id ?? (bawaan[0]?.payer_id ?? null);
    const noAnggota =
      input.no_anggota ?? (payerId ? (bawaan[0]?.no_anggota ?? null) : null);

    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO visits
         (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
          substitute_doctor_id, jenis_kunjungan, cara_bayar, payer_id, no_anggota,
          rujukan_dari, didahulukan, alasan_didahulukan, status, registered_by)
       VALUES (?,?,?,CURDATE(),?,?,?,?,?,?,?,?,?,?,'menunggu_perawat',?)`,
      [
        siteId, input.patient_id, noVisit, input.poli_id, input.doctor_id,
        substituteId, jenisKunjungan, input.cara_bayar, payerId, noAnggota,
        input.rujukan_dari ?? null,
        input.didahulukan ? 1 : 0,
        input.didahulukan ? (input.alasan_didahulukan ?? null) : null,
        userId,
      ],
    );
    const visitId = res.insertId;

    // Nomor antrean di-reset harian per poli.
    const [poliRows] = await conn.execute<RowDataPacket[]>(
      `SELECT prefix_antrean FROM polis WHERE id = ?`,
      [input.poli_id],
    );
    const prefix = String(poliRows[0]?.prefix_antrean ?? "A");

    const hariIni = tanggalKompak();
    const nomorAntrean = await nextSequence(
      conn,
      siteId,
      `queue:${input.poli_id}`,
      hariIni,
    );

    await conn.execute(
      `INSERT INTO queues (site_id, visit_id, poli_id, tanggal, prefix, nomor)
       VALUES (?,?,?,CURDATE(),?,?)`,
      [siteId, visitId, input.poli_id, prefix, nomorAntrean],
    );

    const noAntrean = `${prefix}${String(nomorAntrean).padStart(3, "0")}`;

    /*
     * Serah terima ke perawat. Dikirim DI DALAM transaksi (`conn`) supaya
     * ikut batal bila pendaftarannya gagal — memberi tahu perawat ada pasien
     * yang sebenarnya tidak jadi terdaftar lebih buruk daripada diam.
     */
    const [pasien] = await conn.execute<RowDataPacket[]>(
      `SELECT nama, no_rm FROM patients WHERE id = ?`,
      [input.patient_id],
    );
    const [poliNama] = await conn.execute<RowDataPacket[]>(
      `SELECT nama FROM polis WHERE id = ?`,
      [input.poli_id],
    );

    await kirimNotifikasi(
      { roleCode: "perawat", siteId },
      {
        jenis: "pasien_baru",
        judul: `${noAntrean} — ${String(pasien[0]?.nama ?? "Pasien")}`,
        pesan:
          `${String(poliNama[0]?.nama ?? "Poli")} · No. RM ${String(pasien[0]?.no_rm ?? "-")}` +
          ` · menunggu pengkajian awal`,
        link: `/pengkajian/${visitId}`,
        siteId,
      },
      conn,
    );

    return { id: visitId, no_visit: noVisit, antrean: noAntrean };
  });
}

/** Kunjungan yang sudah dijalani pasien ini HARI INI, untuk peringatan di layar. */
export async function kunjunganPasienHariIni(
  patientId: number,
  siteId: number | null,
): Promise<(RowDataPacket & {
  id: number; antrean: string | null; poli_nama: string; status: string;
})[]> {
  return query(
    `SELECT v.id, CONCAT(q.prefix, LPAD(q.nomor, 3, '0')) AS antrean,
            pol.nama AS poli_nama, v.status
       FROM visits v
       JOIN polis pol ON pol.id = v.poli_id
       LEFT JOIN queues q ON q.visit_id = v.id
      WHERE v.patient_id = ? AND v.tanggal = CURDATE()
        AND (? IS NULL OR v.site_id = ?)
      ORDER BY v.waktu_daftar`,
    [patientId, siteId, siteId],
  );
}

/**
 * MEMBATALKAN KUNJUNGAN — pasien tidak jadi dilayani.
 *
 * Kasusnya sehari-hari: pasien pulang sebelum dipanggil, salah didaftarkan,
 * atau terdaftar dua kali. Sebelum ini tidak ada satu pun tempat di sistem
 * yang menyetel `visits.status = 'batal'` — enum-nya ada, kolom alasannya
 * ada, tetapi kunjungan yang tidak jadi dilayani hanya menggantung di
 * antrean selamanya.
 *
 * Yang ikut dibereskan sekaligus, karena membiarkannya berarti kerusakan
 * yang tak terlihat:
 *
 *   - Reservasi stok resep DILEPAS. Kalau tidak, obat tetap terkunci untuk
 *     pasien yang sudah pulang, dan tidak ada layar yang menunjukkan sebabnya.
 *   - Order lab yang berjalan ikut dibatalkan beserta tarifnya.
 *   - Tagihan ditandai `batal` — di sini itu memang benar dan final, karena
 *     kunjungannya sendiri yang batal.
 *
 * Ditolak bila pasien sudah membayar atau obatnya sudah diserahkan: yang
 * sudah terjadi tidak bisa dianggap tidak terjadi.
 */
export async function batalkanKunjungan(
  visitId: number,
  siteId: number,
  userId: number,
  alasan: string,
): Promise<{ noVisit: string; pasien: string; statusSebelum: string }> {
  return transaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT v.id, v.no_visit, v.status, v.site_id, v.doctor_id,
              v.substitute_doctor_id,
              bt.id AS billing_id, bt.status AS billing_status,
              p.nama, p.no_rm
         FROM visits v
         JOIN patients p ON p.id = v.patient_id
         LEFT JOIN billing_transactions bt ON bt.visit_id = v.id
        WHERE v.id = ? AND v.site_id = ?
        FOR UPDATE`,
      [visitId, siteId],
    );
    const v = rows[0];
    if (!v) throw new Error("Kunjungan tidak ditemukan.");
    if (v.status === "batal") throw new Error("Kunjungan ini sudah dibatalkan.");
    if (v.status === "selesai") {
      throw new Error(
        "Kunjungan ini sudah selesai — pelayanannya sudah diberikan dan tidak bisa dibatalkan.",
      );
    }
    if (v.billing_status === "lunas") {
      throw new Error(
        "Pasien sudah membayar. Batalkan pembayarannya di kasir lebih dulu, " +
        "baru kunjungannya bisa dibatalkan.",
      );
    }

    const [diserahkan] = await conn.execute<RowDataPacket[]>(
      `SELECT no_resep FROM prescriptions
        WHERE visit_id = ? AND status = 'diserahkan' LIMIT 1`,
      [visitId],
    );
    if (diserahkan[0]) {
      throw new Error(
        `Obat resep ${String(diserahkan[0].no_resep)} sudah diserahkan ke pasien — ` +
        "kunjungan yang obatnya sudah keluar tidak bisa dibatalkan.",
      );
    }

    // --- Resep: lepas kunci stok, lalu batalkan --------------------------
    const [resep] = await conn.execute<RowDataPacket[]>(
      `SELECT id, stok_direservasi FROM prescriptions
        WHERE visit_id = ? AND status <> 'batal' FOR UPDATE`,
      [visitId],
    );
    for (const r of resep) {
      if (Number(r.stok_direservasi) === 1) {
        await lepasReservasiResep(conn, Number(r.id), siteId);
      }
      await conn.execute(
        `UPDATE prescriptions SET status = 'batal', stok_direservasi = 0, alasan_batal = ?
          WHERE id = ?`,
        [`Kunjungan dibatalkan: ${alasan}`.slice(0, 255), r.id],
      );
    }

    // --- Lab: batalkan order yang belum selesai --------------------------
    const [order] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM lab_orders
        WHERE visit_id = ? AND status IN ('baru','diproses') FOR UPDATE`,
      [visitId],
    );
    for (const o of order) {
      await conn.execute(
        `UPDATE lab_orders
            SET status = 'batal', alasan_batal = ?, dibatalkan_by = ?, dibatalkan_at = NOW()
          WHERE id = ?`,
        [`Kunjungan dibatalkan: ${alasan}`.slice(0, 255), userId, o.id],
      );
      await conn.execute(
        `UPDATE lab_order_panels SET status = 'batal' WHERE order_id = ?`,
        [o.id],
      );
    }

    /*
     * Tagihan ditandai `batal` — dan di sinilah status itu memang tepat.
     * Satu kunjungan hanya punya satu tagihan, jadi `batal` bersifat final;
     * pada pembatalan pembayaran itu keliru, tetapi pada pembatalan
     * KUNJUNGAN justru itulah yang dimaksud.
     */
    if (v.billing_id) {
      await conn.execute(
        `UPDATE billing_transactions SET status = 'batal', alasan_batal = ? WHERE id = ?`,
        [`Kunjungan dibatalkan: ${alasan}`.slice(0, 255), v.billing_id],
      );
    }

    await conn.execute(
      `UPDATE visits
          SET status = 'batal', alasan_batal = ?, dibatalkan_by = ?, dibatalkan_at = NOW()
        WHERE id = ?`,
      [alasan.slice(0, 255), userId, visitId],
    );
    await conn.execute(
      `UPDATE queues SET status = 'batal' WHERE visit_id = ?`,
      [visitId],
    );

    /*
     * Unit yang sedang menunggu pasien ini diberi tahu — merekalah yang akan
     * memanggil nama yang tidak akan pernah menjawab. Tujuannya dipilih dari
     * status TERAKHIR sebelum batal, bukan disiarkan ke semua peran.
     */
    const TUJUAN: Record<string, RoleCode> = {
      terdaftar: "perawat",
      menunggu_perawat: "perawat",
      dikaji_perawat: "perawat",
      menunggu_lab: "petugas_lab",
      menunggu_farmasi: "farmasi",
      menunggu_kasir: "kasir",
      menunggu_obat: "farmasi",
    };
    const isi = {
      jenis: "kunjungan_batal",
      judul: `Kunjungan dibatalkan — ${String(v.nama)}`,
      pesan: `${String(v.no_visit)} · No. RM ${String(v.no_rm)} — ${alasan}`,
      link: `/pendaftaran`,
      siteId,
    } as const;

    const peran = TUJUAN[String(v.status)];
    if (peran) {
      await kirimNotifikasi({ roleCode: peran, siteId }, isi, conn);
    } else if (["menunggu_dokter", "dalam_pemeriksaan"].includes(String(v.status))) {
      await kirimNotifikasi(
        { userId: Number(v.substitute_doctor_id ?? v.doctor_id) },
        { ...isi, link: `/rme` },
        conn,
      );
    }

    return {
      noVisit: String(v.no_visit),
      pasien: String(v.nama),
      statusSebelum: String(v.status),
    };
  });
}
