import type { Metadata } from "next";
import Link from "next/link";
import { History, Receipt } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { riwayatTransaksi } from "@/lib/cashier";
import { METODE_LABEL } from "@/lib/validations/cashier";
import { formatJam, formatRupiah } from "@/lib/format";
import { tanggalHariIni } from "@/lib/tanggal";

export const metadata: Metadata = { title: "Riwayat Transaksi" };
export const dynamic = "force-dynamic";

export default async function RiwayatPage({
  searchParams,
}: {
  searchParams: Promise<{ tanggal?: string }>;
}) {
  const session = await requireRole("kasir", "super_admin");
  const sp = await searchParams;
  const hariIni = tanggalHariIni();
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(sp.tanggal ?? "") ? sp.tanggal! : hariIni;

  const riwayat = await riwayatTransaksi(session.siteId, tanggal);
  const lunas = riwayat.filter((r) => r.status === "lunas");
  const total = lunas.reduce((n, r) => n + Number(r.total), 0);

  const perMetode = lunas.reduce<Record<string, { n: number; total: number }>>(
    (acc, r) => {
      const m = r.payment_method ?? "lainnya";
      acc[m] = { n: (acc[m]?.n ?? 0) + 1, total: (acc[m]?.total ?? 0) + Number(r.total) };
      return acc;
    },
    {},
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Transaksi Lunas" value={lunas.length} icon={Receipt} />
        <StatCard label="Total Pendapatan" value={formatRupiah(total)} tone="success" />
        <StatCard
          label="Dibatalkan"
          value={riwayat.length - lunas.length}
          tone={riwayat.length - lunas.length > 0 ? "danger" : "default"}
        />
      </div>

      {Object.keys(perMetode).length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle icon={History}>Rekap per Metode Bayar</CardTitle>
          </CardHeader>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {Object.entries(perMetode).map(([m, v]) => (
              <div key={m} className="rounded-md border border-line bg-surface-alt px-3 py-2">
                <p className="text-meta text-ink-muted">
                  {METODE_LABEL[m as keyof typeof METODE_LABEL] ?? m}
                </p>
                <p className="text-h2 text-ink tabular">{formatRupiah(v.total)}</p>
                <p className="text-meta text-ink-faint">{v.n} transaksi</p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle icon={History}>Riwayat Transaksi</CardTitle>
          <form className="flex items-center gap-2">
            <label htmlFor="tanggal" className="text-meta text-ink-muted">
              Tanggal
            </label>
            <input
              id="tanggal"
              name="tanggal"
              type="date"
              defaultValue={tanggal}
              className="h-8 rounded-md border border-line bg-surface px-2 text-meta text-ink"
            />
            <button
              type="submit"
              className="h-8 rounded-md border border-line bg-surface px-2.5 text-meta text-ink-muted hover:border-line-strong hover:text-ink"
            >
              Tampilkan
            </button>
          </form>
        </CardHeader>

        {riwayat.length === 0 ? (
          <EmptyState
            icon={History}
            title="Belum ada transaksi"
            description={`Tidak ada transaksi tercatat pada ${tanggal}.`}
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-surface-alt">
                  {["Jam", "Invoice", "Pasien", "Metode", "Total", "Kasir", "Status"].map((h) => (
                    <th
                      key={h}
                      className="border-b border-line px-3 py-2 text-left text-label font-medium whitespace-nowrap text-ink-muted"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {riwayat.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5 text-ink-muted tabular">
                      {r.paid_at ? formatJam(r.paid_at) : "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      <Link
                        href={`/kasir/${r.id}`}
                        className="font-mono text-meta text-brand-700 hover:underline"
                      >
                        {r.no_invoice}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5">
                      <p className="text-ink">{r.nama}</p>
                      <p className="font-mono text-meta text-ink-faint">{r.no_rm}</p>
                    </td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">
                      {r.payment_method
                        ? (METODE_LABEL[r.payment_method as keyof typeof METODE_LABEL] ??
                          r.payment_method)
                        : "—"}
                      {r.payment_ref ? (
                        <span className="block font-mono text-ink-faint">{r.payment_ref}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-ink tabular">{formatRupiah(r.total)}</td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">
                      {r.kasir_nama ?? "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge variant={r.status === "lunas" ? "success" : "danger"}>
                        {r.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
