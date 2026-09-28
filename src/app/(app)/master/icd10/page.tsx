import type { Metadata } from "next";
import { ScrollText, TriangleAlert } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { cariIcd10Master, hitungIcd10 } from "@/lib/master";
import { FormIcd10, ImporIcd10 } from "../master-forms";

export const metadata: Metadata = { title: "ICD-10" };
export const dynamic = "force-dynamic";

export default async function Icd10Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireRole("super_admin");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();

  const [kode, total] = await Promise.all([cariIcd10Master(q), hitungIcd10()]);
  const dipakai = kode.filter((k) => Number(k.dipakai) > 0).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total Kode" value={total} icon={ScrollText} />
        <StatCard label="Ditampilkan" value={kode.length} sub={q ? `Filter: "${q}"` : "100 pertama"} />
        <StatCard label="Pernah Dipakai" value={dipakai} />
      </div>

      {total < 100 ? (
        <p className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning-bg px-4 py-3 text-body text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Baru ada <strong>{total}</strong> kode ICD-10. Ini hanya data awal —
            daftar resmi Kemenkes berisi puluhan ribu kode. Impor daftar lengkap
            sebelum UAT, karena diagnosa ICD-10 adalah syarat SatuSehat.
          </span>
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle icon={ScrollText}>Kode Diagnosa ICD-10</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <form className="flex items-center gap-2">
              <input
                name="q"
                defaultValue={q}
                placeholder="Cari kode atau nama…"
                className="h-8 w-56 rounded-md border border-line bg-surface px-2.5 text-meta text-ink"
              />
              <button
                type="submit"
                className="h-8 rounded-md border border-line bg-surface px-2.5 text-meta text-ink-muted hover:border-line-strong hover:text-ink"
              >
                Cari
              </button>
            </form>
            <ImporIcd10 />
            <FormIcd10 />
          </div>
        </CardHeader>

        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="bg-surface-alt">
                {["Kode", "Nama (Indonesia)", "Nama (Inggris)", "Bab", "Dipakai"].map((h) => (
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
              {kode.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-meta text-ink-faint">
                    Tidak ada kode cocok dengan “{q}”.
                  </td>
                </tr>
              ) : (
                kode.map((k) => (
                  <tr key={k.code} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5 font-mono font-semibold text-brand-700">
                      {k.code}
                    </td>
                    <td className="px-3 py-1.5 text-ink">{k.nama_id}</td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">
                      {k.nama_en ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-meta text-ink-faint">{k.bab ?? "—"}</td>
                    <td className="px-3 py-1.5">
                      {Number(k.dipakai) > 0 ? (
                        <Badge variant="info">{Number(k.dipakai)}×</Badge>
                      ) : (
                        <span className="text-meta text-ink-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
