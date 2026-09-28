"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { auditLog, hashPassword, requireSession, sesiBaruUntuk } from "@/lib/auth";
import { execute, queryOne } from "@/lib/db";
import { setSessionCookie, signSession } from "@/lib/session";

export type ActionResult = { ok: true } | { ok: false; error: string; field?: string };

const gantiSchema = z
  .object({
    lama: z.string().min(1, "Password saat ini wajib diisi"),
    baru: z.string().min(8, "Password baru minimal 8 karakter").max(72, "Password maksimal 72 karakter"),
    ulang: z.string(),
  })
  .refine((v) => v.baru === v.ulang, { message: "Ulangi password baru dengan sama persis", path: ["ulang"] })
  .refine((v) => v.baru !== v.lama, { message: "Password baru harus berbeda dari yang lama", path: ["baru"] });

/**
 * Pengguna mengganti password SENDIRI — satu-satunya cara password menjadi
 * rahasia pemiliknya. Password dari Super Admin (akun baru atau reset)
 * pernah terlihat orang lain, sehingga wajib diganti (`must_change_pw`).
 *
 * Sidik akun ikut berubah karena hash-nya berubah; token baru diterbitkan
 * di sini supaya pengguna tidak ikut terlempar keluar, sementara sesi lain
 * miliknya (mis. di komputer bersama) otomatis berakhir.
 */
export async function gantiPasswordAction(raw: unknown): Promise<ActionResult> {
  const session = await requireSession();

  const parsed = gantiSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.message, field: String(first.path[0] ?? "") };
  }

  const row = await queryOne<import("mysql2").RowDataPacket & { password_hash: string }>(
    `SELECT password_hash FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL`,
    [session.id],
  );
  if (!row || !(await bcrypt.compare(parsed.data.lama, row.password_hash))) {
    return { ok: false, error: "Password saat ini salah.", field: "lama" };
  }

  await execute(
    `UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?`,
    [await hashPassword(parsed.data.baru), session.id],
  );
  await auditLog({ session, aksi: "change_password", entity: "users", entityId: session.id });

  const baru = await sesiBaruUntuk(session.id);
  if (baru) await setSessionCookie(await signSession(baru));
  return { ok: true };
}
