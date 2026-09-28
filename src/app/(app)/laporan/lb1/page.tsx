import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity, ArrowLeft, CalendarRange, FileSpreadsheet, TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { kesiapanLb1, lb1Morbiditas } from "@/lib/laporan";
import { formatAngka, formatTanggalPendek } from "@/lib/format";
import { akhirBulan, awalBulan, tanggalHariIni, tanggalValid } from "@/lib/tanggal";

export const metadata: Metadata = { title: "Laporan LB1" };
export const dynamic = "force-dynamic";

export default async function Lb1Page({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string }>;
}) {
  const session = await requireRole("admin_cabang", "super_admin");
  const sp = await searchParams;

  if (!session.siteId) {
    return (
      <EmptyState
        icon={FileSpreadsheet}
        title="Pilih cabang terlebih dahulu"
        description="LB1 dilaporkan per fasilitas kesehatan, jadi angkanya selalu terikat satu cabang."
      />
    );
  }
  const siteId = session.siteId;

  // Bulan takwim, bukan 30 hari bergulir — LB1 dikirim per bulan.
  const dari = tanggalValid(sp.dari) ? sp.dari : awalBulan(tanggalHariIni());
  const sampai = tanggalValid(sp.sampai) ? sp.sampai : akhirBulan(dari);

  // Sekali jalan, lalu dipakai ulang — lihat catatan di layar SIPNAP.
  const baris = await lb1Morbiditas(siteId, dari, sampai);
  const siap = await kesiapanLb1(siteId, dari, sampai, baris);

  const belumLengkap = siap.tanpaAsesmenFinal + siap.tanpaDiagnosaDitegakkan;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/laporan"
        className="no-print inline-flex w-fit items-center gap-1.5 text-meta text-ink-muted transition-colors hover:text-brand-700"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Kembali ke Laporan Cabang
      </Link>

      <Card className="no-print">
        <CardHeader>
          <CardTitle icon={CalendarRange}>Periode Pelaporan</CardTitle>
          <form className="flex flex-wrap items-center gap-2">
            <input
              type="date" name="dari" defaultValue={dari} max={tanggalHariIni()}
              className="h-8 rounded-md border border-line bg-surface px-2 text-meta text-ink"
            />
            <span className="text-meta text-ink-faint">s.d.</span>
            <input
              type="date" name="sampai" defaultValue={sampai} max={tanggalHariIni()}
              className="h-8 rounded-md border border-line bg-surface px-2 text-meta text-ink"
            />
            <button
              type="submit"
              className="h-8 rounded-md border border-brand-600 bg-brand-600 px-3 text-meta font-medium text-white transition-colors hover:bg-brand-700"
            >
              Terapkan
            </button>
          </form>
        </CardHeader>
        <p className="text-meta text-ink-muted">
          Laporan Bulanan Data Kesakitan untuk Dinas Kesehatan, disusun dari
          diagnosa ICD-10 pada asesmen yang sudah <strong>final</strong>.{" "}
          <strong>Diagnosa banding tidak dihitung</strong> — itu kemungkinan
          yang sedang dipertimbangkan dokter, bukan penyakit yang dilaporkan.
        </p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Kunjungan"
          value={formatAngka(siap.kunjungan)}
          sub={`${siap.kunjunganBaru} baru · ${siap.kunjunganLama} lama`}
          icon={Activity}
        />
        <StatCard label="Kode ICD-10" value={siap.jumlahKodeIcd} icon={FileSpreadsheet} />
        <StatCard label="Total Kasus" value={formatAngka(siap.totalKasus)} />
        <StatCard
          label="Belum Terekam"
          value={belumLengkap}
          sub={
            belumLengkap > 0
              ? `${siap.tanpaAsesmenFinal} tanpa asesmen final · ${siap.tanpaDiagnosaDitegakkan} tanpa diagnosa`
              : "Semua kunjungan terekam"
          }
          tone={belumLengkap > 0 ? "warning" : "success"}
          icon={TriangleAlert}
        />
      </div>

      {/*
        Angka yang HILANG diberi tempat sendiri. Tanpa peringatan ini
        laporan tetap tercetak rapi dengan angka yang terlalu kecil, dan
        tidak ada satu pun tanda bahwa sebagian kunjungan tidak terhitung.
      */}
      {belumLengkap > 0 ? (
        <p className="rounded-lg border border-warning/30 bg-warning-bg px-4 py-2.5 text-body text-ink">
          <strong>{belumLengkap} kunjungan</strong> pada periode ini tidak masuk
          laporan: {siap.tanpaAsesmenFinal} belum difinalkan dokter dan{" "}
          {siap.tanpaDiagnosaDitegakkan} sudah final tetapi tanpa satu pun
          diagnosa ditegakkan. Angka LB1 di bawah karena itu lebih kecil
          daripada jumlah kunjungan sebenarnya.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle icon={FileSpreadsheet}>
            Morbiditas {formatTanggalPendek(dari)} – {formatTanggalPendek(sampai)}
          </CardTitle>
          <Badge variant="brand">{baris.length} kode</Badge>
        </CardHeader>

        {baris.length === 0 ? (
          <EmptyState
            icon={FileSpreadsheet}
            title="Belum ada diagnosa yang bisa dilaporkan"
            description="Baris muncul setelah dokter memfinalkan asesmen dengan sedikitnya satu diagnosa yang ditegakkan (bukan diagnosa banding)."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-line bg-surface-alt text-left text-label text-ink-muted">
                  <th className="px-2 py-1.5">Kode</th>
                  <th className="px-2 py-1.5">Nama Penyakit</th>
                  <th className="px-2 py-1.5 text-right">Baru L</th>
                  <th className="px-2 py-1.5 text-right">Baru P</th>
                  <th className="px-2 py-1.5 text-right">Lama L</th>
                  <th className="px-2 py-1.5 text-right">Lama P</th>
                  <th className="px-2 py-1.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {baris.map((b) => (
                  <tr key={b.code} className="border-b border-line last:border-b-0">
                    <td className="px-2 py-1.5 font-mono text-meta text-ink-muted">
                      {b.code}
                    </td>
                    <td className="px-2 py-1.5">{b.nama_id}</td>
                    <td className="px-2 py-1.5 text-right tabular">{Number(b.baru_l)}</td>
                    <td className="px-2 py-1.5 text-right tabular">{Number(b.baru_p)}</td>
                    <td className="px-2 py-1.5 text-right tabular">{Number(b.lama_l)}</td>
                    <td className="px-2 py-1.5 text-right tabular">{Number(b.lama_p)}</td>
                    <td className="px-2 py-1.5 text-right font-medium tabular">
                      {Number(b.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-strong bg-surface-alt font-medium">
                  <td className="px-2 py-1.5" colSpan={2}>
                    Jumlah
                  </td>
                  <td className="px-2 py-1.5 text-right tabular">
                    {baris.reduce((n, b) => n + Number(b.baru_l), 0)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular">
                    {baris.reduce((n, b) => n + Number(b.baru_p), 0)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular">
                    {baris.reduce((n, b) => n + Number(b.lama_l), 0)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular">
                    {baris.reduce((n, b) => n + Number(b.lama_p), 0)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular">
                    {formatAngka(siap.totalKasus)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
