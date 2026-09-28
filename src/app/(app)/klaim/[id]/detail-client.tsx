"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Banknote, CheckCheck, Send, Trash2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { formatRupiah } from "@/lib/format";
import { LABEL_METODE_KLAIM, METODE_BAYAR_KLAIM } from "@/lib/validations/klaim";
import {
  ajukanKlaimAction,
  bayarKlaimAction,
  batalkanKlaimAction,
  hapusKlaimDraftAction,
  verifikasiKlaimAction,
} from "../actions";

export type BarisDetail = {
  id: number;
  noInvoice: string;
  tanggal: string;
  noRm: string;
  pasien: string;
  noAnggota: string | null;
  diajukan: number;
  disetujui: number | null;
  alasan: string | null;
  isVoid: boolean;
};

export type PembayaranBaris = {
  id: number;
  tanggal: string;
  jumlah: number;
  metode: string;
  ref: string | null;
  catatan: string | null;
  pencatat: string;
};

export function DetailKlaim({
  claimId,
  status,
  noKlaim,
  totalDiajukan,
  totalDisetujui,
  dibayar,
  sisa,
  baris,
  pembayaran,
  hariIni,
}: {
  claimId: number;
  status: string;
  noKlaim: string;
  totalDiajukan: number;
  totalDisetujui: number;
  dibayar: number;
  sisa: number;
  baris: BarisDetail[];
  pembayaran: PembayaranBaris[];
  hariIni: string;
}) {
  const router = useRouter();
  const [proses, setProses] = useState(false);

  const [verifikasi, setVerifikasi] = useState<Record<number, string>>({});
  const [alasan, setAlasan] = useState<Record<number, string>>({});
  const [modeVerifikasi, setModeVerifikasi] = useState(false);

  const [bayar, setBayar] = useState(false);
  const [formBayar, setFormBayar] = useState({
    tanggal: hariIni,
    jumlah: "",
    metode: "transfer",
    ref: "",
    catatan: "",
  });

  const [batalkan, setBatalkan] = useState(false);
  const [alasanBatal, setAlasanBatal] = useState("");
  const [hapus, setHapus] = useState(false);

  const aktif = baris.filter((b) => !b.isVoid);

  async function jalankan<T>(fn: () => Promise<T>) {
    setProses(true);
    try {
      return await fn();
    } finally {
      setProses(false);
    }
  }

  async function ajukan() {
    await jalankan(async () => {
      const hasil = await ajukanKlaimAction(claimId);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 7000 });
        return;
      }
      toast.success(
        `${hasil.data.noKlaim} diajukan. Jatuh tempo ${hasil.data.jatuhTempo}.`,
      );
      router.refresh();
    });
  }

  async function simpanVerifikasi() {
    const isi = aktif
      .filter((b) => verifikasi[b.id] !== undefined && verifikasi[b.id] !== "")
      .map((b) => ({
        claim_item_id: b.id,
        nilai_disetujui: Number(verifikasi[b.id]),
        alasan_koreksi: alasan[b.id] ?? "",
      }));

    if (isi.length === 0) {
      toast.error("Belum ada nilai disetujui yang diisi.");
      return;
    }

    await jalankan(async () => {
      const hasil = await verifikasiKlaimAction(claimId, { baris: isi });
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 8000 });
        return;
      }
      toast.success(
        hasil.data.dikoreksi > 0
          ? `Disetujui ${formatRupiah(hasil.data.totalDisetujui)} — ${hasil.data.dikoreksi} baris dipotong.`
          : `Disetujui penuh ${formatRupiah(hasil.data.totalDisetujui)}.`,
      );
      setModeVerifikasi(false);
      router.refresh();
    });
  }

  async function simpanPembayaran() {
    await jalankan(async () => {
      const hasil = await bayarKlaimAction(claimId, formBayar);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 8000 });
        return;
      }
      toast.success(
        hasil.data.lunas
          ? `Klaim LUNAS — total diterima ${formatRupiah(hasil.data.dibayar)}.`
          : `Pembayaran dicatat. Sisa ${formatRupiah(hasil.data.sisa)}.`,
      );
      setBayar(false);
      setFormBayar({ ...formBayar, jumlah: "", ref: "", catatan: "" });
      router.refresh();
    });
  }

  async function jalankanBatal() {
    await jalankan(async () => {
      const hasil = await batalkanKlaimAction(claimId, alasanBatal);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 8000 });
        return;
      }
      toast.success(
        `${hasil.data.noKlaim} dibatalkan — ${hasil.data.barisDilepas} tagihan bisa diklaim ulang.`,
      );
      setBatalkan(false);
      router.refresh();
    });
  }

  async function jalankanHapus() {
    await jalankan(async () => {
      const hasil = await hapusKlaimDraftAction(claimId);
      if (!hasil.ok) {
        toast.error(hasil.error);
        return;
      }
      toast.success("Klaim draft dihapus.");
      router.push("/klaim");
    });
  }

  return (
    <>
      {/* ---------- Bilah tindakan ---------- */}
      <Card className="no-print">
        <CardHeader>
          <CardTitle icon={Banknote}>Tindakan</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {status === "draft" ? (
              <>
                <Button variant="ghost" onClick={() => setHapus(true)} disabled={proses}>
                  <Trash2 />
                  Hapus Draft
                </Button>
                <Button variant="primary" onClick={ajukan} disabled={proses}>
                  <Send />
                  {proses ? "Memproses…" : "Ajukan ke Penjamin"}
                </Button>
              </>
            ) : null}

            {["diajukan", "disetujui"].includes(status) ? (
              <>
                <Button
                  onClick={() => setModeVerifikasi((v) => !v)}
                  disabled={proses}
                >
                  <CheckCheck />
                  {modeVerifikasi ? "Tutup Verifikasi" : "Input Hasil Verifikasi"}
                </Button>
                <Button variant="primary" onClick={() => setBayar(true)} disabled={proses}>
                  <Banknote />
                  Catat Pembayaran
                </Button>
                <Button variant="ghost" onClick={() => setBatalkan(true)} disabled={proses}>
                  <Undo2 />
                  Batalkan Klaim
                </Button>
              </>
            ) : null}

            {status === "lunas" ? (
              <Badge variant="success">Lunas — tidak ada tindakan tersisa</Badge>
            ) : null}
            {status === "batal" ? (
              <Badge variant="danger">
                Dibatalkan — tagihannya sudah dilepas untuk diklaim ulang
              </Badge>
            ) : null}
          </div>
        </CardHeader>

        {status === "draft" ? (
          <p className="text-meta text-ink-muted">
            Klaim masih <strong>draft</strong>: belum dikirim ke penjamin dan umur
            piutangnya belum berjalan. Jatuh tempo baru ditetapkan saat diajukan,
            dihitung dari termin kontrak — dan setelah itu <strong>dibekukan</strong>,
            supaya perubahan termin tidak mengubah umur piutang yang sudah jalan.
          </p>
        ) : null}
      </Card>

      {/* ---------- Baris tagihan ---------- */}
      <Card>
        <CardHeader>
          <CardTitle icon={CheckCheck}>Rincian Tagihan</CardTitle>
          <Badge variant="brand">{aktif.length}</Badge>
        </CardHeader>

        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-line bg-surface-alt text-left text-label text-ink-muted">
                <th className="px-2 py-1.5">Tanggal</th>
                <th className="px-2 py-1.5">Invoice</th>
                <th className="px-2 py-1.5">Pasien</th>
                <th className="px-2 py-1.5 text-right">Diajukan</th>
                <th className="px-2 py-1.5 text-right">Disetujui</th>
                <th className="px-2 py-1.5">Alasan Koreksi</th>
              </tr>
            </thead>
            <tbody>
              {baris.map((b) => {
                const dipotong =
                  b.disetujui !== null && b.disetujui < b.diajukan;
                return (
                  <tr
                    key={b.id}
                    className={`border-b border-line last:border-b-0 ${
                      b.isVoid ? "opacity-50 line-through" : ""
                    } ${dipotong ? "bg-warning-bg" : ""}`}
                  >
                    <td className="px-2 py-1.5 text-meta">{b.tanggal.slice(0, 10)}</td>
                    <td className="px-2 py-1.5 font-mono text-meta">{b.noInvoice}</td>
                    <td className="px-2 py-1.5">
                      {b.pasien}
                      <span className="ml-1.5 font-mono text-meta text-ink-faint">
                        {b.noRm}
                      </span>
                      {b.noAnggota ? (
                        <span className="block font-mono text-meta text-ink-faint">
                          {b.noAnggota}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular">
                      {formatRupiah(b.diajukan)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular">
                      {modeVerifikasi && !b.isVoid ? (
                        <Input
                          type="number" min={0} max={b.diajukan}
                          value={verifikasi[b.id] ?? String(b.disetujui ?? b.diajukan)}
                          onChange={(e) =>
                            setVerifikasi({ ...verifikasi, [b.id]: e.target.value })
                          }
                          className="h-8 w-28 text-right"
                          aria-label={`Nilai disetujui ${b.noInvoice}`}
                        />
                      ) : b.disetujui === null ? (
                        <span className="text-ink-faint">belum</span>
                      ) : (
                        <span className={dipotong ? "font-medium text-warning" : ""}>
                          {formatRupiah(b.disetujui)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {modeVerifikasi && !b.isVoid ? (
                        <Input
                          value={alasan[b.id] ?? b.alasan ?? ""}
                          onChange={(e) =>
                            setAlasan({ ...alasan, [b.id]: e.target.value })
                          }
                          placeholder="Wajib bila dipotong"
                          className="h-8"
                          aria-label={`Alasan koreksi ${b.noInvoice}`}
                        />
                      ) : (
                        <span className="text-meta text-ink-muted">
                          {b.alasan ?? "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line-strong bg-surface-alt font-medium">
                <td className="px-2 py-1.5" colSpan={3}>
                  Total
                </td>
                <td className="px-2 py-1.5 text-right tabular">
                  {formatRupiah(totalDiajukan)}
                </td>
                <td className="px-2 py-1.5 text-right tabular">
                  {totalDisetujui > 0 ? formatRupiah(totalDisetujui) : "—"}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {modeVerifikasi ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <p className="text-meta text-ink-muted">
              Baris yang <strong>dipotong wajib disertai alasan</strong>. Alasan itulah
              satu-satunya bahan untuk memperbaiki pengajuan berikutnya — tanpa itu,
              klinik tahu ia dipotong tetapi tidak pernah tahu sebabnya.
            </p>
            <Button variant="primary" onClick={simpanVerifikasi} disabled={proses}>
              {proses ? "Menyimpan…" : "Simpan Verifikasi"}
            </Button>
          </div>
        ) : null}
      </Card>

      {/* ---------- Pembayaran ---------- */}
      <Card>
        <CardHeader>
          <CardTitle icon={Banknote}>Pembayaran Penjamin</CardTitle>
          <Badge variant={sisa > 0 ? "warning" : "success"}>
            {sisa > 0 ? `Sisa ${formatRupiah(sisa)}` : "Lunas"}
          </Badge>
        </CardHeader>

        {pembayaran.length === 0 ? (
          <p className="text-meta text-ink-faint">
            Belum ada pembayaran masuk. Penjamin boleh membayar bertahap —
            setiap kali uang masuk, catat di sini.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {pembayaran.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-alt px-3 py-1.5"
              >
                <span className="text-meta text-ink-muted">{p.tanggal.slice(0, 10)}</span>
                <span className="min-w-0 flex-1 text-meta text-ink-muted">
                  {LABEL_METODE_KLAIM[p.metode as keyof typeof LABEL_METODE_KLAIM] ??
                    p.metode}
                  {p.ref ? ` · ${p.ref}` : ""}
                  {p.catatan ? ` · ${p.catatan}` : ""}
                  <span className="block text-micro text-ink-faint">
                    dicatat {p.pencatat}
                  </span>
                </span>
                <span className="text-body font-medium tabular text-success">
                  {formatRupiah(p.jumlah)}
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-2 border-t border-line px-3 pt-2 text-body font-medium">
              <span>Total diterima</span>
              <span className="tabular">{formatRupiah(dibayar)}</span>
            </li>
          </ul>
        )}
      </Card>

      {/* ---------- Modal pembayaran ---------- */}
      <Modal
        open={bayar}
        onClose={() => setBayar(false)}
        title="Catat Pembayaran Penjamin"
        description={`${noKlaim} — sisa ${formatRupiah(sisa)}`}
        footer={
          <>
            <Button onClick={() => setBayar(false)} disabled={proses}>
              Batal
            </Button>
            <Button variant="primary" onClick={simpanPembayaran} disabled={proses}>
              {proses ? "Menyimpan…" : "Simpan"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tanggal Terima" required>
            <Input
              type="date"
              value={formBayar.tanggal}
              max={hariIni}
              onChange={(e) => setFormBayar({ ...formBayar, tanggal: e.target.value })}
            />
          </Field>
          <Field label="Jumlah" required hint={`Maksimal ${formatRupiah(sisa)}`}>
            <Input
              type="number" min={1}
              value={formBayar.jumlah}
              onChange={(e) => setFormBayar({ ...formBayar, jumlah: e.target.value })}
            />
          </Field>
          <Field label="Metode" required>
            <Select
              value={formBayar.metode}
              onChange={(e) => setFormBayar({ ...formBayar, metode: e.target.value })}
            >
              {METODE_BAYAR_KLAIM.map((m) => (
                <option key={m} value={m}>
                  {LABEL_METODE_KLAIM[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="No. Bukti / Giro">
            <Input
              value={formBayar.ref}
              onChange={(e) => setFormBayar({ ...formBayar, ref: e.target.value })}
            />
          </Field>
          <Field label="Catatan" className="sm:col-span-2">
            <Input
              value={formBayar.catatan}
              onChange={(e) => setFormBayar({ ...formBayar, catatan: e.target.value })}
            />
          </Field>
        </div>
      </Modal>

      {/* ---------- Modal pembatalan ---------- */}
      <Modal
        open={batalkan}
        onClose={() => setBatalkan(false)}
        title="Batalkan klaim ini?"
        description={noKlaim}
        footer={
          <>
            <Button onClick={() => setBatalkan(false)} disabled={proses}>
              Tidak
            </Button>
            <Button
              variant="danger"
              onClick={jalankanBatal}
              disabled={proses || alasanBatal.trim().length < 3}
            >
              {proses ? "Memproses…" : "Batalkan Klaim"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-body text-ink">
            Seluruh tagihan di dalamnya akan <strong>dilepas</strong> sehingga bisa
            masuk klaim baru. Barisnya tidak dihapus melainkan ditandai batal —
            berkas yang pernah diajukan ke penjamin adalah peristiwa yang
            benar-benar terjadi, dan riwayat pengajuan yang gagal justru yang
            paling dibutuhkan saat mengajukan ulang.
          </p>
          {dibayar > 0 ? (
            <p className="rounded-md border border-danger/25 bg-danger-bg px-3 py-2 text-meta text-danger">
              Klaim ini sudah menerima {formatRupiah(dibayar)}. Pembatalan akan
              ditolak — uang yang sudah diterima tidak bisa dianggap tidak pernah
              diterima.
            </p>
          ) : null}
          <Field label="Alasan Pembatalan" required>
            <Textarea
              value={alasanBatal}
              onChange={(e) => setAlasanBatal(e.target.value)}
              placeholder="Mis. berkas ditolak penjamin, periode salah, data pasien perlu diperbaiki"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={hapus}
        onClose={() => setHapus(false)}
        title="Hapus klaim draft?"
        description={noKlaim}
        footer={
          <>
            <Button onClick={() => setHapus(false)} disabled={proses}>
              Tidak
            </Button>
            <Button variant="danger" onClick={jalankanHapus} disabled={proses}>
              {proses ? "Menghapus…" : "Hapus"}
            </Button>
          </>
        }
      >
        <p className="text-body text-ink">
          Draft belum pernah dikirim ke penjamin, jadi menghapusnya tidak
          menghilangkan jejak apa pun yang perlu dipertanggungjawabkan.
          Tagihan di dalamnya kembali tersedia untuk klaim lain.
        </p>
      </Modal>
    </>
  );
}
