import type { Metadata } from "next";
import { Stethoscope, Waypoints } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireRole } from "@/lib/auth";
import { daftarPoliMaster, daftarTindakanMaster } from "@/lib/master";
import { formatRupiah } from "@/lib/format";
import { FormPoli, FormTindakan, ImporMassal } from "../master-forms";

export const metadata: Metadata = { title: "Poli & Tindakan" };
export const dynamic = "force-dynamic";

export default async function TindakanPage() {
  const session = await requireRole("super_admin");
  const [poli, tindakan] = await Promise.all([
    daftarPoliMaster(session.siteId),
    daftarTindakanMaster(),
  ]);

  const kategori = [...new Set(tindakan.map((t) => t.kategori ?? "Lainnya"))];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle icon={Waypoints}>Poliklinik</CardTitle>
          <FormPoli />
        </CardHeader>

        {poli.length === 0 ? (
          <EmptyState
            icon={Waypoints}
            title="Belum ada poli"
            description="Poli dibutuhkan sebelum jadwal praktik dan pendaftaran bisa dipakai."
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {poli.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-md border border-line bg-surface-alt px-3 py-2.5"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-50 font-mono text-h2 font-semibold text-brand-700">
                  {p.prefix_antrean}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-ink">{p.nama}</p>
                  <p className="truncate text-meta text-ink-muted">
                    <span className="font-mono">{p.kode}</span>
                    {" · "}
                    {Number(p.jumlah_jadwal)} jadwal praktik
                    {p.site_nama ? ` · ${p.site_nama}` : " · global"}
                  </p>
                </div>
                <FormPoli
                  awal={{
                    id: p.id,
                    kode: p.kode,
                    nama: p.nama,
                    prefix_antrean: p.prefix_antrean,
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle icon={Stethoscope}>Tindakan Medis</CardTitle>
          <div className="flex items-center gap-2">
            <ImporMassal jenis="tindakan" />
            <FormTindakan />
          </div>
        </CardHeader>

        <p className="mb-3 text-meta text-ink-muted">
          Tarif di sini berlaku global. Cabang bisa menimpanya lewat tabel
          <span className="font-mono"> site_procedure_tariffs</span> tanpa
          mengubah master.
        </p>

        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="bg-surface-alt">
                {["Kode", "Nama Tindakan", "Tarif", "ICD-9-CM", "Dipakai", ""].map((h) => (
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
              {kategori.map((k) => (
                <>
                  <tr key={k} className="bg-surface-alt">
                    <td colSpan={6} className="border-b border-line px-3 py-1.5 text-label font-medium text-ink-muted">
                      {k}
                    </td>
                  </tr>
                  {tindakan
                    .filter((t) => (t.kategori ?? "Lainnya") === k)
                    .map((t) => (
                      <tr key={t.id} className="border-b border-line">
                        <td className="px-3 py-1.5 pl-5 font-mono text-meta text-ink-muted">{t.kode}</td>
                        <td className="px-3 py-1.5 text-ink">
                          {t.nama}
                          {Number(t.is_konsultasi) === 1 ? (
                            <Badge variant="brand" className="ml-2">Konsultasi</Badge>
                          ) : null}
                        </td>
                        <td className="px-3 py-1.5 text-ink tabular">{formatRupiah(t.tarif)}</td>
                        <td className="px-3 py-1.5 font-mono text-meta text-ink-faint">
                          {t.icd9cm ?? "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          {Number(t.dipakai) > 0 ? (
                            <Badge variant="info">{Number(t.dipakai)}×</Badge>
                          ) : (
                            <span className="text-meta text-ink-faint">belum</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          <FormTindakan
                            awal={{
                              id: t.id,
                              kode: t.kode,
                              nama: t.nama,
                              kategori: t.kategori,
                              tarif: t.tarif,
                              icd9cm: t.icd9cm,
                              is_konsultasi: Number(t.is_konsultasi),
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
