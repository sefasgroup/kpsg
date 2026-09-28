import type { Metadata } from "next";
import { PackageMinus, ShieldCheck, Syringe, TriangleAlert } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireRole } from "@/lib/auth";
import { logBmhp } from "@/lib/nurse";
import { formatJam, formatRupiah } from "@/lib/format";
import { tanggalHariIni } from "@/lib/tanggal";

export const metadata: Metadata = { title: "Pemakaian BMHP" };
export const dynamic = "force-dynamic";

export default async function BmhpPage() {
  const session = await requireRole("perawat", "super_admin");
  const hariIni = tanggalHariIni();
  const log = await logBmhp(session.siteId, hariIni);

  const totalNilai = log.reduce((n, r) => n + Number(r.subtotal), 0);
  const totalItem = log.reduce((n, r) => n + Number(r.qty), 0);
  const belumTerpotong = log.filter((r) => r.stock_movement_id === null).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Baris Pemakaian Hari Ini" value={log.length} icon={Syringe} />
        <StatCard label="Total Unit Terpakai" value={totalItem} icon={PackageMinus} />
        <StatCard label="Nilai Masuk Tagihan" value={formatRupiah(totalNilai)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={Syringe}>Pemakaian BMHP Hari Ini</CardTitle>
          {belumTerpotong === 0 ? (
            <Badge variant="success">
              <ShieldCheck />
              Semua stok terpotong
            </Badge>
          ) : (
            <Badge variant="danger">
              <TriangleAlert />
              {belumTerpotong} baris tanpa bukti potong stok
            </Badge>
          )}
        </CardHeader>

        <p className="mb-3 text-meta text-ink-muted">
          Kolom <strong>Sisa Stok</strong> diambil dari kartu stok
          (<span className="font-mono">stock_movements.qty_after</span>), bukan
          dihitung ulang di layar ini — jadi angkanya adalah saldo yang benar-benar
          tercatat saat pemotongan terjadi.
        </p>

        {log.length === 0 ? (
          <EmptyState
            icon={Syringe}
            title="Belum ada pemakaian BMHP hari ini"
            description="Pemakaian dicatat perawat saat mengisi pengkajian awal, lalu otomatis memotong stok dan masuk tagihan pasien."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-surface-alt">
                  {["Jam", "Pasien", "Bahan", "Jumlah", "Nilai", "Sisa Stok", "Perawat", ""].map(
                    (h) => (
                      <th
                        key={h}
                        className="border-b border-line px-3 py-2 text-left text-label font-medium whitespace-nowrap text-ink-muted"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5 text-ink-muted tabular">
                      {formatJam(r.waktu)}
                    </td>
                    <td className="px-3 py-1.5">
                      <p className="text-ink">{r.nama_pasien}</p>
                      <p className="font-mono text-meta text-ink-faint">{r.no_rm}</p>
                    </td>
                    <td className="px-3 py-1.5">
                      <p className="text-ink">{r.nama_item}</p>
                      <p className="font-mono text-meta text-ink-faint">{r.kode}</p>
                    </td>
                    <td className="px-3 py-1.5 tabular">
                      {Number(r.qty)} {r.satuan}
                    </td>
                    <td className="px-3 py-1.5 tabular">{formatRupiah(r.subtotal)}</td>
                    <td className="px-3 py-1.5 tabular">
                      {r.sisa_stok === null ? (
                        <span className="text-danger">belum dipotong</span>
                      ) : (
                        Number(r.sisa_stok)
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-ink-muted">{r.perawat}</td>
                    <td className="px-3 py-1.5">
                      {r.stock_movement_id === null ? (
                        <Badge variant="danger">Tanpa bukti</Badge>
                      ) : (
                        <Badge variant="success">Terpotong</Badge>
                      )}
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
