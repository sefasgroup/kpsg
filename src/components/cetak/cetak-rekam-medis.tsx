"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useReactToPrint } from "react-to-print";
import toast from "react-hot-toast";
import { Eye, FileDown, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ambilRekamMedisAction } from "@/app/(app)/rekam-medis-actions";
import { LembarRekamMedis, type DataRekamMedis } from "./lembar-rekam-medis";

/**
 * Tombol cetak rekam medis SATU kunjungan.
 *
 * Dipakai di dua layar: pemeriksaan dokter dan Riwayat Pasien. Datanya
 * diambil saat tombol ditekan, bukan ikut dimuat bersama halaman — layar
 * Riwayat Pasien menampilkan sampai 50 kunjungan, dan merakit rekam medis
 * lengkap untuk semuanya di muka berarti puluhan query untuk dokumen yang
 * mungkin tidak satu pun dicetak.
 */
export function CetakRekamMedis({
  visitId,
  ringkas = false,
}: {
  visitId: number;
  /** Mode ringkas: satu tombol saja, untuk baris di daftar riwayat. */
  ringkas?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<DataRekamMedis | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [pratinjau, setPratinjau] = useState(false);
  const [panduanPdf, setPanduanPdf] = useState(false);

  const cetak = useReactToPrint({
    contentRef: ref,
    documentTitle: data
      ? `RM ${data.pasien.noRm} — ${data.visit.noVisit}`
      : "Rekam Medis",
  });

  /**
   * `flushSync` disengaja: `react-to-print` membaca DOM yang sedang ter-render.
   * Tanpa memaksa React menuliskan lembarnya lebih dulu, `cetak()` berjalan
   * saat elemennya masih kosong dan yang keluar adalah halaman putih.
   */
  async function muat(): Promise<DataRekamMedis | null> {
    /*
     * Selalu diambil ulang, tidak memakai hasil pengambilan sebelumnya.
     * Tombol ini ada juga di layar pemeriksaan yang masih draft: dokter
     * mencetak, mengubah SOAP atau diagnosa, lalu mencetak lagi — dan dulu
     * yang keluar adalah isi LAMA dari cetakan pertama.
     */
    setMemuat(true);
    try {
      const h = await ambilRekamMedisAction(visitId);
      if (!h.ok) {
        toast.error(h.error);
        return null;
      }
      flushSync(() => setData(h.data));
      return h.data;
    } finally {
      setMemuat(false);
    }
  }

  async function bukaPratinjau() {
    if (await muat()) setPratinjau(true);
  }

  async function cetakLangsung() {
    if (await muat()) cetak();
  }

  async function bukaPanduanPdf() {
    if (await muat()) setPanduanPdf(true);
  }

  const draf = data !== null && (data.asesmen === null || data.asesmen.status !== "final");

  return (
    <>
      {ringkas ? (
        <Button type="button" size="sm" variant="ghost" onClick={bukaPratinjau} disabled={memuat}>
          <Printer />
          {memuat ? "Memuat…" : "Cetak RM"}
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={bukaPratinjau} disabled={memuat}>
            <Eye />
            {memuat ? "Memuat…" : "Pratinjau RM"}
          </Button>
          <Button type="button" size="sm" onClick={cetakLangsung} disabled={memuat}>
            <Printer />
            Cetak
          </Button>
          <Button type="button" size="sm" onClick={bukaPanduanPdf} disabled={memuat}>
            <FileDown />
            Simpan PDF
          </Button>
        </div>
      )}

      {/* `react-to-print` butuh elemen yang benar-benar ter-render; kalau hanya
          ada di dalam modal, tombol Cetak mati selagi modalnya tertutup. */}
      {data ? (
        <div className="hidden" aria-hidden>
          <LembarRekamMedis ref={ref} {...data} />
        </div>
      ) : null}

      <Modal
        open={pratinjau && data !== null}
        onClose={() => setPratinjau(false)}
        title={data ? `Rekam Medis — ${data.pasien.nama}` : ""}
        description={data ? `${data.visit.noVisit} · ${data.visit.poli}` : undefined}
        size="lg"
        footer={
          <>
            <Button onClick={() => setPratinjau(false)}>Tutup</Button>
            <Button onClick={() => setPanduanPdf(true)}>
              <FileDown />
              Simpan PDF
            </Button>
            <Button variant="primary" onClick={() => cetak()}>
              <Printer />
              Cetak
            </Button>
          </>
        }
      >
        {data ? <LembarRekamMedis {...data} /> : null}
      </Modal>

      <Modal
        open={panduanPdf}
        onClose={() => setPanduanPdf(false)}
        size="sm"
        title="Simpan sebagai PDF"
        description="Dialog cetak akan terbuka. Ubah tujuannya menjadi PDF, lalu simpan."
        footer={
          <>
            <Button onClick={() => setPanduanPdf(false)}>Batal</Button>
            <Button
              variant="primary"
              onClick={() => {
                setPanduanPdf(false);
                cetak();
              }}
            >
              <FileDown />
              Buka Dialog Cetak
            </Button>
          </>
        }
      >
        <ol className="flex list-inside list-decimal flex-col gap-1 text-body text-ink">
          <li>
            Pada bagian <strong>Tujuan</strong> / <em>Destination</em>, pilih{" "}
            <strong>Save as PDF</strong> atau <strong>Microsoft Print to PDF</strong>.
          </li>
          <li>Klik <strong>Simpan</strong>, lalu tentukan lokasi berkasnya.</li>
        </ol>
        {draf ? (
          <p className="mt-2.5 rounded-md border border-warning/25 bg-warning-bg px-3 py-2 text-meta text-ink">
            Asesmen kunjungan ini belum difinalkan. Berkasnya akan bertanda{" "}
            <strong>DRAF</strong> dan belum sah sebagai rekam medis.
          </p>
        ) : null}
      </Modal>
    </>
  );
}
