"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import {
  imporIcd10Action,
  imporItemAction,
  imporTindakanAction,
  simpanIcd10Action,
  simpanPanelAction,
  simpanParameterAction,
  simpanPoliAction,
  simpanSettingAction,
  simpanTindakanAction,
} from "../master-actions";

/** Pembungkus modal CRUD yang dipakai bersama seluruh form master data. */
function ModalCrud({
  judul,
  deskripsi,
  labelTambah,
  edit,
  onSimpan,
  children,
  size = "sm",
}: {
  judul: string;
  deskripsi?: string;
  labelTambah: string;
  edit?: boolean;
  onSimpan: () => Promise<boolean>;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const [open, setOpen] = useState(false);
  const [proses, setProses] = useState(false);

  async function simpan() {
    setProses(true);
    try {
      if (await onSimpan()) setOpen(false);
    } finally {
      setProses(false);
    }
  }

  return (
    <>
      {edit ? (
        <Button variant="ghost" size="sm" aria-label={judul} onClick={() => setOpen(true)}>
          <Pencil />
        </Button>
      ) : (
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          <Plus />
          {labelTambah}
        </Button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size={size}
        title={judul}
        description={deskripsi}
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={proses}>Batal</Button>
            <Button variant="primary" onClick={simpan} disabled={proses}>
              {proses ? "Menyimpan…" : "Simpan"}
            </Button>
          </>
        }
      >
        {children}
      </Modal>
    </>
  );
}

// --- Poli -------------------------------------------------------------

export function FormPoli({
  awal,
}: {
  awal?: { id: number; kode: string; nama: string; prefix_antrean: string };
}) {
  const router = useRouter();
  const [f, setF] = useState({
    kode: awal?.kode ?? "",
    nama: awal?.nama ?? "",
    prefix_antrean: awal?.prefix_antrean ?? "A",
  });

  return (
    <ModalCrud
      judul={awal ? `Ubah ${awal.nama}` : "Tambah Poli"}
      labelTambah="Tambah Poli"
      edit={Boolean(awal)}
      deskripsi="Prefix antrean menjadi awalan nomor antrean poli ini, mis. A001."
      onSimpan={async () => {
        const h = await simpanPoliAction(f, awal?.id);
        if (!h.ok) { toast.error(h.error); return false; }
        toast.success("Poli tersimpan.");
        router.refresh();
        return true;
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kode" required>
          <Input value={f.kode} onChange={(e) => setF({ ...f, kode: e.target.value.toUpperCase() })} className="font-mono" />
        </Field>
        <Field label="Prefix Antrean" required hint="1–2 huruf kapital">
          <Input
            value={f.prefix_antrean}
            maxLength={2}
            onChange={(e) => setF({ ...f, prefix_antrean: e.target.value.toUpperCase() })}
            className="font-mono"
          />
        </Field>
        <Field label="Nama Poli" required className="sm:col-span-2">
          <Input value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} />
        </Field>
      </div>
    </ModalCrud>
  );
}

// --- Tindakan ---------------------------------------------------------

export function FormTindakan({
  awal,
}: {
  awal?: {
    id: number; kode: string; nama: string; kategori: string | null;
    tarif: string; icd9cm: string | null; is_konsultasi: number;
  };
}) {
  const router = useRouter();
  const [f, setF] = useState({
    kode: awal?.kode ?? "",
    nama: awal?.nama ?? "",
    kategori: awal?.kategori ?? "",
    is_konsultasi: Number(awal?.is_konsultasi) === 1,
    tarif: awal?.tarif ?? "0",
    icd9cm: awal?.icd9cm ?? "",
  });

  return (
    <ModalCrud
      judul={awal ? `Ubah ${awal.nama}` : "Tambah Tindakan"}
      labelTambah="Tambah Tindakan"
      edit={Boolean(awal)}
      deskripsi="Tarif di sini adalah tarif global; cabang bisa menimpanya lewat tarif per-cabang."
      onSimpan={async () => {
        const h = await simpanTindakanAction(f, awal?.id);
        if (!h.ok) { toast.error(h.error); return false; }
        toast.success("Tindakan tersimpan.");
        router.refresh();
        return true;
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kode" required>
          <Input value={f.kode} onChange={(e) => setF({ ...f, kode: e.target.value.toUpperCase() })} className="font-mono" />
        </Field>
        <Field label="Kategori">
          <Input value={f.kategori} onChange={(e) => setF({ ...f, kategori: e.target.value })} placeholder="Tindakan / Penunjang" />
        </Field>
        <Field label="Nama Tindakan" required className="sm:col-span-2">
          <Input value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} />
        </Field>
        <Field label="Tarif (Rp)" required>
          <Input type="number" min={0} step={5000} value={f.tarif} onChange={(e) => setF({ ...f, tarif: e.target.value })} />
        </Field>
        <Field label="ICD-9-CM" hint="Untuk SatuSehat (Tahap 2)">
          <Input value={f.icd9cm} onChange={(e) => setF({ ...f, icd9cm: e.target.value })} className="font-mono" />
        </Field>

        <label className="flex items-start gap-2 rounded-md border border-line bg-surface-alt px-3 py-2.5 sm:col-span-2">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--color-brand-600)]"
            checked={f.is_konsultasi}
            onChange={(e) => setF({ ...f, is_konsultasi: e.target.checked })}
          />
          <span className="text-meta">
            <span className="text-ink">Tindakan konsultasi</span>
            <span className="block text-micro text-ink-faint">
              Ter-select otomatis di form dokter sesuai poli, dan satu-satunya
              tindakan yang boleh didiskon. Boleh ditandai lebih dari satu —
              mis. konsultasi umum dan konsultasi gigi.
            </span>
          </span>
        </label>
      </div>
    </ModalCrud>
  );
}

// --- Panel lab --------------------------------------------------------

export function FormPanel({
  awal,
}: {
  awal?: { id: number; kode: string; nama: string; kategori: string | null; tarif: string };
}) {
  const router = useRouter();
  const [f, setF] = useState({
    kode: awal?.kode ?? "",
    nama: awal?.nama ?? "",
    kategori: awal?.kategori ?? "",
    tarif: awal?.tarif ?? "0",
  });

  return (
    <ModalCrud
      judul={awal ? `Ubah ${awal.nama}` : "Tambah Panel Lab"}
      labelTambah="Tambah Panel"
      edit={Boolean(awal)}
      onSimpan={async () => {
        const h = await simpanPanelAction(f, awal?.id);
        if (!h.ok) { toast.error(h.error); return false; }
        toast.success("Panel tersimpan.");
        router.refresh();
        return true;
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kode" required>
          <Input value={f.kode} onChange={(e) => setF({ ...f, kode: e.target.value.toUpperCase() })} className="font-mono" />
        </Field>
        <Field label="Kategori">
          <Input value={f.kategori} onChange={(e) => setF({ ...f, kategori: e.target.value })} placeholder="Hematologi" />
        </Field>
        <Field label="Nama Panel" required className="sm:col-span-2">
          <Input value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} />
        </Field>
        <Field label="Tarif (Rp)" required className="sm:col-span-2">
          <Input type="number" min={0} step={5000} value={f.tarif} onChange={(e) => setF({ ...f, tarif: e.target.value })} />
        </Field>
      </div>
    </ModalCrud>
  );
}

// --- Parameter lab ----------------------------------------------------

export function FormParameter({
  panelId,
  panelNama,
  awal,
}: {
  panelId: number;
  panelNama: string;
  awal?: {
    id: number; kode: string; nama: string; satuan: string | null;
    tipe_nilai: string; pilihan: string[] | null;
    ref_low: string | null; ref_high: string | null; ref_teks: string | null;
    kritis_low: string | null; kritis_high: string | null; urutan: number;
  };
}) {
  const router = useRouter();
  const [f, setF] = useState({
    panel_id: String(panelId),
    kode: awal?.kode ?? "",
    nama: awal?.nama ?? "",
    satuan: awal?.satuan ?? "",
    tipe_nilai: awal?.tipe_nilai ?? "numerik",
    pilihan: awal?.pilihan?.join(", ") ?? "",
    ref_low: awal?.ref_low ?? "",
    ref_high: awal?.ref_high ?? "",
    ref_teks: awal?.ref_teks ?? "",
    kritis_low: awal?.kritis_low ?? "",
    kritis_high: awal?.kritis_high ?? "",
    urutan: String(awal?.urutan ?? 0),
  });

  const numerik = f.tipe_nilai === "numerik";

  return (
    <ModalCrud
      judul={awal ? `Ubah ${awal.nama}` : `Tambah Parameter — ${panelNama}`}
      labelTambah="Tambah Parameter"
      edit={Boolean(awal)}
      size="md"
      deskripsi="Ambang kritis harus berada DI LUAR rentang rujukan — kalau tidak, nilai normal bisa ikut tertandai kritis."
      onSimpan={async () => {
        const h = await simpanParameterAction(f, awal?.id);
        if (!h.ok) { toast.error(h.error, { duration: 6000 }); return false; }
        toast.success("Parameter tersimpan.");
        router.refresh();
        return true;
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Kode" required>
          <Input value={f.kode} onChange={(e) => setF({ ...f, kode: e.target.value.toUpperCase() })} className="font-mono" />
        </Field>
        <Field label="Nama Parameter" required className="sm:col-span-2">
          <Input value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} />
        </Field>

        <Field label="Tipe Nilai" required>
          <Select value={f.tipe_nilai} onChange={(e) => setF({ ...f, tipe_nilai: e.target.value })}>
            <option value="numerik">Numerik</option>
            <option value="teks">Teks bebas</option>
            <option value="pilihan">Pilihan</option>
          </Select>
        </Field>
        <Field label="Satuan">
          <Input value={f.satuan} onChange={(e) => setF({ ...f, satuan: e.target.value })} placeholder="g/dL" />
        </Field>
        <Field label="Urutan Tampil">
          <Input type="number" min={0} value={f.urutan} onChange={(e) => setF({ ...f, urutan: e.target.value })} />
        </Field>

        {f.tipe_nilai === "pilihan" ? (
          <Field label="Pilihan" hint="Pisahkan dengan koma" className="sm:col-span-3">
            <Input value={f.pilihan} onChange={(e) => setF({ ...f, pilihan: e.target.value })} placeholder="Negatif, +1, +2, +3" />
          </Field>
        ) : null}

        <Field label="Nilai Rujukan (teks)" hint="Yang dicetak di lembar hasil" className="sm:col-span-3">
          <Input value={f.ref_teks} onChange={(e) => setF({ ...f, ref_teks: e.target.value })} placeholder="13,0 - 17,0" />
        </Field>

        {numerik ? (
          <>
            <Field label="Rujukan Bawah">
              <Input type="number" step="any" value={f.ref_low} onChange={(e) => setF({ ...f, ref_low: e.target.value })} />
            </Field>
            <Field label="Rujukan Atas" className="sm:col-span-2">
              <Input type="number" step="any" value={f.ref_high} onChange={(e) => setF({ ...f, ref_high: e.target.value })} />
            </Field>
            <Field label="Kritis Bawah" hint="Di bawah ini = KRITIS ↓">
              <Input type="number" step="any" value={f.kritis_low} onChange={(e) => setF({ ...f, kritis_low: e.target.value })} />
            </Field>
            <Field label="Kritis Atas" hint="Di atas ini = KRITIS ↑" className="sm:col-span-2">
              <Input type="number" step="any" value={f.kritis_high} onChange={(e) => setF({ ...f, kritis_high: e.target.value })} />
            </Field>
          </>
        ) : null}
      </div>
    </ModalCrud>
  );
}

// --- ICD-10 -----------------------------------------------------------

export function FormIcd10() {
  const router = useRouter();
  const [f, setF] = useState({ code: "", nama_id: "", nama_en: "", bab: "" });

  return (
    <ModalCrud
      judul="Tambah Kode ICD-10"
      labelTambah="Tambah Kode"
      onSimpan={async () => {
        const h = await simpanIcd10Action(f);
        if (!h.ok) { toast.error(h.error); return false; }
        toast.success("Kode tersimpan.");
        router.refresh();
        return true;
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kode" required hint="mis. J06.9">
          <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} className="font-mono" />
        </Field>
        <Field label="Bab">
          <Input value={f.bab} onChange={(e) => setF({ ...f, bab: e.target.value })} />
        </Field>
        <Field label="Nama (Indonesia)" required className="sm:col-span-2">
          <Input value={f.nama_id} onChange={(e) => setF({ ...f, nama_id: e.target.value })} />
        </Field>
        <Field label="Nama (Inggris)" className="sm:col-span-2">
          <Input value={f.nama_en} onChange={(e) => setF({ ...f, nama_en: e.target.value })} />
        </Field>
      </div>
    </ModalCrud>
  );
}

export function ImporIcd10() {
  const router = useRouter();
  const [f, setF] = useState({ isi: "", pemisah: "," });
  const [hasil, setHasil] = useState<{ masuk: number; diperbarui: number; dilewati: number } | null>(null);

  return (
    <ModalCrud
      judul="Impor Massal ICD-10"
      labelTambah="Impor Massal"
      size="md"
      deskripsi="Tempelkan isi berkas CSV/TSV. Kolom: kode, nama Indonesia, nama Inggris, bab."
      onSimpan={async () => {
        const h = await imporIcd10Action(f);
        if (!h.ok) { toast.error(h.error, { duration: 6000 }); return false; }
        setHasil(h.data);
        toast.success(
          `${h.data.masuk} kode baru, ${h.data.diperbarui} diperbarui, ${h.data.dilewati} dilewati.`,
          { duration: 8000 },
        );
        router.refresh();
        return false; // biarkan modal terbuka agar ringkasannya terbaca
      }}
    >
      <div className="flex flex-col gap-3">
        <Field label="Pemisah Kolom" required>
          <Select value={f.pemisah} onChange={(e) => setF({ ...f, pemisah: e.target.value })}>
            <option value=",">Koma (CSV)</option>
            <option value="&#9;">Tab (TSV)</option>
            <option value=";">Titik koma</option>
          </Select>
        </Field>
        <Field label="Isi Berkas" required hint="Satu kode per baris">
          <Textarea
            rows={10}
            value={f.isi}
            onChange={(e) => setF({ ...f, isi: e.target.value })}
            className="font-mono text-meta"
            placeholder={"A00.0,Kolera akibat Vibrio cholerae,Cholera due to Vibrio cholerae,Penyakit Infeksi\nA01.0,Demam tifoid,Typhoid fever,Penyakit Infeksi"}
          />
        </Field>

        {hasil ? (
          <div className="rounded-md border border-line bg-surface-alt px-3 py-2.5 text-meta">
            <p className="text-ink">
              <strong className="text-success">{hasil.masuk}</strong> kode baru ·{" "}
              <strong className="text-info">{hasil.diperbarui}</strong> diperbarui ·{" "}
              <strong className={hasil.dilewati > 0 ? "text-warning" : "text-ink-faint"}>
                {hasil.dilewati}
              </strong>{" "}
              dilewati
            </p>
            {hasil.dilewati > 0 ? (
              <p className="mt-1 text-ink-muted">
                Baris dilewati karena kode kosong atau formatnya tidak sesuai pola
                ICD-10. Impor tidak dibatalkan — baris lain tetap masuk.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </ModalCrud>
  );
}

// --- Pengaturan -------------------------------------------------------

export function EditSetting({
  id,
  skey,
  nilai,
  tipe,
}: {
  id: number;
  skey: string;
  nilai: string;
  tipe: string;
}) {
  const router = useRouter();
  const [v, setV] = useState(nilai);
  const [proses, setProses] = useState(false);
  const berubah = v !== nilai;

  async function simpan() {
    setProses(true);
    try {
      const h = await simpanSettingAction(id, v);
      if (!h.ok) { toast.error(h.error); return; }
      toast.success(`${skey} diperbarui.`);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {tipe === "boolean" ? (
        <Select value={v} onChange={(e) => setV(e.target.value)} className="h-8 w-28 text-meta">
          <option value="true">true</option>
          <option value="false">false</option>
        </Select>
      ) : (
        <Input
          type={tipe === "number" ? "number" : "text"}
          value={v}
          onChange={(e) => setV(e.target.value)}
          className="h-8 w-44 text-meta"
        />
      )}
      <Button size="sm" variant={berubah ? "primary" : "secondary"} onClick={simpan} disabled={proses || !berubah}>
        Simpan
      </Button>
    </div>
  );
}

// --- Impor massal katalog & tindakan ----------------------------------

const CONTOH: Record<"item" | "tindakan", { kolom: string; contoh: string }> = {
  item: {
    kolom:
      "kode, tipe, nama, satuan, HPP, harga jual, stok min, bentuk sediaan, " +
      "boleh diracik (1/0), butuh resep (1/0), kategori (opsional — dibuat otomatis)",
    contoh:
      "OBT-100,obat,Amoksisilin 500 mg,tablet,900,2000,50,Kaplet,1,1,Antibiotik\n" +
      "BMP-100,bmhp,Kasa Steril 10x10,pcs,2500,5000,30,,0,0,Perawatan Luka",
  },
  tindakan: {
    kolom: "kode, nama, kategori, tarif, ICD-9-CM",
    contoh:
      "TND-100,Jahit Luka 1-5 jahitan,Tindakan,150000,86.59\n" +
      "TND-101,Nebulisasi,Tindakan,75000,93.94",
  },
};

/**
 * Impor massal untuk katalog dan tindakan.
 *
 * Baris rusak dilewati dan dilaporkan lengkap dengan nomor baris serta
 * alasannya — pada berkas ribuan baris, "12 dilewati" tanpa keterangan
 * memaksa operator mencari sendiri di mana salahnya.
 */
export function ImporMassal({ jenis }: { jenis: "item" | "tindakan" }) {
  const router = useRouter();
  const [f, setF] = useState({ isi: "", pemisah: ",", lewati_header: true });
  const [hasil, setHasil] = useState<{
    masuk: number; diperbarui: number; dilewati: number;
    galat: { baris: number; isi: string; alasan: string }[];
  } | null>(null);

  const info = CONTOH[jenis];

  return (
    <ModalCrud
      judul={jenis === "item" ? "Impor Massal Katalog" : "Impor Massal Tindakan"}
      labelTambah="Impor Massal"
      size="lg"
      deskripsi={`Tempelkan isi berkas CSV/TSV. Kolom: ${info.kolom}.`}
      onSimpan={async () => {
        const h =
          jenis === "item"
            ? await imporItemAction(f)
            : await imporTindakanAction(f);
        if (!h.ok) { toast.error(h.error, { duration: 6000 }); return false; }
        setHasil(h.data);
        toast.success(
          `${h.data.masuk} baru, ${h.data.diperbarui} diperbarui, ${h.data.dilewati} dilewati.`,
          { duration: 8000 },
        );
        router.refresh();
        return false; // biarkan terbuka agar ringkasannya terbaca
      }}
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Pemisah Kolom" required>
            <Select value={f.pemisah} onChange={(e) => setF({ ...f, pemisah: e.target.value })}>
              <option value=",">Koma (CSV)</option>
              <option value="&#9;">Tab (TSV)</option>
              <option value=";">Titik koma</option>
            </Select>
          </Field>
          <label className="flex items-end gap-2 pb-2">
            <input
              type="checkbox"
              checked={f.lewati_header}
              onChange={(e) => setF({ ...f, lewati_header: e.target.checked })}
              className="size-4 accent-[var(--color-brand-600)]"
            />
            <span className="text-meta text-ink">Baris pertama adalah judul kolom</span>
          </label>
        </div>

        <Field label="Isi Berkas" required hint="Satu baris per data">
          <Textarea
            rows={10}
            value={f.isi}
            onChange={(e) => setF({ ...f, isi: e.target.value })}
            className="font-mono text-meta"
            placeholder={info.contoh}
          />
        </Field>

        {hasil ? (
          <div className="rounded-md border border-line bg-surface-alt px-3 py-2.5 text-meta">
            <p className="text-ink">
              <strong className="text-success">{hasil.masuk}</strong> baru ·{" "}
              <strong className="text-info">{hasil.diperbarui}</strong> diperbarui ·{" "}
              <strong className={hasil.dilewati > 0 ? "text-warning" : "text-ink-faint"}>
                {hasil.dilewati}
              </strong>{" "}
              dilewati
            </p>

            {hasil.galat.length > 0 ? (
              <div className="mt-2 max-h-48 overflow-y-auto rounded-sm border border-line bg-surface">
                <table className="w-full border-collapse text-micro">
                  <tbody>
                    {hasil.galat.map((g) => (
                      <tr key={g.baris} className="border-b border-line last:border-b-0">
                        <td className="px-2 py-1 tabular text-ink-faint">#{g.baris}</td>
                        <td className="px-2 py-1 font-mono text-ink-muted">{g.isi}</td>
                        <td className="px-2 py-1 text-danger">{g.alasan}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {hasil.dilewati > hasil.galat.length ? (
              <p className="mt-1.5 text-ink-muted">
                Hanya {hasil.galat.length} galat pertama yang ditampilkan.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </ModalCrud>
  );
}
