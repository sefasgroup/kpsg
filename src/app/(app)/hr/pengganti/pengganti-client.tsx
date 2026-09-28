"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Check, CalendarPlus, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { JENIS_PENGECUALIAN_LABEL } from "@/lib/validations/hr";
import {
  putuskanPengecualianAction,
  tambahPengecualianAction,
} from "../actions";

export type DokterOpsi = { id: number; nama: string };

export function TambahPengecualian({
  dokter,
  hariIni,
}: {
  dokter: DokterOpsi[];
  hariIni: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [proses, setProses] = useState(false);
  const [form, setForm] = useState({
    doctor_id: "",
    tanggal: hariIni,
    jenis: "cuti",
    substitute_doctor_id: "",
    jam_mulai: "",
    jam_selesai: "",
    alasan: "",
  });

  // Pengganti hanya relevan bila dokternya berhalangan; `tambahan` justru
  // menambah jadwal, dan `ganti_jam` hanya menggeser jamnya.
  const butuhPengganti = ["libur", "cuti", "izin", "sakit"].includes(form.jenis);
  const gantiJam = form.jenis === "ganti_jam";

  async function simpan() {
    setProses(true);
    try {
      const hasil = await tambahPengecualianAction(form);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 6000 });
        return;
      }
      toast.success("Pengecualian jadwal tersimpan, menunggu persetujuan.");
      setOpen(false);
      setForm({ ...form, doctor_id: "", substitute_doctor_id: "", alasan: "" });
      router.refresh();
    } catch {
      toast.error("Gagal menghubungi server. Periksa koneksi lalu coba lagi.");
    } finally {
      setProses(false);
    }
  }

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <CalendarPlus />
        Tetapkan Pengganti
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Pengecualian Jadwal & Dokter Pengganti"
        description="Dokter yang berhalangan akan hilang dari daftar pilihan di layar pendaftaran begitu pengecualian ini disetujui."
        footer={
          <>
            <Button type="button" onClick={() => setOpen(false)} disabled={proses}>
              Batal
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={simpan}
              disabled={proses || !form.doctor_id}
            >
              {proses ? "Menyimpan…" : "Simpan"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dokter yang Berhalangan" required>
            <Select
              value={form.doctor_id}
              onChange={(e) => setForm({ ...form, doctor_id: e.target.value })}
            >
              <option value="">Pilih dokter…</option>
              {dokter.map((d) => (
                <option key={d.id} value={d.id}>{d.nama}</option>
              ))}
            </Select>
          </Field>

          <Field label="Tanggal" required>
            <Input
              type="date"
              value={form.tanggal}
              onChange={(e) => setForm({ ...form, tanggal: e.target.value })}
            />
          </Field>

          <Field label="Jenis" required>
            <Select
              value={form.jenis}
              onChange={(e) => setForm({ ...form, jenis: e.target.value })}
            >
              {Object.entries(JENIS_PENGECUALIAN_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>

          {butuhPengganti ? (
            <Field
              label="Dokter Pengganti"
              hint="Kosongkan bila jadwal ditiadakan tanpa pengganti"
            >
              <Select
                value={form.substitute_doctor_id}
                onChange={(e) =>
                  setForm({ ...form, substitute_doctor_id: e.target.value })
                }
              >
                <option value="">Tanpa pengganti</option>
                {dokter
                  .filter((d) => String(d.id) !== form.doctor_id)
                  .map((d) => (
                    <option key={d.id} value={d.id}>{d.nama}</option>
                  ))}
              </Select>
            </Field>
          ) : null}

          {gantiJam || form.jenis === "tambahan" ? (
            <>
              <Field label="Jam Mulai" required={gantiJam}>
                <Input
                  type="time"
                  value={form.jam_mulai}
                  onChange={(e) => setForm({ ...form, jam_mulai: e.target.value })}
                />
              </Field>
              <Field label="Jam Selesai" required={gantiJam}>
                <Input
                  type="time"
                  value={form.jam_selesai}
                  onChange={(e) => setForm({ ...form, jam_selesai: e.target.value })}
                />
              </Field>
            </>
          ) : null}

          <Field label="Alasan" className="sm:col-span-2">
            <Textarea
              rows={2}
              value={form.alasan}
              onChange={(e) => setForm({ ...form, alasan: e.target.value })}
            />
          </Field>
        </div>

        {butuhPengganti && !form.substitute_doctor_id ? (
          <p className="mt-3 flex items-start gap-1.5 rounded-md border border-warning/25 bg-warning-bg px-3 py-2 text-meta text-warning">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            Tanpa pengganti, poli dokter ini akan kosong pada tanggal tersebut dan
            pasien tidak bisa didaftarkan kepadanya.
          </p>
        ) : null}
      </Modal>
    </>
  );
}

export function TombolPutusan({ id }: { id: number }) {
  const router = useRouter();
  const [proses, setProses] = useState(false);

  async function putuskan(setuju: boolean) {
    setProses(true);
    try {
      const hasil = await putuskanPengecualianAction(id, setuju);
      if (!hasil.ok) {
        toast.error(hasil.error);
        return;
      }
      toast.success(
        setuju
          ? "Disetujui. Daftar dokter di layar pendaftaran ikut berubah."
          : "Pengajuan ditolak.",
      );
      router.refresh();
    } catch {
      toast.error("Gagal menghubungi server. Periksa koneksi lalu coba lagi.");
    } finally {
      setProses(false);
    }
  }

  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="primary" onClick={() => putuskan(true)} disabled={proses}>
        <Check />
        Setujui
      </Button>
      <Button size="sm" onClick={() => putuskan(false)} disabled={proses}>
        <X />
        Tolak
      </Button>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant={
        status === "disetujui" ? "success" : status === "ditolak" ? "danger" : "warning"
      }
    >
      {status}
    </Badge>
  );
}
