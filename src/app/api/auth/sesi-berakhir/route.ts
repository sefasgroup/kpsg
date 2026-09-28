import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Tujuan pengalihan saat token masih bertanda tangan sah tetapi akunnya
 * sudah berubah — dinonaktifkan, perannya diganti, atau passwordnya direset
 * (lihat `requireSession()` di lib/auth.ts).
 *
 * Harus berupa route handler: Server Component tidak boleh menulis cookie,
 * dan tanpa cookie yang dihapus halaman login akan terus melihat token itu.
 * GET karena dicapai lewat redirect; akibat terburuk memanggilnya dari situs
 * lain hanyalah pengguna keluar — tidak ada yang bisa dicuri.
 */
export async function GET() {
  await clearSessionCookie();
  // Location relatif — lihat catatan di api/auth/logout.
  return new NextResponse(null, {
    status: 303,
    headers: { Location: "/login?sesi=berakhir" },
  });
}
