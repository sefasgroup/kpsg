import type { Metadata } from "next";
import Link from "next/link";
import {
  CheckCircle2, ClipboardList, FlaskConical, HandCoins, Hourglass, Inbox, Pill,
  TriangleAlert,
} from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SegarkanBerkala } from "@/components/ui/segarkan-berkala";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { resepMasuk, resepSelesaiHariIni, type ResepMasuk } from "@/lib/pharmacy";
import { formatJam, hitungUmur } from "@/lib/format";

export const metadata: Metadata = { title: "Resep Masuk" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  baru: "Baru",
  diterima_farmasi: "Diterima",
  disiapkan: "Disiapkan",
  diserahkan: "Diserahkan",
};

function Baris({ r }: { r: ResepMasuk }) {
  const kurang = Number(r.stok_kurang) > 0;
  return (
    <li>
      <Link
        href={`/farmasi/${r.id}`}
        className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-alt px-3 py-2.5 transition-colors hover:border-brand-400 hover:bg-brand-50"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-brand-50 font-mono text-h2 font-semibold text-brand-700">
          {r.antrean ?? "—"}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-ink">
            {r.nama}
            {r.alergi ? (
              <span className="ml-2 inline-flex items-center gap-1 align-middle text-micro text-danger uppercase">
                <TriangleAlert className="size-3" aria-hidden />
                alergi: {r.alergi}
              </span>
            ) : null}
          </p>
          <p className="truncate text-meta text-ink-muted">
            <span className="font-mono">{r.no_rm}</span> ·{" "}
            {r.jenis_kelamin === "L" ? "L" : "P"} · {hitungUmur(r.tanggal_lahir)} th ·{" "}
            {r.dokter_nama}
          </p>
          <p className="truncate font-mono text-meta text-ink-faint">{r.no_resep}</p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/*
            Tahap resep ditulis eksplisit. Sejak pasien membayar sebelum
            menerima obat, "disiapkan" berarti dua hal yang sangat berbeda
            tergantung tagihannya: masih menunggu uang, atau sudah lunas dan
            tinggal diserahkan. Petugas tidak boleh menebaknya.
          */}
          {r.status === "disiapkan" ? (
            r.status_tagihan === "lunas" ? (
              <Badge variant="success">
                <HandCoins />
                Lunas — siap diserahkan
              </Badge>
            ) : (
              <Badge variant="warning">
                <Hourglass />
                Menunggu bayar
              </Badge>
            )
          ) : null}
          {Number(r.jumlah_paten) > 0 ? (
            <Badge variant="neutral">
              <Pill />
              {Number(r.jumlah_paten)} paten
            </Badge>
          ) : null}
          {Number(r.jumlah_racikan) > 0 ? (
            <Badge variant="racikan">
              <FlaskConical />
              {Number(r.jumlah_racikan)} racikan
            </Badge>
          ) : null}
          {kurang ? (
            <Badge variant="danger">
              <TriangleAlert />
              {Number(r.stok_kurang)} stok kurang
            </Badge>
          ) : null}
        </div>

        <span className="text-meta text-ink-faint tabular">
          {formatJam(r.created_at)}
        </span>

        <Badge variant={r.status === "baru" ? "warning" : "info"}>
          {STATUS_LABEL[r.status] ?? r.status}
        </Badge>
      </Link>
    </li>
  );
}

export default async function FarmasiPage() {
  const session = await requireRole("farmasi", "super_admin");

  const [masuk, selesai] = await Promise.all([
    resepMasuk(session.siteId),
    resepSelesaiHariIni(session.siteId),
  ]);

  const adaRacikan = masuk.filter((r) => Number(r.jumlah_racikan) > 0).length;
  const adaKurang = masuk.filter((r) => Number(r.stok_kurang) > 0).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Resep Menunggu" value={masuk.length} icon={Inbox} />
        <StatCard label="Perlu Diracik" value={adaRacikan} icon={FlaskConical} />
        <StatCard
          label="Terkendala Stok"
          value={adaKurang}
          tone={adaKurang > 0 ? "danger" : "default"}
          sub={adaKurang > 0 ? "Tidak bisa diserahkan" : "Semua bisa dilayani"}
          icon={TriangleAlert}
        />
        <StatCard label="Diserahkan Hari Ini" value={selesai.length} tone="success" icon={CheckCircle2} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={ClipboardList}>Resep Masuk dari Dokter</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="brand">{masuk.length}</Badge>
            <SegarkanBerkala />
          </div>
        </CardHeader>

        {masuk.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Tidak ada resep menunggu"
            description="E-Resep muncul di sini begitu dokter mengirimkannya."
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {masuk.map((r) => (
              <Baris key={r.id} r={r} />
            ))}
          </ul>
        )}
      </Card>

      {selesai.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle icon={CheckCircle2}>Diserahkan Hari Ini</CardTitle>
            <Badge variant="neutral">{selesai.length}</Badge>
          </CardHeader>
          <ul className="flex flex-col gap-1.5">
            {selesai.map((r) => (
              <Baris key={r.id} r={r} />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
