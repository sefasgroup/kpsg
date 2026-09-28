import "server-only";
import { createHash } from "node:crypto";
import { cache } from "react";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import type { RowDataPacket } from "mysql2";
import { execute, query, queryOne } from "./db";
import { getSession, type SessionUser } from "./session";
import { canAccess, type RoleCode } from "./rbac";

/** Modul ini berjalan di Node runtime saja (bcrypt + mysql2). */

type UserRow = RowDataPacket & {
  id: number;
  nama: string;
  username: string;
  password_hash: string;
  is_active: number;
  must_change_pw: number;
  site_id: number | null;
  site_nama: string | null;
  /** `site_id` bila cabangnya masih aktif, selain itu NULL. */
  site_aktif: number | null;
  role_code: RoleCode;
  role_nama: string;
  /** Penugasan cabang tambahan, terurut — bahan sidik akun. */
  site_tambahan: string | null;
};

/**
 * Hash bcrypt SUNGGUHAN (60 karakter, cost 10) untuk username yang tidak
 * ada. Yang lama hanya 59 karakter — bcryptjs langsung mengembalikan
 * `false` tanpa menghitung apa pun, sehingga username tak dikenal dijawab
 * ~1 ms dan yang terdaftar ~80 ms: daftar akun bisa ditebak dari waktu
 * respons saja.
 */
const HASH_PENGGANTI = "$2b$10$MVudUl1UCzEz4aHduYpMDeHuSinX0hR60VmViNcL6HTRTpxQOO5oG";

/**
 * SIDIK AKUN — ringkasan hal yang membuat sebuah sesi sah: hash password,
 * peran, cabang induk, dan penugasan cabang tambahan. Ikut ditandatangani
 * di dalam token dan dibandingkan ulang ke database pada setiap permintaan
 * server (`sesiMasihSah`). Begitu salah satunya berubah — password direset,
 * peran diganti, penugasan cabang diubah — seluruh sesi lama berakhir.
 * Tanpa ini akun yang dinonaktifkan atau diturunkan perannya tetap bekerja
 * sampai tokennya kedaluwarsa (10 jam).
 */
function sidikAkun(row: UserRow): string {
  return createHash("sha256")
    .update([row.password_hash, row.role_code, row.site_id ?? "-", row.site_tambahan ?? "-"].join("|"))
    .digest("base64url")
    .slice(0, 24);
}

/** Kolom akun yang dipakai bersama oleh login dan pemeriksaan sesi. */
const SQL_AKUN = `
  SELECT u.id, u.nama, u.username, u.password_hash, u.is_active, u.must_change_pw,
         u.site_id, s.nama AS site_nama,
         IF(s.id IS NOT NULL AND s.is_active = 1 AND s.deleted_at IS NULL, s.id, NULL) AS site_aktif,
         r.code AS role_code, r.nama AS role_nama,
         (SELECT GROUP_CONCAT(us.site_id ORDER BY us.site_id)
            FROM user_sites us WHERE us.user_id = u.id) AS site_tambahan
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN sites s ON s.id = u.site_id`;

/**
 * Menyusun isi sesi dari baris akun. Cabang induk yang sudah DITUTUP tidak
 * lagi jadi cabang kerja: staf dipindah ke penugasan aktif pertamanya, dan
 * staf operasional tanpa satu pun cabang aktif tidak mendapat sesi.
 */
async function sesiDariBaris(row: UserRow): Promise<SessionUser | null> {
  const siteIds = await cabangPengguna(row.id, row.site_aktif);
  const superAdmin = row.role_code === "super_admin";
  if (!superAdmin && siteIds.length === 0) return null;
  const siteId = superAdmin ? row.site_aktif : siteIds[0];
  return {
    id: row.id,
    nama: row.nama,
    username: row.username,
    role: row.role_code,
    roleNama: row.role_nama,
    siteId,
    siteNama: siteId !== null && siteId === row.site_aktif ? row.site_nama : null,
    siteIds,
    mustChangePw: Boolean(row.must_change_pw),
    sv: sidikAkun(row),
  };
}

export async function verifyCredentials(
  username: string,
  password: string,
): Promise<SessionUser | null> {
  const row = await queryOne<UserRow>(
    `${SQL_AKUN}
      WHERE u.username = ? AND u.deleted_at IS NULL
      LIMIT 1`,
    [username],
  );

  // Perbandingan tetap dijalankan walau user tidak ada, agar waktu respons
  // tidak membocorkan username mana yang terdaftar.
  const hash = row?.password_hash ?? HASH_PENGGANTI;
  const cocok = await bcrypt.compare(password, hash);

  if (!row || !cocok || !row.is_active) return null;

  const sesi = await sesiDariBaris(row);
  if (!sesi) return null;

  await execute(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [row.id]);
  return sesi;
}

/**
 * Apakah sesi masih mencerminkan akun di database: aktif, belum dihapus,
 * dan sidiknya sama. Di-`cache` per permintaan — layout, halaman, dan
 * komponen memanggil requireSession() berkali-kali dalam satu render.
 */
export const sesiMasihSah = cache(
  async (userId: number, sv: string | undefined): Promise<boolean> => {
    if (!sv) return false; // token lama tanpa sidik: masuk ulang sekali
    const row = await queryOne<UserRow>(
      `${SQL_AKUN} WHERE u.id = ? AND u.deleted_at IS NULL LIMIT 1`,
      [userId],
    );
    return Boolean(row && row.is_active && sidikAkun(row) === sv);
  },
);

/**
 * Sesi yang sah menurut token DAN database, atau null — untuk halaman yang
 * tidak boleh mengalihkan paksa (login, beranda).
 */
export async function sesiSah(): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session) return null;
  return (await sesiMasihSah(session.id, session.sv)) ? session : null;
}

/**
 * Isi sesi baru untuk pengguna yang sedang masuk — dipakai setelah ia
 * mengganti password sendiri: sidiknya berubah, jadi token lama tidak sah.
 */
export async function sesiBaruUntuk(userId: number): Promise<SessionUser | null> {
  const row = await queryOne<UserRow>(
    `${SQL_AKUN} WHERE u.id = ? AND u.deleted_at IS NULL AND u.is_active = 1 LIMIT 1`,
    [userId],
  );
  return row ? sesiDariBaris(row) : null;
}

/**
 * Predikat SQL "pengguna dengan alias `u` bertugas di cabang ini".
 *
 * Dipakai bersama oleh setiap query yang menyaring pengguna per cabang
 * (daftar dokter di pendaftaran, daftar pegawai di HR, validasi dokter
 * pengganti). Ditulis sekali di sini supaya tidak ada layar yang
 * ketinggalan saat aturan penugasan berubah — sebelum ada `user_sites`,
 * semuanya memakai `u.site_id = ?` dan dokter tugas-ganda tidak pernah
 * muncul di cabang keduanya.
 *
 * Butuh TIGA parameter dengan nilai `siteId` yang sama: dua untuk
 * pemeriksaan NULL dan cabang induk, satu untuk penugasan tambahan.
 */
export const SQL_BERTUGAS_DI_CABANG = `(
      ? IS NULL
      OR u.site_id = ?
      OR EXISTS (SELECT 1 FROM user_sites us
                  WHERE us.user_id = u.id AND us.site_id = ?)
    )`;

/**
 * Seluruh cabang tempat pengguna boleh bekerja: cabang induk
 * (`users.site_id`) ditambah penugasan tambahan di `user_sites`.
 *
 * Cabang induk selalu jadi elemen pertama sehingga tetap menjadi pilihan
 * bawaan saat pengguna belum memilih apa pun. Cabang nonaktif dibuang di
 * sini — penugasan lama tidak boleh menghidupkan kembali akses ke cabang
 * yang sudah ditutup.
 */
export async function cabangPengguna(
  userId: number,
  siteIdInduk: number | null,
): Promise<number[]> {
  const rows = await query<RowDataPacket & { site_id: number }>(
    `SELECT us.site_id
       FROM user_sites us
       JOIN sites s ON s.id = us.site_id
      WHERE us.user_id = ? AND s.is_active = 1 AND s.deleted_at IS NULL`,
    [userId],
  );
  const tambahan = rows.map((r) => Number(r.site_id));
  return [...new Set(siteIdInduk ? [siteIdInduk, ...tambahan] : tambahan)];
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);

/** Wajib login. Dipakai di layout area aplikasi. */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  /*
   * Token saja tidak cukup: akun bisa dinonaktifkan, perannya diganti, atau
   * passwordnya direset setelah token terbit. Sesi yang tidak lagi cocok
   * dengan database dihapus lewat route handler (Server Component tidak
   * boleh menulis cookie), lalu pengguna diminta masuk ulang.
   */
  if (!(await sesiMasihSah(session.id, session.sv))) redirect("/api/auth/sesi-berakhir");
  return session;
}

/** Wajib login + berhak atas route ini (pertahanan kedua setelah middleware). */
export async function requireAccess(pathname: string): Promise<SessionUser> {
  const session = await requireSession();
  if (!canAccess(session.role, pathname)) redirect("/dashboard");
  return session;
}

/** Wajib salah satu role tertentu. Dipakai di layer data tiap modul. */
export async function requireRole(...roles: RoleCode[]): Promise<SessionUser> {
  const session = await requireSession();
  if (!roles.includes(session.role)) redirect("/dashboard");
  return session;
}

export const PESAN_SUPER_ADMIN_LIHAT =
  "Super Admin hanya dapat melihat data operasional. Perubahan dilakukan oleh petugas cabang.";

/**
 * Super Admin boleh membuka seluruh modul operasional untuk PEMANTAUAN,
 * tetapi tidak mengerjakannya (CLAUDE.md §2.1 — tidak ada peran ganda).
 * Tanpa penjaga ini resep, pembayaran, atau shift kasir akan tercatat atas
 * nama akun teknis, dan membayar tagihan diam-diam membuka shift kas baru.
 *
 * Dipanggil di awal setiap Server Action yang MENGUBAH data operasional,
 * sesudah requireRole(). Aksi baca (pencarian) tidak memakainya. Master
 * data, supplier, dan profil cabang tetap wewenang Super Admin.
 */
export function tolakSuperAdmin(
  session: SessionUser,
): { ok: false; error: string } | null {
  return session.role === "super_admin"
    ? { ok: false, error: PESAN_SUPER_ADMIN_LIHAT }
    : null;
}

/**
 * Menulis jejak audit (CLAUDE.md — pemisahan tugas hanya bermakna bila
 * setiap tindakan bisa ditelusuri). Wajib dipanggil pada setiap operasi
 * yang mengubah rekam medis, stok, atau uang.
 */
export async function auditLog(opts: {
  session: SessionUser;
  aksi: string;
  entity: string;
  entityId?: number | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}) {
  await execute(
    `INSERT INTO audit_logs
       (site_id, user_id, aksi, entity, entity_id, data_before, data_after, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.session.siteId,
      opts.session.id,
      opts.aksi,
      opts.entity,
      opts.entityId ?? null,
      opts.before ? JSON.stringify(opts.before) : null,
      opts.after ? JSON.stringify(opts.after) : null,
      opts.ip ?? null,
      opts.userAgent ?? null,
    ],
  );
}
