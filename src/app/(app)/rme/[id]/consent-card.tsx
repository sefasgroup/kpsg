"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { FileSignature, Plus, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { formatTanggalPendek } from "@/lib/format";
import {
  JENIS_CONSENT,
  LABEL_JENIS_CONSENT,
  TEMPLAT_KLIEN,
} from "@/lib/consent-templat";
import { batalkanConsentAction, simpanConsentAction } from "./consent-actions";

export type ConsentTampil = {
  id: number;
  jenis: string;
  judul: string;
  isi: string;
  tindakan: string | null;
  pemberiPenjelasan: string | null;
  penandatangan: string;
  hubungan: string;
  saksi: string | null;
  status: string;
  alasanBatal: string | null;
  waktu: string;
};

export type OpsiTindakan = { id: number; nama: string };

/**
 * Persetujuan pasien pada layar pemeriksaan.
 *
 * Diletakkan di sini, bukan di layar pendaftaran, karena yang wajib
 * memberi penjelasan sebelum pasien menyetujui adalah tenaga medisnya —
 * dan `penjelasan_oleh` harus berisi orang yang benar-benar menjelaskan,
 * bukan petugas yang kebetulan mengetikkan formulirnya.
 *
 * Isi persetujuan diisi dari templat lalu **disimpan utuh**. Kalimat yang
 * ditandatangani pasien hari ini harus tetap terbaca sama meski templatnya
 * diubah tahun depan; itulah sebabnya `consents.isi` menyimpan teks, bukan
 * rujukan ke templat.
 */
export function ConsentCard({
  visitId,
  namaPasien,
  petugas,
  daftar,
  tindakan,
  boleh,
}: {
  visitId: number;
  namaPasien: string;
  /** Nama pengguna aktif — bawaan untuk "pemberi penjelasan". */
  petugas: string;
  daftar: ConsentTampil[];
  tindakan: OpsiTindakan[];
  boleh: boolean;
}) {
  const router = useRouter();
  const [proses, setProses] = useState(false);
  const [buka, setBuka] = useState(false);
  const [batalkan, setBatalkan] = useState<ConsentTampil | null>(null);
  const [alasan, setAlasan] = useState("");

  const [form, setForm] = useState(() => ({
    jenis: "umum" as (typeof JENIS_CONSENT)[number],
    judul: TEMPLAT_KLIEN.umum.judul,
    isi: TEMPLAT_KLIEN.umum.isi,
    procedure_id: "",
    penandatangan: namaPasien,
    hubungan: "Pasien sendiri",
    saksi_nama: "",
  }));

  function gantiJenis(jenis: (typeof JENIS_CONSENT)[number]) {
    const t = TEMPLAT_KLIEN[jenis];
    setForm((f) => ({ ...f, jenis, judul: t.judul, isi: t.isi }));
  }

  async function simpan() {
    setProses(true);
    try {
      const hasil = await simpanConsentAction({
        visit_id: visitId,
        jenis: form.jenis,
        judul: form.judul,
        isi: form.isi,
        procedure_id: form.procedure_id === "" ? null : Number(form.procedure_id),
        // Pemberi penjelasan SELALU pengguna aktif, tidak bisa dipilih.
        // Kalau bisa dipilih, kolom ini akan berisi nama siapa pun yang
        // kebetulan tampak paling pantas — bukan siapa yang menjelaskan.
        penjelasan_oleh: null,
        penandatangan: form.penandatangan,
        hubungan: form.hubungan,
        saksi_nama: form.saksi_nama,
        status: form.jenis === "penolakan" ? "menolak" : "setuju",
      });
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 8000 });
        return;
      }
      toast.success("Persetujuan tersimpan.");
      setBuka(false);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  async function jalankanBatal() {
    if (!batalkan) return;
    setProses(true);
    try {
      const hasil = await batalkanConsentAction(batalkan.id, alasan);
      if (!hasil.ok) {
        toast.error(hasil.error);
        return;
      }
      toast.success("Persetujuan ditandai tidak berlaku.");
      setBatalkan(null);
      setAlasan("");
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={FileSignature}>Persetujuan Pasien</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={daftar.length > 0 ? "brand" : "neutral"}>
            {daftar.length}
          </Badge>
          {boleh ? (
            <Button size="sm" onClick={() => setBuka(true)}>
              <Plus />
              Tambah
            </Button>
          ) : null}
        </div>
      </CardHeader>

      {daftar.length === 0 ? (
        <p className="text-meta text-ink-muted">
          Belum ada persetujuan tercatat untuk kunjungan ini. Persetujuan
          tindakan wajib diambil <strong>sebelum</strong> tindakannya
          dikerjakan — dokumen yang dibuat sesudahnya tidak menjawab apa pun
          bila kelak dipertanyakan.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {daftar.map((c) => (
            <li
              key={c.id}
              className={`rounded-md border border-line bg-surface-alt px-3 py-2 ${
                c.status === "dibatalkan" ? "opacity-60" : ""
              }`}
            >
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-body text-ink">
                    {c.judul}
                    {c.tindakan ? (
                      <span className="text-ink-muted"> — {c.tindakan}</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-meta text-ink-muted">
                    {c.penandatangan} ({c.hubungan}) ·{" "}
                    {formatTanggalPendek(c.waktu)}
                    {c.saksi ? ` · saksi ${c.saksi}` : ""}
                    {c.pemberiPenjelasan
                      ? ` · dijelaskan ${c.pemberiPenjelasan}`
                      : ""}
                  </p>
                  {c.alasanBatal ? (
                    <p className="mt-0.5 text-meta text-danger">
                      Tidak berlaku: {c.alasanBatal}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge
                    variant={
                      c.status === "setuju"
                        ? "success"
                        : c.status === "menolak"
                          ? "warning"
                          : "danger"
                    }
                  >
                    {c.status === "setuju"
                      ? "Setuju"
                      : c.status === "menolak"
                        ? "Menolak"
                        : "Dibatalkan"}
                  </Badge>
                  {boleh && c.status !== "dibatalkan" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setBatalkan(c)}
                      aria-label="Tandai tidak berlaku"
                    >
                      <Undo2 />
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={buka}
        onClose={() => setBuka(false)}
        title="Catat Persetujuan Pasien"
        description={`Ditandatangani untuk kunjungan ${namaPasien}`}
        size="lg"
        footer={
          <>
            <Button onClick={() => setBuka(false)} disabled={proses}>
              Batal
            </Button>
            <Button variant="primary" onClick={simpan} disabled={proses}>
              {proses ? "Menyimpan…" : "Simpan Persetujuan"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Jenis" required>
            <Select
              value={form.jenis}
              onChange={(e) =>
                gantiJenis(e.target.value as (typeof JENIS_CONSENT)[number])
              }
            >
              {JENIS_CONSENT.map((j) => (
                <option key={j} value={j}>
                  {LABEL_JENIS_CONSENT[j]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Tindakan"
            required={form.jenis === "tindakan"}
            hint={
              form.jenis === "tindakan"
                ? "Wajib — pasien tidak bisa menyetujui sesuatu yang tidak dinamai."
                : undefined
            }
          >
            <Select
              value={form.procedure_id}
              onChange={(e) => setForm({ ...form, procedure_id: e.target.value })}
            >
              <option value="">— tidak spesifik —</option>
              {tindakan.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nama}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Judul Dokumen" required className="sm:col-span-2">
            <Input
              value={form.judul}
              onChange={(e) => setForm({ ...form, judul: e.target.value })}
            />
          </Field>

          <Field
            label="Isi Persetujuan"
            required
            className="sm:col-span-2"
            hint="Terisi dari templat. Boleh disunting — yang tersimpan adalah kalimat ini apa adanya, bukan rujukan ke templatnya."
          >
            <Textarea
              value={form.isi}
              onChange={(e) => setForm({ ...form, isi: e.target.value })}
              className="min-h-32"
            />
          </Field>

          <Field label="Nama Penandatangan" required>
            <Input
              value={form.penandatangan}
              onChange={(e) => setForm({ ...form, penandatangan: e.target.value })}
            />
          </Field>
          <Field
            label="Hubungan dengan Pasien"
            required
            hint="Mis. Pasien sendiri, Ayah, Ibu, Wali"
          >
            <Input
              value={form.hubungan}
              onChange={(e) => setForm({ ...form, hubungan: e.target.value })}
            />
          </Field>
          <Field label="Nama Saksi" className="sm:col-span-2">
            <Input
              value={form.saksi_nama}
              onChange={(e) => setForm({ ...form, saksi_nama: e.target.value })}
            />
          </Field>

          <p className="rounded-md border border-info/25 bg-info-bg px-3 py-2 text-meta text-ink sm:col-span-2">
            Pemberi penjelasan dicatat sebagai <strong>{petugas}</strong> —
            pengguna yang sedang masuk. Kolom ini tidak bisa dipilih supaya
            isinya benar-benar orang yang menjelaskan, bukan nama yang tampak
            paling pantas.
          </p>
        </div>
      </Modal>

      <Modal
        open={batalkan !== null}
        onClose={() => setBatalkan(null)}
        title="Tandai persetujuan tidak berlaku?"
        description={batalkan?.judul}
        footer={
          <>
            <Button onClick={() => setBatalkan(null)} disabled={proses}>
              Tidak
            </Button>
            <Button
              variant="danger"
              onClick={jalankanBatal}
              disabled={proses || alasan.trim().length < 3}
            >
              {proses ? "Memproses…" : "Tandai Tidak Berlaku"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-body text-ink">
            Dokumennya <strong>tidak dihapus</strong>. Persetujuan yang pernah
            ditandatangani pasien adalah peristiwa yang benar-benar terjadi;
            yang bisa dilakukan hanyalah menyatakan bahwa ia tidak lagi
            berlaku, beserta sebabnya.
          </p>
          <Field label="Alasan" required>
            <Textarea value={alasan} onChange={(e) => setAlasan(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </Card>
  );
}
