"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import toast from "react-hot-toast";
import { ArrowRight, Building2 } from "lucide-react";
import { pindahCabangAction } from "./actions";

/**
 * Pemberitahuan "pasien Anda menunggu di cabang lain" + pindah satu ketuk.
 *
 * Antrean sengaja tetap terkurung pada cabang aktif: meresepkan memotong stok
 * cabang itu dan tagihannya masuk ke sana, jadi mencampur beberapa cabang
 * dalam satu daftar mengundang salah cabang. Yang diperbaiki di sini bukan
 * pengurungannya melainkan diamnya — layar kosong yang tidak menyebutkan
 * pasien di cabang sebelah membuat dokter menyimpulkan sistemnya rusak.
 */
export function PindahCabangCepat({
  daftar,
}: {
  daftar: { site_id: number; site_nama: string; jumlah: number }[];
}) {
  const router = useRouter();
  const [proses, mulai] = useTransition();

  const total = daftar.reduce((n, c) => n + c.jumlah, 0);

  return (
    <div className="mt-3 rounded-md border border-warning/40 bg-warning/5 p-3">
      <p className="flex items-center gap-1.5 text-body text-ink">
        <Building2 className="size-4 shrink-0 text-warning" aria-hidden />
        <span>
          <strong>{total} pasien</strong> menunggu Anda di cabang lain.
        </span>
      </p>

      <ul className="mt-2 flex flex-wrap gap-2">
        {daftar.map((c) => (
          <li key={c.site_id}>
            <button
              type="button"
              disabled={proses}
              onClick={() =>
                mulai(async () => {
                  const hasil = await pindahCabangAction(c.site_id);
                  if (!hasil.ok) {
                    toast.error(hasil.error);
                    return;
                  }
                  toast.success(`Berpindah ke cabang ${c.site_nama}`);
                  router.refresh();
                })
              }
              className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-body text-ink transition-colors hover:bg-surface-alt disabled:opacity-60"
            >
              {c.site_nama}
              <span className="rounded-full bg-warning/15 px-1.5 text-meta font-medium text-warning">
                {c.jumlah}
              </span>
              <ArrowRight className="size-3.5 text-ink-faint" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-micro text-ink-faint">
        Berpindah cabang mengubah antrean, stok, dan tarif yang Anda lihat.
      </p>
    </div>
  );
}
