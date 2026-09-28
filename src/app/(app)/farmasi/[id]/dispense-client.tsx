"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useReactToPrint } from "react-to-print";
import toast from "react-hot-toast";
import {
  CheckCircle2,
  FlaskConical,
  HandCoins,
  Hourglass,
  Inbox,
  Lock,
  PackageCheck,
  Pill,
  Printer,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { formatDesimal, formatRupiah } from "@/lib/format";
import {
  batalkanTerimaResepAction, batalkanValidasiAction, serahkanResepAction,
  terimaResepAction, validasiResepAction,
} from "../actions";
import { LembarEtiket, type DataEtiket } from "./etiket";

export type ItemPaten = {
  id: number;
  nama: string;
  qty: number;
  satuan: string;
  aturan_pakai: string;
  catatan: string | null;
  harga_satuan: number;
  stok: number;
  sudahDipotong: boolean;
};

export type ItemRacikan = {
  id: number;
  nama_racikan: string;
  bentuk_sediaan: string;
  qty_jadi: number;
  satuan_jadi: string;
  aturan_pakai: string;
  biaya_jasa_racik: number;
  catatan: string | null;
  ingredients: {
    id: number;
    nama: string;
    qty_bahan: number;
    satuan: string;
    harga_satuan: number;
    stok: number;
    sudahDipotong: boolean;
  }[];
};

export function DispenseClient({
  prescriptionId,
  status,
  sudahLunas,
  paten,
  racikan,
  pasien,
  noRm,
  namaKlinik,
}: {
  prescriptionId: number;
  status: string;
  /** Tagihan kunjungan ini sudah lunas — syarat obat boleh diserahkan. */
  sudahLunas: boolean;
  paten: ItemPaten[];
  racikan: ItemRacikan[];
  pasien: string;
  noRm: string;
  namaKlinik: string;
}) {
  const router = useRouter();
  const [proses, setProses] = useState(false);
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [kembalikan, setKembalikan] = useState(false);
  const [batalValidasi, setBatalValidasi] = useState(false);
  const [alasan, setAlasan] = useState("");
  const etiketRef = useRef<HTMLDivElement>(null);

  const cetakEtiket = useReactToPrint({
    contentRef: etiketRef,
    documentTitle: `Etiket ${noRm}`,
  });

  const sudahDiserahkan = status === "diserahkan";
  const sudahDiterima = status !== "baru";
  const sudahDivalidasi = status === "disiapkan";

  const nilaiObat = paten.reduce((n, p) => n + p.qty * p.harga_satuan, 0);
  const nilaiBahan = racikan.reduce(
    (n, r) => n + r.ingredients.reduce((m, b) => m + b.qty_bahan * b.harga_satuan, 0),
    0,
  );
  const nilaiJasa = racikan.reduce((n, r) => n + r.biaya_jasa_racik, 0);

  const patenKurang = paten.filter((p) => !p.sudahDipotong && p.qty > p.stok);
  const bahanKurang = racikan.flatMap((r) =>
    r.ingredients
      .filter((b) => !b.sudahDipotong && b.qty_bahan > b.stok)
      .map((b) => ({ racikan: r.nama_racikan, ...b })),
  );
  const adaKekurangan = patenKurang.length + bahanKurang.length > 0;

  const etiket: DataEtiket[] = [
    ...paten.map((p) => ({
      namaObat: p.nama,
      aturanPakai: p.aturan_pakai,
      qty: `${formatDesimal(p.qty)} ${p.satuan}`,
      catatan: p.catatan,
      isRacikan: false,
    })),
    ...racikan.map((r) => ({
      namaObat: r.nama_racikan,
      aturanPakai: r.aturan_pakai,
      qty: `${formatDesimal(r.qty_jadi)} ${r.satuan_jadi}`,
      catatan: r.catatan,
      isRacikan: true,
    })),
  ];

  async function terima() {
    setProses(true);
    try {
      const hasil = await terimaResepAction(prescriptionId);
      if (!hasil.ok) {
        toast.error(hasil.error);
        return;
      }
      toast.success("Resep diterima. Dokter tidak bisa mengubahnya lagi.");
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  async function batalkanKlaim() {
    setProses(true);
    try {
      const hasil = await batalkanTerimaResepAction(prescriptionId, alasan);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 8000 });
        return;
      }
      setKembalikan(false);
      setAlasan("");
      toast.success(
        `${hasil.data.no_resep} dikembalikan. Dokter sudah diberi tahu dan bisa merevisinya.`,
        { duration: 7000 },
      );
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  async function batalkanValidasi() {
    setProses(true);
    try {
      const hasil = await batalkanValidasiAction(prescriptionId);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 9000 });
        return;
      }
      setBatalValidasi(false);
      toast.success(
        `Validasi ${hasil.data.noResep} dibatalkan. Kunci stok dilepas dan biayanya keluar dari tagihan.`,
        { duration: 7000 },
      );
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  async function validasi() {
    setProses(true);
    try {
      const hasil = await validasiResepAction(prescriptionId);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 8000 });
        return;
      }
      setKonfirmasi(false);
      toast.success(
        `Stok dikunci. ${formatRupiah(hasil.data.total)} masuk tagihan — pasien bisa membayar di kasir.`,
        { duration: 7000 },
      );
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  async function serahkan() {
    setProses(true);
    try {
      const hasil = await serahkanResepAction(prescriptionId);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 8000 });
        return;
      }
      setKonfirmasi(false);
      toast.success(`${hasil.data.jumlahItem} item diserahkan. Kunjungan selesai.`);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- Obat paten ---------- */}
      {paten.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle icon={Pill}>Obat Paten</CardTitle>
            <Badge variant="neutral">{paten.length} item</Badge>
          </CardHeader>
          <ul className="flex flex-col gap-1.5">
            {paten.map((p) => {
              const kurang = !p.sudahDipotong && p.qty > p.stok;
              return (
                <li
                  key={p.id}
                  className="rounded-md border border-line bg-surface-alt px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                      {p.nama}
                    </p>
                    <span className="text-body text-ink tabular">
                      {formatDesimal(p.qty)} {p.satuan}
                    </span>
                    <span
                      className={`text-meta tabular ${kurang ? "text-danger" : "text-ink-faint"}`}
                    >
                      {kurang ? (
                        <span className="inline-flex items-center gap-1">
                          <TriangleAlert className="size-3" aria-hidden />
                          stok {formatDesimal(p.stok)}
                        </span>
                      ) : p.sudahDipotong ? (
                        <span className="inline-flex items-center gap-1 text-success">
                          <PackageCheck className="size-3" aria-hidden />
                          stok terpotong
                        </span>
                      ) : (
                        `stok ${formatDesimal(p.stok)}`
                      )}
                    </span>
                    <span className="w-24 text-right text-body text-ink tabular">
                      {formatRupiah(p.qty * p.harga_satuan)}
                    </span>
                  </div>
                  <p className="mt-1 text-meta text-ink-muted">
                    <span className="text-ink-faint">Aturan pakai: </span>
                    <strong className="text-ink">{p.aturan_pakai}</strong>
                    {p.catatan ? ` · ${p.catatan}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {/* ---------- Racikan ---------- */}
      {racikan.map((r) => (
        <Card key={r.id} className="border-l-[3px] border-l-racikan">
          <CardHeader>
            <CardTitle icon={FlaskConical}>
              <span className="text-racikan">{r.nama_racikan}</span>
            </CardTitle>
            <Badge variant="racikan">
              {formatDesimal(r.qty_jadi)} {r.satuan_jadi} · {r.bentuk_sediaan}
            </Badge>
          </CardHeader>

          <p className="mb-2.5 text-meta text-warning">
            Komposisi berikut adalah untuk <strong>keseluruhan racikan</strong>,
            bukan per {r.satuan_jadi}.
          </p>

          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-surface-alt">
                  <th className="border-b border-line px-3 py-2 text-left text-label font-medium text-ink-muted">Bahan</th>
                  <th className="border-b border-line px-3 py-2 text-right text-label font-medium text-ink-muted">Diambil</th>
                  <th className="border-b border-line px-3 py-2 text-right text-label font-medium text-ink-muted">Stok</th>
                  <th className="border-b border-line px-3 py-2 text-right text-label font-medium text-ink-muted">Nilai</th>
                </tr>
              </thead>
              <tbody>
                {r.ingredients.map((b) => {
                  const kurang = !b.sudahDipotong && b.qty_bahan > b.stok;
                  return (
                    <tr key={b.id} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-1.5 text-ink">{b.nama}</td>
                      <td className="px-3 py-1.5 text-right text-ink tabular">
                        {formatDesimal(b.qty_bahan)} {b.satuan}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular">
                        {kurang ? (
                          <span className="inline-flex items-center gap-1 text-danger">
                            <TriangleAlert className="size-3" aria-hidden />
                            {formatDesimal(b.stok)}
                          </span>
                        ) : b.sudahDipotong ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <PackageCheck className="size-3" aria-hidden />
                            terpotong
                          </span>
                        ) : (
                          <span className="text-ink-muted">{formatDesimal(b.stok)}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right text-ink tabular">
                        {formatRupiah(b.qty_bahan * b.harga_satuan)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-meta text-ink-muted">
              <span className="text-ink-faint">Aturan pakai: </span>
              <strong className="text-ink">{r.aturan_pakai}</strong>
            </p>
            <p className="text-meta text-ink-muted">
              Jasa racik{" "}
              <strong className="text-racikan tabular">
                {formatRupiah(r.biaya_jasa_racik)}
              </strong>{" "}
              — ditagihkan sebagai baris tersendiri
            </p>
          </div>
        </Card>
      ))}

      {/* ---------- Peringatan stok ---------- */}
      {adaKekurangan && !sudahDiserahkan ? (
        <div className="rounded-md border border-danger/25 bg-danger-bg px-4 py-3">
          <p className="flex items-center gap-2 text-body font-medium text-danger">
            <TriangleAlert className="size-4" aria-hidden />
            Stok tidak mencukupi — penyerahan akan ditolak
          </p>
          <ul className="mt-1.5 flex list-inside list-disc flex-col gap-0.5 text-meta text-danger">
            {patenKurang.map((p) => (
              <li key={`p-${p.id}`}>
                {p.nama}: butuh {formatDesimal(p.qty)} {p.satuan}, tersedia{" "}
                {formatDesimal(p.stok)}
              </li>
            ))}
            {bahanKurang.map((b) => (
              <li key={`b-${b.id}`}>
                {b.nama} (bahan {b.racikan}): butuh {formatDesimal(b.qty_bahan)}{" "}
                {b.satuan}, tersedia {formatDesimal(b.stok)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ---------- Ringkasan & aksi ---------- */}
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="text-meta text-ink-muted">
            <p>
              Obat <strong className="text-ink tabular">{formatRupiah(nilaiObat)}</strong>
              {" · "}Bahan racikan{" "}
              <strong className="text-racikan tabular">{formatRupiah(nilaiBahan)}</strong>
              {" · "}Jasa racik{" "}
              <strong className="text-racikan tabular">{formatRupiah(nilaiJasa)}</strong>
            </p>
            <p className="mt-0.5 text-h2 text-ink">
              Total masuk tagihan{" "}
              <span className="tabular">
                {formatRupiah(nilaiObat + nilaiBahan + nilaiJasa)}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => cetakEtiket()}
              disabled={etiket.length === 0}
            >
              <Printer />
              Cetak Etiket ({etiket.length})
            </Button>

            {sudahDiserahkan ? (
              <Badge variant="success">
                <CheckCircle2 />
                Sudah diserahkan
              </Badge>
            ) : !sudahDiterima ? (
              <Button type="button" variant="primary" onClick={terima} disabled={proses}>
                <Inbox />
                {proses ? "Memproses…" : "Terima Resep"}
              </Button>
            ) : (
              <>
                {/*
                  TANGGA PEMBATALAN — satu anak tangga per tahap, dan tiap
                  turunan adalah kebalikan persis dari naiknya.

                    diterima_farmasi → [Kembalikan ke Dokter] → dokter
                    disiapkan        → [Batalkan Validasi]    → diterima_farmasi
                    lunas            → (batalkan pembayaran di kasir)

                  "Kembalikan ke Dokter" sengaja HANYA ada di tahap verifikasi.
                  Di situ ia murah dan aman: belum ada stok terkunci, belum ada
                  baris tagihan, pasien belum dikirim ke kasir. Satu tombol yang
                  membatalkan dua langkah sekaligus adalah cara paling mudah
                  meninggalkan setengah keadaan yang tidak konsisten — dan itu
                  memang pernah terjadi.
                */}
                {!sudahDivalidasi ? (
                  <Button
                    type="button"
                    onClick={() => setKembalikan(true)}
                    disabled={proses}
                  >
                    <Undo2 />
                    Kembalikan ke Dokter
                  </Button>
                ) : !sudahLunas ? (
                  <Button
                    type="button"
                    onClick={() => setBatalValidasi(true)}
                    disabled={proses}
                  >
                    <Undo2 />
                    Batalkan Validasi
                  </Button>
                ) : null}
                {/*
                  Dua tahap, dua tombol. Yang tampil bergantung pada apakah
                  resepnya sudah divalidasi — dan yang kedua terkunci sampai
                  pasien benar-benar membayar.
                */}
                {!sudahDivalidasi ? (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => setKonfirmasi(true)}
                    disabled={proses || adaKekurangan}
                  >
                    <Lock />
                    Validasi & Kirim ke Kasir
                  </Button>
                ) : sudahLunas ? (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={serahkan}
                    disabled={proses}
                  >
                    <HandCoins />
                    {proses ? "Memproses…" : "Serahkan Obat"}
                  </Button>
                ) : (
                  <Badge variant="warning">
                    <Hourglass />
                    Menunggu pembayaran di kasir
                  </Badge>
                )}
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Pratinjau etiket — juga jadi sumber cetak react-to-print */}
      <Card>
        <CardHeader>
          <CardTitle icon={Printer}>Pratinjau Etiket</CardTitle>
          <span className="text-meta text-ink-faint">
            Stiker 50 × 30 mm · aturan pakai sengaja dibuat paling besar
          </span>
        </CardHeader>
        <div className="flex flex-wrap gap-3">
          <LembarEtiket
            ref={etiketRef}
            pasien={pasien}
            noRm={noRm}
            namaKlinik={namaKlinik}
            tanggal={new Date()}
            daftar={etiket}
          />
        </div>
      </Card>

      <Modal
        open={batalValidasi}
        onClose={() => setBatalValidasi(false)}
        size="sm"
        title="Batalkan validasi resep?"
        description="Satu langkah mundur — resep kembali ke tahap verifikasi, belum dikembalikan ke dokter."
        footer={
          <>
            <Button type="button" onClick={() => setBatalValidasi(false)} disabled={proses}>
              Tutup
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={batalkanValidasi}
              disabled={proses}
            >
              <Undo2 />
              {proses ? "Memproses…" : "Batalkan Validasi"}
            </Button>
          </>
        }
      >
        <ul className="flex list-inside list-disc flex-col gap-1 text-meta text-ink-muted">
          <li>
            <strong>Kunci stok dilepas</strong> — obatnya kembali tersedia untuk
            pasien lain.
          </li>
          <li>
            Biaya obat, racikan, dan jasa racik dikeluarkan dari tagihan; pasien
            hilang dari antrean kasir.
          </li>
          <li>
            Sesudah ini resep bisa divalidasi ulang, atau dikembalikan ke dokter
            bila memang perlu direvisi.
          </li>
        </ul>
      </Modal>

      <Modal
        open={kembalikan}
        onClose={() => setKembalikan(false)}
        size="sm"
        title="Kembalikan resep ke dokter?"
        description="Klaim dilepas dan dokter bisa merevisi resepnya. Stok belum tersentuh sama sekali, jadi tidak ada saldo gudang yang berubah."
        footer={
          <>
            <Button type="button" onClick={() => setKembalikan(false)} disabled={proses}>
              Batal
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={batalkanKlaim}
              disabled={proses || alasan.trim().length < 10}
            >
              <Undo2 />
              {proses ? "Memproses…" : "Kembalikan"}
            </Button>
          </>
        }
      >
        <Field
          label="Alasan pengembalian"
          required
          hint="Dibaca dokter di notifikasinya — sebutkan bagian mana yang perlu diperbaiki."
        >
          <Textarea
            rows={3}
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
            placeholder="mis. Dosis Paracetamol 500 mg ×15 untuk anak 4 tahun terlalu besar."
          />
        </Field>
        <p className="mt-1 text-meta text-ink-faint">
          {alasan.trim().length < 10
            ? `Minimal 10 karakter (${alasan.trim().length}).`
            : "Pasien akan kembali berstatus dalam pemeriksaan."}
        </p>
      </Modal>

      <Modal
        open={konfirmasi}
        onClose={() => setKonfirmasi(false)}
        size="sm"
        title="Validasi resep & kirim ke kasir?"
        description="Stok dikunci dan harganya difinalkan, tetapi obat BELUM diserahkan. Pasien membayar dulu, baru obatnya diambil di sini."
        footer={
          <>
            <Button type="button" onClick={() => setKonfirmasi(false)} disabled={proses}>
              Batal
            </Button>
            <Button type="button" variant="primary" onClick={validasi} disabled={proses}>
              <Lock />
              {proses ? "Memproses…" : "Ya, Validasi"}
            </Button>
          </>
        }
      >
        <ul className="flex flex-col gap-1 text-body text-ink">
          <li>
            {paten.length} obat paten dan {racikan.length} racikan{" "}
            ({racikan.reduce((n, r) => n + r.ingredients.length, 0)} bahan) dikunci
            — tidak bisa dipakai resep pasien lain
          </li>
          <li>
            {formatRupiah(nilaiObat + nilaiBahan + nilaiJasa)} masuk tagihan pasien
          </li>
          <li>Pasien diteruskan ke kasir untuk membayar</li>
        </ul>
        <p className="mt-2.5 rounded-md border border-line bg-surface-alt px-3 py-2 text-meta text-ink-muted">
          Stok baru benar-benar berkurang saat Anda menekan{" "}
          <strong className="text-ink">Serahkan Obat</strong> setelah tagihan lunas.
        </p>
      </Modal>
    </div>
  );
}
