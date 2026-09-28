"use client";

import { forwardRef } from "react";
import { formatTanggal } from "@/lib/format";

export type DataEtiket = {
  namaObat: string;
  aturanPakai: string;
  qty: string;
  catatan?: string | null;
  isRacikan: boolean;
};

/**
 * Etiket obat — stiker 50 × 30 mm (CLAUDE.md §5.3, DESIGN-SYSTEM §6).
 *
 * Hierarki visualnya mengikuti siapa yang membacanya: pasien di rumah,
 * bukan petugas. Karena itu ATURAN PAKAI adalah elemen terbesar di stiker
 * dan nama klinik justru yang paling kecil.
 *
 * Ukuran dinyatakan dalam mm agar tidak bergantung pada DPI printer label.
 */
export const LembarEtiket = forwardRef<
  HTMLDivElement,
  {
    pasien: string;
    noRm: string;
    namaKlinik: string;
    tanggal: Date | string;
    daftar: DataEtiket[];
  }
>(function LembarEtiket({ pasien, noRm, namaKlinik, tanggal, daftar }, ref) {
  return (
    <div ref={ref} className="etiket-sheet">
      <style>{`
        @page { size: 50mm 30mm; margin: 0; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: #fff; }
        }
        .etiket-sheet { display: flex; flex-direction: column; gap: 2mm; }
        .etiket {
          width: 50mm; height: 30mm; box-sizing: border-box;
          padding: 1.6mm 2mm; overflow: hidden;
          font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff;
          display: flex; flex-direction: column;
          page-break-after: always; break-after: page;
        }
        .etiket:last-child { page-break-after: auto; break-after: auto; }
        .et-head {
          display: flex; justify-content: space-between; align-items: baseline;
          font-size: 5pt; line-height: 1.1; border-bottom: 0.3mm solid #000;
          padding-bottom: 0.5mm;
        }
        .et-pasien { font-size: 6.5pt; font-weight: 700; margin-top: 0.8mm; line-height: 1.1; }
        .et-obat   { font-size: 7.5pt; font-weight: 700; line-height: 1.15; margin-top: 0.4mm; }
        .et-racik  { font-size: 5pt; font-weight: 700; letter-spacing: 0.2pt; }
        /* Elemen terbesar di stiker — ini yang dibaca pasien di rumah. */
        .et-signa  { font-size: 9pt; font-weight: 700; line-height: 1.15; margin-top: auto;
                     text-transform: uppercase; }
        .et-foot   { font-size: 4.5pt; line-height: 1.1; margin-top: 0.5mm; }
        /* Pratinjau di layar: beri batas agar bentuk stiker terlihat. */
        @media screen {
          .etiket { border: 1px dashed #c3cdc9; border-radius: 2px; }
        }
      `}</style>

      {daftar.map((d, i) => (
        <div className="etiket" key={i}>
          <div className="et-head">
            <span>{namaKlinik}</span>
            <span>{formatTanggal(tanggal, { dateStyle: "short" })}</span>
          </div>

          <div className="et-pasien">
            {pasien} · {noRm}
          </div>

          <div className="et-obat">
            {d.isRacikan ? <span className="et-racik">RACIKAN · </span> : null}
            {d.namaObat}
            <span style={{ fontWeight: 400 }}> — {d.qty}</span>
          </div>

          <div className="et-signa">{d.aturanPakai}</div>

          <div className="et-foot">
            {d.catatan ? `${d.catatan} · ` : ""}Habiskan sesuai anjuran dokter
          </div>
        </div>
      ))}
    </div>
  );
});
