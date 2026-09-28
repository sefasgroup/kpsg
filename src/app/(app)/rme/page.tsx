import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUp, CalendarClock, CheckCircle2, ListOrdered, Pill, Stethoscope,
  TriangleAlert,
} from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SegarkanBerkala } from "@/components/ui/segarkan-berkala";
import { Badge, TriaseBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import {
  pasienDiCabangLain, selesaiDokterHariIni, tertundaDokter, worklistDokter,
  type WorklistDokter,
} from "@/lib/doctor";
import { PindahCabangCepat } from "./pindah-cabang-cepat";
import { formatJam, formatTanggalPendek, hitungUmur } from "@/lib/format";
import { tanggalHariIni } from "@/lib/tanggal";

export const metadata: Metadata = { title: "Antrean Saya" };
export const dynamic = "force-dynamic";

function Baris({
  v,
  selesai,
  tampilkanTanggal,
}: {
  v: WorklistDokter;
  selesai?: boolean;
  /** Untuk kunjungan tertunda: jam saja tidak cukup, harinya yang penting. */
  tampilkanTanggal?: boolean;
}) {
  return (
    <li>
      <Link
        href={`/rme/${v.visit_id}`}
        className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-alt px-3 py-2.5 transition-colors hover:border-brand-400 hover:bg-brand-50"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-brand-50 font-mono text-h2 font-semibold text-brand-700">
          {v.antrean ?? "—"}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-ink">
            {v.nama}
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
            <p className="truncate text-meta text-danger">
              Ditandai Pendaftaran: {v.alasan_didahulukan}
            </p>
          ) : null}
          <p className="truncate text-meta text-ink-muted">
            <span className="font-mono">{v.no_rm}</span> ·{" "}
            {v.jenis_kelamin === "L" ? "L" : "P"} · {hitungUmur(v.tanggal_lahir)} th ·{" "}
            {v.poli_nama}
          </p>
          {v.keluhan_utama ? (
            <p className="truncate text-meta text-ink-faint">
              Keluhan: {v.keluhan_utama}
            </p>
          ) : null}
        </div>

        <span className="text-meta text-ink-faint tabular">
          {tampilkanTanggal
            ? `${formatTanggalPendek(v.waktu_daftar)} ${formatJam(v.waktu_daftar)}`
            : formatJam(v.waktu_daftar)}
        </span>

        {v.triase ? (
          <TriaseBadge level={v.triase as "merah" | "kuning" | "hijau" | "hitam"} />
        ) : null}

        {v.ada_resep ? (
          <Badge variant="racikan">
            <Pill />
            Ada resep
          </Badge>
        ) : null}

        {selesai ? (
          <Badge variant="success">
            <CheckCircle2 />
            Selesai
          </Badge>
        ) : (
          <Badge variant={v.status === "dalam_pemeriksaan" ? "info" : "warning"}>
            {v.status === "dalam_pemeriksaan" ? "Draft tersimpan" : "Belum diperiksa"}
          </Badge>
        )}
      </Link>
    </li>
  );
}

export default async function RmePage() {
  const session = await requireRole("dokter", "super_admin");
  const hariIni = tanggalHariIni();
  const lihatSemua = session.role === "super_admin";

  const [menunggu, selesai, cabangLain, tertunda] = await Promise.all([
    worklistDokter(session.siteId, session.id, hariIni, lihatSemua),
    selesaiDokterHariIni(session.siteId, session.id, hariIni),
    pasienDiCabangLain(session.siteId, session.id, hariIni),
    tertundaDokter(session.siteId, session.id, hariIni, lihatSemua),
  ]);

  const gawat = menunggu.filter(
    (v) => v.triase === "merah" || v.triase === "kuning",
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Menunggu Diperiksa" value={menunggu.length} icon={ListOrdered} />
        <StatCard label="Selesai Hari Ini" value={selesai.length} tone="success" icon={CheckCircle2} />
        <StatCard
          label="Triase Merah / Kuning"
          value={gawat}
          tone={gawat > 0 ? "danger" : "default"}
          sub={gawat > 0 ? "Sudah diurutkan paling atas" : "Tidak ada kasus mendesak"}
          icon={TriangleAlert}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={Stethoscope}>Antrean Saya</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="brand">{menunggu.length}</Badge>
            <SegarkanBerkala />
          </div>
        </CardHeader>

        <p className="mb-2.5 text-meta text-ink-muted">
          Diurutkan berdasarkan triase lebih dulu, lalu penanda Pendaftaran,
          baru nomor antrean — pasien merah dan kuning selalu muncul di atas.
        </p>

        {menunggu.length === 0 ? (
          <>
            <EmptyState
              icon={Stethoscope}
              title="Tidak ada pasien menunggu di cabang ini"
              description="Pasien muncul di sini setelah perawat menyelesaikan pengkajian awal."
            />
            {/*
              Layar kosong harus berkata jujur. Dokter yang ditugaskan di
              beberapa cabang bisa saja punya pasien menunggu di cabang lain;
              tanpa pemberitahuan ini ia menyimpulkan sistemnya rusak —
              padahal pasiennya menunggu satu cabang di sebelah.
            */}
            {cabangLain.length > 0 ? (
              <PindahCabangCepat daftar={cabangLain.map((c) => ({
                site_id: Number(c.site_id),
                site_nama: c.site_nama,
                jumlah: Number(c.jumlah),
              }))} />
            ) : null}
          </>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {menunggu.map((v) => (
              <Baris key={v.visit_id} v={v} />
            ))}
          </ul>
        )}
      </Card>

      {/*
        ---------- Tertunda dari hari sebelumnya ----------
        DIPISAH dari antrean hari ini, bukan digabung: nomor antrean di-reset
        setiap hari, sehingga mencampurnya menghasilkan urutan yang tidak
        berarti — dan pasien kemarin akan menyalip pasien yang sedang duduk
        di ruang tunggu.

        Sebelum bagian ini ada, kunjungan yang tertinggal semalam hilang dari
        SELURUH layar sementara statusnya tetap `menunggu_dokter`: tidak maju,
        tidak tutup, tidak terlihat siapa pun.
      */}
      {tertunda.length > 0 ? (
        <Card className="border-warning/30">
          <CardHeader>
            <CardTitle icon={CalendarClock}>Tertunda dari Hari Sebelumnya</CardTitle>
            <Badge variant="warning">{tertunda.length}</Badge>
          </CardHeader>
          <p className="mb-2.5 text-meta text-ink-muted">
            Kunjungan ini belum tuntas dan tidak akan hilang sendiri. Selesaikan
            pemeriksaannya, atau minta Pendaftaran membatalkan kunjungannya bila
            pasien memang tidak jadi dilayani.
          </p>
          <ul className="flex flex-col gap-1.5">
            {tertunda.map((v) => (
              <Baris key={v.visit_id} v={v} tampilkanTanggal />
            ))}
          </ul>
        </Card>
      ) : null}

      {selesai.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle icon={CheckCircle2}>Selesai Hari Ini</CardTitle>
            <Badge variant="neutral">{selesai.length}</Badge>
          </CardHeader>
          <ul className="flex flex-col gap-1.5">
            {selesai.map((v) => (
              <Baris key={v.visit_id} v={v} selesai />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
