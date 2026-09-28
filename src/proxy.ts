import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { canAccess } from "@/lib/rbac";

/**
 * Lapis pertama penegakan RBAC (CLAUDE.md §2.1).
 * (Next.js 16 mengganti konvensi `middleware.ts` menjadi `proxy.ts`.)
 *
 * Lapis kedua ada di layer data lewat requireRole()/requireAccess() —
 * proxy saja tidak cukup karena Route Handler bisa dipanggil langsung.
 */

const PUBLIC = ["/login", "/api/auth/login"];

/**
 * Redirect dengan Location relatif. `new URL(path, request.url)` memakai host
 * yang dilihat server — di balik reverse proxy itu localhost:3000, bukan
 * domain publik — sehingga pengguna dilempar ke alamat yang tak terjangkau.
 */
function redirectRelatif(path: string) {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    const tujuan =
      pathname === "/" ? "/login" : `/login?next=${encodeURIComponent(pathname)}`;
    return redirectRelatif(tujuan);
  }

  if (!canAccess(session.role, pathname)) {
    return redirectRelatif("/dashboard");
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|brand|favicon.ico).*)"],
};
