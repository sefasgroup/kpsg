"use client";

import { forwardRef } from "react";
import { formatTanggal, formatTanggalPendek, hitungUmur } from "@/lib/format";

/**
 * Resume rekam medis pasien — kertas A4 berkop (CLAUDE.md §5.2).
 *
 * Dipakai untuk Cetak maupun Simpan PDF; keduanya melewati lembar yang sama
 * persis, sehingga berkas PDF yang diserahkan ke pasien tidak pernah berbeda
 * dari yang tercetak di klinik.
 *
 * Isinya sengaja RINGKAS per kunjungan, bukan salinan mentah seluruh kolom.
 * Resume rekam medis dibaca dokter lain atau petugas asuransi yang tidak
 * punya konteks; daftar panjang tanpa struktur justru menyembunyikan hal
 * yang penting.
 */

export type KlinikKop = {
  nama: string;
  namaLegal: string | null;
  alamat: string | null;
  telepon: string | null;
  noIzin: string | null;
};

export type PasienResume = {
  nama: string;
  noRm: string;
  nik: string;
  tanggalLahir: string;
  jenisKelamin: "L" | "P";
  alamat: string | null;
  telepon: string | null;
  golDarah: string | null;
  jumlahKunjungan: number;
};

export type AlergiResume = {
  nama_alergen: string;
  jenis: string;
  keparahan: string | null;
  reaksi: string | null;
};

export type KunjunganResume = {
  id: number;
  no_visit: string;
  tanggal: string;
  poli: string;
  site_nama: string;
  dokter: string;
  dokter_pengganti: string | null;
  ttv: string | null;
  diagnosa: string | null;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  tindakan: string | null;
  obat: string | null;
  racikan: string | null;
  lab: string | null;
};

export type LabResume = {
  tanggal: string;
  panel: string;
  parameter: string;
  nilai: string;
  satuan: string | null;
  ref_teks: string | null;
  flag: string;
};

export type DataResume = {
  klinik: KlinikKop;
  pasien: PasienResume;
  alergi: AlergiResume[];
  kunjungan: KunjunganResume[];
  lab: LabResume[];
  dicetakOleh: string;
  dicetakPada: string;
};

const FLAG_LABEL: Record<string, string> = {
  N: "Normal", L: "Rendah", H: "Tinggi", LL: "KRITIS ↓", HH: "KRITIS ↑",
};

export const LembarRiwayat = forwardRef<HTMLDivElement, DataResume>(
  function LembarRiwayat(p, ref) {
    const { pasien, klinik } = p;

    return (
      <div ref={ref} className="rm-sheet">
        <style>{`
          @page { size: A4; margin: 15mm; }
          @media print {
            html, body { margin: 0 !important; padding: 0 !important; background: #fff; }
          }
          .rm-sheet {
            width: 180mm; box-sizing: border-box; background: #fff; color: #000;
            font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; line-height: 1.45;
          }
          .rm-kop { border-bottom: 1mm solid #0e5a4d; padding-bottom: 2.5mm; }
          .rm-kop-nama { font-size: 15pt; font-weight: 700; color: #0e5a4d; line-height: 1.15; }
          .rm-kop-sub { font-size: 8pt; color: #333; }
          .rm-judul { text-align: center; margin: 6mm 0 4mm; }
          .rm-judul h1 { font-size: 12pt; font-weight: 700; letter-spacing: 0.5pt;
                         text-transform: uppercase; text-decoration: underline; margin: 0; }
          .rm-id { display: grid; grid-template-columns: 1fr 1fr; gap: 0 6mm; margin-bottom: 4mm; }
          .rm-id div { display: flex; gap: 2mm; }
          .rm-id dt { width: 30mm; flex-shrink: 0; color: #444; }
          .rm-id dd { margin: 0; font-weight: 700; }
          .rm-bagian { font-size: 10pt; font-weight: 700; color: #0e5a4d;
                       border-bottom: 0.3mm solid #cfd8d5; padding-bottom: 1mm;
                       margin: 5mm 0 2mm; }
          .rm-alergi { border: 0.4mm solid #b91c1c; background: #fef2f2; color: #7f1d1d;
                       padding: 2mm 3mm; margin-bottom: 3mm; }
          /* Kunjungan tidak boleh terpotong di tengah antar halaman. */
          .rm-visit { border: 0.25mm solid #cfd8d5; padding: 2.5mm 3mm; margin-bottom: 2.5mm;
                      break-inside: avoid; page-break-inside: avoid; }
          .rm-visit-head { display: flex; justify-content: space-between; gap: 3mm;
                           border-bottom: 0.25mm solid #e3e9e7; padding-bottom: 1mm;
                           margin-bottom: 1.5mm; font-weight: 700; }
          .rm-row { display: flex; gap: 2mm; margin-bottom: 0.8mm; }
          .rm-row .k { width: 26mm; flex-shrink: 0; color: #555; }
          .rm-row .v { white-space: pre-line; }
          table.rm-lab { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
          table.rm-lab th, table.rm-lab td {
            border: 0.25mm solid #cfd8d5; padding: 1mm 1.5mm; text-align: left;
          }
          table.rm-lab th { background: #eef3f2; }
          table.rm-lab td.num { text-align: right; font-variant-numeric: tabular-nums; }
          .rm-krit { color: #b91c1c; font-weight: 700; }
          .rm-abn  { color: #b45309; font-weight: 700; }
          .rm-foot { margin-top: 6mm; font-size: 7.5pt; color: #555;
                     border-top: 0.25mm solid #ccc; padding-top: 1.5mm; }
          @media screen {
            .rm-sheet { border: 1px solid #dce3e0; border-radius: 4px; padding: 10mm; }
          }
        `}</style>

        <div className="rm-kop">
          <div className="rm-kop-nama">{klinik.nama}</div>
          <div className="rm-kop-sub">
            {klinik.namaLegal ? <div>{klinik.namaLegal}</div> : null}
            {klinik.alamat ? <div>{klinik.alamat}</div> : null}
            <div>
              {klinik.telepon ? `Telp. ${klinik.telepon}` : null}
              {klinik.telepon && klinik.noIzin ? " · " : null}
              {klinik.noIzin ? `Izin Klinik: ${klinik.noIzin}` : null}
            </div>
          </div>
        </div>

        <div className="rm-judul">
          <h1>Resume Rekam Medis</h1>
        </div>

        <dl className="rm-id">
          <div><dt>Nama</dt><dd>{pasien.nama}</dd></div>
          <div><dt>No. Rekam Medis</dt><dd>{pasien.noRm}</dd></div>
          <div><dt>NIK</dt><dd>{pasien.nik}</dd></div>
          <div>
            <dt>Tanggal Lahir</dt>
            <dd>{formatTanggal(pasien.tanggalLahir)} ({hitungUmur(pasien.tanggalLahir)} th)</dd>
          </div>
          <div>
            <dt>Jenis Kelamin</dt>
            <dd>{pasien.jenisKelamin === "L" ? "Laki-laki" : "Perempuan"}</dd>
          </div>
          <div><dt>Golongan Darah</dt><dd>{pasien.golDarah ?? "—"}</dd></div>
          <div><dt>Telepon</dt><dd>{pasien.telepon ?? "—"}</dd></div>
          <div><dt>Total Kunjungan</dt><dd>{pasien.jumlahKunjungan}</dd></div>
          {pasien.alamat ? (
            <div style={{ gridColumn: "1 / -1" }}>
              <dt>Alamat</dt><dd>{pasien.alamat}</dd>
            </div>
          ) : null}
        </dl>

        {/* Alergi selalu di atas riwayat — inilah yang paling berbahaya bila
            terlewat oleh pembaca dokumen ini. */}
        {p.alergi.length > 0 ? (
          <div className="rm-alergi">
            <strong>ALERGI TERCATAT</strong>
            <ul style={{ margin: "1mm 0 0 4mm", padding: 0 }}>
              {p.alergi.map((a, i) => (
                <li key={i}>
                  <strong>{a.nama_alergen}</strong> ({a.jenis})
                  {a.keparahan ? ` — ${a.keparahan.toUpperCase()}` : ""}
                  {a.reaksi ? `; ${a.reaksi}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div style={{ marginBottom: "3mm", color: "#555" }}>
            Tidak ada alergi tercatat.
          </div>
        )}

        <div className="rm-bagian">Riwayat Kunjungan ({p.kunjungan.length})</div>

        {p.kunjungan.length === 0 ? (
          <p style={{ color: "#555" }}>Belum ada kunjungan tercatat.</p>
        ) : (
          p.kunjungan.map((k) => (
            <div className="rm-visit" key={k.id}>
              <div className="rm-visit-head">
                <span>
                  {formatTanggal(k.tanggal)} · {k.poli}
                </span>
                <span style={{ fontWeight: 400, color: "#555" }}>
                  {k.no_visit} · {k.site_nama}
                </span>
              </div>

              <Baris label="Dokter" isi={
                k.dokter_pengganti
                  ? `${k.dokter_pengganti} (menggantikan ${k.dokter})`
                  : k.dokter
              } />
              <Baris label="Tanda Vital" isi={k.ttv} />
              <Baris label="Anamnesis" isi={k.subjective} />
              <Baris label="Pemeriksaan" isi={k.objective} />
              <Baris label="Diagnosa" isi={k.diagnosa} tebal />
              <Baris label="Penilaian" isi={k.assessment} />
              <Baris label="Rencana" isi={k.plan} />
              <Baris label="Tindakan" isi={k.tindakan} />
              <Baris label="Laboratorium" isi={k.lab} />
              <Baris label="Obat" isi={k.obat} />
              <Baris label="Racikan" isi={k.racikan} />

              {!k.subjective && !k.diagnosa ? (
                <div style={{ color: "#777" }}>
                  Kunjungan ini tidak memiliki catatan pemeriksaan dokter.
                </div>
              ) : null}
            </div>
          ))
        )}

        {p.lab.length > 0 ? (
          <>
            <div className="rm-bagian">Hasil Laboratorium ({p.lab.length})</div>
            <table className="rm-lab">
              <thead>
                <tr>
                  <th>Tanggal</th><th>Panel</th><th>Parameter</th>
                  <th>Hasil</th><th>Satuan</th><th>Rujukan</th><th>Penanda</th>
                </tr>
              </thead>
              <tbody>
                {p.lab.map((l, i) => {
                  const kritis = l.flag === "LL" || l.flag === "HH";
                  const abnormal = l.flag !== "N" && !kritis;
                  const kelas = kritis ? "rm-krit" : abnormal ? "rm-abn" : "";
                  return (
                    <tr key={i}>
                      <td>{formatTanggalPendek(l.tanggal)}</td>
                      <td>{l.panel}</td>
                      <td>{l.parameter}</td>
                      <td className={`num ${kelas}`}>{l.nilai}</td>
                      <td>{l.satuan ?? "—"}</td>
                      <td>{l.ref_teks ?? "—"}</td>
                      {/* Penanda ditulis sebagai TEKS, bukan hanya warna —
                          dokumen ini sering difotokopi hitam-putih. */}
                      <td className={kelas}>{FLAG_LABEL[l.flag] ?? l.flag}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : null}

        <div className="rm-foot">
          Dicetak oleh <strong>{p.dicetakOleh}</strong> pada {p.dicetakPada} dari
          sistem informasi {klinik.nama}. Dokumen ini memuat data medis pasien —
          serahkan hanya kepada yang berhak menerimanya.
        </div>
      </div>
    );
  },
);

function Baris({ label, isi, tebal }: { label: string; isi: string | null; tebal?: boolean }) {
  if (!isi) return null;
  return (
    <div className="rm-row">
      <span className="k">{label}</span>
      <span className="v" style={tebal ? { fontWeight: 700 } : undefined}>{isi}</span>
    </div>
  );
}
