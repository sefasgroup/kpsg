import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Hourglass, Receipt, Wallet } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SegarkanBerkala } from "@/components/ui/segarkan-berkala";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import {
  tagihanBelumSiap,
  tagihanMenunggu,
  riwayatTransaksi,
  type TagihanRow,
} from "@/lib/cashier";
import { STATUS_LABEL } from "@/lib/visit-status";
import { formatRupiah, hitungUmur } from "@/lib/format";
import { tanggalHariIni } from "@/lib/tanggal";

export const metadata: Metadata = { title: "Tagihan Menunggu" };
export const dynamic = "force-dynamic";

function Baris({ t, aktif }: { t: TagihanRow; aktif: boolean }) {
  const isi = (
    <>
      <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-brand-50 font-mono text-h2 font-semibold text-brand-700">
        {t.antrean ?? "—"}
      </span>

      <div className="min-w-0 flex-1">
        {/* Hanya identitas administratif — tidak ada informasi klinis. */}
        <p className="truncate text-body font-medium text-ink">{t.nama}</p>
        <p className="truncate text-meta text-ink-muted">
          <span className="font-mono">{t.no_rm}</span> ·{" "}
          {t.jenis_kelamin === "L" ? "L" : "P"} · {hitungUmur(t.tanggal_lahir)} th ·{" "}
          {t.poli_nama} · {t.dokter_nama}
        </p>
        <p className="truncate font-mono text-meta text-ink-faint">{t.no_invoice}</p>
      </div>

      <span className="text-meta text-ink-muted uppercase">{t.cara_bayar}</span>

      <span className="text-h2 text-ink tabular">{formatRupiah(t.total || t.subtotal)}</span>
    </>
  );

  return (
    <li>
      {aktif ? (
        <Link
          href={`/kasir/${t.id}`}
          className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-alt px-3 py-2.5 transition-colors hover:border-brand-400 hover:bg-brand-50"
        >
          {isi}
          <Badge variant="warning">Proses</Badge>
        </Link>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-3 py-2.5 opacity-70">
          {isi}
          <Badge variant="neutral">
            <Hourglass />
            {STATUS_LABEL[t.status] ?? "Belum siap"}
          </Badge>
        </div>
      )}
    </li>
  );
}

export default async function KasirPage() {
  const session = await requireRole("kasir", "super_admin");
  const hariIni = tanggalHariIni();

  const [siap, belumSiap, riwayat] = await Promise.all([
    tagihanMenunggu(session.siteId),
    tagihanBelumSiap(session.siteId),
    riwayatTransaksi(session.siteId, hariIni),
  ]);

  const lunas = riwayat.filter((r) => r.status === "lunas");
  const pendapatan = lunas.reduce((n, r) => n + Number(r.total), 0);
  const nilaiMenunggu = siap.reduce((n, r) => n + Number(r.total || r.subtotal), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Siap Dibayar" value={siap.length} icon={Receipt} />
        <StatCard label="Nilai Menunggu" value={formatRupiah(nilaiMenunggu)} icon={Wallet} />
        <StatCard label="Transaksi Lunas Hari Ini" value={lunas.length} tone="success" />
        <StatCard label="Pendapatan Hari Ini" value={formatRupiah(pendapatan)} tone="success" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={Receipt}>Tagihan Siap Dibayar</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="brand">{siap.length}</Badge>
            <SegarkanBerkala />
          </div>
        </CardHeader>

        {siap.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="Tidak ada tagihan siap dibayar"
            description="Tagihan muncul di sini setelah pasien selesai di seluruh unit layanan — dokter, laboratorium, dan apotek."
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {siap.map((t) => (
              <Baris key={t.id} t={t} aktif />
            ))}
          </ul>
        )}
      </Card>

      {belumSiap.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle icon={Clock}>Masih di Unit Lain</CardTitle>
            <Badge variant="neutral">{belumSiap.length}</Badge>
          </CardHeader>
          <p className="mb-2.5 text-meta text-ink-muted">
            Tagihan ini belum lengkap — biayanya masih bisa bertambah dari
            laboratorium atau apotek, jadi belum bisa diproses.
          </p>
          <ul className="flex flex-col gap-1.5">
            {belumSiap.map((t) => (
              <Baris key={t.id} t={t} aktif={false} />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
