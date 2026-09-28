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

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (!canAccess(session.role, pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|brand|favicon.ico).*)"],
};
