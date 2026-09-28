import type { Metadata } from "next";
import { ClipboardCheck, History, ScanLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { daftarOpname, itemOpname, opnameDraft } from "@/lib/inventory";
import { formatTanggalPendek } from "@/lib/format";
import { tanggalHariIni } from "@/lib/tanggal";
import { BukaOpname, LembarHitung } from "./opname-client";

export const metadata: Metadata = { title: "Stock Opname" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "neutral" }> = {
  draft: { label: "Berjalan", variant: "warning" },
  final: { label: "Final", variant: "success" },
  batal: { label: "Batal", variant: "neutral" },
};

export default async function OpnamePage() {
  const session = await requireRole("farmasi", "super_admin");

  if (!session.siteId) {
    return (
      <EmptyState
        icon={ScanLine}
        title="Pilih cabang terlebih dahulu"
        description="Stock opname selalu menghitung gudang satu cabang. Pilih cabang aktif di kanan atas."
      />
    );
  }

  const [draft, riwayat] = await Promise.all([
    opnameDraft(session.siteId),
    daftarOpname(session.siteId, 30),
  ]);

  const baris = draft ? await itemOpname(draft.id, session.siteId) : [];
  const final = riwayat.filter((r) => r.status === "final");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Status Saat Ini"
          value={draft ? "Berjalan" : "Tidak ada"}
          sub={draft ? draft.no_opname : "Siap membuka lembar baru"}
          tone={draft ? "warning" : "default"}
          icon={ClipboardCheck}
        />
        <StatCard label="Opname Final" value={final.length} sub="30 lembar terakhir" icon={History} />
        <StatCard
          label="Item Berselisih (Lembar Berjalan)"
          value={draft ? Number(draft.jumlah_selisih) : "—"}
          tone={draft && Number(draft.jumlah_selisih) > 0 ? "warning" : "default"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={ClipboardCheck}>
            {draft ? `Lembar Hitung ${draft.no_opname}` : "Stock Opname"}
          </CardTitle>
          <BukaOpname hariIni={tanggalHariIni()} aktif={Boolean(draft)} />
        </CardHeader>

        {draft ? (
          <>
            <p className="mb-3 text-meta text-ink-muted">
              Dibuka {formatTanggalPendek(draft.tanggal)} oleh {draft.petugas}
              {draft.catatan ? ` — ${draft.catatan}` : ""}. Hitungan tersimpan
              otomatis saat kursor meninggalkan kolom.
            </p>
            <LembarHitung opnameId={draft.id} noOpname={draft.no_opname} baris={baris} />
          </>
        ) : (
          <div className="rounded-md border border-dashed border-line px-4 py-8 text-center">
            <p className="text-body text-ink">Tidak ada lembar hitung yang berjalan.</p>
            <p className="mx-auto mt-1 max-w-lg text-meta text-ink-muted">
              Membuka lembar baru akan memotret saldo sistem seluruh item aktif.
              Hanya satu lembar boleh berjalan per cabang — dua opname paralel
              akan saling menimpa koreksinya.
            </p>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle icon={History}>Riwayat Opname</CardTitle>
        </CardHeader>

        {riwayat.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-3 py-8 text-center text-meta text-ink-faint">
            Belum pernah ada stock opname di cabang ini.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-surface-alt">
                  {["No. Opname", "Tanggal", "Status", "Item", "Berselisih", "Lebih", "Kurang", "Dibuka Oleh", "Difinalkan"].map((c) => (
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
                {riwayat.map((r) => {
                  const s = STATUS[r.status] ?? { label: r.status, variant: "neutral" as const };
                  return (
                    <tr key={r.id} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-1.5 font-mono text-meta text-ink">{r.no_opname}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-meta text-ink-muted">
                        {formatTanggalPendek(r.tanggal)}
                      </td>
                      <td className="px-3 py-1.5">
                        <Badge variant={s.variant}>{s.label}</Badge>
                      </td>
                      <td className="px-3 py-1.5 tabular text-ink-muted">{Number(r.jumlah_item)}</td>
                      <td
                        className={`px-3 py-1.5 tabular ${
                          Number(r.jumlah_selisih) > 0 ? "text-warning" : "text-ink-faint"
                        }`}
                      >
                        {Number(r.jumlah_selisih)}
                      </td>
                      <td className="px-3 py-1.5 tabular text-success">
                        {Number(r.selisih_plus) > 0 ? `+${Number(r.selisih_plus)}` : "—"}
                      </td>
                      <td className="px-3 py-1.5 tabular text-danger">
                        {Number(r.selisih_minus) < 0 ? Number(r.selisih_minus) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-meta text-ink-muted">{r.petugas}</td>
                      <td className="px-3 py-1.5 text-meta text-ink-muted">
                        {r.finalisator ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-meta text-ink-muted">
          Koreksi opname dihitung dari selisih terhadap <strong>potret saat lembar
          dibuka</strong>, bukan terhadap saldo saat finalisasi. Dengan begitu resep
          yang diserahkan di sela penghitungan tidak ikut terhapus oleh koreksi.
        </p>
      </Card>
    </div>
  );
}
