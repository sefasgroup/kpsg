import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/auth";
import { cabangBacaDetail } from "@/lib/session";
import { queryOne } from "@/lib/db";
import { alasanTakBolehBatal, getTagihan, rincianTagihan } from "@/lib/cashier";
import { formatTanggalPendek, hitungUmur } from "@/lib/format";
import { BayarClient } from "./bayar-client";
import type { BarisStruk } from "./struk";

export const metadata: Metadata = { title: "Proses Pembayaran" };
export const dynamic = "force-dynamic";

type SiteRow = import("mysql2").RowDataPacket & {
  nama: string;
  alamat: string | null;
  telepon: string | null;
};

export default async function PembayaranPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("kasir", "super_admin");
  const { id } = await params;
  const billingId = Number(id);
  if (!Number.isInteger(billingId) || billingId <= 0) notFound();

  const tagihan = await getTagihan(billingId, cabangBacaDetail(session));
  if (!tagihan) notFound();

  const [rincian, site, setelan, halanganBatal, rowPenjamin] = await Promise.all([
    rincianTagihan(billingId),
    queryOne<SiteRow>(
      `SELECT nama, alamat, telepon FROM sites WHERE id = ?`,
      [tagihan.site_id],
    ),
    queryOne<import("mysql2").RowDataPacket & { svalue: string }>(
      `SELECT svalue FROM settings WHERE skey = 'billing.pembulatan'
        AND (site_id = ? OR site_id IS NULL) ORDER BY site_id IS NULL LIMIT 1`,
      [tagihan.site_id],
    ),
    // Sebabnya dihitung di server supaya kasir melihat alasannya SEBELUM
    // menekan tombol, bukan sebagai penolakan di depan pasien.
    alasanTakBolehBatal(billingId, cabangBacaDetail(session)),
    /*
     * Plafon penjamin diambil terpisah, bukan ikut di `SELECT_TAGIHAN`.
     * Alasannya prinsip yang sudah berlaku di modul ini: layar kasir hanya
     * memuat apa yang benar-benar dibutuhkannya, dan sebagian besar tagihan
     * tidak punya penjamin sama sekali.
     */
    tagihan.payer_id
      ? queryOne<import("mysql2").RowDataPacket & { plafon_per_kunjungan: string }>(
          `SELECT plafon_per_kunjungan FROM payers WHERE id = ?`,
          [tagihan.payer_id],
        )
      : Promise.resolve(null),
  ]);

  const plafonPenjamin = Number(rowPenjamin?.plafon_per_kunjungan ?? 0);

  const baris: BarisStruk[] = rincian.map((r) => ({
    kategori: r.kategori,
    deskripsi: r.deskripsi,
    qty: Number(r.qty),
    harga_satuan: Number(r.harga_satuan),
    subtotal: Number(r.subtotal),
  }));

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/kasir"
        className="inline-flex w-fit items-center gap-1.5 text-meta text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Kembali ke daftar tagihan
      </Link>

      <Card>
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-brand-50 font-mono text-h1 font-semibold text-brand-700">
            {tagihan.antrean ?? "—"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-h1 text-ink">{tagihan.nama}</p>
            <p className="mt-0.5 text-meta text-ink-muted">
              <span className="font-mono">{tagihan.no_rm}</span> ·{" "}
              {tagihan.jenis_kelamin === "L" ? "Laki-laki" : "Perempuan"} ·{" "}
              {hitungUmur(tagihan.tanggal_lahir)} tahun · {tagihan.poli_nama} ·{" "}
              {tagihan.dokter_nama}
            </p>
            <p className="mt-0.5 text-meta text-ink-faint">
              <span className="font-mono">{tagihan.no_invoice}</span> ·{" "}
              {formatTanggalPendek(tagihan.created_at)} · penjaminan{" "}
              <span className="uppercase">{tagihan.cara_bayar}</span>
            </p>
          </div>
          <Badge variant={tagihan.status === "lunas" ? "success" : "warning"}>
            {tagihan.status}
          </Badge>
        </div>
      </Card>

      <BayarClient
        penjamin={
          tagihan.payer_id
            ? {
                nama: tagihan.payer_nama ?? "Penjamin",
                jenis: tagihan.payer_jenis ?? "",
                plafon: Number(plafonPenjamin),
                noAnggota: tagihan.no_anggota,
              }
            : null
        }
        billingId={billingId}
        baris={baris}
        sudahLunas={tagihan.status === "lunas"}
        bisaDibayar={tagihan.visit_status === "menunggu_kasir"}
        halanganBatal={halanganBatal}
        pembulatanKe={Number(setelan?.svalue ?? 0)}
        struk={{
          namaKlinik: site?.nama ?? "Klinik Pratama Sahabat Gamma",
          alamatKlinik: site?.alamat ?? null,
          teleponKlinik: site?.telepon ?? null,
          noInvoice: tagihan.no_invoice,
          tanggal: tagihan.paid_at ?? tagihan.created_at,
          pasien: tagihan.nama,
          noRm: tagihan.no_rm,
          poli: tagihan.poli_nama,
          dokter: tagihan.dokter_nama,
          kasir: tagihan.kasir_nama ?? session.nama,
          tersimpan: {
            subtotal: Number(tagihan.subtotal),
            diskon: Number(tagihan.diskon),
            pembulatan: Number(tagihan.pembulatan),
            total: Number(tagihan.total),
            dibayar: Number(tagihan.dibayar),
            kembalian: Number(tagihan.kembalian),
            metode: tagihan.payment_method ?? "tunai",
            noRef: tagihan.payment_ref,
          },
        }}
      />
    </div>
  );
}
