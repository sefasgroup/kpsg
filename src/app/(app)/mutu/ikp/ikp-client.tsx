"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Plus, ShieldAlert, Stethoscope } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import {
  GRADING_IKP,
  JENIS_IKP,
  LABEL_GRADING_IKP,
  LABEL_JENIS_IKP,
  LABEL_STATUS_IKP,
  STATUS_IKP,
} from "@/lib/validations/kepatuhan";
import { laporkanIkpAction, tindakLanjutIkpAction } from "./actions";

export type BarisIkp = {
  id: number;
  noIkp: string;
  tanggal: string;
  waktu: string | null;
  lokasi: string;
  jenis: string;
  grading: string | null;
  kronologi: string;
  dampak: string | null;
  tindakanSegera: string | null;
  analisis: string | null;
  rekomendasi: string | null;
  status: string;
  pelapor: string | null;
  pasien: string | null;
  noRm: string | null;
};

const WARNA_GRADING: Record<string, "info" | "success" | "warning" | "danger"> = {
  biru: "info",
  hijau: "success",
  kuning: "warning",
  merah: "danger",
};

export function IkpClient({
  daftar,
  bolehTindakLanjut,
  hariIni,
}: {
  daftar: BarisIkp[];
  /** Grading, RCA, dan penutupan adalah wewenang Admin Cabang. */
  bolehTindakLanjut: boolean;
  hariIni: string;
}) {
  const router = useRouter();
  const [proses, setProses] = useState(false);
  const [lapor, setLapor] = useState(false);
  const [tindak, setTindak] = useState<BarisIkp | null>(null);

  const [form, setForm] = useState({
    tanggal: hariIni,
    waktu: "",
    lokasi: "",
    jenis: "knc",
    kronologi: "",
    dampak: "",
    tindakan_segera: "",
    anonim: false,
  });

  const [tl, setTl] = useState({
    grading: "hijau",
    analisis: "",
    rekomendasi: "",
    status: "investigasi",
  });

  async function kirimLaporan() {
    setProses(true);
    try {
      const hasil = await laporkanIkpAction({ ...form, visit_id: null });
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 8000 });
        return;
      }
      toast.success(`Laporan ${hasil.data.noIkp} tersimpan. Terima kasih sudah melapor.`);
      setLapor(false);
      setForm({
        tanggal: hariIni, waktu: "", lokasi: "", jenis: "knc",
        kronologi: "", dampak: "", tindakan_segera: "", anonim: false,
      });
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  async function kirimTindakLanjut() {
    if (!tindak) return;
    setProses(true);
    try {
      const hasil = await tindakLanjutIkpAction(tindak.id, tl);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 9000 });
        return;
      }
      toast.success("Tindak lanjut tersimpan.");
      setTindak(null);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  function bukaTindak(b: BarisIkp) {
    setTl({
      grading: b.grading ?? "hijau",
      analisis: b.analisis ?? "",
      rekomendasi: b.rekomendasi ?? "",
      status: b.status === "baru" ? "investigasi" : b.status,
    });
    setTindak(b);
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta text-ink-muted">
          Melaporkan insiden <strong>bukan pengakuan kesalahan</strong>. Yang
          dicari adalah penyebab yang bisa diperbaiki — bukan orang yang bisa
          disalahkan.
        </p>
        <Button variant="primary" onClick={() => setLapor(true)}>
          <Plus />
          Lapor Insiden
        </Button>
      </div>

      {daftar.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-5 py-11 text-center text-meta text-ink-muted">
          Belum ada insiden dilaporkan pada periode ini.
          <span className="mt-1 block text-ink-faint">
            Nol laporan bukan tentu kabar baik: klinik yang tidak pernah
            melaporkan apa pun biasanya bukan klinik tanpa insiden, melainkan
            klinik yang belum merasa aman untuk melapor.
          </span>
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {daftar.map((b) => (
            <li
              key={b.id}
              className="rounded-md border border-line bg-surface-alt px-3 py-2.5"
            >
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-body text-ink">
                    <span className="font-mono text-meta text-ink-muted">{b.noIkp}</span>{" "}
                    · {b.lokasi} · {b.tanggal.slice(0, 10)}
                    {b.waktu ? ` ${b.waktu.slice(0, 5)}` : ""}
                  </p>
                  <p className="mt-0.5 text-meta text-ink-muted">
                    {LABEL_JENIS_IKP[b.jenis as keyof typeof LABEL_JENIS_IKP] ?? b.jenis}
                    {b.pasien ? ` · ${b.pasien} (${b.noRm})` : ""}
                    {b.pelapor ? ` · dilaporkan ${b.pelapor}` : " · pelaporan anonim"}
                  </p>
                  <p className="mt-1 text-meta text-ink">{b.kronologi}</p>
                  {b.tindakanSegera ? (
                    <p className="mt-0.5 text-meta text-ink-muted">
                      <strong>Tindakan segera:</strong> {b.tindakanSegera}
                    </p>
                  ) : null}
                  {b.analisis ? (
                    <p className="mt-0.5 text-meta text-ink-muted">
                      <strong>Akar masalah:</strong> {b.analisis}
                    </p>
                  ) : null}
                  {b.rekomendasi ? (
                    <p className="mt-0.5 text-meta text-ink-muted">
                      <strong>Rekomendasi:</strong> {b.rekomendasi}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col items-end gap-1">
                  {b.grading ? (
                    <Badge variant={WARNA_GRADING[b.grading] ?? "neutral"}>
                      {b.grading.toUpperCase()}
                    </Badge>
                  ) : (
                    <Badge variant="warning">belum digrading</Badge>
                  )}
                  <Badge variant={b.status === "ditutup" ? "success" : "neutral"}>
                    {LABEL_STATUS_IKP[b.status as keyof typeof LABEL_STATUS_IKP] ??
                      b.status}
                  </Badge>
                  {bolehTindakLanjut && b.status !== "ditutup" ? (
                    <Button size="sm" onClick={() => bukaTindak(b)}>
                      Tindak Lanjut
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ---------- Formulir pelaporan ---------- */}
      <Modal
        open={lapor}
        onClose={() => setLapor(false)}
        title="Laporkan Insiden Keselamatan Pasien"
        description="Laporan boleh dibuat siapa pun yang melihat kejadiannya."
        size="lg"
        footer={
          <>
            <Button onClick={() => setLapor(false)} disabled={proses}>
              Batal
            </Button>
            <Button variant="primary" onClick={kirimLaporan} disabled={proses}>
              {proses ? "Menyimpan…" : "Kirim Laporan"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tanggal Kejadian" required>
            <Input
              type="date" max={hariIni} value={form.tanggal}
              onChange={(e) => setForm({ ...form, tanggal: e.target.value })}
            />
          </Field>
          <Field label="Waktu (perkiraan)">
            <Input
              type="time" value={form.waktu}
              onChange={(e) => setForm({ ...form, waktu: e.target.value })}
            />
          </Field>
          <Field label="Lokasi" required className="sm:col-span-2">
            <Input
              value={form.lokasi}
              onChange={(e) => setForm({ ...form, lokasi: e.target.value })}
              placeholder="Mis. Ruang Tindakan, Apotek, Ruang Tunggu"
            />
          </Field>
          <Field
            label="Jenis Insiden"
            required
            className="sm:col-span-2"
            hint="KPC = kondisi berbahaya yang belum menimpa siapa pun · KNC = nyaris · KTC = terpapar tetapi tidak cedera · KTD = cedera terjadi"
          >
            <Select
              value={form.jenis}
              onChange={(e) => setForm({ ...form, jenis: e.target.value })}
            >
              {JENIS_IKP.map((j) => (
                <option key={j} value={j}>
                  {LABEL_JENIS_IKP[j]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Kronologi"
            required
            className="sm:col-span-2"
            hint="Tuliskan urutan kejadiannya. Laporan satu baris tidak bisa dianalisis, dan insiden yang tidak bisa dianalisis tidak mencegah insiden berikutnya."
          >
            <Textarea
              value={form.kronologi}
              onChange={(e) => setForm({ ...form, kronologi: e.target.value })}
              className="min-h-28"
            />
          </Field>
          <Field label="Dampak pada Pasien">
            <Textarea
              value={form.dampak}
              onChange={(e) => setForm({ ...form, dampak: e.target.value })}
            />
          </Field>
          <Field label="Tindakan yang Sudah Dilakukan">
            <Textarea
              value={form.tindakan_segera}
              onChange={(e) => setForm({ ...form, tindakan_segera: e.target.value })}
            />
          </Field>

          <label className="flex items-start gap-2 rounded-md border border-line bg-surface-alt px-3 py-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={form.anonim}
              onChange={(e) => setForm({ ...form, anonim: e.target.checked })}
              className="mt-0.5 size-4 shrink-0"
            />
            <span className="text-meta text-ink">
              <strong>Laporkan tanpa nama saya.</strong>
              <span className="mt-0.5 block text-ink-muted">
                Nama Anda tidak akan tersimpan pada laporannya. Jejaknya tetap ada
                di log audit yang hanya bisa dibuka Super Admin — itu penjaga agar
                jalur anonim tidak dipakai membuat laporan palsu.
              </span>
            </span>
          </label>
        </div>
      </Modal>

      {/* ---------- Tindak lanjut ---------- */}
      <Modal
        open={tindak !== null}
        onClose={() => setTindak(null)}
        title="Tindak Lanjut Insiden"
        description={tindak?.noIkp}
        size="lg"
        footer={
          <>
            <Button onClick={() => setTindak(null)} disabled={proses}>
              Batal
            </Button>
            <Button variant="primary" onClick={kirimTindakLanjut} disabled={proses}>
              {proses ? "Menyimpan…" : "Simpan"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Grading Risiko" required>
            <Select
              value={tl.grading}
              onChange={(e) => setTl({ ...tl, grading: e.target.value })}
            >
              {GRADING_IKP.map((g) => (
                <option key={g} value={g}>
                  {LABEL_GRADING_IKP[g]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" required>
            <Select
              value={tl.status}
              onChange={(e) => setTl({ ...tl, status: e.target.value })}
            >
              {STATUS_IKP.filter((s) => s !== "baru").map((s) => (
                <option key={s} value={s}>
                  {LABEL_STATUS_IKP[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Analisis Akar Masalah (RCA)"
            className="sm:col-span-2"
            hint="Wajib untuk grading kuning dan merah sebelum laporan boleh ditutup."
            required={tl.grading === "kuning" || tl.grading === "merah"}
          >
            <Textarea
              value={tl.analisis}
              onChange={(e) => setTl({ ...tl, analisis: e.target.value })}
              className="min-h-28"
              placeholder="Mengapa hal ini bisa terjadi? Apa yang memungkinkannya?"
            />
          </Field>
          <Field label="Rekomendasi Perbaikan" className="sm:col-span-2">
            <Textarea
              value={tl.rekomendasi}
              onChange={(e) => setTl({ ...tl, rekomendasi: e.target.value })}
            />
          </Field>

          {tindak ? (
            <div className="rounded-md border border-line bg-surface-alt px-3 py-2 sm:col-span-2">
              <p className="flex items-center gap-1.5 text-label text-ink-muted">
                <Stethoscope className="size-3.5" aria-hidden />
                Kronologi yang dilaporkan
              </p>
              <p className="mt-1 text-meta text-ink">{tindak.kronologi}</p>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

export { ShieldAlert };
