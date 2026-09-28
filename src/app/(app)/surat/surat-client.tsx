"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useReactToPrint } from "react-to-print";
import toast from "react-hot-toast";
import { FileText, Printer, ScrollText, X } from "lucide-react";
import { Autocomplete } from "@/components/ui/autocomplete";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { formatTanggalPendek, hitungUmur } from "@/lib/format";
import { BUTA_WARNA, LABEL_BUTA_WARNA } from "@/lib/validations/dokumen";
import { cariKunjunganAction, terbitkanSuratAction } from "./actions";
import { LembarSurat, type DataSurat } from "./lembar-surat";

const JENIS: { nilai: string; label: string; hint: string }[] = [
  { nilai: "sakit", label: "Keterangan Sakit", hint: "Memuat lama istirahat" },
  { nilai: "sehat", label: "Keterangan Sehat", hint: "Untuk melamar kerja, sekolah, dsb" },
  { nilai: "rujukan", label: "Rujukan", hint: "Ke faskes lanjutan" },
  { nilai: "keterangan_lain", label: "Keterangan Lain", hint: "Isi bebas" },
];

type Kunjungan = {
  id: number;
  no_visit: string;
  tanggal: string;
  no_rm: string;
  nik: string;
  nama: string;
  tanggal_lahir: string;
  jenis_kelamin: "L" | "P";
  alamat: string | null;
  pekerjaan: string | null;
  poli: string;
  diagnosa: string | null;
  jumlah_surat: number;
};

export function FormSurat({
  klinik,
  dokter,
  gelar,
  noSip,
  hariIni,
}: {
  klinik: DataSurat["klinik"];
  dokter: string;
  gelar: string | null;
  noSip: string | null;
  hariIni: string;
}) {
  const router = useRouter();
  const [kunjungan, setKunjungan] = useState<Kunjungan | null>(null);
  const [jenis, setJenis] = useState("sakit");
  const [proses, setProses] = useState(false);
  const [terbit, setTerbit] = useState<DataSurat | null>(null);

  const [f, setF] = useState({
    mulai: hariIni,
    lama_hari: "2",
    diagnosa_ditulis: "",
    keperluan: "",
    tinggi_badan: "",
    berat_badan: "",
    tekanan_darah: "",
    gol_darah: "",
    buta_warna: "",
    tujuan_faskes: "",
    tujuan_bagian: "",
    alasan_rujukan: "",
    ringkasan_klinis: "",
    perihal: "",
    isi_bebas: "",
  });

  const lembarRef = useRef<HTMLDivElement>(null);
  const cetak = useReactToPrint({
    contentRef: lembarRef,
    documentTitle: terbit ? `Surat ${terbit.noSurat}` : "Surat Keterangan",
  });

  async function simpan() {
    if (!kunjungan) return;
    setProses(true);
    try {
      const h = await terbitkanSuratAction({ ...f, visit_id: kunjungan.id, jenis });
      if (!h.ok) { toast.error(h.error, { duration: 7000 }); return; }

      toast.success(`${h.data.no_surat} diterbitkan.`, { duration: 6000 });
      setTerbit({
        klinik,
        noSurat: h.data.no_surat,
        jenis,
        terbit: hariIni,
        pasien: {
          nama: kunjungan.nama,
          noRm: kunjungan.no_rm,
          nik: kunjungan.nik,
          tanggalLahir: kunjungan.tanggal_lahir,
          jenisKelamin: kunjungan.jenis_kelamin,
          alamat: kunjungan.alamat,
          pekerjaan: kunjungan.pekerjaan,
        },
        dokter,
        gelar,
        noSip,
        data: { ...f },
      });
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle icon={ScrollText}>Terbitkan Surat Keterangan</CardTitle>
        </CardHeader>

        {kunjungan === null ? (
          <>
            <p className="mb-2 text-meta text-ink-muted">
              Surat selalu terikat pada satu kunjungan. Yang tampil hanya kunjungan
              30 hari terakhir yang <strong>Anda sendiri</strong> tangani — termasuk
              saat bertugas sebagai dokter pengganti.
            </p>
            <Autocomplete
              cari={cariKunjunganAction}
              placeholder="Cari pasien berdasarkan nama, No. RM, atau NIK…"
              keyOf={(k) => k.id}
              onPilih={(k) => setKunjungan(k as Kunjungan)}
              renderBaris={(k) => (
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="truncate text-ink">{k.nama}</span>
                  <span className="font-mono text-micro text-ink-faint">{k.no_rm}</span>
                  <span className="text-meta text-ink-muted">
                    {formatTanggalPendek(k.tanggal)} · {k.poli}
                  </span>
                  {Number(k.jumlah_surat) > 0 ? (
                    <span className="text-micro text-warning">
                      sudah ada {Number(k.jumlah_surat)} surat
                    </span>
                  ) : null}
                </span>
              )}
            />
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-alt px-3 py-2">
              <div>
                <p className="text-ink">
                  {kunjungan.nama}{" "}
                  <span className="text-meta text-ink-muted">
                    {hitungUmur(kunjungan.tanggal_lahir)} th ·{" "}
                    {kunjungan.jenis_kelamin === "L" ? "L" : "P"}
                  </span>
                </p>
                <p className="text-meta text-ink-muted">
                  <span className="font-mono">{kunjungan.no_rm}</span> ·{" "}
                  {formatTanggalPendek(kunjungan.tanggal)} · {kunjungan.poli}
                </p>
                {kunjungan.diagnosa ? (
                  <p className="mt-0.5 text-meta text-ink">Dx: {kunjungan.diagnosa}</p>
                ) : (
                  <p className="mt-0.5 text-meta text-warning">
                    Kunjungan ini belum punya diagnosa tercatat.
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Ganti kunjungan"
                onClick={() => setKunjungan(null)}
              >
                <X />
              </Button>
            </div>

            <fieldset>
              <legend className="mb-1.5 text-label text-ink-muted">
                Jenis Surat<span className="ml-0.5 text-danger">*</span>
              </legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {JENIS.map((j) => (
                  <label key={j.nilai} className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="jenis"
                      value={j.nilai}
                      checked={jenis === j.nilai}
                      onChange={(e) => setJenis(e.target.value)}
                      className="mt-0.5 size-4 accent-[var(--color-brand-600)]"
                    />
                    <span className="text-meta">
                      <span className="text-ink">{j.label}</span>
                      <span className="block text-micro text-ink-faint">{j.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {jenis === "sakit" ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Mulai Istirahat" required>
                  <Input type="date" value={f.mulai} onChange={(e) => setF({ ...f, mulai: e.target.value })} />
                </Field>
                <Field label="Lama (hari)" required hint="Hari pertama ikut terhitung">
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={f.lama_hari}
                    onChange={(e) => setF({ ...f, lama_hari: e.target.value })}
                  />
                </Field>
                <Field
                  label="Diagnosa yang Ditulis"
                  hint="Boleh dikosongkan bila pasien tidak ingin diagnosanya tercantum"
                >
                  <Input
                    value={f.diagnosa_ditulis}
                    onChange={(e) => setF({ ...f, diagnosa_ditulis: e.target.value })}
                    placeholder={kunjungan.diagnosa ?? "—"}
                  />
                </Field>
              </div>
            ) : null}

            {jenis === "sehat" ? (
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Keperluan" required className="sm:col-span-4">
                  <Input
                    value={f.keperluan}
                    onChange={(e) => setF({ ...f, keperluan: e.target.value })}
                    placeholder="Melamar pekerjaan di PT Sejahtera Abadi"
                  />
                </Field>
                <Field label="Tinggi (cm)">
                  <Input type="number" step="any" value={f.tinggi_badan} onChange={(e) => setF({ ...f, tinggi_badan: e.target.value })} />
                </Field>
                <Field label="Berat (kg)">
                  <Input type="number" step="any" value={f.berat_badan} onChange={(e) => setF({ ...f, berat_badan: e.target.value })} />
                </Field>
                <Field label="Tekanan Darah">
                  <Input value={f.tekanan_darah} onChange={(e) => setF({ ...f, tekanan_darah: e.target.value })} placeholder="120/80" />
                </Field>
                <Field label="Gol. Darah">
                  <Select value={f.gol_darah} onChange={(e) => setF({ ...f, gol_darah: e.target.value })}>
                    <option value="">—</option>
                    {["A", "B", "AB", "O"].map((g) => <option key={g} value={g}>{g}</option>)}
                  </Select>
                </Field>
                <Field
                  label="Buta Warna"
                  className="sm:col-span-2"
                  hint="Isi hanya bila tes Ishihara benar-benar dilakukan"
                >
                  <Select
                    value={f.buta_warna}
                    onChange={(e) => setF({ ...f, buta_warna: e.target.value })}
                  >
                    <option value="">— tidak diperiksa</option>
                    {BUTA_WARNA.map((b) => (
                      <option key={b} value={b}>{LABEL_BUTA_WARNA[b]}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            ) : null}

            {jenis === "rujukan" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Faskes Tujuan" required>
                  <Input
                    value={f.tujuan_faskes}
                    onChange={(e) => setF({ ...f, tujuan_faskes: e.target.value })}
                    placeholder="RSUD Kota Bandung"
                  />
                </Field>
                <Field label="Bagian / Poli Tujuan">
                  <Input
                    value={f.tujuan_bagian}
                    onChange={(e) => setF({ ...f, tujuan_bagian: e.target.value })}
                    placeholder="Penyakit Dalam"
                  />
                </Field>
                <Field label="Alasan Rujukan" required className="sm:col-span-2">
                  <Textarea rows={2} value={f.alasan_rujukan} onChange={(e) => setF({ ...f, alasan_rujukan: e.target.value })} />
                </Field>
                <Field
                  label="Ringkasan Klinis"
                  className="sm:col-span-2"
                  hint="Anamnesis, pemeriksaan, terapi yang sudah diberikan"
                >
                  <Textarea rows={3} value={f.ringkasan_klinis} onChange={(e) => setF({ ...f, ringkasan_klinis: e.target.value })} />
                </Field>
              </div>
            ) : null}

            {jenis === "keterangan_lain" ? (
              <div className="grid gap-3">
                <Field label="Perihal" required>
                  <Input value={f.perihal} onChange={(e) => setF({ ...f, perihal: e.target.value })} />
                </Field>
                <Field label="Isi Surat" required>
                  <Textarea rows={5} value={f.isi_bebas} onChange={(e) => setF({ ...f, isi_bebas: e.target.value })} />
                </Field>
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button variant="primary" onClick={simpan} disabled={proses}>
                <FileText />
                {proses ? "Menerbitkan…" : "Terbitkan & Cetak"}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Modal
        open={terbit !== null}
        onClose={() => { setTerbit(null); setKunjungan(null); }}
        title={terbit ? terbit.noSurat : ""}
        description="Periksa isinya sebelum mencetak. Nomor surat sudah terpakai dan tidak bisa dipakai ulang."
        size="lg"
        footer={
          <>
            <Button onClick={() => { setTerbit(null); setKunjungan(null); }}>Tutup</Button>
            <Button variant="primary" onClick={() => cetak()}>
              <Printer />
              Cetak
            </Button>
          </>
        }
      >
        {terbit ? <LembarSurat ref={lembarRef} {...terbit} /> : null}
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------

export function CetakUlang({ surat }: { surat: DataSurat }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cetak = useReactToPrint({ contentRef: ref, documentTitle: `Surat ${surat.noSurat}` });

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Printer />
        Cetak
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={surat.noSurat}
        size="lg"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Tutup</Button>
            <Button variant="primary" onClick={() => cetak()}>
              <Printer />
              Cetak
            </Button>
          </>
        }
      >
        <p className="mb-3 text-meta text-ink-muted">
          <Badge variant="neutral">Cetak ulang</Badge> Isi dan nomor surat tidak
          berubah — mencetak ulang tidak menerbitkan surat baru.
        </p>
        <LembarSurat ref={ref} {...surat} />
      </Modal>
    </>
  );
}
