import type { Metadata } from "next";
import { CalendarDays, Stethoscope } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireRole } from "@/lib/auth";
import { daftarJadwal, daftarPegawai } from "@/lib/hr";
import { daftarPoli } from "@/lib/visits";
import { HARI } from "@/lib/validations/hr";
import { HapusJadwal, TambahJadwal } from "./jadwal-client";

export const metadata: Metadata = { title: "Jadwal Praktik" };
export const dynamic = "force-dynamic";

export default async function JadwalPage() {
  const session = await requireRole("admin_cabang", "super_admin");
  const siteId = session.siteId;

  if (!siteId) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Pilih cabang terlebih dahulu"
        description="Jadwal praktik dikelola per cabang."
      />
    );
  }

  const [jadwal, pegawai, poli] = await Promise.all([
    daftarJadwal(siteId),
    daftarPegawai(siteId),
    daftarPoli(siteId),
  ]);

  const dokter = pegawai
    .filter((p) => p.role_code === "dokter")
    .map((p) => ({ id: p.id, nama: p.nama }));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle icon={CalendarDays}>Jadwal Praktik Mingguan</CardTitle>
          <TambahJadwal
            dokter={dokter}
            poli={poli.map((p) => ({ id: p.id, nama: p.nama }))}
          />
        </CardHeader>

        <p className="mb-3 text-meta text-ink-muted">
          Jadwal ini berulang setiap minggu. Ketidakhadiran pada tanggal tertentu
          — cuti, izin, sakit — diatur di menu <strong>Dokter Pengganti</strong>,
          bukan dengan menghapus jadwal.
        </p>

        {jadwal.length === 0 ? (
          <EmptyState
            icon={Stethoscope}
            title="Belum ada jadwal praktik"
            description="Tambahkan jadwal agar dokter muncul sebagai pilihan di layar pendaftaran."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {HARI.map((h) => {
              const isi = jadwal.filter((j) => j.hari === h.value);
              return (
                <div
                  key={h.value}
                  className="rounded-md border border-line bg-surface-alt p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-label font-medium text-ink">{h.label}</p>
                    <Badge variant={isi.length > 0 ? "brand" : "neutral"}>
                      {isi.length}
                    </Badge>
                  </div>

                  {isi.length === 0 ? (
                    <p className="text-meta text-ink-faint">Tidak ada praktik</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {isi.map((j) => (
                        <li
                          key={j.id}
                          className="flex items-start gap-1.5 rounded-sm border border-line bg-surface px-2 py-1.5"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-meta font-medium text-ink">
                              {[j.gelar_depan, j.dokter_nama].filter(Boolean).join(" ")}
                            </p>
                            <p className="truncate text-meta text-ink-muted tabular">
                              {j.jam_mulai.slice(0, 5)}–{j.jam_selesai.slice(0, 5)}
                            </p>
                            <p className="truncate text-meta text-ink-faint">
                              {j.poli_nama}
                              {j.kuota > 0 ? ` · kuota ${j.kuota}` : ""}
                            </p>
                          </div>
                          <HapusJadwal id={j.id} label={j.dokter_nama} />
                        </li>
                      ))}
                    </ul>
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
