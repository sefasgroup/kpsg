import type { Metadata } from "next";
import { PackagePlus, Truck, Wallet } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { daftarPenerimaan, daftarSupplier, itemPenerimaan } from "@/lib/inventory";
import { formatRupiah, formatTanggalPendek } from "@/lib/format";
import { tanggalHariIni } from "@/lib/tanggal";
import { FormPenerimaan, RincianPenerimaan } from "./penerimaan-form";

export const metadata: Metadata = { title: "Penerimaan Barang" };
export const dynamic = "force-dynamic";

export default async function PenerimaanPage() {
  const session = await requireRole("farmasi", "super_admin");

  const [supplier, riwayat] = await Promise.all([
    daftarSupplier(),
    daftarPenerimaan(session.siteId, { limit: 30 }),
  ]);

  // Rincian tiap penerimaan diambil sekaligus supaya modal rinciannya
  // terbuka tanpa perjalanan bolak-balik ke server.
  const rincian = await Promise.all(
    riwayat.map((r) => itemPenerimaan(r.id).then((items) => [r.id, items] as const)),
  );
  const rincianMap = new Map(rincian);

  const bulanIni = riwayat.filter((r) => r.tanggal.slice(0, 7) === tanggalHariIni().slice(0, 7));
  const nilaiBulanIni = bulanIni.reduce((n, r) => n + Number(r.total), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Penerimaan Bulan Ini"
          value={bulanIni.length}
          sub="Dokumen tercatat"
          icon={PackagePlus}
        />
        <StatCard
          label="Nilai Bulan Ini"
          value={formatRupiah(nilaiBulanIni)}
          icon={Wallet}
        />
        <StatCard
          label="Supplier Aktif"
          value={supplier.filter((s) => s.is_active).length}
          icon={Truck}
        />
      </div>

      <FormPenerimaan
        supplier={supplier
          .filter((s) => s.is_active)
          .map((s) => ({ id: s.id, nama: s.nama }))}
        hariIni={tanggalHariIni()}
      />

      <Card>
        <CardHeader>
          <CardTitle icon={Truck}>Riwayat Penerimaan</CardTitle>
          <span className="text-meta text-ink-faint">30 dokumen terakhir</span>
        </CardHeader>

        {riwayat.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-3 py-8 text-center text-meta text-ink-faint">
            Belum ada penerimaan tercatat di cabang ini.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-surface-alt">
                  {["No. Penerimaan", "Tanggal", "Supplier", "No. Faktur", "Item", "Subtotal", "Diskon", "PPN", "Total", "Petugas"].map((c) => (
                    <th
                      key={c}
                      className="border-b border-line px-3 py-2 text-left text-label font-medium whitespace-nowrap text-ink-muted"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {riwayat.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5 font-mono text-meta text-ink">{r.no_penerimaan}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-meta text-ink-muted">
                      {formatTanggalPendek(r.tanggal)}
                    </td>
                    <td className="px-3 py-1.5 text-ink">{r.supplier_nama ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-meta text-ink-muted">
                      {r.no_faktur ?? "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      <RincianPenerimaan
                        no={r.no_penerimaan}
                        items={rincianMap.get(r.id) ?? []}
                      />
                    </td>
                    <td className="px-3 py-1.5 tabular text-ink-muted">{formatRupiah(r.subtotal)}</td>
                    <td className="px-3 py-1.5 tabular text-ink-faint">
                      {Number(r.diskon) > 0 ? `−${formatRupiah(r.diskon)}` : "—"}
                    </td>
                    <td className="px-3 py-1.5 tabular text-ink-faint">
                      {Number(r.ppn) > 0 ? formatRupiah(r.ppn) : "—"}
                    </td>
                    <td className="px-3 py-1.5 font-medium tabular text-ink">
                      {formatRupiah(r.total)}
                    </td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">{r.petugas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-meta text-ink-muted">
          Setiap penerimaan langsung menambah saldo gudang dan membentuk baris
          di kartu stok (<span className="font-mono">stock_movements</span>).
          Tidak ada tahap draft — barangnya memang sudah ada di tangan saat
          dokumen ini dibuat.
        </p>
      </Card>
    </div>
  );
}
