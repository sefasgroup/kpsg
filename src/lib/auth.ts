import "server-only";
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
  role_code: RoleCode;
  role_nama: string;
};

export async function verifyCredentials(
  username: string,
  password: string,
): Promise<SessionUser | null> {
  const row = await queryOne<UserRow>(
    `SELECT u.id, u.nama, u.username, u.password_hash, u.is_active, u.must_change_pw,
            u.site_id, s.nama AS site_nama,
            r.code AS role_code, r.nama AS role_nama
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN sites s ON s.id = u.site_id
      WHERE u.username = ? AND u.deleted_at IS NULL
      LIMIT 1`,
    [username],
  );

  // Perbandingan tetap dijalankan walau user tidak ada, agar waktu respons
  // tidak membocorkan username mana yang terdaftar.
  const hash = row?.password_hash ?? "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
  const cocok = await bcrypt.compare(password, hash);

  if (!row || !cocok || !row.is_active) return null;

  await execute(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [row.id]);

  return {
    id: row.id,
    nama: row.nama,
    username: row.username,
    role: row.role_code,
    roleNama: row.role_nama,
    siteId: row.site_id,
    siteNama: row.site_nama,
    siteIds: await cabangPengguna(row.id, row.site_id),
    mustChangePw: Boolean(row.must_change_pw),
  };
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
