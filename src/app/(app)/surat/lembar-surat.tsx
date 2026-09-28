"use client";

import { forwardRef } from "react";
import { formatTanggal, hitungUmur } from "@/lib/format";
import { LABEL_BUTA_WARNA, type ButaWarna } from "@/lib/validations/dokumen";

export type DataSurat = {
  klinik: {
    nama: string;
    namaLegal: string | null;
    alamat: string | null;
    telepon: string | null;
    noIzin: string | null;
  };
  noSurat: string;
  jenis: string;
  terbit: string;
  pasien: {
    nama: string;
    noRm: string;
    nik: string;
    tanggalLahir: string;
    jenisKelamin: "L" | "P";
    alamat: string | null;
    pekerjaan: string | null;
  };
  dokter: string;
  gelar: string | null;
  noSip: string | null;
  data: Record<string, unknown>;
};

const JUDUL: Record<string, string> = {
  sakit: "Surat Keterangan Sakit",
  sehat: "Surat Keterangan Sehat",
  rujukan: "Surat Rujukan",
  keterangan_lain: "Surat Keterangan",
};

const s = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

/**
 * Kode buta warna → kalimat cetak.
 *
 * Mengembalikan null untuk kode yang tidak dikenal, bukan mencetak kodenya
 * mentah-mentah. Surat yang terbit sebelum parameter ini ada sama sekali
 * tidak punya field-nya, dan surat lama harus tetap tercetak utuh.
 */
function labelButaWarna(v: unknown): string | null {
  const k = s(v);
  return k && k in LABEL_BUTA_WARNA ? LABEL_BUTA_WARNA[k as ButaWarna] : null;
}

/**
 * Surat keterangan medis — kertas A4 dengan kop surat (CLAUDE.md §5.2).
 *
 * Kop ditarik dari tabel `sites`, bukan dituliskan di kode, supaya setiap
 * cabang mencetak identitasnya sendiri. Tanda tangan selalu memuat nama
 * dokter beserta No. SIP-nya: tanpa itu surat tidak sah dipakai pasien.
 */
export const LembarSurat = forwardRef<HTMLDivElement, DataSurat>(
  function LembarSurat(p, ref) {
    const d = p.data;
    const umur = hitungUmur(p.pasien.tanggalLahir);

    return (
      <div ref={ref} className="sk-sheet">
        <style>{`
          @page { size: A4; margin: 18mm; }
          @media print {
            html, body { margin: 0 !important; padding: 0 !important; background: #fff; }
          }
          .sk-sheet {
            width: 174mm; box-sizing: border-box; background: #fff; color: #000;
            font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.5;
          }
          .sk-kop { border-bottom: 1mm solid #0e5a4d; padding-bottom: 3mm; }
          .sk-kop-nama { font-size: 16pt; font-weight: 700; color: #0e5a4d; line-height: 1.15; }
          .sk-kop-sub { font-size: 9pt; color: #333; }
          .sk-judul { text-align: center; margin: 8mm 0 2mm; }
          .sk-judul h1 { font-size: 13pt; font-weight: 700; letter-spacing: 0.6pt;
                         text-transform: uppercase; text-decoration: underline; margin: 0; }
          .sk-no { text-align: center; font-size: 10pt; margin-bottom: 7mm; }
          .sk-p { margin: 0 0 3mm; text-align: justify; }
          .sk-id { margin: 0 0 4mm 8mm; font-size: 10.5pt; }
          .sk-id div { display: flex; gap: 2mm; }
          .sk-id dt { width: 38mm; flex-shrink: 0; }
          .sk-id dd { margin: 0; font-weight: 700; }
          .sk-kotak { border: 0.3mm solid #666; padding: 3mm 4mm; margin: 4mm 0; }
          .sk-ttd { margin-top: 12mm; display: flex; justify-content: flex-end; }
          .sk-ttd-box { width: 65mm; text-align: center; font-size: 10.5pt; }
          .sk-ttd-garis { margin-top: 20mm; font-weight: 700;
                          border-top: 0.3mm solid #000; padding-top: 1mm; }
          .sk-foot { margin-top: 8mm; font-size: 8pt; color: #555;
                     border-top: 0.3mm solid #ccc; padding-top: 2mm; }
          @media screen {
            .sk-sheet { border: 1px solid #dce3e0; border-radius: 4px; padding: 12mm; }
          }
        `}</style>

        <div className="sk-kop">
          <div className="sk-kop-nama">{p.klinik.nama}</div>
          <div className="sk-kop-sub">
            {p.klinik.namaLegal ? <div>{p.klinik.namaLegal}</div> : null}
            {p.klinik.alamat ? <div>{p.klinik.alamat}</div> : null}
            <div>
              {p.klinik.telepon ? `Telp. ${p.klinik.telepon}` : null}
              {p.klinik.telepon && p.klinik.noIzin ? " · " : null}
              {p.klinik.noIzin ? `Izin Klinik: ${p.klinik.noIzin}` : null}
            </div>
          </div>
        </div>

        <div className="sk-judul">
          <h1>{JUDUL[p.jenis] ?? "Surat Keterangan"}</h1>
        </div>
        <div className="sk-no">Nomor: {p.noSurat}</div>

        <p className="sk-p">
          Yang bertanda tangan di bawah ini, dokter pada {p.klinik.nama}, menerangkan
          bahwa:
        </p>

        <dl className="sk-id">
          <div><dt>Nama</dt><dd>{p.pasien.nama}</dd></div>
          <div><dt>NIK</dt><dd>{p.pasien.nik}</dd></div>
          <div><dt>No. Rekam Medis</dt><dd>{p.pasien.noRm}</dd></div>
          <div>
            <dt>Tanggal Lahir / Umur</dt>
            <dd>{formatTanggal(p.pasien.tanggalLahir)} / {umur} tahun</dd>
          </div>
          <div>
            <dt>Jenis Kelamin</dt>
            <dd>{p.pasien.jenisKelamin === "L" ? "Laki-laki" : "Perempuan"}</dd>
          </div>
          {p.pasien.pekerjaan ? (
            <div><dt>Pekerjaan</dt><dd>{p.pasien.pekerjaan}</dd></div>
          ) : null}
          {p.pasien.alamat ? (
            <div><dt>Alamat</dt><dd>{p.pasien.alamat}</dd></div>
          ) : null}
        </dl>

        <IsiSurat jenis={p.jenis} d={d} />

        <p className="sk-p">
          Demikian surat keterangan ini dibuat dengan sebenarnya untuk dipergunakan
          sebagaimana mestinya.
        </p>

        <div className="sk-ttd">
          <div className="sk-ttd-box">
            <div>{p.klinik.alamat ? p.klinik.alamat.split(",").pop()?.trim() : ""}, {formatTanggal(p.terbit)}</div>
            <div>Dokter Pemeriksa,</div>
            <div className="sk-ttd-garis">
              {p.gelar ? `${p.gelar} ` : ""}{p.dokter}
            </div>
            <div>{p.noSip ? `SIP: ${p.noSip}` : "SIP: —"}</div>
          </div>
        </div>

        <div className="sk-foot">
          Dokumen ini diterbitkan oleh sistem informasi {p.klinik.nama}. Keaslian
          dapat diverifikasi dengan mencocokkan nomor surat pada rekam medis pasien.
        </div>
      </div>
    );
  },
);

function IsiSurat({ jenis, d }: { jenis: string; d: Record<string, unknown> }) {
  if (jenis === "sakit") {
    const lama = Number(d.lama_hari ?? 0);
    const mulai = s(d.mulai);
    const sampai = mulai ? akhirIstirahat(mulai, lama) : null;
    return (
      <>
        <p className="sk-p">
          Berdasarkan hasil pemeriksaan, yang bersangkutan dalam keadaan{" "}
          <b>sakit</b> dan memerlukan istirahat selama <b>{lama} ({terbilang(lama)}) hari</b>
          {mulai ? (
            <>
              , terhitung mulai <b>{formatTanggal(mulai)}</b>
              {sampai ? <> sampai dengan <b>{formatTanggal(sampai)}</b></> : null}
            </>
          ) : null}
          .
        </p>
        {s(d.diagnosa_ditulis) ? (
          <div className="sk-kotak">Diagnosa: {s(d.diagnosa_ditulis)}</div>
        ) : null}
      </>
    );
  }

  if (jenis === "sehat") {
    const kodeWarna = s(d.buta_warna);
    const warna = labelButaWarna(d.buta_warna);
    const punyaPemeriksaan =
      s(d.tinggi_badan) || s(d.berat_badan) || s(d.tekanan_darah) || s(d.gol_darah) || warna;

    /*
     * Kalimat bakunya berbunyi "tidak ditemukan kelainan yang berarti". Bila
     * hasil tes buta warna justru menunjukkan kelainan, kalimat itu akan
     * membantah isi kotak pemeriksaan di bawahnya — surat yang membantah
     * dirinya sendiri tidak bisa dipakai pelamar kerja. Jadi untuk hasil
     * parsial/total kalimatnya menunjuk ke hasil, bukan menyangkalnya.
     */
    const adaKelainan = kodeWarna === "parsial" || kodeWarna === "total";

    return (
      <>
        <p className="sk-p">
          Berdasarkan hasil pemeriksaan pada tanggal tersebut di bawah, yang
          bersangkutan dinyatakan dalam keadaan <b>sehat</b>
          {adaKelainan ? (
            <>, dengan hasil pemeriksaan sebagaimana tercantum di bawah ini.</>
          ) : (
            <> dan tidak ditemukan kelainan yang berarti.</>
          )}
        </p>
        {punyaPemeriksaan ? (
          <div className="sk-kotak">
            {s(d.tinggi_badan) ? <div>Tinggi Badan: {s(d.tinggi_badan)} cm</div> : null}
            {s(d.berat_badan) ? <div>Berat Badan: {s(d.berat_badan)} kg</div> : null}
            {s(d.tekanan_darah) ? <div>Tekanan Darah: {s(d.tekanan_darah)} mmHg</div> : null}
            {s(d.gol_darah) ? <div>Golongan Darah: {s(d.gol_darah)}</div> : null}
            {warna ? <div>Penglihatan Warna: {warna}</div> : null}
          </div>
        ) : null}
        <p className="sk-p">
          Surat keterangan ini dibuat untuk keperluan <b>{s(d.keperluan)}</b>.
        </p>
      </>
    );
  }

  if (jenis === "rujukan") {
    return (
      <>
        <p className="sk-p">
          Bersama ini kami rujuk pasien tersebut di atas kepada{" "}
          <b>{s(d.tujuan_faskes)}</b>
          {s(d.tujuan_bagian) ? <>, bagian <b>{s(d.tujuan_bagian)}</b></> : null}, untuk
          mendapatkan pemeriksaan dan penanganan lebih lanjut.
        </p>
        <div className="sk-kotak">
          <div><b>Alasan Rujukan</b></div>
          <div style={{ whiteSpace: "pre-line" }}>{s(d.alasan_rujukan)}</div>
          {s(d.ringkasan_klinis) ? (
            <>
              <div style={{ marginTop: "2mm" }}><b>Ringkasan Klinis</b></div>
              <div style={{ whiteSpace: "pre-line" }}>{s(d.ringkasan_klinis)}</div>
            </>
          ) : null}
        </div>
        <p className="sk-p">
          Atas bantuan dan kerja sama Sejawat, kami ucapkan terima kasih.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="sk-p">
        Perihal: <b>{s(d.perihal)}</b>
      </p>
      <p className="sk-p" style={{ whiteSpace: "pre-line" }}>
        {s(d.isi_bebas)}
      </p>
    </>
  );
}

/** Hari terakhir istirahat: hari pertama ikut terhitung. */
function akhirIstirahat(mulai: string, lama: number): string | null {
  if (lama < 1) return null;
  const d = new Date(`${mulai}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + lama - 1);
  return d.toISOString().slice(0, 10);
}

const ANGKA = [
  "nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan",
  "sembilan", "sepuluh", "sebelas", "dua belas", "tiga belas", "empat belas",
  "lima belas", "enam belas", "tujuh belas", "delapan belas", "sembilan belas",
  "dua puluh",
];

/** Terbilang untuk lama istirahat — mencegah angka diubah setelah dicetak. */
function terbilang(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999) return String(n);
  if (n < ANGKA.length) return ANGKA[n];
  if (n < 100) {
    // Dulu 21–30 selalu "dua puluh …", sehingga 30 tercetak "dua puluh
    // sepuluh" — pada dokumen yang dipakai pasien sebagai bukti sah.
    const puluh = Math.floor(n / 10);
    const sisa = n % 10;
    return `${ANGKA[puluh]} puluh${sisa ? " " + ANGKA[sisa] : ""}`;
  }
  const ratus = Math.floor(n / 100);
  const sisa = n % 100;
  return `${ratus === 1 ? "seratus" : ANGKA[ratus] + " ratus"}${sisa ? " " + terbilang(sisa) : ""}`;
}
