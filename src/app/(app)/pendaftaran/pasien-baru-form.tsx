"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import toast from "react-hot-toast";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import {
  PENDIDIKAN,
  STATUS_PERKAWINAN,
  patientSchema,
  type PatientFormValues,
  type PatientInput,
} from "@/lib/validations/patient";
import { buatPasienAction } from "./actions";

export function PasienBaruForm({
  open,
  onClose,
  nikAwal,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** NIK yang sudah diketik di kotak pencarian — langsung diisikan. */
  nikAwal?: string;
  onCreated: (pasien: { id: number; no_rm: string; nama: string }) => void;
}) {
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PatientFormValues, unknown, PatientInput>({
    resolver: zodResolver(patientSchema),
    defaultValues: {
      nik: /^\d{1,16}$/.test(nikAwal ?? "") ? nikAwal : "",
      jenis_pasien: "umum",
    },
  });

  async function onSubmit(values: PatientInput) {
    const hasil = await buatPasienAction(values);

    if (!hasil.ok) {
      if (hasil.field) {
        setError(hasil.field as keyof PatientFormValues, { message: hasil.error });
      }
      toast.error(hasil.error);
      return;
    }

    toast.success(`Pasien terdaftar — No. RM ${hasil.data.no_rm}`);
    onCreated({ ...hasil.data, nama: values.nama });
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Daftarkan Pasien Baru"
      description="NIK wajib dan tidak boleh ganda — menjadi kunci identitas pasien di seluruh cabang sekaligus syarat SatuSehat."
      footer={
        <>
          <Button type="button" onClick={onClose} disabled={isSubmitting}>
            Batal
          </Button>
          <Button
            type="submit"
            form="form-pasien-baru"
            variant="primary"
            disabled={isSubmitting}
          >
            <Save />
            {isSubmitting ? "Menyimpan…" : "Simpan Pasien"}
          </Button>
        </>
      }
    >
      <form
        id="form-pasien-baru"
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-5"
      >
        <section>
          <h3 className="mb-2.5 text-micro tracking-wide text-ink-faint uppercase">
            Identitas
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="NIK" required error={errors.nik?.message} hint="16 digit sesuai KTP">
              <Input
                inputMode="numeric"
                maxLength={16}
                placeholder="3201234567890001"
                aria-invalid={Boolean(errors.nik)}
                className="font-mono"
                {...register("nik")}
              />
            </Field>
            <Field label="No. Kartu Keluarga" error={errors.no_kk?.message}>
              <Input inputMode="numeric" maxLength={16} className="font-mono" {...register("no_kk")} />
            </Field>
            <Field
              label="Nama Lengkap"
              required
              error={errors.nama?.message}
              className="sm:col-span-2"
            >
              <Input aria-invalid={Boolean(errors.nama)} {...register("nama")} />
            </Field>
            <Field label="Tempat Lahir" error={errors.tempat_lahir?.message}>
              <Input {...register("tempat_lahir")} />
            </Field>
            <Field label="Tanggal Lahir" required error={errors.tanggal_lahir?.message}>
              <Input type="date" aria-invalid={Boolean(errors.tanggal_lahir)} {...register("tanggal_lahir")} />
            </Field>
            <Field label="Jenis Kelamin" required error={errors.jenis_kelamin?.message}>
              <Select defaultValue="" aria-invalid={Boolean(errors.jenis_kelamin)} {...register("jenis_kelamin")}>
                <option value="" disabled>Pilih…</option>
                <option value="L">Laki-laki</option>
                <option value="P">Perempuan</option>
              </Select>
            </Field>
            <Field label="Golongan Darah" error={errors.gol_darah?.message}>
              <Select defaultValue="" {...register("gol_darah")}>
                <option value="">Tidak diketahui</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="AB">AB</option>
                <option value="O">O</option>
              </Select>
            </Field>
            <Field label="Agama" error={errors.agama?.message}>
              <Select defaultValue="" {...register("agama")}>
                <option value="">—</option>
                <option>Islam</option>
                <option>Kristen</option>
                <option>Katolik</option>
                <option>Hindu</option>
                <option>Buddha</option>
                <option>Konghucu</option>
              </Select>
            </Field>
            {/*
              Urutannya mengikuti KTP: Agama -> Status Perkawinan -> Pekerjaan.
              Petugas menyalin sambil memegang kartunya, jadi mata bergerak
              turun di kartu dan turun di form pada saat yang sama — itu yang
              menekan salah salin. Pendidikan tidak ada di KTP tapi sepasang
              dengan Pekerjaan, jadi diletakkan tepat sebelumnya.
            */}
            <Field label="Status Perkawinan" error={errors.status_perkawinan?.message}>
              <Select defaultValue="" {...register("status_perkawinan")}>
                <option value="">—</option>
                {STATUS_PERKAWINAN.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label="Pendidikan Terakhir" error={errors.pendidikan?.message}>
              <Select defaultValue="" {...register("pendidikan")}>
                <option value="">—</option>
                {PENDIDIKAN.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
            </Field>
            <Field label="Pekerjaan" error={errors.pekerjaan?.message}>
              <Input {...register("pekerjaan")} />
            </Field>
          </div>
        </section>

        <section>
          <h3 className="mb-2.5 text-micro tracking-wide text-ink-faint uppercase">
            Alamat & Kontak
          </h3>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Alamat" error={errors.alamat?.message} className="sm:col-span-4">
              <Textarea rows={2} {...register("alamat")} />
            </Field>
            <Field label="RT" error={errors.rt?.message}>
              <Input inputMode="numeric" maxLength={5} {...register("rt")} />
            </Field>
            <Field label="RW" error={errors.rw?.message}>
              <Input inputMode="numeric" maxLength={5} {...register("rw")} />
            </Field>
            <Field label="Kelurahan" error={errors.kelurahan?.message}>
              <Input {...register("kelurahan")} />
            </Field>
            <Field label="Kecamatan" error={errors.kecamatan?.message}>
              <Input {...register("kecamatan")} />
            </Field>
            <Field label="Kota / Kabupaten" error={errors.kota?.message}>
              <Input {...register("kota")} />
            </Field>
            <Field label="Provinsi" error={errors.provinsi?.message}>
              <Input {...register("provinsi")} />
            </Field>
            <Field label="No. Telepon" error={errors.telepon?.message} className="sm:col-span-2">
              <Input inputMode="tel" placeholder="0812…" {...register("telepon")} />
            </Field>
          </div>
        </section>

        <section>
          <h3 className="mb-2.5 text-micro tracking-wide text-ink-faint uppercase">
            Penanggung Jawab & Penjaminan
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Nama Kontak Darurat" error={errors.pj_nama?.message}>
              <Input {...register("pj_nama")} />
            </Field>
            <Field label="Hubungan Dengan Pasien" error={errors.pj_hubungan?.message}>
              <Input placeholder="Suami / Istri / Anak…" {...register("pj_hubungan")} />
            </Field>
            <Field label="Telpon Kontak Darurat" error={errors.pj_telepon?.message}>
              <Input inputMode="tel" {...register("pj_telepon")} />
            </Field>
            <Field label="Status Penjamin" error={errors.jenis_pasien?.message}>
              <Select {...register("jenis_pasien")}>
                <option value="umum">Umum</option>
                <option value="bpjs">BPJS</option>
                <option value="asuransi">Asuransi</option>
                <option value="perusahaan">Perusahaan</option>
              </Select>
            </Field>
            <Field label="No. BPJS" error={errors.no_bpjs?.message} className="sm:col-span-2">
              <Input inputMode="numeric" className="font-mono" {...register("no_bpjs")} />
            </Field>
          </div>
        </section>
      </form>
    </Modal>
  );
}
