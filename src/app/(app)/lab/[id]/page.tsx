import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/auth";
import { cabangBacaDetail } from "@/lib/session";
import { queryOne } from "@/lib/db";
import { getOrderLab, parameterOrder } from "@/lib/lab";
import { formatJam, hitungUmur } from "@/lib/format";
import { LABEL_SIFAT } from "@/lib/validations/lab";
import { HasilClient, type Parameter } from "./hasil-client";

export const metadata: Metadata = { title: "Input Hasil Lab" };
export const dynamic = "force-dynamic";

type SiteRow = import("mysql2").RowDataPacket & {
  nama: string;
  nama_legal: string | null;
  alamat: string | null;
  telepon: string | null;
  no_izin_klinik: string | null;
};

export default async function InputHasilPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("petugas_lab", "super_admin");
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId <= 0) notFound();

  const order = await getOrderLab(orderId, cabangBacaDetail(session));
  if (!order) notFound();

  const [parameter, site] = await Promise.all([
    parameterOrder(orderId),
    queryOne<SiteRow>(
      `SELECT nama, nama_legal, alamat, telepon, no_izin_klinik
         FROM sites WHERE id = ?`,
      [order.site_id],
    ),
  ]);

  const terkunci = order.status === "selesai" || order.status === "batal";

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/lab"
        className="inline-flex w-fit items-center gap-1.5 text-meta text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Kembali ke order masuk
      </Link>

      <Card>
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-brand-50 font-mono text-h1 font-semibold text-brand-700">
            {order.antrean ?? "—"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-h1 text-ink">{order.nama}</p>
            <p className="mt-0.5 text-meta text-ink-muted">
              <span className="font-mono">{order.no_rm}</span> ·{" "}
              {order.jenis_kelamin === "L" ? "Laki-laki" : "Perempuan"} ·{" "}
              {hitungUmur(order.tanggal_lahir)} tahun
            </p>
            <p className="mt-0.5 text-meta text-ink-faint">
              <span className="font-mono">{order.no_order}</span> · dikirim{" "}
              {order.dokter_nama} · {formatJam(order.ordered_at)}
            </p>
          </div>
          {order.prioritas === "cito" ? (
            <Badge variant="danger">
              <Zap />
              CITO
            </Badge>
          ) : null}
          {/*
            Sifat hasil ikut tampil di layar lab, bukan hanya di layar dokter.
            "Ditunggu" berarti ada pasien yang benar-benar duduk di ruang
            tunggu sampai angka ini keluar — itu mengubah urutan kerja
            petugas, dan tidak terbaca dari prioritas CITO saja.
          */}
          <Badge variant={order.sifat_hasil === "ditunggu" ? "warning" : "neutral"}>
            {LABEL_SIFAT[order.sifat_hasil]}
          </Badge>
          {Number(order.atas_permintaan_sendiri) === 1 ? (
            <Badge variant="neutral">APS</Badge>
          ) : null}
          <Badge variant={order.status === "selesai" ? "success" : "info"}>
            {order.status}
          </Badge>
        </div>

        {order.catatan_klinis ? (
          <p className="mt-3 rounded-md border border-line bg-surface-alt px-3 py-2 text-body text-ink">
            <span className="text-label text-ink-muted">Catatan klinis dokter: </span>
            {order.catatan_klinis}
          </p>
        ) : null}

        {order.status === "batal" && order.alasan_batal ? (
          <p className="mt-3 rounded-md border border-line-strong border-dashed bg-surface-alt px-3 py-2 text-body text-ink-muted">
            <span className="text-label">Dibatalkan: </span>
            {order.alasan_batal}
          </p>
        ) : null}

        {/*
          Petugas lab hanya menerima catatan klinis yang sengaja ditulis
          dokter untuk pemeriksaan ini — bukan akses ke rekam medis
          (CLAUDE.md §2.1: "Layar eksklusif Petugas Lab tanpa akses ubah RM").
        */}
      </Card>

      <HasilClient
        orderId={orderId}
        terkunci={terkunci}
        noOrder={order.no_order}
        pasienNama={order.nama}
        /*
         * Pembatalan hanya ditawarkan selagi order benar-benar berjalan.
         * Penjaga sebenarnya ada di server — hasil yang sudah diinput dan
         * tagihan yang sudah lunas sama-sama menolak pembatalan.
         */
        bisaDibatalkan={!terkunci}
        parameterAwal={
          parameter.map((p) => ({
            panel_id: p.panel_id,
            panel_nama: p.panel_nama,
            parameter_id: p.parameter_id,
            parameter_nama: p.parameter_nama,
            satuan: p.satuan,
            tipe_nilai: p.tipe_nilai as "numerik" | "teks" | "pilihan",
            pilihan: p.pilihan,
            ref_low: p.ref_low === null ? null : Number(p.ref_low),
            ref_high: p.ref_high === null ? null : Number(p.ref_high),
            ref_teks: p.ref_teks,
            kritis_low: p.kritis_low === null ? null : Number(p.kritis_low),
            kritis_high: p.kritis_high === null ? null : Number(p.kritis_high),
            nilai:
              p.nilai_numerik !== null
                ? String(Number(p.nilai_numerik))
                : (p.nilai_teks ?? ""),
            flag: p.flag,
          })) as Parameter[]
        }
        cetak={{
          klinik: {
            nama: site?.nama ?? "Klinik Pratama Sahabat Gamma",
            namaLegal: site?.nama_legal ?? null,
            alamat: site?.alamat ?? null,
            telepon: site?.telepon ?? null,
            noIzin: site?.no_izin_klinik ?? null,
          },
          noOrder: order.no_order,
          pasien: order.nama,
          noRm: order.no_rm,
          nik: order.nik,
          tanggalLahir: order.tanggal_lahir,
          jenisKelamin: order.jenis_kelamin,
          dokter: order.dokter_nama,
          petugas: session.nama,
          tanggalOrder: order.ordered_at,
          tanggalSelesai: null,
          baris: [],
        }}
      />
    </div>
  );
}
