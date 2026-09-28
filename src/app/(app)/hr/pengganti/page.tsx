import type { Metadata } from "next";
import { CalendarClock, CheckCircle2, Clock, TriangleAlert, UserCheck } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { daftarPegawai, daftarPengecualian, dokterBertugas } from "@/lib/hr";
import { JENIS_PENGECUALIAN_LABEL } from "@/lib/validations/hr";
import { formatTanggalPendek } from "@/lib/format";
import { tanggalHariIni } from "@/lib/tanggal";
import { StatusBadge, TambahPengecualian, TombolPutusan } from "./pengganti-client";

export const metadata: Metadata = { title: "Dokter Pengganti" };
export const dynamic = "force-dynamic";

export default async function PenggantiPage() {
  const session = await requireRole("admin_cabang", "super_admin");
  const siteId = session.siteId;
  const hariIni = tanggalHariIni();

  if (!siteId) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Pilih cabang terlebih dahulu"
        description="Jadwal dan pengganti dikelola per cabang."
      />
    );
  }

  const [pengecualian, pegawai, bertugas] = await Promise.all([
    daftarPengecualian(siteId, hariIni),
    daftarPegawai(siteId),
    dokterBertugas(siteId, hariIni),
  ]);

  const dokter = pegawai
    .filter((p) => p.role_code === "dokter")
    .map((p) => ({ id: p.id, nama: p.nama }));

  const pending = pengecualian.filter((p) => p.status === "pending");
  const disetujui = pengecualian.filter((p) => p.status === "disetujui");
  const kosong = bertugas.filter((b) => b.kosong);
  const digantikan = bertugas.filter((b) => b.substitute_doctor_id !== null);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Menunggu Persetujuan" value={pending.length} tone={pending.length > 0 ? "warning" : "default"} icon={Clock} />
        <StatCard label="Disetujui (mendatang)" value={disetujui.length} tone="success" icon={CheckCircle2} />
        <StatCard label="Digantikan Hari Ini" value={digantikan.length} icon={UserCheck} />
        <StatCard
          label="Poli Kosong Hari Ini"
          value={kosong.length}
          tone={kosong.length > 0 ? "danger" : "default"}
          sub={kosong.length > 0 ? "Belum ada pengganti" : "Semua terisi"}
          icon={TriangleAlert}
        />
      </div>

      {/* ---------- Kondisi hari ini ---------- */}
      <Card>
        <CardHeader>
          <CardTitle icon={UserCheck}>Bertugas Hari Ini</CardTitle>
          <span className="text-meta text-ink-faint">
            {formatTanggalPendek(hariIni)}
          </span>
        </CardHeader>

        <p className="mb-2.5 text-meta text-ink-muted">
          Daftar ini dihitung dari jadwal mingguan dikurangi pengecualian yang
          disetujui, ditambah pengganti. Layar pendaftaran memakai perhitungan
          yang sama persis — jadi petugas frontdesk tidak mungkin mendaftarkan
          pasien ke dokter yang sedang berhalangan.
        </p>

        {bertugas.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Tidak ada jadwal praktik hari ini"
            description="Atur jadwal mingguan di menu Jadwal Praktik."
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {bertugas.map((b, i) => (
              <li
                key={`${b.doctor_id}-${b.poli_id}-${i}`}
                className={`flex flex-wrap items-center gap-3 rounded-md border px-3 py-2.5 ${
                  b.kosong
                    ? "border-danger/30 bg-danger-bg"
                    : "border-line bg-surface-alt"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-ink">
                    {b.pengganti_nama ? (
                      <>
                        <span className="text-ink-faint line-through">{b.nama}</span>
                        {" → "}
                        <span className="text-brand-700">{b.pengganti_nama}</span>
                      </>
                    ) : (
                      b.nama
                    )}
                  </p>
                  <p className="truncate text-meta text-ink-muted">
                    {b.poli_nama} · {b.jam_mulai.slice(0, 5)}–{b.jam_selesai.slice(0, 5)}
                    {b.kuota > 0 ? ` · kuota ${b.kuota}` : ""}
                  </p>
                </div>

                {b.keterangan && b.keterangan !== "tambahan" ? (
                  <Badge variant="neutral">
                    {JENIS_PENGECUALIAN_LABEL[b.keterangan] ?? b.keterangan}
                  </Badge>
                ) : null}

                {b.keterangan === "tambahan" ? (
                  <Badge variant="info">Jadwal tambahan</Badge>
                ) : null}

                {b.kosong ? (
                  <Badge variant="danger">
                    <TriangleAlert />
                    Tanpa pengganti
                  </Badge>
                ) : b.pengganti_nama ? (
                  <Badge variant="success">
                    <UserCheck />
                    Digantikan
                  </Badge>
                ) : (
                  <Badge variant="success">Bertugas</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------- Daftar pengecualian ---------- */}
      <Card>
        <CardHeader>
          <CardTitle icon={CalendarClock}>Pengecualian Jadwal</CardTitle>
          <TambahPengecualian dokter={dokter} hariIni={hariIni} />
        </CardHeader>

        {pengecualian.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Belum ada pengecualian"
            description="Tetapkan pengganti saat ada dokter berhalangan, agar poli tidak kosong."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-surface-alt">
                  {["Tanggal", "Dokter", "Jenis", "Pengganti", "Alasan", "Status", ""].map((h) => (
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
                {pengecualian.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5 whitespace-nowrap text-ink-muted">
                      {formatTanggalPendek(p.tanggal)}
                    </td>
                    <td className="px-3 py-1.5 text-ink">{p.dokter_nama}</td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">
                      {JENIS_PENGECUALIAN_LABEL[p.jenis] ?? p.jenis}
                      {p.jam_mulai ? (
                        <span className="block text-ink-faint">
                          {p.jam_mulai.slice(0, 5)}–{p.jam_selesai?.slice(0, 5)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5">
                      {p.pengganti_nama ? (
                        <span className="text-brand-700">{p.pengganti_nama}</span>
                      ) : (
                        <span className="text-meta text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">
                      {p.alasan ?? "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge status={p.status} />
                      {p.approver_nama ? (
                        <span className="block text-meta text-ink-faint">
                          oleh {p.approver_nama}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5">
                      {p.status === "pending" ? <TombolPutusan id={p.id} /> : null}
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
