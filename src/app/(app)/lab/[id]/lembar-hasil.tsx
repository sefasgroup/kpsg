"use client";

import { forwardRef } from "react";
import { formatTanggal, hitungUmur } from "@/lib/format";

export type BarisHasil = {
  panel: string;
  parameter: string;
  nilai: string;
  satuan: string | null;
  ref: string | null;
  flag: string;
};

/**
 * Lembar hasil laboratorium — kertas A4 dengan kop surat (CLAUDE.md §5.2).
 *
 * Kop surat ditarik dari tabel `sites`, bukan dituliskan di kode, supaya
 * setiap cabang mencetak identitasnya sendiri.
 *
 * Penanda L/H/kritis dicetak sebagai teks (bukan hanya warna) karena
 * hasil lab sering difotokopi atau difaks dalam hitam-putih.
 */
export const LembarHasil = forwardRef<
  HTMLDivElement,
  {
    klinik: {
      nama: string;
      namaLegal: string | null;
      alamat: string | null;
      telepon: string | null;
      noIzin: string | null;
    };
    noOrder: string;
    pasien: string;
    noRm: string;
    nik: string;
    tanggalLahir: string;
    jenisKelamin: "L" | "P";
    dokter: string;
    petugas: string;
    tanggalOrder: string;
    tanggalSelesai: string | null;
    baris: BarisHasil[];
  }
>(function LembarHasil(p, ref) {
  const panels = [...new Set(p.baris.map((b) => b.panel))];
  const adaKritis = p.baris.some((b) => b.flag === "LL" || b.flag === "HH");

  return (
    <div ref={ref} className="lab-sheet">
      <style>{`
        @page { size: A4; margin: 15mm; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: #fff; }
        }
        .lab-sheet {
          width: 180mm; box-sizing: border-box; background: #fff; color: #000;
          font-family: Arial, Helvetica, sans-serif; font-size: 10pt; line-height: 1.4;
        }
        .lab-kop { display: flex; align-items: flex-start; gap: 6mm;
                   border-bottom: 1mm solid #0e5a4d; padding-bottom: 3mm; }
        .lab-kop-nama { font-size: 15pt; font-weight: 700; color: #0e5a4d; line-height: 1.1; }
        .lab-kop-sub { font-size: 8.5pt; color: #333; }
        .lab-judul { text-align: center; font-size: 12pt; font-weight: 700;
                     letter-spacing: 0.5pt; margin: 5mm 0 3mm; text-transform: uppercase; }
        .lab-id { display: grid; grid-template-columns: 1fr 1fr; gap: 1mm 6mm;
                  font-size: 9pt; margin-bottom: 4mm; }
        .lab-id b { display: inline-block; min-width: 30mm; font-weight: 400; color: #555; }
        table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
        th { background: #edf1ef; border: 0.3mm solid #999; padding: 1.5mm 2mm;
             text-align: left; font-size: 8.5pt; }
        td { border: 0.3mm solid #ccc; padding: 1.2mm 2mm; vertical-align: top; }
        .lab-panel td { background: #f4f6f5; font-weight: 700; font-size: 9pt; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .flag-abn { font-weight: 700; }
        .flag-krit { font-weight: 700; text-decoration: underline; }
        .lab-kritis { border: 0.4mm solid #000; padding: 2mm 3mm; margin-top: 4mm;
                      font-size: 9pt; font-weight: 700; }
        .lab-ttd { margin-top: 10mm; display: flex; justify-content: flex-end; }
        .lab-ttd-box { width: 55mm; text-align: center; font-size: 9pt; }
        .lab-ttd-garis { margin-top: 16mm; border-top: 0.3mm solid #000; padding-top: 1mm; }
        .lab-foot { margin-top: 5mm; font-size: 7.5pt; color: #555;
                    border-top: 0.3mm solid #ccc; padding-top: 2mm; }
        @media screen {
          .lab-sheet { border: 1px solid #dce3e0; border-radius: 4px; padding: 10mm; }
        }
      `}</style>

      <div className="lab-kop">
        <div style={{ flex: 1 }}>
          <div className="lab-kop-nama">{p.klinik.namaLegal ?? p.klinik.nama}</div>
          <div className="lab-kop-sub">
            {p.klinik.alamat ?? ""}
            {p.klinik.telepon ? ` · Telp. ${p.klinik.telepon}` : ""}
          </div>
          {p.klinik.noIzin ? (
            <div className="lab-kop-sub">Izin Klinik: {p.klinik.noIzin}</div>
          ) : null}
        </div>
      </div>

      <div className="lab-judul">Hasil Pemeriksaan Laboratorium</div>

      <div className="lab-id">
        <div><b>No. Pemeriksaan</b>: {p.noOrder}</div>
        <div><b>Tanggal Order</b>: {formatTanggal(p.tanggalOrder)}</div>
        <div><b>Nama Pasien</b>: {p.pasien}</div>
        <div><b>Tanggal Selesai</b>: {p.tanggalSelesai ? formatTanggal(p.tanggalSelesai) : "—"}</div>
        <div><b>No. Rekam Medis</b>: {p.noRm}</div>
        <div><b>NIK</b>: {p.nik}</div>
        <div>
          <b>Umur / Kelamin</b>: {hitungUmur(p.tanggalLahir)} tahun /{" "}
          {p.jenisKelamin === "L" ? "Laki-laki" : "Perempuan"}
        </div>
        <div><b>Dokter Pengirim</b>: {p.dokter}</div>
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: "40%" }}>Pemeriksaan</th>
            <th style={{ width: "16%" }} className="num">Hasil</th>
            <th style={{ width: "10%" }}>Satuan</th>
            <th style={{ width: "22%" }}>Nilai Rujukan</th>
            <th style={{ width: "12%" }}>Ket.</th>
          </tr>
        </thead>
        <tbody>
          {panels.map((panel) => (
            <>
              <tr className="lab-panel" key={panel}>
                <td colSpan={5}>{panel}</td>
              </tr>
              {p.baris
                .filter((b) => b.panel === panel)
                .map((b, i) => {
                  const kritis = b.flag === "LL" || b.flag === "HH";
                  const abnormal = b.flag === "L" || b.flag === "H";
                  return (
                    <tr key={`${panel}-${i}`}>
                      <td style={{ paddingLeft: "5mm" }}>{b.parameter}</td>
                      <td
                        className={`num ${kritis ? "flag-krit" : abnormal ? "flag-abn" : ""}`}
                      >
                        {b.nilai}
                      </td>
                      <td>{b.satuan ?? "—"}</td>
                      <td>{b.ref ?? "—"}</td>
                      <td className={kritis ? "flag-krit" : abnormal ? "flag-abn" : ""}>
                        {/* Teks, bukan hanya warna — hasil lab sering difotokopi hitam-putih. */}
                        {b.flag === "N"
                          ? ""
                          : b.flag === "L"
                            ? "Rendah"
                            : b.flag === "H"
                              ? "Tinggi"
                              : b.flag === "LL"
                                ? "KRITIS ↓"
                                : "KRITIS ↑"}
                      </td>
                    </tr>
                  );
                })}
            </>
          ))}
        </tbody>
      </table>

      {adaKritis ? (
        <div className="lab-kritis">
          PERHATIAN: Terdapat hasil dengan nilai kritis. Segera hubungi dokter
          pengirim.
        </div>
      ) : null}

      <div className="lab-ttd">
        <div className="lab-ttd-box">
          <div>Petugas Laboratorium</div>
          <div className="lab-ttd-garis">{p.petugas}</div>
        </div>
      </div>

      <div className="lab-foot">
        Hasil ini hanya berlaku untuk sampel yang diperiksa dan harus
        diinterpretasikan bersama kondisi klinis pasien oleh dokter.
      </div>
    </div>
  );
});
