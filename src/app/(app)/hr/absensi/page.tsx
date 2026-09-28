import type { Metadata } from "next";
import { ClipboardCheck, UserMinus, Users } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { absensiHarian } from "@/lib/hr";
import { formatJam, formatTanggalPendek } from "@/lib/format";
import { tanggalHariIni } from "@/lib/tanggal";
import { TombolAbsen, UbahStatus } from "./absensi-client";

export const metadata: Metadata = { title: "Absensi" };
export const dynamic = "force-dynamic";

export default async function AbsensiPage({
  searchParams,
}: {
  searchParams: Promise<{ tanggal?: string }>;
}) {
  const session = await requireRole("admin_cabang", "super_admin");
  const siteId = session.siteId;
  const sp = await searchParams;
  const hariIni = tanggalHariIni();
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(sp.tanggal ?? "") ? sp.tanggal! : hariIni;

  if (!siteId) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="Pilih cabang terlebih dahulu"
        description="Absensi dicatat per cabang."
      />
    );
  }

  const daftar = await absensiHarian(siteId, tanggal);
  const hadir = daftar.filter((d) => d.jam_masuk !== null).length;
  const cuti = daftar.filter((d) => Number(d.sedang_cuti) === 1).length;
  const belum = daftar.filter(
    (d) => d.jam_masuk === null && Number(d.sedang_cuti) === 0,
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Total Staf" value={daftar.length} icon={Users} />
        <StatCard label="Sudah Absen Masuk" value={hadir} tone="success" icon={ClipboardCheck} />
        <StatCard label="Sedang Cuti / Izin" value={cuti} icon={UserMinus} />
        <StatCard
          label="Belum Absen"
          value={belum}
          tone={belum > 0 ? "warning" : "default"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={ClipboardCheck}>
            Absensi {formatTanggalPendek(tanggal)}
          </CardTitle>
          <form className="flex items-center gap-2">
            <label htmlFor="tanggal" className="text-meta text-ink-muted">
              Tanggal
            </label>
            <input
              id="tanggal"
              name="tanggal"
              type="date"
              defaultValue={tanggal}
              className="h-8 rounded-md border border-line bg-surface px-2 text-meta text-ink"
            />
            <button
              type="submit"
              className="h-8 rounded-md border border-line bg-surface px-2.5 text-meta text-ink-muted hover:border-line-strong hover:text-ink"
            >
              Tampilkan
            </button>
          </form>
        </CardHeader>

        <p className="mb-3 text-meta text-ink-muted">
          Seluruh staf cabang ditampilkan, termasuk yang belum absen — supaya
          yang tidak hadir terlihat, bukan sekadar tidak muncul di daftar.
        </p>

        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="bg-surface-alt">
                {["Pegawai", "Peran", "Jam Masuk", "Jam Pulang", "Status", "Aksi"].map((h) => (
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
              {daftar.map((d) => {
                const sedangCuti = Number(d.sedang_cuti) === 1;
                return (
                  <tr key={d.user_id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5 text-ink">{d.pegawai}</td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">
                      {d.role_nama}
                    </td>
                    <td className="px-3 py-1.5 text-ink tabular">
                      {d.jam_masuk ? formatJam(d.jam_masuk) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-ink tabular">
                      {d.jam_pulang ? formatJam(d.jam_pulang) : "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      {sedangCuti ? (
                        <Badge variant="info">Cuti disetujui</Badge>
                      ) : (
                        <UbahStatus
                          userId={d.user_id}
                          tanggal={tanggal}
                          status={d.status}
                        />
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {sedangCuti || tanggal !== hariIni ? null : (
                        <TombolAbsen
                          userId={d.user_id}
                          tanggal={tanggal}
                          sudahMasuk={d.jam_masuk !== null}
                          sudahPulang={d.jam_pulang !== null}
                        />
                      )}
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
