"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { FlaskConical, Pill, Plus, Send, Trash2, TriangleAlert } from "lucide-react";
import { Autocomplete } from "@/components/ui/autocomplete";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/field";
import { formatDesimal, formatRupiah } from "@/lib/format";
import { cariObatAction, simpanResepAction } from "../actions";
import { SignaInput } from "./signa-input";
import { RacikanBuilder, racikanKosong, type Racikan } from "./racikan-builder";

export type ObatPaten = {
  item_id: number;
  nama: string;
  qty: number;
  satuan: string;
  aturan_pakai: string;
  catatan?: string;
  harga_satuan: number;
  stok: number;
};

export function ResepForm({
  visitId,
  itemsAwal,
  racikansAwal,
  catatanAwal,
  jasaRacikDefault,
  terkunci,
  noResep,
}: {
  visitId: number;
  itemsAwal: ObatPaten[];
  racikansAwal: Racikan[];
  catatanAwal: string;
  jasaRacikDefault: number;
  /** Resep yang sudah diterima farmasi tidak bisa diubah dari sini. */
  terkunci: boolean;
  noResep: string | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ObatPaten[]>(itemsAwal);
  const [racikans, setRacikans] = useState<Racikan[]>(racikansAwal);
  const [catatan, setCatatan] = useState(catatanAwal);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [menyimpan, setMenyimpan] = useState(false);

  const totalPaten = items.reduce((n, i) => n + i.qty * i.harga_satuan, 0);
  const totalRacikan = racikans.reduce(
    (n, r) =>
      n +
      r.biaya_jasa_racik +
      r.ingredients.reduce((m, b) => m + b.qty_bahan * b.harga_satuan, 0),
    0,
  );
  const kosong = items.length === 0 && racikans.length === 0;

  async function simpan() {
    setErrors({});
    setMenyimpan(true);
    try {
      const hasil = await simpanResepAction(visitId, {
        catatan_umum: catatan,
        items,
        racikans,
      });

      if (!hasil.ok) {
        // Path error dari zod berbentuk "racikans.0.aturan_pakai" —
        // dipetakan kembali agar pesannya menempel di kolom yang tepat.
        if (hasil.field) setErrors({ [hasil.field]: hasil.error });
        toast.error(hasil.error, { duration: 6000 });
        return;
      }

      toast.success(`E-Resep ${hasil.data.noResep} terkirim ke apotek.`);
      router.refresh();
    } finally {
      setMenyimpan(false);
    }
  }

  if (terkunci) {
    return (
      <Card>
        <CardHeader>
          <CardTitle icon={Pill}>E-Resep</CardTitle>
          {noResep ? <Badge variant="info">{noResep}</Badge> : null}
        </CardHeader>
        <p className="text-body text-ink">
          Resep sudah diterima apotek dan tidak bisa diubah dari sini.
        </p>
        <p className="mt-1 text-meta text-ink-muted">
          Obat mungkin sedang disiapkan. Untuk merevisi, batalkan resep lalu
          terbitkan resep baru.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- Obat paten ---------- */}
      <Card>
        <CardHeader>
          <CardTitle icon={Pill}>Obat Paten</CardTitle>
          <Badge variant="neutral">{items.length} item</Badge>
        </CardHeader>

        <Autocomplete
          cari={(kw) => cariObatAction(kw, false)}
          placeholder="Cari obat — paracetamol, amoxicillin…"
          keyOf={(o) => o.id}
          onPilih={(o) => {
            if (items.some((i) => i.item_id === o.id)) return;
            setItems([
              ...items,
              {
                item_id: o.id,
                nama: o.nama,
                qty: 1,
                satuan: o.satuan_dasar,
                aturan_pakai: "",
                harga_satuan: Number(o.harga_jual),
                stok: Number(o.stok),
              },
            ]);
          }}
          renderBaris={(o) => (
            <>
              <span className="min-w-0 flex-1 truncate text-body text-ink">
                {o.nama}
                {o.bentuk_sediaan ? (
                  <span className="ml-1.5 text-meta text-ink-faint">
                    {o.bentuk_sediaan}
                  </span>
                ) : null}
              </span>
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

        {items.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-meta text-ink-faint">
            Belum ada obat paten. Kosongkan bila hanya meresepkan racikan.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {items.map((it, i) => {
              const kurang = it.qty > it.stok;
              const errSigna = errors[`items.${i}.aturan_pakai`];
              return (
                <li
                  key={it.item_id}
                  className="rounded-md border border-line bg-surface-alt p-3"
                >
                  <div className="mb-2.5 flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                      {it.nama}
                    </p>
                    <Input
                      type="number"
                      min={0.001}
                      step="any"
                      value={it.qty}
                      aria-label={`Jumlah ${it.nama}`}
                      aria-invalid={kurang}
                      onChange={(e) =>
                        setItems(
                          items.map((x, j) =>
                            j === i ? { ...x, qty: Number(e.target.value) } : x,
                          ),
                        )
                      }
                      className="h-8 w-20 text-right"
                    />
                    <span className="w-14 text-meta text-ink-faint">{it.satuan}</span>
                    <span
                      className={`text-meta tabular ${kurang ? "text-danger" : "text-ink-faint"}`}
                    >
                      {kurang ? (
                        <span className="inline-flex items-center gap-1">
                          <TriangleAlert className="size-3" aria-hidden />
                          stok {formatDesimal(it.stok)}
                        </span>
                      ) : (
                        `stok ${formatDesimal(it.stok)}`
                      )}
                    </span>
                    <span className="w-24 text-right text-body text-ink tabular">
                      {formatRupiah(it.qty * it.harga_satuan)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Hapus ${it.nama}`}
                      onClick={() => setItems(items.filter((_, j) => j !== i))}
                    >
                      <Trash2 />
                    </Button>
                  </div>

                  <SignaInput
                    id={`signa-item-${i}`}
                    value={it.aturan_pakai}
                    error={errSigna}
                    onChange={(v) =>
                      setItems(
                        items.map((x, j) => (j === i ? { ...x, aturan_pakai: v } : x)),
                      )
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ---------- Racikan ---------- */}
      <Card>
        <CardHeader>
          <CardTitle icon={FlaskConical}>Obat Racikan</CardTitle>
          <Button
            type="button"
            size="sm"
            onClick={() => setRacikans([...racikans, racikanKosong(jasaRacikDefault)])}
          >
            <Plus />
            Tambah Racikan
          </Button>
        </CardHeader>

        {racikans.length === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-meta text-ink-faint">
            Belum ada racikan.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {racikans.map((r, i) => (
              <RacikanBuilder
                key={i}
                index={i}
                value={r}
                errors={{
                  nama_racikan: errors[`racikans.${i}.nama_racikan`],
                  qty_jadi: errors[`racikans.${i}.qty_jadi`],
                  aturan_pakai: errors[`racikans.${i}.aturan_pakai`],
                  ingredients: errors[`racikans.${i}.ingredients`],
                }}
                onChange={(baru) =>
                  setRacikans(racikans.map((x, j) => (j === i ? baru : x)))
                }
                onHapus={() => setRacikans(racikans.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        )}
      </Card>

      {/* ---------- Ringkasan & kirim ---------- */}
      <Card>
        <Field label="Catatan untuk Apoteker">
          <Textarea
            rows={2}
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder="mis. sirup dibuat terpisah, jangan dicampur"
          />
        </Field>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3">
          <div className="text-meta text-ink-muted">
            <p>
              Obat paten{" "}
              <strong className="text-ink tabular">{formatRupiah(totalPaten)}</strong>
              {" · "}Racikan + jasa racik{" "}
              <strong className="text-racikan tabular">
                {formatRupiah(totalRacikan)}
              </strong>
            </p>
            <p className="mt-0.5 text-ink-faint">
              Estimasi. Biaya sesungguhnya masuk tagihan saat apotek menyerahkan
              obat — pasien membayar apa yang benar-benar diserahkan.
            </p>
          </div>

          <Button
            type="button"
            variant="primary"
            onClick={simpan}
            disabled={menyimpan || kosong}
          >
            <Send />
            {menyimpan ? "Mengirim…" : noResep ? "Perbarui E-Resep" : "Kirim E-Resep ke Apotek"}
          </Button>
        </div>

        {kosong ? (
          <p className="mt-2 text-right text-meta text-ink-faint">
            Tambahkan minimal satu obat atau racikan.
          </p>
        ) : null}
        {errors.items ? (
          <p className="mt-2 text-right text-meta text-danger">{errors.items}</p>
        ) : null}
      </Card>
    </div>
  );
}
