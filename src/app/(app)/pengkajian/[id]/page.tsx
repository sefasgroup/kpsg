import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/auth";
import {
  alergiPasien,
  getBmhpKunjungan,
  getKunjunganUntukPerawat,
  getPengkajian,
} from "@/lib/nurse";
import { formatJam, hitungUmur } from "@/lib/format";
import { PengkajianForm } from "./pengkajian-form";
import type { BarisBmhp } from "./bmhp-picker";

export const metadata: Metadata = { title: "Pengkajian Awal" };
export const dynamic = "force-dynamic";

const BOLEH_DIKAJI = ["terdaftar", "menunggu_perawat", "dikaji_perawat"];

export default async function PengkajianDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("perawat", "super_admin");
  const { id } = await params;
  const visitId = Number(id);
  if (!Number.isInteger(visitId) || visitId <= 0) notFound();

  // Pemeriksaan cabang dilakukan di query, bukan setelahnya — kunjungan
  // cabang lain tidak pernah sampai ke memori proses ini.
  const visit = await getKunjunganUntukPerawat(visitId, session.siteId);
  if (!visit) notFound();

  const [pengkajian, bmhp, alergi] = await Promise.all([
    getPengkajian(visitId),
    getBmhpKunjungan(visitId, session.siteId),
    alergiPasien(visit.patient_id),
  ]);

  const bisaDiubah = BOLEH_DIKAJI.includes(visit.status);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/pengkajian"
        className="inline-flex w-fit items-center gap-1.5 text-meta text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Kembali ke antrean
      </Link>

      <Card>
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-brand-50 font-mono text-h1 font-semibold text-brand-700">
            {visit.antrean ?? "—"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-h1 text-ink">{visit.nama}</p>
            <p className="mt-0.5 text-meta text-ink-muted">
              <span className="font-mono">{visit.no_rm}</span> ·{" "}
              {visit.jenis_kelamin === "L" ? "Laki-laki" : "Perempuan"} ·{" "}
              {hitungUmur(visit.tanggal_lahir)} tahun · {visit.poli_nama} ·{" "}
              {visit.dokter_nama}
            </p>
            <p className="mt-0.5 text-meta text-ink-faint">
              <span className="font-mono">{visit.no_visit}</span> · daftar{" "}
              {formatJam(visit.waktu_daftar)}
            </p>
          </div>
          {pengkajian ? <Badge variant="info">Sudah pernah dikaji</Badge> : null}
        </div>

        {/* Pita alergi persisten, tidak bisa ditutup (DESIGN-SYSTEM §3.1) */}
        {visit.alergi ? (
          <p className="mt-3 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-bg px-3 py-2.5 text-body text-danger">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <strong>Alergi:</strong> {visit.alergi}
            </span>
          </p>
        ) : null}
      </Card>

      {bisaDiubah ? (
        <PengkajianForm
          visitId={visitId}
          adaAlergi={Boolean(visit.alergi)}
          alergi={alergi}
          awal={{
            triase: (pengkajian?.triase ?? "hijau") as "merah" | "kuning" | "hijau" | "hitam",
            keluhan_utama: pengkajian?.keluhan_utama ?? "",
            riwayat_singkat: pengkajian?.riwayat_singkat ?? "",
            riwayat_pengobatan: pengkajian?.riwayat_pengobatan ?? "",
            td_sistolik: pengkajian?.td_sistolik ?? "",
            td_diastolik: pengkajian?.td_diastolik ?? "",
            nadi: pengkajian?.nadi ?? "",
            respirasi: pengkajian?.respirasi ?? "",
            suhu: pengkajian?.suhu ?? "",
            spo2: pengkajian?.spo2 ?? "",
            kesadaran: (pengkajian?.kesadaran ?? "") as never,
            keadaan_umum: (pengkajian?.keadaan_umum ?? "") as never,
            keadaan_gizi: (pengkajian?.keadaan_gizi ?? "") as never,
            gcs_e: pengkajian?.gcs_e ?? "",
            gcs_v: pengkajian?.gcs_v ?? "",
            gcs_m: pengkajian?.gcs_m ?? "",
            berat_badan: pengkajian?.berat_badan ?? "",
            tinggi_badan: pengkajian?.tinggi_badan ?? "",
            lingkar_perut: pengkajian?.lingkar_perut ?? "",
            skala_nyeri: pengkajian?.skala_nyeri ?? "",
            risiko_jatuh: (pengkajian?.risiko_jatuh ?? "") as never,
            status_alergi_dikonfirmasi: Boolean(
              pengkajian?.status_alergi_dikonfirmasi,
            ),
            catatan: pengkajian?.catatan ?? "",
          }}
          bmhpAwal={
            bmhp.map((b) => ({
              item_id: b.item_id,
              nama: b.nama,
              satuan: b.satuan,
              harga_satuan: Number(b.harga_satuan),
              qty: Number(b.qty),
              stok: Number(b.stok_tersedia),
            })) as BarisBmhp[]
          }
        />
      ) : (
        <Card>
          <p className="text-body text-ink">
            Pengkajian pasien ini sudah diteruskan ke dokter dan tidak bisa
            diubah dari layar perawat.
          </p>
          <p className="mt-1 text-meta text-ink-muted">
            Status kunjungan saat ini: <strong>{visit.status}</strong>. Perubahan
            setelah titik ini adalah kewenangan dokter.
          </p>
        </Card>
      )}
    </div>
  );
}
