import type { Metadata } from "next";
import { Building2, Users } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { daftarCabang } from "@/lib/master";
import { FormCabang, ToggleCabang } from "./cabang-client";

export const metadata: Metadata = { title: "Cabang" };
export const dynamic = "force-dynamic";

export default async function CabangPage() {
  await requireRole("super_admin");
  const cabang = await daftarCabang();

  const aktif = cabang.filter((c) => c.is_active === 1).length;
  const totalStaf = cabang.reduce((n, c) => n + Number(c.jumlah_staf), 0);
  const totalPasien = cabang.reduce((n, c) => n + Number(c.jumlah_pasien), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Cabang Aktif" value={`${aktif} / ${cabang.length}`} icon={Building2} />
        <StatCard label="Total Staf" value={totalStaf} icon={Users} />
        <StatCard label="Total Pasien" value={totalPasien} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={Building2}>Cabang</CardTitle>
          <FormCabang />
        </CardHeader>

        <p className="mb-3 text-meta text-ink-muted">
          Cabang baru otomatis mendapat penomoran dokumennya sendiri (RM,
          kunjungan, resep, invoice, lab, surat). Data di sini juga menjadi kop
          surat pada seluruh cetakan cabang tersebut.
        </p>

        <div className="grid gap-3 lg:grid-cols-2">
          {cabang.map((c) => (
            <div
              key={c.id}
              className={`rounded-lg border p-4 ${
                c.is_active === 1 ? "border-line bg-surface" : "border-line bg-surface-alt opacity-70"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-h2 text-ink">
                    {c.nama}
                    <Badge variant={c.is_active === 1 ? "success" : "danger"}>
                      {c.is_active === 1 ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </p>
                  <p className="mt-0.5 font-mono text-meta text-brand-700">{c.kode}</p>
                  {c.nama_legal ? (
                    <p className="mt-0.5 text-meta text-ink-muted">{c.nama_legal}</p>
                  ) : null}
                </div>
                <div className="flex gap-0.5">
                  <FormCabang
                    pemicu="edit"
                    awal={{
                      id: c.id,
                      kode: c.kode,
                      nama: c.nama,
                      nama_legal: c.nama_legal ?? "",
                      no_izin_klinik: c.no_izin_klinik ?? "",
                      alamat: c.alamat ?? "",
                      kota: c.kota ?? "",
                      provinsi: c.provinsi ?? "",
                      telepon: c.telepon ?? "",
                      email: c.email ?? "",
                    }}
                  />
                  <ToggleCabang
                    id={c.id}
                    aktif={c.is_active === 1}
                    nama={c.nama}
                    adaStaf={Number(c.jumlah_staf) > 0}
                  />
                </div>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-meta">
                <div className="col-span-2">
                  <dt className="inline text-ink-faint">Alamat: </dt>
                  <dd className="inline text-ink-muted">{c.alamat ?? "—"}</dd>
                </div>
                <div>
                  <dt className="inline text-ink-faint">Telepon: </dt>
                  <dd className="inline text-ink-muted">{c.telepon ?? "—"}</dd>
                </div>
                <div>
                  <dt className="inline text-ink-faint">Izin: </dt>
                  <dd className="inline text-ink-muted">{c.no_izin_klinik ?? "—"}</dd>
                </div>
              </dl>

              <div className="mt-3 flex gap-4 border-t border-line pt-2.5 text-meta">
                <span className="text-ink-muted">
                  <strong className="text-ink tabular">{Number(c.jumlah_staf)}</strong> staf
                </span>
                <span className="text-ink-muted">
                  <strong className="text-ink tabular">{Number(c.jumlah_pasien)}</strong> pasien
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
