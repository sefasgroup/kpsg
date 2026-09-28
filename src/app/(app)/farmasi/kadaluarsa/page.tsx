import type { Metadata } from "next";
import { AlertTriangle, CalendarClock, PackageX, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { ambangKadaluarsa, batchKadaluarsa } from "@/lib/inventory";
import { formatRupiah, formatTanggalPendek } from "@/lib/format";
import { TarikBatch } from "./tarik-batch";

export const metadata: Metadata = { title: "Monitoring Kadaluarsa" };
export const dynamic = "force-dynamic";

/** Tingkat urgensi berdasarkan sisa hari. Label teks selalu ikut, bukan warna saja. */
function urgensi(sisa: number) {
  if (sisa < 0) return { label: "Kadaluarsa", variant: "danger" as const, urutan: 0 };
  if (sisa <= 30) return { label: `${sisa} hari lagi`, variant: "danger" as const, urutan: 1 };
  if (sisa <= 90) return { label: `${sisa} hari lagi`, variant: "warning" as const, urutan: 2 };
  return { label: `${sisa} hari lagi`, variant: "neutral" as const, urutan: 3 };
}

export default async function KadaluarsaPage() {
  const session = await requireRole("farmasi", "super_admin");

  const ambang = await ambangKadaluarsa(session.siteId);
  const batch = await batchKadaluarsa(session.siteId, ambang);

  const lewat = batch.filter((b) => Number(b.sisa_hari) < 0);
  const sebulan = batch.filter((b) => Number(b.sisa_hari) >= 0 && Number(b.sisa_hari) <= 30);
  const nilaiLewat = lewat.reduce(
    (n, b) => n + Math.min(Number(b.qty), Number(b.stok_item)) * Number(b.hpp),
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard
          label="Sudah Kadaluarsa"
          value={lewat.length}
          tone={lewat.length > 0 ? "danger" : "success"}
          sub={lewat.length > 0 ? "Tarik dari peredaran sekarang" : "Tidak ada"}
          icon={PackageX}
        />
        <StatCard
          label="Kadaluarsa ≤ 30 Hari"
          value={sebulan.length}
          tone={sebulan.length > 0 ? "warning" : "default"}
          icon={AlertTriangle}
        />
        <StatCard
          label={`Dipantau (≤ ${ambang} hari)`}
          value={batch.length}
          sub="Ambang dari Pengaturan"
          icon={CalendarClock}
        />
        <StatCard
          label="Nilai Berisiko Hangus"
          value={formatRupiah(nilaiLewat)}
          tone={nilaiLewat > 0 ? "danger" : "default"}
          sub="Batch yang sudah lewat, senilai HPP"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={AlertTriangle}>Batch Mendekati / Melewati Kadaluarsa</CardTitle>
          <span className="text-meta text-ink-faint">
            Ambang peringatan {ambang} hari
          </span>
        </CardHeader>

        <p className="mb-3 text-meta text-ink-muted">
          Batch terbentuk saat penerimaan dan dikonsumsi <strong>FEFO</strong> —
          yang paling cepat kadaluarsa keluar lebih dulu saat resep diserahkan,
          racikan dibuat, atau BMHP dipakai. Kolom <em>Sisa Batch</em> karena itu
          adalah sisa yang sebenarnya. Sebagian saldo bisa tidak punya batch
          (saldo awal, atau penerimaan tanpa nomor batch); bagian itu keluar
          terakhir dan tercatat tanpa batch.
        </p>

        {batch.length === 0 ? (
          <div className="flex flex-col items-center rounded-md border border-dashed border-line px-4 py-10 text-center">
            <ShieldCheck className="size-9 text-success" strokeWidth={1.5} aria-hidden />
            <p className="mt-2 text-body text-ink">
              Tidak ada batch yang mendekati kadaluarsa dalam {ambang} hari.
            </p>
            <p className="mt-1 max-w-md text-meta text-ink-muted">
              Item yang diterima tanpa nomor batch maupun tanggal kadaluarsa tidak
              ikut terpantau di sini — isi kedua kolom itu saat penerimaan agar
              obatnya masuk pemantauan.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-surface-alt">
                  {["Status", "Item", "No. Batch", "Kadaluarsa", "Sisa Batch", "Saldo Gudang", "Nilai (HPP)", "Supplier", ""].map((c) => (
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
                {batch.map((b) => {
                  const sisa = Number(b.sisa_hari);
                  const u = urgensi(sisa);
                  const stok = Number(b.stok_item);
                  return (
                    <tr key={b.id} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-1.5">
                        <Badge variant={u.variant}>{u.label}</Badge>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="text-ink">{b.nama}</span>
                        <span className="ml-1.5 font-mono text-micro text-ink-faint">{b.kode}</span>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-meta text-ink-muted">
                        {b.no_batch ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-meta text-ink">
                        {formatTanggalPendek(b.tanggal_kadaluarsa)}
                      </td>
                      <td className="px-3 py-1.5 tabular text-ink-muted">
                        {Number(b.qty)}{" "}
                        <span className="text-micro text-ink-faint">{b.satuan_dasar}</span>
                      </td>
                      <td
                        className={`px-3 py-1.5 tabular ${
                          stok <= 0 ? "text-ink-faint" : "text-ink"
                        }`}
                      >
                        {stok}
                      </td>
                      <td className="px-3 py-1.5 tabular text-ink-muted">
                        {formatRupiah(Math.min(Number(b.qty), stok) * Number(b.hpp))}
                      </td>
                      <td className="px-3 py-1.5 text-meta text-ink-muted">
                        {b.supplier_nama ?? "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <TarikBatch
                          batchId={b.id}
                          nama={b.nama}
                          noBatch={b.no_batch}
                          kadaluarsa={formatTanggalPendek(b.tanggal_kadaluarsa)}
                          qtyBatch={Number(b.qty)}
                          stokItem={stok}
                          satuan={b.satuan_dasar}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
