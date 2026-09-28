import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { HOME_ROUTE } from "@/lib/rbac";
import { GantiPasswordForm } from "./ganti-password-form";

export const metadata: Metadata = { title: "Akun Saya" };
export const dynamic = "force-dynamic";

export default async function AkunPage() {
  const session = await requireSession();

  // Dibaca dari database, bukan token: setelah password diganti, token lama
  // masih membawa `mustChangePw: true` sampai halaman dimuat ulang.
  const row = await queryOne<import("mysql2").RowDataPacket & { must_change_pw: number }>(
    `SELECT must_change_pw FROM users WHERE id = ?`,
    [session.id],
  );
  const wajib = Boolean(row?.must_change_pw);

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      {wajib ? (
        <p className="rounded-lg border border-warning/25 bg-warning-bg px-4 py-2.5 text-body text-ink">
          Password Anda masih password sementara dari administrator. Ganti
          sekarang sebelum mulai bekerja — password yang pernah dilihat orang
          lain bukan lagi rahasia Anda.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle icon={KeyRound}>Ganti Password</CardTitle>
        </CardHeader>
        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
          <dt className="text-ink-muted">Nama</dt>
          <dd className="text-ink">{session.nama}</dd>
          <dt className="text-ink-muted">Username</dt>
          <dd className="font-mono text-ink">{session.username}</dd>
          <dt className="text-ink-muted">Peran</dt>
          <dd className="text-ink">{session.roleNama}</dd>
        </dl>
        <GantiPasswordForm wajib={wajib} beranda={HOME_ROUTE[session.role]} />
        <p className="mt-4 text-meta text-ink-muted">
          Setelah password diganti, sesi Anda di perangkat lain otomatis
          berakhir.
        </p>
      </Card>
    </div>
  );
}
