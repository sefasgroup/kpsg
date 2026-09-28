"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Clock3, FlaskConical, Send, Trash2, TriangleAlert, Undo2, Zap,
} from "lucide-react";
import { Autocomplete } from "@/components/ui/autocomplete";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { formatJam, formatRupiah } from "@/lib/format";
import { JELAS_SIFAT, LABEL_SIFAT, SIFAT_HASIL, type SifatHasil } from "@/lib/validations/lab";
import {
  batalkanOrderLabAction, cariPanelAction, orderLabAction, ubahSifatHasilAction,
} from "../actions";

export type PanelDipilih = {
  panel_id: number;
  nama: string;
  tarif: number;
};

export type OrderTampil = {
  id: number;
  no_order: string;
  status: string;
  prioritas: string;
  sifat_hasil: "ditunggu" | "menyusul";
  atas_permintaan_sendiri: number;
  ordered_at: string;
  panels: string | null;
  ada_kritis: number;
  alasan_batal: string | null;
  dibatalkan_oleh: string | null;
};

export type HasilTampil = {
  no_order: string;
  panel_nama: string;
  parameter_nama: string;
  nilai: string;
  satuan: string | null;
  ref_teks: string | null;
  flag: string;
};

const FLAG_TEKS: Record<string, string> = {
  L: "Rendah",
  H: "Tinggi",
  LL: "KRITIS ↓",
  HH: "KRITIS ↑",
};

export function LabCard({
  visitId,
  orders,
  hasil,
  terkunci,
}: {
  visitId: number;
  orders: OrderTampil[];
  hasil: HasilTampil[];
  terkunci: boolean;
}) {
  const router = useRouter();
  const [panels, setPanels] = useState<PanelDipilih[]>([]);
  const [prioritas, setPrioritas] = useState<"rutin" | "cito">("rutin");
  const [sifat, setSifat] = useState<SifatHasil>("ditunggu");
  const [catatan, setCatatan] = useState("");
  const [proses, setProses] = useState(false);
  /** Order yang sedang dimintakan pembatalan — null berarti dialog tertutup. */
  const [batalkan, setBatalkan] = useState<OrderTampil | null>(null);
  const [alasanBatal, setAlasanBatal] = useState("");

  const total = panels.reduce((n, p) => n + p.tarif, 0);
  const kritis = hasil.filter((h) => h.flag === "LL" || h.flag === "HH");
  const noOrders = [...new Set(hasil.map((h) => h.no_order))];
  const berjalan = orders.filter((o) => o.status === "baru" || o.status === "diproses");
  const dibatalkan = orders.filter((o) => o.status === "batal");
  const adaDitunggu = berjalan.some((o) => o.sifat_hasil === "ditunggu");

  async function kirim() {
    setProses(true);
    try {
      const res = await orderLabAction(visitId, {
        prioritas,
        sifat_hasil: sifat,
        catatan_klinis: catatan,
        panels,
      });
      if (!res.ok) {
        toast.error(res.error, { duration: 6000 });
        return;
      }
      toast.success(
        sifat === "ditunggu"
          ? `Order ${res.data.noOrder} dikirim. Pasien menunggu hasilnya.`
          : `Order ${res.data.noOrder} dikirim. Pasien boleh lanjut — hasilnya menyusul.`,
        { duration: 6000 },
      );
      setPanels([]);
      setCatatan("");
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  async function ubahSifat(o: OrderTampil, ke: SifatHasil) {
    setProses(true);
    try {
      const res = await ubahSifatHasilAction(o.id, ke);
      if (!res.ok) {
        toast.error(res.error, { duration: 7000 });
        return;
      }
      toast.success(
        ke === "menyusul"
          ? `${res.data.noOrder} tidak lagi menahan pasien — asesmen bisa difinalkan.`
          : `${res.data.noOrder} kembali ditunggu. Pasien menunggu hasilnya.`,
        { duration: 6000 },
      );
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  async function batalkanOrder() {
    if (!batalkan) return;
    setProses(true);
    try {
      const res = await batalkanOrderLabAction(batalkan.id, alasanBatal);
      if (!res.ok) {
        toast.error(res.error, { duration: 8000 });
        return;
      }
      setBatalkan(null);
      setAlasanBatal("");
      toast.success(
        `Order ${res.data.noOrder} dibatalkan. Tarifnya dikeluarkan dari tagihan.`,
        { duration: 6000 },
      );
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={FlaskConical}>Laboratorium</CardTitle>
        {/*
          Kalau ada hasil yang ditunggu, itulah yang paling perlu terbaca di
          sini: ia menahan pasien DAN memblokir tombol Finalkan. Dokter yang
          tidak tahu sebabnya akan menyangka sistemnya rusak.
        */}
        {adaDitunggu ? (
          <Badge variant="warning">Menunggu hasil — belum bisa difinalkan</Badge>
        ) : orders.length > 0 ? (
          <Badge variant="neutral">{orders.length} order</Badge>
        ) : null}
      </CardHeader>

      {/* ---------- Hasil yang sudah kembali ---------- */}
      {kritis.length > 0 ? (
        <div className="mb-3 rounded-md border border-danger/25 bg-danger-bg px-3 py-2.5">
          <p className="flex items-center gap-2 text-body font-medium text-danger">
            <TriangleAlert className="size-4" aria-hidden />
            {kritis.length} hasil dengan nilai kritis
          </p>
          <ul className="mt-1 flex list-inside list-disc flex-col gap-0.5 text-meta text-danger">
            {kritis.map((h, i) => (
              <li key={i}>
                {h.parameter_nama}: <strong>{h.nilai} {h.satuan ?? ""}</strong> (rujukan{" "}
                {h.ref_teks ?? "—"})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {noOrders.map((no) => (
        <div key={no} className="mb-3">
          <p className="mb-1.5 text-micro tracking-wide text-ink-faint uppercase">
            Hasil {no}
          </p>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-surface-alt">
                  <th className="border-b border-line px-3 py-2 text-left text-label font-medium text-ink-muted">Pemeriksaan</th>
                  <th className="border-b border-line px-3 py-2 text-right text-label font-medium text-ink-muted">Hasil</th>
                  <th className="border-b border-line px-3 py-2 text-left text-label font-medium text-ink-muted">Rujukan</th>
                  <th className="border-b border-line px-3 py-2 text-left text-label font-medium text-ink-muted">Ket.</th>
                </tr>
              </thead>
              <tbody>
                {hasil
                  .filter((h) => h.no_order === no)
                  .map((h, i) => {
                    const krt = h.flag === "LL" || h.flag === "HH";
                    const abn = h.flag === "L" || h.flag === "H";
                    return (
                      <tr key={i} className="border-b border-line last:border-b-0">
                        <td className="px-3 py-1.5">
                          <span className="text-ink">{h.parameter_nama}</span>
                          <span className="ml-1.5 text-meta text-ink-faint">
                            {h.panel_nama}
                          </span>
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right tabular ${
                            krt ? "font-semibold text-danger" : abn ? "text-warning" : "text-ink"
                          }`}
                        >
                          {h.nilai} {h.satuan ?? ""}
                        </td>
                        <td className="px-3 py-1.5 text-meta text-ink-muted">
                          {h.ref_teks ?? "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          {h.flag === "N" ? null : (
                            <span
                              className={`text-micro font-semibold uppercase ${
                                krt ? "text-danger" : "text-warning"
                              }`}
                            >
                              {FLAG_TEKS[h.flag]}
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

      {/* ---------- Order yang masih berjalan ---------- */}
      {berjalan.length > 0 ? (
        <ul className="mb-3 flex flex-col gap-1.5">
          {berjalan.map((o) => (
            <li
              key={o.id}
              className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 ${
                o.sifat_hasil === "ditunggu"
                  ? "border-warning/30 bg-warning-bg"
                  : "border-line bg-surface-alt"
              }`}
            >
              <span className="font-mono text-meta text-brand-700">{o.no_order}</span>
              <span className="min-w-0 flex-1 truncate text-meta text-ink-muted">
                {o.panels ?? "—"}
              </span>
              {Number(o.atas_permintaan_sendiri) === 1 ? (
                <Badge variant="neutral">APS</Badge>
              ) : null}
              {o.prioritas === "cito" ? (
                <Badge variant="danger">
                  <Zap />
                  CITO
                </Badge>
              ) : null}
              {/*
                Sifat hasil ditulis eksplisit, bukan disimpulkan dari prioritas.
                Inilah satu-satunya penanda yang memberi tahu dokter mengapa
                tombol Finalkan menolaknya — dan mengapa pasien masih di klinik.
              */}
              <Badge variant={o.sifat_hasil === "ditunggu" ? "warning" : "info"}>
                {LABEL_SIFAT[o.sifat_hasil]}
              </Badge>
              <span className="text-meta text-ink-faint">{formatJam(o.ordered_at)}</span>
              <Badge variant="neutral">
                {o.status === "baru" ? "Menunggu lab" : "Diproses lab"}
              </Badge>

              {/*
                Dua aksi hanya ditawarkan selagi kunjungan masih boleh
                disunting. Sesudah itu tagihannya mungkin sudah dibayar, dan
                mengubahnya berarti mengubah angka pada struk — server
                menolaknya, jadi tombolnya pun tidak perlu ada.
              */}
              {!terkunci ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={proses}
                    onClick={() =>
                      ubahSifat(o, o.sifat_hasil === "ditunggu" ? "menyusul" : "ditunggu")
                    }
                  >
                    <Clock3 />
                    {o.sifat_hasil === "ditunggu" ? "Jangan ditunggu" : "Tunggu hasilnya"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Batalkan order ${o.no_order}`}
                    onClick={() => {
                      setBatalkan(o);
                      setAlasanBatal("");
                    }}
                  >
                    <Undo2 />
                    Batalkan
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        ---------- Order yang DIBATALKAN ----------
        Ditampilkan, tidak dihilangkan. Order yang lenyap begitu saja membuat
        dokter menunggu hasil yang tidak akan datang tanpa satu pun petunjuk —
        dan pembatalan oleh petugas lab (sampel lisis, pasien menolak) justru
        terjadi di ruangan yang tidak dilihat dokter.
      */}
      {dibatalkan.length > 0 ? (
        <ul className="mb-3 flex flex-col gap-1.5">
          {dibatalkan.map((o) => (
            <li
              key={o.id}
              className="rounded-md border border-dashed border-line-strong bg-surface px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-meta text-ink-faint line-through">
                  {o.no_order}
                </span>
                <span className="min-w-0 flex-1 truncate text-meta text-ink-faint">
                  {o.panels ?? "—"}
                </span>
                <Badge variant="neutral">Dibatalkan</Badge>
              </div>
              {o.alasan_batal ? (
                <p className="mt-1 text-meta text-ink-muted">
                  {o.dibatalkan_oleh ? <strong>{o.dibatalkan_oleh}: </strong> : null}
                  {o.alasan_batal}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <Modal
        open={batalkan !== null}
        onClose={() => setBatalkan(null)}
        size="sm"
        title="Batalkan Order Lab"
        description={
          batalkan
            ? `${batalkan.no_order} — ${batalkan.panels ?? "tanpa panel"}`
            : undefined
        }
        footer={
          <>
            <Button onClick={() => setBatalkan(null)} disabled={proses}>
              Tutup
            </Button>
            <Button variant="danger" onClick={batalkanOrder} disabled={proses}>
              <Undo2 />
              {proses ? "Membatalkan…" : "Batalkan Order"}
            </Button>
          </>
        }
      >
        <p className="mb-2.5 text-meta text-ink-muted">
          Tarif pemeriksaan ini akan dikeluarkan dari tagihan pasien. Bila
          petugas lab sudah menginput hasilnya, pembatalan akan ditolak —
          pemeriksaannya sudah dikerjakan dan reagennya terpakai.
        </p>
        <Field label="Alasan Pembatalan" required>
          <Textarea
            rows={3}
            value={alasanBatal}
            maxLength={200}
            onChange={(e) => setAlasanBatal(e.target.value)}
            placeholder="mis. Salah pilih panel, seharusnya Hematologi Rutin"
          />
        </Field>
      </Modal>

      {/* ---------- Buat order baru ---------- */}
      {terkunci ? (
        orders.length === 0 && hasil.length === 0 ? (
          <p className="text-meta text-ink-faint">
            Tidak ada pemeriksaan laboratorium pada kunjungan ini.
          </p>
        ) : null
      ) : (
        <>
          <Autocomplete
            cari={cariPanelAction}
            placeholder="Cari pemeriksaan — hematologi, gula darah, urinalisa…"
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
                <span className="shrink-0 text-meta text-ink-faint">
                  {Number(p.jumlah_parameter)} parameter
                </span>
                <span className="shrink-0 text-meta text-ink-muted tabular">
                  {formatRupiah(p.tarif)}
                </span>
              </>
            )}
          />

          {panels.length > 0 ? (
            <>
              <ul className="mt-3 flex flex-col gap-1.5">
                {panels.map((p, i) => (
                  <li
                    key={p.panel_id}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-alt px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-body text-ink">
                      {p.nama}
                    </span>
                    <span className="text-body text-ink tabular">
                      {formatRupiah(p.tarif)}
                    </span>
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

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="Prioritas">
                  <Select
                    value={prioritas}
                    onChange={(e) => setPrioritas(e.target.value as "rutin" | "cito")}
                  >
                    <option value="rutin">Rutin</option>
                    <option value="cito">CITO (segera)</option>
                  </Select>
                </Field>
                {/*
                  Pertanyaan yang menentukan seluruh alur pasien, jadi ditanya
                  eksplisit dan bukan disimpulkan dari prioritas. Order CITO
                  pun bisa hasilnya menyusul (dikirim ke lab rujukan hari itu
                  juga tetapi jadi tiga hari), dan order rutin bisa ditunggu.
                  Yang menentukan adalah: apakah hasilnya Anda butuhkan untuk
                  keputusan HARI INI.
                */}
                <Field label="Hasilnya ditunggu?" required>
                  <Select
                    value={sifat}
                    onChange={(e) => setSifat(e.target.value as SifatHasil)}
                  >
                    {SIFAT_HASIL.map((s) => (
                      <option key={s} value={s}>{LABEL_SIFAT[s]}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Catatan Klinis untuk Petugas Lab">
                  <Textarea
                    rows={2}
                    value={catatan}
                    onChange={(e) => setCatatan(e.target.value)}
                    placeholder="Konteks yang perlu diketahui petugas lab — mis. pasien puasa 10 jam"
                  />
                </Field>
              </div>

              <p
                className={`mt-2 rounded-md border px-3 py-2 text-meta ${
                  sifat === "ditunggu"
                    ? "border-warning/25 bg-warning-bg text-ink"
                    : "border-info/25 bg-info-bg text-ink"
                }`}
              >
                {JELAS_SIFAT[sifat]}
              </p>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                <p className="text-meta text-ink-muted">
                  Total{" "}
                  <strong className="text-ink tabular">{formatRupiah(total)}</strong> —
                  langsung masuk tagihan saat order dikirim, karena sampel sudah
                  diambil.
                </p>
                <Button type="button" variant="primary" onClick={kirim} disabled={proses}>
                  <Send />
                  {proses ? "Mengirim…" : "Kirim Order ke Lab"}
                </Button>
              </div>
            </>
          ) : (
            <p className="mt-2 text-meta text-ink-faint">
              Pasien akan kembali ke layar Anda begitu hasilnya keluar.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
