"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { PackageMinus, X } from "lucide-react";
import { Autocomplete } from "@/components/ui/autocomplete";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { formatDesimal } from "@/lib/format";
import { ALASAN_PENGELUARAN } from "@/lib/inventory-labels";
import { cariItemAction, catatPengeluaranAction } from "../inventory-actions";

type Terpilih = {
  id: number;
  kode: string;
  nama: string;
  satuan: string;
  stok: number;
};

export function FormPengeluaran() {
  const router = useRouter();
  const [item, setItem] = useState<Terpilih | null>(null);
  const [f, setF] = useState({ qty: "", jenis: "", alasan: "" });
  const [proses, setProses] = useState(false);

  const qty = Number(f.qty || 0);
  const lebih = item !== null && qty > item.stok;
  const siap = item !== null && qty > 0 && !lebih && f.jenis !== "" && f.alasan.trim().length >= 10;

  async function simpan() {
    if (!item) return;
    setProses(true);
    try {
      const h = await catatPengeluaranAction({
        item_id: item.id,
        qty: f.qty,
        jenis: f.jenis,
        alasan: f.alasan,
      });
      if (!h.ok) { toast.error(h.error, { duration: 7000 }); return; }

      toast.success(`${h.data.nama} dikeluarkan. Sisa stok ${h.data.sisa}.`, {
        duration: 6000,
      });
      setItem(null);
      setF({ qty: "", jenis: "", alasan: "" });
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={PackageMinus}>Pengeluaran Non-Resep</CardTitle>
      </CardHeader>

      <p className="mb-3 text-meta text-ink-muted">
        Layar ini hanya untuk stok yang keluar <strong>tanpa pasien</strong> —
        kadaluarsa, rusak, atau salah catat. Obat untuk pasien selalu keluar
        lewat resep, dan BMHP lewat pengkajian perawat; keduanya sekaligus
        membentuk baris tagihan. Mengeluarkannya dari sini akan memotong stok
        tanpa ada yang membayar.
      </p>

      {item === null ? (
        <Autocomplete
          cari={cariItemAction}
          placeholder="Cari obat / BMHP yang akan dikeluarkan…"
          keyOf={(i) => i.id}
          nonaktif={(i) => Number(i.stok) <= 0}
          onPilih={(i) =>
            setItem({
              id: i.id,
              kode: i.kode,
              nama: i.nama,
              satuan: i.satuan_dasar,
              stok: Number(i.stok),
            })
          }
          renderBaris={(i) => (
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate text-ink">{i.nama}</span>
              <span className="font-mono text-micro text-ink-faint">{i.kode}</span>
              <span
                className={`ml-auto shrink-0 text-meta ${
                  Number(i.stok) <= 0 ? "text-danger" : "text-ink-muted"
                }`}
              >
                stok {Number(i.stok)} {i.satuan_dasar}
              </span>
            </span>
          )}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-alt px-3 py-2">
            <div>
              <p className="text-ink">{item.nama}</p>
              <p className="font-mono text-micro text-ink-faint">{item.kode}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-meta text-ink-muted">
                Stok saat ini{" "}
                <strong className="tabular text-ink">
                  {formatDesimal(item.stok)} {item.satuan}
                </strong>
              </span>
              <Button variant="ghost" size="sm" aria-label="Ganti item" onClick={() => setItem(null)}>
                <X />
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label="Jumlah Dikeluarkan"
              required
              error={lebih ? `Melebihi stok tersedia (${formatDesimal(item.stok)})` : undefined}
            >
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={f.qty}
                  onChange={(e) => setF({ ...f, qty: e.target.value })}
                  aria-invalid={lebih}
                />
                <span className="text-meta text-ink-faint">{item.satuan}</span>
              </div>
            </Field>

            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 text-label text-ink-muted">
                Alasan Pengeluaran
                <span className="ml-0.5 text-danger" aria-label="wajib diisi">*</span>
              </legend>
              <div className="flex flex-col gap-1.5">
                {ALASAN_PENGELUARAN.map((a) => (
                  <label key={a.nilai} className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="jenis"
                      value={a.nilai}
                      checked={f.jenis === a.nilai}
                      onChange={(e) => setF({ ...f, jenis: e.target.value })}
                      className="mt-0.5 size-4 accent-[var(--color-brand-600)]"
                    />
                    <span className="text-meta">
                      <span className="text-ink">{a.label}</span>
                      <span className="block text-micro text-ink-faint">{a.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <Field
            label="Keterangan"
            required
            hint="Minimal 10 karakter — dicatat di kartu stok dan audit log"
          >
            <Textarea
              rows={2}
              value={f.alasan}
              onChange={(e) => setF({ ...f, alasan: e.target.value })}
              placeholder="Kemasan bocor saat penyimpanan, disaksikan oleh Apt. Rani; berita acara No. 12/BA/VIII/2026."
            />
          </Field>

          <div className="flex justify-end">
            <Button variant="primary" onClick={simpan} disabled={!siap || proses}>
              <PackageMinus />
              {proses ? "Menyimpan…" : "Catat Pengeluaran"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
