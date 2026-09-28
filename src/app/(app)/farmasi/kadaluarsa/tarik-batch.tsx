"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { PackageX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { tarikBatchAction } from "../inventory-actions";

export function TarikBatch({
  batchId,
  nama,
  noBatch,
  kadaluarsa,
  qtyBatch,
  stokItem,
  satuan,
}: {
  batchId: number;
  nama: string;
  noBatch: string | null;
  kadaluarsa: string;
  qtyBatch: number;
  stokItem: number;
  satuan: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [proses, setProses] = useState(false);
  // Batas aman: tidak lebih dari isi batch maupun saldo gudang.
  const maks = Math.min(qtyBatch, stokItem);
  const [f, setF] = useState({ qty: String(maks), alasan: "" });

  const qty = Number(f.qty || 0);
  const siap = qty > 0 && qty <= maks && f.alasan.trim().length >= 10;

  async function tarik() {
    setProses(true);
    try {
      const h = await tarikBatchAction({ batch_id: batchId, qty: f.qty, alasan: f.alasan });
      if (!h.ok) { toast.error(h.error, { duration: 8000 }); return; }
      toast.success(
        `${h.data.nama} ditarik. Sisa batch ${h.data.sisaBatch}, saldo gudang ${h.data.sisaStok}.`,
        { duration: 7000 },
      );
      setOpen(false);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} disabled={stokItem <= 0}>
        <PackageX />
        Tarik
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Tarik ${nama}`}
        description={`Batch ${noBatch ?? "tanpa nomor"} — kadaluarsa ${kadaluarsa}`}
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={proses}>Batal</Button>
            <Button variant="danger" onClick={tarik} disabled={!siap || proses}>
              {proses ? "Menarik…" : "Tarik dari Stok"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 rounded-md border border-line bg-surface-alt px-3 py-2 text-meta">
            <span className="text-ink-muted">
              Sisa batch <strong className="tabular text-ink">{qtyBatch} {satuan}</strong>
            </span>
            <span className="text-ink-muted">
              Saldo gudang <strong className="tabular text-ink">{stokItem} {satuan}</strong>
            </span>
          </div>

          {qtyBatch > stokItem ? (
            <p className="rounded-md border border-warning/25 bg-warning-bg px-3 py-2 text-meta text-ink">
              Sisa batch melebihi saldo gudang — pertanda pencatatan yang perlu
              ditinjau lewat stock opname. Penarikan dibatasi pada saldo gudang{" "}
              <strong>{stokItem} {satuan}</strong>.
            </p>
          ) : null}

          <Field
            label="Jumlah Ditarik"
            required
            error={qty > maks ? `Maksimal ${maks} ${satuan}` : undefined}
            hint={`Maksimal ${maks} ${satuan}`}
          >
            <Input
              type="number"
              min={0}
              max={maks}
              step="any"
              value={f.qty}
              onChange={(e) => setF({ ...f, qty: e.target.value })}
              aria-invalid={qty > maks}
            />
          </Field>

          <Field
            label="Keterangan Pemusnahan"
            required
            hint="Minimal 10 karakter — masuk kartu stok dan audit log"
          >
            <Textarea
              rows={2}
              value={f.alasan}
              onChange={(e) => setF({ ...f, alasan: e.target.value })}
              placeholder="Dimusnahkan sesuai berita acara No. 08/BA/VIII/2026, disaksikan Apoteker Penanggung Jawab."
            />
          </Field>

          <p className="text-meta text-ink-muted">
            Penarikan tercatat sebagai <span className="font-mono">keluar_kadaluarsa</span>{" "}
            di kartu stok — bukan penghapusan baris — sehingga jejaknya tetap bisa
            ditelusuri saat audit. Batch ini ditarik secara eksplisit, melewati
            urutan FEFO.
          </p>
        </div>
      </Modal>
    </>
  );
}
