import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft, ArrowRight, CheckCheck, FileSignature, HeartPulse, Printer,
  TriangleAlert,
} from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, TriaseBadge } from "@/components/ui/badge";
import { requireRole } from "@/lib/auth";
import { cabangBacaDetail } from "@/lib/session";
import { queryOne } from "@/lib/db";
import {
  bacaStatusLokalis, getAsesmen, getDiagnosa, getPemeriksaan, getTindakan,
  konsultasiDefault,
} from "@/lib/doctor";
import { getResep, getResepItems, getResepRacikans } from "@/lib/prescription";
import { hasilLabKunjungan, orderLabKunjungan } from "@/lib/lab";
import { daftarSurat, kopKlinik } from "@/lib/dokumen";
import { daftarLampiran, maksUkuranDokumen } from "@/lib/lampiran-rme";
import { alergiPasien } from "@/lib/nurse";
import { formatDesimal, formatJam, hitungUmur } from "@/lib/format";
import { tanggalHariIni } from "@/lib/tanggal";
import { AsesmenForm, type Diagnosa, type Tindakan } from "./asesmen-form";
import { ResepForm, type ObatPaten } from "./resep-form";
import { LabCard, type HasilTampil, type OrderTampil } from "./lab-card";
import { DokumenCard, type DokumenTampil } from "./dokumen-card";
import { CetakRekamMedis } from "@/components/cetak/cetak-rekam-medis";
import { SuratCard } from "./surat-card";
import { ConsentCard, type ConsentTampil } from "./consent-card";
import { consentKunjungan } from "@/lib/kepatuhan";
import type { Racikan } from "./racikan-builder";

export const metadata: Metadata = { title: "Pemeriksaan" };
export const dynamic = "force-dynamic";

const BOLEH_DIPERIKSA = ["menunggu_dokter", "dalam_pemeriksaan", "menunggu_lab"];

/**
 * Ke mana pasien pergi setelah asesmen difinalkan.
 *
 * Dibaca dari status kunjungan yang sebenarnya, bukan ditebak dari ada/tidaknya
 * resep — status itulah yang menentukan layar siapa pasien ini muncul, dan
 * dokter yang ditanya pasien "saya ke mana sekarang?" perlu jawaban yang sama
 * dengan yang dilihat kasir dan farmasi.
 */
const LANJUTAN: Record<string, string> = {
  menunggu_lab:
    "Menunggu hasil laboratorium. Asesmen masih dapat disunting setelah hasilnya masuk.",
  menunggu_farmasi:
    "Pasien diteruskan ke Farmasi untuk validasi resep, lalu ke Kasir untuk membayar.",
  menunggu_kasir: "Pasien diteruskan ke Kasir.",
  menunggu_obat:
    "Tagihan sudah lunas. Pasien menunggu penyerahan obat di Farmasi.",
  selesai: "Kunjungan sudah selesai.",
  batal: "Kunjungan ini dibatalkan.",
};

/** Gaya tautan aksi pada panel penutup — menyamai `Button` ukuran `sm`. */
const TAUTAN_AKSI =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-line " +
  "bg-surface px-2.5 text-meta font-medium text-ink transition-colors " +
  "hover:border-line-strong hover:bg-surface-alt [&_svg]:size-4 [&_svg]:shrink-0";

/**
 * Satu angka TTV pada strip header. Nilai di luar rentang ditandai warna DAN
 * tebal — layar klinik sering dibaca sambil lalu, dan warna saja terlewat.
 */
function Vital({
  label,
  nilai,
  abnormal,
}: {
  label: string;
  nilai: string | number | null;
  abnormal?: boolean;
}) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-ink-faint">{label} </span>
      <span
        className={`tabular ${
          nilai === null
            ? "text-ink-faint"
            : abnormal
              ? "font-semibold text-danger"
              : "text-ink"
        }`}
      >
        {nilai ?? "—"}
      </span>
    </span>
  );
}

export default async function PemeriksaanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("dokter", "super_admin");
  const { id } = await params;
  const visitId = Number(id);
  if (!Number.isInteger(visitId) || visitId <= 0) notFound();

  const visit = await getPemeriksaan(visitId, cabangBacaDetail(session));
  if (!visit) notFound();

  const [
    asesmen, diagnoses, procedures, resep, orderLab, hasilLab, setelan,
    klinik, profilDokter, suratVisit, dokumen, konsultasi, alergi, consentRows,
  ] = await Promise.all([
    getAsesmen(visitId),
    getDiagnosa(visitId),
    getTindakan(visitId),
    getResep(visitId),
    orderLabKunjungan(visitId),
    hasilLabKunjungan(visitId),
    queryOne<import("mysql2").RowDataPacket & { svalue: string }>(
      `SELECT svalue FROM settings WHERE skey = 'racikan.jasa_racik_default'
        AND (site_id = ? OR site_id IS NULL) ORDER BY site_id IS NULL LIMIT 1`,
      [visit.site_id],
    ),
    kopKlinik(visit.site_id),
    queryOne<import("mysql2").RowDataPacket & {
      gelar_depan: string | null; no_sip: string | null;
    }>(`SELECT gelar_depan, no_sip FROM doctor_profiles WHERE user_id = ?`, [session.id]),
    // Tanpa penyaringan dokter: surat yang diterbitkan dokter pengganti pada
    // kunjungan ini pun harus terlihat, supaya tidak terbit dua kali.
    daftarSurat(visit.site_id, { visitId, limit: 20 }),
    daftarLampiran(visitId),
    konsultasiDefault(visitId, visit.site_id),
    // Sumbernya `patient_allergies` — daftar yang sama dengan yang diisi
    // perawat, bukan salinan teks milik asesmen ini.
    alergiPasien(visit.patient_id),
    // Persetujuan pasien pada kunjungan ini — lihat `consent-card.tsx`.
    consentKunjungan(visitId),
  ]);

  /*
   * Pilihan tindakan pada formulir persetujuan diambil dari TINDAKAN YANG
   * SUDAH TERCATAT di asesmen ini, bukan dari seluruh katalog.
   *
   * Persetujuan tindakan menyertai tindakan yang benar-benar dikerjakan;
   * menawarkan seluruh katalog hanya membuka jalan mencatat persetujuan
   * untuk tindakan yang tidak pernah ada pada kunjungan itu.
   */
  const tindakanTerpakai = procedures
    .filter((t) => Number(t.is_konsultasi) !== 1)
    .map((t) => ({ id: Number(t.procedure_id), nama: t.nama }));

  const [resepItems, resepRacikans] = resep
    ? await Promise.all([getResepItems(resep.id), getResepRacikans(resep.id)])
    : [[], []];

  const bisaDiubah = BOLEH_DIPERIKSA.includes(visit.status);
  const jasaRacikDefault = Number(setelan?.svalue ?? 5000);

  const sistolik = visit.td_sistolik;
  const diastolik = visit.td_diastolik;

  /*
   * Bekal untuk Surat Keterangan. Inilah alasan surat diterbitkan dari layar
   * ini dan bukan hanya dari menu Surat: angka-angkanya sudah ada di kunjungan
   * yang sama, jadi dokter tidak mengetik ulang TTV atau ringkasan klinis —
   * dan tidak ada peluang salah ketik antara rekam medis dan surat.
   */
  const ringkasanKlinis = [
    ["Anamnesis", asesmen?.subjective],
    ["Pemeriksaan", asesmen?.objective],
    ["Penilaian", asesmen?.assessment],
  ]
    .filter(([, isi]) => Boolean(isi))
    .map(([label, isi]) => `${label}: ${isi}`)
    .join("\n");

  const diagnosaTeks = diagnoses
    .map((d) => `${d.icd10_code} — ${d.nama_id}`)
    .join("; ");
  const suhu = visit.suhu === null ? null : Number(visit.suhu);
  const spo2 = visit.spo2;
  const nadi = visit.nadi;


  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/rme"
        className="inline-flex w-fit items-center gap-1.5 text-meta text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Kembali ke antrean
      </Link>

      {/*
        Header pasien MENEMPEL di atas. Identitas, alergi, dan tanda vital
        adalah konteks yang harus terbaca sepanjang pemeriksaan — bukan
        sesuatu yang hilang begitu dokter menggulir ke bagian diagnosa.
      */}
      <Card className="sticky top-0 z-30">
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-brand-50 font-mono text-h1 font-semibold text-brand-700">
            {visit.antrean ?? "—"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-h1 text-ink">{visit.nama}</p>
            <p className="mt-0.5 text-meta text-ink-muted">
              <span className="font-mono">{visit.no_rm}</span> ·{" "}
              {visit.jenis_kelamin === "L" ? "Laki-laki" : "Perempuan"} ·{" "}
              {hitungUmur(visit.tanggal_lahir)} tahun · {visit.poli_nama}
            </p>
            <p className="mt-0.5 text-meta text-ink-faint">
              NIK <span className="font-mono">{visit.nik}</span> ·{" "}
              <span className="font-mono">{visit.no_visit}</span> · daftar{" "}
              {formatJam(visit.waktu_daftar)}
            </p>
          </div>
          {visit.triase ? (
            <TriaseBadge level={visit.triase as "merah" | "kuning" | "hijau" | "hitam"} />
          ) : null}
          {asesmen?.status === "final" ? (
            <Badge variant="success">Asesmen final</Badge>
          ) : asesmen ? (
            <Badge variant="info">Draft tersimpan</Badge>
          ) : null}
        </div>

        {visit.alergi ? (
          <p className="mt-2.5 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-bg px-3 py-2 text-meta text-danger">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              <strong>Alergi:</strong> {visit.alergi} — periksa ulang sebelum
              meresepkan.
            </span>
          </p>
        ) : null}

        {/*
          TTV diringkas jadi satu baris. Bentuk kartu enam sel dulu memakan
          seperempat layar untuk angka yang hanya perlu dilirik; rinciannya
          tetap utuh di tab O.
        */}
        {visit.keluhan_utama ? (
          <p className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2.5 text-meta">
            <Vital label="TD" nilai={sistolik && diastolik ? `${sistolik}/${diastolik}` : null}
              abnormal={Boolean(sistolik && (sistolik >= 140 || sistolik < 90))} />
            <Vital label="N" nilai={nadi} abnormal={Boolean(nadi && (nadi > 100 || nadi < 60))} />
            <Vital label="RR" nilai={visit.respirasi} />
            <Vital label="S" nilai={suhu} abnormal={Boolean(suhu && suhu >= 37.5)} />
            <Vital label="SpO₂" nilai={spo2} abnormal={Boolean(spo2 && spo2 < 95)} />
            <Vital label="BB" nilai={visit.berat_badan ? formatDesimal(visit.berat_badan) : null} />
            <Vital label="IMT" nilai={visit.imt === null ? null : Number(visit.imt).toFixed(1)}
              abnormal={Boolean(visit.imt && (Number(visit.imt) >= 25 || Number(visit.imt) < 18.5))} />
            <Vital label="Nyeri" nilai={visit.skala_nyeri === null ? null : `${visit.skala_nyeri}/10`} />
          </p>
        ) : (
          <p className="mt-2.5 border-t border-line pt-2.5 text-meta text-warning">
            Pasien ini belum melalui pengkajian perawat.
          </p>
        )}
      </Card>

      {/*
        Panel penutup kunjungan.

        Muncul hanya setelah asesmen final, dan mengambil alih peran yang dulu
        dipegang perpindahan otomatis ke /rme: memberi tahu dokter bahwa
        pekerjaannya tersimpan dan ke mana pasien pergi. Bedanya, ia melakukan
        itu TANPA membuang dokter dari layar — sehingga cetak rekam medis dan
        surat keterangan, dua pekerjaan yang baru sah dikerjakan pada detik ini,
        ada tepat di depan mata alih-alih di balik satu kunjungan yang harus
        dibuka ulang.
      */}
      {asesmen?.status === "final" ? (
        <Card className="border-success/30 bg-success-bg">
          <CardHeader>
            <CardTitle icon={CheckCheck}>Asesmen Sudah Difinalkan</CardTitle>
            <Badge variant="success">Final</Badge>
          </CardHeader>

          <p className="text-body text-ink">
            {LANJUTAN[visit.status] ?? "Kunjungan diteruskan ke tahap berikutnya."}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-success/25 pt-3">
            <CetakRekamMedis visitId={visitId} />
            <a href="#bagian-berkas" className={TAUTAN_AKSI}>
              <FileSignature aria-hidden />
              Surat Keterangan
            </a>
            <Link href="/rme" className={`${TAUTAN_AKSI} ml-auto`}>
              Pasien Berikutnya
              <ArrowRight aria-hidden />
            </Link>
          </div>
        </Card>
      ) : null}

      {/* ---------- Asesmen dokter ---------- */}
      <AsesmenForm
        visitId={visitId}
        terkunci={!bisaDiubah}
        /*
         * Prefill dari perawat HANYA saat asesmen belum pernah tersimpan.
         * Setelah tersimpan, yang dipakai adalah persis isi asesmen — termasuk
         * kolom yang sengaja dikosongkan dokter. Menimpanya lagi dengan catatan
         * perawat akan mengembalikan teks yang baru saja ia hapus.
         */
        awal={{
          jenis_anamnesis: asesmen?.jenis_anamnesis ?? "",
          sumber_anamnesis: asesmen?.sumber_anamnesis ?? "",
          keluhan_utama: asesmen
            ? (asesmen.keluhan_utama ?? "")
            : (visit.keluhan_utama ?? ""),
          riwayat_penyakit: asesmen
            ? (asesmen.riwayat_penyakit ?? "")
            : (visit.riwayat_singkat ?? ""),
          riwayat_pengobatan: asesmen
            ? (asesmen.riwayat_pengobatan ?? "")
            : (visit.riwayat_pengobatan ?? ""),
          keadaan_umum: asesmen
            ? (asesmen.keadaan_umum ?? "")
            : (visit.keadaan_umum ?? ""),
          keadaan_gizi: asesmen
            ? (asesmen.keadaan_gizi ?? "")
            : (visit.keadaan_gizi ?? ""),
          assessment: asesmen?.assessment ?? "",
          terapi: asesmen?.terapi ?? "",
          plan: asesmen?.plan ?? "",
          edukasi: asesmen?.edukasi ?? "",
        }}
        lokalisAwal={bacaStatusLokalis(asesmen?.status_lokalis ?? null)}
        perawat={{
          nama: visit.perawat_nama,
          keluhan_utama: visit.keluhan_utama,
          riwayat_singkat: visit.riwayat_singkat,
          riwayat_pengobatan: visit.riwayat_pengobatan,
          keadaan_umum: visit.keadaan_umum,
          keadaan_gizi: visit.keadaan_gizi,
          alergi: visit.alergi,
        }}
        alergiAwal={alergi}
        diagnosaAwal={
          diagnoses.map((d) => ({
            icd10_code: d.icd10_code,
            nama: d.nama_id,
            tipe: d.tipe,
          })) as Diagnosa[]
        }
        tindakanAwal={
          procedures.map((t) => ({
            procedure_id: t.procedure_id,
            nama: t.nama,
            qty: Number(t.qty),
            tarif: Number(t.tarif),
            diskon: Number(t.diskon),
            alasan_diskon: t.alasan_diskon ?? "",
            is_konsultasi: Number(t.is_konsultasi) === 1,
          })) as Tindakan[]
        }
        konsultasi={
          konsultasi
            ? {
                procedure_id: konsultasi.id,
                nama: konsultasi.nama,
                qty: 1,
                tarif: Number(konsultasi.tarif),
                diskon: 0,
                alasan_diskon: "",
                is_konsultasi: true,
              }
            : null
        }
        ringkas={{
          // Order batal tidak dihitung — ia tampil di kartunya sebagai
          // keterangan, bukan sebagai pekerjaan yang masih berjalan.
          labOrder: orderLab.filter((o) => o.status !== "batal").length,
          labKritis: orderLab.some((o) => Number(o.ada_kritis) > 0),
          resepItem: resepItems.length + resepRacikans.length,
          dokumen: dokumen.length,
          surat: suratVisit.length,
        }}
        /* Pengkajian perawat jadi rujukan di tab O — di situlah dokter
           membandingkan temuannya dengan catatan perawat. */
        slotPerawat={
          visit.keluhan_utama ? (
            <Card>
              <CardHeader>
                <CardTitle icon={HeartPulse}>Pengkajian Perawat</CardTitle>
                {visit.perawat_nama ? (
                  <span className="text-meta text-ink-faint">oleh {visit.perawat_nama}</span>
                ) : null}
              </CardHeader>
              <p className="rounded-md border border-line bg-surface-alt px-3 py-2 text-body text-ink">
                <span className="text-label text-ink-muted">Keluhan utama: </span>
                {visit.keluhan_utama}
                {visit.riwayat_singkat ? (
                  <>
                    <br />
                    <span className="text-label text-ink-muted">Riwayat: </span>
                    {visit.riwayat_singkat}
                  </>
                ) : null}
              </p>
              <p className="mt-2 text-meta text-ink-muted">
                BB {visit.berat_badan ? `${formatDesimal(visit.berat_badan)} kg` : "—"} · TB{" "}
                {visit.tinggi_badan ? `${formatDesimal(visit.tinggi_badan)} cm` : "—"} ·
                Skala nyeri {visit.skala_nyeri ?? "—"}/10 · Kesadaran{" "}
                {visit.kesadaran?.replace("_", " ") ?? "—"}
              </p>
            </Card>
          ) : null
        }
        slotLab={
          <LabCard
            visitId={visitId}
            terkunci={!bisaDiubah}
            orders={
              orderLab.map((o) => ({
                id: o.id,
                no_order: o.no_order,
                status: o.status,
                prioritas: o.prioritas,
                sifat_hasil: o.sifat_hasil,
                atas_permintaan_sendiri: Number(o.atas_permintaan_sendiri),
                ordered_at: o.ordered_at,
                panels: o.panels,
                ada_kritis: Number(o.ada_kritis),
                alasan_batal: o.alasan_batal,
                dibatalkan_oleh: o.dibatalkan_oleh,
              })) as OrderTampil[]
            }
            hasil={
              hasilLab.map((h) => ({
                no_order: h.no_order,
                panel_nama: h.panel_nama,
                parameter_nama: h.parameter_nama,
                nilai:
                  h.nilai_numerik !== null
                    ? formatDesimal(h.nilai_numerik)
                    : (h.nilai_teks ?? "—"),
                satuan: h.satuan,
                ref_teks: h.ref_teks,
                flag: h.flag,
              })) as HasilTampil[]
            }
          />
        }
        slotResep={
          <ResepForm
        visitId={visitId}
        noResep={resep?.no_resep ?? null}
        terkunci={!bisaDiubah || (resep !== null && resep.status !== "baru")}
        jasaRacikDefault={jasaRacikDefault}
        catatanAwal={resep?.catatan_umum ?? ""}
        itemsAwal={
          resepItems.map((i) => ({
            item_id: i.item_id,
            nama: i.nama,
            qty: Number(i.qty),
            satuan: i.satuan,
            aturan_pakai: i.aturan_pakai,
            catatan: i.catatan ?? undefined,
            harga_satuan: Number(i.harga_satuan),
            stok: Number(i.stok),
          })) as ObatPaten[]
        }
        racikansAwal={
          resepRacikans.map((r) => ({
            nama_racikan: r.nama_racikan,
            bentuk_sediaan: r.bentuk_sediaan,
            qty_jadi: Number(r.qty_jadi),
            satuan_jadi: r.satuan_jadi,
            aturan_pakai: r.aturan_pakai,
            biaya_jasa_racik: Number(r.biaya_jasa_racik),
            catatan: r.catatan ?? undefined,
            ingredients: r.ingredients.map((b) => ({
              item_id: b.item_id,
              nama: b.nama,
              qty_bahan: Number(b.qty_bahan),
              satuan: b.satuan,
              harga_satuan: Number(b.harga_satuan),
              stok: Number(b.stok),
            })),
          })) as Racikan[]
        }
          />
        }
        slotBerkas={
          <>
            {/*
              Persetujuan pasien ditaruh di kelompok Berkas, bersama dokumen
              dan surat, karena sifatnya sama: dokumen yang dibuat untuk
              dibaca kembali di kemudian hari. Bedanya ia dokumen MASUK —
              yang lain keluar.
            */}
            <ConsentCard
              visitId={visitId}
              namaPasien={visit.nama}
              petugas={session.nama}
              tindakan={tindakanTerpakai}
              boleh={visit.status !== "batal"}
              daftar={consentRows.map<ConsentTampil>((c) => ({
                id: Number(c.id),
                jenis: c.jenis,
                judul: c.judul,
                isi: c.isi,
                tindakan: c.tindakan_nama,
                pemberiPenjelasan: c.pemberi_penjelasan,
                penandatangan: c.penandatangan,
                hubungan: c.hubungan,
                saksi: c.saksi_nama,
                status: c.status,
                alasanBatal: c.alasan_batal,
                waktu: String(c.ditandatangani_at),
              }))}
            />

            {/*
              Rekam medis SATU kunjungan — lampiran klaim, rujukan, serah
              terima antar dokter.

              Letaknya BERPINDAH mengikuti tahap pekerjaan, bukan muncul-hilang
              begitu saja. Selagi asesmen masih draf ia tinggal di sini sebagai
              alat bantu, tampil redup dan menyatakan sendiri bahwa cetakannya
              belum sah. Begitu asesmen final ia naik ke panel penutup di atas —
              di situ ia berhenti jadi alat bantu dan menjadi salah satu dari
              dua pekerjaan terakhir kunjungan.

              Karena itu di sini ia disembunyikan saat final: satu hal, satu
              tempat, dan tempatnya yang paling mudah dijangkau saat dibutuhkan.
            */}
            {asesmen?.status === "final" ? null : (
              <Card className="opacity-75">
                <CardHeader>
                  <CardTitle icon={Printer}>Rekam Medis Kunjungan Ini</CardTitle>
                  <Badge variant="warning">Draf</Badge>
                </CardHeader>

                <p className="mb-2.5 text-meta text-ink-muted">
                  Asesmen belum difinalkan. Cetakan akan bertanda{" "}
                  <strong className="text-warning">DRAF</strong> dan belum sah
                  sebagai rekam medis — boleh dipakai untuk dibaca sendiri atau
                  serah terima, tidak untuk diserahkan ke pasien maupun asuransi.
                </p>

                <CetakRekamMedis visitId={visitId} />
              </Card>
            )}

            <DokumenCard
              visitId={visitId}
              maksBytes={maksUkuranDokumen()}
              dokumen={
                dokumen.map((d) => ({
                  id: d.id,
                  kunci: d.kunci,
                  nama_asli: d.nama_asli,
                  keterangan: d.keterangan,
                  mime: d.mime,
                  ukuran: Number(d.ukuran),
                  created_at: d.created_at,
                  pengunggah: d.pengunggah,
                })) as DokumenTampil[]
              }
            />
            <SuratCard
        visitId={visitId}
        klinik={klinik}
        dokter={session.nama}
        gelar={profilDokter?.gelar_depan ?? null}
        noSip={profilDokter?.no_sip ?? null}
        hariIni={tanggalHariIni()}
        boleh={
          Number(visit.doctor_id) === session.id ||
          Number(visit.substitute_doctor_id ?? 0) === session.id
        }
        dokterPenanggung={visit.dokter_nama}
        pasien={{
          nama: visit.nama,
          noRm: visit.no_rm,
          nik: visit.nik,
          tanggalLahir: visit.tanggal_lahir,
          jenisKelamin: visit.jenis_kelamin as "L" | "P",
          alamat: visit.alamat,
          pekerjaan: visit.pekerjaan,
        }}
        prefill={{
          tinggi_badan: formatDesimal(visit.tinggi_badan),
          berat_badan: formatDesimal(visit.berat_badan),
          tekanan_darah: sistolik && diastolik ? `${sistolik}/${diastolik}` : "",
          diagnosa: diagnosaTeks,
          ringkasan_klinis: ringkasanKlinis,
        }}
        sudahTerbit={suratVisit.map((s) => ({
          klinik,
          noSurat: s.no_surat,
          jenis: s.jenis,
          terbit: s.issued_at.slice(0, 10),
          pasien: {
            nama: s.nama,
            noRm: s.no_rm,
            nik: s.nik,
            tanggalLahir: s.tanggal_lahir,
            jenisKelamin: s.jenis_kelamin,
            alamat: s.alamat,
            pekerjaan: s.pekerjaan,
          },
          dokter: s.dokter,
          gelar: s.dokter_gelar,
          noSip: s.no_sip,
          data: s.data,
        }))}
            />
          </>
        }
      />
    </div>
  );
}
