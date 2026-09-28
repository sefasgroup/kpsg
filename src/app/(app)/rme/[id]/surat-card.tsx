"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useReactToPrint } from "react-to-print";
import toast from "react-hot-toast";
import { BedDouble, FileText, HeartPulse, Printer, ScrollText, Share2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { BUTA_WARNA, LABEL_BUTA_WARNA } from "@/lib/validations/dokumen";
import { terbitkanSuratAction } from "../../surat/actions";
import { CetakUlang } from "../../surat/surat-client";
import { LembarSurat, type DataSurat } from "../../surat/lembar-surat";

/**
 * Penerbitan surat keterangan langsung dari layar pemeriksaan.
 *
 * Diletakkan paling bawah karena mengikuti urutan kerja yang sebenarnya
 * (CLAUDE.md §3.1): diagnosa → tindakan → resep → surat. Surat adalah hal
 * terakhir yang dibuat dokter sebelum pasien meninggalkan ruang periksa.
 *
 * Kolom-kolomnya di balik modal, bukan terbuka permanen. Sebagian besar
 * kunjungan tidak memerlukan surat sama sekali; menampilkan tiga formulir
 * di setiap pemeriksaan hanya menambah kebisingan pada layar yang sudah
 * padat.
 *
 * Penerbitannya tetap lewat `terbitkanSuratAction` yang sama dengan menu
 * Surat Keterangan — SATU jalur, sehingga penjagaan "hanya dokter yang
 * menangani kunjungan ini" dan penomoran surat tidak punya dua versi yang
 * bisa berbeda diam-diam.
 */

const JENIS = [
  {
    nilai: "sakit",
    label: "Keterangan Sakit",
    hint: "Memuat lama istirahat",
    icon: BedDouble,
  },
  {
    nilai: "sehat",
    label: "Keterangan Sehat",
    hint: "Kerja, sekolah, SIM",
    icon: HeartPulse,
  },
  {
    nilai: "rujukan",
    label: "Rujukan",
    hint: "Ke faskes lanjutan",
    icon: Share2,
  },
] as const;

const JENIS_LABEL: Record<string, string> = {
  sakit: "Keterangan Sakit",
  sehat: "Keterangan Sehat",
  rujukan: "Rujukan",
  keterangan_lain: "Keterangan Lain",
};

const TONE: Record<string, "warning" | "success" | "info" | "neutral"> = {
  sakit: "warning",
  sehat: "success",
  rujukan: "info",
  keterangan_lain: "neutral",
};

export type PrefillSurat = {
  /** Diambil dari TTV perawat — dokter tidak perlu mengetik ulang. */
  tinggi_badan: string;
  berat_badan: string;
  tekanan_darah: string;
  /** Diagnosa ICD-10 kunjungan ini, dipakai sebagai placeholder. */
  diagnosa: string;
  /** S + O + A dirangkai, sebagai titik awal ringkasan klinis rujukan. */
  ringkasan_klinis: string;
};

export function SuratCard({
  visitId,
  klinik,
  dokter,
  gelar,
  noSip,
  hariIni,
  pasien,
  prefill,
  sudahTerbit,
  boleh,
  dokterPenanggung,
}: {
  visitId: number;
  klinik: DataSurat["klinik"];
  dokter: string;
  gelar: string | null;
  noSip: string | null;
  hariIni: string;
  pasien: DataSurat["pasien"];
  prefill: PrefillSurat;
  sudahTerbit: DataSurat[];
  /** Apakah pengguna ini yang menangani kunjungan tersebut. */
  boleh: boolean;
  dokterPenanggung: string;
}) {
  const router = useRouter();
  const [jenis, setJenis] = useState<string | null>(null);
  const [proses, setProses] = useState(false);
  const [terbit, setTerbit] = useState<DataSurat | null>(null);

  const [f, setF] = useState({
    mulai: hariIni,
    lama_hari: "2",
    diagnosa_ditulis: "",
    keperluan: "",
    tinggi_badan: prefill.tinggi_badan,
    berat_badan: prefill.berat_badan,
    tekanan_darah: prefill.tekanan_darah,
    gol_darah: "",
    buta_warna: "",
    tujuan_faskes: "",
    tujuan_bagian: "",
    alasan_rujukan: "",
    ringkasan_klinis: prefill.ringkasan_klinis,
  });

  const lembarRef = useRef<HTMLDivElement>(null);
  const cetak = useReactToPrint({
    contentRef: lembarRef,
    documentTitle: terbit ? `Surat ${terbit.noSurat}` : "Surat Keterangan",
  });

  async function simpan() {
    if (!jenis) return;
    setProses(true);
    try {
      const h = await terbitkanSuratAction({ ...f, visit_id: visitId, jenis });
      if (!h.ok) {
        toast.error(h.error, { duration: 7000 });
        return;
      }

      toast.success(`${h.data.no_surat} diterbitkan.`, { duration: 6000 });
      setTerbit({
        klinik,
        noSurat: h.data.no_surat,
        jenis,
        terbit: hariIni,
        pasien,
        dokter,
        gelar,
        noSip,
        data: { ...f },
      });
      setJenis(null);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle icon={ScrollText}>Surat Keterangan</CardTitle>
          <Link href="/surat" className="text-meta text-ink-muted hover:text-ink">
            Jenis surat lain →
          </Link>
        </CardHeader>

        {boleh ? (
          <>
            <p className="mb-2.5 text-meta text-ink-muted">
              Identitas pasien, dokter, dan kop cabang terisi otomatis dari
              kunjungan ini. Surat tetap bisa diterbitkan setelah pemeriksaan
              ditutup.
            </p>

            {!prefill.diagnosa ? (
              <p className="mb-2.5 rounded-md border border-warning/25 bg-warning-bg px-3 py-2 text-meta text-ink">
                Kunjungan ini belum punya diagnosa ICD-10. Surat tetap boleh
                terbit, tetapi surat sakit tanpa diagnosa sering ditolak oleh
                penerimanya.
              </p>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-3">
              {JENIS.map((j) => (
                <button
                  key={j.nilai}
                  type="button"
                  onClick={() => setJenis(j.nilai)}
                  className="flex items-center gap-2.5 rounded-md border border-line bg-surface-alt px-3 py-2.5 text-left transition-colors hover:border-brand-600 hover:bg-brand-50"
                >
                  <j.icon className="size-4 shrink-0 text-brand-700" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-body text-ink">{j.label}</span>
                    <span className="block truncate text-micro text-ink-faint">{j.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          /*
           * Tombolnya tidak ditampilkan sama sekali, bukan sekadar dinonaktifkan.
           * `terbitkanSurat()` memang akan menolaknya, tetapi penolakan itu baru
           * muncul setelah seluruh formulir diisi — dan alasan sebenarnya
           * (bukan Anda yang memeriksa) tidak terbaca dari tombol yang kelabu.
           */
          <p className="rounded-md border border-line bg-surface-alt px-3 py-2.5 text-meta text-ink-muted">
            Surat keterangan atas kunjungan ini hanya boleh diterbitkan oleh{" "}
            <strong className="text-ink">{dokterPenanggung}</strong> — dokter yang
            menanganinya. Anda tetap dapat membaca dan mencetak ulang surat yang
            sudah terbit.
          </p>
        )}

        {sudahTerbit.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-2.5">
            {sudahTerbit.map((s) => (
              <li key={s.noSurat} className="flex flex-wrap items-center gap-2">
                <Badge variant={TONE[s.jenis] ?? "neutral"}>
                  {JENIS_LABEL[s.jenis] ?? s.jenis}
                </Badge>
                <span className="font-mono text-meta text-ink-muted">{s.noSurat}</span>
                <span className="ml-auto">
                  <CetakUlang surat={s} />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {/* ---------- Formulir per jenis ---------- */}
      <Modal
        open={jenis !== null}
        onClose={() => setJenis(null)}
        title={jenis ? (JENIS_LABEL[jenis] ?? "Surat Keterangan") : ""}
        description={`${pasien.nama} · ${pasien.noRm}`}
        footer={
          <>
            <Button onClick={() => setJenis(null)}>Batal</Button>
            <Button variant="primary" onClick={simpan} disabled={proses}>
              <FileText />
              {proses ? "Menerbitkan…" : "Terbitkan & Cetak"}
            </Button>
          </>
        }
      >
        {jenis === "sakit" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mulai Istirahat" required>
              <Input
                type="date"
                value={f.mulai}
                onChange={(e) => setF({ ...f, mulai: e.target.value })}
              />
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
              className="sm:col-span-2"
              hint="Boleh dikosongkan bila pasien tidak ingin diagnosanya tercantum"
            >
              <Input
                value={f.diagnosa_ditulis}
                onChange={(e) => setF({ ...f, diagnosa_ditulis: e.target.value })}
                placeholder={prefill.diagnosa || "—"}
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
              <Input
                type="number"
                step="any"
                value={f.tinggi_badan}
                onChange={(e) => setF({ ...f, tinggi_badan: e.target.value })}
              />
            </Field>
            <Field label="Berat (kg)">
              <Input
                type="number"
                step="any"
                value={f.berat_badan}
                onChange={(e) => setF({ ...f, berat_badan: e.target.value })}
              />
            </Field>
            <Field label="Tekanan Darah">
              <Input
                value={f.tekanan_darah}
                onChange={(e) => setF({ ...f, tekanan_darah: e.target.value })}
                placeholder="120/80"
              />
            </Field>
            <Field label="Gol. Darah">
              <Select
                value={f.gol_darah}
                onChange={(e) => setF({ ...f, gol_darah: e.target.value })}
              >
                <option value="">—</option>
                {["A", "B", "AB", "O"].map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
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
            <p className="text-meta text-ink-faint sm:col-span-2 sm:self-end sm:pb-2">
              Tinggi, berat, dan tekanan darah terisi dari pengkajian perawat.
            </p>
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
              <Textarea
                rows={2}
                value={f.alasan_rujukan}
                onChange={(e) => setF({ ...f, alasan_rujukan: e.target.value })}
              />
            </Field>
            <Field
              label="Ringkasan Klinis"
              className="sm:col-span-2"
              hint="Terisi dari catatan SOAP — periksa dan sunting seperlunya"
            >
              <Textarea
                rows={4}
                value={f.ringkasan_klinis}
                onChange={(e) => setF({ ...f, ringkasan_klinis: e.target.value })}
              />
            </Field>
          </div>
        ) : null}
      </Modal>

      {/* ---------- Pratinjau setelah terbit ---------- */}
      <Modal
        open={terbit !== null}
        onClose={() => setTerbit(null)}
        title={terbit ? terbit.noSurat : ""}
        description="Nomor surat sudah terpakai dan tidak bisa dipakai ulang."
        size="lg"
        footer={
          <>
            <Button onClick={() => setTerbit(null)}>Tutup</Button>
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
