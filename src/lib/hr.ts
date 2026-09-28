import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { execute, query, queryOne, transaction } from "./db";
import { SQL_BERTUGAS_DI_CABANG } from "./auth";
import { kirimNotifikasi } from "./notifications";
import { hariDalamMinggu, rentangTanggal } from "./tanggal";
import type {
  CutiInput,
  JadwalInput,
  PengecualianInput,
} from "./validations/hr";

// ---------------------------------------------------------------------
// Jadwal praktik
// ---------------------------------------------------------------------

export type JadwalRow = RowDataPacket & {
  id: number;
  doctor_id: number;
  dokter_nama: string;
  gelar_depan: string | null;
  poli_id: number;
  poli_nama: string;
  hari: number;
  jam_mulai: string;
  jam_selesai: string;
  kuota: number;
  is_active: number;
};

export async function daftarJadwal(siteId: number | null): Promise<JadwalRow[]> {
  return query<JadwalRow>(
    `SELECT ds.id, ds.doctor_id, u.nama AS dokter_nama, dp.gelar_depan,
            ds.poli_id, pol.nama AS poli_nama,
            ds.hari, ds.jam_mulai, ds.jam_selesai, ds.kuota, ds.is_active
       FROM doctor_schedules ds
       JOIN users u  ON u.id = ds.doctor_id
       JOIN polis pol ON pol.id = ds.poli_id
       LEFT JOIN doctor_profiles dp ON dp.user_id = ds.doctor_id
      WHERE ds.is_active = 1 AND (? IS NULL OR ds.site_id = ?)
      ORDER BY ds.hari, ds.jam_mulai, u.nama`,
    [siteId, siteId],
  );
}

export async function tambahJadwal(
  input: JadwalInput,
  siteId: number,
  userId: number,
): Promise<number> {
  return transaction(async (conn) => {
    /*
     * Bentrok jadwal dicek sebagai irisan rentang waktu, bukan kesamaan
     * jam persis: dokter tidak bisa ada di dua poli pada waktu yang
     * beririsan, meskipun jamnya tidak identik.
     */
    const [bentrok] = await conn.execute<RowDataPacket[]>(
      `SELECT ds.id, pol.nama AS poli
         FROM doctor_schedules ds JOIN polis pol ON pol.id = ds.poli_id
        WHERE ds.site_id = ? AND ds.doctor_id = ? AND ds.hari = ?
          AND ds.is_active = 1
          AND ds.jam_mulai < ? AND ds.jam_selesai > ?
        LIMIT 1`,
      [siteId, input.doctor_id, input.hari, input.jam_selesai, input.jam_mulai],
    );
    if (bentrok[0]) {
      throw new Error(
        `Bentrok dengan jadwal yang sudah ada di ${String(bentrok[0].poli)}.`,
      );
    }

    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO doctor_schedules
         (site_id, doctor_id, poli_id, hari, jam_mulai, jam_selesai, kuota, created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        siteId, input.doctor_id, input.poli_id, input.hari,
        input.jam_mulai, input.jam_selesai, input.kuota, userId,
      ],
    );
    return res.insertId;
  });
}

/** Menonaktifkan jadwal — riwayat kunjungan yang merujuknya tetap utuh. */
export async function nonaktifkanJadwal(id: number, siteId: number): Promise<void> {
  await execute(
    `UPDATE doctor_schedules SET is_active = 0 WHERE id = ? AND site_id = ?`,
    [id, siteId],
  );
}

// ---------------------------------------------------------------------
// Pengecualian jadwal & dokter pengganti
// ---------------------------------------------------------------------

export type PengecualianRow = RowDataPacket & {
  id: number;
  tanggal: string;
  jenis: string;
  status: string;
  alasan: string | null;
  jam_mulai: string | null;
  jam_selesai: string | null;
  doctor_id: number;
  dokter_nama: string;
  substitute_doctor_id: number | null;
  pengganti_nama: string | null;
  approver_nama: string | null;
  approved_at: string | null;
  created_at: string;
};

const SELECT_PENGECUALIAN = `
  SELECT se.id, se.tanggal, se.jenis, se.status, se.alasan,
         se.jam_mulai, se.jam_selesai, se.doctor_id,
         u.nama AS dokter_nama,
         se.substitute_doctor_id, s.nama AS pengganti_nama,
         a.nama AS approver_nama, se.approved_at, se.created_at
    FROM schedule_exceptions se
    JOIN users u ON u.id = se.doctor_id
    LEFT JOIN users s ON s.id = se.substitute_doctor_id
    LEFT JOIN users a ON a.id = se.approved_by
`;

export async function daftarPengecualian(
  siteId: number | null,
  dariTanggal: string,
): Promise<PengecualianRow[]> {
  return query<PengecualianRow>(
    `${SELECT_PENGECUALIAN}
      WHERE se.tanggal >= ? AND (? IS NULL OR se.site_id = ?)
      ORDER BY se.tanggal, se.id DESC`,
    [dariTanggal, siteId, siteId],
  );
}

export async function tambahPengecualian(
  input: PengecualianInput,
  siteId: number,
  userId: number,
): Promise<number> {
  return transaction(async (conn) => {
    /*
     * Dokter yang dikecualikan harus bertugas di cabang ini.
     *
     * Penggantinya sudah diperiksa sejak awal, dokter utamanya tidak —
     * sehingga id dari cabang lain bisa masuk hanya dengan ditebak, dan
     * hasilnya adalah baris "cuti" milik cabang ini atas nama orang yang
     * tidak pernah praktik di sini. Pemeriksaan yang berlaku untuk
     * pengganti tidak punya alasan untuk tidak berlaku bagi yang digantikan.
     */
    const [dokterSah] = await conn.execute<RowDataPacket[]>(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = ? AND r.code = 'dokter' AND u.is_active = 1
          AND u.deleted_at IS NULL
          AND ${SQL_BERTUGAS_DI_CABANG}`,
      [input.doctor_id, siteId, siteId, siteId],
    );
    if (!dokterSah[0]) {
      throw new Error("Dokter ini tidak bertugas di cabang Anda.");
    }

    // Dokter pengganti harus benar-benar berperan sebagai dokter di cabang ini.
    if (input.substitute_doctor_id !== null) {
      const [sub] = await conn.execute<RowDataPacket[]>(
        `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
          WHERE u.id = ? AND r.code = 'dokter' AND u.is_active = 1
            AND u.deleted_at IS NULL
            AND ${SQL_BERTUGAS_DI_CABANG}`,
        [input.substitute_doctor_id, siteId, siteId, siteId],
      );
      if (!sub[0]) {
        throw new Error("Dokter pengganti tidak valid untuk cabang ini.");
      }

      // Pengganti sendiri tidak boleh sedang berhalangan di tanggal itu —
      // di cabang MANA PUN: dokter bisa bertugas di beberapa cabang, dan
      // cutinya tercatat di cabang tempat ia mengajukannya.
      const [subHalangan] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM schedule_exceptions
          WHERE doctor_id = ? AND tanggal = ?
            AND jenis IN ('libur','cuti','izin','sakit') AND status = 'disetujui'
          LIMIT 1`,
        [input.substitute_doctor_id, input.tanggal],
      );
      if (subHalangan[0]) {
        throw new Error(
          "Dokter pengganti juga berhalangan pada tanggal tersebut.",
        );
      }
    }

    const [dobel] = await conn.execute<RowDataPacket[]>(
      `SELECT id, jenis, substitute_doctor_id FROM schedule_exceptions
        WHERE site_id = ? AND doctor_id = ? AND tanggal = ? AND status <> 'ditolak'
        LIMIT 1 FOR UPDATE`,
      [siteId, input.doctor_id, input.tanggal],
    );
    if (dobel[0]) {
      /*
       * Menetapkan pengganti untuk hari yang SUDAH tercatat berhalangan —
       * kasus paling umum: cuti disetujui (putuskanCuti membuat baris per
       * hari tanpa pengganti), lalu admin mencarikan penggantinya. Baris
       * itu dilengkapi, bukan ditolak; tanpa ini pasien dokter tersebut
       * tidak bisa didaftarkan sepanjang masa cutinya.
       */
      const halangan = ["libur", "cuti", "izin", "sakit"];
      if (
        input.substitute_doctor_id !== null &&
        halangan.includes(input.jenis) &&
        halangan.includes(String(dobel[0].jenis)) &&
        dobel[0].substitute_doctor_id === null
      ) {
        await conn.execute(
          `UPDATE schedule_exceptions SET substitute_doctor_id = ? WHERE id = ?`,
          [input.substitute_doctor_id, dobel[0].id],
        );
        return Number(dobel[0].id);
      }
      throw new Error(
        dobel[0].substitute_doctor_id === null
          ? "Sudah ada pengecualian untuk dokter ini pada tanggal tersebut."
          : "Dokter ini sudah punya pengganti pada tanggal tersebut.",
      );
    }

    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO schedule_exceptions
         (site_id, doctor_id, tanggal, jenis, substitute_doctor_id,
          jam_mulai, jam_selesai, alasan, created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        siteId, input.doctor_id, input.tanggal, input.jenis,
        input.substitute_doctor_id, input.jam_mulai ?? null,
        input.jam_selesai ?? null, input.alasan ?? null, userId,
      ],
    );
    return res.insertId;
  });
}

export async function putuskanPengecualian(
  id: number,
  siteId: number,
  approverId: number,
  setuju: boolean,
): Promise<void> {
  await execute(
    `UPDATE schedule_exceptions
        SET status = ?, approved_by = ?, approved_at = NOW()
      WHERE id = ? AND site_id = ? AND status = 'pending'`,
    [setuju ? "disetujui" : "ditolak", approverId, id, siteId],
  );
}

// ---------------------------------------------------------------------
// Resolusi: siapa yang benar-benar bertugas pada satu tanggal
// ---------------------------------------------------------------------

export type DokterBertugas = {
  doctor_id: number;
  nama: string;
  poli_id: number;
  poli_nama: string;
  jam_mulai: string;
  jam_selesai: string;
  kuota: number;
  /** Terisi bila dokter terjadwal berhalangan dan sudah ditetapkan penggantinya. */
  substitute_doctor_id: number | null;
  pengganti_nama: string | null;
  /** Dokter terjadwal berhalangan dan TIDAK ada pengganti. */
  kosong: boolean;
  keterangan: string | null;
};

/**
 * Menghitung siapa yang bertugas pada satu tanggal — jadwal mingguan
 * dikurangi pengecualian yang disetujui, ditambah pengganti dan jadwal
 * tambahan.
 *
 * Inilah sumber tunggal yang dipakai layar pendaftaran, sehingga petugas
 * frontdesk tidak mungkin mendaftarkan pasien ke dokter yang sedang cuti
 * (CLAUDE.md §4 — fitur Assign Dokter Pengganti).
 */
export async function dokterBertugas(
  siteId: number,
  tanggal: string,
): Promise<DokterBertugas[]> {
  const hari = hariDalamMinggu(tanggal);

  const rows = await query<RowDataPacket & {
    doctor_id: number;
    nama: string;
    poli_id: number;
    poli_nama: string;
    jam_mulai: string;
    jam_selesai: string;
    kuota: number;
    jenis: string | null;
    substitute_doctor_id: number | null;
    pengganti_nama: string | null;
    ex_jam_mulai: string | null;
    ex_jam_selesai: string | null;
  }>(
    `SELECT ds.doctor_id, u.nama, ds.poli_id, pol.nama AS poli_nama,
            ds.jam_mulai, ds.jam_selesai, ds.kuota,
            se.jenis, se.substitute_doctor_id, s.nama AS pengganti_nama,
            se.jam_mulai AS ex_jam_mulai, se.jam_selesai AS ex_jam_selesai
       FROM doctor_schedules ds
       JOIN users u   ON u.id = ds.doctor_id
       JOIN polis pol ON pol.id = ds.poli_id
       LEFT JOIN schedule_exceptions se
              ON se.site_id = ds.site_id
             AND se.doctor_id = ds.doctor_id
             AND se.tanggal = ?
             AND se.status = 'disetujui'
             AND se.jenis <> 'tambahan'
       LEFT JOIN users s ON s.id = se.substitute_doctor_id
      WHERE ds.site_id = ? AND ds.hari = ? AND ds.is_active = 1
        AND (ds.berlaku_dari IS NULL OR ds.berlaku_dari <= ?)
        AND (ds.berlaku_sampai IS NULL OR ds.berlaku_sampai >= ?)
      ORDER BY ds.jam_mulai, u.nama`,
    [tanggal, siteId, hari, tanggal, tanggal],
  );

  const hasil: DokterBertugas[] = rows.map((r) => {
    const berhalangan =
      r.jenis !== null && ["libur", "cuti", "izin", "sakit"].includes(r.jenis);

    return {
      doctor_id: r.doctor_id,
      nama: r.nama,
      poli_id: r.poli_id,
      poli_nama: r.poli_nama,
      // `ganti_jam` menimpa jam praktik hari itu.
      jam_mulai: r.ex_jam_mulai ?? r.jam_mulai,
      jam_selesai: r.ex_jam_selesai ?? r.jam_selesai,
      kuota: r.kuota,
      substitute_doctor_id: berhalangan ? r.substitute_doctor_id : null,
      pengganti_nama: berhalangan ? r.pengganti_nama : null,
      kosong: berhalangan && r.substitute_doctor_id === null,
      keterangan: r.jenis,
    };
  });

  // Jadwal tambahan: dokter yang hari itu praktik meski tidak terjadwal rutin.
  const tambahan = await query<RowDataPacket & {
    doctor_id: number;
    nama: string;
    jam_mulai: string | null;
    jam_selesai: string | null;
  }>(
    `SELECT se.doctor_id, u.nama, se.jam_mulai, se.jam_selesai
       FROM schedule_exceptions se
       JOIN users u ON u.id = se.doctor_id
      WHERE se.site_id = ? AND se.tanggal = ?
        AND se.jenis = 'tambahan' AND se.status = 'disetujui'`,
    [siteId, tanggal],
  );

  /*
   * Poli bawaan dibaca SEKALI di luar loop.
   *
   * Sebelumnya kueri ini berada di dalam perulangan, sehingga sepuluh
   * jadwal tambahan berarti sepuluh perjalanan bolak-balik untuk jawaban
   * yang persis sama. Jumlahnya memang kecil, tetapi pola kueri-di-dalam-
   * loop adalah pola yang menyebar ke tempat lain kalau dibiarkan berdiri.
   */
  const poliBawaan = tambahan.length === 0
    ? null
    : await queryOne<RowDataPacket & { id: number; nama: string }>(
        `SELECT id, nama FROM polis WHERE (site_id = ? OR site_id IS NULL) AND is_active = 1
          ORDER BY site_id IS NULL LIMIT 1`,
        [siteId],
      );

  for (const t of tambahan) {
    if (hasil.some((h) => h.doctor_id === t.doctor_id)) continue;
    const poli = poliBawaan;
    hasil.push({
      doctor_id: t.doctor_id,
      nama: t.nama,
      poli_id: poli?.id ?? 0,
      poli_nama: poli?.nama ?? "—",
      jam_mulai: t.jam_mulai ?? "00:00:00",
      jam_selesai: t.jam_selesai ?? "23:59:00",
      kuota: 0,
      substitute_doctor_id: null,
      pengganti_nama: null,
      kosong: false,
      keterangan: "tambahan",
    });
  }

  return hasil;
}

/**
 * Mencari pengganti yang disetujui untuk seorang dokter pada satu tanggal.
 * Dipakai saat pendaftaran, supaya `visits.substitute_doctor_id` terisi
 * otomatis dan laporan produktivitas dokter tetap akurat
 * (docs/DATABASE.md §3.9).
 */
export async function penggantiUntuk(
  siteId: number,
  doctorId: number,
  tanggal: string,
): Promise<{ id: number; nama: string } | null> {
  const row = await queryOne<RowDataPacket & { id: number; nama: string }>(
    `SELECT s.id, s.nama
       FROM schedule_exceptions se
       JOIN users s ON s.id = se.substitute_doctor_id
      WHERE se.site_id = ? AND se.doctor_id = ? AND se.tanggal = ?
        AND se.status = 'disetujui'
        AND se.jenis IN ('libur','cuti','izin','sakit')
        AND se.substitute_doctor_id IS NOT NULL
      LIMIT 1`,
    [siteId, doctorId, tanggal],
  );
  return row ? { id: row.id, nama: row.nama } : null;
}

/** Dokter yang berhalangan pada satu tanggal, terlepas dari ada penggantinya. */
export async function dokterBerhalangan(
  siteId: number,
  tanggal: string,
): Promise<number[]> {
  const rows = await query<RowDataPacket & { doctor_id: number }>(
    `SELECT doctor_id FROM schedule_exceptions
      WHERE site_id = ? AND tanggal = ? AND status = 'disetujui'
        AND jenis IN ('libur','cuti','izin','sakit')`,
    [siteId, tanggal],
  );
  return rows.map((r) => r.doctor_id);
}

// ---------------------------------------------------------------------
// Cuti & izin
// ---------------------------------------------------------------------

export type CutiRow = RowDataPacket & {
  id: number;
  user_id: number;
  pegawai: string;
  role_nama: string;
  jenis: string;
  tanggal_mulai: string;
  tanggal_akhir: string;
  jumlah_hari: number;
  alasan: string | null;
  status: string;
  approver_nama: string | null;
  approved_at: string | null;
  catatan_approval: string | null;
  created_at: string;
  lampiran_path: string | null;
};

export async function daftarCuti(
  siteId: number | null,
  status?: string,
): Promise<CutiRow[]> {
  return query<CutiRow>(
    `SELECT lr.id, lr.user_id, lr.lampiran_path, u.nama AS pegawai, r.nama AS role_nama,
            lr.jenis, lr.tanggal_mulai, lr.tanggal_akhir, lr.jumlah_hari,
            lr.alasan, lr.status, a.nama AS approver_nama, lr.approved_at,
            lr.catatan_approval, lr.created_at
       FROM leave_requests lr
       JOIN users u ON u.id = lr.user_id
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN users a ON a.id = lr.approved_by
      WHERE (? IS NULL OR lr.site_id = ?)
        AND (? IS NULL OR lr.status = ?)
      ORDER BY FIELD(lr.status,'pending','disetujui','ditolak','dibatalkan'),
               lr.tanggal_mulai DESC`,
    [siteId, siteId, status ?? null, status ?? null],
  );
}

export async function ajukanCuti(
  input: CutiInput & { lampiran_path?: string | null },
  siteId: number,
): Promise<number> {
  return transaction(async (conn) => {
    const mulai = new Date(input.tanggal_mulai);
    const akhir = new Date(input.tanggal_akhir);
    const hari = Math.round((akhir.getTime() - mulai.getTime()) / 86400000) + 1;

    // Pemohon harus bertugas di cabang ini — pengajuan cuti membuat baris
    // yang terhitung di laporan SDM cabang, dan sejak perbaikan lintas
    // cabang ia juga bisa MENGHALANGI pendaftaran pasien di cabang lain.
    const [pegawaiSah] = await conn.execute<RowDataPacket[]>(
      `SELECT u.id FROM users u
        WHERE u.id = ? AND u.is_active = 1 AND u.deleted_at IS NULL
          AND ${SQL_BERTUGAS_DI_CABANG}`,
      [input.user_id, siteId, siteId, siteId],
    );
    if (!pegawaiSah[0]) {
      throw new Error("Pegawai ini tidak terdaftar di cabang Anda.");
    }

    // Pengajuan yang beririsan tanggal ditolak — satu orang tidak bisa
    // punya dua status ketidakhadiran pada hari yang sama.
    const [tumpang] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM leave_requests
        WHERE user_id = ? AND status IN ('pending','disetujui')
          AND tanggal_mulai <= ? AND tanggal_akhir >= ?
        LIMIT 1`,
      [input.user_id, input.tanggal_akhir, input.tanggal_mulai],
    );
    if (tumpang[0]) {
      throw new Error(
        "Sudah ada pengajuan yang beririsan dengan rentang tanggal ini.",
      );
    }

    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO leave_requests
         (site_id, user_id, jenis, tanggal_mulai, tanggal_akhir, jumlah_hari,
          alasan, lampiran_path)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        siteId, input.user_id, input.jenis,
        input.tanggal_mulai, input.tanggal_akhir, hari, input.alasan ?? null,
        input.lampiran_path ?? null,
      ],
    );

    // Siaran ke peran Admin Cabang: pengajuan yang menunggu adalah antrean
    // kerja, dan cabang bisa punya lebih dari satu admin.
    const [pemohon] = await conn.execute<RowDataPacket[]>(
      `SELECT nama FROM users WHERE id = ?`,
      [input.user_id],
    );
    await kirimNotifikasi(
      { roleCode: "admin_cabang", siteId },
      {
        jenis: "cuti_diajukan",
        judul: `Pengajuan ${input.jenis.replace(/_/g, " ")} — ${String(pemohon[0]?.nama ?? "")}`,
        pesan: `${input.tanggal_mulai} s.d. ${input.tanggal_akhir} (${hari} hari).`,
        link: "/hr/cuti",
        siteId,
      },
      conn,
    );

    return res.insertId;
  });
}

/**
 * Menyetujui cuti. Bila pemohon adalah dokter, pengecualian jadwal untuk
 * setiap hari dalam rentang dibuat otomatis — supaya cuti yang disetujui
 * langsung terlihat di layar pendaftaran, tanpa admin perlu menginput dua kali.
 */
export async function putuskanCuti(
  id: number,
  siteId: number,
  approverId: number,
  setuju: boolean,
  catatan?: string | null,
): Promise<{ pengecualianDibuat: number }> {
  return transaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT lr.*, r.code AS role_code
         FROM leave_requests lr
         JOIN users u ON u.id = lr.user_id
         JOIN roles r ON r.id = u.role_id
        WHERE lr.id = ? AND lr.site_id = ? FOR UPDATE`,
      [id, siteId],
    );
    const cuti = rows[0];
    if (!cuti) throw new Error("Pengajuan tidak ditemukan.");
    if (cuti.status !== "pending") {
      throw new Error("Pengajuan ini sudah diputuskan sebelumnya.");
    }

    await conn.execute(
      `UPDATE leave_requests
          SET status = ?, approved_by = ?, approved_at = NOW(), catatan_approval = ?
        WHERE id = ?`,
      [setuju ? "disetujui" : "ditolak", approverId, catatan ?? null, id],
    );

    // Keputusan dikirim ke PEMOHON secara perorangan — ini kabar yang
    // hanya menyangkut dirinya, bukan antrean kerja bersama.
    await kirimNotifikasi(
      { userId: Number(cuti.user_id) },
      {
        jenis: "cuti_diputuskan",
        judul: setuju ? "Pengajuan cuti disetujui" : "Pengajuan cuti ditolak",
        pesan:
          `${String(cuti.tanggal_mulai).slice(0, 10)} s.d. ${String(cuti.tanggal_akhir).slice(0, 10)}` +
          (catatan ? ` — ${catatan}` : ""),
        link: "/hr/cuti",
        siteId,
      },
      conn,
    );

    if (!setuju || cuti.role_code !== "dokter") {
      return { pengecualianDibuat: 0 };
    }

    const jenisMap: Record<string, string> = {
      cuti_tahunan: "cuti",
      cuti_melahirkan: "cuti",
      izin: "izin",
      sakit: "sakit",
      lainnya: "izin",
    };
    const jenis = jenisMap[String(cuti.jenis)] ?? "izin";

    let dibuat = 0;
    // Aritmetika pada string tanggal, bukan objek Date — bebas pergeseran zona.
    const tanggalCuti = rentangTanggal(
      String(cuti.tanggal_mulai).slice(0, 10),
      String(cuti.tanggal_akhir).slice(0, 10),
    );

    for (const tgl of tanggalCuti) {
      const [ada] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM schedule_exceptions
          WHERE site_id = ? AND doctor_id = ? AND tanggal = ? AND status <> 'ditolak'
          LIMIT 1`,
        [siteId, cuti.user_id, tgl],
      );
      if (ada[0]) continue;

      await conn.execute(
        `INSERT INTO schedule_exceptions
           (site_id, doctor_id, tanggal, jenis, alasan, status, approved_by, approved_at, created_by)
         VALUES (?,?,?,?,?, 'disetujui', ?, NOW(), ?)`,
        [
          siteId, cuti.user_id, tgl, jenis,
          `Otomatis dari pengajuan cuti #${id}`, approverId, approverId,
        ],
      );
      dibuat++;
    }

    return { pengecualianDibuat: dibuat };
  });
}

// ---------------------------------------------------------------------
// Absensi
// ---------------------------------------------------------------------

export type AbsensiRow = RowDataPacket & {
  user_id: number;
  pegawai: string;
  role_nama: string;
  absensi_id: number | null;
  jam_masuk: string | null;
  jam_pulang: string | null;
  status: string | null;
  catatan: string | null;
  sedang_cuti: number;
};

/**
 * Daftar absensi satu hari untuk SELURUH staf cabang — termasuk yang belum
 * absen, supaya yang belum hadir terlihat, bukan sekadar tidak muncul.
 *
 * "Staf cabang" berarti yang BERTUGAS di cabang ini, bukan yang cabang
 * induknya kebetulan ini. Sebelumnya penyaringnya `u.site_id = ?`, sehingga
 * dokter yang praktik di tiga cabang hanya bisa diabsen di satu — di dua
 * cabang lainnya ia tidak muncul sama sekali, padahal di sanalah ia hadir
 * hari itu. Penyaring yang sama sudah dipakai `daftarPegawai()`.
 *
 * Barisnya sendiri tetap satu per orang per hari (`uq_att`), jadi kehadiran
 * yang sudah dicatat di satu cabang ikut terlihat di cabang lain — dan itu
 * memang yang benar: orangnya hanya punya satu badan.
 */
export async function absensiHarian(
  siteId: number,
  tanggal: string,
): Promise<AbsensiRow[]> {
  return query<AbsensiRow>(
    `SELECT u.id AS user_id, u.nama AS pegawai, r.nama AS role_nama,
            a.id AS absensi_id, a.jam_masuk, a.jam_pulang, a.status, a.catatan,
            EXISTS(
              SELECT 1 FROM leave_requests lr
               WHERE lr.user_id = u.id AND lr.status = 'disetujui'
                 AND lr.tanggal_mulai <= ? AND lr.tanggal_akhir >= ?
            ) AS sedang_cuti
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN attendances a ON a.user_id = u.id AND a.tanggal = ?
      WHERE u.is_active = 1 AND u.deleted_at IS NULL
        AND ${SQL_BERTUGAS_DI_CABANG}
      ORDER BY r.id, u.nama`,
    [tanggal, tanggal, tanggal, siteId, siteId, siteId],
  );
}

export async function catatAbsensi(
  siteId: number,
  userId: number,
  tanggal: string,
  aksi: "masuk" | "pulang",
): Promise<void> {
  await transaction(async (conn) => {
    /*
     * Pembacaan biasa, BUKAN `FOR UPDATE` — lihat `pastikanTagihan()` di
     * `lib/billing.ts` untuk uraian lengkapnya.
     *
     * Mengunci baris yang belum ada berarti mengambil gap lock, dan
     * `INSERT` dari transaksi lain ke gap yang sama langsung menabraknya.
     * Terbukti 11 dari 12 percobaan pada `uji-konkurensi.ts` §5 — dengan
     * pemicu yang tidak bisa lebih biasa lagi: seluruh staf absen masuk
     * dalam rentang beberapa menit setiap pagi.
     *
     * Yang menjaga kebenarannya bukan kunci ini melainkan `uq_att`
     * (user_id, tanggal) di database.
     */
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, jam_masuk, jam_pulang FROM attendances
        WHERE user_id = ? AND tanggal = ?`,
      [userId, tanggal],
    );

    // Bila barisnya memang ada, barulah dikunci — lewat primary key,
    // sehingga yang diambil record lock, bukan gap.
    if (rows[0]) {
      await conn.execute(`SELECT id FROM attendances WHERE id = ? FOR UPDATE`, [rows[0].id]);
    }

    if (aksi === "masuk") {
      if (rows[0]?.jam_masuk) throw new Error("Jam masuk sudah tercatat.");
      await conn.execute(
        `INSERT INTO attendances (site_id, user_id, tanggal, jam_masuk, status, metode)
         VALUES (?,?,?,NOW(),'hadir','manual')
         ON DUPLICATE KEY UPDATE jam_masuk = NOW(), status = 'hadir'`,
        [siteId, userId, tanggal],
      );
      return;
    }

    if (!rows[0]?.jam_masuk) {
      throw new Error("Jam masuk belum tercatat — tidak bisa mencatat jam pulang.");
    }
    if (rows[0]?.jam_pulang) throw new Error("Jam pulang sudah tercatat.");

    await conn.execute(
      `UPDATE attendances SET jam_pulang = NOW() WHERE id = ?`,
      [rows[0].id],
    );
  });
}

export async function setStatusAbsensi(
  siteId: number,
  userId: number,
  tanggal: string,
  status: string,
  catatan?: string | null,
): Promise<void> {
  await execute(
    `INSERT INTO attendances (site_id, user_id, tanggal, status, metode, catatan)
     VALUES (?,?,?,?, 'manual', ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), catatan = VALUES(catatan)`,
    [siteId, userId, tanggal, status, catatan ?? null],
  );
}

// ---------------------------------------------------------------------
// Opsi bersama
// ---------------------------------------------------------------------

export type PegawaiOption = RowDataPacket & {
  id: number;
  nama: string;
  role_code: string;
  role_nama: string;
};

export async function daftarPegawai(siteId: number | null): Promise<PegawaiOption[]> {
  return query<PegawaiOption>(
    `SELECT u.id, u.nama, r.code AS role_code, r.nama AS role_nama
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.is_active = 1 AND u.deleted_at IS NULL
        AND ${SQL_BERTUGAS_DI_CABANG}
      ORDER BY r.id, u.nama`,
    [siteId, siteId, siteId],
  );
}

// ---------------------------------------------------------------------
// Jadwal pribadi dokter (layar "Jadwal Saya")
// ---------------------------------------------------------------------

/**
 * Jadwal tetap milik satu dokter.
 *
 * Berbeda dari `daftarJadwal` yang dipakai Admin Cabang: di sini dokter
 * hanya boleh melihat jadwalnya sendiri, dan `doctorId` selalu berasal
 * dari sesi — bukan dari parameter permintaan.
 */
export async function jadwalDokter(
  doctorId: number,
  siteId: number | null,
): Promise<JadwalRow[]> {
  return query<JadwalRow>(
    `SELECT ds.id, ds.doctor_id, u.nama AS dokter_nama, dp.gelar_depan,
            ds.poli_id, pol.nama AS poli_nama,
            ds.hari, ds.jam_mulai, ds.jam_selesai, ds.kuota, ds.is_active
       FROM doctor_schedules ds
       JOIN users u   ON u.id = ds.doctor_id
       JOIN polis pol ON pol.id = ds.poli_id
       LEFT JOIN doctor_profiles dp ON dp.user_id = ds.doctor_id
      WHERE ds.is_active = 1 AND ds.doctor_id = ?
        AND (? IS NULL OR ds.site_id = ?)
      ORDER BY ds.hari, ds.jam_mulai`,
    [doctorId, siteId, siteId],
  );
}

export type PengecualianDokter = RowDataPacket & {
  id: number;
  tanggal: string;
  jenis: string;
  status: string;
  alasan: string | null;
  jam_mulai: string | null;
  jam_selesai: string | null;
  pengganti_nama: string | null;
  /** Ia sendiri yang menggantikan dokter lain pada tanggal ini. */
  digantikan_untuk: string | null;
};

/**
 * Pengecualian jadwal yang menyangkut dokter ini — baik saat ia
 * berhalangan maupun saat ia ditetapkan sebagai dokter pengganti.
 * Keduanya sama-sama mengubah siapa yang praktik hari itu.
 */
export async function pengecualianDokter(
  doctorId: number,
  siteId: number | null,
  dari: string,
  sampai: string,
): Promise<PengecualianDokter[]> {
  return query<PengecualianDokter>(
    `SELECT se.id, se.tanggal, se.jenis, se.status, se.alasan,
            se.jam_mulai, se.jam_selesai,
            sub.nama AS pengganti_nama,
            CASE WHEN se.substitute_doctor_id = ? THEN utama.nama END AS digantikan_untuk
       FROM schedule_exceptions se
       JOIN users utama ON utama.id = se.doctor_id
       LEFT JOIN users sub ON sub.id = se.substitute_doctor_id
      WHERE (se.doctor_id = ? OR se.substitute_doctor_id = ?)
        AND se.tanggal BETWEEN ? AND ?
        AND (? IS NULL OR se.site_id = ?)
      ORDER BY se.tanggal, se.id`,
    [doctorId, doctorId, doctorId, dari, sampai, siteId, siteId],
  );
}

/** Beban pasien per hari untuk dokter ini — konteks di layar jadwal. */
export async function bebanDokter(
  doctorId: number,
  siteId: number | null,
  dari: string,
  sampai: string,
): Promise<(RowDataPacket & { tanggal: string; jumlah: number; selesai: number })[]> {
  return query(
    `SELECT v.tanggal,
            COUNT(*) AS jumlah,
            SUM(v.status = 'selesai') AS selesai
       FROM visits v
      WHERE (v.doctor_id = ? OR v.substitute_doctor_id = ?)
        AND v.status <> 'batal'
        AND v.tanggal BETWEEN ? AND ?
        AND (? IS NULL OR v.site_id = ?)
      GROUP BY v.tanggal
      ORDER BY v.tanggal`,
    [doctorId, doctorId, dari, sampai, siteId, siteId],
  );
}
