import { NextResponse } from "next/server";
import { z } from "zod";
import { auditLog, verifyCredentials } from "@/lib/auth";
import { setSessionCookie, signSession } from "@/lib/session";
import { HOME_ROUTE } from "@/lib/rbac";

export const runtime = "nodejs";

const schema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Data tidak lengkap." }, { status: 400 });
  }

  const user = await verifyCredentials(parsed.data.username, parsed.data.password);
  if (!user) {
    return NextResponse.json(
      { message: "Username atau password salah." },
      { status: 401 },
    );
  }

  await setSessionCookie(await signSession(user));

  await auditLog({
    session: user,
    aksi: "login",
    entity: "users",
    entityId: user.id,
    ip: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ redirectTo: HOME_ROUTE[user.role] });
}
