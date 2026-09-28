import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { RoleCode } from "./rbac";

/**
 * Sesi berbasis cookie ber-tanda tangan (JWT HS256).
 * File ini SENGAJA hanya bergantung pada `jose` agar bisa dipakai
 * di middleware (Edge Runtime) — mysql2 dan bcryptjs tidak jalan di sana.
 */

export const SESSION_COOKIE = "kpsg_session";
/**
 * Cabang aktif pilihan pengguna. Sengaja TERPISAH dari token sesi:
 * memilih cabang tidak boleh menerbitkan ulang kredensial, dan cookie ini
 * tidak menambah hak apa pun — hanya memilih di antara cabang yang memang
 * sudah jadi haknya.
 */
export const SITE_COOKIE = "kpsg_site";
const MAX_AGE = 60 * 60 * 10; // 10 jam — kira-kira satu shift kerja

export type SessionUser = {
  id: number;
  nama: string;
  username: string;
  role: RoleCode;
  roleNama: string;
  /** null hanya untuk Super Admin (lintas cabang). */
  siteId: number | null;
  siteNama: string | null;
  /**
   * Seluruh cabang tempat pengguna ini boleh bekerja: cabang induk
   * (`users.site_id`) ditambah penugasan tambahan di `user_sites`.
   *
   * Daftarnya IKUT DI DALAM TOKEN yang ditandatangani, bukan dibaca dari
   * database saat pemeriksaan. Alasannya teknis sekaligus mendasar:
   * `getSession()` dipanggil juga dari middleware yang berjalan di Edge
   * Runtime — mysql2 tidak jalan di sana. Karena token bertanda tangan,
   * daftar ini tidak bisa dipalsukan dari sisi klien.
   *
   * Konsekuensinya: perubahan penugasan baru berlaku setelah pengguna
   * masuk kembali (paling lama satu shift, sesuai MAX_AGE). Layar
   * Pengguna & Role menyatakan hal ini kepada Super Admin.
   *
   * Untuk Super Admin isinya kosong dan tidak dipakai — ia boleh ke
   * cabang mana pun.
   */
  siteIds: number[];
  mustChangePw: boolean;
  /**
   * Sidik akun saat token terbit — lihat `sidikAkun()` di lib/auth.ts.
   * Opsional hanya karena token lama belum membawanya; token tanpa sidik
   * dianggap tidak sah dan pemiliknya diminta masuk ulang.
   */
  sv?: string;
};

/** Cabang yang boleh dipilih pengguna ini. Murni, tanpa akses database. */
export function bolehKeCabang(session: SessionUser, siteId: number): boolean {
  if (session.role === "super_admin") return true;
  return session.siteIds.includes(siteId);
}

/**
 * Pengguna dengan lebih dari satu penugasan boleh berpindah cabang —
 * mis. dokter yang praktik di dua cabang. Super Admin selalu boleh.
 */
export function bolehPindahCabang(session: SessionUser): boolean {
  return session.role === "super_admin" || session.siteIds.length > 1;
}

/** Nilai contoh di .env.example — publik di repositori, jadi bukan rahasia. */
const SECRET_CONTOH = "ganti-dengan-string-acak-minimal-32-karakter-sebelum-dipakai";
let sudahDiperingatkan = false;

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "SESSION_SECRET belum diset atau kurang dari 32 karakter. Lihat .env.example",
    );
  }
  /*
   * Dengan nilai contoh, siapa pun yang pernah membaca repositori bisa
   * menandatangani token Super Admin sendiri. Sengaja PERINGATAN, bukan
   * penghentian: deploy berjalan otomatis, dan mematikan situs klinik di
   * tengah pelayanan lebih merugikan daripada memberi tahu operatornya.
   */
  if (s === SECRET_CONTOH && !sudahDiperingatkan) {
    sudahDiperingatkan = true;
    console.error(
      "[KEAMANAN] SESSION_SECRET masih memakai nilai contoh dari .env.example — " +
        "token sesi bisa dipalsukan. Ganti dengan string acak lalu restart aplikasi.",
    );
  }
  return new TextEncoder().encode(s);
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("simklinik-kpsg")
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: "simklinik-kpsg",
    });
    return payload as unknown as SessionUser;
  } catch {
    return null;
  }
}

/**
 * Baca sesi dari cookie (Server Component / Route Handler / Server Action).
 *
 * `siteId` diisi dari cookie cabang aktif sehingga seluruh halaman
 * operasional bekerja tanpa perubahan. Cookie itu DIVALIDASI ulang di sini
 * terhadap daftar penugasan di dalam token — cookie yang menunjuk cabang
 * di luar hak pengguna diabaikan, bukan dipercaya. Ini titik terakhir
 * sebelum `siteId` dipakai sebagai batas isolasi seluruh query.
 */
export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await verifySession(token);
  if (!session) return null;

  // Token lama (sebelum multi-cabang) tidak punya `siteIds`.
  const siteIds = Array.isArray(session.siteIds) ? session.siteIds : [];
  const lengkap: SessionUser = { ...session, siteIds };

  const pilihan = Number(jar.get(SITE_COOKIE)?.value);
  if (Number.isInteger(pilihan) && pilihan > 0 && bolehKeCabang(lengkap, pilihan)) {
    return { ...lengkap, siteId: pilihan };
  }
  return lengkap;
}

/** Menetapkan cabang aktif. `null` = kembali ke cabang induk / lintas cabang. */
export async function setActiveSite(siteId: number | null) {
  const jar = await cookies();
  if (siteId === null) {
    jar.delete(SITE_COOKIE);
    return;
  }
  jar.set(SITE_COOKIE, String(siteId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(SITE_COOKIE);
}

/**
 * Batas cabang untuk MEMBUKA satu catatan lewat id-nya (halaman detail).
 *
 * Super Admin memantau lintas cabang: tautan notifikasi atau URL ke catatan
 * cabang lain tidak boleh berakhir 404 hanya karena cabang aktifnya
 * berbeda. Aman karena hanya dipakai untuk membaca — setiap penyimpanan
 * ditolak oleh tolakSuperAdmin() di lib/auth.ts. Peran lain tetap
 * dibatasi cabang aktifnya.
 */
export function cabangBacaDetail(session: SessionUser): number | null {
  return session.role === "super_admin" ? null : session.siteId;
}

/**
 * Cabang efektif untuk seluruh query.
 * Sumbernya SELALU sesi, tidak pernah parameter request
 * (docs/DATABASE.md §3.7). Cabang yang diminta hanya dihormati bila
 * memang termasuk penugasan pengguna.
 */
export function effectiveSiteId(
  session: SessionUser,
  requestedSiteId?: number | null,
): number | null {
  if (
    requestedSiteId != null &&
    (session.role === "super_admin" || bolehKeCabang(session, requestedSiteId))
  ) {
    return requestedSiteId;
  }
  return session.siteId;
}
