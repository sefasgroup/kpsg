import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity, ArrowUp, CalendarClock, CheckCircle2, ListOrdered, TriangleAlert,
} from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SegarkanBerkala } from "@/components/ui/segarkan-berkala";
import { Badge, TriaseBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import {
  sudahDikajiHariIni, tertundaPerawat, worklistPerawat, type WorklistRow,
} from "@/lib/nurse";
import { formatJam, hitungUmur } from "@/lib/format";
import { tanggalHariIni } from "@/lib/tanggal";

export const metadata: Metadata = { title: "Antrean & Triase" };
export const dynamic = "force-dynamic";

function BarisPasien({ v, selesai }: { v: WorklistRow; selesai?: boolean }) {
  return (
    <li>
      <Link
        href={`/pengkajian/${v.visit_id}`}
        className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-alt px-3 py-2.5 transition-colors hover:border-brand-400 hover:bg-brand-50"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-brand-50 font-mono text-h2 font-semibold text-brand-700">
          {v.antrean ?? "—"}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-ink">
            {v.nama}
            {/* Perawat inilah pembaca utamanya — dialah yang memanggil pasien. */}
            {v.didahulukan ? (
              <span className="ml-2 inline-flex items-center gap-1 align-middle text-micro text-danger uppercase">
                <ArrowUp className="size-3" aria-hidden />
                didahulukan
              </span>
            ) : null}
            {v.alergi ? (
              <span className="ml-2 inline-flex items-center gap-1 align-middle text-micro text-danger uppercase">
                <TriangleAlert className="size-3" aria-hidden />
                alergi: {v.alergi}
              </span>
            ) : null}
          </p>
          {v.didahulukan && v.alasan_didahulukan ? (
            <p className="truncate text-meta text-danger">{v.alasan_didahulukan}</p>
          ) : null}
          <p className="truncate text-meta text-ink-muted">
            <span className="font-mono">{v.no_rm}</span> ·{" "}
            {v.jenis_kelamin === "L" ? "L" : "P"} · {hitungUmur(v.tanggal_lahir)} th ·{" "}
            {v.poli_nama} · {v.dokter_nama}
          </p>
        </div>

        <span className="text-meta text-ink-faint tabular">
          daftar {formatJam(v.waktu_daftar)}
        </span>

        {v.triase ? (
          <TriaseBadge level={v.triase as "merah" | "kuning" | "hijau" | "hitam"} />
        ) : null}

        {selesai ? (
          <Badge variant="success">
            <CheckCircle2 />
            Dikaji
          </Badge>
        ) : (
          <Badge variant={v.sudah_dikaji ? "info" : "warning"}>
            {v.sudah_dikaji ? "Lanjutkan" : "Belum dikaji"}
          </Badge>
        )}
      </Link>
    </li>
  );
}

export default async function PengkajianPage() {
  const session = await requireRole("perawat", "super_admin");
  const site = session.siteId;
  const hariIni = tanggalHariIni();

  const [menunggu, selesai, tertunda] = await Promise.all([
    worklistPerawat(site, hariIni),
    sudahDikajiHariIni(site, hariIni),
    tertundaPerawat(site, hariIni),
  ]);

  const gawat = menunggu.filter(
    (v) => v.triase === "merah" || v.triase === "kuning",
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Menunggu Dikaji" value={menunggu.length} icon={ListOrdered} />
        <StatCard label="Sudah Dikaji Hari Ini" value={selesai.length} tone="success" icon={CheckCircle2} />
        <StatCard
          label="Triase Merah / Kuning"
          value={gawat}
          tone={gawat > 0 ? "danger" : "default"}
          sub={gawat > 0 ? "Dahulukan pasien ini" : "Tidak ada kasus mendesak"}
          icon={TriangleAlert}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={ListOrdered}>Menunggu Pengkajian</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="brand">{menunggu.length}</Badge>
            <SegarkanBerkala />
          </div>
        </CardHeader>

        {menunggu.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="Tidak ada pasien menunggu"
            description="Pasien akan muncul di sini begitu didaftarkan di frontdesk."
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {menunggu.map((v) => (
              <BarisPasien key={v.visit_id} v={v} />
            ))}
          </ul>
        )}
      </Card>

      {/*
        Perangkap yang sama dengan layar dokter: `worklistPerawat()` menyaring
        `v.tanggal = ?`, sehingga pasien yang tertinggal semalam lenyap dari
        sini padahal statusnya tetap `menunggu_perawat`. Dipisah, bukan
        digabung — nomor antrean di-reset harian.
      */}
      {tertunda.length > 0 ? (
        <Card className="border-warning/30">
          <CardHeader>
            <CardTitle icon={CalendarClock}>Tertunda dari Hari Sebelumnya</CardTitle>
            <Badge variant="warning">{tertunda.length}</Badge>
          </CardHeader>
          <p className="mb-2.5 text-meta text-ink-muted">
            Pasien ini belum dikaji dan kunjungannya masih terbuka. Lanjutkan
            pengkajiannya, atau minta Pendaftaran membatalkan kunjungannya.
          </p>
          <ul className="flex flex-col gap-1.5">
            {tertunda.map((v) => (
              <BarisPasien key={v.visit_id} v={v} />
            ))}
          </ul>
        </Card>
      ) : null}

      {selesai.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle icon={CheckCircle2}>Sudah Dikaji Hari Ini</CardTitle>
            <Badge variant="neutral">{selesai.length}</Badge>
          </CardHeader>
          <p className="mb-2.5 text-meta text-ink-muted">
            Pengkajian yang sudah diteruskan ke dokter tidak bisa diubah lagi dari
            sini — perubahan setelah titik itu adalah kewenangan dokter.
          </p>
          <ul className="flex flex-col gap-1.5">
            {selesai.map((v) => (
              <BarisPasien key={v.visit_id} v={v} selesai />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
