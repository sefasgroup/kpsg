"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  FileImage, FileText, Paperclip, Trash2, Upload, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { formatJam, formatTanggalPendek } from "@/lib/format";
import {
  hapusDokumenAction, ubahKeteranganDokumenAction, unggahDokumenAction,
} from "../actions";

/**
 * Dokumen pendukung rekam medis — hasil USG dari luar, rontgen, rujukan
 * balik, hasil lab laboratorium lain.
 *
 * Diletakkan setelah Laboratorium dan sebelum E-Resep: keduanya sama-sama
 * bukti penunjang yang mendasari tatalaksana, jadi dokter membacanya
 * berurutan sebelum meresepkan.
 *
 * Berkasnya TIDAK pernah dibuka lewat URL langsung — hanya lewat
 * `/api/berkas/…` yang memeriksa sesi dan hak akses per berkas.
 */

const MAKS = 10;

/*
 * Batas TOTAL satu kali unggah, dijaga lebih rendah dari
 * `serverActions.bodySizeLimit` (25 MB) di next.config.ts.
 *
 * Bila batas server yang lebih dulu tercapai, permintaannya ditolak sebelum
 * kode kita berjalan sama sekali — dokter hanya melihat galat tanpa
 * penjelasan. Ditolak di sini, ia langsung tahu harus mengunggah bertahap.
 */
const MAKS_TOTAL_BYTES = 20 * 1024 * 1024;

export type DokumenTampil = {
  id: number;
  kunci: string;
  nama_asli: string;
  keterangan: string | null;
  mime: string;
  ukuran: number;
  created_at: string;
  pengunggah: string;
};

type Antre = { file: File; keterangan: string };

export function DokumenCard({
  visitId,
  dokumen,
  maksBytes,
}: {
  visitId: number;
  dokumen: DokumenTampil[];
  maksBytes: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [antre, setAntre] = useState<Antre[]>([]);
  const [proses, setProses] = useState(false);
  const [sunting, setSunting] = useState<{ id: number; teks: string } | null>(null);

  const maksMb = Math.round(maksBytes / 1024 / 1024);

  const totalAntre = antre.reduce((n, a) => n + a.file.size, 0);
  const kebesaran = totalAntre > MAKS_TOTAL_BYTES;

  function pilih(files: FileList | null) {
    if (!files || files.length === 0) return;

    /*
     * Ukuran per berkas diperiksa di sini JUGA, bukan hanya di server.
     * Membiarkannya lolos berarti dokter menunggu 5 MB terkirim hanya untuk
     * ditolak — pemeriksaan server tetap ada karena yang di sini bisa
     * dilewati, tetapi yang di sini yang menghemat waktunya.
     */
    const terlaluBesar = Array.from(files).filter((f) => f.size > maksBytes);
    for (const f of terlaluBesar) {
      toast.error(`${f.name} berukuran ${ukuran(f.size)} — melebihi ${maksMb} MB.`, {
        duration: 8000,
      });
    }

    const tambahan = Array.from(files)
      .filter((f) => f.size <= maksBytes)
      .map((file) => ({ file, keterangan: "" }));
    const gabungan = [...antre, ...tambahan];

    if (gabungan.length > MAKS) {
      toast.error(`Maksimal ${MAKS} dokumen sekali unggah.`);
    }
    setAntre(gabungan.slice(0, MAKS));

    // Direset supaya memilih berkas yang SAMA dua kali tetap memicu onChange.
    if (inputRef.current) inputRef.current.value = "";
  }

  async function unggah() {
    if (antre.length === 0) return;
    setProses(true);
    try {
      const form = new FormData();
      antre.forEach((a, i) => {
        form.append(`berkas${i}`, a.file);
        form.append(`keterangan${i}`, a.keterangan);
      });

      const h = await unggahDokumenAction(visitId, form);
      if (!h.ok) {
        toast.error(h.error, { duration: 7000 });
        return;
      }

      const { tersimpan, ditolak } = h.data;
      if (tersimpan > 0) {
        toast.success(`${tersimpan} dokumen terunggah.`);
      }
      /*
       * Berkas yang ditolak dilaporkan satu per satu beserta alasannya.
       * "Sebagian gagal" tanpa menyebut yang mana membuat dokter mengunggah
       * ulang seluruhnya — termasuk yang sebenarnya sudah berhasil.
       */
      for (const d of ditolak) {
        toast.error(`${d.nama}: ${d.alasan}`, { duration: 9000 });
      }

      setAntre(ditolak.length > 0 ? antre.filter((a) => ditolak.some((d) => d.nama === a.file.name)) : []);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  async function simpanKeterangan() {
    if (!sunting) return;
    setProses(true);
    try {
      const h = await ubahKeteranganDokumenAction(visitId, sunting.id, sunting.teks);
      if (!h.ok) { toast.error(h.error); return; }
      setSunting(null);
      toast.success("Keterangan diperbarui.");
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  async function hapus(id: number, nama: string) {
    setProses(true);
    try {
      const h = await hapusDokumenAction(visitId, id);
      if (!h.ok) { toast.error(h.error); return; }
      toast.success(`${nama} dihapus dari pemeriksaan ini.`);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={Paperclip}>Dokumen Pendukung</CardTitle>
        <span className="text-meta text-ink-faint">
          PDF/JPG/PNG · maks {maksMb} MB · {MAKS} berkas sekali unggah
        </span>
      </CardHeader>

      <p className="mb-2.5 text-meta text-ink-muted">
        Hasil pemeriksaan dari luar klinik — USG, rontgen, hasil lab
        laboratorium lain, atau rujukan balik. Dokumen menempel pada kunjungan
        ini dan hanya bisa dibuka oleh dokter.
      </p>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={(e) => pilih(e.target.files)}
      />

      <div>
        <Button type="button" onClick={() => inputRef.current?.click()} disabled={proses}>
          <Paperclip />
          Pilih Berkas
        </Button>
      </div>

      {/* ---------- Antrean unggah: keterangan diisi sebelum dikirim ---------- */}
      {antre.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1.5 rounded-md border border-dashed border-line p-2.5">
          {antre.map((a, i) => (
            <div key={`${a.file.name}-${i}`} className="flex flex-wrap items-center gap-2">
              <Ikon mime={a.file.type} />
              <span className="min-w-0 flex-1 basis-40 truncate text-meta text-ink">
                {a.file.name}
                <span className="ml-1.5 text-ink-faint">{ukuran(a.file.size)}</span>
              </span>
              <Input
                className="h-8 flex-1 basis-64"
                value={a.keterangan}
                maxLength={255}
                placeholder="Keterangan — mis. Hasil USG abdomen 1 Agu"
                onChange={(e) =>
                  setAntre(antre.map((x, j) => (j === i ? { ...x, keterangan: e.target.value } : x)))
                }
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Batalkan ${a.file.name}`}
                onClick={() => setAntre(antre.filter((_, j) => j !== i))}
                disabled={proses}
              >
                <X />
              </Button>
            </div>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className={`text-meta ${kebesaran ? "text-danger" : "text-ink-faint"}`}>
              Total {ukuran(totalAntre)}
              {kebesaran
                ? ` — melebihi ${Math.round(MAKS_TOTAL_BYTES / 1024 / 1024)} MB sekali kirim. Unggah bertahap.`
                : ""}
            </span>
            <Button variant="primary" onClick={unggah} disabled={proses || kebesaran}>
              <Upload />
              {proses ? "Mengunggah…" : `Unggah ${antre.length} Dokumen`}
            </Button>
          </div>
        </div>
      ) : null}

      {/* ---------- Sudah terunggah ---------- */}
      {dokumen.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-line px-3 py-6 text-center text-meta text-ink-faint">
          Belum ada dokumen pendukung pada kunjungan ini.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-2.5">
          {dokumen.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-alt"
            >
              <Ikon mime={d.mime} />

              {sunting?.id === d.id ? (
                <>
                  <Input
                    className="h-8 min-w-0 flex-1 basis-64"
                    value={sunting.teks}
                    maxLength={255}
                    autoFocus
                    onChange={(e) => setSunting({ id: d.id, teks: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") simpanKeterangan();
                      if (e.key === "Escape") setSunting(null);
                    }}
                  />
                  <Button size="sm" variant="primary" onClick={simpanKeterangan} disabled={proses}>
                    Simpan
                  </Button>
                  <Button size="sm" onClick={() => setSunting(null)} disabled={proses}>
                    Batal
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 basis-52">
                    <a
                      href={`/api/berkas/${d.kunci}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-body text-brand-700 hover:underline"
                    >
                      {d.keterangan || d.nama_asli}
                    </a>
                    <span className="block truncate text-micro text-ink-faint">
                      {d.keterangan ? `${d.nama_asli} · ` : ""}
                      {ukuran(d.ukuran)} · {d.pengunggah} ·{" "}
                      {formatTanggalPendek(d.created_at)} {formatJam(d.created_at)}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSunting({ id: d.id, teks: d.keterangan ?? "" })}
                    disabled={proses}
                  >
                    {d.keterangan ? "Ubah keterangan" : "Beri keterangan"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Hapus ${d.nama_asli}`}
                    onClick={() => hapus(d.id, d.nama_asli)}
                    disabled={proses}
                  >
                    <Trash2 />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Ikon({ mime }: { mime: string }) {
  const Comp = mime === "application/pdf" ? FileText : FileImage;
  return <Comp className="size-4 shrink-0 text-ink-faint" aria-hidden />;
}

function ukuran(byte: number): string {
  if (byte < 1024) return `${byte} B`;
  if (byte < 1024 * 1024) return `${Math.round(byte / 1024)} KB`;
  return `${(byte / 1024 / 1024).toFixed(1)} MB`;
}
