"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Building2, Pencil, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { setAktifCabangAction, simpanCabangAction } from "../master-actions";

export type CabangForm = {
  id?: number;
  kode: string;
  nama: string;
  nama_legal: string;
  no_izin_klinik: string;
  alamat: string;
  kota: string;
  provinsi: string;
  telepon: string;
  email: string;
};

const KOSONG: CabangForm = {
  kode: "", nama: "", nama_legal: "", no_izin_klinik: "",
  alamat: "", kota: "", provinsi: "", telepon: "", email: "",
};

export function FormCabang({
  awal,
  pemicu,
}: {
  awal?: CabangForm;
  pemicu?: "tambah" | "edit";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [proses, setProses] = useState(false);
  const [form, setForm] = useState<CabangForm>(awal ?? KOSONG);
  const set = (k: keyof CabangForm, v: string) => setForm({ ...form, [k]: v });

  async function simpan() {
    setProses(true);
    try {
      const hasil = await simpanCabangAction(form, awal?.id);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 6000 });
        return;
      }
      toast.success(awal ? "Cabang diperbarui." : "Cabang baru dibuat beserta penomorannya.");
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
          <Building2 />
          Tambah Cabang
        </Button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={awal ? `Ubah ${awal.nama}` : "Tambah Cabang"}
        description="Data ini dipakai sebagai kop surat pada seluruh dokumen cetak cabang tersebut."
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
          <Field label="Kode Cabang" required hint="Prefix nomor dokumen, mis. KPSG-02">
            <Input
              value={form.kode}
              onChange={(e) => set("kode", e.target.value.toUpperCase())}
              className="font-mono"
              maxLength={20}
            />
          </Field>
          <Field label="Nama Cabang" required>
            <Input value={form.nama} onChange={(e) => set("nama", e.target.value)} />
          </Field>
          <Field label="Nama Legal" hint="Dicetak di kop surat A4" className="sm:col-span-2">
            <Input
              value={form.nama_legal}
              onChange={(e) => set("nama_legal", e.target.value)}
              placeholder="Klinik Pratama Sahabat Gamma"
            />
          </Field>
          <Field label="No. Izin Klinik" className="sm:col-span-2">
            <Input value={form.no_izin_klinik} onChange={(e) => set("no_izin_klinik", e.target.value)} />
          </Field>
          <Field label="Alamat" className="sm:col-span-2">
            <Textarea rows={2} value={form.alamat} onChange={(e) => set("alamat", e.target.value)} />
          </Field>
          <Field label="Kota / Kabupaten">
            <Input value={form.kota} onChange={(e) => set("kota", e.target.value)} />
          </Field>
          <Field label="Provinsi">
            <Input value={form.provinsi} onChange={(e) => set("provinsi", e.target.value)} />
          </Field>
          <Field label="Telepon">
            <Input value={form.telepon} onChange={(e) => set("telepon", e.target.value)} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

export function ToggleCabang({
  id,
  aktif,
  nama,
  adaStaf,
}: {
  id: number;
  aktif: boolean;
  nama: string;
  adaStaf: boolean;
}) {
  const router = useRouter();
  const [proses, setProses] = useState(false);

  async function toggle() {
    if (aktif && adaStaf) {
      toast.error(
        `${nama} masih punya staf aktif. Pindahkan atau nonaktifkan stafnya dulu.`,
        { duration: 6000 },
      );
      return;
    }
    setProses(true);
    try {
      const hasil = await setAktifCabangAction(id, !aktif);
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
