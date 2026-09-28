"use client";

import { usePathname } from "next/navigation";
import { Eye } from "lucide-react";
import { RUTE_KELOLA_SUPER_ADMIN } from "@/lib/rbac";

/**
 * Pita "mode pemantauan" untuk Super Admin di modul operasional.
 *
 * Formulir di modul ini tetap tampil apa adanya — layar yang sama dengan
 * yang dilihat petugas — tetapi penyimpanannya ditolak di server
 * (tolakSuperAdmin). Pita ini memberi tahu SEBELUM seseorang mengisi
 * formulir panjang, bukan sesudah ditolak.
 */
export function PitaPemantauan({ semuaCabang }: { semuaCabang: boolean }) {
  const pathname = usePathname();
  const kelola = RUTE_KELOLA_SUPER_ADMIN.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  if (kelola) return null;

  return (
    <div
      role="status"
      className="mb-3 flex items-start gap-2 rounded-lg border border-line bg-surface-alt px-3 py-2 text-meta text-ink-muted"
    >
      <Eye className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        <span className="font-medium text-ink">Mode pemantauan.</span>{" "}
        Super Admin dapat melihat seluruh data di modul ini; perubahan hanya
        dilakukan oleh petugas cabang.
        {semuaCabang
          ? " Menampilkan semua cabang — pilih cabang di bilah atas untuk menyaring."
          : null}
      </p>
    </div>
  );
}
