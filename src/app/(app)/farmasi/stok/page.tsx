import type { Metadata } from "next";
import { AlertTriangle, Package, PackageX, Wallet } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { daftarStok } from "@/lib/pharmacy";
import { formatRupiah } from "@/lib/format";

export const metadata: Metadata = { title: "Stok Obat & BMHP" };
export const dynamic = "force-dynamic";

export default async function StokPage() {
  const session = await requireRole("farmasi", "super_admin");
  const stok = await daftarStok(session.siteId);

  // Habis/menipis dihitung dari yang TERSEDIA; nilai persediaan dari yang
  // FISIK — barang terkunci tetap milik klinik dan tetap punya nilai.
  const tersedia = (s: (typeof stok)[number]) =>
    Math.max(0, Number(s.stok) - Number(s.reserved));

  const habis = stok.filter((s) => tersedia(s) <= 0).length;
  const menipis = stok.filter(
    (s) => tersedia(s) > 0 && tersedia(s) <= s.min_stock,
  ).length;
  const nilaiStok = stok.reduce((n, s) => n + Number(s.stok) * Number(s.hpp), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Jenis Item Aktif" value={stok.length} icon={Package} />
        <StatCard
          label="Stok Menipis"
          value={menipis}
          tone={menipis > 0 ? "warning" : "default"}
          sub={menipis > 0 ? "Di bawah stok minimum" : "Semua aman"}
          icon={AlertTriangle}
        />
        <StatCard
          label="Stok Habis"
          value={habis}
          tone={habis > 0 ? "danger" : "default"}
          icon={PackageX}
        />
        <StatCard label="Nilai Stok (HPP)" value={formatRupiah(nilaiStok)} icon={Wallet} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={Package}>Stok Obat & BMHP</CardTitle>
          <span className="text-meta text-ink-faint">
            Diurutkan: yang perlu perhatian di atas
          </span>
        </CardHeader>

        <p className="mb-3 text-meta text-ink-muted">
          Saldo di sini adalah cache dari kartu stok
          (<span className="font-mono">stock_movements</span>). Setiap pemotongan —
          BMHP perawat, obat paten, maupun bahan racikan — selalu lewat kartu stok,
          sehingga saldo ini bisa direkonsiliasi kapan saja.
        </p>

        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="bg-surface-alt">
                {["Kode", "Nama", "Kategori", "Bentuk", "Stok Fisik", "Terkunci", "Tersedia", "Min", "HPP", "Harga Jual", "Status"].map((h) => (
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
              {stok.map((s) => {
                const qty = Number(s.stok);
                const dikunci = Number(s.reserved);
                /*
                 * Status dihitung dari yang TERSEDIA, bukan yang ada di rak.
                 * Barang yang sudah dikunci untuk resep pasien lain tidak bisa
                 * dipakai — menghitungnya sebagai stok aman membuat peringatan
                 * "menipis" terlambat justru saat paling dibutuhkan.
                 */
                const tersedia = Math.max(0, qty - dikunci);
                const status =
                  tersedia <= 0 ? "habis" : tersedia <= s.min_stock ? "menipis" : "aman";
                return (
                  <tr key={s.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5 font-mono text-meta text-ink-muted">{s.kode}</td>
                    <td className="px-3 py-1.5">
                      <span className="text-ink">{s.nama}</span>
                      {s.tipe !== "obat" ? (
                        <span className="ml-1.5 text-micro text-ink-faint uppercase">
                          {s.tipe}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">
                      {s.kategori ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">
                      {s.bentuk_sediaan ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-ink tabular">
                      {qty} <span className="text-meta font-normal text-ink-faint">{s.satuan_dasar}</span>
                    </td>
                    <td className="px-3 py-1.5 tabular">
                      {dikunci > 0 ? (
                        <span className="text-warning">{dikunci}</span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td
                      className={`px-3 py-1.5 font-medium tabular ${
                        status === "habis"
                          ? "text-danger"
                          : status === "menipis"
                            ? "text-warning"
                            : "text-ink"
                      }`}
                    >
                      {tersedia}
                    </td>
                    <td className="px-3 py-1.5 text-ink-faint tabular">{s.min_stock}</td>
                    <td className="px-3 py-1.5 text-ink-muted tabular">{formatRupiah(s.hpp)}</td>
                    <td className="px-3 py-1.5 text-ink tabular">{formatRupiah(s.harga_jual)}</td>
                    <td className="px-3 py-1.5">
                      <Badge
                        variant={
                          status === "habis" ? "danger" : status === "menipis" ? "warning" : "success"
                        }
                      >
                        {status === "habis" ? "Habis" : status === "menipis" ? "Menipis" : "Aman"}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
