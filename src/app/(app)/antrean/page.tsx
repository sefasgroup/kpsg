import type { Metadata } from "next";
import { ArrowUp, ListOrdered, TriangleAlert } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusVisitBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SegarkanBerkala } from "@/components/ui/segarkan-berkala";
import { requireRole } from "@/lib/auth";
import { antreanAktif, daftarPoli } from "@/lib/visits";
import { formatJam, hitungUmur } from "@/lib/format";
import { tanggalHariIni } from "@/lib/tanggal";

export const metadata: Metadata = { title: "Antrean" };
export const dynamic = "force-dynamic";

export default async function AntreanPage() {
  const session = await requireRole("admin_cabang", "super_admin");
  const site = session.siteId;
  const hariIni = tanggalHariIni();

  const [antrean, poliList] = await Promise.all([
    antreanAktif(site, hariIni),
    daftarPoli(site),
  ]);

  /*
   * Penyegaran otomatis ikut dipasang di cabang KOSONG, bukan hanya di
   * cabang berisi. Justru di layar kosong inilah petugas paling lama
   * menatap: ia sedang menunggu pasien pertama muncul.
   */
  if (antrean.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex justify-end">
          <SegarkanBerkala />
        </div>
        <EmptyState
          icon={ListOrdered}
          title="Antrean kosong"
          description="Belum ada pasien yang menunggu dilayani hari ini. Pasien akan muncul di sini begitu didaftarkan di layar Pendaftaran."
        />
      </div>
    );
  }

  // Dikelompokkan per poli — perawat memanggil per poli, bukan dari satu daftar panjang.
  const perPoli = poliList
    .map((poli) => ({
      poli,
      items: antrean.filter((v) => v.poli_nama === poli.nama),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <SegarkanBerkala />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {perPoli.map(({ poli, items }) => (
          <div key={poli.id} className="rounded-lg border border-line bg-surface p-4">
            <p className="text-label text-ink-muted">{poli.nama}</p>
            <p className="mt-1 text-display text-ink tabular">{items.length}</p>
            <p className="mt-0.5 text-meta text-ink-faint">
              menunggu · nomor berikutnya{" "}
              <span className="font-mono font-semibold text-brand-700">
                {items[0]?.antrean ?? "—"}
              </span>
            </p>
          </div>
        ))}
      </div>

      {perPoli.map(({ poli, items }) => (
        <Card key={poli.id}>
          <CardHeader>
            <CardTitle icon={ListOrdered}>{poli.nama}</CardTitle>
            <Badge variant="brand">{items.length} pasien</Badge>
          </CardHeader>

          <ul className="flex flex-col gap-1.5">
            {items.map((v) => (
              <li
                key={v.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-alt px-3 py-2.5"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-brand-50 font-mono text-h2 font-semibold text-brand-700">
                  {v.antrean ?? "—"}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-ink">
                    {v.nama}
                    {v.didahulukan ? (
                      <span className="ml-2 inline-flex items-center gap-1 align-middle text-micro text-danger uppercase">
                        <ArrowUp className="size-3" aria-hidden />
                        didahulukan
                      </span>
                    ) : null}
                    {v.triase === "merah" || v.triase === "kuning" ? (
                      <span className="ml-2 inline-flex items-center gap-1 align-middle text-micro text-danger uppercase">
                        <TriangleAlert className="size-3" aria-hidden />
                        triase {v.triase}
                      </span>
                    ) : null}
                  </p>
                  {/* Alasannya ikut ditampilkan, bukan hanya penandanya — tanpa
                      itu petugas tidak tahu apa yang membuat pasien ini naik. */}
                  {v.didahulukan && v.alasan_didahulukan ? (
                    <p className="truncate text-meta text-danger">
                      {v.alasan_didahulukan}
                    </p>
                  ) : null}
                  <p className="truncate text-meta text-ink-muted">
                    <span className="font-mono">{v.no_rm}</span> ·{" "}
                    {v.jenis_kelamin === "L" ? "L" : "P"} ·{" "}
                    {hitungUmur(v.tanggal_lahir)} th · {v.dokter_nama}
                    {v.dokter_pengganti ? ` (diganti ${v.dokter_pengganti})` : ""}
                  </p>
                </div>

                <span className="text-meta text-ink-faint tabular">
                  daftar {formatJam(v.waktu_daftar)}
                </span>
                <StatusVisitBadge status={v.status} />
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
