"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  CheckCheck, CircleDot, ClipboardList, Save, ScrollText, Stethoscope,
  Trash2, User,
} from "lucide-react";
import { AlergiPanel } from "@/components/ui/alergi-panel";
import { Autocomplete } from "@/components/ui/autocomplete";
import { BodyDiagram } from "@/components/ui/body-diagram";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { formatRupiah } from "@/lib/format";
import {
  JENIS_ANAMNESIS, KEADAAN_GIZI, KEADAAN_UMUM,
  LABEL_ANAMNESIS, LABEL_TIPE_DIAGNOSA, REGIO_PEMERIKSAAN, TIPE_DIAGNOSA,
  type RegioPemeriksaan, type StatusLokalis, type TipeDiagnosa, type TitikLokalis,
} from "@/lib/validations/doctor";
import type { AlergiRow } from "@/lib/nurse";
import {
  cariIcd10Action, cariTindakanAction, simpanAsesmenAction, tambahAlergiDokterAction,
} from "../actions";
import { useResepDraf } from "./resep-draf";

export type Diagnosa = {
  icd10_code: string;
  nama: string;
  tipe: TipeDiagnosa;
};

export type Tindakan = {
  procedure_id: number;
  nama: string;
  qty: number;
  tarif: number;
  /** Potongan nominal — hanya berlaku pada tindakan konsultasi. */
  diskon: number;
  alasan_diskon: string;
  is_konsultasi: boolean;
};

/**
 * Rel navigasi bagian pemeriksaan.
 *
 * BUKAN tab. Percobaan sebelumnya memakai tab dan itu keliru: SOAP dikerjakan
 * BERURUTAN, sementara tab dirancang untuk bagian yang diloncati sesuka hati.
 * Tab mengubah pekerjaan linier jadi tujuh klik, menyembunyikan penyebab galat
 * di balik tab lain, dan tujuh label-nya meluber di layar 1366px — persis
 * membuat bagian yang seharusnya terlihat justru tersembunyi.
 *
 * Yang dipakai sekarang: seluruh bagian ter-render dalam satu kolom yang
 * digulir seperti biasa, dengan rel di sampingnya yang menampilkan keadaan
 * SEMUA bagian sekaligus dan bisa diklik untuk melompat.
 */
const BAGIAN = [
  { id: "s", label: "S · Anamnesis", grup: "soap" },
  { id: "o", label: "O · Pemeriksaan", grup: "soap" },
  { id: "a", label: "A · Diagnosa", grup: "soap" },
  { id: "p", label: "P · Tatalaksana", grup: "soap" },
  { id: "lab", label: "Laboratorium", grup: "penunjang" },
  { id: "resep", label: "E-Resep", grup: "penunjang" },
  { id: "berkas", label: "Berkas & Surat", grup: "penunjang" },
] as const;

type Bagian = (typeof BAGIAN)[number]["id"];

/**
 * Keadaan satu bagian.
 *
 * `kosong` sengaja NETRAL, bukan peringatan. Setiap pasien baru dimulai dengan
 * seluruh bagian kosong; mewarnainya oranye sejak awal membuat oranye berhenti
 * berarti apa-apa saat benar-benar ada yang salah.
 */
type Keadaan = "kosong" | "terisi" | "perhatian";

const WARNA_TITIK: Record<Keadaan, string> = {
  kosong: "bg-line-strong",
  terisi: "bg-brand-600",
  perhatian: "bg-warning",
};

export type SoapAwal = {
  jenis_anamnesis: string;
  sumber_anamnesis: string;
  keluhan_utama: string;
  riwayat_penyakit: string;
  riwayat_pengobatan: string;
  keadaan_umum: string;
  keadaan_gizi: string;
  assessment: string;
  terapi: string;
  plan: string;
  edukasi: string;
};

/** Catatan perawat — dipakai sebagai sumber tombol "salin". */
export type DariPerawat = {
  nama: string | null;
  keluhan_utama: string | null;
  riwayat_singkat: string | null;
  riwayat_pengobatan: string | null;
  keadaan_umum: string | null;
  keadaan_gizi: string | null;
  alergi: string | null;
};

export function AsesmenForm({
  visitId,
  awal,
  lokalisAwal,
  perawat,
  alergiAwal,
  diagnosaAwal,
  tindakanAwal,
  konsultasi,
  terkunci,
  slotPerawat,
  slotLab,
  slotResep,
  slotBerkas,
  ringkas,
}: {
  visitId: number;
  awal: SoapAwal;
  lokalisAwal: StatusLokalis;
  perawat: DariPerawat;
  /** Alergi pasien dari `patient_allergies` — sama dengan yang dilihat perawat. */
  alergiAwal: AlergiRow[];
  diagnosaAwal: Diagnosa[];
  tindakanAwal: Tindakan[];
  konsultasi: Tindakan | null;
  terkunci: boolean;
  /** Ringkasan pengkajian perawat — tampil di tab O sebagai rujukan. */
  slotPerawat?: React.ReactNode;
  slotLab?: React.ReactNode;
  slotResep?: React.ReactNode;
  slotBerkas?: React.ReactNode;
  /** Angka untuk lencana tab — supaya isi tiap bagian terbaca tanpa dibuka. */
  ringkas: {
    labOrder: number;
    labKritis: boolean;
    resepItem: number;
    dokumen: number;
    surat: number;
  };
}) {
  const router = useRouter();
  const [soap, setSoap] = useState(awal);
  const [lokalis, setLokalis] = useState<StatusLokalis>(lokalisAwal);
  const [diagnoses, setDiagnoses] = useState<Diagnosa[]>(diagnosaAwal);

  /*
   * Konsultasi ter-select otomatis HANYA pada asesmen yang benar-benar baru.
   * Kalau ikut dipasang pada asesmen tersimpan, konsultasi yang sengaja
   * dihapus dokter akan muncul lagi setiap kali layar dibuka — dan tertagih
   * kembali diam-diam.
   */
  const proceduresAwal =
    tindakanAwal.length === 0 && konsultasi && !terkunci ? [konsultasi] : tindakanAwal;
  const [procedures, setProcedures] = useState<Tindakan[]>(proceduresAwal);

  /*
   * Penanda "belum disimpan".
   *
   * Isi form ini bisa mewakili dua puluh menit pemeriksaan, dan sampai
   * sekarang satu tab yang tertutup tanpa sengaja membuangnya tanpa sepatah
   * kata pun.
   *
   * Cara mengukurnya sengaja kasar — membandingkan cuplikan JSON dengan
   * keadaan terakhir yang tersimpan. Perbandingan medan-per-medan akan
   * lebih hemat, tetapi juga jadi tempat baru untuk lupa: setiap medan baru
   * yang ditambahkan kelak harus diingat untuk didaftarkan di sini, dan
   * yang terlupa akan hilang diam-diam. Cuplikan menangkap semuanya.
   *
   * Cuplikan awal memakai `proceduresAwal`, BUKAN `tindakanAwal`: konsultasi
   * yang terpasang otomatis bukan perubahan yang dokter buat, jadi asesmen
   * yang baru dibuka tidak boleh langsung dianggap kotor.
   */
  const cuplikan = (
    a: SoapAwal, b: StatusLokalis, c: Diagnosa[], d: Tindakan[],
  ) => JSON.stringify({ a, b, c, d });

  const [bersih, setBersih] = useState(() =>
    cuplikan(awal, lokalisAwal, diagnosaAwal, proceduresAwal),
  );
  const kotor =
    !terkunci && cuplikan(soap, lokalis, diagnoses, procedures) !== bersih;
  const [error, setError] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);
  /** Bagian yang jadi penyebab galat — disorot di rel lalu digulir ke sana. */
  const [sorot, setSorot] = useState<Bagian | null>(null);
  /** Bagian yang sedang terlihat di layar, untuk penanda posisi di rel. */
  const [aktif, setAktif] = useState<Bagian>("s");

  const nonaktif = terkunci || menyimpan;

  /*
   * Menutup tab atau memuat ulang halaman dengan isian yang belum tersimpan
   * memicu konfirmasi bawaan peramban.
   *
   * BATASNYA PERLU DIKATAKAN TERUS TERANG: ini hanya menjaga tab, bukan
   * perpindahan di dalam aplikasi. App Router tidak menyediakan kait untuk
   * membatalkan navigasi, sehingga menekan "Kembali ke antrean" tetap
   * membuang isian tanpa bertanya. Itulah sebabnya penanda di bilah tombol
   * bawah bukan hiasan — ia satu-satunya peringatan untuk kasus tersebut.
   */
  useEffect(() => {
    if (!kotor) return;
    function jaga(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", jaga);
    return () => window.removeEventListener("beforeunload", jaga);
  }, [kotor]);

  /*
   * Menggulir ke bagian, bukan memindahkan tab. Inilah yang dulu hilang:
   * finalisasi gagal karena diagnosa kosong, tetapi penyebabnya berada di
   * balik tab lain dan dokter membaca pesan galat sambil menatap anamnesis.
   */
  const lompatKe = (id: Bagian) => {
    setSorot(id);
    document.getElementById(`bagian-${id}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  /*
   * Penanda posisi di rel. Pada satu kolom yang panjang, rel tanpa penanda
   * hanyalah daftar lompatan — dokter tetap kehilangan orientasi tentang
   * sudah sampai mana ia mengisi. `rootMargin` atas dikurangi setinggi header
   * yang menempel supaya bagian di baliknya tidak dihitung sedang terlihat.
   */
  useEffect(() => {
    const el = BAGIAN.map((b) => document.getElementById(`bagian-${b.id}`))
      .filter((e): e is HTMLElement => e !== null);
    if (el.length === 0) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const teratas = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (teratas) {
          setAktif(teratas.target.id.replace("bagian-", "") as Bagian);
        }
      },
      { rootMargin: "-150px 0px -55% 0px" },
    );
    el.forEach((e) => obs.observe(e));
    return () => obs.disconnect();
  }, []);
  const set = (k: keyof SoapAwal, v: string) => setSoap((s) => ({ ...s, [k]: v }));

  const totalTindakan = procedures.reduce(
    (n, t) => n + Math.max(t.qty * t.tarif - t.diskon, 0),
    0,
  );
  const totalDiskon = procedures.reduce((n, t) => n + t.diskon, 0);

  const ditegakkan = diagnoses.filter((d) => d.tipe !== "banding");
  const jumlahPrimer = diagnoses.filter((d) => d.tipe === "primer").length;
  const jumlahBanding = diagnoses.filter((d) => d.tipe === "banding").length;

  const jumlahRegio = Object.values(lokalis.regio).filter(
    (r) => r.dbn || r.temuan.length > 0,
  ).length;

  const ubahRegio = (kunci: string, patch: Partial<RegioPemeriksaan>) =>
    setLokalis((l) => ({
      ...l,
      regio: {
        ...l.regio,
        [kunci]: { ...(l.regio[kunci] ?? { dbn: false, temuan: "" }), ...patch },
      },
    }));

  /*
   * Pemeriksaan fisik lengkap sebagian besar normal, dan mengetik "DBN" tiga
   * belas kali membuat dokter berhenti mengisinya sama sekali. Tombol ini
   * TIDAK menimpa regio yang sudah punya temuan — yang sudah ditulis dokter
   * lebih berharga daripada penandaan massal.
   */
  const tandaiSemuaDbn = () =>
    setLokalis((l) => {
      const regio = { ...l.regio };
      for (const r of REGIO_PEMERIKSAAN) {
        const ada = regio[r.kunci];
        if (ada?.temuan) continue;
        regio[r.kunci] = { dbn: true, temuan: ada?.temuan ?? "" };
      }
      return { ...l, regio };
    });

  const kosongkanRegio = () => setLokalis((l) => ({ ...l, regio: {} }));

  async function simpan(finalkan: boolean) {
    setError(null);
    if (finalkan && useResepDraf.getState().belumDisimpan) {
      const pesan =
        "Ada perubahan e-resep yang belum disimpan. Tekan “Simpan Resep” dulu — " +
        "finalisasi hanya mengirim resep yang sudah tersimpan ke apotek.";
      setError(pesan);
      toast.error(pesan, { duration: 7000 });
      return;
    }
    setMenyimpan(true);
    try {
      const hasil = await simpanAsesmenAction(visitId, {
        ...soap,
        status_lokalis: lokalis,
        finalkan,
        diagnoses,
        procedures,
      });

      if (!hasil.ok) {
        setError(hasil.error);
        toast.error(hasil.error, { duration: 6000 });
        /*
         * Galat diagnosa hampir selalu jadi penyebab finalisasi gagal, dan
         * bagiannya bisa jauh dari pandangan. Pesan galat saja tidak cukup —
         * dokter perlu dibawa ke tempat yang harus diperbaiki.
         */
        if (hasil.field === "diagnoses" || /diagnosa/i.test(hasil.error)) {
          lompatKe("a");
        } else if (/sumber|anamnesis/i.test(hasil.error)) {
          lompatKe("s");
        }
        return;
      }
      setSorot(null);
      setBersih(cuplikan(soap, lokalis, diagnoses, procedures));

      toast.success(
        finalkan
          ? "Asesmen difinalkan — tindak lanjut ada di panel atas."
          : "Draft asesmen tersimpan.",
      );
      /*
       * Finalisasi TIDAK memindahkan halaman.
       *
       * Dulu ia langsung `router.push("/rme")`, dan itu membuang dokter dari
       * layar tepat pada saat dua pekerjaan terakhir kunjungan baru bisa
       * dikerjakan: mencetak rekam medis dan menerbitkan surat keterangan.
       * Keduanya hanya masuk akal SETELAH asesmen final — dan keduanya jadi
       * mengharuskan dokter membuka ulang kunjungan yang baru saja ia tutup.
       *
       * Yang terjadi sekarang: halaman disegarkan, status kunjungan berubah
       * sehingga form mengunci dirinya sendiri, dan panel penutup muncul di
       * atas membawa cetak, surat, dan jalan ke pasien berikutnya.
       */
      router.refresh();
      if (finalkan) window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setMenyimpan(false);
    }
  }

  /*
   * Sengaja FUNGSI biasa yang mengembalikan elemen, bukan komponen. Komponen
   * yang didefinisikan di dalam render dianggap tipe baru pada setiap render,
   * sehingga state-nya ter-reset — dan React Compiler menolaknya.
   */
  const tombolSalin = (dari: string | null, ke: keyof SoapAwal) => {
    if (terkunci || !dari || soap[ke].trim() === dari.trim()) return null;
    return (
      <button
        type="button"
        onClick={() => set(ke, dari)}
        className="text-micro text-brand-700 underline underline-offset-2 hover:text-brand-800"
      >
        salin dari perawat
      </button>
    );
  };

  const tombolSalinPilihan = (dari: string | null, ke: keyof SoapAwal) => {
    if (terkunci || !dari || soap[ke] === dari) return null;
    return (
      <button
        type="button"
        onClick={() => set(ke, dari)}
        className="text-micro text-brand-700 underline underline-offset-2 hover:text-brand-800"
      >
        perawat menilai &ldquo;{dari}&rdquo; — salin
      </button>
    );
  };

  /*
   * Keadaan setiap bagian. SATU bahasa untuk semuanya: titik warna = keadaan,
   * angka = jumlah. Versi tab sebelumnya memakai tujuh format berbeda
   * ("terisi", "7/16", "1 utama · 3", "Rp 75.000", "kritis", "4 item", "2")
   * yang harus diurai satu per satu.
   */
  const keadaan: Record<Bagian, { status: Keadaan; angka?: string }> = {
    s: soap.keluhan_utama.trim() ? { status: "terisi" } : { status: "kosong" },
    o: jumlahRegio > 0
      ? { status: "terisi", angka: `${jumlahRegio}/${REGIO_PEMERIKSAAN.length}` }
      : { status: "kosong" },
    a:
      diagnoses.length === 0
        ? { status: "kosong" }
        : {
            status: jumlahPrimer === 1 ? "terisi" : "perhatian",
            angka: String(diagnoses.length),
          },
    p:
      procedures.length > 0
        ? { status: "terisi", angka: formatRupiah(totalTindakan) }
        : { status: "kosong" },
    lab:
      ringkas.labOrder > 0
        ? {
            status: ringkas.labKritis ? "perhatian" : "terisi",
            angka: String(ringkas.labOrder),
          }
        : { status: "kosong" },
    resep:
      ringkas.resepItem > 0
        ? { status: "terisi", angka: String(ringkas.resepItem) }
        : { status: "kosong" },
    berkas:
      ringkas.dokumen + ringkas.surat > 0
        ? { status: "terisi", angka: String(ringkas.dokumen + ringkas.surat) }
        : { status: "kosong" },
  };

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start lg:gap-4">
      {/*
        Rel navigasi. Di layar lebar ia menempel di samping; di layar sempit
        ia turun jadi strip mendatar di atas isi. Menempel pada `top-36`,
        bukan `top-0` — header pasien sudah menempati bagian itu.
      */}
      <nav
        aria-label="Bagian pemeriksaan"
        className="order-first flex gap-1 overflow-x-auto rounded-md border border-line bg-surface p-1 lg:order-none lg:col-start-2 lg:row-start-1 lg:sticky lg:top-36 lg:flex-col lg:overflow-visible"
      >
        {BAGIAN.map((b, i) => {
          const k = keadaan[b.id];
          const diSini = aktif === b.id;
          const bermasalah = sorot === b.id;
          // Pemisah antara tulang punggung SOAP dan bagian penunjang —
          // menegaskan mana alur utama dan mana yang menyertainya.
          const awalPenunjang = i > 0 && b.grup !== BAGIAN[i - 1].grup;

          return (
            <div key={b.id} className="contents lg:block">
              {awalPenunjang ? (
                <div className="my-1 hidden border-t border-line lg:block" aria-hidden />
              ) : null}
              <button
                type="button"
                aria-current={diSini ? "true" : undefined}
                onClick={() => lompatKe(b.id)}
                className={`flex w-full shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-meta transition-colors ${
                  bermasalah
                    ? "bg-warning-bg text-ink"
                    : diSini
                      ? "bg-brand-50 font-medium text-brand-700"
                      : "text-ink-muted hover:bg-surface-alt hover:text-ink"
                }`}
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${WARNA_TITIK[k.status]}`}
                  aria-hidden
                />
                <span className="whitespace-nowrap lg:min-w-0 lg:flex-1 lg:truncate">
                  {b.label}
                </span>
                {k.angka ? (
                  <span className="shrink-0 text-micro text-ink-faint tabular">
                    {k.angka}
                  </span>
                ) : null}
                {/* Keadaan ditulis juga — titik warna tidak terbaca pembaca layar. */}
                <span className="sr-only">
                  {k.status === "perhatian"
                    ? "perlu diperiksa"
                    : k.status === "terisi"
                      ? "sudah diisi"
                      : "belum diisi"}
                </span>
              </button>
            </div>
          );
        })}
      </nav>

      <div className="flex flex-col gap-4 lg:col-start-1 lg:row-start-1">
      {/* ================= S — SUBJECTIVE ================= */}
      <div id="bagian-s" className="scroll-mt-36">
      <Card>
        <CardHeader>
          <CardTitle icon={User}>S — Subjective (Anamnesis)</CardTitle>
          {perawat.nama ? (
            <span className="text-meta text-ink-faint">dikaji {perawat.nama}</span>
          ) : null}
        </CardHeader>

        <p className="mb-2.5 text-meta text-ink-muted">
          Kolom di bawah terisi dari pengkajian perawat dan bebas Anda sunting.
          Suntingan Anda <strong>tidak</strong> mengubah catatan perawat — keduanya
          tersimpan terpisah sebagai pernyataan dua pemeriksa.
        </p>

        <div className="grid gap-3 lg:grid-cols-2">
          <Field label="Jenis Anamnesis">
            <Select
              disabled={nonaktif}
              value={soap.jenis_anamnesis}
              onChange={(e) => set("jenis_anamnesis", e.target.value)}
            >
              <option value="">— belum ditentukan</option>
              {JENIS_ANAMNESIS.map((j) => (
                <option key={j} value={j}>{LABEL_ANAMNESIS[j]}</option>
              ))}
            </Select>
          </Field>

          <Field
            label="Keluhan Utama"
            hint={tombolSalin(perawat.keluhan_utama, "keluhan_utama")}
          >
            <Input
              disabled={nonaktif}
              value={soap.keluhan_utama}
              maxLength={2000}
              onChange={(e) => set("keluhan_utama", e.target.value)}
              placeholder="Keluhan yang membawa pasien datang hari ini"
            />
          </Field>

          {soap.jenis_anamnesis === "allo" ? (
            <Field
              label="Sumber Keterangan"
              required
              className="lg:col-span-2"
              hint="Bobot klinis keterangan berbeda menurut siapa yang memberikannya"
            >
              <Input
                disabled={nonaktif}
                value={soap.sumber_anamnesis}
                maxLength={120}
                placeholder="mis. Ibu kandung, suami, pengantar"
                onChange={(e) => set("sumber_anamnesis", e.target.value)}
              />
            </Field>
          ) : null}

          <Field
            label="Riwayat Penyakit"
            hint={tombolSalin(perawat.riwayat_singkat, "riwayat_penyakit")}
          >
            <Textarea
              rows={3}
              disabled={nonaktif}
              value={soap.riwayat_penyakit}
              onChange={(e) => set("riwayat_penyakit", e.target.value)}
              placeholder="Riwayat penyakit sekarang & dahulu, penyakit keluarga bila relevan"
            />
          </Field>

          <Field
            label="Riwayat Pengobatan"
            hint={tombolSalin(perawat.riwayat_pengobatan, "riwayat_pengobatan")}
          >
            <Textarea
              rows={3}
              disabled={nonaktif}
              value={soap.riwayat_pengobatan}
              onChange={(e) => set("riwayat_pengobatan", e.target.value)}
              placeholder="Obat yang sedang atau baru diminum, termasuk obat bebas & jamu"
            />
          </Field>

          {/*
            Alergi memakai panel yang SAMA dengan form perawat, menulis ke
            `patient_allergies`. Bukan textarea: alergi melekat pada pasien,
            harus terbaca farmasi saat memvalidasi resep, dan terbawa ke
            kunjungan berikutnya. Teks bebas per-kunjungan tidak melakukan
            satu pun dari itu.
          */}
          <div className="lg:col-span-2">
            <AlergiPanel
              visitId={visitId}
              awal={alergiAwal}
              aksi={tambahAlergiDokterAction}
              terkunci={nonaktif}
            />
          </div>
        </div>
      </Card>
      </div>

      {/* ================= O — OBJECTIVE ================= */}
      <div id="bagian-o" className="flex flex-col gap-4 scroll-mt-36">
      {slotPerawat}
      <Card>
        <CardHeader>
          <CardTitle icon={Stethoscope}>O — Objective (Pemeriksaan Fisik)</CardTitle>
          <span className="text-meta text-ink-faint">
            TTV lengkap ada di panel Pengkajian Perawat
          </span>
        </CardHeader>

        <div className="grid gap-3 lg:grid-cols-2">
          <Field
            label="Keadaan Umum"
            hint={tombolSalinPilihan(perawat.keadaan_umum, "keadaan_umum")}
          >
            <Select
              disabled={nonaktif}
              value={soap.keadaan_umum}
              onChange={(e) => set("keadaan_umum", e.target.value)}
              className="capitalize"
            >
              <option value="">—</option>
              {KEADAAN_UMUM.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </Select>
          </Field>

          <Field
            label="Keadaan Gizi"
            hint={tombolSalinPilihan(perawat.keadaan_gizi, "keadaan_gizi")}
          >
            <Select
              disabled={nonaktif}
              value={soap.keadaan_gizi}
              onChange={(e) => set("keadaan_gizi", e.target.value)}
              className="capitalize"
            >
              <option value="">—</option>
              {KEADAAN_GIZI.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </Select>
          </Field>

        </div>

        {/*
          Status lokalis dan peta titik BERSANDINGAN di layar lebar.
          Keduanya menjawab pertanyaan yang sama — "di mana kelainannya" —
          dan menumpuknya membuat bagian O sendirian setinggi dua layar,
          memutus alur SOAP tepat di tengah. Bersanding memangkas tingginya
          hampir separuh tanpa menyembunyikan apa pun.
        */}
        <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
        <div className="rounded-md border border-line bg-surface-alt p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-label text-ink-muted">
              Status Lokalis
              <span className="ml-2 font-normal text-ink-faint">
                {jumlahRegio > 0
                  ? `${jumlahRegio} dari ${REGIO_PEMERIKSAAN.length} regio terisi`
                  : "belum ada yang diisi"}
              </span>
            </p>
            {!terkunci ? (
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={tandaiSemuaDbn} disabled={nonaktif}>
                  Tandai semua DBN
                </Button>
                {jumlahRegio > 0 ? (
                  <Button type="button" size="sm" variant="ghost" onClick={kosongkanRegio} disabled={nonaktif}>
                    Kosongkan
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          <p className="mb-2 text-meta text-ink-faint">
            Regio yang dibiarkan kosong berarti <strong>tidak diperiksa</strong> — berbeda
            dari DBN yang berarti diperiksa dan tidak ditemukan kelainan.
          </p>

          <ul className="flex flex-col gap-1">
            {REGIO_PEMERIKSAAN.map((r) => {
              const nilai = lokalis.regio[r.kunci] ?? { dbn: false, temuan: "" };
              return (
                <li key={r.kunci} className="flex flex-wrap items-center gap-2">
                  <span className="w-44 shrink-0 text-meta text-ink">{r.label}</span>
                  <label className="flex shrink-0 items-center gap-1.5 text-meta text-ink-muted">
                    <input
                      type="checkbox"
                      disabled={nonaktif}
                      checked={nilai.dbn}
                      onChange={(e) => ubahRegio(r.kunci, { dbn: e.target.checked })}
                      className="size-4 accent-[var(--color-brand-600)]"
                    />
                    DBN
                  </label>
                  <input
                    value={nilai.temuan}
                    disabled={nonaktif}
                    maxLength={255}
                    placeholder={r.contoh}
                    onChange={(e) => ubahRegio(r.kunci, { temuan: e.target.value })}
                    className="h-8 min-w-0 flex-1 basis-64 rounded-md border border-line bg-surface px-2.5 text-body text-ink disabled:bg-surface-alt"
                  />
                </li>
              );
            })}
          </ul>
        </div>

        {/* ---------- Peta titik keluhan ---------- */}
        <div className="rounded-md border border-line bg-surface-alt p-3">
          <p className="mb-2 text-label text-ink-muted">Peta Titik Keluhan</p>

          <BodyDiagram
            titik={lokalis.titik}
            terkunci={nonaktif}
            onTambah={(t: TitikLokalis) =>
              setLokalis((l) => ({ ...l, titik: [...l.titik, t] }))
            }
            onUbah={(i, keterangan) =>
              setLokalis((l) => ({
                ...l,
                titik: l.titik.map((x, j) => (j === i ? { ...x, keterangan } : x)),
              }))
            }
            onHapus={(i) =>
              setLokalis((l) => ({ ...l, titik: l.titik.filter((_, j) => j !== i) }))
            }
          />

          <div className="mt-3">
            <Field label="Catatan Peta Titik">
              <Textarea
                rows={2}
                disabled={nonaktif}
                value={lokalis.catatan ?? ""}
                onChange={(e) => setLokalis((l) => ({ ...l, catatan: e.target.value }))}
                placeholder="Deskripsi lesi, ukuran, batas, warna, nyeri tekan…"
              />
            </Field>
          </div>
        </div>
        </div>
      </Card>
      </div>

      {/* ================= A — ASSESSMENT ================= */}
      <div id="bagian-a" className="scroll-mt-36">
      <Card>
        <CardHeader>
          <CardTitle icon={ScrollText}>A — Assessment (Diagnosa)</CardTitle>
          <Badge variant={jumlahPrimer === 1 ? "success" : "warning"}>
            {jumlahPrimer} utama · {ditegakkan.length} ditegakkan
            {jumlahBanding > 0 ? ` · ${jumlahBanding} banding` : ""}
          </Badge>
        </CardHeader>

        {!terkunci ? (
          <Autocomplete
            cari={cariIcd10Action}
            placeholder="Cari kode atau nama diagnosa — J06.9, hipertensi…"
            keyOf={(d) => d.code}
            onPilih={(d) => {
              if (diagnoses.some((x) => x.icd10_code === d.code)) return;
              setDiagnoses([
                ...diagnoses,
                {
                  icd10_code: d.code,
                  nama: d.nama_id,
                  // Diagnosa pertama otomatis jadi utama — itu yang paling
                  // sering benar, dan tetap bisa diubah.
                  tipe: diagnoses.length === 0 ? "primer" : "sekunder",
                },
              ]);
            }}
            renderBaris={(d) => (
              <>
                <span className="w-16 shrink-0 font-mono text-meta text-brand-700">
                  {d.code}
                </span>
                <span className="min-w-0 flex-1 truncate text-body text-ink">
                  {d.nama_id}
                </span>
              </>
            )}
          />
        ) : null}

        {diagnoses.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-meta text-ink-faint">
            Belum ada diagnosa. Minimal satu diagnosa utama wajib diisi sebelum
            asesmen difinalkan — ini juga syarat SatuSehat.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5">
            {diagnoses.map((d, i) => (
              <li
                key={d.icd10_code}
                className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 ${
                  d.tipe === "banding"
                    ? "border-dashed border-line-strong bg-surface"
                    : "border-line bg-surface-alt"
                }`}
              >
                <span className="w-16 shrink-0 font-mono text-meta font-semibold text-brand-700">
                  {d.icd10_code}
                </span>
                <span className="min-w-0 flex-1 truncate text-body text-ink">
                  {d.nama}
                </span>
                <Select
                  disabled={nonaktif}
                  value={d.tipe}
                  aria-label={`Tipe diagnosa ${d.icd10_code}`}
                  onChange={(e) =>
                    setDiagnoses(
                      diagnoses.map((x, j) =>
                        j === i ? { ...x, tipe: e.target.value as TipeDiagnosa } : x,
                      ),
                    )
                  }
                  className="h-8 w-44 text-meta"
                >
                  {TIPE_DIAGNOSA.map((t) => (
                    <option key={t} value={t}>{LABEL_TIPE_DIAGNOSA[t]}</option>
                  ))}
                </Select>
                {!terkunci ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Hapus ${d.icd10_code}`}
                    onClick={() => setDiagnoses(diagnoses.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {jumlahBanding > 0 ? (
          <p className="mt-2 text-meta text-ink-muted">
            Diagnosa banding tidak dihitung sebagai diagnosa yang ditegakkan dan
            tidak dipakai sebagai dasar klaim.
          </p>
        ) : null}

        <div className="mt-3">
          <Field label="Catatan Penilaian" hint="Narasi di luar kode ICD-10">
            <Textarea
              rows={2}
              disabled={nonaktif}
              value={soap.assessment}
              onChange={(e) => set("assessment", e.target.value)}
            />
          </Field>
        </div>
      </Card>
      </div>

      {/* ================= P — PLAN ================= */}
      <div id="bagian-p" className="flex flex-col gap-4 scroll-mt-36">
      <Card>
        <CardHeader>
          <CardTitle icon={ClipboardList}>P — Tindakan Medis</CardTitle>
          <Badge variant="brand">{formatRupiah(totalTindakan)}</Badge>
        </CardHeader>

        {!terkunci ? (
          <Autocomplete
            cari={cariTindakanAction}
            placeholder="Cari tindakan — nebulizer, hecting, injeksi…"
            keyOf={(t) => t.id}
            onPilih={(t) => {
              if (procedures.some((x) => x.procedure_id === t.id)) return;
              setProcedures([
                ...procedures,
                {
                  procedure_id: t.id,
                  nama: t.nama,
                  qty: 1,
                  tarif: Number(t.tarif),
                  diskon: 0,
                  alasan_diskon: "",
                  is_konsultasi: Number(t.is_konsultasi) === 1,
                },
              ]);
            }}
            renderBaris={(t) => (
              <>
                <span className="min-w-0 flex-1 truncate text-body text-ink">{t.nama}</span>
                <span className="shrink-0 text-meta text-ink-muted tabular">
                  {formatRupiah(t.tarif)}
                </span>
              </>
            )}
          />
        ) : null}

        {procedures.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-line-strong px-3 py-4 text-center">
            <p className="text-meta text-ink-faint">
              Tidak ada tindakan — pasien tidak dikenai biaya konsultasi.
            </p>
            {konsultasi && !terkunci ? (
              <Button
                type="button"
                size="sm"
                className="mt-2"
                onClick={() => setProcedures([konsultasi])}
              >
                Tambahkan {konsultasi.nama}
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5">
            {procedures.map((t, i) => {
              const ubah = (patch: Partial<Tindakan>) =>
                setProcedures(procedures.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              const bruto = t.qty * t.tarif;

              return (
                <li
                  key={t.procedure_id}
                  className="rounded-md border border-line bg-surface-alt px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-body text-ink">
                      {t.nama}
                      {t.is_konsultasi ? (
                        <Badge variant="brand" className="ml-2">Konsultasi</Badge>
                      ) : null}
                    </span>
                    <Input
                      type="number"
                      min={1}
                      disabled={nonaktif}
                      value={t.qty}
                      aria-label={`Jumlah ${t.nama}`}
                      onChange={(e) => ubah({ qty: Number(e.target.value) })}
                      className="h-8 w-16 text-right"
                    />
                    <span className="w-28 text-right text-body text-ink tabular">
                      {formatRupiah(bruto - t.diskon)}
                      {t.diskon > 0 ? (
                        <span className="block text-micro font-normal text-ink-faint line-through">
                          {formatRupiah(bruto)}
                        </span>
                      ) : null}
                    </span>
                    {!terkunci ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Hapus ${t.nama}`}
                        onClick={() => setProcedures(procedures.filter((_, j) => j !== i))}
                      >
                        <Trash2 />
                      </Button>
                    ) : null}
                  </div>

                  {/*
                    Diskon HANYA untuk konsultasi. Tindakan lain tidak
                    menampilkan kolomnya sama sekali — kolom yang ada tapi
                    diabaikan server lebih membingungkan daripada yang tidak ada.
                  */}
                  {t.is_konsultasi && !terkunci ? (
                    <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-line pt-2">
                      <Field label="Diskon (Rp)" className="w-32">
                        <Input
                          type="number"
                          min={0}
                          max={bruto}
                          step={5000}
                          disabled={nonaktif}
                          value={t.diskon || ""}
                          placeholder="0"
                          onChange={(e) =>
                            ubah({
                              diskon: Math.min(Math.max(Number(e.target.value) || 0, 0), bruto),
                            })
                          }
                          className="h-8 text-right"
                        />
                      </Field>
                      <Field label="Alasan" className="min-w-48 flex-1" hint="Boleh dikosongkan">
                        <Input
                          disabled={nonaktif || t.diskon <= 0}
                          value={t.alasan_diskon}
                          maxLength={160}
                          placeholder="mis. Keringanan pasien tidak mampu"
                          onChange={(e) => ubah({ alasan_diskon: e.target.value })}
                          className="h-8"
                        />
                      </Field>
                      {t.diskon >= bruto && bruto > 0 ? (
                        <span className="pb-2 text-meta text-warning">
                          Digratiskan sepenuhnya.
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {totalDiskon > 0 ? (
          <p className="mt-2 text-right text-meta text-ink-muted">
            Potongan konsultasi{" "}
            <strong className="text-warning tabular">{formatRupiah(totalDiskon)}</strong>
          </p>
        ) : null}
      </Card>

      {/* ================= P — TATALAKSANA ================= */}
      <Card>
        <CardHeader>
          <CardTitle icon={ClipboardList}>P — Tatalaksana</CardTitle>
        </CardHeader>
        <div className="grid gap-3 lg:grid-cols-3">
          <Field label="Terapi" hint="Non-resep; obat diinput di E-Resep di bawah">
            <Textarea
              rows={3}
              disabled={nonaktif}
              value={soap.terapi}
              onChange={(e) => set("terapi", e.target.value)}
              placeholder="Kompres hangat, tirah baring, diet rendah garam…"
            />
          </Field>
          <Field label="Tindakan / Rencana Lanjutan">
            <Textarea
              rows={3}
              disabled={nonaktif}
              value={soap.plan}
              onChange={(e) => set("plan", e.target.value)}
              placeholder="Kontrol 3 hari, rujuk bila memburuk, observasi…"
            />
          </Field>
          <Field label="Edukasi Pasien">
            <Textarea
              rows={3}
              disabled={nonaktif}
              value={soap.edukasi}
              onChange={(e) => set("edukasi", e.target.value)}
              placeholder="Yang harus dilakukan & tanda bahaya yang perlu diwaspadai"
            />
          </Field>
        </div>
      </Card>
      </div>

      {/* ================= LABORATORIUM ================= */}
      <div id="bagian-lab" className="flex flex-col gap-4 scroll-mt-36">
        {slotLab}
      </div>

      {/* ================= E-RESEP ================= */}
      <div id="bagian-resep" className="flex flex-col gap-4 scroll-mt-36">
        {slotResep}
      </div>

      {/* ================= BERKAS & SURAT ================= */}
      <div id="bagian-berkas" className="flex flex-col gap-4 scroll-mt-36">
        {slotBerkas}
      </div>

      {error ? (
        <p className="rounded-md border border-danger/25 bg-danger-bg px-3 py-2.5 text-body text-danger">
          {error}
        </p>
      ) : null}

      {/* Tombol simpan menempel di bawah — terjangkau dari posisi gulir mana pun. */}
      {!terkunci ? (
        <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-1 py-2.5">
          <span className="mr-auto flex flex-wrap items-center gap-x-2 text-meta">
            {kotor ? (
              <span className="flex items-center gap-1 font-medium text-warning">
                <CircleDot className="size-3" aria-hidden />
                Ada perubahan yang belum disimpan
              </span>
            ) : null}
            <span className="text-ink-faint">
              {jumlahPrimer === 1
                ? "Siap difinalkan."
                : "Butuh tepat satu diagnosa utama sebelum difinalkan."}
            </span>
          </span>
          <Button type="button" onClick={() => simpan(false)} disabled={menyimpan}>
            <Save />
            {menyimpan ? "Menyimpan…" : "Simpan Draft"}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => simpan(true)}
            disabled={menyimpan}
          >
            <CheckCheck />
            Finalkan Asesmen
          </Button>
        </div>
      ) : (
        /*
         * Form terkunci perlu MENGATAKAN dirinya terkunci. Sebelumnya bilah
         * tombol hanya hilang, dan layar penuh kolom yang tidak bisa diketik
         * terbaca seperti sistem yang macet, bukan seperti asesmen yang sudah
         * ditutup.
         */
        <p className="rounded-md border border-line bg-surface-alt px-3 py-2.5 text-meta text-ink-muted">
          Asesmen terkunci — kunjungan sudah lewat tahap dokter. Isinya tetap
          dapat dibaca dan dicetak, tetapi tidak lagi dapat disunting.
        </p>
      )}
      </div>
    </div>
  );
}
