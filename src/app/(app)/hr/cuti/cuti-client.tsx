"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Check, FilePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { JENIS_CUTI_LABEL } from "@/lib/validations/hr";
import { ajukanCutiAction, putuskanCutiAction } from "../actions";

export function AjukanCuti({
  pegawai,
  hariIni,
}: {
  pegawai: { id: number; nama: string; role_nama: string }[];
  hariIni: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [proses, setProses] = useState(false);
  const [form, setForm] = useState({
    user_id: "",
    jenis: "cuti_tahunan",
    tanggal_mulai: hariIni,
    tanggal_akhir: hariIni,
    alasan: "",
  });

  const [lampiran, setLampiran] = useState<File | null>(null);

  async function simpan() {
    setProses(true);
    try {
      // FormData, bukan objek biasa: berkas tidak bisa menyeberang ke
      // Server Action lewat serialisasi JSON.
      const fd = new FormData();
      for (const [k, v] of Object.entries(form)) fd.append(k, v);
      if (lampiran) fd.append("lampiran", lampiran);

      const hasil = await ajukanCutiAction(fd);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 6000 });
        return;
      }
      toast.success("Pengajuan tersimpan, menunggu persetujuan.");
      setOpen(false);
      setForm({ ...form, user_id: "", alasan: "" });
      setLampiran(null);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <FilePlus />
        Ajukan Cuti / Izin
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="Pengajuan Cuti / Izin"
        footer={
          <>
            <Button type="button" onClick={() => setOpen(false)} disabled={proses}>
              Batal
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={simpan}
              disabled={proses || !form.user_id}
            >
              {proses ? "Menyimpan…" : "Ajukan"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Pegawai" required className="sm:col-span-2">
            <Select
              value={form.user_id}
              onChange={(e) => setForm({ ...form, user_id: e.target.value })}
            >
              <option value="">Pilih pegawai…</option>
              {pegawai.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nama} — {p.role_nama}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Jenis" required className="sm:col-span-2">
            <Select
              value={form.jenis}
              onChange={(e) => setForm({ ...form, jenis: e.target.value })}
            >
              {Object.entries(JENIS_CUTI_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>

          <Field label="Tanggal Mulai" required>
            <Input
              type="date"
              value={form.tanggal_mulai}
              onChange={(e) => setForm({ ...form, tanggal_mulai: e.target.value })}
            />
          </Field>
          <Field label="Tanggal Akhir" required>
            <Input
              type="date"
              value={form.tanggal_akhir}
              onChange={(e) => setForm({ ...form, tanggal_akhir: e.target.value })}
            />
          </Field>

          <Field label="Alasan" className="sm:col-span-2">
            <Textarea
              rows={2}
              value={form.alasan}
              onChange={(e) => setForm({ ...form, alasan: e.target.value })}
            />
          </Field>

          <Field
            label="Lampiran"
            className="sm:col-span-2"
            hint="Surat dokter atau bukti pendukung — PDF/JPG/PNG, maksimal 5 MB"
          >
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => setLampiran(e.target.files?.[0] ?? null)}
              className="w-full rounded-md border border-line bg-surface px-3 py-1.5 text-meta text-ink file:mr-3 file:rounded-sm file:border-0 file:bg-surface-alt file:px-2.5 file:py-1 file:text-meta file:text-ink"
            />
            {lampiran ? (
              <p className="mt-1 text-micro text-ink-muted">
                {lampiran.name} · {(lampiran.size / 1024).toFixed(0)} KB
              </p>
            ) : null}
          </Field>
        </div>

        <p className="mt-3 text-meta text-ink-muted">
          Lampiran disimpan di luar direktori publik dan hanya bisa dibuka oleh
          pemohon sendiri serta Admin Cabang — surat dokter adalah dokumen medis
          pegawai, bukan berkas umum.
        </p>

        <p className="mt-3 rounded-md border border-info/25 bg-info-bg px-3 py-2 text-meta text-info">
          Bila pemohon adalah dokter dan pengajuan disetujui, pengecualian jadwal
          untuk setiap hari dalam rentang dibuat otomatis — Anda tidak perlu
          menginputnya dua kali.
        </p>
      </Modal>
    </>
  );
}

export function PutusanCuti({ id }: { id: number }) {
  const router = useRouter();
  const [proses, setProses] = useState(false);

  async function putuskan(setuju: boolean) {
    setProses(true);
    try {
      const hasil = await putuskanCutiAction(id, setuju);
      if (!hasil.ok) {
        toast.error(hasil.error);
        return;
      }
      toast.success(
        setuju
          ? hasil.data.pengecualianDibuat > 0
            ? `Disetujui. ${hasil.data.pengecualianDibuat} hari jadwal praktik ikut ditandai berhalangan.`
            : "Pengajuan disetujui."
          : "Pengajuan ditolak.",
        { duration: 6000 },
      );
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="primary" onClick={() => putuskan(true)} disabled={proses}>
        <Check />
        Setujui
      </Button>
      <Button size="sm" onClick={() => putuskan(false)} disabled={proses}>
        <X />
        Tolak
      </Button>
    </div>
  );
}
