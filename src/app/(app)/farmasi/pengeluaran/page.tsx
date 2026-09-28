import type { Metadata } from "next";
import { PackageMinus, Syringe, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { daftarPengeluaran } from "@/lib/inventory";
import { JENIS_GERAKAN, toneGerakan } from "@/lib/inventory-labels";
import { formatJam, formatTanggalPendek } from "@/lib/format";
import { tanggalHariIni, tanggalValid, tambahHari } from "@/lib/tanggal";
import { FormPengeluaran } from "./pengeluaran-form";

export const metadata: Metadata = { title: "Pengeluaran Stok" };
export const dynamic = "force-dynamic";

/** Pengeluaran yang lahir dari pelayanan pasien, bukan dari layar ini. */
const DARI_PELAYANAN = new Set(["keluar_resep", "keluar_racikan", "keluar_bmhp"]);

export default async function PengeluaranPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string; jenis?: string }>;
}) {
  const session = await requireRole("farmasi", "super_admin");
  const sp = await searchParams;

  const sampai = tanggalValid(sp.sampai) ? sp.sampai : tanggalHariIni();
  const dari = tanggalValid(sp.dari) ? sp.dari : tambahHari(sampai, -30);

  const gerakan = await daftarPengeluaran(session.siteId, {
    dari,
    sampai,
    jenis: sp.jenis || undefined,
    limit: 200,
  });

  const nonResep = gerakan.filter((g) => !DARI_PELAYANAN.has(g.jenis));
  const terbuang = gerakan.filter(
    (g) => g.jenis === "keluar_kadaluarsa" || g.jenis === "keluar_rusak",
  );
  const qtyTerbuang = terbuang.reduce((n, g) => n + Number(g.qty), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Total Pergerakan Keluar"
          value={gerakan.length}
          sub={`${formatTanggalPendek(dari)} – ${formatTanggalPendek(sampai)}`}
          icon={PackageMinus}
        />
        <StatCard
          label="Non-Resep"
          value={nonResep.length}
          sub="Kadaluarsa, rusak, koreksi, opname"
          icon={TriangleAlert}
          tone={nonResep.length > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Terbuang (Kadaluarsa + Rusak)"
          value={qtyTerbuang}
          tone={qtyTerbuang > 0 ? "danger" : "default"}
          sub={`${terbuang.length} kejadian`}
          icon={Syringe}
        />
      </div>

      <FormPengeluaran />

      <Card>
        <CardHeader>
          <CardTitle icon={PackageMinus}>Arus Keluar Gudang</CardTitle>
          <form className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              name="dari"
              defaultValue={dari}
              max={tanggalHariIni()}
              className="h-8 rounded-md border border-line bg-surface px-2 text-meta text-ink"
            />
            <span className="text-meta text-ink-faint">s.d.</span>
            <input
              type="date"
              name="sampai"
              defaultValue={sampai}
              max={tanggalHariIni()}
              className="h-8 rounded-md border border-line bg-surface px-2 text-meta text-ink"
            />
            <select
              name="jenis"
              defaultValue={sp.jenis ?? ""}
              className="h-8 rounded-md border border-line bg-surface px-2 text-meta text-ink"
            >
              <option value="">Semua jenis</option>
              {Object.entries(JENIS_GERAKAN)
                .filter(([k]) => k.startsWith("keluar_"))
                .map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
            </select>
            <button
              type="submit"
              className="h-8 rounded-md border border-line bg-surface px-3 text-meta text-ink transition-colors hover:bg-surface-alt"
            >
              Terapkan
            </button>
          </form>
        </CardHeader>

        <p className="mb-3 text-meta text-ink-muted">
          Daftar ini memuat <strong>seluruh</strong> arus keluar, termasuk yang
          berasal dari resep dan BMHP perawat — supaya fisik gudang bisa
          dicocokkan tanpa berpindah layar.
        </p>

        {gerakan.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-3 py-8 text-center text-meta text-ink-faint">
            Tidak ada pergerakan keluar pada rentang ini.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-surface-alt">
                  {["Waktu", "Item", "Jenis", "Jumlah", "Saldo Setelah", "Keterangan", "Petugas"].map((c) => (
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
                {gerakan.map((g) => (
                  <tr key={g.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5 whitespace-nowrap text-meta text-ink-muted">
                      {formatTanggalPendek(g.created_at)} {formatJam(g.created_at)}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="text-ink">{g.nama}</span>
                      <span className="ml-1.5 font-mono text-micro text-ink-faint">{g.kode}</span>
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge variant={toneGerakan(g.jenis)}>
                        {JENIS_GERAKAN[g.jenis] ?? g.jenis}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 font-medium tabular text-danger">
                      −{Number(g.qty)}{" "}
                      <span className="text-meta font-normal text-ink-faint">{g.satuan_dasar}</span>
                    </td>
                    <td className="px-3 py-1.5 tabular text-ink-muted">{Number(g.qty_after)}</td>
                    <td className="max-w-xs px-3 py-1.5 text-meta text-ink-muted">
                      {g.catatan ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">{g.petugas}</td>
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
