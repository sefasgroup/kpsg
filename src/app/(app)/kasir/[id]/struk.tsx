"use client";

import { forwardRef } from "react";
import { formatDesimal, formatRupiah, formatTanggalPendek } from "@/lib/format";
import { KATEGORI_LABEL } from "@/lib/billing-labels";
import { METODE_LABEL, pakaiPaket } from "@/lib/validations/cashier";

export type BarisStruk = {
  kategori: string;
  deskripsi: string;
  qty: number;
  harga_satuan: number;
  subtotal: number;
};

/**
 * Struk kasir — kertas thermal 80 mm (CLAUDE.md §5, DESIGN-SYSTEM §6).
 *
 * Sengaja monokrom dan tanpa gambar: printer ESC/POS bekerja 1-bit, dan
 * gradasi hijau brand akan tercetak sebagai bercak. Identitas klinik cukup
 * berupa teks.
 *
 * Struk TIDAK memuat diagnosa — `deskripsi` berasal dari `billing_items`
 * yang memang tidak menyimpannya (CLAUDE.md §2.1 poin 7).
 *
 * Bila dibayar dengan pembulatan paket, struk RINGKAS: hanya "Biaya
 * Konsultasi + Obat" dan total bayar — rincian per baris tidak dicetak,
 * karena angkanya tidak akan pernah berjumlah sama dengan totalnya.
 */
export const Struk = forwardRef<
  HTMLDivElement,
  {
    namaKlinik: string;
    alamatKlinik: string | null;
    teleponKlinik: string | null;
    noInvoice: string;
    tanggal: Date | string;
    pasien: string;
    noRm: string;
    poli: string;
    dokter: string;
    kasir: string;
    baris: BarisStruk[];
    subtotal: number;
    diskon: number;
    pembulatan: number;
    total: number;
    dibayar: number;
    kembalian: number;
    metode: string;
    /** Nomor referensi/approval. Sengaja BUKAN `ref` — nama itu milik React. */
    noRef?: string | null;
  }
>(function Struk(p, ref) {
  const kategori = [...new Set(p.baris.map((b) => b.kategori))];
  const ringkas = pakaiPaket(p.pembulatan);

  return (
    <div ref={ref} className="struk">
      <style>{`
        @page { size: 80mm auto; margin: 0; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: #fff; }
        }
        .struk {
          width: 80mm; box-sizing: border-box; padding: 3mm 4mm;
          font-family: "Courier New", ui-monospace, monospace;
          font-size: 8.5pt; line-height: 1.35; color: #000; background: #fff;
        }
        .s-center { text-align: center; }
        .s-klinik { font-size: 10pt; font-weight: 700; }
        .s-logo { width: 12mm; height: auto; display: block; margin: 0 auto 1mm; image-rendering: pixelated; }
        .s-kecil  { font-size: 7pt; }
        .s-hr { border-top: 1px dashed #000; margin: 1.5mm 0; }
        .s-row { display: flex; justify-content: space-between; gap: 2mm; }
        .s-row > span:last-child { white-space: nowrap; }
        .s-kat { font-weight: 700; margin-top: 1mm; font-size: 7.5pt; }
        .s-item { padding-left: 1mm; }
        .s-qty { font-size: 7pt; padding-left: 2mm; }
        .s-total { font-size: 10pt; font-weight: 700; }
        @media screen {
          .struk { border: 1px solid #dce3e0; border-radius: 4px; margin: 0 auto; }
        }
      `}</style>

      <div className="s-center">
        {/*
          Logo 1-bit khusus thermal (dibuat `scripts/logo-mono.mjs`).
          Logo berwarna yang dikirim apa adanya akan di-dither driver jadi
          bercak abu-abu yang tidak terbaca — printer thermal hanya bisa
          menyalakan atau tidak menyalakan tiap titik.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/kpsg-mark-mono.png" alt="" className="s-logo" />
        <div className="s-klinik">{p.namaKlinik}</div>
        {p.alamatKlinik ? <div className="s-kecil">{p.alamatKlinik}</div> : null}
        {p.teleponKlinik ? <div className="s-kecil">Telp. {p.teleponKlinik}</div> : null}
      </div>

      <div className="s-hr" />

      <div className="s-row s-kecil">
        <span>No. Invoice</span>
        <span>{p.noInvoice}</span>
      </div>
      <div className="s-row s-kecil">
        <span>Tanggal</span>
        <span>{formatTanggalPendek(p.tanggal)}</span>
      </div>
      <div className="s-row s-kecil">
        <span>Pasien</span>
        <span>
          {p.pasien} ({p.noRm})
        </span>
      </div>
      <div className="s-row s-kecil">
        <span>Poli / Dokter</span>
        <span>
          {p.poli} / {p.dokter}
        </span>
      </div>
      <div className="s-row s-kecil">
        <span>Kasir</span>
        <span>{p.kasir}</span>
      </div>

      <div className="s-hr" />

      {ringkas ? (
        <div className="s-item">Biaya Konsultasi + Obat</div>
      ) : kategori.map((k) => (
        <div key={k}>
          <div className="s-kat">{KATEGORI_LABEL[k] ?? k}</div>
          {p.baris
            .filter((b) => b.kategori === k)
            .map((b, i) => (
              <div key={i}>
                <div className="s-row s-item">
                  <span>{b.deskripsi}</span>
                  <span>{formatRupiah(b.subtotal)}</span>
                </div>
                {b.qty > 1 ? (
                  <div className="s-qty">
                    {formatDesimal(b.qty)} x {formatRupiah(b.harga_satuan)}
                  </div>
                ) : null}
              </div>
            ))}
        </div>
      ))}

      <div className="s-hr" />

      {ringkas ? null : (
        <>
          <div className="s-row">
            <span>Subtotal</span>
            <span>{formatRupiah(p.subtotal)}</span>
          </div>
          {p.diskon > 0 ? (
            <div className="s-row">
              <span>Diskon</span>
              <span>-{formatRupiah(p.diskon)}</span>
            </div>
          ) : null}
          {p.pembulatan !== 0 ? (
            <div className="s-row">
              <span>Pembulatan</span>
              <span>{formatRupiah(p.pembulatan)}</span>
            </div>
          ) : null}
        </>
      )}
      <div className="s-row s-total">
        <span>{ringkas ? "TOTAL BAYAR" : "TOTAL"}</span>
        <span>{formatRupiah(p.total)}</span>
      </div>

      <div className="s-hr" />

      <div className="s-row">
        <span>{METODE_LABEL[p.metode as keyof typeof METODE_LABEL] ?? p.metode}</span>
        <span>{formatRupiah(p.dibayar)}</span>
      </div>
      {p.kembalian > 0 ? (
        <div className="s-row">
          <span>Kembali</span>
          <span>{formatRupiah(p.kembalian)}</span>
        </div>
      ) : null}
      {p.noRef ? (
        <div className="s-row s-kecil">
          <span>Ref</span>
          <span>{p.noRef}</span>
        </div>
      ) : null}

      <div className="s-hr" />

      <div className="s-center s-kecil">
        <div>Terima kasih atas kunjungan Anda</div>
        <div>Semoga lekas sembuh</div>
        <div style={{ marginTop: "2mm" }}>
          Struk ini bukti pembayaran yang sah
        </div>
      </div>
    </div>
  );
});
