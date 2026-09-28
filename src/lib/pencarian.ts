import "server-only";
import type { RowDataPacket } from "mysql2";
import { limitAman, query } from "./db";
import type { RoleCode } from "./rbac";

/**
 * Pencarian cepat lintas modul — jawaban untuk satu pertanyaan yang paling
 * sering terdengar di klinik: **"pasien X sekarang di mana?"**
 *
 * Sebelum ada berkas ini, pertanyaan itu tidak punya jawaban tanpa lebih
 * dulu menebak modulnya: petugas harus tahu pasiennya sedang di lab atau
 * di kasir SEBELUM bisa membuka layar yang tepat. Yang terjadi kemudian
 * bukan mencari di sistem, melainkan berteriak lintas ruangan.
 *
 * DUA ATURAN YANG MEMBENTUKNYA
 *
 * 1. **Pasien dicari lintas cabang, tindakan tidak.** Satu NIK adalah satu
 *    pasien di seluruh jaringan (docs/DATABASE.md §3.7), jadi pencariannya
 *    harus menemukan pasien yang pernah berobat di cabang mana pun. Tetapi
 *    setiap layar detail menyaring `WHERE site_id = <cabang aktif>`, jadi
 *    tautan hanya diberikan bila kunjungannya memang di cabang yang sedang
 *    aktif. Tautan yang berujung 404 lebih buruk daripada tidak ada tautan.
 *
 * 2. **Tautan mengikuti peran, bukan pasien.** Setiap peran punya layar
 *    detailnya sendiri dengan id yang berbeda-beda — dokter memakai id
 *    kunjungan, farmasi id resep, kasir id tagihan, lab id order. Peran
 *    yang tidak punya layar untuk pasien itu tetap melihat barisnya
 *    beserta statusnya; yang hilang hanya tombolnya. Pemisahan tugas tidak
 *    boleh dilanggar hanya karena kotak pencarian terasa praktis.
 */

export type HasilCari = RowDataPacket & {
  patient_id: number;
  no_rm: string;
  nik: string;
  nama: string;
  tanggal_lahir: string;
  jenis_kelamin: "L" | "P";
  alergi: string | null;
  visit_id: number | null;
  visit_status: string | null;
  visit_tanggal: string | null;
  antrean: string | null;
  visit_site_id: number | null;
  site_nama: string | null;
  poli_nama: string | null;
  prescription_id: number | null;
  billing_id: number | null;
  lab_order_id: number | null;
};

export type BarisCari = {
  patientId: number;
  noRm: string;
  nik: string;
  nama: string;
  tanggalLahir: string;
  jenisKelamin: "L" | "P";
  alergi: string | null;
  /** Ringkasan posisi pasien saat ini, mis. "Menunggu Kasir · Poli Umum". */
  status: string | null;
  tanggal: string | null;
  antrean: string | null;
  siteNama: string | null;
  poliNama: string | null;
  /** Kunjungan ada, tetapi di cabang lain — tautan sengaja tidak diberikan. */
  cabangLain: boolean;
  /** Tujuan yang boleh dibuka peran ini; `null` bila tidak ada. */
  link: string | null;
};

/**
 * Layar detail milik tiap peran, beserta kolom id yang dipakainya.
 *
 * Super Admin sengaja TIDAK diberi tautan: menu-nya murni sistem dan
 * master data, sehingga melemparnya ke layar operasional hanya
 * menghasilkan pengalihan kembali ke dashboard.
 */
const TUJUAN: Partial<
  Record<RoleCode, { kolom: keyof HasilCari; awalan: string }>
> = {
  dokter: { kolom: "visit_id", awalan: "/rme/" },
  perawat: { kolom: "visit_id", awalan: "/pengkajian/" },
  petugas_lab: { kolom: "lab_order_id", awalan: "/lab/" },
  farmasi: { kolom: "prescription_id", awalan: "/farmasi/" },
  kasir: { kolom: "billing_id", awalan: "/kasir/" },
};

const SQL = `
  SELECT p.id AS patient_id, p.no_rm, p.nik, p.nama, p.tanggal_lahir,
         p.jenis_kelamin,
         (SELECT GROUP_CONCAT(a.nama_alergen SEPARATOR ', ')
            FROM patient_allergies a
           WHERE a.patient_id = p.id AND a.is_active = 1) AS alergi,
         v.id            AS visit_id,
         v.status        AS visit_status,
         v.tanggal       AS visit_tanggal,
         CONCAT(qu.prefix, LPAD(qu.nomor, 3, '0')) AS antrean,
         v.site_id       AS visit_site_id,
         s.nama          AS site_nama,
         po.nama         AS poli_nama,
         /*
          * Setiap id di bawah disaring pada STATUS yang berarti perannya
          * memang punya pekerjaan — bukan sekadar barisnya ada.
          *
          * Tagihan lahir sebagai 'draft' sejak pasien mendaftar; tanpa
          * saringan ini kotak pencarian akan melempar kasir ke layar
          * pembayaran pasien yang bahkan belum diperiksa dokter. Resep yang
          * sudah 'diserahkan' sama halnya: pekerjaannya sudah selesai.
          */
         (SELECT rx.id FROM prescriptions rx
           WHERE rx.visit_id = v.id
             AND rx.status IN ('baru','diterima_farmasi','disiapkan')
           ORDER BY rx.id DESC LIMIT 1) AS prescription_id,
         (SELECT bt.id FROM billing_transactions bt
           WHERE bt.visit_id = v.id
             AND bt.status IN ('menunggu','lunas')) AS billing_id,
         (SELECT lo.id FROM lab_orders lo
           WHERE lo.visit_id = v.id AND lo.status NOT IN ('selesai','batal')
           ORDER BY lo.id DESC LIMIT 1) AS lab_order_id
    FROM patients p
    /*
     * Kunjungan BERJALAN saja — dan hanya satu, yang terbaru.
     *
     * Riwayat tidak ikut: pertanyaan yang dijawab kotak ini adalah "di mana
     * pasien ini SEKARANG". Kunjungan lama justru mengubur jawabannya di
     * bawah tumpukan baris yang semuanya berbunyi "Selesai".
     */
    LEFT JOIN visits v ON v.id = (
      SELECT v2.id FROM visits v2
       WHERE v2.patient_id = p.id
         AND v2.status NOT IN ('selesai','batal')
       ORDER BY v2.tanggal DESC, v2.id DESC
       LIMIT 1)
    LEFT JOIN sites s ON s.id = v.site_id
    LEFT JOIN polis po ON po.id = v.poli_id
    LEFT JOIN queues qu ON qu.visit_id = v.id
   WHERE p.is_active = 1
     AND (p.nik LIKE ? OR p.no_rm LIKE ? OR p.nama LIKE ?)
   ORDER BY (v.id IS NOT NULL) DESC, (p.nik = ?) DESC, p.nama
`;

export async function cariCepat(
  keyword: string,
  role: RoleCode,
  siteAktif: number | null,
  limit = 8,
): Promise<BarisCari[]> {
  const q = keyword.trim();
  if (q.length < 2) return [];

  const rows = await query<HasilCari>(
    `${SQL} LIMIT ${limitAman(limit)}`,
    [`${q}%`, `${q}%`, `%${q}%`, q],
  );

  const tujuan = TUJUAN[role];

  return rows.map((r) => {
    const dicabangLain =
      r.visit_id !== null &&
      siteAktif !== null &&
      Number(r.visit_site_id) !== siteAktif;

    const id = tujuan ? r[tujuan.kolom] : null;
    const link =
      tujuan && id && !dicabangLain ? `${tujuan.awalan}${id}` : null;

    return {
      patientId: Number(r.patient_id),
      noRm: r.no_rm,
      nik: r.nik,
      nama: r.nama,
      tanggalLahir: r.tanggal_lahir,
      jenisKelamin: r.jenis_kelamin,
      alergi: r.alergi,
      status: r.visit_status,
      tanggal: r.visit_tanggal,
      antrean: r.antrean,
      siteNama: r.site_nama,
      poliNama: r.poli_nama,
      cabangLain: dicabangLain,
      link,
    };
  });
}
