"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { KeyRound, Pencil, Power, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { ROLES, ROLE_LABEL } from "@/lib/rbac";
import {
  resetPasswordAction,
  setAktifPenggunaAction,
  simpanPenggunaAction,
} from "../master-actions";

export type PenggunaForm = {
  id?: number;
  nama: string;
  username: string;
  role_code: string;
  site_id: string;
  /** Penugasan cabang tambahan. Cabang induk tidak ikut di sini. */
  site_ids: number[];
  nip: string;
  email: string;
  telepon: string;
  password: string;
  no_str: string;
  no_sip: string;
  spesialisasi: string;
  gelar_depan: string;
  tarif_konsultasi: string;
};

const KOSONG: PenggunaForm = {
  nama: "", username: "", role_code: "perawat", site_id: "", site_ids: [], nip: "",
  email: "", telepon: "", password: "", no_str: "", no_sip: "",
  spesialisasi: "", gelar_depan: "", tarif_konsultasi: "0",
};

export function FormPengguna({
  cabang,
  awal,
  pemicu,
}: {
  cabang: { id: number; nama: string }[];
  awal?: PenggunaForm;
  pemicu?: "tambah" | "edit";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [proses, setProses] = useState(false);
  const [form, setForm] = useState<PenggunaForm>(awal ?? KOSONG);
  const [passwordBaru, setPasswordBaru] = useState<string | null>(null);

  const isDokter = form.role_code === "dokter";
  const isSuperAdmin = form.role_code === "super_admin";
  const set = (k: keyof PenggunaForm, v: string) => setForm({ ...form, [k]: v });

  async function simpan() {
    setProses(true);
    try {
      const hasil = await simpanPenggunaAction(form, awal?.id);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 6000 });
        return;
      }
      if (hasil.data.passwordBaru) {
        // Password sementara ditampilkan SEKALI di sini dan tidak disimpan
        // di mana pun dalam bentuk terbaca — termasuk audit log.
        setPasswordBaru(hasil.data.passwordBaru);
      } else {
        toast.success("Pengguna tersimpan.");
        setOpen(false);
      }
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <>
      {pemicu === "edit" ? (
        <Button variant="ghost" size="sm" aria-label={`Ubah ${form.nama}`} onClick={() => setOpen(true)}>
          <Pencil />
        </Button>
      ) : (
        <Button variant="primary" size="sm" onClick={() => { setForm(KOSONG); setOpen(true); }}>
          <UserPlus />
          Tambah Pengguna
        </Button>
      )}

      <Modal
        open={open}
        onClose={() => { setOpen(false); setPasswordBaru(null); }}
        size="lg"
        title={awal ? `Ubah ${awal.nama}` : "Tambah Pengguna"}
        description="Satu akun = satu peran. Tidak ada peran ganda dalam satu akun operasional."
        footer={
          passwordBaru ? (
            <Button variant="primary" onClick={() => { setOpen(false); setPasswordBaru(null); }}>
              Selesai
            </Button>
          ) : (
            <>
              <Button onClick={() => setOpen(false)} disabled={proses}>Batal</Button>
              <Button variant="primary" onClick={simpan} disabled={proses}>
                {proses ? "Menyimpan…" : "Simpan"}
              </Button>
            </>
          )
        }
      >
        {passwordBaru ? (
          <div className="rounded-md border border-warning/25 bg-warning-bg px-4 py-3">
            <p className="text-body font-medium text-warning">
              Password sementara — catat sekarang
            </p>
            <p className="my-2 rounded-md border border-line bg-surface px-3 py-2 text-center font-mono text-h1 text-ink select-all">
              {passwordBaru}
            </p>
            <p className="text-meta text-warning">
              Password ini tidak disimpan dalam bentuk terbaca di mana pun dan
              tidak bisa ditampilkan lagi. Pengguna wajib menggantinya saat
              login pertama.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <section>
              <h3 className="mb-2.5 text-micro tracking-wide text-ink-faint uppercase">Identitas & Akses</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nama Lengkap" required>
                  <Input value={form.nama} onChange={(e) => set("nama", e.target.value)} />
                </Field>
                <Field label="Username" required hint="Huruf kecil, angka, titik, tanda hubung">
                  <Input
                    value={form.username}
                    onChange={(e) => set("username", e.target.value.toLowerCase())}
                    className="font-mono"
                  />
                </Field>
                <Field label="Peran" required>
                  <Select value={form.role_code} onChange={(e) => set("role_code", e.target.value)}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Cabang"
                  required={!isSuperAdmin}
                  hint={isSuperAdmin ? "Super Admin bekerja lintas cabang" : "Batas isolasi data akun ini"}
                >
                  <Select
                    value={form.site_id}
                    disabled={isSuperAdmin}
                    onChange={(e) => set("site_id", e.target.value)}
                  >
                    <option value="">{isSuperAdmin ? "Lintas cabang" : "Pilih cabang…"}</option>
                    {cabang.map((c) => (
                      <option key={c.id} value={c.id}>{c.nama}</option>
                    ))}
                  </Select>
                </Field>
                {/*
                  Penugasan tambahan: dokter memang bisa praktik di lebih
                  dari satu cabang. Cabang induk tidak muncul di daftar ini
                  agar tidak tercatat dua kali.

                  Super Admin sudah lintas cabang, jadi baginya daftar ini
                  tidak berarti apa-apa dan disembunyikan.
                */}
                {!isSuperAdmin ? (
                  <Field
                    label="Penugasan Cabang Tambahan"
                    className="sm:col-span-2"
                    hint="Pengguna bisa berpindah di antara cabang penugasannya lewat pemilih di kanan atas"
                  >
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border border-line px-3 py-2">
                      {cabang.filter((c) => String(c.id) !== form.site_id).length === 0 ? (
                        <span className="text-meta text-ink-faint">
                          Tidak ada cabang lain.
                        </span>
                      ) : (
                        cabang
                          .filter((c) => String(c.id) !== form.site_id)
                          .map((c) => (
                            <label key={c.id} className="flex items-center gap-1.5 text-meta">
                              <input
                                type="checkbox"
                                checked={form.site_ids.includes(c.id)}
                                onChange={(e) =>
                                  setForm({
                                    ...form,
                                    site_ids: e.target.checked
                                      ? [...form.site_ids, c.id]
                                      : form.site_ids.filter((x) => x !== c.id),
                                  })
                                }
                                className="size-4 accent-[var(--color-brand-600)]"
                              />
                              <span className="text-ink">{c.nama}</span>
                            </label>
                          ))
                      )}
                    </div>
                  </Field>
                ) : null}

                <Field label="NIP / No. Pegawai">
                  <Input value={form.nip} onChange={(e) => set("nip", e.target.value)} />
                </Field>
                <Field label="Telepon">
                  <Input value={form.telepon} onChange={(e) => set("telepon", e.target.value)} />
                </Field>
                <Field label="Email" className="sm:col-span-2">
                  <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
                </Field>
                <Field
                  label={awal ? "Password Baru" : "Password"}
                  hint={awal ? "Kosongkan bila tidak ingin mengubah" : "Kosongkan untuk password acak"}
                  className="sm:col-span-2"
                >
                  <Input
                    type="password"
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                    autoComplete="new-password"
                  />
                </Field>
              </div>
            </section>

            {isDokter ? (
              <section>
                <h3 className="mb-2.5 text-micro tracking-wide text-ink-faint uppercase">Profil Dokter</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Gelar Depan" hint="mis. dr., drg.">
                    <Input value={form.gelar_depan} onChange={(e) => set("gelar_depan", e.target.value)} />
                  </Field>
                  <Field label="Spesialisasi">
                    <Input value={form.spesialisasi} onChange={(e) => set("spesialisasi", e.target.value)} />
                  </Field>
                  <Field label="No. STR">
                    <Input value={form.no_str} onChange={(e) => set("no_str", e.target.value)} className="font-mono" />
                  </Field>
                  <Field label="No. SIP">
                    <Input value={form.no_sip} onChange={(e) => set("no_sip", e.target.value)} className="font-mono" />
                  </Field>
                  {/*
                    TIDAK lagi menagih otomatis. Sejak konsultasi menjadi baris
                    Tindakan Medis yang bisa dihapus & didiskon dokter, membiarkan
                    kolom ini ikut menagih berarti pasien tertagih konsultasi dua
                    kali. Kolomnya dipertahankan sebagai catatan tarif rujukan —
                    dan petunjuknya menyebutkan itu, supaya tidak ada admin yang
                    mengisinya lalu heran biayanya tidak muncul di struk.
                  */}
                  <Field
                    label="Tarif Konsultasi (Rp)"
                    className="sm:col-span-2"
                    hint="Catatan tarif rujukan saja. Biaya konsultasi yang benar-benar ditagihkan berasal dari Master → Tindakan yang bertanda Konsultasi."
                  >
                    <Input
                      type="number"
                      min={0}
                      step={5000}
                      value={form.tarif_konsultasi}
                      onChange={(e) => set("tarif_konsultasi", e.target.value)}
                    />
                  </Field>
                </div>
              </section>
            ) : null}
          </div>
        )}
      </Modal>
    </>
  );
}

export function ResetPassword({ id, nama }: { id: number; nama: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [proses, setProses] = useState(false);

  async function reset() {
    setProses(true);
    try {
      const hasil = await resetPasswordAction(id, { password: pw });
      if (!hasil.ok) {
        toast.error(hasil.error);
        return;
      }
      toast.success(`Password ${nama} diatur ulang. Wajib diganti saat login.`);
      setOpen(false);
      setPw("");
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" aria-label={`Reset password ${nama}`} onClick={() => setOpen(true)}>
        <KeyRound />
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={`Atur Ulang Password — ${nama}`}
        description="Pengguna akan diwajibkan menggantinya saat login berikutnya."
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={proses}>Batal</Button>
            <Button variant="primary" onClick={reset} disabled={proses || pw.length < 8}>
              {proses ? "Menyimpan…" : "Atur Ulang"}
            </Button>
          </>
        }
      >
        <Field label="Password Baru" required hint="Minimal 8 karakter">
          <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        </Field>
      </Modal>
    </>
  );
}

export function TogglePengguna({
  id,
  aktif,
  nama,
}: {
  id: number;
  aktif: boolean;
  nama: string;
}) {
  const router = useRouter();
  const [proses, setProses] = useState(false);

  async function toggle() {
    setProses(true);
    try {
      const hasil = await setAktifPenggunaAction(id, !aktif);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 6000 });
        return;
      }
      toast.success(aktif ? `${nama} dinonaktifkan.` : `${nama} diaktifkan.`);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={aktif ? `Nonaktifkan ${nama}` : `Aktifkan ${nama}`}
      onClick={toggle}
      disabled={proses}
      className={aktif ? "hover:text-danger" : "hover:text-success"}
    >
      <Power />
    </Button>
  );
}
