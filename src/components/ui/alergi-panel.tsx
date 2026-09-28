"use client";

import { useState, useTransition } from "react";
import toast from "react-hot-toast";
import { Plus, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import type { AlergiRow } from "@/lib/nurse";

const WARNA_KEPARAHAN: Record<string, string> = {
  berat: "text-danger",
  sedang: "text-warning",
  ringan: "text-ink-muted",
};

/**
 * Ringkasan alergi pasien + pencatatan alergi baru.
 *
 * Sumbernya `patient_allergies`, BUKAN kolom teks di pengkajian atau asesmen.
 * Alergi melekat pada PASIEN, bukan pada kunjungan: yang dicatat di sini ikut
 * terbaca dokter, ikut diperiksa farmasi saat memvalidasi resep, dan muncul
 * lagi pada kunjungan berikutnya. Teks bebas per-kunjungan tidak melakukan
 * satu pun dari itu.
 *
 * Karena itu pula perawat dan dokter memakai panel yang SAMA dan menulis ke
 * daftar yang sama — di sini tidak ada "versi perawat" dan "versi dokter"
 * seperti pada keluhan atau riwayat penyakit. Yang membedakan hanya server
 * action-nya, yang menjaga peran masing-masing.
 */
export function AlergiPanel({
  visitId,
  awal,
  aksi,
  terkunci = false,
}: {
  visitId: number;
  awal: AlergiRow[];
  /** Server action pemanggilnya — menentukan peran mana yang diizinkan. */
  aksi: (
    visitId: number,
    raw: unknown,
  ) => Promise<{ ok: true; data: AlergiRow[] } | { ok: false; error: string }>;
  terkunci?: boolean;
}) {
  const [daftar, setDaftar] = useState(awal);
  const [buka, setBuka] = useState(false);
  const [proses, mulai] = useTransition();
  const [f, setF] = useState({
    jenis: "obat",
    nama_alergen: "",
    reaksi: "",
    keparahan: "",
  });

  function simpan() {
    if (f.nama_alergen.trim().length < 2) {
      toast.error("Nama alergen wajib diisi.");
      return;
    }
    mulai(async () => {
      const hasil = await aksi(visitId, f);
      if (!hasil.ok) {
        toast.error(hasil.error);
        return;
      }
      setDaftar(hasil.data);
      setF({ jenis: "obat", nama_alergen: "", reaksi: "", keparahan: "" });
      setBuka(false);
      toast.success("Alergi tercatat di rekam medis pasien.");
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-label text-ink-muted">Riwayat Alergi</span>

      <div className="rounded-md border border-line bg-surface-alt/40 p-2">
        {daftar.length === 0 ? (
          <p className="px-1 py-1.5 text-meta text-ink-faint">
            Belum ada alergi tercatat. Tanyakan ke pasien.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {daftar.map((a) => (
              <li key={a.id} className="flex items-start gap-1.5 text-body">
                <TriangleAlert
                  className={`mt-0.5 size-3.5 shrink-0 ${
                    WARNA_KEPARAHAN[a.keparahan ?? ""] ?? "text-ink-muted"
                  }`}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="text-ink">{a.nama_alergen}</span>
                  {a.reaksi ? (
                    <span className="text-ink-muted"> — {a.reaksi}</span>
                  ) : null}
                  {/* Keparahan ditulis, tidak hanya diwarnai. */}
                  {a.keparahan ? (
                    <span className={`ml-1 text-meta ${WARNA_KEPARAHAN[a.keparahan]}`}>
                      ({a.keparahan})
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}

        {terkunci ? null : buka ? (
          <div className="mt-2 flex flex-col gap-2 border-t border-line pt-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Jenis">
                <Select
                  value={f.jenis}
                  onChange={(e) => setF({ ...f, jenis: e.target.value })}
                >
                  <option value="obat">Obat</option>
                  <option value="makanan">Makanan</option>
                  <option value="lingkungan">Lingkungan</option>
                  <option value="lainnya">Lainnya</option>
                </Select>
              </Field>
              <Field label="Nama Alergen" required>
                <Input
                  autoFocus
                  value={f.nama_alergen}
                  placeholder="Amoksisilin"
                  onChange={(e) => setF({ ...f, nama_alergen: e.target.value })}
                />
              </Field>
              <Field label="Reaksi">
                <Input
                  value={f.reaksi}
                  placeholder="Ruam, gatal, sesak…"
                  onChange={(e) => setF({ ...f, reaksi: e.target.value })}
                />
              </Field>
              <Field label="Keparahan">
                <Select
                  value={f.keparahan}
                  onChange={(e) => setF({ ...f, keparahan: e.target.value })}
                >
                  <option value="">—</option>
                  <option value="ringan">Ringan</option>
                  <option value="sedang">Sedang</option>
                  <option value="berat">Berat</option>
                </Select>
              </Field>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="primary" disabled={proses} onClick={simpan}>
                {proses ? "Menyimpan…" : "Simpan Alergi"}
              </Button>
              <Button type="button" disabled={proses} onClick={() => setBuka(false)}>
                <X />
                Batal
              </Button>
            </div>
            <p className="text-micro text-ink-faint">
              Tersimpan langsung ke rekam medis pasien — tidak menunggu tombol
              simpan di layar ini.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setBuka(true)}
            className="mt-1.5 flex items-center gap-1 rounded-sm px-1 py-0.5 text-meta text-brand-700 transition-colors hover:bg-surface-alt"
          >
            <Plus className="size-3.5" aria-hidden />
            Tambah Alergi
          </button>
        )}
      </div>
    </div>
  );
}
