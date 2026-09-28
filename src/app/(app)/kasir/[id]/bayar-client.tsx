"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useReactToPrint } from "react-to-print";
import toast from "react-hot-toast";
import { Banknote, CheckCircle2, Printer, Receipt, Undo2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { formatDesimal, formatRupiah } from "@/lib/format";
import { KATEGORI_LABEL } from "@/lib/billing-labels";
import { METODE_BAYAR, METODE_LABEL } from "@/lib/validations/cashier";
import { batalkanPembayaranAction, bayarAction } from "../actions";
import { Struk, type BarisStruk } from "./struk";

const BUTUH_REF = ["qris", "transfer", "kartu_debit", "kartu_kredit"];
const PECAHAN = [5000, 10000, 20000, 50000, 100000];

export function BayarClient({
  billingId,
  baris,
  sudahLunas,
  bisaDibayar,
  halanganBatal,
  pembulatanKe,
  penjamin,
  struk,
}: {
  billingId: number;
  baris: BarisStruk[];
  sudahLunas: boolean;
  bisaDibayar: boolean;
  /**
   * Sebab pembayaran ini tidak boleh dibatalkan, atau `null` bila boleh.
   * Dihitung di server — lihat `alasanTakBolehBatal()`.
   */
  halanganBatal: string | null;
  pembulatanKe: number;
  /**
   * Penjamin kunjungan ini, bila ada.
   *
   * `plafon` 0 = tanpa batas. Angkanya dikirim apa adanya, bukan hasil
   * pembagian di server, supaya layar bisa menghitung ulang saat kasir
   * mengubah diskon — pembagian tanggungan berubah bersama totalnya.
   */
  penjamin: { nama: string; jenis: string; plafon: number; noAnggota: string | null } | null;
  struk: {
    namaKlinik: string;
    alamatKlinik: string | null;
    teleponKlinik: string | null;
    noInvoice: string;
    tanggal: string;
    pasien: string;
    noRm: string;
    poli: string;
    dokter: string;
    kasir: string;
    /** Nilai tersimpan — dipakai untuk mencetak ulang struk yang sudah lunas. */
    tersimpan: {
      subtotal: number;
      diskon: number;
      pembulatan: number;
      total: number;
      dibayar: number;
      kembalian: number;
      metode: string;
      noRef: string | null;
    };
  };
}) {
  const router = useRouter();
  const strukRef = useRef<HTMLDivElement>(null);
  const [metode, setMetode] = useState<string>("tunai");
  const [ref, setRef] = useState("");
  const [diskon, setDiskon] = useState(0);
  const [uang, setUang] = useState(0);
  const [catatan, setCatatan] = useState("");
  const [proses, setProses] = useState(false);
  const [selesai, setSelesai] = useState(sudahLunas);
  const [batalkan, setBatalkan] = useState(false);
  const [alasanBatal, setAlasanBatal] = useState("");

  const cetakStruk = useReactToPrint({
    contentRef: strukRef,
    documentTitle: `Struk ${struk.noInvoice}`,
  });

  const subtotal = useMemo(
    () => baris.reduce((n, b) => n + b.subtotal, 0),
    [baris],
  );

  // Pembulatan ke bawah supaya pasien tidak pernah membayar lebih dari
  // yang tertera pada rincian. Sama persis dengan hitungan di server.
  const setelahDiskon = Math.max(0, subtotal - diskon);
  const pembulatan = pembulatanKe > 1 ? -(setelahDiskon % pembulatanKe) : 0;
  const total = setelahDiskon + pembulatan;

  const tunai = metode === "tunai";
  /*
   * Pembagian tanggungan dihitung ulang di layar setiap kali diskon
   * berubah — server tetap menghitungnya sendiri saat menyimpan
   * (`bagiTanggungan()` di `lib/penjamin.ts` adalah sumber tunggalnya).
   * Yang di sini hanya cermin, supaya angka yang dilihat kasir dan pasien
   * sama dengan yang akan tercatat.
   */
  const tanggungPenjamin = !penjamin
    ? 0
    : penjamin.plafon <= 0
      ? total
      : Math.min(total, penjamin.plafon);
  const tanggungPasien = total - tanggungPenjamin;
  const melebihiPlafon = Boolean(penjamin) && penjamin!.plafon > 0 && total > penjamin!.plafon;

  const kurang = tunai && uang < tanggungPasien;
  const kembalian = tunai ? Math.max(0, uang - tanggungPasien) : 0;

  // Ketika sudah lunas, struk memakai nilai tersimpan; sebelum itu, memakai
  // nilai yang sedang dihitung di layar.
  const nilaiStruk = selesai
    ? struk.tersimpan
    : {
        subtotal,
        diskon,
        pembulatan,
        total,
        dibayar: tunai ? uang : total,
        kembalian,
        metode,
        noRef: ref || null,
      };

  async function bayar() {
    setProses(true);
    try {
      const hasil = await bayarAction(billingId, {
        payment_method: metode,
        payment_ref: ref,
        diskon,
        dibayar: tunai ? uang : total,
        catatan,
      });

      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 7000 });
        return;
      }

      setSelesai(true);
      toast.success(
        hasil.data.kembalian > 0
          ? `Lunas. Kembalian ${formatRupiah(hasil.data.kembalian)}.`
          : "Pembayaran berhasil. Kunjungan ditutup.",
      );
      router.refresh();
      // Struk langsung dicetak — ini yang dinanti pasien di depan meja.
      setTimeout(() => cetakStruk(), 300);
    } finally {
      setProses(false);
    }
  }

  async function batalkanBayar() {
    setProses(true);
    try {
      const hasil = await batalkanPembayaranAction(billingId, alasanBatal);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 9000 });
        return;
      }
      setBatalkan(false);
      setAlasanBatal("");
      setSelesai(false);
      toast.success(
        `Pembayaran ${hasil.data.noInvoice} dibatalkan. Tagihan kembali ke antrean kasir.`,
        { duration: 7000 },
      );
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  const kategori = [...new Set(baris.map((b) => b.kategori))];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      {/* ---------- Rincian ---------- */}
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle icon={Receipt}>Rincian Tagihan</CardTitle>
            <Badge variant={selesai ? "success" : "warning"}>
              {selesai ? "Lunas" : "Belum dibayar"}
            </Badge>
          </CardHeader>

          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-body">
              <tbody>
                {kategori.map((k) => (
                  <>
                    <tr key={k} className="bg-surface-alt">
                      <td
                        colSpan={3}
                        className="border-b border-line px-3 py-1.5 text-label font-medium text-ink-muted"
                      >
                        {KATEGORI_LABEL[k] ?? k}
                      </td>
                    </tr>
                    {baris
                      .filter((b) => b.kategori === k)
                      .map((b, i) => (
                        <tr key={`${k}-${i}`} className="border-b border-line">
                          <td className="px-3 py-1.5 pl-5 text-ink">{b.deskripsi}</td>
                          <td className="px-3 py-1.5 text-right text-meta text-ink-faint tabular">
                            {b.qty > 1 ? `${formatDesimal(b.qty)} × ${formatRupiah(b.harga_satuan)}` : ""}
                          </td>
                          <td className="px-3 py-1.5 text-right text-ink tabular">
                            {formatRupiah(b.subtotal)}
                          </td>
                        </tr>
                      ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/*
            Tidak ada kolom diagnosa di sini, dan tidak ada yang bisa
            ditambahkan: server memang tidak mengirimkannya.
          */}
          <p className="mt-2.5 text-meta text-ink-faint">
            Rincian ini hanya memuat komponen biaya. Data klinis pasien tidak
            dikirim ke layar kasir.
          </p>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle icon={Printer}>Pratinjau Struk</CardTitle>
            <span className="text-meta text-ink-faint">Thermal 80 mm · monokrom</span>
          </CardHeader>
          <Struk
            ref={strukRef}
            namaKlinik={struk.namaKlinik}
            alamatKlinik={struk.alamatKlinik}
            teleponKlinik={struk.teleponKlinik}
            noInvoice={struk.noInvoice}
            tanggal={struk.tanggal}
            pasien={struk.pasien}
            noRm={struk.noRm}
            poli={struk.poli}
            dokter={struk.dokter}
            kasir={struk.kasir}
            baris={baris}
            {...nilaiStruk}
          />
        </Card>
      </div>

      {/* ---------- Pembayaran ---------- */}
      <div className="flex flex-col gap-4">
        <Card className="lg:sticky lg:top-0">
          <CardHeader>
            <CardTitle icon={Wallet}>Pembayaran</CardTitle>
          </CardHeader>

          <div className="flex flex-col gap-2 border-b border-line pb-3 text-body">
            <div className="flex justify-between">
              <span className="text-ink-muted">Subtotal</span>
              <span className="text-ink tabular">{formatRupiah(nilaiStruk.subtotal)}</span>
            </div>
            {nilaiStruk.diskon > 0 ? (
              <div className="flex justify-between">
                <span className="text-ink-muted">Diskon</span>
                <span className="text-danger tabular">
                  −{formatRupiah(nilaiStruk.diskon)}
                </span>
              </div>
            ) : null}
            {nilaiStruk.pembulatan !== 0 ? (
              <div className="flex justify-between">
                <span className="text-ink-muted">Pembulatan</span>
                <span className="text-ink-muted tabular">
                  {formatRupiah(nilaiStruk.pembulatan)}
                </span>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between">
              <span className="text-h2 text-ink">Total</span>
              <span
                className={`tabular ${penjamin ? "text-h1 text-ink-muted" : "text-display text-brand-700"}`}
              >
                {formatRupiah(nilaiStruk.total)}
              </span>
            </div>

            {/*
              Bila ada penjamin, angka BESAR-nya adalah bagian PASIEN — itulah
              satu-satunya angka yang perlu diminta kasir. Total tetap tampil,
              tetapi diredupkan: menonjolkan total pada pasien yang hanya
              menanggung sebagian adalah cara paling mudah menagih kelebihan.
            */}
            {penjamin ? (
              <>
                <div className="flex justify-between border-t border-line pt-2">
                  <span className="text-ink-muted">
                    Ditanggung {penjamin.nama}
                    {penjamin.noAnggota ? (
                      <span className="block font-mono text-meta text-ink-faint">
                        {penjamin.noAnggota}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-success tabular">
                    −{formatRupiah(tanggungPenjamin)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-h2 text-ink">Dibayar Pasien</span>
                  <span className="text-display text-brand-700 tabular">
                    {formatRupiah(tanggungPasien)}
                  </span>
                </div>
                {melebihiPlafon ? (
                  <p className="rounded-md border border-warning/30 bg-warning-bg px-2.5 py-1.5 text-meta text-ink">
                    Tagihan melebihi plafon {formatRupiah(penjamin.plafon)} per
                    kunjungan. Selisihnya menjadi tanggungan pasien.
                  </p>
                ) : null}
                {tanggungPasien === 0 ? (
                  <p className="rounded-md border border-info/25 bg-info-bg px-2.5 py-1.5 text-meta text-ink">
                    Pasien tidak membayar apa pun. Tagihan ditandai lunas dengan
                    metode <strong>Ditanggung Penjamin</strong>, dan nilainya
                    masuk piutang penjamin — bukan kas kasir.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>

          {selesai ? (
            <div className="mt-3 flex flex-col gap-3">
              <p className="flex items-center gap-2 rounded-md border border-success/25 bg-success-bg px-3 py-2.5 text-body text-success">
                <CheckCircle2 className="size-4" aria-hidden />
                Sudah dibayar via{" "}
                {METODE_LABEL[nilaiStruk.metode as keyof typeof METODE_LABEL] ??
                  nilaiStruk.metode}
              </p>
              <Button type="button" variant="primary" onClick={() => cetakStruk()}>
                <Printer />
                Cetak Ulang Struk
              </Button>

              {/*
                Pembatalan pembayaran ditempatkan DI BAWAH cetak ulang dan
                bergaya sekunder — ia jarang dipakai dan tidak boleh tertekan
                karena kebetulan berada di tempat tombol utama.

                Bila ada halangan, sebabnya ditampilkan menggantikan tombol.
                Menyembunyikannya begitu saja membuat kasir mengira fiturnya
                tidak ada; menampilkan tombol yang pasti ditolak membuatnya
                menebak-nebak di depan pasien.
              */}
              {halanganBatal ? (
                <p className="rounded-md border border-line bg-surface-alt px-3 py-2 text-meta text-ink-muted">
                  Pembayaran tidak bisa dibatalkan: {halanganBatal}
                </p>
              ) : (
                <Button type="button" onClick={() => setBatalkan(true)}>
                  <Undo2 />
                  Batalkan Pembayaran
                </Button>
              )}
            </div>
          ) : !bisaDibayar ? (
            <p className="mt-3 rounded-md border border-warning/25 bg-warning-bg px-3 py-2.5 text-meta text-warning">
              Pasien belum selesai di unit layanan lain. Tagihan baru bisa
              diproses setelah statusnya “menunggu kasir”.
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              <Field label="Metode Pembayaran" required>
                <Select value={metode} onChange={(e) => setMetode(e.target.value)}>
                  {METODE_BAYAR.map((m) => (
                    <option key={m} value={m}>
                      {METODE_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </Field>

              {BUTUH_REF.includes(metode) ? (
                <Field
                  label="No. Referensi / Approval"
                  required
                  hint="Dibutuhkan untuk rekonsiliasi dengan mutasi bank"
                >
                  <Input
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                    placeholder="mis. 000123456789"
                    className="font-mono"
                  />
                </Field>
              ) : null}

              <Field label="Diskon (Rp)">
                <Input
                  type="number"
                  min={0}
                  max={subtotal}
                  step={500}
                  value={diskon}
                  onChange={(e) => setDiskon(Math.max(0, Number(e.target.value)))}
                />
              </Field>

              {tunai ? (
                <>
                  <Field
                    label="Uang Diterima (Rp)"
                    required
                    error={kurang ? "Uang diterima kurang dari total" : undefined}
                  >
                    <Input
                      type="number"
                      min={0}
                      step={500}
                      value={uang}
                      aria-invalid={kurang}
                      onChange={(e) => setUang(Math.max(0, Number(e.target.value)))}
                      className="text-right text-h2"
                    />
                  </Field>

                  {/* Tombol pecahan — kasir jarang sempat mengetik nominal penuh. */}
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setUang(total)}
                      className="rounded-full border border-brand-500 bg-brand-50 px-2.5 py-1 text-micro text-brand-700"
                    >
                      Uang pas
                    </button>
                    {PECAHAN.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setUang((u) => u + p)}
                        className="rounded-full border border-line bg-surface px-2.5 py-1 text-micro text-ink-muted hover:border-line-strong hover:text-ink"
                      >
                        +{p / 1000}rb
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setUang(0)}
                      className="rounded-full border border-line bg-surface px-2.5 py-1 text-micro text-ink-faint hover:text-ink"
                    >
                      Reset
                    </button>
                  </div>

                  <div className="flex items-baseline justify-between rounded-md border border-line bg-surface-alt px-3 py-2">
                    <span className="text-label text-ink-muted">Kembalian</span>
                    <span className="text-h1 text-ink tabular">
                      {formatRupiah(kembalian)}
                    </span>
                  </div>
                </>
              ) : null}

              <Field label="Catatan">
                <Textarea
                  rows={2}
                  value={catatan}
                  onChange={(e) => setCatatan(e.target.value)}
                />
              </Field>

              <Button
                type="button"
                variant="primary"
                onClick={bayar}
                disabled={proses || kurang || (BUTUH_REF.includes(metode) && !ref.trim())}
              >
                <Banknote />
                {proses ? "Memproses…" : "Bayar & Cetak Struk"}
              </Button>
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={batalkan}
        onClose={() => setBatalkan(false)}
        size="sm"
        title="Batalkan Pembayaran"
        description={`${struk.noInvoice} · ${formatRupiah(nilaiStruk.total)}`}
        footer={
          <>
            <Button onClick={() => setBatalkan(false)} disabled={proses}>
              Tutup
            </Button>
            <Button variant="danger" onClick={batalkanBayar} disabled={proses}>
              <Undo2 />
              {proses ? "Membatalkan…" : "Batalkan Pembayaran"}
            </Button>
          </>
        }
      >
        <ul className="mb-2.5 flex list-inside list-disc flex-col gap-1 text-meta text-ink-muted">
          <li>
            Tagihan kembali ke antrean kasir dan bisa dibayar ulang dengan
            nominal atau metode yang benar.
          </li>
          <li>
            Diskon dan pembulatan ikut dinolkan — keduanya keputusan saat
            membayar, bukan bagian dari tagihan.
          </li>
          <li>
            Uang yang sudah diterima <strong>tidak</strong> dikembalikan oleh
            sistem. Serahkan kembali ke pasien secara langsung.
          </li>
          <li>
            Bila pasien sedang menunggu obat, farmasi akan diberi tahu untuk
            menahan penyerahannya.
          </li>
        </ul>
        <Field label="Alasan Pembatalan" required>
          <Textarea
            rows={3}
            value={alasanBatal}
            maxLength={255}
            onChange={(e) => setAlasanBatal(e.target.value)}
            placeholder="mis. Salah metode bayar — tercatat tunai, pasien membayar QRIS"
          />
        </Field>
      </Modal>
    </div>
  );
}
