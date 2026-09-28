import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { getResepFarmasi, itemPaten, racikanResep } from "@/lib/pharmacy";
import { formatJam, hitungUmur } from "@/lib/format";
import { DispenseClient, type ItemPaten, type ItemRacikan } from "./dispense-client";

export const metadata: Metadata = { title: "Penyiapan Resep" };
export const dynamic = "force-dynamic";

export default async function PenyiapanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("farmasi", "super_admin");
  const { id } = await params;
  const rxId = Number(id);
  if (!Number.isInteger(rxId) || rxId <= 0) notFound();

  const resep = await getResepFarmasi(rxId, session.siteId);
  if (!resep) notFound();

  const [paten, racikan, site, tagihan] = await Promise.all([
    itemPaten(rxId),
    racikanResep(rxId),
    queryOne<import("mysql2").RowDataPacket & { nama: string }>(
      `SELECT nama FROM sites WHERE id = ?`,
      [resep.site_id],
    ),
    // Obat hanya boleh diserahkan setelah tagihannya lunas — status ini yang
    // menentukan tombol mana yang tampil di layar penyiapan.
    queryOne<import("mysql2").RowDataPacket & { status: string }>(
      `SELECT status FROM billing_transactions WHERE visit_id = ?`,
      [resep.visit_id],
    ),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/farmasi"
        className="inline-flex w-fit items-center gap-1.5 text-meta text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Kembali ke resep masuk
      </Link>

      <Card>
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-brand-50 font-mono text-h1 font-semibold text-brand-700">
            {resep.antrean ?? "—"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-h1 text-ink">{resep.nama}</p>
            <p className="mt-0.5 text-meta text-ink-muted">
              <span className="font-mono">{resep.no_rm}</span> ·{" "}
              {resep.jenis_kelamin === "L" ? "Laki-laki" : "Perempuan"} ·{" "}
              {hitungUmur(resep.tanggal_lahir)} tahun
            </p>
            <p className="mt-0.5 text-meta text-ink-faint">
              <span className="font-mono">{resep.no_resep}</span> · {resep.dokter_nama}{" "}
              · {formatJam(resep.created_at)}
            </p>
          </div>
          <Badge variant={resep.status === "diserahkan" ? "success" : "info"}>
            {resep.status.replace("_", " ")}
          </Badge>
        </div>

        {/*
          Pita alergi wajib terlihat di layar farmasi juga — inilah
          pemeriksaan terakhir sebelum obat berpindah ke tangan pasien.
        */}
        {resep.alergi ? (
          <p className="mt-3 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-bg px-3 py-2.5 text-body text-danger">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <strong>Alergi:</strong> {resep.alergi} — cocokkan dengan isi resep
              sebelum menyerahkan.
            </span>
          </p>
        ) : null}

        {resep.catatan_umum ? (
          <p className="mt-3 rounded-md border border-line bg-surface-alt px-3 py-2 text-body text-ink">
            <span className="text-label text-ink-muted">Catatan dokter: </span>
            {resep.catatan_umum}
          </p>
        ) : null}
      </Card>

      <DispenseClient
        prescriptionId={rxId}
        status={resep.status}
        sudahLunas={tagihan?.status === "lunas"}
        pasien={resep.nama}
        noRm={resep.no_rm}
        namaKlinik={site?.nama ?? "Klinik Pratama Sahabat Gamma"}
        paten={
          paten.map((p) => ({
            id: p.id,
            nama: p.nama,
            qty: Number(p.qty),
            satuan: p.satuan,
            aturan_pakai: p.aturan_pakai,
            catatan: p.catatan,
            harga_satuan: Number(p.harga_satuan),
            stok: Number(p.stok),
            sudahDipotong: p.stock_movement_id !== null,
          })) as ItemPaten[]
        }
        racikan={
          racikan.map((r) => ({
            id: r.id,
            nama_racikan: r.nama_racikan,
            bentuk_sediaan: r.bentuk_sediaan,
            qty_jadi: Number(r.qty_jadi),
            satuan_jadi: r.satuan_jadi,
            aturan_pakai: r.aturan_pakai,
            biaya_jasa_racik: Number(r.biaya_jasa_racik),
            catatan: r.catatan,
            ingredients: r.ingredients.map((b) => ({
              id: b.id,
              nama: b.nama,
              qty_bahan: Number(b.qty_bahan),
              satuan: b.satuan,
              harga_satuan: Number(b.harga_satuan),
              stok: Number(b.stok),
              sudahDipotong: b.stock_movement_id !== null,
            })),
          })) as ItemRacikan[]
        }
      />
    </div>
  );
}
