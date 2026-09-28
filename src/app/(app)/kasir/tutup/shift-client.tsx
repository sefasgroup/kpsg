"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { DoorClosed, DoorOpen, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { formatRupiah } from "@/lib/format";
import { bukaShiftAction, tutupShiftAction } from "../actions";

export function BukaShift() {
  const router = useRouter();
  const [kas, setKas] = useState(0);
  const [proses, setProses] = useState(false);

  async function buka() {
    setProses(true);
    try {
      const hasil = await bukaShiftAction(kas);
      if (!hasil.ok) {
        toast.error(hasil.error);
        return;
      }
      toast.success("Shift dibuka.");
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Kas Awal (Rp)"
        hint="Uang tunai di laci saat shift dimulai"
      >
        <Input
          type="number"
          min={0}
          step={1000}
          value={kas}
          onChange={(e) => setKas(Math.max(0, Number(e.target.value)))}
          className="text-right text-h2"
        />
      </Field>
      <Button type="button" variant="primary" onClick={buka} disabled={proses}>
        <DoorOpen />
        {proses ? "Membuka…" : "Buka Shift"}
      </Button>
    </div>
  );
}

export function TutupShift({
  shiftId,
  kasAwal,
  tunaiMasuk,
}: {
  shiftId: number;
  kasAwal: number;
  tunaiMasuk: number;
}) {
  const router = useRouter();
  const [fisik, setFisik] = useState(0);
  const [catatan, setCatatan] = useState("");
  const [proses, setProses] = useState(false);

  // Hanya transaksi TUNAI yang menambah uang di laci — QRIS, transfer, dan
  // kartu masuk ke rekening, bukan ke kas.
  const kasSistem = kasAwal + tunaiMasuk;
  const selisih = fisik - kasSistem;

  async function tutup() {
    setProses(true);
    try {
      const hasil = await tutupShiftAction(shiftId, {
        kas_akhir_fisik: fisik,
        catatan,
      });
      if (!hasil.ok) {
        toast.error(hasil.error);
        return;
      }
      toast.success(
        hasil.data.selisih === 0
          ? "Shift ditutup. Kas cocok."
          : `Shift ditutup dengan selisih ${formatRupiah(hasil.data.selisih)}.`,
      );
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 rounded-md border border-line bg-surface-alt px-3 py-2.5 text-body">
        <div className="flex justify-between">
          <span className="text-ink-muted">Kas awal</span>
          <span className="text-ink tabular">{formatRupiah(kasAwal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-muted">Penerimaan tunai</span>
          <span className="text-ink tabular">{formatRupiah(tunaiMasuk)}</span>
        </div>
        <div className="flex justify-between border-t border-line pt-1.5">
          <span className="text-h2 text-ink">Kas seharusnya</span>
          <span className="text-h2 text-ink tabular">{formatRupiah(kasSistem)}</span>
        </div>
      </div>

      <Field label="Kas Fisik Dihitung (Rp)" required>
        <Input
          type="number"
          min={0}
          step={500}
          value={fisik}
          onChange={(e) => setFisik(Math.max(0, Number(e.target.value)))}
          className="text-right text-h2"
        />
      </Field>

      {fisik > 0 && selisih !== 0 ? (
        <p
          className={`flex items-start gap-1.5 rounded-md border px-3 py-2 text-meta ${
            selisih < 0
              ? "border-danger/25 bg-danger-bg text-danger"
              : "border-warning/25 bg-warning-bg text-warning"
          }`}
        >
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          Selisih {formatRupiah(selisih)} ({selisih < 0 ? "kurang" : "lebih"}).
          Jelaskan penyebabnya di catatan — selisih tercatat permanen di audit log.
        </p>
      ) : null}

      <Field label="Catatan" hint="Wajib diisi bila ada selisih">
        <Textarea rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} />
      </Field>

      <Button
        type="button"
        variant="primary"
        onClick={tutup}
        disabled={proses || (selisih !== 0 && catatan.trim().length < 3)}
      >
        <DoorClosed />
        {proses ? "Menutup…" : "Tutup Shift"}
      </Button>
    </div>
  );
}
