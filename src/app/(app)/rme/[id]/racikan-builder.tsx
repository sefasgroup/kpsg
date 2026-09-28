"use client";

import { FlaskConical, Trash2, TriangleAlert } from "lucide-react";
import { Autocomplete } from "@/components/ui/autocomplete";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { formatDesimal, formatRupiah } from "@/lib/format";
import { cariObatAction } from "../actions";
import { SignaInput } from "./signa-input";

export type BahanRacikan = {
  item_id: number;
  nama: string;
  qty_bahan: number;
  satuan: string;
  harga_satuan: number;
  stok: number;
};

export type Racikan = {
  nama_racikan: string;
  bentuk_sediaan: "puyer" | "kapsul" | "sirup" | "salep" | "krim" | "lainnya";
  qty_jadi: number;
  satuan_jadi: string;
  aturan_pakai: string;
  biaya_jasa_racik: number;
  catatan?: string;
  ingredients: BahanRacikan[];
};

export const racikanKosong = (jasaRacikDefault: number): Racikan => ({
  nama_racikan: "",
  bentuk_sediaan: "puyer",
  qty_jadi: 10,
  satuan_jadi: "bungkus",
  aturan_pakai: "",
  biaya_jasa_racik: jasaRacikDefault,
  ingredients: [],
});

const SATUAN_JADI: Record<Racikan["bentuk_sediaan"], string> = {
  puyer: "bungkus",
  kapsul: "kapsul",
  sirup: "botol",
  salep: "pot",
  krim: "pot",
  lainnya: "buah",
};

/**
 * Pembangun obat racikan — komponen paling kompleks di sistem ini.
 * Menjembatani resep dokter → pemotongan stok bahan mentah di apotek →
 * biaya jasa racik di kasir → etiket obat (CLAUDE.md §7).
 *
 * Ditandai ungu secara konsisten di seluruh sistem agar alur parent-child
 * ini terbedakan dari obat paten sekali lihat.
 */
export function RacikanBuilder({
  value,
  index,
  onChange,
  onHapus,
  errors,
}: {
  value: Racikan;
  index: number;
  onChange: (r: Racikan) => void;
  onHapus: () => void;
  errors?: Record<string, string>;
}) {
  const set = <K extends keyof Racikan>(k: K, v: Racikan[K]) =>
    onChange({ ...value, [k]: v });

  const totalBahan = value.ingredients.reduce(
    (n, b) => n + b.qty_bahan * b.harga_satuan,
    0,
  );

  return (
    <div className="rounded-lg border border-line border-l-[3px] border-l-racikan bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-h2 text-racikan">
          <FlaskConical className="size-4" aria-hidden />
          Racikan {index + 1}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onHapus}>
          <Trash2 />
          Hapus racikan
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field
          label="Nama Racikan"
          required
          error={errors?.nama_racikan}
          className="sm:col-span-2"
        >
          <Input
            value={value.nama_racikan}
            onChange={(e) => set("nama_racikan", e.target.value)}
            placeholder="mis. Puyer Batuk Anak"
            aria-invalid={Boolean(errors?.nama_racikan)}
          />
        </Field>

        <Field label="Bentuk Sediaan" required>
          <Select
            value={value.bentuk_sediaan}
            onChange={(e) => {
              const bentuk = e.target.value as Racikan["bentuk_sediaan"];
              // Satuan ikut menyesuaikan bentuk sediaan agar tidak muncul
              // kombinasi janggal seperti "sirup — bungkus".
              onChange({
                ...value,
                bentuk_sediaan: bentuk,
                satuan_jadi: SATUAN_JADI[bentuk],
              });
            }}
          >
            <option value="puyer">Puyer</option>
            <option value="kapsul">Kapsul</option>
            <option value="sirup">Sirup</option>
            <option value="salep">Salep</option>
            <option value="krim">Krim</option>
            <option value="lainnya">Lainnya</option>
          </Select>
        </Field>

        <Field label={`Jumlah Jadi (${value.satuan_jadi})`} required error={errors?.qty_jadi}>
          <Input
            type="number"
            min={1}
            step="any"
            value={value.qty_jadi}
            onChange={(e) => set("qty_jadi", Number(e.target.value))}
            aria-invalid={Boolean(errors?.qty_jadi)}
          />
        </Field>
      </div>

      {/* --- Komposisi --- */}
      <div className="mt-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-label text-ink">Komposisi</p>
          {/*
            Peringatan ini penting: qty bahan adalah untuk KESELURUHAN
            racikan, bukan per bungkus. Salah tafsir di sini berarti salah
            dosis (docs/DATABASE.md §3.4).
          */}
          <p className="text-meta text-warning">
            Jumlah bahan diisi untuk <strong>keseluruhan racikan</strong>, bukan
            per {value.satuan_jadi}.
          </p>
        </div>

        <Autocomplete
          cari={(kw) => cariObatAction(kw, true)}
          placeholder="Cari bahan racikan — paracetamol, CTM, laktosa…"
          keyOf={(o) => o.id}
          onPilih={(o) => {
            if (value.ingredients.some((b) => b.item_id === o.id)) return;
            set("ingredients", [
              ...value.ingredients,
              {
                item_id: o.id,
                nama: o.nama,
                qty_bahan: 1,
                satuan: o.satuan_dasar,
                harga_satuan: Number(o.harga_jual),
                stok: Number(o.stok),
              },
            ]);
          }}
          renderBaris={(o) => (
            <>
              <span className="min-w-0 flex-1 truncate text-body text-ink">{o.nama}</span>
              <span className="shrink-0 text-meta text-ink-muted tabular">
                {formatRupiah(o.harga_jual)}
              </span>
              <span
                className={`shrink-0 text-meta tabular ${
                  Number(o.stok) <= 0 ? "text-danger" : "text-ink-faint"
                }`}
              >
                stok {Number(o.stok)}
              </span>
            </>
          )}
        />

        {errors?.ingredients ? (
          <p className="mt-1.5 text-meta text-danger">{errors.ingredients}</p>
        ) : null}

        {value.ingredients.length > 0 ? (
          <div className="mt-2 overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-surface-alt">
                  <th className="border-b border-line px-3 py-2 text-left text-label font-medium text-ink-muted">Bahan</th>
                  <th className="border-b border-line px-3 py-2 text-right text-label font-medium text-ink-muted">Jumlah</th>
                  <th className="border-b border-line px-3 py-2 text-right text-label font-medium text-ink-muted">Stok</th>
                  <th className="border-b border-line px-3 py-2 text-right text-label font-medium text-ink-muted">Subtotal</th>
                  <th className="border-b border-line px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {value.ingredients.map((b, i) => {
                  const kurang = b.qty_bahan > b.stok;
                  return (
                    <tr key={b.item_id} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-1.5 text-ink">{b.nama}</td>
                      <td className="px-3 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Input
                            type="number"
                            min={0.001}
                            step="any"
                            value={b.qty_bahan}
                            aria-label={`Jumlah ${b.nama}`}
                            aria-invalid={kurang}
                            onChange={(e) =>
                              set(
                                "ingredients",
                                value.ingredients.map((x, j) =>
                                  j === i ? { ...x, qty_bahan: Number(e.target.value) } : x,
                                ),
                              )
                            }
                            className="h-8 w-20 text-right"
                          />
                          <span className="w-12 text-left text-meta text-ink-faint">
                            {b.satuan}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular">
                        {kurang ? (
                          <span className="inline-flex items-center gap-1 text-danger">
                            <TriangleAlert className="size-3" aria-hidden />
                            {formatDesimal(b.stok)}
                          </span>
                        ) : (
                          <span className="text-ink-muted">{formatDesimal(b.stok)}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right text-ink tabular">
                        {formatRupiah(b.qty_bahan * b.harga_satuan)}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Hapus ${b.nama}`}
                          onClick={() =>
                            set(
                              "ingredients",
                              value.ingredients.filter((_, j) => j !== i),
                            )
                          }
                        >
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 rounded-md border border-dashed border-line-strong px-3 py-3 text-center text-meta text-ink-faint">
            Belum ada bahan. Racikan harus punya minimal satu bahan.
          </p>
        )}

        {value.ingredients.some((b) => b.qty_bahan > b.stok) ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-md border border-warning/25 bg-warning-bg px-3 py-2 text-meta text-warning">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            Ada bahan yang stoknya kurang. Resep tetap bisa dikirim — keputusan
            klinis ada pada Anda — tetapi apotek akan menerima peringatan saat
            menyiapkannya.
          </p>
        ) : null}
      </div>

      {/* --- Signa & biaya --- */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <SignaInput
            id={`signa-racikan-${index}`}
            value={value.aturan_pakai}
            onChange={(v) => set("aturan_pakai", v)}
            error={errors?.aturan_pakai}
          />
        </div>

        <div className="flex flex-col gap-3">
          <Field label="Jasa Racik (Rp)" error={errors?.biaya_jasa_racik}>
            <Input
              type="number"
              min={0}
              step={500}
              value={value.biaya_jasa_racik}
              onChange={(e) => set("biaya_jasa_racik", Number(e.target.value))}
            />
          </Field>
          <div className="rounded-md border border-line bg-surface-alt px-3 py-2">
            <p className="text-meta text-ink-muted">Estimasi bahan</p>
            <p className="text-h2 text-ink tabular">{formatRupiah(totalBahan)}</p>
            <p className="mt-0.5 text-meta text-ink-faint">
              + jasa racik {formatRupiah(value.biaya_jasa_racik)} — ditagihkan
              sebagai baris tersendiri
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
