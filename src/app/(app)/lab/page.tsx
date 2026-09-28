import type { Metadata } from "next";
import Link from "next/link";
import {
  CheckCircle2, ClipboardList, FlaskConical, Hourglass, TriangleAlert, Zap,
} from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SegarkanBerkala } from "@/components/ui/segarkan-berkala";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import {
  kunjunganAktifUntukAps, orderMasuk, orderSelesai, type OrderMasuk,
} from "@/lib/lab";
import { formatJam, hitungUmur } from "@/lib/format";
import { tanggalHariIni } from "@/lib/tanggal";
import { ApsClient, type KunjunganPilihan } from "./aps-client";

export const metadata: Metadata = { title: "Order Masuk" };
export const dynamic = "force-dynamic";

function Baris({ o }: { o: OrderMasuk }) {
  const total = Number(o.jumlah_parameter);
  const diisi = Number(o.sudah_diisi);
  const kritis = Number(o.ada_kritis) > 0;

  return (
    <li>
      <Link
        href={`/lab/${o.id}`}
        className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-alt px-3 py-2.5 transition-colors hover:border-brand-400 hover:bg-brand-50"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-brand-50 font-mono text-h2 font-semibold text-brand-700">
          {o.antrean ?? "—"}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-ink">{o.nama}</p>
          <p className="truncate text-meta text-ink-muted">
            <span className="font-mono">{o.no_rm}</span> ·{" "}
            {o.jenis_kelamin === "L" ? "L" : "P"} · {hitungUmur(o.tanggal_lahir)} th ·{" "}
            {o.dokter_nama}
          </p>
          <p className="truncate font-mono text-meta text-ink-faint">{o.no_order}</p>
        </div>

        {o.prioritas === "cito" ? (
          <Badge variant="danger">
            <Zap />
            CITO
          </Badge>
        ) : null}

        {/*
          "Ditunggu" berarti ada pasien yang benar-benar duduk di ruang tunggu
          sampai angka ini keluar; "menyusul" berarti ia sudah pulang. Dua
          keadaan yang menentukan urutan kerja petugas dan tidak terbaca dari
          prioritas CITO — order rujukan pun bisa cito tapi hasilnya menyusul.
        */}
        {o.sifat_hasil === "ditunggu" ? (
          <Badge variant="warning">
            <Hourglass />
            Ditunggu pasien
          </Badge>
        ) : null}

        {Number(o.atas_permintaan_sendiri) === 1 ? (
          <Badge variant="neutral">APS</Badge>
        ) : null}

        {kritis ? (
          <Badge variant="danger">
            <TriangleAlert />
            Nilai kritis
          </Badge>
        ) : null}

        <span className="text-meta text-ink-muted tabular">
          {diisi}/{total} parameter
        </span>

        <span className="text-meta text-ink-faint tabular">
          {formatJam(o.ordered_at)}
        </span>

        <Badge variant={o.status === "baru" ? "warning" : "info"}>
          {o.status === "baru" ? "Baru" : o.status === "diproses" ? "Diproses" : o.status}
        </Badge>
      </Link>
    </li>
  );
}

export default async function LabPage() {
  const session = await requireRole("petugas_lab", "super_admin");
  const hariIni = tanggalHariIni();

  const [masuk, selesai, kunjungan] = await Promise.all([
    orderMasuk(session.siteId),
    orderSelesai(session.siteId, hariIni),
    kunjunganAktifUntukAps(session.siteId),
  ]);

  const cito = masuk.filter((o) => o.prioritas === "cito").length;
  const ditunggu = masuk.filter((o) => o.sifat_hasil === "ditunggu").length;
  const kritis = selesai.filter((o) => Number(o.ada_kritis) > 0).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Order Menunggu" value={masuk.length} icon={ClipboardList} />
        <StatCard
          label="Prioritas CITO"
          value={cito}
          tone={cito > 0 ? "danger" : "default"}
          sub={cito > 0 ? "Dahulukan" : "Tidak ada"}
          icon={Zap}
        />
        {/*
          Angka yang paling menentukan urutan kerja: berapa pasien yang
          benar-benar sedang duduk di ruang tunggu. Order `menyusul` boleh
          menunggu; yang ini tidak.
        */}
        <StatCard
          label="Pasien Menunggu Hasil"
          value={ditunggu}
          tone={ditunggu > 0 ? "warning" : "default"}
          sub={ditunggu > 0 ? "Pasien masih di klinik" : "Tidak ada"}
          icon={Hourglass}
        />
        <StatCard label="Selesai Hari Ini" value={selesai.length} tone="success" icon={CheckCircle2} />
        <StatCard
          label="Hasil dengan Nilai Kritis"
          value={kritis}
          tone={kritis > 0 ? "danger" : "default"}
          sub={kritis > 0 ? "Sudah tampil di layar dokter" : "Tidak ada"}
          icon={TriangleAlert}
        />
      </div>

      <ApsClient
        kunjungan={
          kunjungan.map((k) => ({
            visit_id: k.visit_id,
            antrean: k.antrean,
            no_rm: k.no_rm,
            nama: k.nama,
            tanggal_lahir: k.tanggal_lahir,
            jenis_kelamin: k.jenis_kelamin,
            poli_nama: k.poli_nama,
          })) as KunjunganPilihan[]
        }
      />

      <Card>
        <CardHeader>
          <CardTitle icon={FlaskConical}>Order Masuk dari Dokter</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="brand">{masuk.length}</Badge>
            <SegarkanBerkala />
          </div>
        </CardHeader>

        <p className="mb-2.5 text-meta text-ink-muted">
          Diurutkan CITO lebih dulu, lalu waktu order.
        </p>

        {masuk.length === 0 ? (
          <EmptyState
            icon={FlaskConical}
            title="Tidak ada order menunggu"
            description="Order muncul di sini begitu dokter mengirimkannya dari layar pemeriksaan."
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {masuk.map((o) => (
              <Baris key={o.id} o={o} />
            ))}
          </ul>
        )}
      </Card>

      {selesai.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle icon={CheckCircle2}>Selesai Hari Ini</CardTitle>
            <Badge variant="neutral">{selesai.length}</Badge>
          </CardHeader>
          <ul className="flex flex-col gap-1.5">
            {selesai.map((o) => (
              <Baris key={o.id} o={o} />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
