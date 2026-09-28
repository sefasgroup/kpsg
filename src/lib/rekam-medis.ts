import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { queryOne } from "./db";
import { formatDesimal } from "./format";
import {
  bacaStatusLokalis, dokterPemeriksa, getAsesmen, getDiagnosa, getTindakan,
} from "./doctor";
import type { StatusLokalis } from "./validations/doctor";
import { getResep, getResepItems, getResepRacikans } from "./prescription";
import { hasilLabKunjungan } from "./lab";
import { daftarLampiran } from "./lampiran-rme";
import { kopKlinik } from "./dokumen";

/**
 * Rekam medis satu kunjungan, dirakit lengkap dari seluruh modul.
 *
 * Diangkat ke lapisan lib karena dibutuhkan dari DUA layar: halaman
 * pemeriksaan dokter (kunjungan yang sedang berjalan) dan Riwayat Pasien
 * (kunjungan mana pun, termasuk cabang lain). Menyalin perakitannya ke
 * masing-masing layar berarti suatu saat keduanya mencetak isi yang berbeda
 * untuk kunjungan yang sama.
 *
 * TIDAK disaring per cabang. Riwayat pasien memang lintas cabang
 * (docs/DATABASE.md §3.7) — satu NIK adalah satu pasien di seluruh jaringan,
 * dan rekam medisnya tidak boleh terputus saat ia berobat di cabang lain.
 * Penjagaan aksesnya ada di peran pemanggil: hanya dokter dan Super Admin.
 */

export type DataRekamMedis = {
  klinik: {
    nama: string;
    namaLegal: string | null;
    alamat: string | null;
    telepon: string | null;
    noIzin: string | null;
  };
  visit: {
    noVisit: string;
    tanggal: string;
    waktuDaftar: string;
    poli: string;
    caraBayar?: string | null;
  };
  pasien: {
    nama: string;
    noRm: string;
    nik: string;
    tanggalLahir: string;
    jenisKelamin: "L" | "P";
    alamat: string | null;
    pekerjaan: string | null;
  };
  alergi: string | null;
  /** `null` bila dokter belum menyimpan asesmen sama sekali. */
  asesmen: {
    status: string;
    jenis_anamnesis: string | null;
    sumber_anamnesis: string | null;
    keluhan_utama: string | null;
    riwayat_penyakit: string | null;
    riwayat_pengobatan: string | null;
    riwayat_alergi: string | null;
    subjective: string | null;
    keadaan_umum: string | null;
    keadaan_gizi: string | null;
    objective: string | null;
    assessment: string | null;
    terapi: string | null;
    plan: string | null;
    edukasi: string | null;
  } | null;
  /** Titik keluhan pada body diagram, sudah terurai dari JSON. */
  lokalis: StatusLokalis;
  perawat: {
    nama: string | null;
    triase: string | null;
    keluhanUtama: string | null;
    riwayat: string | null;
    ttv: string;
  };
  diagnosa: { kode: string; nama: string; tipe: string }[];
  tindakan: { nama: string; qty: number }[];
  lab: {
    panel: string;
    parameter: string;
    nilai: string;
    satuan: string | null;
    ref: string | null;
    flag: string | null;
  }[];
  obat: { nama: string; qty: string; satuan: string; signa: string; catatan: string | null }[];
  racikan: {
    nama: string;
    bentuk: string;
    qty: string;
    satuan: string;
    signa: string;
    bahan: { nama: string; qty: string; satuan: string }[];
  }[];
  dokumen: { nama: string; keterangan: string | null }[];
  dokter: { nama: string; gelar: string | null; noSip: string | null };
  dicetakOleh: string;
};

type KepalaKunjungan = RowDataPacket & {
  site_id: number;
  no_visit: string;
  tanggal: string;
  waktu_daftar: string;
  cara_bayar: string;
  poli_nama: string;
  dokter_nama: string;
  nama: string;
  no_rm: string;
  nik: string;
  tanggal_lahir: string;
  jenis_kelamin: "L" | "P";
  alamat: string | null;
  pekerjaan: string | null;
  alergi: string | null;
  perawat_nama: string | null;
  triase: string | null;
  keluhan_utama: string | null;
  riwayat_singkat: string | null;
  td_sistolik: number | null;
  td_diastolik: number | null;
  nadi: number | null;
  respirasi: number | null;
  suhu: string | null;
  spo2: number | null;
  berat_badan: string | null;
  tinggi_badan: string | null;
  imt: string | null;
  skala_nyeri: number | null;
  kesadaran: string | null;
};

export async function detailRekamMedis(
  visitId: number,
  dicetakOleh: string,
): Promise<DataRekamMedis | null> {
  const k = await queryOne<KepalaKunjungan>(
    `SELECT v.site_id, v.no_visit, v.tanggal, v.waktu_daftar, v.cara_bayar,
            pol.nama AS poli_nama,
            COALESCE(sub.nama, d.nama) AS dokter_nama,
            p.nama, p.no_rm, p.nik, p.tanggal_lahir, p.jenis_kelamin,
            p.alamat, p.pekerjaan,
            (SELECT GROUP_CONCAT(a.nama_alergen SEPARATOR ', ')
               FROM patient_allergies a
              WHERE a.patient_id = p.id AND a.is_active = 1) AS alergi,
            nrs.nama AS perawat_nama,
            na.triase, na.keluhan_utama, na.riwayat_singkat,
            na.td_sistolik, na.td_diastolik, na.nadi, na.respirasi, na.suhu,
            na.spo2, na.berat_badan, na.tinggi_badan, na.imt,
            na.skala_nyeri, na.kesadaran
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       JOIN polis pol  ON pol.id = v.poli_id
       JOIN users d    ON d.id = v.doctor_id
       LEFT JOIN users sub ON sub.id = v.substitute_doctor_id
       LEFT JOIN nurse_assessments na ON na.visit_id = v.id
       LEFT JOIN users nrs ON nrs.id = na.nurse_id
      WHERE v.id = ?`,
    [visitId],
  );
  if (!k) return null;

  const [klinik, asesmen, diagnosa, tindakan, resep, lab, dokumen, pemeriksa] =
    await Promise.all([
      // Kop diambil dari cabang KUNJUNGAN, bukan cabang aktif pembaca —
      // surat dari cabang Cimahi harus berkop Cimahi walau dibuka dari Pusat.
      kopKlinik(Number(k.site_id)),
      getAsesmen(visitId),
      getDiagnosa(visitId),
      getTindakan(visitId),
      getResep(visitId),
      hasilLabKunjungan(visitId),
      daftarLampiran(visitId),
      dokterPemeriksa(visitId),
    ]);

  const [obat, racikan] = resep
    ? await Promise.all([getResepItems(resep.id), getResepRacikans(resep.id)])
    : [[], []];

  return {
    klinik,
    visit: {
      noVisit: k.no_visit,
      tanggal: k.tanggal,
      waktuDaftar: k.waktu_daftar,
      poli: k.poli_nama,
      caraBayar: k.cara_bayar,
    },
    pasien: {
      nama: k.nama,
      noRm: k.no_rm,
      nik: k.nik,
      tanggalLahir: k.tanggal_lahir,
      jenisKelamin: k.jenis_kelamin,
      alamat: k.alamat,
      pekerjaan: k.pekerjaan,
    },
    alergi: k.alergi,
    asesmen: asesmen
      ? {
          status: asesmen.status,
          jenis_anamnesis: asesmen.jenis_anamnesis,
          sumber_anamnesis: asesmen.sumber_anamnesis,
          keluhan_utama: asesmen.keluhan_utama,
          riwayat_penyakit: asesmen.riwayat_penyakit,
          riwayat_pengobatan: asesmen.riwayat_pengobatan,
          riwayat_alergi: asesmen.riwayat_alergi,
          subjective: asesmen.subjective,
          keadaan_umum: asesmen.keadaan_umum,
          keadaan_gizi: asesmen.keadaan_gizi,
          objective: asesmen.objective,
          assessment: asesmen.assessment,
          terapi: asesmen.terapi,
          plan: asesmen.plan,
          edukasi: asesmen.edukasi,
        }
      : null,
    lokalis: bacaStatusLokalis(asesmen?.status_lokalis ?? null),
    perawat: {
      nama: k.perawat_nama,
      triase: k.triase,
      keluhanUtama: k.keluhan_utama,
      riwayat: k.riwayat_singkat,
      ttv: rangkumTtv(k),
    },
    diagnosa: diagnosa.map((d) => ({
      kode: d.icd10_code, nama: d.nama_id, tipe: d.tipe,
    })),
    tindakan: tindakan.map((t) => ({ nama: t.nama, qty: Number(t.qty) })),
    lab: lab.map((h) => ({
      panel: h.panel_nama,
      parameter: h.parameter_nama,
      nilai:
        h.nilai_numerik !== null ? formatDesimal(h.nilai_numerik) : (h.nilai_teks ?? "—"),
      satuan: h.satuan,
      ref: h.ref_teks,
      flag: h.flag,
    })),
    obat: obat.map((i) => ({
      nama: i.nama,
      qty: formatDesimal(i.qty),
      satuan: i.satuan,
      signa: i.aturan_pakai,
      catatan: i.catatan,
    })),
    racikan: racikan.map((r) => ({
      nama: r.nama_racikan,
      bentuk: r.bentuk_sediaan,
      qty: formatDesimal(r.qty_jadi),
      satuan: r.satuan_jadi,
      signa: r.aturan_pakai,
      bahan: r.ingredients.map((b) => ({
        nama: b.nama,
        qty: formatDesimal(b.qty_bahan),
        satuan: b.satuan,
      })),
    })),
    dokumen: dokumen.map((d) => ({ nama: d.nama_asli, keterangan: d.keterangan })),
    dokter: {
      nama: pemeriksa?.nama ?? k.dokter_nama,
      gelar: pemeriksa?.gelar_depan ?? null,
      noSip: pemeriksa?.no_sip ?? null,
    },
    dicetakOleh,
  };
}

/** TTV dirangkai satu baris untuk lembar cetak; yang kosong dilewati. */
function rangkumTtv(k: KepalaKunjungan): string {
  const suhu = k.suhu === null ? null : Number(k.suhu);
  return [
    k.td_sistolik && k.td_diastolik ? `TD ${k.td_sistolik}/${k.td_diastolik} mmHg` : null,
    k.nadi ? `N ${k.nadi}×/mnt` : null,
    k.respirasi ? `RR ${k.respirasi}×/mnt` : null,
    suhu === null ? null : `S ${suhu}°C`,
    k.spo2 ? `SpO₂ ${k.spo2}%` : null,
    k.berat_badan ? `BB ${formatDesimal(k.berat_badan)} kg` : null,
    k.tinggi_badan ? `TB ${formatDesimal(k.tinggi_badan)} cm` : null,
    k.imt ? `IMT ${Number(k.imt).toFixed(1)}` : null,
    k.skala_nyeri === null ? null : `Nyeri ${k.skala_nyeri}/10`,
    k.kesadaran ? `Kesadaran ${k.kesadaran.replace("_", " ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
