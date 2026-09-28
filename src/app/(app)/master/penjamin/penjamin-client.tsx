"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { HandCoins, PencilLine, Plus, PowerOff, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Autocomplete } from "@/components/ui/autocomplete";
import { formatRupiah } from "@/lib/format";
import {
  JENIS_PENJAMIN,
  LABEL_JENIS_PENJAMIN,
  type PenjaminFormValues,
} from "@/lib/validations/penjamin";
import {
  hapusTarifAction,
  nonaktifkanPenjaminAction,
  simpanPenjaminAction,
  simpanTarifAction,
} from "./actions";

export type BarisPenjamin = {
  id: number;
  kode: string;
  nama: string;
  jenis: "bpjs" | "asuransi" | "perusahaan";
  npwp: string | null;
  alamat: string | null;
  telepon: string | null;
  email: string | null;
  pic_nama: string | null;
  pic_telepon: string | null;
  termin_hari: number;
  plafon: number;
  catatan: string | null;
  is_active: boolean;
  jumlahTarif: number;
  jumlahPasien: number;
};

export type BarisTarif = {
  id: number;
  sasaran: string;
  kodeSasaran: string;
  jenisSasaran: "tindakan" | "barang";
  harga: number;
  hargaNormal: number;
};

export type OpsiSasaran = { id: number; kode: string; nama: string; harga: number };

const KOSONG: PenjaminFormValues = {
  kode: "",
  nama: "",
  jenis: "perusahaan",
  termin_hari: 30,
  plafon_per_kunjungan: 0,
  is_active: true,
};

export function PenjaminClient({
  daftar,
  tarifTerpilih,
  terpilihId,
  cariTindakan,
  cariBarang,
}: {
  daftar: BarisPenjamin[];
  tarifTerpilih: BarisTarif[];
  terpilihId: number | null;
  cariTindakan: (q: string) => Promise<OpsiSasaran[]>;
  cariBarang: (q: string) => Promise<OpsiSasaran[]>;
}) {
  const router = useRouter();
  const [proses, setProses] = useState(false);
  const [form, setForm] = useState<PenjaminFormValues | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [nonaktifkan, setNonaktifkan] = useState<BarisPenjamin | null>(null);

  const terpilih = daftar.find((p) => p.id === terpilihId) ?? null;

  function buka(p?: BarisPenjamin) {
    setGalat(null);
    setEditId(p?.id ?? null);
    setForm(
      p
        ? {
            kode: p.kode, nama: p.nama, jenis: p.jenis,
            npwp: p.npwp ?? "", alamat: p.alamat ?? "", telepon: p.telepon ?? "",
            email: p.email ?? "", pic_nama: p.pic_nama ?? "",
            pic_telepon: p.pic_telepon ?? "", termin_hari: p.termin_hari,
            plafon_per_kunjungan: p.plafon, catatan: p.catatan ?? "",
            is_active: p.is_active,
          }
        : KOSONG,
    );
  }

  async function simpan() {
    if (!form) return;
    setProses(true);
    setGalat(null);
    try {
      const hasil = await simpanPenjaminAction(form, editId ?? undefined);
      if (!hasil.ok) {
        setGalat(hasil.error);
        toast.error(hasil.error);
        return;
      }
      toast.success(editId ? "Penjamin diperbarui." : "Penjamin ditambahkan.");
      setForm(null);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  async function jalankanNonaktif() {
    if (!nonaktifkan) return;
    setProses(true);
    try {
      const hasil = await nonaktifkanPenjaminAction(nonaktifkan.id);
      if (!hasil.ok) {
        toast.error(hasil.error);
        return;
      }
      toast.success(`${nonaktifkan.nama} dinonaktifkan.`);
      setNonaktifkan(null);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  async function tambahTarif(
    jenis: "tindakan" | "barang",
    opsi: OpsiSasaran,
    harga: number,
  ) {
    if (!terpilih) return;
    setProses(true);
    try {
      const hasil = await simpanTarifAction({
        payer_id: terpilih.id,
        procedure_id: jenis === "tindakan" ? opsi.id : null,
        item_id: jenis === "barang" ? opsi.id : null,
        harga,
      });
      if (!hasil.ok) {
        toast.error(hasil.error);
        return;
      }
      toast.success(`Tarif ${opsi.nama} disimpan.`);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  async function hapusTarif(t: BarisTarif) {
    if (!terpilih) return;
    setProses(true);
    try {
      const hasil = await hapusTarifAction(t.id, terpilih.id);
      if (!hasil.ok) {
        toast.error(hasil.error);
        return;
      }
      toast.success("Tarif kontrak dihapus — kembali ke tarif normal.");
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_1fr] lg:items-start">
      <Card>
        <CardHeader>
          <CardTitle icon={HandCoins}>Daftar Penjamin</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="brand">{daftar.length}</Badge>
            <Button size="sm" variant="primary" onClick={() => buka()}>
              <Plus />
              Tambah
            </Button>
          </div>
        </CardHeader>

        {daftar.length === 0 ? (
          <p className="rounded-md border border-line bg-surface-alt px-3 py-6 text-center text-meta text-ink-muted">
            Belum ada penjamin. Tambahkan BPJS, asuransi, atau perusahaan yang
            bekerja sama dengan klinik.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {daftar.map((p) => (
              <li key={p.id}>
                <div
                  className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 ${
                    p.id === terpilihId
                      ? "border-brand-400 bg-brand-50"
                      : "border-line bg-surface-alt"
                  } ${p.is_active ? "" : "opacity-60"}`}
                >
                  <a
                    href={`/master/penjamin?penjamin=${p.id}`}
                    className="min-w-0 flex-1"
                  >
                    <p className="truncate text-body font-medium text-ink">
                      {p.nama}
                      {!p.is_active ? (
                        <span className="ml-2 text-micro text-ink-faint uppercase">
                          nonaktif
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-meta text-ink-muted">
                      <span className="font-mono">{p.kode}</span> ·{" "}
                      {LABEL_JENIS_PENJAMIN[p.jenis]} · termin {p.termin_hari} hari ·{" "}
                      {p.plafon > 0 ? `plafon ${formatRupiah(p.plafon)}` : "tanpa plafon"}
                    </p>
                    <p className="truncate text-meta text-ink-faint">
                      {p.jumlahTarif} tarif kontrak · {p.jumlahPasien} pasien
                    </p>
                  </a>
                  <Button size="sm" variant="ghost" onClick={() => buka(p)}>
                    <PencilLine />
                    Ubah
                  </Button>
                  {p.is_active ? (
                    <Button size="sm" variant="ghost" onClick={() => setNonaktifkan(p)}>
                      <PowerOff />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle icon={HandCoins}>
            {terpilih ? `Tarif Kontrak — ${terpilih.nama}` : "Tarif Kontrak"}
          </CardTitle>
          {terpilih ? <Badge variant="neutral">{tarifTerpilih.length}</Badge> : null}
        </CardHeader>

        {!terpilih ? (
          <p className="rounded-md border border-line bg-surface-alt px-3 py-6 text-center text-meta text-ink-muted">
            Pilih penjamin di sebelah untuk mengatur tarif kontraknya.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {/*
              Urutan kewenangan harga dieja di layar, bukan hanya di kode.
              Petugas yang mengisi tarif kontrak perlu tahu bahwa isian ini
              MENIMPA tarif cabang — kalau tidak, selisih tagihan nanti
              dicari-cari penyebabnya di tempat yang salah.
            */}
            <p className="rounded-md border border-info/25 bg-info-bg px-3 py-2 text-meta text-ink">
              Tarif kontrak <strong>menimpa</strong> tarif cabang maupun tarif
              global. Yang tidak diisi di sini otomatis memakai tarif normal.
            </p>

            <PemilihTarif
              label="Tambah tarif tindakan"
              placeholder="Cari tindakan medis…"
              cari={cariTindakan}
              nonaktif={proses}
              onTambah={(o, h) => tambahTarif("tindakan", o, h)}
            />
            <PemilihTarif
              label="Tambah tarif obat / BMHP"
              placeholder="Cari obat atau BMHP…"
              cari={cariBarang}
              nonaktif={proses}
              onTambah={(o, h) => tambahTarif("barang", o, h)}
            />

            {tarifTerpilih.length === 0 ? (
              <p className="text-meta text-ink-faint">
                Belum ada tarif kontrak. Seluruh tagihan penjamin ini memakai
                tarif normal.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {tarifTerpilih.map((t) => {
                  const lebihMahal = t.harga > t.hargaNormal;
                  return (
                    <li
                      key={t.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-alt px-3 py-1.5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body text-ink">
                          {t.sasaran}
                        </span>
                        <span className="block truncate text-meta text-ink-faint">
                          <span className="font-mono">{t.kodeSasaran}</span> ·{" "}
                          {t.jenisSasaran === "tindakan" ? "Tindakan" : "Obat/BMHP"} ·
                          normal {formatRupiah(t.hargaNormal)}
                        </span>
                      </span>
                      <span
                        className={`text-body font-medium tabular ${
                          lebihMahal ? "text-warning" : "text-ink"
                        }`}
                      >
                        {formatRupiah(t.harga)}
                      </span>
                      {lebihMahal ? (
                        <Badge variant="warning">di atas tarif normal</Badge>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={proses}
                        onClick={() => hapusTarif(t)}
                        aria-label={`Hapus tarif ${t.sasaran}`}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </Card>

      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title={editId ? "Ubah Penjamin" : "Tambah Penjamin"}
        description="Kontrak berlaku untuk seluruh cabang."
        footer={
          <>
            <Button onClick={() => setForm(null)} disabled={proses}>
              Batal
            </Button>
            <Button variant="primary" onClick={simpan} disabled={proses}>
              {proses ? "Menyimpan…" : "Simpan"}
            </Button>
          </>
        }
      >
        {form ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kode" required>
              <Input
                value={form.kode}
                onChange={(e) =>
                  setForm({ ...form, kode: e.target.value.toUpperCase() })
                }
                placeholder="BPJS-KES"
              />
            </Field>
            <Field label="Jenis" required>
              <Select
                value={form.jenis}
                onChange={(e) =>
                  setForm({ ...form, jenis: e.target.value as typeof form.jenis })
                }
              >
                {JENIS_PENJAMIN.map((j) => (
                  <option key={j} value={j}>
                    {LABEL_JENIS_PENJAMIN[j]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nama Penjamin" required className="sm:col-span-2">
              <Input
                value={form.nama}
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
                placeholder="PT Sumber Sejahtera"
              />
            </Field>
            <Field
              label="Termin Pembayaran (hari)"
              required
              hint="Dasar perhitungan jatuh tempo klaim."
            >
              <Input
                type="number" min={1} max={365}
                value={String(form.termin_hari ?? "")}
                onChange={(e) => setForm({ ...form, termin_hari: e.target.value })}
              />
            </Field>
            <Field
              label="Plafon per Kunjungan"
              hint="0 = tanpa batas. Selisih di atas plafon ditagihkan ke pasien."
            >
              <Input
                type="number" min={0}
                value={String(form.plafon_per_kunjungan ?? "")}
                onChange={(e) =>
                  setForm({ ...form, plafon_per_kunjungan: e.target.value })
                }
              />
            </Field>
            <Field label="NPWP">
              <Input
                value={form.npwp ?? ""}
                onChange={(e) => setForm({ ...form, npwp: e.target.value })}
              />
            </Field>
            <Field label="Telepon">
              <Input
                value={form.telepon ?? ""}
                onChange={(e) => setForm({ ...form, telepon: e.target.value })}
              />
            </Field>
            <Field label="Nama PIC">
              <Input
                value={form.pic_nama ?? ""}
                onChange={(e) => setForm({ ...form, pic_nama: e.target.value })}
              />
            </Field>
            <Field label="Telepon PIC">
              <Input
                value={form.pic_telepon ?? ""}
                onChange={(e) => setForm({ ...form, pic_telepon: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.email ?? ""}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Alamat" className="sm:col-span-2">
              <Textarea
                value={form.alamat ?? ""}
                onChange={(e) => setForm({ ...form, alamat: e.target.value })}
              />
            </Field>
            <Field label="Catatan" className="sm:col-span-2">
              <Textarea
                value={form.catatan ?? ""}
                onChange={(e) => setForm({ ...form, catatan: e.target.value })}
              />
            </Field>
            {galat ? (
              <p className="rounded-md border border-danger/25 bg-danger-bg px-3 py-2 text-meta text-danger sm:col-span-2">
                {galat}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={nonaktifkan !== null}
        onClose={() => setNonaktifkan(null)}
        title="Nonaktifkan penjamin?"
        description={nonaktifkan?.nama}
        footer={
          <>
            <Button onClick={() => setNonaktifkan(null)} disabled={proses}>
              Batal
            </Button>
            <Button variant="danger" onClick={jalankanNonaktif} disabled={proses}>
              {proses ? "Memproses…" : "Nonaktifkan"}
            </Button>
          </>
        }
      >
        <p className="text-body text-ink">
          Penjamin <strong>dinonaktifkan, tidak dihapus</strong>. Ia berhenti
          muncul di pemilih pendaftaran, tetapi seluruh riwayat kunjungan,
          tagihan, dan klaim yang menunjuk penjamin ini tetap utuh — menghapusnya
          akan memusnahkan riwayat penagihan bertahun-tahun.
        </p>
      </Modal>
    </div>
  );
}

/** Pemilih sasaran + harga kontraknya. */
function PemilihTarif({
  label,
  placeholder,
  cari,
  nonaktif,
  onTambah,
}: {
  label: string;
  placeholder: string;
  cari: (q: string) => Promise<OpsiSasaran[]>;
  nonaktif: boolean;
  onTambah: (opsi: OpsiSasaran, harga: number) => void;
}) {
  const [dipilih, setDipilih] = useState<OpsiSasaran | null>(null);
  const [harga, setHarga] = useState("");

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line p-2.5">
      <p className="text-label text-ink-muted">{label}</p>

      {dipilih === null ? (
        <Autocomplete
          cari={cari}
          onPilih={(o) => {
            setDipilih(o);
            // Harga kontrak diawali tarif normal, bukan kosong: kontrak
            // paling sering berupa potongan dari tarif normal, jadi angka
            // itulah titik mulai yang benar.
            setHarga(String(o.harga));
          }}
          placeholder={placeholder}
          keyOf={(o) => o.id}
          renderBaris={(o) => (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body text-ink">{o.nama}</span>
              <span className="block truncate text-meta text-ink-faint">
                <span className="font-mono">{o.kode}</span> · normal{" "}
                {formatRupiah(o.harga)}
              </span>
            </span>
          )}
        />
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body text-ink">{dipilih.nama}</span>
            <span className="block text-meta text-ink-faint">
              normal {formatRupiah(dipilih.harga)}
            </span>
          </span>
          <Input
            type="number" min={0}
            value={harga}
            onChange={(e) => setHarga(e.target.value)}
            className="h-8 w-32"
            aria-label="Harga kontrak"
          />
          <Button
            size="sm"
            variant="primary"
            disabled={nonaktif || harga === ""}
            onClick={() => {
              onTambah(dipilih, Number(harga));
              setDipilih(null);
              setHarga("");
            }}
          >
            <Plus />
            Simpan
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDipilih(null)}>
            Batal
          </Button>
        </div>
      )}
    </div>
  );
}
