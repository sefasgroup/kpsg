import type { Metadata } from "next";
import { Barcode, FlaskConical, Package, Syringe } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { daftarItemMaster, daftarKategoriItem } from "@/lib/master";
import { formatRupiah } from "@/lib/format";
import { FormItem, ToggleItem } from "./katalog-client";
import { ImporMassal } from "../master-forms";

export const metadata: Metadata = { title: "Katalog Obat & BMHP" };
export const dynamic = "force-dynamic";

export default async function KatalogPage() {
  await requireRole("super_admin");
  const [items, kategori] = await Promise.all([
    daftarItemMaster(),
    daftarKategoriItem(),
  ]);

  const obat = items.filter((i) => i.tipe === "obat").length;
  const bmhp = items.filter((i) => i.tipe === "bmhp").length;
  const racikable = items.filter((i) => i.is_racikable === 1).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Total Item" value={items.length} icon={Barcode} />
        <StatCard label="Obat" value={obat} icon={Package} />
        <StatCard label="BMHP & Alkes" value={bmhp} icon={Syringe} />
        <StatCard
          label="Boleh Jadi Bahan Racikan"
          value={racikable}
          icon={FlaskConical}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={Barcode}>Katalog Obat & BMHP</CardTitle>
          <div className="flex items-center gap-2">
            <ImporMassal jenis="item" />
            <FormItem kategori={kategori.map((k) => ({ id: k.id, nama: k.nama, tipe: k.tipe }))} />
          </div>
        </CardHeader>

        <p className="mb-3 text-meta text-ink-muted">
          Obat, bahan racikan, dan BMHP berbagi satu katalog. BMHP perawat butuh
          pemotongan stok dan baris tagihan persis seperti obat — memisahkannya
          berarti menduplikasi kartu stok dan logika billing.
        </p>

        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="bg-surface-alt">
                {["Kode", "Nama", "Tipe", "Kategori", "Satuan", "HPP", "Harga Jual", "Margin", "Min", "Stok", "Sifat", "Aksi"].map((h) => (
                  <th
                    key={h}
                    className="border-b border-line px-3 py-2 text-left text-label font-medium whitespace-nowrap text-ink-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const hpp = Number(i.hpp);
                const jual = Number(i.harga_jual);
                const margin = hpp > 0 ? ((jual - hpp) / hpp) * 100 : null;
                const stok = Number(i.total_stok);
                return (
                  <tr
                    key={i.id}
                    className={`border-b border-line last:border-b-0 ${
                      i.is_active === 0 ? "opacity-55" : ""
                    }`}
                  >
                    <td className="px-3 py-1.5 font-mono text-meta text-ink-muted">{i.kode}</td>
                    <td className="px-3 py-1.5">
                      <p className="text-ink">{i.nama}</p>
                      {i.nama_generik ? (
                        <p className="text-meta text-ink-faint">{i.nama_generik}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="text-micro text-ink-muted uppercase">{i.tipe}</span>
                    </td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">{i.kategori ?? "—"}</td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">
                      {i.bentuk_sediaan ? `${i.bentuk_sediaan} · ` : ""}{i.satuan_dasar}
                    </td>
                    <td className="px-3 py-1.5 text-ink-muted tabular">{formatRupiah(i.hpp)}</td>
                    <td className="px-3 py-1.5 text-ink tabular">{formatRupiah(i.harga_jual)}</td>
                    <td className="px-3 py-1.5 tabular">
                      {margin === null ? (
                        <span className="text-ink-faint">—</span>
                      ) : (
                        <span className={margin < 0 ? "text-danger" : "text-ink-muted"}>
                          {margin.toFixed(0)}%
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-ink-faint tabular">{i.min_stock}</td>
                    <td
                      className={`px-3 py-1.5 tabular ${
                        stok <= 0 ? "text-danger" : stok <= i.min_stock ? "text-warning" : "text-ink"
                      }`}
                    >
                      {stok}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {i.is_racikable === 1 ? (
                          <Badge variant="racikan">Bahan racikan</Badge>
                        ) : null}
                        {i.butuh_resep === 1 ? (
                          <Badge variant="warning">Resep</Badge>
                        ) : (
                          <Badge variant="neutral">Bebas</Badge>
                        )}
                        {i.is_active === 0 ? <Badge variant="danger">Nonaktif</Badge> : null}
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex gap-0.5">
                        <FormItem
                          kategori={kategori.map((k) => ({ id: k.id, nama: k.nama, tipe: k.tipe }))}
                          pemicu="edit"
                          awal={{
                            id: i.id,
                            kode: i.kode,
                            tipe: i.tipe,
                            nama: i.nama,
                            nama_generik: i.nama_generik ?? "",
                            kandungan: i.kandungan ?? "",
                            category_id: i.category_id ? String(i.category_id) : "",
                            bentuk_sediaan: i.bentuk_sediaan ?? "",
                            satuan_dasar: i.satuan_dasar,
                            hpp: i.hpp,
                            harga_jual: i.harga_jual,
                            min_stock: String(i.min_stock),
                            is_racikable: i.is_racikable === 1,
                            butuh_resep: i.butuh_resep === 1,
                            kfa_code: i.kfa_code ?? "",
                          }}
                        />
                        <ToggleItem
                          id={i.id}
                          aktif={i.is_active === 1}
                          nama={i.nama}
                          adaStok={stok > 0}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
