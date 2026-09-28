import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  await clearSessionCookie();
  /*
   * Location relatif, bukan `new URL("/login", request.url)`: di balik
   * reverse proxy, request.url berisi host internal (localhost:3000) dan
   * pengguna dilempar ke alamat yang tidak bisa dijangkau. Peramban
   * menyelesaikan Location relatif terhadap alamat yang sedang dibuka.
   */
  return new NextResponse(null, { status: 303, headers: { Location: "/login" } });
}
