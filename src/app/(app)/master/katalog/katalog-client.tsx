"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Barcode, Pencil, Power, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { formatRupiah } from "@/lib/format";
import { setAktifItemAction, simpanItemAction } from "../../master-actions";

export type ItemForm = {
  id?: number;
  kode: string;
  tipe: string;
  nama: string;
  nama_generik: string;
  kandungan: string;
  category_id: string;
  bentuk_sediaan: string;
  satuan_dasar: string;
  hpp: string;
  harga_jual: string;
  min_stock: string;
  is_racikable: boolean;
  butuh_resep: boolean;
  kfa_code: string;
};

const KOSONG: ItemForm = {
  kode: "", tipe: "obat", nama: "", nama_generik: "", kandungan: "",
  category_id: "", bentuk_sediaan: "", satuan_dasar: "tablet", hpp: "0",
  harga_jual: "0", min_stock: "0", is_racikable: false, butuh_resep: true,
  kfa_code: "",
};

export function FormItem({
  kategori,
  awal,
  pemicu,
}: {
  kategori: { id: number; nama: string; tipe: string }[];
  awal?: ItemForm;
  pemicu?: "tambah" | "edit";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [proses, setProses] = useState(false);
  const [form, setForm] = useState<ItemForm>(awal ?? KOSONG);
  const set = <K extends keyof ItemForm>(k: K, v: ItemForm[K]) =>
    setForm({ ...form, [k]: v });

  const hpp = Number(form.hpp);
  const jual = Number(form.harga_jual);
  const margin = hpp > 0 ? ((jual - hpp) / hpp) * 100 : null;
  const rugi = jual < hpp;

  async function simpan() {
    setProses(true);
    try {
      const hasil = await simpanItemAction(form, awal?.id);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 6000 });
        return;
      }
      toast.success("Item tersimpan.");
      setOpen(false);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <>
      {pemicu === "edit" ? (
        <Button variant="ghost" size="sm" aria-label={`Ubah ${form.nama}`} onClick={() => setOpen(true)}>
          <Pencil />
        </Button>
      ) : (
        <Button variant="primary" size="sm" onClick={() => { setForm(KOSONG); setOpen(true); }}>
          <Barcode />
          Tambah Item
        </Button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={awal ? `Ubah ${awal.nama}` : "Tambah Item Katalog"}
        description="Obat, bahan racikan, dan BMHP berbagi satu katalog — semuanya butuh kartu stok dan masuk tagihan dengan cara yang sama."
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={proses}>Batal</Button>
            <Button variant="primary" onClick={simpan} disabled={proses || rugi}>
              {proses ? "Menyimpan…" : "Simpan"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kode" required>
            <Input
              value={form.kode}
              onChange={(e) => set("kode", e.target.value.toUpperCase())}
              className="font-mono"
              placeholder="OBT-013"
            />
          </Field>
          <Field label="Tipe" required>
            <Select value={form.tipe} onChange={(e) => set("tipe", e.target.value)}>
              <option value="obat">Obat</option>
              <option value="bmhp">BMHP</option>
              <option value="alkes">Alkes</option>
            </Select>
          </Field>

          <Field label="Nama" required className="sm:col-span-2">
            <Input value={form.nama} onChange={(e) => set("nama", e.target.value)} />
          </Field>
          <Field label="Nama Generik">
            <Input value={form.nama_generik} onChange={(e) => set("nama_generik", e.target.value)} />
          </Field>
          <Field label="Kategori">
            <Select value={form.category_id} onChange={(e) => set("category_id", e.target.value)}>
              <option value="">—</option>
              {kategori
                .filter((k) => k.tipe === form.tipe)
                .map((k) => (
                  <option key={k.id} value={k.id}>{k.nama}</option>
                ))}
            </Select>
          </Field>

          <Field label="Bentuk Sediaan">
            <Input
              value={form.bentuk_sediaan}
              onChange={(e) => set("bentuk_sediaan", e.target.value)}
              placeholder="Tablet / Kapsul / Sirup"
            />
          </Field>
          <Field label="Satuan Dasar" required hint="Satuan penyimpanan stok">
            <Input value={form.satuan_dasar} onChange={(e) => set("satuan_dasar", e.target.value)} />
          </Field>

          <Field label="HPP (Rp)" required>
            <Input type="number" min={0} value={form.hpp} onChange={(e) => set("hpp", e.target.value)} />
          </Field>
          <Field
            label="Harga Jual (Rp)"
            required
            error={rugi ? "Harga jual di bawah HPP" : undefined}
            hint={!rugi && margin !== null ? `Margin ${margin.toFixed(0)}%` : undefined}
          >
            <Input
              type="number"
              min={0}
              value={form.harga_jual}
              aria-invalid={rugi}
              onChange={(e) => set("harga_jual", e.target.value)}
            />
          </Field>

          <Field label="Stok Minimum" hint="Ambang peringatan stok menipis">
            <Input type="number" min={0} value={form.min_stock} onChange={(e) => set("min_stock", e.target.value)} />
          </Field>
          <Field label="Kode KFA" hint="Kamus Farmasi & Alkes — untuk SatuSehat">
            <Input value={form.kfa_code} onChange={(e) => set("kfa_code", e.target.value)} className="font-mono" />
          </Field>

          <label className="flex items-start gap-2 rounded-md border border-line bg-surface-alt px-3 py-2.5">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-(--color-brand-600)"
              checked={form.is_racikable}
              onChange={(e) => set("is_racikable", e.target.checked)}
            />
            <span className="text-meta text-ink-muted">
              <strong className="text-ink">Boleh jadi bahan racikan</strong>
              <br />Muncul di pencarian bahan pada RacikanBuilder dokter.
            </span>
          </label>

          <label className="flex items-start gap-2 rounded-md border border-line bg-surface-alt px-3 py-2.5">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-(--color-brand-600)"
              checked={form.butuh_resep}
              onChange={(e) => set("butuh_resep", e.target.checked)}
            />
            <span className="text-meta text-ink-muted">
              <strong className="text-ink">Butuh resep dokter</strong>
              <br />Obat keras tidak boleh diserahkan tanpa resep.
            </span>
          </label>
        </div>

        {rugi ? (
          <p className="mt-3 flex items-start gap-1.5 rounded-md border border-danger/25 bg-danger-bg px-3 py-2 text-meta text-danger">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            Harga jual {formatRupiah(jual)} di bawah HPP {formatRupiah(hpp)}. Setiap
            penjualan akan merugi — periksa kembali angkanya.
          </p>
        ) : null}
      </Modal>
    </>
  );
}

export function ToggleItem({
  id,
  aktif,
  nama,
  adaStok,
}: {
  id: number;
  aktif: boolean;
  nama: string;
  adaStok: boolean;
}) {
  const router = useRouter();
  const [proses, setProses] = useState(false);

  async function toggle() {
    if (aktif && adaStok) {
      toast.error(
        `${nama} masih punya sisa stok. Habiskan atau koreksi stoknya sebelum dinonaktifkan.`,
        { duration: 6000 },
      );
      return;
    }
    setProses(true);
    try {
      const hasil = await setAktifItemAction(id, !aktif);
      if (!hasil.ok) {
        toast.error(hasil.error);
        return;
      }
      toast.success(aktif ? `${nama} dinonaktifkan.` : `${nama} diaktifkan.`);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={aktif ? `Nonaktifkan ${nama}` : `Aktifkan ${nama}`}
      onClick={toggle}
      disabled={proses}
      className={aktif ? "hover:text-danger" : "hover:text-success"}
    >
      <Power />
    </Button>
  );
}
