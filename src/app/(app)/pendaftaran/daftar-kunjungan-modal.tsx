"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import toast from "react-hot-toast";
import { TicketCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import {
  visitSchema,
  type VisitFormValues,
  type VisitInput,
} from "@/lib/validations/patient";
import { formatTanggal, hitungUmur } from "@/lib/format";
import { daftarkanKunjunganAction } from "./actions";

export type PasienTerpilih = {
  id: number;
  no_rm: string;
  nama: string;
  nik: string;
  tanggal_lahir: string;
  jenis_kelamin: "L" | "P";
  jenis_pasien: string;
  /** Penjamin bawaan pasien; jadi titik awal isian kunjungan. */
  payer_id: number | null;
  no_anggota: string | null;
  alergi: string | null;
};

export type OpsiPenjamin = { id: number; kode: string; nama: string };

export type Opsi = {
  id: number;
  nama: string;
  keterangan?: string | null;
  /** Dokter berhalangan tanpa pengganti — tidak bisa dipilih. */
  nonaktif?: boolean;
};

export function DaftarKunjunganModal({
  open,
  onClose,
  pasien,
  poliList,
  dokterList,
  penjamin,
  onRegistered,
}: {
  open: boolean;
  onClose: () => void;
  pasien: PasienTerpilih | null;
  poliList: Opsi[];
  dokterList: Opsi[];
  penjamin: OpsiPenjamin[];
  onRegistered: (hasil: { no_visit: string; antrean: string }) => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<VisitFormValues, unknown, VisitInput>({
    resolver: zodResolver(visitSchema),
    values: pasien
      ? {
          patient_id: pasien.id,
          poli_id: "",
          doctor_id: "",
          cara_bayar: (pasien.jenis_pasien as VisitInput["cara_bayar"]) ?? "umum",
          /*
           * Penjamin & nomor kepesertaan diambil dari data pasien sebagai
           * TITIK AWAL, lalu disalin ke kunjungan. Kepesertaan bisa berubah;
           * kunjungan yang sudah ditagihkan tidak boleh ikut berubah nanti.
           */
          payer_id: pasien.payer_id ?? null,
          no_anggota: pasien.no_anggota ?? "",
          rujukan_dari: "",
          didahulukan: false,
          alasan_didahulukan: "",
        }
      : undefined,
  });

  /*
   * `useWatch`, bukan `watch()`. Yang terakhir mengembalikan fungsi yang tidak
   * bisa dimemoisasi React Compiler, sehingga seluruh komponen ini dilewatkan
   * dari optimasinya — peringatan `react-hooks/incompatible-library`.
   */
  const didahulukan = useWatch({ control, name: "didahulukan" });
  const caraBayar = useWatch({ control, name: "cara_bayar" });
  const butuhPenjamin = caraBayar !== "umum";

  async function onSubmit(values: VisitInput) {
    const hasil = await daftarkanKunjunganAction(values);
    if (!hasil.ok) {
      toast.error(hasil.error);
      return;
    }
    toast.success(`Terdaftar — antrean ${hasil.data.antrean}`);
    onRegistered(hasil.data);
    reset();
    onClose();
  }

  if (!pasien) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Daftarkan Kunjungan"
      description="Pasien akan langsung masuk antrean dan menunggu pengkajian perawat."
      footer={
        <>
          <Button type="button" onClick={onClose} disabled={isSubmitting}>
            Batal
          </Button>
          <Button
            type="submit"
            form="form-kunjungan"
            variant="primary"
            disabled={isSubmitting}
          >
            <TicketCheck />
            {isSubmitting ? "Mendaftarkan…" : "Daftarkan & Ambil Antrean"}
          </Button>
        </>
      }
    >
      <div className="mb-4 rounded-md border border-line bg-surface-alt p-3">
        <p className="text-h2 text-ink">{pasien.nama}</p>
        <p className="mt-0.5 text-meta text-ink-muted">
          <span className="font-mono">{pasien.no_rm}</span> ·{" "}
          {pasien.jenis_kelamin === "L" ? "Laki-laki" : "Perempuan"} ·{" "}
          {hitungUmur(pasien.tanggal_lahir)} tahun ·{" "}
          {formatTanggal(pasien.tanggal_lahir)}
        </p>
        <p className="mt-0.5 font-mono text-meta text-ink-faint">NIK {pasien.nik}</p>

        {/* Pita alergi tidak bisa ditutup — DESIGN-SYSTEM §3.1 */}
        {pasien.alergi ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-md border border-danger/25 bg-danger-bg px-2.5 py-1.5 text-meta text-danger">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              <strong>Alergi:</strong> {pasien.alergi}
            </span>
          </p>
        ) : null}
      </div>

      <form
        id="form-kunjungan"
        onSubmit={handleSubmit(onSubmit)}
        className="grid gap-3 sm:grid-cols-2"
      >
        <Input type="hidden" {...register("patient_id")} />

        <Field label="Poli Tujuan" required error={errors.poli_id?.message}>
          <Select defaultValue="" aria-invalid={Boolean(errors.poli_id)} {...register("poli_id")}>
            <option value="" disabled>Pilih poli…</option>
            {poliList.map((p) => (
              <option key={p.id} value={p.id}>{p.nama}</option>
            ))}
          </Select>
        </Field>

        <Field label="Dokter" required error={errors.doctor_id?.message}>
          <Select defaultValue="" aria-invalid={Boolean(errors.doctor_id)} {...register("doctor_id")}>
            <option value="" disabled>Pilih dokter…</option>
            {dokterList.map((d) => (
              <option key={d.id} value={d.id} disabled={d.nonaktif}>
                {d.nama}
                {d.keterangan ? ` — ${d.keterangan}` : ""}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Cara Bayar" required error={errors.cara_bayar?.message}>
          <Select {...register("cara_bayar")}>
            <option value="umum">Umum</option>
            <option value="bpjs">BPJS</option>
            <option value="asuransi">Asuransi</option>
            <option value="perusahaan">Perusahaan</option>
          </Select>
        </Field>

        {/*
          Pemilih penjamin muncul HANYA bila cara bayarnya bukan umum.
          Menampilkannya selalu akan membuat petugas mengisinya untuk pasien
          tunai juga — dan tagihan pasien tunai yang bertanda penjamin akan
          ikut masuk kandidat klaim.
        */}
        {butuhPenjamin ? (
          <>
            <Field
              label="Penjamin"
              required
              error={errors.payer_id?.message}
              hint={
                penjamin.length === 0
                  ? "Belum ada penjamin terdaftar — minta Super Admin menambahkannya."
                  : "Menentukan ke siapa tagihan ini nanti ditagihkan."
              }
            >
              <Select {...register("payer_id")} disabled={penjamin.length === 0}>
                <option value="">Pilih penjamin…</option>
                {penjamin.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nama} ({p.kode})
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="No. Kartu / Peserta"
              error={errors.no_anggota?.message}
              hint="Tercetak di berkas klaim."
            >
              <Input placeholder="No. kartu peserta…" {...register("no_anggota")} />
            </Field>
          </>
        ) : null}

        <Field label="Rujukan Dari" error={errors.rujukan_dari?.message} hint="Kosongkan bila datang sendiri">
          <Input placeholder="Puskesmas / klinik lain…" {...register("rujukan_dari")} />
        </Field>

        {/*
          Penanda urgensi. Sengaja diletakkan PALING BAWAH dan tidak menonjol:
          ini pengecualian, bukan isian rutin. Penanda yang gampang tercentang
          akan dipakai berlebihan, dan antrean yang semua orangnya "didahulukan"
          sama saja dengan antrean biasa.
        */}
        <div className="sm:col-span-2 rounded-md border border-line bg-surface-alt px-3 py-2.5">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--color-danger)]"
              {...register("didahulukan")}
            />
            <span className="text-meta">
              <span className="text-ink">Perlu didahulukan</span>
              <span className="block text-micro text-ink-faint">
                Kondisi pasien terlihat tidak bisa menunggu antrean. Ini bukan
                triase — penilaian klinis tetap dilakukan perawat.
              </span>
            </span>
          </label>

          {didahulukan ? (
            <div className="mt-2.5">
              <Field
                label="Alasan"
                required
                error={errors.alasan_didahulukan?.message}
                hint="Dibaca perawat sebelum memanggil"
              >
                <Input
                  autoFocus
                  placeholder="mis. Sesak napas, tampak pucat"
                  aria-invalid={Boolean(errors.alasan_didahulukan)}
                  {...register("alasan_didahulukan")}
                />
              </Field>
            </div>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
