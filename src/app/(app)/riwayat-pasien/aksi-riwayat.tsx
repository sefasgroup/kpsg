"use client";

import { useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { Eye, FileDown, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { LembarRiwayat, type DataResume } from "./lembar-riwayat";

/**
 * Tombol Cetak & Simpan PDF untuk resume rekam medis.
 *
 * Keduanya melewati dialog cetak peramban dan lembar yang SAMA — bedanya
 * hanya tujuan yang dipilih pengguna di dialog itu ("Microsoft Print to PDF"
 * / "Save as PDF" untuk menyimpan, atau printer sungguhan untuk mencetak).
 * Tombol terpisah disediakan karena bagi petugas keduanya adalah dua
 * pekerjaan berbeda, dan tombol "Simpan PDF" menyebutkan langkahnya.
 */
export function AksiRiwayat({ data }: { data: DataResume }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pratinjau, setPratinjau] = useState(false);
  const [panduanPdf, setPanduanPdf] = useState(false);

  const cetak = useReactToPrint({
    contentRef: ref,
    documentTitle: `Resume RM ${data.pasien.noRm} — ${data.pasien.nama}`,
  });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setPratinjau(true)}>
          <Eye />
          Pratinjau
        </Button>
        <Button type="button" onClick={() => cetak()}>
          <Printer />
          Cetak
        </Button>
        <Button type="button" variant="primary" onClick={() => setPanduanPdf(true)}>
          <FileDown />
          Simpan PDF
        </Button>
      </div>

      {/*
        Lembar cetak selalu ada di DOM, tetapi disembunyikan dari layar dan
        dari pembaca layar. `react-to-print` membutuhkan elemen yang benar-benar
        ter-render — menaruhnya di dalam modal berarti tombol Cetak tidak
        berfungsi selama modalnya tertutup.
      */}
      <div className="hidden" aria-hidden>
        <LembarRiwayat ref={ref} {...data} />
      </div>

      <Modal
        open={pratinjau}
        onClose={() => setPratinjau(false)}
        title={`Resume Rekam Medis — ${data.pasien.nama}`}
        description={`${data.kunjungan.length} kunjungan · ${data.lab.length} hasil lab`}
        size="lg"
        footer={
          <>
            <Button onClick={() => setPratinjau(false)}>Tutup</Button>
            <Button variant="primary" onClick={() => cetak()}>
              <Printer />
              Cetak
            </Button>
          </>
        }
      >
        <LembarRiwayat {...data} />
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
        <p className="mt-2.5 text-meta text-ink-muted">
          Nama berkas terisi otomatis:{" "}
          <span className="font-mono text-ink">
            Resume RM {data.pasien.noRm} — {data.pasien.nama}
          </span>
        </p>
        <p className="mt-2.5 rounded-md border border-warning/25 bg-warning-bg px-3 py-2 text-meta text-ink">
          Berkas ini memuat data medis pasien. Simpan di lokasi yang tidak dapat
          diakses bersama, dan serahkan hanya kepada yang berhak menerimanya.
        </p>
      </Modal>
    </>
  );
}
