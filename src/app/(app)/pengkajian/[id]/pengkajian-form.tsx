"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import toast from "react-hot-toast";
import { Activity, HeartPulse, Ruler, Save, Syringe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import {
  nurseAssessmentSchemaFinal,
  type NurseAssessmentFormValues,
  type NurseAssessmentInput,
} from "@/lib/validations/nurse";
import type { AlergiRow } from "@/lib/nurse";
import { simpanPengkajianAction, tambahAlergiAction } from "../actions";
import { AlergiPanel } from "@/components/ui/alergi-panel";
import { BmhpPicker, type BarisBmhp } from "./bmhp-picker";

const TRIASE = [
  { value: "merah", label: "Merah", ket: "Gawat darurat", kelas: "border-triage-merah bg-triage-merah text-white" },
  { value: "kuning", label: "Kuning", ket: "Darurat", kelas: "border-triage-kuning bg-triage-kuning text-white" },
  { value: "hijau", label: "Hijau", ket: "Tidak gawat", kelas: "border-triage-hijau bg-triage-hijau text-white" },
  { value: "hitam", label: "Hitam", ket: "Meninggal", kelas: "border-triage-hitam bg-triage-hitam text-white" },
] as const;

/** Batas atas tiap komponen GCS — berbeda satu sama lain, bukan seragam. */
const GCS_MAKS = { e: 4, v: 5, m: 6 } as const;
const GCS_LABEL = { e: "Eye", v: "Verbal", m: "Motorik" } as const;

export function PengkajianForm({
  visitId,
  awal,
  bmhpAwal,
  adaAlergi,
  alergi,
}: {
  visitId: number;
  awal: Partial<NurseAssessmentFormValues>;
  bmhpAwal: BarisBmhp[];
  adaAlergi: boolean;
  alergi: AlergiRow[];
}) {
  const router = useRouter();
  const [bmhp, setBmhp] = useState<BarisBmhp[]>(bmhpAwal);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<NurseAssessmentFormValues, unknown, NurseAssessmentInput>({
    resolver: zodResolver(nurseAssessmentSchemaFinal),
    defaultValues: { triase: "hijau", status_alergi_dikonfirmasi: false, ...awal },
  });

  // IMT ditampilkan langsung agar perawat bisa mengoreksi salah ketik BB/TB
  // sebelum menyimpan. Nilai yang disimpan tetap dihitung oleh database.
  const bb = Number(useWatch({ control, name: "berat_badan" }));
  const tb = Number(useWatch({ control, name: "tinggi_badan" }));
  const imt = bb > 0 && tb > 0 ? bb / Math.pow(tb / 100, 2) : null;

  /*
   * Total GCS ditampilkan hidup saat mengetik supaya salah ketik langsung
   * terlihat. Nilai yang DISIMPAN tetap dihitung database dari ketiga
   * komponennya — total yang bisa dikirim klien bisa tidak cocok dengan
   * komponennya.
   */
  const gcsE = Number(useWatch({ control, name: "gcs_e" }));
  const gcsV = Number(useWatch({ control, name: "gcs_v" }));
  const gcsM = Number(useWatch({ control, name: "gcs_m" }));
  const gcsTotal =
    gcsE > 0 && gcsV > 0 && gcsM > 0 ? gcsE + gcsV + gcsM : null;
  const imtLabel =
    imt === null
      ? null
      : imt < 18.5
        ? "Kurang"
        : imt < 25
          ? "Normal"
          : imt < 30
            ? "Berlebih"
            : "Obesitas";

  async function onSubmit(values: NurseAssessmentInput) {
    const payload = {
      ...values,
      bmhp: bmhp.map((b) => ({
        item_id: b.item_id,
        nama: b.nama,
        satuan: b.satuan,
        harga_satuan: b.harga_satuan,
        qty: b.qty,
      })),
    };

    const hasil = await simpanPengkajianAction(visitId, payload);

    if (!hasil.ok) {
      toast.error(hasil.error, { duration: 6000 });
      return;
    }

    toast.success(
      hasil.data.totalBmhp > 0
        ? "Pengkajian tersimpan, stok BMHP dipotong dan biaya masuk tagihan."
        : "Pengkajian tersimpan. Pasien diteruskan ke dokter.",
    );
    router.push("/pengkajian");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle icon={Activity}>Triase & Keluhan</CardTitle>
        </CardHeader>

        <Field label="Triase" required error={errors.triase?.message}>
          <Controller
            control={control}
            name="triase"
            render={({ field }) => (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {TRIASE.map((t) => {
                  const aktif = field.value === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => field.onChange(t.value)}
                      aria-pressed={aktif}
                      className={`rounded-md border px-3 py-2.5 text-left transition-all ${
                        aktif
                          ? t.kelas
                          : "border-line bg-surface text-ink-muted hover:border-line-strong"
                      }`}
                    >
                      {/* Label teks selalu ada — warna tidak pernah jadi
                          satu-satunya pembawa makna (DESIGN-SYSTEM §7). */}
                      <span className="block text-body font-semibold">{t.label}</span>
                      <span className="block text-meta opacity-90">{t.ket}</span>
                    </button>
                  );
                })}
              </div>
            )}
          />
        </Field>

        {/*
          Dua baris, dua kolom. Baris 1 tentang KELUHAN SEKARANG dan penyakit
          lampau; baris 2 tentang apa yang sedang masuk ke tubuh pasien —
          obat dan alergen. Pengelompokan itu yang membuat perawat tidak
          perlu melompat-lompat saat mewawancarai pasien.
        */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Keluhan Utama" required error={errors.keluhan_utama?.message}>
            <Textarea
              rows={3}
              placeholder="Mis. demam sejak 3 hari, batuk berdahak…"
              aria-invalid={Boolean(errors.keluhan_utama)}
              {...register("keluhan_utama")}
            />
          </Field>
          <Field label="Riwayat Penyakit Dahulu" error={errors.riwayat_singkat?.message}>
            <Textarea
              rows={3}
              placeholder="Hipertensi sejak 2019, DM tipe 2…"
              {...register("riwayat_singkat")}
            />
          </Field>

          <Field label="Riwayat Pengobatan" error={errors.riwayat_pengobatan?.message}>
            <Textarea
              rows={3}
              placeholder="Obat yang sedang/baru diminum — Amlodipin 10 mg 1x1, jamu…"
              {...register("riwayat_pengobatan")}
            />
          </Field>

          {/*
            Alergi TIDAK berupa textarea. Ia melekat pada pasien lewat
            `patient_allergies` supaya terbaca dokter dan farmasi, serta
            terbawa ke kunjungan berikutnya. Lihat alergi-panel.tsx.
          */}
          <AlergiPanel visitId={visitId} awal={alergi} aksi={tambahAlergiAction} />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle icon={HeartPulse}>Tanda-Tanda Vital</CardTitle>
        </CardHeader>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Sistolik (mmHg)" error={errors.td_sistolik?.message}>
            <Input type="number" inputMode="numeric" placeholder="120" {...register("td_sistolik")} />
          </Field>
          <Field label="Diastolik (mmHg)" error={errors.td_diastolik?.message}>
            <Input type="number" inputMode="numeric" placeholder="80" {...register("td_diastolik")} />
          </Field>
          <Field label="Nadi (x/menit)" error={errors.nadi?.message}>
            <Input type="number" inputMode="numeric" placeholder="80" {...register("nadi")} />
          </Field>
          <Field label="Respirasi (x/menit)" error={errors.respirasi?.message}>
            <Input type="number" inputMode="numeric" placeholder="20" {...register("respirasi")} />
          </Field>
          <Field label="Suhu (°C)" error={errors.suhu?.message}>
            <Input type="number" step="0.1" placeholder="36.5" {...register("suhu")} />
          </Field>
          <Field label="SpO₂ (%)" error={errors.spo2?.message}>
            <Input type="number" inputMode="numeric" placeholder="98" {...register("spo2")} />
          </Field>
          <Field label="Kesadaran" error={errors.kesadaran?.message}>
            <Select defaultValue="" {...register("kesadaran")}>
              <option value="">—</option>
              <option value="compos_mentis">Compos Mentis</option>
              <option value="apatis">Apatis</option>
              <option value="somnolen">Somnolen</option>
              <option value="sopor">Sopor</option>
              <option value="koma">Koma</option>
            </Select>
          </Field>
          {/*
            Skala Nyeri sengaja di sini, bukan di akhir: ia mengisi kolom
            keempat yang tadinya kosong di sebelah Kesadaran, sehingga GCS
            dan kedua penilaian keadaan jatuh rapi pada baris berikutnya.
          */}
          <Field label="Skala Nyeri (0–10)" error={errors.skala_nyeri?.message}>
            <Input type="number" min={0} max={10} inputMode="numeric" {...register("skala_nyeri")} />
          </Field>

          {/*
            GCS bersebelahan dengan Kesadaran: keduanya menilai hal yang sama
            dari sudut berbeda — GCS angka yang bisa dibandingkan antar
            pemeriksaan, Kesadaran penilaian kualitatif. Lazim diisi bersama.

            Rentang tiap komponen BERBEDA (E 1-4, V 1-5, M 1-6) dan ditegakkan
            di validasi maupun di database.
          */}
          <Field
            label="GCS (E / V / M)"
            error={
              errors.gcs_e?.message ?? errors.gcs_v?.message ?? errors.gcs_m?.message
            }
            className="sm:col-span-2"
          >
            <div className="flex items-center gap-1.5">
              {(["e", "v", "m"] as const).map((k) => (
                <div key={k} className="flex items-center gap-1">
                  <span className="text-meta text-ink-muted uppercase">{k}</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={GCS_MAKS[k]}
                    className="w-14 text-center"
                    aria-label={`GCS ${GCS_LABEL[k]} (1-${GCS_MAKS[k]})`}
                    {...register(`gcs_${k}` as const)}
                  />
                </div>
              ))}
              <span
                className={`ml-1 rounded-sm px-1.5 py-0.5 text-meta tabular ${
                  gcsTotal === null
                    ? "text-ink-faint"
                    : gcsTotal <= 8
                      ? "bg-danger/10 font-medium text-danger"
                      : gcsTotal <= 12
                        ? "bg-warning/10 font-medium text-warning"
                        : "text-ink-muted"
                }`}
              >
                {/* Total ditulis lengkap dengan keterangannya — angka saja
                    tidak memberi tahu apa pun kepada yang belum hafal. */}
                {gcsTotal === null
                  ? "total —"
                  : `total ${gcsTotal}` +
                    (gcsTotal <= 8 ? " · berat" : gcsTotal <= 12 ? " · sedang" : " · ringan")}
              </span>
            </div>
          </Field>

          <Field label="Keadaan Umum" error={errors.keadaan_umum?.message}>
            <Select defaultValue="" {...register("keadaan_umum")}>
              <option value="">—</option>
              <option value="baik">Baik</option>
              <option value="sedang">Sedang</option>
              <option value="buruk">Buruk</option>
            </Select>
          </Field>
          <Field label="Keadaan Gizi" error={errors.keadaan_gizi?.message}>
            <Select defaultValue="" {...register("keadaan_gizi")}>
              <option value="">—</option>
              <option value="baik">Baik</option>
              <option value="kurang">Kurang</option>
              <option value="buruk">Buruk</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle icon={Ruler}>Antropometri & Skrining</CardTitle>
          {imt !== null ? (
            <span className="text-meta text-ink-muted">
              IMT{" "}
              <strong className="text-h2 text-brand-700 tabular">
                {imt.toFixed(1)}
              </strong>{" "}
              — {imtLabel}
            </span>
          ) : null}
        </CardHeader>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Berat Badan (kg)" error={errors.berat_badan?.message}>
            <Input type="number" step="0.1" placeholder="65" {...register("berat_badan")} />
          </Field>
          <Field label="Tinggi Badan (cm)" error={errors.tinggi_badan?.message}>
            <Input type="number" step="0.1" placeholder="170" {...register("tinggi_badan")} />
          </Field>
          <Field label="Lingkar Perut (cm)" error={errors.lingkar_perut?.message}>
            <Input type="number" step="0.1" {...register("lingkar_perut")} />
          </Field>
          <Field label="Risiko Jatuh" error={errors.risiko_jatuh?.message}>
            <Select defaultValue="" {...register("risiko_jatuh")}>
              <option value="">—</option>
              <option value="rendah">Rendah</option>
              <option value="sedang">Sedang</option>
              <option value="tinggi">Tinggi</option>
            </Select>
          </Field>
        </div>

        {adaAlergi ? (
          <label className="mt-3 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-bg px-3 py-2.5">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-(--color-danger)"
              {...register("status_alergi_dikonfirmasi")}
            />
            <span className="text-meta text-danger">
              Saya sudah mengonfirmasi riwayat alergi pasien secara lisan dan
              memastikannya masih berlaku.
            </span>
          </label>
        ) : null}

        <Field label="Catatan Perawat" error={errors.catatan?.message} className="mt-3">
          <Textarea rows={2} {...register("catatan")} />
        </Field>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle icon={Syringe}>Pemakaian BMHP</CardTitle>
        </CardHeader>
        <BmhpPicker value={bmhp} onChange={setBmhp} />
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" onClick={() => router.back()} disabled={isSubmitting}>
          Batal
        </Button>
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          <Save />
          {isSubmitting ? "Menyimpan…" : "Simpan & Teruskan ke Dokter"}
        </Button>
      </div>
    </form>
  );
}
