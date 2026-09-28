"use client";

import { forwardRef } from "react";
import { formatJam, formatTanggal, hitungUmur } from "@/lib/format";
/*
 * Bentuk datanya didefinisikan di lapisan lib yang merakitnya, bukan di sini.
 * `import type` dihapus seluruhnya saat kompilasi, jadi `server-only` di modul
 * itu tidak pernah ikut ke bundel klien.
 */
import type { DataRekamMedis } from "@/lib/rekam-medis";
import { LABEL_ANAMNESIS, REGIO_PEMERIKSAAN } from "@/lib/validations/doctor";

export type { DataRekamMedis };

/**
 * Rekam medis SATU kunjungan — kertas A4 berkop.
 *
 * Berbeda dari "Resume Rekam Medis" di layar Riwayat Pasien, yang merangkum
 * seluruh kunjungan. Yang ini adalah catatan satu pertemuan: inilah bentuk
 * yang diminta untuk lampiran klaim asuransi, rujukan ke faskes lanjutan,
 * dan serah terima antar dokter.
 *
 * Isinya mengikuti kelengkapan minimal rekam medis rawat jalan: tanggal &
 * jam pelayanan, anamnesis, hasil pemeriksaan fisik & penunjang, diagnosis,
 * rencana penatalaksanaan, serta pengobatan/tindakan.
 */

const FLAG_LABEL: Record<string, string> = {
  N: "Normal", L: "Rendah", H: "Tinggi", LL: "KRITIS ↓", HH: "KRITIS ↑",
};

export const LembarRekamMedis = forwardRef<HTMLDivElement, DataRekamMedis>(
  function LembarRekamMedis(p, ref) {
    const { pasien, klinik, visit } = p;
    const draf = p.asesmen === null || p.asesmen.status !== "final";

    // Urutannya mengikuti REGIO_PEMERIKSAAN (kepala → kulit), bukan urutan
    // kunci di JSON — yang terakhir bergantung pada urutan dokter mengisi.
    const regioTerisi = REGIO_PEMERIKSAAN.flatMap((r) => {
      const nilai = p.lokalis.regio[r.kunci];
      if (!nilai || (!nilai.dbn && nilai.temuan.length === 0)) return [];
      return [{ label: r.label as string, nilai }];
    });

    return (
      <div ref={ref} className="mr-sheet">
        <style>{`
          @page { size: A4; margin: 15mm; }
          @media print {
            html, body { margin: 0 !important; padding: 0 !important; background: #fff; }
          }
          .mr-sheet {
            width: 180mm; box-sizing: border-box; background: #fff; color: #000;
            font-family: Arial, Helvetica, sans-serif; font-size: 10pt; line-height: 1.45;
          }
          .mr-kop { border-bottom: 1mm solid #0e5a4d; padding-bottom: 2.5mm; }
          .mr-kop-nama { font-size: 15pt; font-weight: 700; color: #0e5a4d; line-height: 1.15; }
          .mr-kop-sub { font-size: 8pt; color: #333; }
          .mr-judul { text-align: center; margin: 5mm 0 1mm; }
          .mr-judul h1 { font-size: 12.5pt; font-weight: 700; letter-spacing: 0.5pt;
                         text-transform: uppercase; text-decoration: underline; margin: 0; }
          .mr-no { text-align: center; font-size: 9pt; color: #444; margin-bottom: 4mm; }
          .mr-draf { border: 0.5mm dashed #b45309; background: #fffbeb; color: #92400e;
                     text-align: center; font-weight: 700; padding: 2mm; margin-bottom: 3mm; }
          .mr-id { display: grid; grid-template-columns: 1fr 1fr; gap: 0 6mm; margin-bottom: 3mm; }
          .mr-id div { display: flex; gap: 2mm; }
          .mr-id dt { width: 30mm; flex-shrink: 0; color: #444; }
          .mr-id dd { margin: 0; font-weight: 700; }
          .mr-alergi { border: 0.4mm solid #b91c1c; background: #fef2f2; color: #7f1d1d;
                       padding: 2mm 3mm; margin-bottom: 3mm; font-weight: 700; }
          .mr-bagian { font-size: 10pt; font-weight: 700; color: #0e5a4d;
                       border-bottom: 0.3mm solid #cfd8d5; padding-bottom: 1mm;
                       margin: 4mm 0 1.5mm; }
          .mr-teks { white-space: pre-line; }
          .mr-kosong { color: #777; }
          .mr-ttv { display: flex; flex-wrap: wrap; gap: 1mm 5mm; }
          ol.mr-list, ul.mr-list { margin: 0 0 0 5mm; padding: 0; }
          ol.mr-list li, ul.mr-list li { margin-bottom: 0.8mm; }
          .mr-signa { display: block; font-style: italic; }
          .mr-bahan { color: #555; font-size: 9pt; }
          table.mr-lab { width: 100%; border-collapse: collapse; font-size: 9pt; }
          table.mr-lab th, table.mr-lab td {
            border: 0.25mm solid #cfd8d5; padding: 1mm 1.5mm; text-align: left;
          }
          table.mr-lab th { background: #eef3f2; }
          table.mr-lab td.num { text-align: right; font-variant-numeric: tabular-nums; }
          .mr-lokalis { display: flex; gap: 6mm; justify-content: center;
                        margin: 2mm 0; break-inside: avoid; page-break-inside: avoid; }
          .mr-krit { color: #b91c1c; font-weight: 700; }
          .mr-abn  { color: #b45309; font-weight: 700; }
          .mr-ttd { margin-top: 8mm; display: flex; justify-content: flex-end;
                    break-inside: avoid; page-break-inside: avoid; }
          .mr-ttd-box { width: 65mm; text-align: center; font-size: 10pt; }
          .mr-ttd-garis { margin-top: 18mm; font-weight: 700;
                          border-top: 0.3mm solid #000; padding-top: 1mm; }
          .mr-foot { margin-top: 6mm; font-size: 7.5pt; color: #555;
                     border-top: 0.25mm solid #ccc; padding-top: 1.5mm; }
          @media screen {
            .mr-sheet { border: 1px solid #dce3e0; border-radius: 4px; padding: 10mm; }
          }
        `}</style>

        <div className="mr-kop">
          <div className="mr-kop-nama">{klinik.nama}</div>
          <div className="mr-kop-sub">
            {klinik.namaLegal ? <div>{klinik.namaLegal}</div> : null}
            {klinik.alamat ? <div>{klinik.alamat}</div> : null}
            <div>
              {klinik.telepon ? `Telp. ${klinik.telepon}` : null}
              {klinik.telepon && klinik.noIzin ? " · " : null}
              {klinik.noIzin ? `Izin Klinik: ${klinik.noIzin}` : null}
            </div>
          </div>
        </div>

        <div className="mr-judul"><h1>Rekam Medis Rawat Jalan</h1></div>
        <div className="mr-no">No. Kunjungan: {visit.noVisit}</div>

        {/*
          Asesmen yang belum final TIDAK boleh tercetak seolah dokumen jadi.
          Rekam medis adalah dokumen hukum; lembar draf yang terlanjur
          diserahkan ke pasien atau asuransi tidak bisa ditarik kembali.
        */}
        {draf ? (
          <div className="mr-draf">
            DRAF — PEMERIKSAAN BELUM DIFINALKAN DOKTER
            <div style={{ fontWeight: 400, fontSize: "8.5pt" }}>
              Lembar ini belum sah sebagai rekam medis dan tidak untuk diserahkan.
            </div>
          </div>
        ) : null}

        <dl className="mr-id">
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
          <div><dt>Pekerjaan</dt><dd>{pasien.pekerjaan ?? "—"}</dd></div>
          <div>
            <dt>Tanggal Pelayanan</dt>
            <dd>{formatTanggal(visit.tanggal)} · {formatJam(visit.waktuDaftar)}</dd>
          </div>
          <div><dt>Poli</dt><dd>{visit.poli}</dd></div>
          {pasien.alamat ? (
            <div style={{ gridColumn: "1 / -1" }}>
              <dt>Alamat</dt><dd>{pasien.alamat}</dd>
            </div>
          ) : null}
        </dl>

        {p.alergi ? (
          <div className="mr-alergi">ALERGI: {p.alergi}</div>
        ) : (
          <div style={{ marginBottom: "3mm", color: "#555" }}>
            Tidak ada alergi tercatat.
          </div>
        )}

        <div className="mr-bagian">Pengkajian Awal (Perawat)</div>
        {p.perawat.keluhanUtama ? (
          <>
            <div><strong>Keluhan Utama:</strong> {p.perawat.keluhanUtama}</div>
            {p.perawat.riwayat ? (
              <div><strong>Riwayat:</strong> {p.perawat.riwayat}</div>
            ) : null}
            {p.perawat.ttv ? (
              <div className="mr-ttv" style={{ marginTop: "1mm" }}>
                <span><strong>TTV:</strong> {p.perawat.ttv}</span>
              </div>
            ) : null}
            <div style={{ marginTop: "1mm", color: "#555", fontSize: "9pt" }}>
              Triase {p.perawat.triase ?? "—"}
              {p.perawat.nama ? ` · dikaji oleh ${p.perawat.nama}` : ""}
            </div>
          </>
        ) : (
          <div className="mr-kosong">Pasien tidak melalui pengkajian perawat.</div>
        )}

        <div className="mr-bagian">S — Anamnesis</div>
        {p.asesmen ? (
          <>
            <Baris
              label="Jenis"
              isi={
                p.asesmen.jenis_anamnesis
                  ? (LABEL_ANAMNESIS[p.asesmen.jenis_anamnesis] ?? p.asesmen.jenis_anamnesis) +
                    (p.asesmen.sumber_anamnesis ? ` — ${p.asesmen.sumber_anamnesis}` : "")
                  : null
              }
            />
            <Baris label="Keluhan Utama" isi={p.asesmen.keluhan_utama} tebal />
            <Baris label="Riw. Penyakit" isi={p.asesmen.riwayat_penyakit} />
            <Baris label="Riw. Pengobatan" isi={p.asesmen.riwayat_pengobatan} />
            <Baris label="Riw. Alergi" isi={p.asesmen.riwayat_alergi} />
            <Baris label="Tambahan" isi={p.asesmen.subjective} />
            {!p.asesmen.keluhan_utama && !p.asesmen.riwayat_penyakit &&
             !p.asesmen.subjective ? (
              <div className="mr-kosong">Tidak diisi.</div>
            ) : null}
          </>
        ) : (
          <div className="mr-kosong">Tidak diisi.</div>
        )}

        <div className="mr-bagian">O — Pemeriksaan Fisik</div>
        <Baris
          label="Keadaan Umum"
          isi={p.asesmen?.keadaan_umum ? kapital(p.asesmen.keadaan_umum) : null}
        />
        <Baris
          label="Keadaan Gizi"
          isi={p.asesmen?.keadaan_gizi ? kapital(p.asesmen.keadaan_gizi) : null}
        />
        <Isi teks={p.asesmen?.objective} />

        {/*
          Regio pemeriksaan fisik. Yang TIDAK diperiksa sengaja tidak dicetak
          sama sekali — mencetaknya sebagai baris kosong membuat pembaca
          menyangka regio itu diperiksa dan hasilnya tidak dituliskan.
        */}
        {regioTerisi.length > 0 ? (
          <div style={{ marginTop: "2mm" }}>
            <div style={{ fontWeight: 700, marginBottom: "1mm" }}>Status Lokalis</div>
            {regioTerisi.map(({ label, nilai }) => (
              <div className="mr-row" key={label}>
                <span className="k">{label}</span>
                <span className="v">
                  {nilai.temuan || "Dalam batas normal"}
                  {nilai.dbn && nilai.temuan ? " (DBN)" : ""}
                </span>
              </div>
            ))}
            <div style={{ fontSize: "8pt", color: "#777", marginTop: "0.8mm" }}>
              Regio yang tidak tercantum berarti tidak diperiksa.
            </div>
          </div>
        ) : null}

        {/* Status lokalis: gambar tubuh dengan titik bernomor, lalu daftar
            keterangannya. Nomor pada gambar dan pada daftar harus cocok —
            itulah gunanya keduanya dicetak bersama. */}
        {p.lokalis.titik.length > 0 || p.lokalis.catatan ? (
          <div style={{ marginTop: "2mm" }}>
            <div style={{ fontWeight: 700, marginBottom: "1mm" }}>Peta Titik Keluhan</div>
            {p.lokalis.titik.length > 0 ? (
              <>
                <div className="mr-lokalis">
                  {(["depan", "belakang"] as const).map((sisi) => (
                    <GambarLokalis key={sisi} sisi={sisi} titik={p.lokalis.titik} />
                  ))}
                </div>
                <ol className="mr-list">
                  {p.lokalis.titik.map((t, i) => (
                    <li key={i}>
                      <b>{i + 1}.</b> ({t.sisi}) {t.keterangan || "—"}
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
            {p.lokalis.catatan ? (
              <div className="mr-teks" style={{ marginTop: "1mm" }}>{p.lokalis.catatan}</div>
            ) : null}
          </div>
        ) : null}

        <div className="mr-bagian">A — Diagnosis</div>
        {p.diagnosa.length > 0 ? (
          <ol className="mr-list">
            {p.diagnosa.map((d, i) => (
              <li key={i}>
                <strong>{d.kode}</strong> — {d.nama}{" "}
                <span style={{ color: "#555" }}>({d.tipe})</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="mr-kosong">Belum ada diagnosis ICD-10.</div>
        )}
        {p.asesmen?.assessment ? (
          <div className="mr-teks" style={{ marginTop: "1mm" }}>{p.asesmen.assessment}</div>
        ) : null}

        <div className="mr-bagian">P — Rencana Penatalaksanaan</div>
        <Baris label="Terapi" isi={p.asesmen?.terapi} />
        <Baris label="Tindakan" isi={p.asesmen?.plan} />
        {!p.asesmen?.terapi && !p.asesmen?.plan ? (
          <div className="mr-kosong">Tidak diisi.</div>
        ) : null}

        {p.tindakan.length > 0 ? (
          <>
            <div className="mr-bagian">Tindakan Medis</div>
            <ul className="mr-list">
              {p.tindakan.map((t, i) => (
                <li key={i}>{t.nama}{t.qty > 1 ? ` ×${t.qty}` : ""}</li>
              ))}
            </ul>
          </>
        ) : null}

        {p.lab.length > 0 ? (
          <>
            <div className="mr-bagian">Pemeriksaan Penunjang (Laboratorium)</div>
            <table className="mr-lab">
              <thead>
                <tr>
                  <th>Panel</th><th>Parameter</th><th>Hasil</th>
                  <th>Satuan</th><th>Rujukan</th><th>Penanda</th>
                </tr>
              </thead>
              <tbody>
                {p.lab.map((l, i) => {
                  const kritis = l.flag === "LL" || l.flag === "HH";
                  const abnormal = Boolean(l.flag) && l.flag !== "N" && !kritis;
                  const kelas = kritis ? "mr-krit" : abnormal ? "mr-abn" : "";
                  return (
                    <tr key={i}>
                      <td>{l.panel}</td>
                      <td>{l.parameter}</td>
                      <td className={`num ${kelas}`}>{l.nilai}</td>
                      <td>{l.satuan ?? "—"}</td>
                      <td>{l.ref ?? "—"}</td>
                      {/* Teks, bukan hanya warna — sering difotokopi hitam-putih. */}
                      <td className={kelas}>{l.flag ? (FLAG_LABEL[l.flag] ?? l.flag) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : null}

        {p.obat.length > 0 || p.racikan.length > 0 ? (
          <>
            <div className="mr-bagian">Terapi / Resep</div>
            <ol className="mr-list">
              {p.obat.map((o, i) => (
                <li key={`o-${i}`}>
                  {o.nama} — {o.qty} {o.satuan}
                  <span className="mr-signa">S. {o.signa}</span>
                  {o.catatan ? <span className="mr-bahan">{o.catatan}</span> : null}
                </li>
              ))}
              {p.racikan.map((r, i) => (
                <li key={`r-${i}`}>
                  <strong>Racikan</strong> {r.nama} ({r.bentuk}) — {r.qty} {r.satuan}
                  <span className="mr-signa">S. {r.signa}</span>
                  {r.bahan.length > 0 ? (
                    <span className="mr-bahan">
                      Komposisi: {r.bahan.map((b) => `${b.nama} ${b.qty} ${b.satuan}`).join("; ")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </>
        ) : null}

        {p.asesmen?.edukasi ? (
          <>
            <div className="mr-bagian">Edukasi Pasien</div>
            <div className="mr-teks">{p.asesmen.edukasi}</div>
          </>
        ) : null}

        {/* Dokumen penunjang tidak ikut tercetak isinya — hanya didaftar,
            supaya pembaca tahu ada berkas lain yang menyertai kunjungan ini. */}
        {p.dokumen.length > 0 ? (
          <>
            <div className="mr-bagian">Dokumen Pendukung</div>
            <ul className="mr-list">
              {p.dokumen.map((d, i) => (
                <li key={i}>{d.keterangan || d.nama}</li>
              ))}
            </ul>
          </>
        ) : null}

        <div className="mr-ttd">
          <div className="mr-ttd-box">
            <div>
              {klinik.alamat ? klinik.alamat.split(",").pop()?.trim() : ""},{" "}
              {formatTanggal(visit.tanggal)}
            </div>
            <div>Dokter Pemeriksa,</div>
            <div className="mr-ttd-garis">
              {p.dokter.gelar ? `${p.dokter.gelar} ` : ""}{p.dokter.nama}
            </div>
            <div>{p.dokter.noSip ? `SIP: ${p.dokter.noSip}` : "SIP: —"}</div>
          </div>
        </div>

        <div className="mr-foot">
          Dicetak oleh <strong>{p.dicetakOleh}</strong> dari sistem informasi{" "}
          {klinik.nama}. Dokumen ini memuat data medis pasien dan bersifat
          rahasia — serahkan hanya kepada yang berhak menerimanya.
        </div>
      </div>
    );
  },
);

/** Satu baris "label : isi". Tidak tampil bila isinya kosong. */
function Baris({
  label,
  isi,
  tebal,
}: {
  label: string;
  isi: string | null | undefined;
  tebal?: boolean;
}) {
  if (!isi) return null;
  return (
    <div className="mr-row">
      <span className="k">{label}</span>
      <span className="v" style={tebal ? { fontWeight: 700 } : undefined}>{isi}</span>
    </div>
  );
}

function Isi({ teks }: { teks: string | null | undefined }) {
  if (!teks) return <div className="mr-kosong">Tidak diisi.</div>;
  return <div className="mr-teks">{teks}</div>;
}

const kapital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Siluet tubuh untuk hasil cetak — sama persis dengan yang di layar, tetapi
 * tanpa interaksi. Koordinat titik dalam persen, jadi ukurannya boleh berbeda
 * antara layar dan kertas tanpa penandanya bergeser.
 */
function GambarLokalis({
  sisi,
  titik,
}: {
  sisi: "depan" | "belakang";
  titik: DataRekamMedis["lokalis"]["titik"];
}) {
  const milik = titik
    .map((t, i) => ({ t, nomor: i + 1 }))
    .filter((x) => x.t.sisi === sisi);

  return (
    <figure style={{ margin: 0, textAlign: "center" }}>
      <svg viewBox="0 0 120 300" width="34mm" height="85mm">
        <path
          d={SILUET_TUBUH}
          fill="#fbfcfc"
          stroke="#555"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        {sisi === "belakang" ? (
          <line x1={60} y1={64} x2={60} y2={168} stroke="#aaa" strokeWidth={0.8} strokeDasharray="4 3" />
        ) : null}
        {milik.map(({ t, nomor }) => (
          <g key={nomor}>
            <circle cx={(t.x / 100) * 120} cy={(t.y / 100) * 300} r={9}
              fill="#b91c1c" stroke="#fff" strokeWidth={1.5} />
            <text x={(t.x / 100) * 120} y={(t.y / 100) * 300 + 3.5}
              textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">
              {nomor}
            </text>
          </g>
        ))}
      </svg>
      <figcaption style={{ fontSize: "8pt", color: "#555" }}>{kapital(sisi)}</figcaption>
    </figure>
  );
}

const SILUET_TUBUH =
  "M 60 8 C 70 8 78 18 78 32 C 78 44 72 52 68 55 L 66 58 " +
  "C 72 60 82 64 88 72 C 93 82 96 100 98 122 C 100 142 101 162 102 180 " +
  "C 103 190 104 198 100 203 C 96 207 92 204 91 196 " +
  "C 90 186 88 168 86 150 C 84 128 82 110 79 92 L 76 88 " +
  "C 75 108 74 128 74 145 C 74 155 75 162 76 170 " +
  "C 76 195 75 225 73 250 C 72 265 71 275 72 283 C 73 289 76 291 74 293 " +
  "L 64 293 C 62 291 62 286 62 280 C 62 250 61 215 60 178 " +
  "C 59 215 58 250 58 280 C 58 286 58 291 56 293 " +
  "L 46 293 C 44 291 47 289 48 283 C 49 275 48 265 47 250 " +
  "C 45 225 44 195 44 170 C 45 162 46 155 46 145 " +
  "C 46 128 45 108 44 88 L 41 92 " +
  "C 38 110 36 128 34 150 C 32 168 30 186 29 196 " +
  "C 28 204 24 207 20 203 C 16 198 17 190 18 180 " +
  "C 19 162 20 142 22 122 C 24 100 27 82 32 72 " +
  "C 38 64 48 60 54 58 L 52 55 C 48 52 42 44 42 32 C 42 18 50 8 60 8 Z";
