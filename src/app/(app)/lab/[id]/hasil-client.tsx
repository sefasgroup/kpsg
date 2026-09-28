"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useReactToPrint } from "react-to-print";
import toast from "react-hot-toast";
import { CheckCheck, Printer, Save, TriangleAlert, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { batalkanOrderAction, simpanHasilAction } from "../actions";
import { LembarHasil, type BarisHasil } from "./lembar-hasil";

export type Parameter = {
  panel_id: number;
  panel_nama: string;
  parameter_id: number;
  parameter_nama: string;
  satuan: string | null;
  tipe_nilai: "numerik" | "teks" | "pilihan";
  pilihan: string[] | null;
  ref_low: number | null;
  ref_high: number | null;
  ref_teks: string | null;
  kritis_low: number | null;
  kritis_high: number | null;
  nilai: string;
  flag: string | null;
};

/** Salinan `hitungFlag` di server — hanya untuk umpan balik langsung di layar. */
function flagLokal(p: Parameter, nilai: string): string {
  if (p.tipe_nilai !== "numerik" || nilai === "") return "N";
  const n = Number(nilai);
  if (Number.isNaN(n)) return "N";
  if (p.kritis_low !== null && n < p.kritis_low) return "LL";
  if (p.kritis_high !== null && n > p.kritis_high) return "HH";
  if (p.ref_low !== null && n < p.ref_low) return "L";
  if (p.ref_high !== null && n > p.ref_high) return "H";
  return "N";
}

const FLAG_TEKS: Record<string, string> = {
  L: "Rendah",
  H: "Tinggi",
  LL: "KRITIS ↓",
  HH: "KRITIS ↑",
};

export function HasilClient({
  orderId,
  parameterAwal,
  terkunci,
  noOrder,
  pasienNama,
  bisaDibatalkan,
  cetak,
}: {
  orderId: number;
  parameterAwal: Parameter[];
  terkunci: boolean;
  noOrder: string;
  pasienNama: string;
  bisaDibatalkan: boolean;
  cetak: React.ComponentProps<typeof LembarHasil>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Parameter[]>(parameterAwal);
  const [proses, setProses] = useState(false);
  const [batalkan, setBatalkan] = useState(false);
  const [alasanBatal, setAlasanBatal] = useState("");
  const lembarRef = useRef<HTMLDivElement>(null);

  const cetakHasil = useReactToPrint({
    contentRef: lembarRef,
    documentTitle: `Hasil Lab ${cetak.noOrder}`,
  });

  const panels = useMemo(
    () => [...new Set(rows.map((r) => r.panel_nama))],
    [rows],
  );

  const terisi = rows.filter((r) => r.nilai !== "").length;
  const lengkap = terisi === rows.length;
  const kritis = rows.filter((r) => ["LL", "HH"].includes(flagLokal(r, r.nilai)));

  // Lembar cetak selalu memakai nilai yang sedang tampil, supaya pratinjau
  // dan hasil cetak tidak pernah berbeda.
  const barisCetak: BarisHasil[] = rows
    .filter((r) => r.nilai !== "")
    .map((r) => ({
      panel: r.panel_nama,
      parameter: r.parameter_nama,
      nilai: r.nilai,
      satuan: r.satuan,
      ref: r.ref_teks,
      flag: flagLokal(r, r.nilai),
    }));

  function set(i: number, nilai: string) {
    setRows(rows.map((r, j) => (j === i ? { ...r, nilai } : r)));
  }

  async function simpan(finalkan: boolean) {
    setProses(true);
    try {
      const hasil = await simpanHasilAction(orderId, {
        finalkan,
        hasil: rows
          .filter((r) => r.nilai !== "")
          .map((r) => ({
            parameter_id: r.parameter_id,
            panel_id: r.panel_id,
            nilai: r.nilai,
          })),
      });

      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 7000 });
        return;
      }

      if (finalkan) {
        toast.success(
          hasil.data.jumlahKritis > 0
            ? `Hasil difinalkan dengan ${hasil.data.jumlahKritis} nilai kritis — segera hubungi dokter pengirim.`
            : "Hasil difinalkan dan dikirim ke layar dokter.",
          { duration: hasil.data.jumlahKritis > 0 ? 9000 : 4000 },
        );
        setTimeout(() => cetakHasil(), 300);
      } else {
        toast.success("Hasil sementara tersimpan.");
      }
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  async function jalankanPembatalan() {
    setProses(true);
    try {
      const hasil = await batalkanOrderAction(orderId, alasanBatal);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 9000 });
        return;
      }
      setBatalkan(false);
      setAlasanBatal("");
      toast.success(
        `Order ${hasil.data.noOrder} dibatalkan. Dokter pemesan sudah diberi tahu.`,
        { duration: 7000 },
      );
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {kritis.length > 0 ? (
        <div className="rounded-md border border-danger/25 bg-danger-bg px-4 py-3">
          <p className="flex items-center gap-2 text-body font-medium text-danger">
            <TriangleAlert className="size-4" aria-hidden />
            {kritis.length} nilai kritis terdeteksi
          </p>
          <ul className="mt-1.5 flex list-inside list-disc flex-col gap-0.5 text-meta text-danger">
            {kritis.map((r) => (
              <li key={r.parameter_id}>
                {r.parameter_nama}: {r.nilai} {r.satuan ?? ""} (rujukan{" "}
                {r.ref_teks ?? "—"})
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-meta text-danger">
            Nilai kritis wajib dikomunikasikan langsung ke dokter pengirim,
            tidak cukup menunggu ia membuka layar.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle icon={CheckCheck}>Input Hasil</CardTitle>
          <Badge variant={lengkap ? "success" : "warning"}>
            {terisi}/{rows.length} parameter terisi
          </Badge>
        </CardHeader>

        {panels.map((panel) => (
          <div key={panel} className="mb-3 last:mb-0">
            <p className="mb-1.5 text-micro tracking-wide text-ink-faint uppercase">
              {panel}
            </p>
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full border-collapse text-body">
                <thead>
                  <tr className="bg-surface-alt">
                    <th className="border-b border-line px-3 py-2 text-left text-label font-medium text-ink-muted">Parameter</th>
                    <th className="border-b border-line px-3 py-2 text-right text-label font-medium text-ink-muted">Hasil</th>
                    <th className="border-b border-line px-3 py-2 text-left text-label font-medium text-ink-muted">Satuan</th>
                    <th className="border-b border-line px-3 py-2 text-left text-label font-medium text-ink-muted">Rujukan</th>
                    <th className="border-b border-line px-3 py-2 text-left text-label font-medium text-ink-muted">Ket.</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    if (r.panel_nama !== panel) return null;
                    const f = flagLokal(r, r.nilai);
                    const abn = f === "L" || f === "H";
                    const krt = f === "LL" || f === "HH";
                    return (
                      <tr key={r.parameter_id} className="border-b border-line last:border-b-0">
                        <td className="px-3 py-1.5 text-ink">{r.parameter_nama}</td>
                        <td className="px-3 py-1.5 text-right">
                          {r.tipe_nilai === "pilihan" && r.pilihan ? (
                            <Select
                              value={r.nilai}
                              disabled={terkunci}
                              aria-label={r.parameter_nama}
                              onChange={(e) => set(i, e.target.value)}
                              className="h-8 w-32"
                            >
                              <option value="">—</option>
                              {r.pilihan.map((o) => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </Select>
                          ) : (
                            <Input
                              type={r.tipe_nilai === "numerik" ? "number" : "text"}
                              step="any"
                              value={r.nilai}
                              disabled={terkunci}
                              aria-label={r.parameter_nama}
                              aria-invalid={krt}
                              onChange={(e) => set(i, e.target.value)}
                              className={`h-8 w-28 text-right ${
                                krt ? "border-danger font-semibold text-danger" : abn ? "border-warning" : ""
                              }`}
                            />
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-meta text-ink-muted">
                          {r.satuan ?? "—"}
                        </td>
                        <td className="px-3 py-1.5 text-meta text-ink-muted">
                          {r.ref_teks ?? "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          {f === "N" ? null : (
                            <span
                              className={`text-micro font-semibold uppercase ${
                                krt ? "text-danger" : "text-warning"
                              }`}
                            >
                              {FLAG_TEKS[f]}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {!terkunci ? (
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {/*
              Pembatalan diletakkan di ujung KIRI, jauh dari dua tombol yang
              dipakai setiap hari. Sebabnya nyata dan sering — sampel lisis,
              volume kurang, tabung pecah, pasien menolak diambil darah —
              tetapi ia menghapus tarif dari tagihan dan mengubah alur pasien,
              jadi tidak boleh tertekan karena kebetulan bersebelahan.
            */}
            {bisaDibatalkan ? (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto"
                onClick={() => {
                  setBatalkan(true);
                  setAlasanBatal("");
                }}
                disabled={proses}
              >
                <Undo2 />
                Batalkan Order
              </Button>
            ) : null}
            <Button type="button" onClick={() => simpan(false)} disabled={proses}>
              <Save />
              Simpan Sementara
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => simpan(true)}
              disabled={proses || !lengkap}
            >
              <CheckCheck />
              {proses ? "Menyimpan…" : "Finalkan & Cetak"}
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex justify-end">
            <Button type="button" variant="primary" onClick={() => cetakHasil()}>
              <Printer />
              Cetak Ulang Hasil
            </Button>
          </div>
        )}

        {!lengkap && !terkunci ? (
          <p className="mt-2 text-right text-meta text-ink-faint">
            Finalisasi menuntut seluruh parameter terisi — hasil separuh bukan hasil.
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle icon={Printer}>Pratinjau Lembar Hasil</CardTitle>
          <span className="text-meta text-ink-faint">A4 · kop surat dari data cabang</span>
        </CardHeader>
        <div className="overflow-x-auto">
          <LembarHasil ref={lembarRef} {...cetak} baris={barisCetak} />
        </div>
      </Card>

      <Modal
        open={batalkan}
        onClose={() => setBatalkan(false)}
        size="sm"
        title="Batalkan Order Lab"
        description={`${noOrder} · ${pasienNama}`}
        footer={
          <>
            <Button onClick={() => setBatalkan(false)} disabled={proses}>
              Tutup
            </Button>
            <Button variant="danger" onClick={jalankanPembatalan} disabled={proses}>
              <Undo2 />
              {proses ? "Membatalkan…" : "Batalkan Order"}
            </Button>
          </>
        }
      >
        <ul className="mb-2.5 flex list-inside list-disc flex-col gap-1 text-meta text-ink-muted">
          <li>Tarif pemeriksaan dikeluarkan dari tagihan pasien.</li>
          <li>
            <strong>Dokter pemesan langsung diberi tahu</strong> beserta alasan
            yang Anda tulis — tanpa itu ia menunggu hasil yang tidak akan datang.
          </li>
          <li>
            Ditolak bila sudah ada hasil yang Anda input, atau bila tagihan
            kunjungan sudah lunas.
          </li>
        </ul>
        <Field label="Alasan Pembatalan" required>
          <Textarea
            rows={3}
            value={alasanBatal}
            maxLength={200}
            onChange={(e) => setAlasanBatal(e.target.value)}
            placeholder="mis. Sampel lisis, pasien menolak diambil ulang"
          />
        </Field>
      </Modal>
    </div>
  );
}
