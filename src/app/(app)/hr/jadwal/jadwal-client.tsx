"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { CalendarPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { HARI } from "@/lib/validations/hr";
import { hapusJadwalAction, tambahJadwalAction } from "../actions";

export function TambahJadwal({
  dokter,
  poli,
}: {
  dokter: { id: number; nama: string }[];
  poli: { id: number; nama: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [proses, setProses] = useState(false);
  const [form, setForm] = useState({
    doctor_id: "",
    poli_id: "",
    hari: "1",
    jam_mulai: "08:00",
    jam_selesai: "12:00",
    kuota: "0",
  });

  async function simpan() {
    setProses(true);
    try {
      const hasil = await tambahJadwalAction(form);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 6000 });
        return;
      }
      toast.success("Jadwal praktik ditambahkan.");
      setOpen(false);
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
        Tambah Jadwal
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="Tambah Jadwal Praktik"
        description="Jadwal berulang mingguan. Ketidakhadiran pada tanggal tertentu diatur lewat menu Dokter Pengganti."
        footer={
          <>
            <Button type="button" onClick={() => setOpen(false)} disabled={proses}>
              Batal
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={simpan}
              disabled={proses || !form.doctor_id || !form.poli_id}
            >
              {proses ? "Menyimpan…" : "Simpan"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dokter" required className="sm:col-span-2">
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

          <Field label="Poli" required>
            <Select
              value={form.poli_id}
              onChange={(e) => setForm({ ...form, poli_id: e.target.value })}
            >
              <option value="">Pilih poli…</option>
              {poli.map((p) => (
                <option key={p.id} value={p.id}>{p.nama}</option>
              ))}
            </Select>
          </Field>

          <Field label="Hari" required>
            <Select
              value={form.hari}
              onChange={(e) => setForm({ ...form, hari: e.target.value })}
            >
              {HARI.map((h) => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </Select>
          </Field>

          <Field label="Jam Mulai" required>
            <Input
              type="time"
              value={form.jam_mulai}
              onChange={(e) => setForm({ ...form, jam_mulai: e.target.value })}
            />
          </Field>

          <Field label="Jam Selesai" required>
            <Input
              type="time"
              value={form.jam_selesai}
              onChange={(e) => setForm({ ...form, jam_selesai: e.target.value })}
            />
          </Field>

          <Field label="Kuota Pasien" hint="0 = tanpa batas" className="sm:col-span-2">
            <Input
              type="number"
              min={0}
              value={form.kuota}
              onChange={(e) => setForm({ ...form, kuota: e.target.value })}
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}

export function HapusJadwal({ id, label }: { id: number; label: string }) {
  const router = useRouter();
  const [proses, setProses] = useState(false);

  async function hapus() {
    setProses(true);
    try {
      const hasil = await hapusJadwalAction(id);
      if (!hasil.ok) {
        toast.error(hasil.error);
        return;
      }
      toast.success("Jadwal dinonaktifkan.");
      router.refresh();
    } catch {
      toast.error("Gagal menghubungi server. Periksa koneksi lalu coba lagi.");
    } finally {
      setProses(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Hapus jadwal ${label}`}
      onClick={hapus}
      disabled={proses}
    >
      <Trash2 />
    </Button>
  );
}
