"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { PackagePlus, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Autocomplete } from "@/components/ui/autocomplete";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { formatRupiah } from "@/lib/format";
import {
  cariItemAction,
  catatPenerimaanAction,
  simpanSupplierAction,
} from "../inventory-actions";

type Baris = {
  key: string;
  item_id: number;
  kode: string;
  nama: string;
  satuan: string;
  hargaAcuan: string;
  hargaJual: number;
  qty: string;
  harga_satuan: string;
  no_batch: string;
  tanggal_kadaluarsa: string;
};

export function FormPenerimaan({
  supplier,
  hariIni,
}: {
  supplier: { id: number; nama: string }[];
  hariIni: string;
}) {
  const router = useRouter();
  const [baris, setBaris] = useState<Baris[]>([]);
  const [proses, setProses] = useState(false);
  const [h, setH] = useState({
    supplier_id: "",
    no_faktur: "",
    tanggal: hariIni,
    diskon: "0",
    ppn: "0",
    catatan: "",
    perbarui_hpp: false,
  });

  const subtotal = baris.reduce(
    (n, b) => n + Number(b.qty || 0) * Number(b.harga_satuan || 0),
    0,
  );
  const total = subtotal - Number(h.diskon || 0) + Number(h.ppn || 0);

  function ubah(key: string, patch: Partial<Baris>) {
    setBaris((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function simpan() {
    if (baris.length === 0) {
      toast.error("Tambahkan minimal satu item yang diterima.");
      return;
    }
    setProses(true);
    try {
      const hasil = await catatPenerimaanAction({
        ...h,
        items: baris.map((b) => ({
          item_id: b.item_id,
          qty: b.qty,
          harga_satuan: b.harga_satuan,
          no_batch: b.no_batch,
          tanggal_kadaluarsa: b.tanggal_kadaluarsa,
        })),
      });

      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 7000 });
        return;
      }

      toast.success(
        `${hasil.data.no_penerimaan} — ${hasil.data.jumlahItem} item, ${formatRupiah(hasil.data.total)}.`,
        { duration: 6000 },
      );

      // Peringatan tidak membatalkan penerimaan: barangnya memang sudah
      // diterima. Tapi apoteker harus tahu sekarang, bukan saat menyerahkan.
      for (const nama of hasil.data.peringatanKadaluarsa) {
        toast.error(`${nama} diterima dalam keadaan SUDAH KADALUARSA.`, {
          duration: 12000,
        });
      }
      for (const nama of hasil.data.peringatanHarga) {
        toast(`${nama}: harga beli melebihi harga jual — tinjau harga jualnya.`, {
          icon: "⚠️",
          duration: 10000,
        });
      }

      setBaris([]);
      setH({ ...h, no_faktur: "", diskon: "0", ppn: "0", catatan: "" });
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={PackagePlus}>Catat Penerimaan Barang</CardTitle>
        <FormSupplier />
      </CardHeader>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Supplier">
          <Select
            value={h.supplier_id}
            onChange={(e) => setH({ ...h, supplier_id: e.target.value })}
          >
            <option value="">— Tanpa supplier —</option>
            {supplier.map((s) => (
              <option key={s.id} value={s.id}>{s.nama}</option>
            ))}
          </Select>
        </Field>
        <Field label="No. Faktur">
          <Input
            value={h.no_faktur}
            onChange={(e) => setH({ ...h, no_faktur: e.target.value })}
            placeholder="INV-2026-0912"
          />
        </Field>
        <Field label="Tanggal Terima" required>
          <Input
            type="date"
            value={h.tanggal}
            onChange={(e) => setH({ ...h, tanggal: e.target.value })}
          />
        </Field>
        <Field label="Catatan">
          <Input
            value={h.catatan}
            onChange={(e) => setH({ ...h, catatan: e.target.value })}
          />
        </Field>
      </div>

      <div className="mt-4">
        <p className="mb-1.5 text-label text-ink-muted">Tambah Item</p>
        <Autocomplete
          cari={cariItemAction}
          placeholder="Cari obat / BMHP berdasarkan nama atau kode…"
          keyOf={(i) => i.id}
          onPilih={(i) =>
            setBaris((rows) => [
              ...rows,
              {
                key: `${i.id}-${rows.length}-${i.kode}`,
                item_id: i.id,
                kode: i.kode,
                nama: i.nama,
                satuan: i.satuan_dasar,
                hargaAcuan: i.hpp,
                hargaJual: Number(i.harga_jual),
                qty: "",
                harga_satuan: String(Number(i.hpp)),
                no_batch: "",
                tanggal_kadaluarsa: "",
              },
            ])
          }
          renderBaris={(i) => (
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate text-ink">{i.nama}</span>
              <span className="font-mono text-micro text-ink-faint">{i.kode}</span>
              <span className="ml-auto shrink-0 text-meta text-ink-muted">
                stok {Number(i.stok)} {i.satuan_dasar}
              </span>
            </span>
          )}
        />
      </div>

      {baris.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="bg-surface-alt">
                {["Item", "Jumlah", "Harga Beli", "No. Batch", "Kadaluarsa", "Subtotal", ""].map((c) => (
                  <th
                    key={c}
                    className="border-b border-line px-3 py-2 text-left text-label font-medium whitespace-nowrap text-ink-muted"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {baris.map((b) => {
                const nilai = Number(b.qty || 0) * Number(b.harga_satuan || 0);
                const mahal = Number(b.harga_satuan || 0) > b.hargaJual;
                const kadaluarsa =
                  b.tanggal_kadaluarsa !== "" && b.tanggal_kadaluarsa < h.tanggal;
                return (
                  <tr key={b.key} className="border-b border-line last:border-b-0 align-top">
                    <td className="px-3 py-2">
                      <p className="text-ink">{b.nama}</p>
                      <p className="font-mono text-micro text-ink-faint">{b.kode}</p>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={b.qty}
                          onChange={(e) => ubah(b.key, { qty: e.target.value })}
                          className="h-8 w-24 text-meta"
                        />
                        <span className="text-meta text-ink-faint">{b.satuan}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={0}
                        step={100}
                        value={b.harga_satuan}
                        onChange={(e) => ubah(b.key, { harga_satuan: e.target.value })}
                        className="h-8 w-32 text-meta"
                        aria-invalid={mahal}
                      />
                      {mahal ? (
                        <p className="mt-0.5 text-micro text-warning">
                          &gt; harga jual {formatRupiah(b.hargaJual)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={b.no_batch}
                        onChange={(e) => ubah(b.key, { no_batch: e.target.value })}
                        className="h-8 w-28 font-mono text-meta"
                        placeholder="B2608A"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="date"
                        value={b.tanggal_kadaluarsa}
                        onChange={(e) => ubah(b.key, { tanggal_kadaluarsa: e.target.value })}
                        className="h-8 w-36 text-meta"
                        aria-invalid={kadaluarsa}
                      />
                      {kadaluarsa ? (
                        <p className="mt-0.5 text-micro text-danger">Sudah lewat</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 tabular text-ink">{formatRupiah(nilai)}</td>
                    <td className="px-3 py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Hapus ${b.nama}`}
                        onClick={() => setBaris((rows) => rows.filter((r) => r.key !== b.key))}
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
        <p className="mt-3 rounded-md border border-dashed border-line px-3 py-6 text-center text-meta text-ink-faint">
          Belum ada item. Cari obat atau BMHP di kolom di atas.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-t border-line pt-4">
        <div className="grid max-w-md flex-1 gap-3 sm:grid-cols-2">
          <Field label="Diskon (Rp)">
            <Input
              type="number"
              min={0}
              step={1000}
              value={h.diskon}
              onChange={(e) => setH({ ...h, diskon: e.target.value })}
            />
          </Field>
          <Field label="PPN (Rp)">
            <Input
              type="number"
              min={0}
              step={1000}
              value={h.ppn}
              onChange={(e) => setH({ ...h, ppn: e.target.value })}
            />
          </Field>
          <label className="flex items-start gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={h.perbarui_hpp}
              onChange={(e) => setH({ ...h, perbarui_hpp: e.target.checked })}
              className="mt-0.5 size-4 accent-[var(--color-brand-600)]"
            />
            <span className="text-meta text-ink-muted">
              Perbarui HPP katalog dari harga beli ini.
              <span className="block text-micro text-ink-faint">
                HPP berlaku global untuk semua cabang, sementara stoknya per cabang —
                centang hanya bila harga ini memang harga terbaru untuk seluruh jaringan.
              </span>
            </span>
          </label>
        </div>

        <div className="text-right">
          <p className="text-meta text-ink-muted">
            Subtotal <span className="tabular text-ink">{formatRupiah(subtotal)}</span>
          </p>
          <p className="mt-0.5 text-h2 text-ink">
            Total <span className="tabular">{formatRupiah(total)}</span>
          </p>
          {total < 0 ? (
            <p className="mt-0.5 flex items-center justify-end gap-1 text-meta text-danger">
              <TriangleAlert className="size-3.5" /> Diskon melebihi nilai barang
            </p>
          ) : null}
          <Button
            variant="primary"
            className="mt-2"
            onClick={simpan}
            disabled={proses || baris.length === 0 || total < 0}
          >
            <PackagePlus />
            {proses ? "Menyimpan…" : "Simpan & Tambah Stok"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------

function FormSupplier() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [proses, setProses] = useState(false);
  const [f, setF] = useState({ kode: "", nama: "", kontak: "", telepon: "", alamat: "" });

  async function simpan() {
    setProses(true);
    try {
      const h = await simpanSupplierAction(f);
      if (!h.ok) { toast.error(h.error); return; }
      toast.success("Supplier tersimpan.");
      setF({ kode: "", nama: "", kontak: "", telepon: "", alamat: "" });
      setOpen(false);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus />
        Supplier Baru
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Tambah Supplier"
        description="Supplier berlaku untuk seluruh cabang."
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={proses}>Batal</Button>
            <Button variant="primary" onClick={simpan} disabled={proses}>
              {proses ? "Menyimpan…" : "Simpan"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kode" required hint="Huruf kapital, angka, tanda hubung">
            <Input
              value={f.kode}
              onChange={(e) => setF({ ...f, kode: e.target.value.toUpperCase() })}
              className="font-mono"
            />
          </Field>
          <Field label="Nama Supplier" required>
            <Input value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} />
          </Field>
          <Field label="Nama Kontak">
            <Input value={f.kontak} onChange={(e) => setF({ ...f, kontak: e.target.value })} />
          </Field>
          <Field label="Telepon">
            <Input value={f.telepon} onChange={(e) => setF({ ...f, telepon: e.target.value })} />
          </Field>
          <Field label="Alamat" className="sm:col-span-2">
            <Textarea
              rows={2}
              value={f.alamat}
              onChange={(e) => setF({ ...f, alamat: e.target.value })}
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------

export function RincianPenerimaan({
  no,
  items,
}: {
  no: string;
  items: {
    id: number; kode: string; nama: string; satuan_dasar: string;
    no_batch: string | null; tanggal_kadaluarsa: string | null;
    qty: string; harga_satuan: string; subtotal: string;
  }[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {items.length} item
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={no} size="md">
        <table className="w-full border-collapse text-body">
          <thead>
            <tr className="bg-surface-alt">
              {["Item", "Batch", "Kadaluarsa", "Jumlah", "Harga", "Subtotal"].map((c) => (
                <th
                  key={c}
                  className="border-b border-line px-2.5 py-1.5 text-left text-label font-medium text-ink-muted"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-line last:border-b-0">
                <td className="px-2.5 py-1.5">
                  <span className="text-ink">{it.nama}</span>
                  <span className="ml-1.5 font-mono text-micro text-ink-faint">{it.kode}</span>
                </td>
                <td className="px-2.5 py-1.5 font-mono text-meta text-ink-muted">
                  {it.no_batch ?? "—"}
                </td>
                <td className="px-2.5 py-1.5 text-meta text-ink-muted">
                  {it.tanggal_kadaluarsa ?? "—"}
                </td>
                <td className="px-2.5 py-1.5 tabular text-ink">
                  {Number(it.qty)} <span className="text-micro text-ink-faint">{it.satuan_dasar}</span>
                </td>
                <td className="px-2.5 py-1.5 tabular text-ink-muted">
                  {formatRupiah(it.harga_satuan)}
                </td>
                <td className="px-2.5 py-1.5 tabular text-ink">{formatRupiah(it.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.some((i) => !i.no_batch && !i.tanggal_kadaluarsa) ? (
          <p className="mt-3 flex items-start gap-1.5 text-meta text-ink-muted">
            <Badge variant="neutral">Tanpa batch</Badge>
            Item tanpa nomor batch maupun tanggal kadaluarsa tidak muncul di
            monitoring kadaluarsa.
          </p>
        ) : null}
      </Modal>
    </>
  );
}
