import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { daftarAudit, entitasAudit } from "@/lib/master";
import { formatJam, formatTanggalPendek } from "@/lib/format";
import { tanggalHariIni, tanggalValid } from "@/lib/tanggal";

export const metadata: Metadata = { title: "Audit Log" };
export const dynamic = "force-dynamic";

/** Aksi yang mengubah uang, stok, atau rekam medis diberi bobot visual lebih. */
const AKSI_VARIAN: Record<string, BadgeVariant> = {
  login: "neutral",
  create: "success",
  update: "info",
  finalize: "info",
  approve: "success",
  reject: "warning",
  receive: "info",
  dispense: "racikan",
  pay: "brand",
  void: "danger",
  delete: "danger",
  reset_password: "warning",
  import: "info",
  open_shift: "neutral",
  close_shift: "neutral",
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; aksi?: string; tanggal?: string }>;
}) {
  await requireRole("super_admin");
  const sp = await searchParams;
  const tanggal = tanggalValid(sp.tanggal) ? sp.tanggal : undefined;

  const [log, entitas] = await Promise.all([
    daftarAudit({ entity: sp.entity, aksi: sp.aksi, tanggal, limit: 200 }),
    entitasAudit(),
  ]);

  const sensitif = log.filter((l) =>
    ["void", "delete", "reset_password", "pay"].includes(l.aksi),
  ).length;
  const aksiUnik = [...new Set(log.map((l) => l.aksi))].sort();

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Entri Ditampilkan" value={log.length} sub="Maks. 200 terbaru" icon={ShieldCheck} />
        <StatCard label="Jenis Entitas Tercatat" value={entitas.length} />
        <StatCard
          label="Aksi Sensitif"
          value={sensitif}
          tone={sensitif > 0 ? "warning" : "default"}
          sub="Pembatalan, hapus, reset password, pembayaran"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={ShieldCheck}>Audit Log</CardTitle>
          <form className="flex flex-wrap items-center gap-2">
            <select
              name="entity"
              defaultValue={sp.entity ?? ""}
              className="h-8 rounded-md border border-line bg-surface px-2 text-meta text-ink"
            >
              <option value="">Semua entitas</option>
              {entitas.map((e) => (
                <option key={e.entity} value={e.entity}>
                  {e.entity} ({Number(e.n)})
                </option>
              ))}
            </select>
            <select
              name="aksi"
              defaultValue={sp.aksi ?? ""}
              className="h-8 rounded-md border border-line bg-surface px-2 text-meta text-ink"
            >
              <option value="">Semua aksi</option>
              {aksiUnik.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <input
              type="date"
              name="tanggal"
              defaultValue={tanggal ?? ""}
              max={tanggalHariIni()}
              className="h-8 rounded-md border border-line bg-surface px-2 text-meta text-ink"
            />
            <button
              type="submit"
              className="h-8 rounded-md border border-line bg-surface px-2.5 text-meta text-ink-muted hover:border-line-strong hover:text-ink"
            >
              Terapkan
            </button>
          </form>
        </CardHeader>

        <p className="mb-3 text-meta text-ink-muted">
          Setiap tindakan yang mengubah rekam medis, stok, atau uang tercatat di
          sini beserta pelakunya. Entri tidak pernah dihapus — pembatalan pun
          menghasilkan entri baru, bukan menghilangkan yang lama.
        </p>

        {log.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Tidak ada entri"
            description="Tidak ada aktivitas yang cocok dengan filter ini."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-surface-alt">
                  {["Waktu", "Pelaku", "Aksi", "Entitas", "ID", "Detail"].map((h) => (
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
                {log.map((l) => (
                  <tr key={l.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5 whitespace-nowrap text-meta text-ink-muted">
                      {formatTanggalPendek(l.created_at)}
                      <span className="block text-ink-faint tabular">
                        {formatJam(l.created_at)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <p className="text-ink">{l.pelaku ?? "—"}</p>
                      <p className="text-meta text-ink-faint">
                        {l.role_nama ?? "—"}
                        {l.site_nama ? ` · ${l.site_nama}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge variant={AKSI_VARIAN[l.aksi] ?? "neutral"}>{l.aksi}</Badge>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-meta text-ink-muted">
                      {l.entity}
                    </td>
                    <td className="px-3 py-1.5 text-meta text-ink-faint tabular">
                      {l.entity_id ?? "—"}
                    </td>
                    <td className="max-w-md px-3 py-1.5">
                      {l.data_after ? (
                        <code className="block truncate font-mono text-meta text-ink-muted">
                          {JSON.stringify(l.data_after)}
                        </code>
                      ) : (
                        <span className="text-meta text-ink-faint">—</span>
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
