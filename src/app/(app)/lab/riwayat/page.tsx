import type { Metadata } from "next";
import Link from "next/link";
import { History, TriangleAlert } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { orderSelesai } from "@/lib/lab";
import { formatJam, hitungUmur } from "@/lib/format";
import { tanggalHariIni } from "@/lib/tanggal";

export const metadata: Metadata = { title: "Riwayat & Cetak" };
export const dynamic = "force-dynamic";

export default async function RiwayatLabPage({
  searchParams,
}: {
  searchParams: Promise<{ tanggal?: string }>;
}) {
  const session = await requireRole("petugas_lab", "super_admin");
  const sp = await searchParams;
  const hariIni = tanggalHariIni();
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(sp.tanggal ?? "") ? sp.tanggal! : hariIni;

  const selesai = await orderSelesai(session.siteId, tanggal);
  const kritis = selesai.filter((o) => Number(o.ada_kritis) > 0);
  const cito = selesai.filter((o) => o.prioritas === "cito").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Pemeriksaan Selesai" value={selesai.length} icon={History} />
        <StatCard label="Prioritas CITO" value={cito} />
        <StatCard
          label="Ada Nilai Kritis"
          value={kritis.length}
          tone={kritis.length > 0 ? "danger" : "default"}
          icon={TriangleAlert}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={History}>Riwayat Pemeriksaan</CardTitle>
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

        <p className="mb-3 text-meta text-ink-muted">
          Klik satu baris untuk membuka hasilnya dan mencetak ulang lembar A4
          berkop surat.
        </p>

        {selesai.length === 0 ? (
          <EmptyState
            icon={History}
            title="Belum ada pemeriksaan selesai"
            description={`Tidak ada hasil difinalkan pada ${tanggal}.`}
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-surface-alt">
                  {["Jam", "No. Order", "Pasien", "Dokter", "Panel", "Parameter", "Ket."].map((h) => (
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
                {selesai.map((o) => (
                  <tr key={o.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5 text-ink-muted tabular">
                      {formatJam(o.ordered_at)}
                    </td>
                    <td className="px-3 py-1.5">
                      <Link
                        href={`/lab/${o.id}`}
                        className="font-mono text-meta text-brand-700 hover:underline"
                      >
                        {o.no_order}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5">
                      <p className="text-ink">{o.nama}</p>
                      <p className="text-meta text-ink-faint">
                        <span className="font-mono">{o.no_rm}</span> ·{" "}
                        {o.jenis_kelamin === "L" ? "L" : "P"} ·{" "}
                        {hitungUmur(o.tanggal_lahir)} th
                      </p>
                    </td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">
                      {o.dokter_nama}
                    </td>
                    <td className="px-3 py-1.5 text-ink-muted tabular">
                      {Number(o.jumlah_panel)}
                    </td>
                    <td className="px-3 py-1.5 text-ink-muted tabular">
                      {Number(o.jumlah_parameter)}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {o.prioritas === "cito" ? (
                          <Badge variant="warning">CITO</Badge>
                        ) : null}
                        {Number(o.ada_kritis) > 0 ? (
                          <Badge variant="danger">
                            <TriangleAlert />
                            Kritis
                          </Badge>
                        ) : (
                          <Badge variant="success">Normal</Badge>
                        )}
                      </div>
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
