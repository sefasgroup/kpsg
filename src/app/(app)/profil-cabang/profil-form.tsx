"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Building2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { simpanProfilAction } from "./actions";

export type ProfilAwal = {
  kode: string;
  nama: string;
  nama_legal: string | null;
  no_izin_klinik: string | null;
  npwp: string | null;
  alamat: string | null;
  kelurahan: string | null;
  kecamatan: string | null;
  kota: string | null;
  provinsi: string | null;
  kode_pos: string | null;
  telepon: string | null;
  email: string | null;
  header_cetak: string | null;
  footer_cetak: string | null;
};

const kosong = (v: string | null) => v ?? "";

export function FormProfilCabang({ awal }: { awal: ProfilAwal }) {
  const router = useRouter();
  const [proses, setProses] = useState(false);
  const [f, setF] = useState({
    nama: awal.nama,
    nama_legal: kosong(awal.nama_legal),
    no_izin_klinik: kosong(awal.no_izin_klinik),
    npwp: kosong(awal.npwp),
    alamat: kosong(awal.alamat),
    kelurahan: kosong(awal.kelurahan),
    kecamatan: kosong(awal.kecamatan),
    kota: kosong(awal.kota),
    provinsi: kosong(awal.provinsi),
    kode_pos: kosong(awal.kode_pos),
    telepon: kosong(awal.telepon),
    email: kosong(awal.email),
    header_cetak: kosong(awal.header_cetak),
    footer_cetak: kosong(awal.footer_cetak),
  });

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  async function simpan() {
    setProses(true);
    try {
      const h = await simpanProfilAction(f);
      if (!h.ok) { toast.error(h.error, { duration: 6000 }); return; }
      toast.success("Profil cabang diperbarui. Kop surat mengikuti data ini.");
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={Building2}>Identitas Cabang</CardTitle>
        <Button variant="primary" size="sm" onClick={simpan} disabled={proses}>
          <Save />
          {proses ? "Menyimpan…" : "Simpan"}
        </Button>
      </CardHeader>

      <p className="mb-3 text-meta text-ink-muted">
        Data di sini langsung menjadi kop surat pada hasil laboratorium, surat
        keterangan, resep, dan struk kasir cabang ini.
      </p>

      <div className="grid gap-3 sm:grid-cols-6">
        <Field
          label="Kode Cabang"
          className="sm:col-span-2"
          hint="Awalan nomor dokumen — hanya Super Admin yang boleh mengubahnya"
        >
          <Input value={awal.kode} readOnly disabled className="font-mono" />
        </Field>
        <Field label="Nama Cabang" required className="sm:col-span-4">
          <Input value={f.nama} onChange={set("nama")} />
        </Field>

        <Field label="Nama Badan Hukum" className="sm:col-span-3" hint="Tercetak di baris kedua kop surat">
          <Input value={f.nama_legal} onChange={set("nama_legal")} placeholder="PT Sahabat Gamma Sejahtera" />
        </Field>
        <Field label="No. Izin Klinik" className="sm:col-span-2">
          <Input value={f.no_izin_klinik} onChange={set("no_izin_klinik")} />
        </Field>
        <Field label="NPWP">
          <Input value={f.npwp} onChange={set("npwp")} className="font-mono" />
        </Field>

        <Field label="Alamat" className="sm:col-span-6">
          <Input value={f.alamat} onChange={set("alamat")} placeholder="Jl. Merdeka No. 12" />
        </Field>

        <Field label="Kelurahan" className="sm:col-span-2">
          <Input value={f.kelurahan} onChange={set("kelurahan")} />
        </Field>
        <Field label="Kecamatan" className="sm:col-span-2">
          <Input value={f.kecamatan} onChange={set("kecamatan")} />
        </Field>
        <Field label="Kota / Kabupaten" className="sm:col-span-2">
          <Input value={f.kota} onChange={set("kota")} />
        </Field>
        <Field label="Provinsi" className="sm:col-span-2">
          <Input value={f.provinsi} onChange={set("provinsi")} />
        </Field>
        <Field label="Kode Pos">
          <Input value={f.kode_pos} onChange={set("kode_pos")} className="font-mono" />
        </Field>
        <Field label="Telepon">
          <Input value={f.telepon} onChange={set("telepon")} />
        </Field>
        <Field label="Email" className="sm:col-span-2">
          <Input type="email" value={f.email} onChange={set("email")} />
        </Field>

        <Field
          label="Baris Tambahan Kop Surat"
          className="sm:col-span-3"
          hint="Mis. akreditasi atau jam operasional"
        >
          <Textarea rows={2} value={f.header_cetak} onChange={set("header_cetak")} />
        </Field>
        <Field
          label="Catatan Kaki Dokumen"
          className="sm:col-span-3"
          hint="Mis. imbauan atau nomor pengaduan"
        >
          <Textarea rows={2} value={f.footer_cetak} onChange={set("footer_cetak")} />
        </Field>
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <p className="mb-2 text-label text-ink-muted">Pratinjau Kop Surat</p>
        <div className="rounded-md border border-line bg-surface-alt px-4 py-3">
          <p className="text-h1 text-brand-700">{f.nama || "—"}</p>
          {f.nama_legal ? <p className="text-meta text-ink-muted">{f.nama_legal}</p> : null}
          <p className="text-meta text-ink-muted">
            {[f.alamat, f.kelurahan, f.kecamatan, f.kota, f.provinsi, f.kode_pos]
              .filter(Boolean)
              .join(", ") || "Alamat belum diisi"}
          </p>
          <p className="text-meta text-ink-muted">
            {[
              f.telepon ? `Telp. ${f.telepon}` : null,
              f.email,
              f.no_izin_klinik ? `Izin Klinik: ${f.no_izin_klinik}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "Kontak belum diisi"}
          </p>
          {f.header_cetak ? (
            <p className="mt-1 whitespace-pre-line text-micro text-ink-faint">{f.header_cetak}</p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
