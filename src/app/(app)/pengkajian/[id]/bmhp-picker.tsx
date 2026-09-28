"use client";

import { useEffect, useState, useTransition } from "react";
import { PackageMinus, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { SearchBar } from "@/components/ui/search-bar";
import { formatDesimal, formatRupiah } from "@/lib/format";
import { cariBmhpAction } from "../actions";

export type BarisBmhp = {
  item_id: number;
  nama: string;
  satuan: string;
  harga_satuan: number;
  qty: number;
  /** Sisa stok saat item dipilih — dipakai untuk peringatan dini di layar. */
  stok: number;
};

/**
 * Pemilih BMHP dengan autocomplete (CLAUDE.md §4).
 * Stok dipotong saat pengkajian disimpan, bukan saat item ditambahkan di
 * sini — supaya membatalkan form tidak meninggalkan stok yang terlanjur
 * berkurang.
 */
export function BmhpPicker({
  value,
  onChange,
}: {
  value: BarisBmhp[];
  onChange: (rows: BarisBmhp[]) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [mencari, startCari] = useTransition();
  const [cache, setCache] = useState<{
    q: string;
    rows: {
      id: number;
      kode: string;
      nama: string;
      satuan_dasar: string;
      harga_jual: string;
      stok: string;
    }[];
  }>({ q: "", rows: [] });

  const q = keyword.trim();

  useEffect(() => {
    if (q.length < 2) return;
    const timer = setTimeout(() => {
      startCari(async () => {
        const res = await cariBmhpAction(q);
        setCache({ q, rows: res.ok ? res.data : [] });
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const hasil = q.length >= 2 && cache.q === q ? cache.rows : [];

  function tambah(r: (typeof cache.rows)[number]) {
    const sudahAda = value.find((v) => v.item_id === r.id);
    if (sudahAda) {
      onChange(
        value.map((v) =>
          v.item_id === r.id ? { ...v, qty: v.qty + 1 } : v,
        ),
      );
    } else {
      onChange([
        ...value,
        {
          item_id: r.id,
          nama: r.nama,
          satuan: r.satuan_dasar,
          harga_satuan: Number(r.harga_jual),
          qty: 1,
          stok: Number(r.stok),
        },
      ]);
    }
    setKeyword("");
  }

  const total = value.reduce((n, v) => n + v.qty * v.harga_satuan, 0);

  return (
    <div className="flex flex-col gap-3">
      <SearchBar
        value={keyword}
        onChange={setKeyword}
        loading={mencari}
        placeholder="Cari BMHP — kapas, plester, spuit…"
      />

      {hasil.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-md border border-line bg-surface p-1">
          {hasil.map((r) => {
            const habis = Number(r.stok) <= 0;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => tambah(r)}
                  disabled={habis}
                  className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                >
                  <Plus className="size-3.5 shrink-0 text-brand-600" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-body text-ink">
                    {r.nama}
                  </span>
                  <span className="shrink-0 text-meta text-ink-muted tabular">
                    {formatRupiah(r.harga_jual)}
                  </span>
                  <span
                    className={`shrink-0 text-meta tabular ${
                      habis ? "text-danger" : "text-ink-faint"
                    }`}
                  >
                    stok {Number(r.stok)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {q.length >= 2 && hasil.length === 0 && !mencari ? (
        <p className="text-meta text-ink-faint">
          Tidak ada BMHP cocok dengan “{q}”.
        </p>
      ) : null}

      {value.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-meta text-ink-faint">
          Belum ada BMHP dicatat. Kosongkan bila tidak ada bahan habis pakai
          yang dipakai.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="bg-surface-alt">
                <th className="border-b border-line px-3 py-2 text-left text-label font-medium text-ink-muted">Bahan</th>
                <th className="border-b border-line px-3 py-2 text-right text-label font-medium text-ink-muted">Jumlah</th>
                <th className="border-b border-line px-3 py-2 text-right text-label font-medium text-ink-muted">Harga</th>
                <th className="border-b border-line px-3 py-2 text-right text-label font-medium text-ink-muted">Subtotal</th>
                <th className="border-b border-line px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {value.map((v, i) => {
                const kurang = v.qty > v.stok;
                return (
                  <tr key={v.item_id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5">
                      <span className="text-ink">{v.nama}</span>
                      {kurang ? (
                        <span className="ml-2 inline-flex items-center gap-1 text-micro text-danger uppercase">
                          <TriangleAlert className="size-3" aria-hidden />
                          stok hanya {formatDesimal(v.stok)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Input
                          type="number"
                          min={0.001}
                          step="any"
                          value={v.qty}
                          aria-label={`Jumlah ${v.nama}`}
                          aria-invalid={kurang}
                          onChange={(e) => {
                            const qty = Number(e.target.value);
                            onChange(
                              value.map((row, j) =>
                                j === i ? { ...row, qty } : row,
                              ),
                            );
                          }}
                          className="h-8 w-20 text-right"
                        />
                        <span className="w-12 text-left text-meta text-ink-faint">
                          {v.satuan}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-right text-ink-muted tabular">
                      {formatRupiah(v.harga_satuan)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-medium text-ink tabular">
                      {formatRupiah(v.qty * v.harga_satuan)}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Hapus ${v.nama}`}
                        onClick={() => onChange(value.filter((_, j) => j !== i))}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-surface-alt">
                <td colSpan={3} className="px-3 py-2 text-right text-label text-ink-muted">
                  Total BMHP masuk tagihan
                </td>
                <td className="px-3 py-2 text-right text-h2 text-ink tabular">
                  {formatRupiah(total)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-meta text-ink-faint">
        <PackageMinus className="mt-px size-3.5 shrink-0" aria-hidden />
        Stok dipotong dan biaya masuk tagihan saat pengkajian disimpan — bukan
        saat item ditambahkan di sini.
      </p>
    </div>
  );
}
