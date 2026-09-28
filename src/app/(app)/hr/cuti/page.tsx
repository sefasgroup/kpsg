import type { Metadata } from "next";
import { CheckCircle2, Clock, FileBadge, Paperclip } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { daftarCuti, daftarPegawai } from "@/lib/hr";
import { JENIS_CUTI_LABEL } from "@/lib/validations/hr";
import { formatTanggalPendek } from "@/lib/format";
import { tanggalHariIni } from "@/lib/tanggal";
import { AjukanCuti, PutusanCuti } from "./cuti-client";

export const metadata: Metadata = { title: "Cuti & Izin" };
export const dynamic = "force-dynamic";

export default async function CutiPage() {
  const session = await requireRole("admin_cabang", "super_admin");
  const siteId = session.siteId;
  const hariIni = tanggalHariIni();

  if (!siteId) {
    return (
      <EmptyState
        icon={FileBadge}
        title="Pilih cabang terlebih dahulu"
        description="Pengajuan cuti dikelola per cabang."
      />
    );
  }

  const [pengajuan, pegawai] = await Promise.all([
    daftarCuti(siteId),
    daftarPegawai(siteId),
  ]);

  const pending = pengajuan.filter((p) => p.status === "pending");
  const disetujui = pengajuan.filter((p) => p.status === "disetujui");
  const sedangCuti = disetujui.filter(
    (p) => p.tanggal_mulai <= hariIni && p.tanggal_akhir >= hariIni,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Menunggu Persetujuan"
          value={pending.length}
          tone={pending.length > 0 ? "warning" : "default"}
          icon={Clock}
        />
        <StatCard label="Disetujui" value={disetujui.length} tone="success" icon={CheckCircle2} />
        <StatCard
          label="Sedang Cuti Hari Ini"
          value={sedangCuti.length}
          sub={sedangCuti.map((p) => p.pegawai).join(", ") || "Tidak ada"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={FileBadge}>Pengajuan Cuti & Izin</CardTitle>
          <AjukanCuti
            pegawai={pegawai.map((p) => ({
              id: p.id,
              nama: p.nama,
              role_nama: p.role_nama,
            }))}
            hariIni={hariIni}
          />
        </CardHeader>

        {pengajuan.length === 0 ? (
          <EmptyState
            icon={FileBadge}
            title="Belum ada pengajuan"
            description="Pengajuan yang disetujui untuk dokter otomatis menandai jadwal praktiknya berhalangan."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-surface-alt">
                  {["Pegawai", "Jenis", "Periode", "Hari", "Alasan", "Status", ""].map((h) => (
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
                {pengajuan.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5">
                      <p className="text-ink">{p.pegawai}</p>
                      <p className="text-meta text-ink-faint">{p.role_nama}</p>
                    </td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">
                      {JENIS_CUTI_LABEL[p.jenis] ?? p.jenis}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-meta text-ink-muted">
                      {formatTanggalPendek(p.tanggal_mulai)}
                      {p.tanggal_akhir !== p.tanggal_mulai
                        ? ` – ${formatTanggalPendek(p.tanggal_akhir)}`
                        : ""}
                    </td>
                    <td className="px-3 py-1.5 text-ink-muted tabular">
                      {p.jumlah_hari}
                    </td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">
                      {p.alasan ?? "—"}
                      {p.lampiran_path ? (
                        // Dilayani route berautentikasi, bukan tautan publik.
                        <a
                          href={`/api/berkas/${p.lampiran_path}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 flex items-center gap-1 text-micro text-brand-700 underline underline-offset-2"
                        >
                          <Paperclip className="size-3" aria-hidden />
                          Lihat lampiran
                        </a>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge
                        variant={
                          p.status === "disetujui"
                            ? "success"
                            : p.status === "ditolak"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {p.status}
                      </Badge>
                      {p.approver_nama ? (
                        <span className="block text-meta text-ink-faint">
                          oleh {p.approver_nama}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5">
                      {p.status === "pending" ? <PutusanCuti id={p.id} /> : null}
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
