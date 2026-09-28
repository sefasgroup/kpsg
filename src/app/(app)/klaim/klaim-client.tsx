"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { FilePlus2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { formatRupiah } from "@/lib/format";
import { buatKlaimAction } from "./actions";

export type OpsiPenjamin = { id: number; kode: string; nama: string; jenis: string };

export type KandidatBaris = {
  billingId: number;
  noInvoice: string;
  tanggal: string;
  noRm: string;
  pasien: string;
  noAnggota: string | null;
  nilai: number;
};

/**
 * Pembuat berkas klaim.
 *
 * Alurnya sengaja dua langkah: **lihat dulu, buat kemudian**. Klaim
 * mengunci tagihan-tagihannya (satu tagihan hanya boleh di satu klaim
 * berjalan), jadi berkas yang dibuat karena salah pilih periode harus
 * dibatalkan lagi — dan itu meninggalkan jejak pembatalan yang harus
 * dijelaskan ke penjamin. Melihat isinya lebih dulu jauh lebih murah.
 */
export function BuatKlaim({
  penjamin,
  bawaanDari,
  bawaanSampai,
  cariKandidat,
}: {
  penjamin: OpsiPenjamin[];
  bawaanDari: string;
  bawaanSampai: string;
  cariKandidat: (
    payerId: number,
    dari: string,
    sampai: string,
  ) => Promise<KandidatBaris[]>;
}) {
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [proses, setProses] = useState(false);
  const [payerId, setPayerId] = useState<string>("");
  const [dari, setDari] = useState(bawaanDari);
  const [sampai, setSampai] = useState(bawaanSampai);
  const [catatan, setCatatan] = useState("");
  const [kandidat, setKandidat] = useState<KandidatBaris[] | null>(null);

  const total = (kandidat ?? []).reduce((n, k) => n + k.nilai, 0);

  async function lihat() {
    if (!payerId) {
      toast.error("Pilih penjaminnya dulu.");
      return;
    }
    setProses(true);
    try {
      setKandidat(await cariKandidat(Number(payerId), dari, sampai));
    } finally {
      setProses(false);
    }
  }

  async function buat() {
    setProses(true);
    try {
      const hasil = await buatKlaimAction({
        payer_id: Number(payerId),
        periode_dari: dari,
        periode_sampai: sampai,
        catatan,
      });
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 7000 });
        return;
      }
      toast.success(
        `${hasil.data.noKlaim} dibuat — ${hasil.data.jumlahBaris} tagihan, ${formatRupiah(hasil.data.total)}.`,
      );
      setBuka(false);
      setKandidat(null);
      router.push(`/klaim/${hasil.data.id}`);
    } finally {
      setProses(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="primary" onClick={() => setBuka(true)}>
        <FilePlus2 />
        Buat Klaim
      </Button>

      <Modal
        open={buka}
        onClose={() => {
          setBuka(false);
          setKandidat(null);
        }}
        title="Buat Berkas Klaim"
        description="Hanya tagihan yang sudah lunas, ditanggung penjamin ini, dan belum masuk klaim lain."
        size="lg"
        footer={
          <>
            <Button
              onClick={() => {
                setBuka(false);
                setKandidat(null);
              }}
              disabled={proses}
            >
              Batal
            </Button>
            <Button onClick={lihat} disabled={proses}>
              <Search />
              {proses ? "Mencari…" : "Lihat Isinya"}
            </Button>
            <Button
              variant="primary"
              onClick={buat}
              disabled={proses || kandidat === null || kandidat.length === 0}
            >
              {proses ? "Memproses…" : `Buat Klaim${kandidat?.length ? ` (${kandidat.length})` : ""}`}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Penjamin" required className="sm:col-span-3">
              <Select
                value={payerId}
                onChange={(e) => {
                  setPayerId(e.target.value);
                  setKandidat(null);
                }}
              >
                <option value="">Pilih penjamin…</option>
                {penjamin.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nama} ({p.kode})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Periode Dari" required>
              <Input
                type="date"
                value={dari}
                onChange={(e) => {
                  setDari(e.target.value);
                  setKandidat(null);
                }}
              />
            </Field>
            <Field label="Sampai" required>
              <Input
                type="date"
                value={sampai}
                onChange={(e) => {
                  setSampai(e.target.value);
                  setKandidat(null);
                }}
              />
            </Field>
            <Field label="Catatan">
              <Input value={catatan} onChange={(e) => setCatatan(e.target.value)} />
            </Field>
          </div>

          {kandidat === null ? (
            <p className="rounded-md border border-line bg-surface-alt px-3 py-4 text-center text-meta text-ink-muted">
              Tekan <strong>Lihat Isinya</strong> untuk memeriksa tagihan yang akan
              masuk klaim sebelum berkasnya dibuat.
            </p>
          ) : kandidat.length === 0 ? (
            <p className="rounded-md border border-warning/30 bg-warning-bg px-3 py-4 text-center text-meta text-ink">
              Tidak ada tagihan yang bisa diklaim pada periode ini.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b border-line bg-surface-alt text-left text-label text-ink-muted">
                    <th className="px-2 py-1.5">Tanggal</th>
                    <th className="px-2 py-1.5">Invoice</th>
                    <th className="px-2 py-1.5">Pasien</th>
                    <th className="px-2 py-1.5">No. Anggota</th>
                    <th className="px-2 py-1.5 text-right">Ditanggung</th>
                  </tr>
                </thead>
                <tbody>
                  {kandidat.map((k) => (
                    <tr key={k.billingId} className="border-b border-line last:border-b-0">
                      <td className="px-2 py-1.5 text-meta">{k.tanggal.slice(0, 10)}</td>
                      <td className="px-2 py-1.5 font-mono text-meta">{k.noInvoice}</td>
                      <td className="px-2 py-1.5">
                        {k.pasien}
                        <span className="ml-1.5 font-mono text-meta text-ink-faint">
                          {k.noRm}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-meta">
                        {k.noAnggota ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular">
                        {formatRupiah(k.nilai)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line-strong bg-surface-alt font-medium">
                    <td className="px-2 py-1.5" colSpan={4}>
                      {kandidat.length} tagihan
                    </td>
                    <td className="px-2 py-1.5 text-right tabular">
                      {formatRupiah(total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
