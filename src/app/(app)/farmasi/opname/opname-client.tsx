"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ClipboardCheck, Plus, TriangleAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { formatRupiah } from "@/lib/format";
import {
  batalkanOpnameAction,
  buatOpnameAction,
  finalkanOpnameAction,
  simpanHitunganAction,
} from "../inventory-actions";

// --- Membuka lembar hitung -------------------------------------------

export function BukaOpname({ hariIni, aktif }: { hariIni: string; aktif: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [proses, setProses] = useState(false);
  const [f, setF] = useState({ tanggal: hariIni, tipe: "semua", catatan: "" });

  async function simpan() {
    setProses(true);
    try {
      const h = await buatOpnameAction(f);
      if (!h.ok) { toast.error(h.error, { duration: 7000 }); return; }
      toast.success(`${h.data.no_opname} dibuka — ${h.data.jumlahItem} item siap dihitung.`);
      setOpen(false);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)} disabled={aktif}>
        <Plus />
        Buka Lembar Hitung
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Buka Lembar Hitung Baru"
        description="Saldo sistem seluruh item dipotret saat ini juga."
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={proses}>Batal</Button>
            <Button variant="primary" onClick={simpan} disabled={proses}>
              {proses ? "Membuka…" : "Buka"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tanggal Hitung" required>
            <Input
              type="date"
              value={f.tanggal}
              onChange={(e) => setF({ ...f, tanggal: e.target.value })}
            />
          </Field>
          <Field label="Cakupan" required hint="Opname parsial tetap sah">
            <Select value={f.tipe} onChange={(e) => setF({ ...f, tipe: e.target.value })}>
              <option value="semua">Semua item</option>
              <option value="obat">Obat saja</option>
              <option value="bmhp">BMHP saja</option>
              <option value="alkes">Alkes saja</option>
            </Select>
          </Field>
          <Field label="Catatan" className="sm:col-span-2">
            <Textarea
              rows={2}
              value={f.catatan}
              onChange={(e) => setF({ ...f, catatan: e.target.value })}
              placeholder="Opname rutin akhir bulan, dihitung oleh Apt. Rani dan Sdr. Dimas."
            />
          </Field>
        </div>
        <p className="mt-3 rounded-md border border-line bg-surface-alt px-3 py-2 text-meta text-ink-muted">
          Jumlah fisik awalnya disamakan dengan saldo sistem, sehingga item yang
          tidak sempat dihitung tidak memunculkan selisih palsu. Ubah hanya baris
          yang benar-benar dihitung.
        </p>
      </Modal>
    </>
  );
}

// --- Lembar hitung ----------------------------------------------------

export type BarisHitung = {
  id: number;
  item_id: number;
  kode: string;
  nama: string;
  tipe: string;
  satuan_dasar: string;
  hpp: string;
  qty_sistem: string;
  qty_fisik: string;
  selisih: string;
  catatan: string | null;
  qty_sekarang: string;
};

export function LembarHitung({
  opnameId,
  noOpname,
  baris,
}: {
  opnameId: number;
  noOpname: string;
  baris: BarisHitung[];
}) {
  const router = useRouter();
  const [nilai, setNilai] = useState<Record<number, string>>(() =>
    Object.fromEntries(baris.map((b) => [b.item_id, String(Number(b.qty_fisik))])),
  );
  const [catatan, setCatatan] = useState<Record<number, string>>(() =>
    Object.fromEntries(baris.map((b) => [b.item_id, b.catatan ?? ""])),
  );
  const [menyimpan, setMenyimpan] = useState<number | null>(null);
  const [hanyaSelisih, setHanyaSelisih] = useState(false);
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [proses, setProses] = useState(false);

  function selisihBaris(b: BarisHitung) {
    return Number(nilai[b.item_id] ?? 0) - Number(b.qty_sistem);
  }

  const berselisih = baris.filter((b) => selisihBaris(b) !== 0);
  const nilaiSelisih = berselisih.reduce(
    (n, b) => n + selisihBaris(b) * Number(b.hpp),
    0,
  );
  // Saldo yang bergerak setelah potret diambil — resep yang diserahkan
  // di tengah penghitungan, misalnya.
  const bergerak = baris.filter(
    (b) => Number(b.qty_sekarang) !== Number(b.qty_sistem),
  );

  async function simpanBaris(b: BarisHitung) {
    const v = nilai[b.item_id] ?? "";
    if (v === "" || Number(v) < 0) return;
    if (
      Number(v) === Number(b.qty_fisik) &&
      (catatan[b.item_id] ?? "") === (b.catatan ?? "")
    ) {
      return; // tidak berubah
    }

    setMenyimpan(b.item_id);
    try {
      const h = await simpanHitunganAction({
        opname_id: opnameId,
        item_id: b.item_id,
        qty_fisik: v,
        catatan: catatan[b.item_id] ?? "",
      });
      if (!h.ok) { toast.error(h.error); return; }
      router.refresh();
    } finally {
      setMenyimpan(null);
    }
  }

  async function finalkan() {
    setProses(true);
    try {
      const h = await finalkanOpnameAction(opnameId);
      if (!h.ok) { toast.error(h.error, { duration: 12000 }); return; }
      toast.success(
        `${h.data.no_opname} final — ${h.data.dikoreksi} item dikoreksi (${h.data.naik} lebih, ${h.data.turun} kurang).`,
        { duration: 8000 },
      );
      setKonfirmasi(false);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  const tampil = hanyaSelisih ? berselisih : baris;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-alt px-3 py-2">
        <div className="flex flex-wrap items-center gap-3 text-meta">
          <span className="text-ink-muted">
            Item dihitung <strong className="tabular text-ink">{baris.length}</strong>
          </span>
          <span className="text-ink-muted">
            Berselisih{" "}
            <strong className={`tabular ${berselisih.length > 0 ? "text-warning" : "text-ink"}`}>
              {berselisih.length}
            </strong>
          </span>
          <span className="text-ink-muted">
            Nilai selisih{" "}
            <strong className={`tabular ${nilaiSelisih < 0 ? "text-danger" : "text-ink"}`}>
              {formatRupiah(nilaiSelisih)}
            </strong>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-meta text-ink-muted">
            <input
              type="checkbox"
              checked={hanyaSelisih}
              onChange={(e) => setHanyaSelisih(e.target.checked)}
              className="size-4 accent-[var(--color-brand-600)]"
            />
            Hanya yang berselisih
          </label>
          <BatalkanOpname opnameId={opnameId} noOpname={noOpname} />
          <Button variant="primary" size="sm" onClick={() => setKonfirmasi(true)}>
            <ClipboardCheck />
            Finalkan
          </Button>
        </div>
      </div>

      {bergerak.length > 0 ? (
        <p className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning-bg px-3 py-2 text-meta text-ink">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            <strong>{bergerak.length} item</strong> saldonya berubah setelah lembar
            hitung dibuka (resep atau BMHP yang keluar di sela penghitungan).
            Koreksi tetap dihitung dari selisih terhadap potret, sehingga
            pengeluaran itu tidak ikut terhapus.
          </span>
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full border-collapse text-body">
          <thead>
            <tr className="bg-surface-alt">
              {["Item", "Saldo Sistem", "Jumlah Fisik", "Selisih", "Nilai", "Keterangan", "Saldo Kini"].map((c) => (
                <th
                  key={c}
                  className="border-b border-line px-3 py-2 text-left text-label font-medium whitespace-nowrap text-ink-muted"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tampil.map((b) => {
              const d = selisihBaris(b);
              const geser = Number(b.qty_sekarang) !== Number(b.qty_sistem);
              return (
                <tr key={b.id} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-1.5">
                    <span className="text-ink">{b.nama}</span>
                    <span className="ml-1.5 font-mono text-micro text-ink-faint">{b.kode}</span>
                  </td>
                  <td className="px-3 py-1.5 tabular text-ink-muted">
                    {Number(b.qty_sistem)}{" "}
                    <span className="text-micro text-ink-faint">{b.satuan_dasar}</span>
                  </td>
                  <td className="px-3 py-1.5">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={nilai[b.item_id] ?? ""}
                      onChange={(e) =>
                        setNilai((v) => ({ ...v, [b.item_id]: e.target.value }))
                      }
                      onBlur={() => simpanBaris(b)}
                      className={`h-8 w-24 text-meta ${d !== 0 ? "border-warning" : ""}`}
                      disabled={menyimpan === b.item_id}
                    />
                  </td>
                  <td
                    className={`px-3 py-1.5 font-medium tabular ${
                      d === 0 ? "text-ink-faint" : d > 0 ? "text-success" : "text-danger"
                    }`}
                  >
                    {d === 0 ? "—" : d > 0 ? `+${d}` : d}
                  </td>
                  <td className="px-3 py-1.5 tabular text-ink-muted">
                    {d === 0 ? "—" : formatRupiah(d * Number(b.hpp))}
                  </td>
                  <td className="px-3 py-1.5">
                    <Input
                      value={catatan[b.item_id] ?? ""}
                      onChange={(e) =>
                        setCatatan((v) => ({ ...v, [b.item_id]: e.target.value }))
                      }
                      onBlur={() => simpanBaris(b)}
                      className="h-8 w-48 text-meta"
                      placeholder={d !== 0 ? "Wajib bila ada selisih" : ""}
                      aria-invalid={d !== 0 && (catatan[b.item_id] ?? "") === ""}
                    />
                  </td>
                  <td className="px-3 py-1.5 tabular">
                    {geser ? (
                      <Badge variant="warning">{Number(b.qty_sekarang)}</Badge>
                    ) : (
                      <span className="text-ink-faint">{Number(b.qty_sekarang)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {tampil.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-meta text-ink-faint">
          Tidak ada item yang berselisih — fisik cocok dengan sistem.
        </p>
      ) : null}

      <Modal
        open={konfirmasi}
        onClose={() => setKonfirmasi(false)}
        title={`Finalkan ${noOpname}?`}
        description="Setelah final, koreksi masuk ke kartu stok dan tidak bisa dibatalkan."
        footer={
          <>
            <Button onClick={() => setKonfirmasi(false)} disabled={proses}>Batal</Button>
            <Button variant="primary" onClick={finalkan} disabled={proses}>
              {proses ? "Memproses…" : `Finalkan ${berselisih.length} koreksi`}
            </Button>
          </>
        }
      >
        {berselisih.length === 0 ? (
          <p className="text-body text-ink">
            Tidak ada selisih. Opname akan ditutup tanpa satu pun koreksi stok —
            ini hasil yang baik dan tetap tercatat sebagai bukti penghitungan.
          </p>
        ) : (
          <>
            <p className="text-body text-ink">
              {berselisih.length} item akan dikoreksi, senilai{" "}
              <strong className={nilaiSelisih < 0 ? "text-danger" : "text-success"}>
                {formatRupiah(nilaiSelisih)}
              </strong>
              .
            </p>
            <ul className="mt-3 flex max-h-64 flex-col gap-1 overflow-y-auto">
              {berselisih.map((b) => {
                const d = selisihBaris(b);
                return (
                  <li
                    key={b.id}
                    className="flex items-center justify-between gap-3 rounded-sm border border-line px-2.5 py-1.5 text-meta"
                  >
                    <span className="truncate text-ink">{b.nama}</span>
                    <span className={`shrink-0 tabular ${d > 0 ? "text-success" : "text-danger"}`}>
                      {Number(b.qty_sistem)} → {Number(nilai[b.item_id])} ({d > 0 ? `+${d}` : d})
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Modal>
    </div>
  );
}

// --- Pembatalan -------------------------------------------------------

function BatalkanOpname({ opnameId, noOpname }: { opnameId: number; noOpname: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [proses, setProses] = useState(false);

  async function batalkan() {
    setProses(true);
    try {
      const h = await batalkanOpnameAction(opnameId);
      if (!h.ok) { toast.error(h.error); return; }
      toast.success(`${h.data.no_opname} dibatalkan.`);
      setOpen(false);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <X />
        Batalkan
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Batalkan ${noOpname}?`}
        description="Hitungan yang sudah diinput ikut hangus dan stok tidak dikoreksi."
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={proses}>Kembali</Button>
            <Button variant="danger" onClick={batalkan} disabled={proses}>
              {proses ? "Membatalkan…" : "Ya, batalkan"}
            </Button>
          </>
        }
      >
        <p className="text-body text-ink">
          Lembar ini tetap tersimpan sebagai riwayat berstatus <em>batal</em>,
          tetapi tidak menghasilkan koreksi stok apa pun.
        </p>
      </Modal>
    </>
  );
}
