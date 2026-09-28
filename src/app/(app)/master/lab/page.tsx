import type { Metadata } from "next";
import { TestTubes, TriangleAlert } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireRole } from "@/lib/auth";
import { daftarPanelMaster, parameterPanel } from "@/lib/master";
import { formatRupiah } from "@/lib/format";
import { FormPanel, FormParameter } from "../master-forms";
import { HapusParameter } from "./hapus-parameter";

export const metadata: Metadata = { title: "Panel Laboratorium" };
export const dynamic = "force-dynamic";

export default async function MasterLabPage() {
  await requireRole("super_admin");
  const panels = await daftarPanelMaster();
  const parameter = await Promise.all(
    panels.map(async (p) => ({ panelId: p.id, rows: await parameterPanel(p.id) })),
  );

  const tanpaParameter = panels.filter((p) => Number(p.jumlah_parameter) === 0);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle icon={TestTubes}>Panel Laboratorium</CardTitle>
          <FormPanel />
        </CardHeader>

        <p className="mb-3 text-meta text-ink-muted">
          Penanda hasil (Rendah / Tinggi / Kritis) dihitung dari nilai rujukan di
          sini. Ambang kritis harus berada <strong>di luar</strong> rentang
          rujukan — kalau tidak, nilai normal bisa ikut tertandai kritis.
        </p>

        {tanpaParameter.length > 0 ? (
          <p className="mb-3 flex items-start gap-1.5 rounded-md border border-warning/25 bg-warning-bg px-3 py-2 text-meta text-warning">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            {tanpaParameter.length} panel belum punya parameter:{" "}
            {tanpaParameter.map((p) => p.nama).join(", ")}. Panel tanpa parameter
            tidak bisa diisi hasilnya oleh petugas lab.
          </p>
        ) : null}

        {panels.length === 0 ? (
          <EmptyState
            icon={TestTubes}
            title="Belum ada panel"
            description="Dokter tidak bisa membuat order lab sebelum ada panelnya."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {panels.map((p) => {
              const rows = parameter.find((x) => x.panelId === p.id)?.rows ?? [];
              return (
                <div key={p.id} className="rounded-md border border-line">
                  <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-alt px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-h2 text-ink">{p.nama}</p>
                      <p className="text-meta text-ink-muted">
                        <span className="font-mono">{p.kode}</span>
                        {p.kategori ? ` · ${p.kategori}` : ""}
                        {" · "}
                        {formatRupiah(p.tarif)}
                      </p>
                    </div>
                    <Badge variant={rows.length > 0 ? "neutral" : "warning"}>
                      {rows.length} parameter
                    </Badge>
                    <FormPanel
                      awal={{ id: p.id, kode: p.kode, nama: p.nama, kategori: p.kategori, tarif: p.tarif }}
                    />
                    <FormParameter panelId={p.id} panelNama={p.nama} />
                  </div>

                  {rows.length === 0 ? (
                    <p className="px-3 py-4 text-center text-meta text-ink-faint">
                      Belum ada parameter.
                    </p>
                  ) : (
                    <table className="w-full border-collapse text-body">
                      <thead>
                        <tr>
                          {["Kode", "Parameter", "Satuan", "Tipe", "Rujukan", "Kritis", ""].map((h) => (
                            <th
                              key={h}
                              className="border-b border-line px-3 py-1.5 text-left text-label font-medium whitespace-nowrap text-ink-muted"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr
                            key={r.id}
                            className={`border-b border-line last:border-b-0 ${
                              Number(r.is_active) === 0 ? "opacity-60" : ""
                            }`}
                          >
                            <td className="px-3 py-1.5 font-mono text-meta text-ink-muted">{r.kode}</td>
                            <td className="px-3 py-1.5 text-ink">
                              {r.nama}
                              {/* Nonaktif ditulis, bukan hanya diredupkan —
                                  opacity saja tidak terbaca pembaca layar. */}
                              {Number(r.is_active) === 0 ? (
                                <span className="ml-2 text-micro tracking-wide text-ink-faint uppercase">
                                  nonaktif
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-1.5 text-meta text-ink-muted">{r.satuan ?? "—"}</td>
                            <td className="px-3 py-1.5 text-meta text-ink-muted">{r.tipe_nilai}</td>
                            <td className="px-3 py-1.5 text-meta text-ink-muted tabular">
                              {r.ref_teks ??
                                (r.ref_low || r.ref_high
                                  ? `${r.ref_low ? Number(r.ref_low) : "—"} – ${r.ref_high ? Number(r.ref_high) : "—"}`
                                  : "—")}
                            </td>
                            <td className="px-3 py-1.5 text-meta tabular">
                              {r.kritis_low || r.kritis_high ? (
                                <span className="text-danger">
                                  {r.kritis_low ? `< ${Number(r.kritis_low)}` : ""}
                                  {r.kritis_low && r.kritis_high ? " · " : ""}
                                  {r.kritis_high ? `> ${Number(r.kritis_high)}` : ""}
                                </span>
                              ) : (
                                <span className="text-ink-faint">—</span>
                              )}
                            </td>
                            <td className="flex flex-wrap items-center gap-1 px-3 py-1.5">
                              <FormParameter
                                panelId={p.id}
                                panelNama={p.nama}
                                awal={{
                                  id: r.id,
                                  kode: r.kode,
                                  nama: r.nama,
                                  satuan: r.satuan,
                                  tipe_nilai: r.tipe_nilai,
                                  pilihan: r.pilihan,
                                  ref_low: r.ref_low,
                                  ref_high: r.ref_high,
                                  ref_teks: r.ref_teks,
                                  kritis_low: r.kritis_low,
                                  kritis_high: r.kritis_high,
                                  urutan: r.urutan,
                                }}
                              />
                              <HapusParameter
                                id={r.id}
                                nama={r.nama}
                                terpakai={Number(r.terpakai)}
                                aktif={Number(r.is_active) === 1}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
