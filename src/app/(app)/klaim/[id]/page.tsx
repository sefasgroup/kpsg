import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/auth";
import { cabangBacaDetail } from "@/lib/session";
import { barisKlaim, getKlaim, pembayaranKlaim } from "@/lib/klaim";
import { formatRupiah, formatTanggalPendek } from "@/lib/format";
import { LABEL_STATUS_KLAIM } from "@/lib/validations/klaim";
import { tanggalHariIni } from "@/lib/tanggal";
import { DetailKlaim, type BarisDetail, type PembayaranBaris } from "./detail-client";

export const metadata: Metadata = { title: "Detail Klaim" };
export const dynamic = "force-dynamic";

const WARNA: Record<string, "neutral" | "warning" | "info" | "success" | "danger"> = {
  draft: "neutral", diajukan: "warning", disetujui: "info",
  lunas: "success", batal: "danger",
};

export default async function DetailKlaimPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("admin_cabang", "super_admin");
  const { id } = await params;
  const claimId = Number(id);
  if (!Number.isInteger(claimId) || claimId <= 0) notFound();

  const klaim = await getKlaim(claimId, cabangBacaDetail(session));
  if (!klaim) notFound();

  const [baris, bayar] = await Promise.all([
    barisKlaim(claimId),
    pembayaranKlaim(claimId),
  ]);

  const umur = klaim.umur_hari === null ? null : Number(klaim.umur_hari);
  const terlambat =
    umur !== null && umur > 0 && ["diajukan", "disetujui"].includes(klaim.status);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3">
      <Link
        href="/klaim"
        className="no-print inline-flex w-fit items-center gap-1.5 text-meta text-ink-muted transition-colors hover:text-brand-700"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Kembali ke daftar klaim
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-h1 text-ink">{klaim.no_klaim}</p>
            <p className="mt-0.5 text-body text-ink-muted">
              {klaim.payer_nama}{" "}
              <span className="text-meta text-ink-faint">({klaim.payer_jenis})</span>
            </p>
            <p className="mt-0.5 text-meta text-ink-faint">
              Periode pelayanan {formatTanggalPendek(klaim.periode_dari)} –{" "}
              {formatTanggalPendek(klaim.periode_sampai)}
              {klaim.diajukan_at
                ? ` · diajukan ${formatTanggalPendek(klaim.diajukan_at)}`
                : ""}
              {klaim.jatuh_tempo
                ? ` · jatuh tempo ${formatTanggalPendek(klaim.jatuh_tempo)}`
                : ""}
            </p>
            {klaim.catatan ? (
              <p className="mt-1 text-meta text-ink-muted">{klaim.catatan}</p>
            ) : null}
            {klaim.alasan_batal ? (
              <p className="mt-1 text-meta text-danger">
                Dibatalkan: {klaim.alasan_batal}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge variant={WARNA[klaim.status] ?? "neutral"}>
              {LABEL_STATUS_KLAIM[klaim.status as keyof typeof LABEL_STATUS_KLAIM] ??
                klaim.status}
            </Badge>
            {terlambat ? (
              <Badge variant="danger">Telat {umur} hari</Badge>
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-4">
          <Angka label="Diajukan" nilai={Number(klaim.total_diajukan)} />
          <Angka
            label="Disetujui"
            nilai={Number(klaim.total_disetujui)}
            kosong="belum diverifikasi"
          />
          <Angka label="Diterima" nilai={Number(klaim.dibayar)} tone="success" />
          <Angka
            label="Sisa"
            nilai={Number(klaim.sisa)}
            tone={Number(klaim.sisa) > 0 ? "warning" : "success"}
          />
        </div>
      </Card>

      <DetailKlaim
        claimId={claimId}
        status={klaim.status}
        noKlaim={klaim.no_klaim}
        totalDiajukan={Number(klaim.total_diajukan)}
        totalDisetujui={Number(klaim.total_disetujui)}
        dibayar={Number(klaim.dibayar)}
        sisa={Number(klaim.sisa)}
        hariIni={tanggalHariIni()}
        baris={baris.map<BarisDetail>((b) => ({
          id: Number(b.id),
          noInvoice: b.no_invoice,
          tanggal: String(b.tanggal),
          noRm: b.no_rm,
          pasien: b.pasien,
          noAnggota: b.no_anggota,
          diajukan: Number(b.nilai_diajukan),
          disetujui: b.nilai_disetujui === null ? null : Number(b.nilai_disetujui),
          alasan: b.alasan_koreksi,
          isVoid: Number(b.is_void) === 1,
        }))}
        pembayaran={bayar.map<PembayaranBaris>((p) => ({
          id: Number(p.id),
          tanggal: String(p.tanggal),
          jumlah: Number(p.jumlah),
          metode: p.metode,
          ref: p.ref,
          catatan: p.catatan,
          pencatat: p.pencatat,
        }))}
      />
    </div>
  );
}

function Angka({
  label,
  nilai,
  tone = "default",
  kosong,
}: {
  label: string;
  nilai: number;
  tone?: "default" | "success" | "warning";
  kosong?: string;
}) {
  const warna =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-ink";
  return (
    <div>
      <p className="text-label text-ink-muted">{label}</p>
      <p className={`mt-0.5 text-h2 tabular ${warna}`}>
        {nilai === 0 && kosong ? (
          <span className="text-body text-ink-faint">{kosong}</span>
        ) : (
          formatRupiah(nilai)
        )}
      </p>
    </div>
  );
}
