import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle, Banknote, FileClock, HandCoins, Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SegarkanBerkala } from "@/components/ui/segarkan-berkala";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { daftarKlaim, ringkasanKlaim, umurPiutang } from "@/lib/klaim";
import { opsiPenjamin } from "@/lib/penjamin";
import { formatRupiah, formatTanggalPendek } from "@/lib/format";
import { LABEL_STATUS_KLAIM } from "@/lib/validations/klaim";
import { akhirBulan, awalBulan, tambahHari, tanggalHariIni } from "@/lib/tanggal";
import { BuatKlaim, type KandidatBaris } from "./klaim-client";
import { cariKandidatAction } from "./cari-actions";

export const metadata: Metadata = { title: "Klaim & Piutang" };
export const dynamic = "force-dynamic";

const WARNA_STATUS: Record<string, "neutral" | "warning" | "info" | "success" | "danger"> = {
  draft: "neutral",
  diajukan: "warning",
  disetujui: "info",
  lunas: "success",
  batal: "danger",
};

export default async function KlaimPage() {
  const session = await requireRole("admin_cabang", "super_admin");

  if (!session.siteId) {
    return (
      <EmptyState
        icon={HandCoins}
        title="Pilih cabang terlebih dahulu"
        description="Klaim lahir dari tagihan cabang, jadi berkasnya selalu terikat satu cabang."
      />
    );
  }
  const siteId = session.siteId;

  const [ring, klaim, piutang, penjamin] = await Promise.all([
    ringkasanKlaim(siteId),
    daftarKlaim(siteId, { limit: 100 }),
    umurPiutang(siteId),
    opsiPenjamin(),
  ]);

  // Bawaan periode klaim = bulan LALU. Berkas biasanya disusun awal bulan
  // untuk pelayanan bulan sebelumnya, bukan untuk bulan yang masih berjalan.
  const bulanLalu = tambahHari(awalBulan(tanggalHariIni()), -1);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Piutang Penjamin"
          value={formatRupiah(ring.piutang)}
          sub={`${ring.diajukan} klaim berjalan`}
          tone={ring.piutang > 0 ? "info" : "default"}
          icon={Wallet}
        />
        <StatCard
          label="Lewat Jatuh Tempo"
          value={formatRupiah(ring.nilaiTerlambat)}
          sub={
            ring.terlambat > 0
              ? `${ring.terlambat} klaim perlu ditagih ulang`
              : "Tidak ada yang terlambat"
          }
          tone={ring.terlambat > 0 ? "danger" : "success"}
          icon={AlertTriangle}
        />
        <StatCard
          label="Nilai Diajukan"
          value={formatRupiah(ring.nilaiDiajukan)}
          icon={Banknote}
        />
        <StatCard
          label="Draft Belum Diajukan"
          value={ring.draft}
          sub={ring.draft > 0 ? "Belum dikirim ke penjamin" : "Semua sudah diajukan"}
          tone={ring.draft > 0 ? "warning" : "default"}
          icon={FileClock}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={HandCoins}>Berkas Klaim</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="brand">{klaim.length}</Badge>
            <SegarkanBerkala detik={60} />
            <BuatKlaim
              penjamin={penjamin.map((p) => ({
                id: Number(p.id), kode: p.kode, nama: p.nama, jenis: p.jenis,
              }))}
              bawaanDari={awalBulan(bulanLalu)}
              bawaanSampai={akhirBulan(bulanLalu)}
              cariKandidat={cariKandidatAction as unknown as (
                payerId: number, dari: string, sampai: string,
              ) => Promise<KandidatBaris[]>}
            />
          </div>
        </CardHeader>

        {penjamin.length === 0 ? (
          <p className="rounded-md border border-warning/30 bg-warning-bg px-3 py-4 text-meta text-ink">
            Belum ada penjamin terdaftar. Minta Super Admin menambahkannya di{" "}
            <strong>Master Data → Penjamin &amp; Tarif Kontrak</strong> sebelum
            klaim bisa dibuat.
          </p>
        ) : klaim.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title="Belum ada berkas klaim"
            description="Klaim dibuat dari tagihan yang sudah lunas dan ditanggung penjamin. Tekan Buat Klaim untuk memeriksa tagihan yang tersedia."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-line bg-surface-alt text-left text-label text-ink-muted">
                  <th className="px-2 py-1.5">No. Klaim</th>
                  <th className="px-2 py-1.5">Penjamin</th>
                  <th className="px-2 py-1.5">Periode</th>
                  <th className="px-2 py-1.5 text-right">Baris</th>
                  <th className="px-2 py-1.5 text-right">Diajukan</th>
                  <th className="px-2 py-1.5 text-right">Sisa</th>
                  <th className="px-2 py-1.5">Jatuh Tempo</th>
                  <th className="px-2 py-1.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {klaim.map((c) => {
                  const umur = c.umur_hari === null ? null : Number(c.umur_hari);
                  const terlambat =
                    umur !== null &&
                    umur > 0 &&
                    ["diajukan", "disetujui"].includes(c.status);
                  return (
                    <tr
                      key={c.id}
                      className={`border-b border-line last:border-b-0 ${terlambat ? "bg-danger-bg" : ""}`}
                    >
                      <td className="px-2 py-1.5">
                        <Link
                          href={`/klaim/${c.id}`}
                          className="font-mono text-meta text-brand-700 underline underline-offset-2"
                        >
                          {c.no_klaim}
                        </Link>
                      </td>
                      <td className="px-2 py-1.5">{c.payer_nama}</td>
                      <td className="px-2 py-1.5 text-meta text-ink-muted">
                        {formatTanggalPendek(c.periode_dari)} –{" "}
                        {formatTanggalPendek(c.periode_sampai)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular">
                        {Number(c.jumlah_baris)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular">
                        {formatRupiah(Number(c.total_diajukan))}
                        {Number(c.total_disetujui) > 0 &&
                        Number(c.total_disetujui) !== Number(c.total_diajukan) ? (
                          <span className="block text-micro text-warning">
                            disetujui {formatRupiah(Number(c.total_disetujui))}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium tabular">
                        {formatRupiah(Number(c.sisa))}
                      </td>
                      <td className="px-2 py-1.5 text-meta">
                        {c.jatuh_tempo ? (
                          <>
                            {formatTanggalPendek(c.jatuh_tempo)}
                            {terlambat ? (
                              <span className="block text-micro font-medium text-danger">
                                telat {umur} hari
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge variant={WARNA_STATUS[c.status] ?? "neutral"}>
                          {LABEL_STATUS_KLAIM[
                            c.status as keyof typeof LABEL_STATUS_KLAIM
                          ] ?? c.status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/*
        Umur piutang dipisah dari daftar klaim karena menjawab pertanyaan
        yang berbeda: bukan "berkas apa saja yang ada", melainkan "uang
        klinik yang tertahan di siapa, dan sudah berapa lama".
      */}
      {piutang.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle icon={Wallet}>Umur Piutang per Penjamin</CardTitle>
          </CardHeader>
          <p className="mb-2.5 text-meta text-ink-muted">
            Piutang yang melewati <strong>90 hari</strong> dipisahkan tersendiri:
            pada titik itu masalahnya biasanya bukan penjamin yang lambat
            membayar, melainkan berkas yang hilang atau ditolak tanpa
            pemberitahuan.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-line bg-surface-alt text-left text-label text-ink-muted">
                  <th className="px-2 py-1.5">Penjamin</th>
                  <th className="px-2 py-1.5 text-right">Belum J.Tempo</th>
                  <th className="px-2 py-1.5 text-right">1–30 hr</th>
                  <th className="px-2 py-1.5 text-right">31–60 hr</th>
                  <th className="px-2 py-1.5 text-right">61–90 hr</th>
                  <th className="px-2 py-1.5 text-right">&gt;90 hr</th>
                  <th className="px-2 py-1.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {piutang.map((p) => (
                  <tr key={p.penjaminId} className="border-b border-line last:border-b-0">
                    <td className="px-2 py-1.5">{p.penjamin}</td>
                    <td className="px-2 py-1.5 text-right tabular text-ink-muted">
                      {p.belumJatuhTempo > 0 ? formatRupiah(p.belumJatuhTempo) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular">
                      {p.umur1_30 > 0 ? formatRupiah(p.umur1_30) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular text-warning">
                      {p.umur31_60 > 0 ? formatRupiah(p.umur31_60) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular text-warning">
                      {p.umur61_90 > 0 ? formatRupiah(p.umur61_90) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium tabular text-danger">
                      {p.umurLebih90 > 0 ? formatRupiah(p.umurLebih90) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium tabular">
                      {formatRupiah(p.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
