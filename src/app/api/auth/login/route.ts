import { NextResponse } from "next/server";
import { z } from "zod";
import { auditLog, verifyCredentials } from "@/lib/auth";
import { catatBerhasil, catatGagal, ipKlien, menitTerkunci } from "@/lib/batas-login";
import { execute } from "@/lib/db";
import { setSessionCookie, signSession } from "@/lib/session";
import { HOME_ROUTE } from "@/lib/rbac";

export const runtime = "nodejs";

const schema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  /*
   * Hanya JSON. Formulir lintas situs (`<form enctype="text/plain">`) bisa
   * menyusun badan yang kebetulan JSON sah dan memasukkan peramban klinik
   * ke akun penyerang; formulir HTML tidak bisa mengirim application/json.
   */
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ message: "Permintaan tidak valid." }, { status: 415 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Data tidak lengkap." }, { status: 400 });
  }

  const ip = ipKlien(request.headers);
  const { username, password } = parsed.data;

  const terkunci = menitTerkunci(ip, username);
  if (terkunci > 0) {
    return NextResponse.json(
      { message: `Terlalu banyak percobaan gagal. Coba lagi dalam ${terkunci} menit.` },
      { status: 429 },
    );
  }

  const user = await verifyCredentials(username, password);
  if (!user) {
    catatGagal(ip, username);
    /*
     * Login gagal ikut tercatat — tanpa jejak, percobaan menebak password
     * tidak terlihat oleh siapa pun. Username disimpan apa adanya (bukan
     * id), karena yang dicoba bisa saja akun yang tidak ada.
     */
    await execute(
      `INSERT INTO audit_logs (site_id, user_id, aksi, entity, data_after, ip_address, user_agent)
       VALUES (NULL, NULL, 'login_gagal', 'users', ?, ?, ?)`,
      [
        JSON.stringify({ username }),
        ip.slice(0, 45),
        (request.headers.get("user-agent") ?? "").slice(0, 255) || null,
      ],
    ).catch(() => undefined);
    return NextResponse.json(
      { message: "Username atau password salah." },
      { status: 401 },
    );
  }

  catatBerhasil(ip, username);
  await setSessionCookie(await signSession(user));

  await auditLog({
    session: user,
    aksi: "login",
    entity: "users",
    entityId: user.id,
    ip,
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({
    // Pengguna yang wajib mengganti password langsung diarahkan ke sana.
    redirectTo: user.mustChangePw ? "/akun" : HOME_ROUTE[user.role],
  });
}
