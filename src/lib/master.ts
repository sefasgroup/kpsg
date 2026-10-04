import "server-only";
import { randomInt } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { execute, query, queryOne, transaction, limitAman } from "./db";
import { hashPassword } from "./auth";
import type {
  CabangInput,
  ItemInput,
  PenggunaInput,
} from "./validations/master";

// ---------------------------------------------------------------------
// Cabang
// ---------------------------------------------------------------------

export type CabangRow = RowDataPacket & {
  id: number;
  kode: string;
  nama: string;
  nama_legal: string | null;
  no_izin_klinik: string | null;
  alamat: string | null;
  kota: string | null;
  provinsi: string | null;
  telepon: string | null;
  email: string | null;
  is_active: number;
  jumlah_staf: number;
  jumlah_pasien: number;
};

/**
 * Pengaturan bawaan yang dibuat untuk SETIAP cabang baru.
 *
 * Nilainya sengaja konservatif: pembulatan dan biaya admin nol supaya cabang
 * baru tidak diam-diam menambah biaya yang belum disetujui, jasa racik nol
 * supaya apoteker terpaksa menetapkannya sendiri. Yang penting adalah
 * barisnya ADA sehingga bisa diubah lewat layar Pengaturan.
 */
const DEFAULT_SETTING_CABANG: readonly (readonly [string, string, string])[] = [
  ["billing.pembulatan", "0", "number"],
  // Sama dengan PAKET_BAWAAN (validations/cashier.ts) — perilaku cabang lama tanpa baris ini.
  ["billing.paket", "125000,130000,170000,175000", "string"],
  ["billing.biaya_admin", "0", "number"],
  ["racikan.jasa_racik_default", "0", "number"],
  ["antrean.reset_harian", "true", "boolean"],
  ["stok.peringatan_kadaluarsa_hari", "90", "number"],
  ["cetak.printer_thermal", "80", "number"],
];

export async function daftarCabang(): Promise<CabangRow[]> {
  return query<CabangRow>(
    `SELECT s.*,
            (SELECT COUNT(*) FROM users u
              WHERE u.site_id = s.id AND u.is_active = 1 AND u.deleted_at IS NULL) AS jumlah_staf,
            (SELECT COUNT(*) FROM patients p WHERE p.site_id = s.id) AS jumlah_pasien
       FROM sites s
      WHERE s.deleted_at IS NULL
      ORDER BY s.nama`,
  );
}

export async function simpanCabang(
  input: CabangInput,
  id?: number,
): Promise<number> {
  return transaction(async (conn) => {
    const [bentrok] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM sites WHERE kode = ? AND (? IS NULL OR id <> ?) LIMIT 1`,
      [input.kode, id ?? null, id ?? null],
    );
    if (bentrok[0]) throw new Error(`Kode cabang "${input.kode}" sudah dipakai.`);

    const kolom = [
      input.kode, input.nama, input.nama_legal ?? null,
      input.no_izin_klinik ?? null, input.alamat ?? null, input.kota ?? null,
      input.provinsi ?? null, input.telepon ?? null, input.email ?? null,
    ];

    if (id) {
      await conn.execute(
        `UPDATE sites SET kode=?, nama=?, nama_legal=?, no_izin_klinik=?,
                alamat=?, kota=?, provinsi=?, telepon=?, email=?
          WHERE id = ?`,
        [...kolom, id],
      );
      return id;
    }

    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO sites (kode, nama, nama_legal, no_izin_klinik, alamat,
                          kota, provinsi, telepon, email)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      kolom,
    );

    // Cabang baru butuh penomoran dokumennya sendiri sejak awal.
    for (const key of [
      "rm", "visit", "resep", "invoice", "lab", "surat", "penerimaan", "opname",
    ]) {
      await conn.execute(
        `INSERT INTO sequences (site_id, seq_key, periode, last_number)
         VALUES (?,?, '-', 0) ON DUPLICATE KEY UPDATE site_id = site_id`,
        [res.insertId, key],
      );
    }

    /*
     * ...dan pengaturannya sendiri. Tanpa baris-baris ini cabang baru tidak
     * punya satu pun setting, dan halaman Pengaturan cabang itu TAMPIL KOSONG
     * — Admin Cabang tidak punya cara membuatnya lewat UI, karena layar itu
     * hanya bisa mengubah nilai yang sudah ada.
     *
     * Pembacanya memang punya nilai cadangan, jadi tidak ada yang error; itu
     * justru masalahnya. Cabang kedua diam-diam berjalan dengan pembulatan 0
     * dan jasa racik 0 tanpa ada yang menyadarinya sampai struk pertama
     * dicetak. Cacat ini baru terlihat saat data contoh dikosongkan.
     */
    for (const [skey, svalue, tipe] of DEFAULT_SETTING_CABANG) {
      await conn.execute(
        `INSERT INTO settings (site_id, skey, svalue, tipe)
         VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE site_id = site_id`,
        [res.insertId, skey, svalue, tipe],
      );
    }

    return res.insertId;
  });
}

export async function setAktifCabang(id: number, aktif: boolean): Promise<void> {
  await execute(`UPDATE sites SET is_active = ? WHERE id = ?`, [aktif ? 1 : 0, id]);
}

// ---------------------------------------------------------------------
// Pengguna
// ---------------------------------------------------------------------

export type PenggunaRow = RowDataPacket & {
  id: number;
  nama: string;
  username: string;
  nip: string | null;
  email: string | null;
  telepon: string | null;
  is_active: number;
  must_change_pw: number;
  last_login_at: string | null;
  site_id: number | null;
  site_nama: string | null;
  role_code: string;
  role_nama: string;
  no_str: string | null;
  no_sip: string | null;
  spesialisasi: string | null;
  gelar_depan: string | null;
  tarif_konsultasi: string | null;
  /** Id cabang penugasan tambahan, dipisah koma. NULL bila tidak ada. */
  site_ids_tambahan: string | null;
  /** Nama cabang penugasan tambahan, untuk ditampilkan. */
  cabang_tambahan: string | null;
};

export async function daftarPengguna(): Promise<PenggunaRow[]> {
  return query<PenggunaRow>(
    `SELECT u.id, u.nama, u.username, u.nip, u.email, u.telepon,
            u.is_active, u.must_change_pw, u.last_login_at,
            u.site_id, s.nama AS site_nama,
            r.code AS role_code, r.nama AS role_nama,
            dp.no_str, dp.no_sip, dp.spesialisasi, dp.gelar_depan, dp.tarif_konsultasi,
            (SELECT GROUP_CONCAT(us.site_id) FROM user_sites us
              WHERE us.user_id = u.id) AS site_ids_tambahan,
            (SELECT GROUP_CONCAT(s2.nama ORDER BY s2.nama SEPARATOR ', ')
               FROM user_sites us JOIN sites s2 ON s2.id = us.site_id
              WHERE us.user_id = u.id) AS cabang_tambahan
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN sites s ON s.id = u.site_id
       LEFT JOIN doctor_profiles dp ON dp.user_id = u.id
      WHERE u.deleted_at IS NULL
      ORDER BY r.id, u.nama`,
  );
}

/** Password acak yang mudah dibacakan — dipakai saat membuat akun tanpa password. */
export function passwordSementara(): string {
  const abjad = "abcdefghjkmnpqrstuvwxyz";
  const angka = "23456789";
  // crypto.randomInt, bukan Math.random: keluaran Math.random bisa ditebak,
  // dan password sementara adalah kredensial sungguhan sampai diganti.
  const ambil = (s: string, n: number) =>
    Array.from({ length: n }, () => s[randomInt(s.length)]).join("");
  return `${ambil(abjad, 4)}-${ambil(angka, 4)}-${ambil(abjad, 3)}`;
}

export async function simpanPengguna(
  input: PenggunaInput,
  id?: number,
): Promise<{ id: number; passwordBaru: string | null }> {
  return transaction(async (conn) => {
    const [bentrok] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM users WHERE username = ? AND (? IS NULL OR id <> ?) LIMIT 1`,
      [input.username, id ?? null, id ?? null],
    );
    if (bentrok[0]) throw new Error(`Username "${input.username}" sudah dipakai.`);

    const [roleRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM roles WHERE code = ?`,
      [input.role_code],
    );
    if (!roleRows[0]) throw new Error("Peran tidak dikenal.");
    const roleId = Number(roleRows[0].id);

    let passwordBaru: string | null = null;
    let hash: string | null = null;

    if (!id) {
      passwordBaru = input.password ?? passwordSementara();
      hash = await hashPassword(passwordBaru);
    } else if (input.password) {
      passwordBaru = input.password;
      hash = await hashPassword(passwordBaru);
    }

    let userId: number;

    if (id) {
      /*
       * Jaring pengaman: sistem harus selalu punya minimal satu Super Admin
       * aktif. Tanpa ini, satu perubahan peran bisa mengunci semua orang
       * keluar dari pengaturan sistem secara permanen.
       */
      const [lamaRows] = await conn.execute<RowDataPacket[]>(
        `SELECT r.code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
        [id],
      );
      if (lamaRows[0]?.code === "super_admin" && input.role_code !== "super_admin") {
        const [sisa] = await conn.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id
            WHERE r.code = 'super_admin' AND u.is_active = 1
              AND u.deleted_at IS NULL AND u.id <> ?`,
          [id],
        );
        if (Number(sisa[0].n) === 0) {
          throw new Error(
            "Ini satu-satunya Super Admin aktif — perannya tidak boleh diturunkan.",
          );
        }
      }

      await conn.execute(
        `UPDATE users SET nama=?, username=?, role_id=?, site_id=?, nip=?,
                email=?, telepon=?${hash ? ", password_hash=?, must_change_pw=1" : ""}
          WHERE id = ?`,
        hash
          ? [input.nama, input.username, roleId, input.site_id, input.nip ?? null,
             input.email ?? null, input.telepon ?? null, hash, id]
          : [input.nama, input.username, roleId, input.site_id, input.nip ?? null,
             input.email ?? null, input.telepon ?? null, id],
      );
      userId = id;
    } else {
      const [res] = await conn.execute<ResultSetHeader>(
        `INSERT INTO users (site_id, role_id, nip, nama, username, email,
                            telepon, password_hash, must_change_pw)
         VALUES (?,?,?,?,?,?,?,?,1)`,
        [
          input.site_id, roleId, input.nip ?? null, input.nama, input.username,
          input.email ?? null, input.telepon ?? null, hash,
        ],
      );
      userId = res.insertId;
    }

    // Profil dokter menyusul perannya: dibuat saat jadi dokter, dibuang saat bukan.
    if (input.role_code === "dokter") {
      await conn.execute(
        `INSERT INTO doctor_profiles
           (user_id, no_str, no_sip, spesialisasi, gelar_depan, tarif_konsultasi)
         VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           no_str=VALUES(no_str), no_sip=VALUES(no_sip),
           spesialisasi=VALUES(spesialisasi), gelar_depan=VALUES(gelar_depan),
           tarif_konsultasi=VALUES(tarif_konsultasi)`,
        [
          userId, input.no_str ?? null, input.no_sip ?? null,
          input.spesialisasi ?? null, input.gelar_depan ?? null,
          input.tarif_konsultasi,
        ],
      );
    } else if (id) {
      await conn.execute(`DELETE FROM doctor_profiles WHERE user_id = ?`, [userId]);
    }

    /*
     * Penugasan cabang tambahan (`user_sites`) — mis. dokter yang praktik
     * di dua cabang.
     *
     * Ditulis ulang seluruhnya (hapus lalu isi) supaya penugasan yang
     * dicabut benar-benar hilang; menambah saja akan meninggalkan akses
     * lama yang tidak pernah bisa dicabut lewat form.
     *
     * Cabang induk sengaja DIBUANG dari daftar ini agar tidak tercatat
     * dua kali — `users.site_id` sudah mewakilinya, dan duplikasi membuat
     * pencabutan cabang induk jadi ambigu.
     */
    await conn.execute(`DELETE FROM user_sites WHERE user_id = ?`, [userId]);
    const tambahan = (input.site_ids ?? []).filter(
      (sid) => sid !== input.site_id,
    );
    for (const sid of new Set(tambahan)) {
      await conn.execute(
        `INSERT INTO user_sites (user_id, site_id) VALUES (?, ?)`,
        [userId, sid],
      );
    }

    return { id: userId, passwordBaru };
  });
}

export async function resetPasswordPengguna(
  id: number,
  password: string,
): Promise<void> {
  const hash = await hashPassword(password);
  await execute(
    `UPDATE users SET password_hash = ?, must_change_pw = 1 WHERE id = ?`,
    [hash, id],
  );
}

export async function setAktifPengguna(
  id: number,
  aktif: boolean,
  pelakuId: number,
): Promise<void> {
  await transaction(async (conn) => {
    if (id === pelakuId && !aktif) {
      throw new Error("Anda tidak bisa menonaktifkan akun Anda sendiri.");
    }
    if (!aktif) {
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT r.code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
        [id],
      );
      if (rows[0]?.code === "super_admin") {
        const [sisa] = await conn.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id
            WHERE r.code = 'super_admin' AND u.is_active = 1
              AND u.deleted_at IS NULL AND u.id <> ?`,
          [id],
        );
        if (Number(sisa[0].n) === 0) {
          throw new Error("Ini satu-satunya Super Admin aktif — tidak bisa dinonaktifkan.");
        }
      }
    }
    await conn.execute(`UPDATE users SET is_active = ? WHERE id = ?`, [aktif ? 1 : 0, id]);
  });
}

// ---------------------------------------------------------------------
// Poli & tindakan
// ---------------------------------------------------------------------

export async function daftarPoliMaster(siteId: number | null) {
  return query<RowDataPacket & {
    id: number; kode: string; nama: string; prefix_antrean: string;
    site_id: number | null; site_nama: string | null; is_active: number;
    jumlah_jadwal: number;
  }>(
    `SELECT p.id, p.kode, p.nama, p.prefix_antrean, p.site_id, p.is_active,
            s.nama AS site_nama,
            (SELECT COUNT(*) FROM doctor_schedules ds
              WHERE ds.poli_id = p.id AND ds.is_active = 1) AS jumlah_jadwal
       FROM polis p LEFT JOIN sites s ON s.id = p.site_id
      WHERE (? IS NULL OR p.site_id = ? OR p.site_id IS NULL)
      ORDER BY p.nama`,
    [siteId, siteId],
  );
}

export async function daftarTindakanMaster() {
  return query<RowDataPacket & {
    id: number; kode: string; nama: string; kategori: string | null;
    tarif: string; icd9cm: string | null; is_active: number; dipakai: number;
    is_konsultasi: number;
  }>(
    `SELECT mp.*, (SELECT COUNT(*) FROM assessment_procedures ap
                    WHERE ap.procedure_id = mp.id) AS dipakai
       FROM medical_procedures mp
      ORDER BY mp.kategori, mp.nama`,
  );
}

// ---------------------------------------------------------------------
// Katalog obat & BMHP
// ---------------------------------------------------------------------

export type ItemMaster = RowDataPacket & {
  id: number;
  kode: string;
  tipe: string;
  nama: string;
  nama_generik: string | null;
  kandungan: string | null;
  category_id: number | null;
  kategori: string | null;
  bentuk_sediaan: string | null;
  satuan_dasar: string;
  hpp: string;
  harga_jual: string;
  min_stock: number;
  is_racikable: number;
  butuh_resep: number;
  kfa_code: string | null;
  is_active: number;
  total_stok: string;
};

export async function daftarItemMaster(): Promise<ItemMaster[]> {
  return query<ItemMaster>(
    `SELECT i.*, ic.nama AS kategori,
            COALESCE((SELECT SUM(qty_on_hand) FROM item_stocks st
                       WHERE st.item_id = i.id), 0) AS total_stok
       FROM items i LEFT JOIN item_categories ic ON ic.id = i.category_id
      WHERE i.deleted_at IS NULL
      ORDER BY i.tipe, i.nama`,
  );
}

export async function daftarKategoriItem() {
  return query<RowDataPacket & { id: number; nama: string; tipe: string }>(
    `SELECT id, nama, tipe FROM item_categories ORDER BY tipe, nama`,
  );
}

export async function simpanItem(input: ItemInput, id?: number): Promise<number> {
  return transaction(async (conn) => {
    const [bentrok] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM items WHERE kode = ? AND (? IS NULL OR id <> ?) LIMIT 1`,
      [input.kode, id ?? null, id ?? null],
    );
    if (bentrok[0]) throw new Error(`Kode "${input.kode}" sudah dipakai.`);

    if (input.harga_jual < input.hpp) {
      throw new Error("Harga jual di bawah HPP — periksa kembali angkanya.");
    }

    const kolom = [
      input.kode, input.tipe, input.nama, input.nama_generik ?? null,
      input.kandungan ?? null, input.category_id, input.bentuk_sediaan ?? null,
      input.satuan_dasar, input.hpp, input.harga_jual, input.min_stock,
      input.is_racikable ? 1 : 0, input.butuh_resep ? 1 : 0, input.kfa_code ?? null,
    ];

    if (id) {
      await conn.execute(
        `UPDATE items SET kode=?, tipe=?, nama=?, nama_generik=?, kandungan=?,
                category_id=?, bentuk_sediaan=?, satuan_dasar=?, hpp=?,
                harga_jual=?, min_stock=?, is_racikable=?, butuh_resep=?, kfa_code=?
          WHERE id = ?`,
        [...kolom, id],
      );
      return id;
    }

    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO items (kode, tipe, nama, nama_generik, kandungan, category_id,
                          bentuk_sediaan, satuan_dasar, hpp, harga_jual,
                          min_stock, is_racikable, butuh_resep, kfa_code)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      kolom,
    );
    return res.insertId;
  });
}

export async function setAktifItem(id: number, aktif: boolean): Promise<void> {
  await execute(`UPDATE items SET is_active = ? WHERE id = ?`, [aktif ? 1 : 0, id]);
}

// ---------------------------------------------------------------------
// Panel & parameter lab
// ---------------------------------------------------------------------

export async function daftarPanelMaster() {
  return query<RowDataPacket & {
    id: number; kode: string; nama: string; kategori: string | null;
    tarif: string; is_active: number; jumlah_parameter: number;
  }>(
    `SELECT lp.*, (SELECT COUNT(*) FROM lab_parameters p
                    WHERE p.panel_id = lp.id AND p.is_active = 1)
              AS jumlah_parameter
       FROM lab_panels lp ORDER BY lp.kategori, lp.nama`,
  );
}

export async function parameterPanel(panelId: number) {
  return query<RowDataPacket & {
    id: number; kode: string; nama: string; satuan: string | null;
    tipe_nilai: string; pilihan: string[] | null;
    ref_low: string | null; ref_high: string | null; ref_teks: string | null;
    kritis_low: string | null; kritis_high: string | null; urutan: number;
    is_active: number; terpakai: number;
  }>(
    /*
     * `terpakai` menentukan parameter itu boleh DIHAPUS atau hanya boleh
     * DINONAKTIFKAN. Yang pernah dipakai memiliki baris di `lab_results`
     * dengan foreign key tanpa ON DELETE — penghapusannya akan ditolak
     * database, dan memaksanya berarti memusnahkan hasil pemeriksaan pasien
     * lama. Yang belum pernah dipakai boleh benar-benar dibuang; salah ketik
     * saat menyusun master data tidak perlu meninggalkan jejak selamanya.
     */
    `SELECT p.*,
            (SELECT COUNT(*) FROM lab_results lr WHERE lr.parameter_id = p.id) AS terpakai
       FROM lab_parameters p
      WHERE p.panel_id = ?
      ORDER BY p.is_active DESC, p.urutan, p.id`,
    [panelId],
  );
}

// ---------------------------------------------------------------------
// ICD-10
// ---------------------------------------------------------------------

export async function cariIcd10Master(keyword: string, limit = 100) {
  const q = keyword.trim();
  return query<RowDataPacket & {
    code: string; nama_id: string; nama_en: string | null;
    bab: string | null; is_active: number; dipakai: number;
  }>(
    `SELECT ic.*, (SELECT COUNT(*) FROM assessment_diagnoses ad
                    WHERE ad.icd10_code = ic.code) AS dipakai
       FROM icd10_codes ic
      WHERE (? = '' OR ic.code LIKE ? OR ic.nama_id LIKE ?)
      ORDER BY ic.code
      LIMIT ${limitAman(limit)}`,
    [q, `${q}%`, `%${q}%`],
  );
}

export async function hitungIcd10(): Promise<number> {
  const row = await queryOne<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM icd10_codes`,
  );
  return Number(row?.n ?? 0);
}

/**
 * Impor massal ICD-10. Baris yang formatnya salah dilewati dan dilaporkan
 * jumlahnya — impor puluhan ribu baris tidak boleh gagal total hanya
 * karena satu baris rusak.
 */
export async function imporIcd10(
  isi: string,
  pemisah: string,
): Promise<{ masuk: number; diperbarui: number; dilewati: number }> {
  const baris = isi.split(/\r?\n/).filter((b) => b.trim() !== "");
  let masuk = 0;
  let diperbarui = 0;
  let dilewati = 0;

  await transaction(async (conn) => {
    for (const b of baris) {
      const kolom = b.split(pemisah).map((k) => k.trim().replace(/^"|"$/g, ""));
      const [code, namaId, namaEn, bab] = kolom;

      if (!code || !namaId || !/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/.test(code)) {
        dilewati++;
        continue;
      }

      const [ada] = await conn.execute<RowDataPacket[]>(
        `SELECT code FROM icd10_codes WHERE code = ?`,
        [code],
      );

      await conn.execute(
        `INSERT INTO icd10_codes (code, nama_id, nama_en, bab)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE nama_id=VALUES(nama_id),
           nama_en=VALUES(nama_en), bab=VALUES(bab)`,
        [code, namaId.slice(0, 255), namaEn?.slice(0, 255) || null, bab?.slice(0, 120) || null],
      );

      if (ada[0]) diperbarui++;
      else masuk++;
    }
  });

  return { masuk, diperbarui, dilewati };
}

/**
 * Hasil impor massal. `galat` memuat baris yang ditolak beserta alasannya —
 * jumlah saja tidak cukup untuk memperbaiki berkas puluhan ribu baris.
 */
export type HasilImpor = {
  masuk: number;
  diperbarui: number;
  dilewati: number;
  galat: { baris: number; isi: string; alasan: string }[];
};

/** Memecah satu baris CSV/TSV, menghormati tanda kutip ganda. */
function pecahBaris(baris: string, pemisah: string): string[] {
  const kolom: string[] = [];
  let buf = "";
  let dalamKutip = false;

  for (let i = 0; i < baris.length; i++) {
    const c = baris[i];
    if (c === '"') {
      // "" di dalam kutip berarti satu tanda kutip literal.
      if (dalamKutip && baris[i + 1] === '"') { buf += '"'; i++; }
      else dalamKutip = !dalamKutip;
    } else if (c === pemisah && !dalamKutip) {
      kolom.push(buf.trim());
      buf = "";
    } else {
      buf += c;
    }
  }
  kolom.push(buf.trim());
  return kolom;
}

/**
 * Impor massal katalog obat & BMHP.
 *
 * Kolom: kode, tipe, nama, satuan, HPP, harga jual, stok minimum,
 *        bentuk sediaan, boleh diracik (1/0), butuh resep (1/0),
 *        kategori (opsional)
 *
 * Kategori diterima sebagai NAMA dan dibuat otomatis bila belum ada. Tanpa
 * ini katalog hasil impor tidak berkategori sama sekali, dan satu-satunya
 * cara memperbaikinya adalah membuka form satu per satu — tidak masuk akal
 * untuk katalog klinik yang biasanya ribuan baris. Kategori dipakai untuk
 * pengelompokan laporan farmasi, jadi katalog tanpa kategori membuat laporan
 * itu tidak berguna.
 *
 * Baris rusak DILEWATI dan dilaporkan, bukan membatalkan seluruh impor:
 * berkas katalog klinik biasanya ribuan baris, dan menggagalkan semuanya
 * karena satu sel kosong memaksa operator mengulang dari awal berkali-kali.
 *
 * Harga jual di bawah HPP ditolak di sini juga — aturan yang sama dengan
 * form satuan, supaya impor tidak jadi jalan pintas untuk melanggarnya.
 */
export async function imporItem(
  isi: string,
  pemisah: string,
  lewatiBarisPertama = false,
): Promise<HasilImpor> {
  const semua = isi.split(/\r?\n/);
  const hasil: HasilImpor = { masuk: 0, diperbarui: 0, dilewati: 0, galat: [] };

  await transaction(async (conn) => {
    /*
     * Kategori di-cache per impor. Katalog nyata memakai kategori yang sama
     * berulang-ulang (ratusan baris "Antibiotik"), jadi tanpa cache ini satu
     * kueri terbuang untuk setiap baris.
     */
    const cacheKategori = new Map<string, number>();
    const idKategori = async (nama: string, tipe: string): Promise<number> => {
      const kunci = `${tipe}::${nama.toLowerCase()}`;
      const tersimpan = cacheKategori.get(kunci);
      if (tersimpan !== undefined) return tersimpan;

      const [ada] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM item_categories WHERE nama = ? AND tipe = ?`,
        [nama, tipe],
      );
      let id = ada[0]?.id as number | undefined;
      if (id === undefined) {
        const [res] = await conn.execute<ResultSetHeader>(
          `INSERT INTO item_categories (nama, tipe) VALUES (?,?)`,
          [nama.slice(0, 100), tipe],
        );
        id = res.insertId;
      }
      cacheKategori.set(kunci, id);
      return id;
    };

    for (let i = 0; i < semua.length; i++) {
      const teks = semua[i];
      if (teks.trim() === "") continue;
      if (i === 0 && lewatiBarisPertama) continue;

      const k = pecahBaris(teks, pemisah);
      const [kode, tipe, nama, satuan, hppRaw, jualRaw, minRaw, bentuk, racik, resep, kategori] = k;
      const tolak = (alasan: string) => {
        hasil.dilewati++;
        if (hasil.galat.length < 50) {
          hasil.galat.push({ baris: i + 1, isi: teks.slice(0, 80), alasan });
        }
      };

      if (!kode || !nama) { tolak("Kode atau nama kosong"); continue; }
      if (!["obat", "bmhp", "alkes"].includes(tipe)) {
        tolak(`Tipe "${tipe}" tidak dikenal (obat/bmhp/alkes)`); continue;
      }
      const hpp = Number(hppRaw ?? 0);
      const jual = Number(jualRaw ?? 0);
      if (!Number.isFinite(hpp) || !Number.isFinite(jual) || hpp < 0 || jual < 0) {
        tolak("HPP atau harga jual bukan angka yang sah"); continue;
      }
      if (jual < hpp) {
        tolak(`Harga jual (${jual}) di bawah HPP (${hpp})`); continue;
      }

      const [ada] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM items WHERE kode = ?`, [kode],
      );

      const categoryId = kategori ? await idKategori(kategori, tipe) : null;

      await conn.execute(
        `INSERT INTO items
           (kode, tipe, nama, satuan_dasar, hpp, harga_jual, min_stock,
            bentuk_sediaan, is_racikable, butuh_resep, category_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           tipe=VALUES(tipe), nama=VALUES(nama), satuan_dasar=VALUES(satuan_dasar),
           hpp=VALUES(hpp), harga_jual=VALUES(harga_jual),
           min_stock=VALUES(min_stock), bentuk_sediaan=VALUES(bentuk_sediaan),
           is_racikable=VALUES(is_racikable), butuh_resep=VALUES(butuh_resep),
           -- Kolom kategori kosong berarti "tidak disebut", bukan "kosongkan".
           -- Impor ulang sebagian tidak boleh menghapus kategori yang sudah ada.
           category_id=COALESCE(VALUES(category_id), category_id)`,
        [
          kode.slice(0, 30), tipe, nama.slice(0, 180),
          (satuan || "pcs").slice(0, 20), hpp, jual,
          Number.isFinite(Number(minRaw)) ? Math.max(0, Math.trunc(Number(minRaw))) : 0,
          bentuk?.slice(0, 40) || null,
          racik === "1" ? 1 : 0,
          resep === "0" ? 0 : 1,
          categoryId,
        ],
      );

      if (ada[0]) hasil.diperbarui++;
      else hasil.masuk++;
    }
  });

  return hasil;
}

/**
 * Impor massal tindakan medis beserta tarifnya.
 * Kolom: kode, nama, kategori, tarif, ICD-9-CM
 */
export async function imporTindakan(
  isi: string,
  pemisah: string,
  lewatiBarisPertama = false,
): Promise<HasilImpor> {
  const semua = isi.split(/\r?\n/);
  const hasil: HasilImpor = { masuk: 0, diperbarui: 0, dilewati: 0, galat: [] };

  await transaction(async (conn) => {
    for (let i = 0; i < semua.length; i++) {
      const teks = semua[i];
      if (teks.trim() === "") continue;
      if (i === 0 && lewatiBarisPertama) continue;

      const [kode, nama, kategori, tarifRaw, icd9] = pecahBaris(teks, pemisah);
      const tolak = (alasan: string) => {
        hasil.dilewati++;
        if (hasil.galat.length < 50) {
          hasil.galat.push({ baris: i + 1, isi: teks.slice(0, 80), alasan });
        }
      };

      if (!kode || !nama) { tolak("Kode atau nama kosong"); continue; }
      const tarif = Number(tarifRaw ?? 0);
      if (!Number.isFinite(tarif) || tarif < 0) { tolak("Tarif bukan angka yang sah"); continue; }

      const [ada] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM medical_procedures WHERE kode = ?`, [kode],
      );
      await conn.execute(
        `INSERT INTO medical_procedures (kode, nama, kategori, tarif, icd9cm)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE nama=VALUES(nama), kategori=VALUES(kategori),
           tarif=VALUES(tarif), icd9cm=VALUES(icd9cm)`,
        [
          kode.slice(0, 30), nama.slice(0, 150),
          kategori?.slice(0, 60) || null, tarif, icd9?.slice(0, 10) || null,
        ],
      );
      if (ada[0]) hasil.diperbarui++;
      else hasil.masuk++;
    }
  });

  return hasil;
}

// ---------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------

export type AuditRow = RowDataPacket & {
  id: number;
  aksi: string;
  entity: string;
  entity_id: number | null;
  data_before: unknown;
  data_after: unknown;
  ip_address: string | null;
  created_at: string;
  pelaku: string | null;
  role_nama: string | null;
  site_nama: string | null;
};

export async function daftarAudit(opts: {
  entity?: string;
  aksi?: string;
  tanggal?: string;
  limit?: number;
}): Promise<AuditRow[]> {
  return query<AuditRow>(
    `SELECT a.*, u.nama AS pelaku, r.nama AS role_nama, s.nama AS site_nama
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN sites s ON s.id = a.site_id
      WHERE (? IS NULL OR a.entity = ?)
        AND (? IS NULL OR a.aksi = ?)
        AND (? IS NULL OR DATE(a.created_at) = ?)
      ORDER BY a.id DESC
      LIMIT ${limitAman(opts.limit, 200)}`,
    [
      opts.entity ?? null, opts.entity ?? null,
      opts.aksi ?? null, opts.aksi ?? null,
      opts.tanggal ?? null, opts.tanggal ?? null,
    ],
  );
}

export async function entitasAudit() {
  return query<RowDataPacket & { entity: string; n: number }>(
    `SELECT entity, COUNT(*) AS n FROM audit_logs GROUP BY entity ORDER BY entity`,
  );
}

// ---------------------------------------------------------------------
// Pengaturan
// ---------------------------------------------------------------------

export async function daftarSetting(siteId: number | null) {
  return query<RowDataPacket & {
    id: number; site_id: number | null; site_nama: string | null;
    skey: string; svalue: string | null; tipe: string;
  }>(
    `SELECT st.*, s.nama AS site_nama
       FROM settings st LEFT JOIN sites s ON s.id = st.site_id
      WHERE (? IS NULL OR st.site_id = ? OR st.site_id IS NULL)
      ORDER BY st.site_id IS NULL DESC, st.skey`,
    [siteId, siteId],
  );
}

export async function simpanSetting(
  id: number,
  nilai: string,
): Promise<void> {
  await execute(`UPDATE settings SET svalue = ? WHERE id = ?`, [nilai, id]);
}
