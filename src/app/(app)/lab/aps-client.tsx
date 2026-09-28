"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Send, Trash2, UserRoundPlus } from "lucide-react";
import { Autocomplete } from "@/components/ui/autocomplete";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Select, Textarea } from "@/components/ui/field";
import { formatRupiah, hitungUmur } from "@/lib/format";
import { cariPanelLabAction, orderApsAction } from "./actions";

export type KunjunganPilihan = {
  visit_id: number;
  antrean: string | null;
  no_rm: string;
  nama: string;
  tanggal_lahir: string;
  jenis_kelamin: "L" | "P";
  poli_nama: string;
};

type PanelDipilih = { panel_id: number; nama: string; tarif: number };

/**
 * Pemeriksaan ATAS PERMINTAAN SENDIRI (APS).
 *
 * Order dibuat TERSENDIRI atas nama petugas lab, bukan ditempelkan ke order
 * dokter. Rekam medis adalah dokumen hukum: nama dan No. SIP dokter ada di
 * bawahnya, dan ia tidak boleh menanggung pemeriksaan yang tidak pernah ia
 * instruksikan. Hasilnya tetap tampil di layar dokter — asal-usulnya saja
 * yang jujur.
 */
export function ApsClient({ kunjungan }: { kunjungan: KunjunganPilihan[] }) {
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [visitId, setVisitId] = useState("");
  const [panels, setPanels] = useState<PanelDipilih[]>([]);
  const [catatan, setCatatan] = useState("");
  const [proses, setProses] = useState(false);

  const total = panels.reduce((n, p) => n + p.tarif, 0);
  const dipilih = kunjungan.find((k) => String(k.visit_id) === visitId);

  async function kirim() {
    setProses(true);
    try {
      const res = await orderApsAction(Number(visitId), {
        prioritas: "rutin",
        sifat_hasil: "menyusul",
        catatan_klinis: catatan,
        panels,
      });
      if (!res.ok) {
        toast.error(res.error, { duration: 9000 });
        return;
      }
      toast.success(
        `Order APS ${res.data.noOrder} dibuat — ${formatRupiah(res.data.total)} masuk tagihan pasien.`,
        { duration: 7000 },
      );
      setPanels([]);
      setCatatan("");
      setVisitId("");
      setBuka(false);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  if (!buka) {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-body text-ink">
              Pemeriksaan atas permintaan pasien sendiri
            </p>
            <p className="mt-0.5 text-meta text-ink-muted">
              Tanpa instruksi dokter. Tercatat atas nama Anda, tarifnya masuk
              tagihan kunjungan yang sedang berjalan.
            </p>
          </div>
          <Button type="button" onClick={() => setBuka(true)}>
            <UserRoundPlus />
            Buat Order APS
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={UserRoundPlus}>Order Atas Permintaan Sendiri</CardTitle>
        <Badge variant="neutral">APS</Badge>
      </CardHeader>

      <p className="mb-3 text-meta text-ink-muted">
        Order ini tercatat <strong>atas nama Anda</strong>, bukan atas nama
        dokter. Hasilnya tetap masuk ke layar dokter yang menangani pasien, dan
        sifatnya selalu <strong>menyusul</strong> — pemeriksaan yang bukan dasar
        keputusan dokter tidak boleh menahan pasien di antrean.
      </p>

      <div className="grid gap-3 lg:grid-cols-2">
        <Field
          label="Kunjungan Pasien"
          required
          hint="Hanya kunjungan hari ini yang tagihannya belum ditutup"
        >
          <Select value={visitId} onChange={(e) => setVisitId(e.target.value)}>
            <option value="">— pilih pasien</option>
            {kunjungan.map((k) => (
              <option key={k.visit_id} value={k.visit_id}>
                {k.antrean ?? "—"} · {k.nama} ({k.no_rm}) · {k.poli_nama}
              </option>
            ))}
          </Select>
        </Field>

        {dipilih ? (
          <div className="self-end rounded-md border border-line bg-surface-alt px-3 py-2 text-meta text-ink-muted">
            {dipilih.jenis_kelamin === "L" ? "Laki-laki" : "Perempuan"} ·{" "}
            {hitungUmur(dipilih.tanggal_lahir)} tahun · tarifnya masuk ke tagihan
            kunjungan ini
          </div>
        ) : null}
      </div>

      {kunjungan.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-meta text-ink-faint">
          Tidak ada kunjungan berjalan yang tagihannya masih terbuka. Pasien
          yang sudah membayar perlu didaftarkan ulang di Pendaftaran — hari ini
          juga bisa.
        </p>
      ) : (
        <div className="mt-3">
          <Autocomplete
            cari={cariPanelLabAction}
            placeholder="Cari pemeriksaan — gula darah, asam urat, kolesterol…"
            keyOf={(p) => p.id}
            onPilih={(p) => {
              if (panels.some((x) => x.panel_id === p.id)) return;
              setPanels([
                ...panels,
                { panel_id: p.id, nama: p.nama, tarif: Number(p.tarif) },
              ]);
            }}
            renderBaris={(p) => (
              <>
                <span className="min-w-0 flex-1 truncate text-body text-ink">{p.nama}</span>
                <span className="shrink-0 text-meta text-ink-muted tabular">
                  {formatRupiah(p.tarif)}
                </span>
              </>
            )}
          />
        </div>
      )}

      {panels.length > 0 ? (
        <>
          <ul className="mt-3 flex flex-col gap-1.5">
            {panels.map((p, i) => (
              <li
                key={p.panel_id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-alt px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-body text-ink">{p.nama}</span>
                <span className="text-body text-ink tabular">{formatRupiah(p.tarif)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Hapus ${p.nama}`}
                  onClick={() => setPanels(panels.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>

          <div className="mt-3">
            <Field label="Catatan" hint="Ikut terbaca di layar dokter">
              <Textarea
                rows={2}
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                placeholder="mis. Diminta pasien untuk kontrol gula mandiri"
              />
            </Field>
          </div>
        </>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <p className="text-meta text-ink-muted">
          Total <strong className="text-ink tabular">{formatRupiah(total)}</strong> —
          langsung masuk tagihan pasien.
        </p>
        <div className="flex gap-2">
          <Button type="button" onClick={() => setBuka(false)} disabled={proses}>
            Tutup
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={kirim}
            disabled={proses || !visitId || panels.length === 0}
          >
            <Send />
            {proses ? "Membuat…" : "Buat Order APS"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
