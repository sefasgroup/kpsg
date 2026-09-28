import type { Metadata } from "next";
import { CalendarRange, FileWarning, ShieldAlert, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { daftarIkp, rekapIkp } from "@/lib/kepatuhan";
import { formatTanggalPendek } from "@/lib/format";
import { awalBulan, tambahHari, tanggalHariIni, tanggalValid } from "@/lib/tanggal";
import { IkpClient, type BarisIkp } from "./ikp-client";

export const metadata: Metadata = { title: "Insiden Keselamatan Pasien" };
export const dynamic = "force-dynamic";

export default async function IkpPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string }>;
}) {
  const session = await requireRole(
    "admin_cabang", "dokter", "perawat", "petugas_lab", "farmasi", "kasir", "super_admin",
  );
  const sp = await searchParams;

  if (!session.siteId) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Pilih cabang terlebih dahulu"
        description="Insiden dicatat per cabang, karena perbaikannya juga dikerjakan di cabang tempat kejadiannya."
      />
    );
  }
  const siteId = session.siteId;

  const bolehTindakLanjut =
    session.role === "admin_cabang" || session.role === "super_admin";

  /*
   * Jendela bawaan 3 bulan, bukan 1 bulan.
   *
   * Insiden di klinik pratama jumlahnya sedikit; jendela sebulan sering
   * kosong dan membuat layarnya terbaca seolah tidak ada apa-apa. Tiga
   * bulan adalah rentang yang biasa dipakai rapat mutu.
   */
  const sampai = tanggalValid(sp.sampai) ? sp.sampai : tanggalHariIni();
  const dari = tanggalValid(sp.dari)
    ? sp.dari
    : awalBulan(tambahHari(sampai, -60));

  /*
   * Isi laporan (kronologi, nama & No. RM pasien, pelapor, analisis) hanya
   * untuk yang menindaklanjutinya. Peran lain — termasuk kasir, yang layarnya
   * sengaja tidak menampilkan detail klinis (§2.1) — hanya melihat laporan
   * yang mereka buat sendiri. Membuka semua laporan ke semua rekan juga
   * merusak pelaporan tanpa menyalahkan: siapa melaporkan siapa jadi terbaca.
   */
  const [daftar, rekap] = await Promise.all([
    daftarIkp(siteId, {
      dari, sampai, limit: 200,
      pelaporId: bolehTindakLanjut ? undefined : session.id,
    }),
    rekapIkp(siteId, dari, sampai),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="no-print">
        <CardHeader>
          <CardTitle icon={CalendarRange}>Periode</CardTitle>
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
          {formatTanggalPendek(dari)} – {formatTanggalPendek(sampai)}.{" "}
          Pencatatan insiden keselamatan pasien (KPC/KNC/KTC/KTD/sentinel) —
          syarat akreditasi klinik, dan dasar perbaikan yang tidak mungkin
          dikerjakan tanpa datanya.
        </p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Insiden" value={rekap.total} icon={ShieldAlert} />
        <StatCard
          label="Masih Terbuka"
          value={rekap.terbuka}
          tone={rekap.terbuka > 0 ? "warning" : "success"}
          icon={FileWarning}
        />
        <StatCard
          label="Belum Digrading"
          value={rekap.belumDigrading}
          sub={rekap.belumDigrading > 0 ? "Perlu dinilai Admin Cabang" : "Semua sudah dinilai"}
          tone={rekap.belumDigrading > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Risiko Tinggi tanpa RCA"
          value={rekap.tanpaRca}
          sub={
            rekap.tanpaRca > 0
              ? "Kuning/merah belum dianalisis"
              : "Semua sudah dianalisis"
          }
          tone={rekap.tanpaRca > 0 ? "danger" : "success"}
          icon={TriangleAlert}
        />
      </div>

      {/*
        Angka `tanpaRca` diberi peringatan tersendiri karena inilah yang
        paling mudah luput: insiden risiko tinggi yang tercatat rapi tetapi
        tidak pernah dianalisis. Pencatatan tanpa analisis hanya menghasilkan
        arsip, bukan perbaikan.
      */}
      {rekap.tanpaRca > 0 ? (
        <p className="rounded-lg border border-danger/25 bg-danger-bg px-4 py-2.5 text-body text-ink">
          <strong>{rekap.tanpaRca} insiden grading kuning/merah</strong> belum punya
          analisis akar masalah. Sistem menolak menutup laporannya sampai analisis
          itu ada — insiden yang hanya diarsipkan tidak mencegah insiden berikutnya.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle icon={ShieldAlert}>
            {bolehTindakLanjut ? "Laporan Insiden" : "Laporan Saya"}
          </CardTitle>
          <Badge variant="brand">{daftar.length}</Badge>
        </CardHeader>
        {bolehTindakLanjut ? null : (
          <p className="mb-3 text-meta text-ink-muted">
            Anda melihat laporan yang Anda buat sendiri. Laporan anonim tidak
            tercantum di sini; seluruh laporan ditindaklanjuti Admin Cabang.
          </p>
        )}

        <div className="flex flex-col gap-3">
          <IkpClient
            hariIni={tanggalHariIni()}
            bolehTindakLanjut={bolehTindakLanjut}
            daftar={daftar.map<BarisIkp>((b) => ({
              id: Number(b.id),
              noIkp: b.no_ikp,
              tanggal: String(b.tanggal),
              waktu: b.waktu,
              lokasi: b.lokasi,
              jenis: b.jenis,
              grading: b.grading,
              kronologi: b.kronologi,
              dampak: b.dampak,
              tindakanSegera: b.tindakan_segera,
              analisis: b.analisis,
              rekomendasi: b.rekomendasi,
              status: b.status,
              pelapor: b.pelapor,
              pasien: b.pasien,
              noRm: b.no_rm,
            }))}
          />
        </div>
      </Card>
    </div>
  );
}
