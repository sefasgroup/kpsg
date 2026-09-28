import "server-only";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { nextSequence, query, queryOne, transaction, limitAman } from "./db";
import { kunciKunjungan, visitIdDariOrderLab } from "./kunci";
import {
  hitungUlangTagihan,
  pastikanTagihan,
  tambahBarisTagihan,
} from "./billing";
import { kirimNotifikasi } from "./notifications";
import type { HasilLabInput, OrderLabInput } from "./validations/lab";

import { periodeSekarang } from "./tanggal";

const REF_LAB = "lab_order_panel";

/**
 * Menentukan penanda hasil.
 *
 * Ambang kritis diperiksa LEBIH DULU daripada rentang rujukan: nilai yang
 * mengancam nyawa harus muncul sebagai kritis, bukan sekadar "rendah".
 * Parameter tanpa rentang rujukan (teks/pilihan) selalu Normal — penilaian
 * diserahkan ke dokter.
 */
export function hitungFlag(
  nilai: number | null,
  ref: {
    ref_low: number | null;
    ref_high: number | null;
    kritis_low: number | null;
    kritis_high: number | null;
  },
): "N" | "L" | "H" | "LL" | "HH" {
  if (nilai === null || Number.isNaN(nilai)) return "N";

  if (ref.kritis_low !== null && nilai < ref.kritis_low) return "LL";
  if (ref.kritis_high !== null && nilai > ref.kritis_high) return "HH";
  if (ref.ref_low !== null && nilai < ref.ref_low) return "L";
  if (ref.ref_high !== null && nilai > ref.ref_high) return "H";
  return "N";
}

export type PanelOption = RowDataPacket & {
  id: number;
  kode: string;
  nama: string;
  kategori: string | null;
  tarif: string;
  jumlah_parameter: number;
};

export async function cariPanel(keyword: string, limit = 20): Promise<PanelOption[]> {
  const q = keyword.trim();
  if (q.length < 2) return [];
  return query<PanelOption>(
    `SELECT lp.id, lp.kode, lp.nama, lp.kategori, lp.tarif,
            (SELECT COUNT(*) FROM lab_parameters p
              WHERE p.panel_id = lp.id AND p.is_active = 1) AS jumlah_parameter
       FROM lab_panels lp
      WHERE lp.is_active = 1 AND (lp.nama LIKE ? OR lp.kode LIKE ?)
      ORDER BY lp.kategori, lp.nama
      LIMIT ${limitAman(limit)}`,
    [`%${q}%`, `${q}%`],
  );
}

// ---------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------

/**
 * Membuat order lab dan langsung memasukkan tarifnya ke tagihan.
 *
 * Biaya masuk saat ORDER dibuat, bukan saat hasil keluar: sampel sudah
 * diambil dan reagen sudah terpakai begitu pemeriksaan dimulai. Berbeda
 * dengan obat, yang baru ditagihkan saat benar-benar diserahkan.
 */
export async function buatOrderLab(
  visitId: number,
  siteId: number,
  doctorId: number,
  input: OrderLabInput,
  /**
   * Order ATAS PERMINTAAN SENDIRI — dibuat petugas lab, bukan dokter.
   * `doctorId` lalu berisi id petugas lab yang membuatnya, dan itu memang
   * yang dimaksud: rekam medis harus menunjukkan siapa yang sebenarnya
   * memesan (CLAUDE.md §4).
   */
  aps = false,
): Promise<{ orderId: number; noOrder: string; total: number }> {
  return transaction(async (conn) => {
    const [visitRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, site_id, status FROM visits WHERE id = ? FOR UPDATE`,
      [visitId],
    );
    const visit = visitRows[0];
    if (!visit) throw new Error("Kunjungan tidak ditemukan.");
    if (visit.site_id !== siteId) {
      throw new Error("Kunjungan ini bukan milik cabang Anda.");
    }
    /*
     * Order DOKTER ditolak begitu pasien sampai di kasir: asesmennya sudah
     * final dan menambah pemeriksaan berarti membuka kembali kunjungan yang
     * sudah ditutup secara klinis.
     *
     * Order APS berbeda. Pasien yang sudah selesai diperiksa dan sedang
     * mengantre bayar justru saat itulah mampir ke lab minta cek gula. Yang
     * benar-benar membatasi di sini bukan tahap pelayanan melainkan tagihan —
     * dan `pastikanTagihan()` di bawah sudah menolak yang sudah lunas.
     */
    const terlarang = aps
      ? ["selesai", "batal"]
      : ["selesai", "batal", "menunggu_kasir"];
    if (terlarang.includes(String(visit.status))) {
      throw new Error(
        "Kunjungan sudah melewati tahap pelayanan — order lab tidak bisa dibuat.",
      );
    }

    const [siteRows] = await conn.execute<RowDataPacket[]>(
      `SELECT kode FROM sites WHERE id = ?`,
      [siteId],
    );
    const kodeSite = String(siteRows[0]?.kode ?? "KPSG");
    const periode = periodeSekarang();
    const nomor = await nextSequence(conn, siteId, "lab", periode);
    const noOrder = `${kodeSite}/L/${periode}/${String(nomor).padStart(5, "0")}`;

    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO lab_orders
         (site_id, visit_id, no_order, ordered_by, prioritas, sifat_hasil,
          atas_permintaan_sendiri, catatan_klinis, status)
       VALUES (?,?,?,?,?,?,?,?, 'baru')`,
      [
        siteId, visitId, noOrder, doctorId, input.prioritas, input.sifat_hasil,
        aps ? 1 : 0, input.catatan_klinis ?? null,
      ],
    );
    const orderId = res.insertId;

    const billingId = await pastikanTagihan(conn, visitId, siteId);
    let total = 0;

    for (const p of input.panels) {
      const [lop] = await conn.execute<ResultSetHeader>(
        `INSERT INTO lab_order_panels (order_id, panel_id, tarif) VALUES (?,?,?)`,
        [orderId, p.panel_id, p.tarif],
      );
      await tambahBarisTagihan(conn, {
        billingId,
        kategori: "laboratorium",
        deskripsi: p.nama,
        qty: 1,
        hargaSatuan: p.tarif,
        refType: REF_LAB,
        refId: lop.insertId,
      });
      total += p.tarif;
    }

    await hitungUlangTagihan(conn, billingId);

    /*
     * Pasien HANYA ditahan bila hasilnya memang ditunggu.
     *
     * Order `menyusul` — kultur resistensi, patologi anatomi, apa pun yang
     * dikirim ke lab rujukan — tidak boleh menghentikan pelayanan hari ini.
     * Sampelnya diambil, tarifnya masuk tagihan, dan pasien jalan terus ke
     * farmasi atau kasir. Hasilnya menyusul kapan pun tanpa mengganggu
     * kunjungan yang sudah tutup.
     */
    if (input.sifat_hasil === "ditunggu") {
      await conn.execute(`UPDATE visits SET status = 'menunggu_lab' WHERE id = ?`, [visitId]);
    }

    // Serah terima ke petugas lab.
    const [pasienRows] = await conn.execute<RowDataPacket[]>(
      `SELECT p.nama, p.no_rm FROM visits v
         JOIN patients p ON p.id = v.patient_id WHERE v.id = ?`,
      [visitId],
    );
    const cito = input.prioritas === "cito";

    await kirimNotifikasi(
      { roleCode: "petugas_lab", siteId },
      {
        /*
         * Prioritas cito ikut di JUDUL, bukan hanya sebagai warna ikon.
         * Order mendesak yang hanya ditandai warna akan terlewat oleh
         * petugas yang membaca sambil lalu — dan pada order cito, terlewat
         * berarti pasien menunggu lebih lama daripada seharusnya.
         */
        jenis: "order_lab",
        judul:
          (cito ? "CITO — " : "") +
          `${String(pasienRows[0]?.nama ?? "Pasien")}` +
          (input.sifat_hasil === "ditunggu" ? " (ditunggu)" : ""),
        pesan:
          `${noOrder} · ${input.panels.length} panel: ` +
          input.panels.map((p) => p.nama).join(", ").slice(0, 80),
        link: `/lab/${orderId}`,
        siteId,
      },
      conn,
    );

    return { orderId, noOrder, total };
  });
}

/**
 * Ke mana pasien pergi setelah satu order lab tidak lagi berjalan.
 *
 * SATU aturan dipakai bersama oleh finalisasi hasil dan pembatalan order.
 * Dipisah jadi fungsi tersendiri bukan demi kerapian: versi sebelumnya
 * menaruh aturan ini hanya di finalisasi, dan pembatalan order meninggalkan
 * pasien terjebak di `menunggu_lab` untuk pemeriksaan yang tidak akan pernah
 * dikerjakan. Aturan alur yang ditulis dua kali cepat atau lambat berbeda.
 *
 * Harus dipanggil SETELAH status order yang bersangkutan diperbarui, dan di
 * dalam transaksi yang sama.
 */
async function statusSetelahLab(
  conn: PoolConnection,
  visitId: number,
  opts: {
    /**
     * Peristiwa pemicunya adalah HASIL yang ditunggu dokter baru saja keluar.
     * Bedanya penting: hasil yang keluar harus DIBACA dokter sebelum pasien
     * lanjut, sedangkan order yang dibatalkan tidak menghasilkan apa pun
     * untuk dibaca.
     */
    hasilDitunggu?: boolean;
  } = {},
): Promise<string> {
  /*
   * Keadaan yang TIDAK PERNAH ditarik mundur.
   *
   * `menunggu_obat` — pasien sudah membayar dan tinggal mengambil obat;
   * menariknya kembali membuatnya hilang dari daftar farmasi lalu ditagih
   * untuk kedua kalinya.
   *
   * `selesai` / `batal` — kunjungannya sudah tutup. Ini bukan kemungkinan
   * teoretis lagi sejak ada order `menyusul`: hasil kultur yang keluar tiga
   * hari kemudian memang WAJAR menemukan kunjungannya sudah lama selesai.
   * Hasilnya tetap tersimpan dan dokter tetap dinotifikasi; yang tidak boleh
   * adalah kunjungan lama hidup kembali dan muncul di worklist hari ini.
   */
  const [kini] = await conn.execute<RowDataPacket[]>(
    `SELECT status FROM visits WHERE id = ?`,
    [visitId],
  );
  const status = String(kini[0]?.status ?? "");
  if (["menunggu_obat", "selesai", "batal"].includes(status)) return status;

  /*
   * Pasien yang BELUM sampai ke dokter juga tidak dipindahkan. Order di
   * tahap ini hanya bisa berupa APS (`menyusul`) — hasilnya tidak boleh
   * melompatkan pasien melewati perawat: ia hilang dari worklist perawat,
   * pengkajiannya ditolak, dan triase/TTV/BMHP terlewat.
   */
  if (["terdaftar", "menunggu_perawat"].includes(status)) return status;

  /*
   * Hanya order DITUNGGU yang menahan pasien. Order `menyusul` boleh
   * menggantung berhari-hari tanpa membuat pasien terkurung di
   * `menunggu_lab` — itulah seluruh gunanya pembedaan ini.
   */
  const [labLain] = await conn.execute<RowDataPacket[]>(
    `SELECT 1 FROM lab_orders
      WHERE visit_id = ? AND status IN ('baru','diproses')
        AND sifat_hasil = 'ditunggu' LIMIT 1`,
    [visitId],
  );
  if (labLain.length > 0) return "menunggu_lab";

  /*
   * Kunjungan yang sedang diperiksa tetap di tangan dokter — dokter sedang
   * di dalamnya, dan mengembalikannya ke `menunggu_dokter` hanya mengacak
   * antrean. (Pemeriksaan order ditunggu di atas tetap berlaku: dokter yang
   * mengubah order jadi `ditunggu` memang memindahkan pasien ke lab.)
   */
  if (status === "dalam_pemeriksaan") return status;

  /*
   * HASIL YANG DITUNGGU SELALU KEMBALI KE DOKTER — termasuk bila asesmennya
   * sudah terlanjur final.
   *
   * Inilah yang dulu keliru: kalau asesmen sudah final, hasil lab langsung
   * dilempar ke farmasi atau kasir dan dokter tidak pernah membacanya.
   * Padahal ia sendiri yang memesannya, dan justru menyatakan hasilnya
   * ditunggu. Pemeriksaan yang hasilnya tidak pernah dibaca adalah biaya
   * yang ditagihkan tanpa manfaat klinis apa pun.
   *
   * Dokter menilai, merevisi bila perlu, lalu menekan Finalkan Asesmen —
   * itulah tombol kirim ke farmasi/kasir. Tidak ada tombol baru.
   */
  const [ass] = await conn.execute<RowDataPacket[]>(
    `SELECT status FROM medical_assessments WHERE visit_id = ?`,
    [visitId],
  );
  if (opts.hasilDitunggu || ass[0]?.status !== "final") return "menunggu_dokter";

  /*
   * `disiapkan` berarti farmasi SUDAH memvalidasi dan menghargainya — yang
   * ditunggu tinggal pembayaran, bukan pekerjaan farmasi. Mengirim pasien
   * kembali ke farmasi di keadaan itu membuatnya terjebak: farmasi tidak
   * punya apa pun untuk dikerjakan, sementara kasir tidak melihatnya karena
   * status kunjungannya bukan `menunggu_kasir`.
   */
  const [resep] = await conn.execute<RowDataPacket[]>(
    `SELECT status FROM prescriptions
      WHERE visit_id = ? AND status IN ('baru','diterima_farmasi','disiapkan')`,
    [visitId],
  );
  if (resep.some((r) => r.status !== "disiapkan")) return "menunggu_farmasi";

  // Resep sudah dihargai dan lab sudah tuntas — angka tagihannya final.
  const [bt] = await conn.execute<RowDataPacket[]>(
    `SELECT id FROM billing_transactions WHERE visit_id = ?`,
    [visitId],
  );
  if (bt[0]) {
    await conn.execute(
      `UPDATE billing_transactions SET status = 'menunggu'
        WHERE id = ? AND status = 'draft'`,
      [bt[0].id],
    );
  }
  return "menunggu_kasir";
}

/**
 * Membatalkan order lab.
 *
 * Dua pemakai yang sah: dokter yang salah memilih panel, dan petugas lab yang
 * sampelnya tidak bisa diperiksa (lisis, volume kurang, tabung pecah).
 *
 * Tiga penolakan, semuanya karena pembatalan menghapus tarifnya dari tagihan:
 *
 *   1. Sudah ada hasil yang diinput — pemeriksaannya SUDAH dikerjakan dan
 *      reagennya sudah terpakai. Yang gratis di sini adalah kerja lab.
 *   2. Tagihan kunjungan sudah lunas — menghapus baris berarti menurunkan
 *      angka pada struk yang uangnya sudah diterima.
 *   3. Order sudah selesai atau sudah batal.
 *
 * Status kunjungan ikut dimajukan bila order ini yang terakhir berjalan.
 * Tanpa itu pasien tertinggal di `menunggu_lab` menunggu pemeriksaan yang
 * sudah tidak ada — dan satu-satunya jalan keluar adalah dokter menyadari
 * sendiri bahwa ia harus memfinalkan ulang asesmennya.
 */
export async function batalkanOrderLab(
  orderId: number,
  siteId: number,
  alasan: string,
  /** Siapa yang membatalkan — dokter atau petugas lab. */
  userId: number,
  /** Nama pembatal, ikut disebut di notifikasi ke dokter. */
  dibatalkanOleh?: string,
): Promise<{ noOrder: string; visitId: number; statusKunjungan: string }> {
  return transaction(async (conn) => {
    /*
     * Kunjungan dikunci LEBIH DULU — lihat `lib/kunci.ts`. Transaksi ini
     * menyentuh tagihan lalu `statusSetelahLab()` menulis `visits`;
     * `buatOrderLab` menempuh arah sebaliknya.
     */
    const kunjunganId = await visitIdDariOrderLab(conn, orderId);
    if (kunjunganId) await kunciKunjungan(conn, kunjunganId);

    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT lo.id, lo.visit_id, lo.status, lo.no_order, lo.ordered_by,
              lo.atas_permintaan_sendiri,
              v.doctor_id, v.substitute_doctor_id,
              p.nama AS pasien, p.no_rm,
              bt.status AS billing_status
         FROM lab_orders lo
         JOIN visits v   ON v.id = lo.visit_id
         JOIN patients p ON p.id = v.patient_id
         LEFT JOIN billing_transactions bt ON bt.visit_id = lo.visit_id
        WHERE lo.id = ? AND lo.site_id = ? FOR UPDATE`,
      [orderId, siteId],
    );
    const order = rows[0];
    if (!order) throw new Error("Order lab tidak ditemukan.");
    if (order.status === "selesai") {
      throw new Error("Hasil sudah keluar — order tidak bisa dibatalkan.");
    }
    if (order.status === "batal") throw new Error("Order ini sudah dibatalkan.");

    const [adaHasil] = await conn.execute<RowDataPacket[]>(
      `SELECT 1 FROM lab_results WHERE order_id = ? LIMIT 1`,
      [orderId],
    );
    if (adaHasil.length > 0) {
      throw new Error(
        "Sudah ada hasil yang diinput untuk order ini — pemeriksaannya sudah " +
        "dikerjakan dan reagennya terpakai. Lengkapi lalu finalkan hasilnya; " +
        "penilaian atas hasil itu tetap di tangan dokter.",
      );
    }

    if (order.billing_status === "lunas") {
      throw new Error(
        "Tagihan kunjungan ini sudah lunas. Membatalkan order akan mengubah " +
        "angka pada struk yang sudah dibayar — batalkan pembayarannya di kasir " +
        "lebih dulu bila memang perlu dikoreksi.",
      );
    }

    const visitId = Number(order.visit_id);

    /*
     * Alasan pembatalan punya kolomnya sendiri, tidak lagi ditempelkan ke
     * `catatan_klinis`. Kolom itu berisi konteks klinis yang ditulis dokter
     * untuk petugas lab — mencampurinya dengan catatan administratif membuat
     * keduanya sama-sama sulit dibaca, dan ikut tercetak di lembar hasil.
     */
    await conn.execute(
      `UPDATE lab_orders
          SET status = 'batal', alasan_batal = ?, dibatalkan_by = ?, dibatalkan_at = NOW()
        WHERE id = ?`,
      [alasan.slice(0, 255), userId, orderId],
    );
    await conn.execute(
      `UPDATE lab_order_panels SET status = 'batal' WHERE order_id = ?`,
      [orderId],
    );

    // Biaya ikut dibatalkan — pemeriksaan tidak jadi dikerjakan.
    const billingId = await pastikanTagihan(conn, visitId, siteId);
    const [panels] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM lab_order_panels WHERE order_id = ?`,
      [orderId],
    );
    for (const p of panels) {
      await conn.execute(
        `DELETE FROM billing_items WHERE billing_id = ? AND ref_type = ? AND ref_id = ?`,
        [billingId, REF_LAB, p.id],
      );
    }
    await hitungUlangTagihan(conn, billingId);

    const statusKunjungan = await statusSetelahLab(conn, visitId);
    await conn.execute(`UPDATE visits SET status = ? WHERE id = ?`, [
      statusKunjungan,
      visitId,
    ]);

    /*
     * Dokter pemesan DIBERI TAHU — dan ini mendesak.
     *
     * Petugas lab yang membatalkan karena sampel lisis atau pasien menolak
     * diambil darah tahu persis apa yang terjadi; dokter tidak. Tanpa kabar
     * ini ia menunggu hasil yang tidak akan pernah datang, sementara
     * pasiennya sudah dikembalikan ke ruang periksa.
     *
     * Tidak dikirim bila yang membatalkan adalah dokter itu sendiri — orang
     * tidak perlu diberi tahu tentang perbuatannya sendiri. Order APS juga
     * dilewati: tidak ada dokter yang memesannya.
     */
    const dokterId = Number(order.substitute_doctor_id ?? order.doctor_id);
    if (Number(order.atas_permintaan_sendiri) === 0 && userId !== dokterId) {
      await kirimNotifikasi(
        { userId: dokterId },
        {
          jenis: "order_lab_batal",
          judul: `Order lab dibatalkan — ${String(order.pasien)}`,
          pesan:
            `${String(order.no_order)} · No. RM ${String(order.no_rm)} — ` +
            (dibatalkanOleh ? `dibatalkan ${dibatalkanOleh}: ` : "") +
            alasan,
          link: `/rme/${visitId}`,
          siteId,
        },
        conn,
      );
    }

    return { noOrder: String(order.no_order), visitId, statusKunjungan };
  });
}

/**
 * Mengubah sifat hasil sebuah order yang sedang berjalan.
 *
 * Dokter kadang berubah pikiran di tengah kunjungan: pemeriksaan yang tadi
 * ia niatkan ditunggu ternyata baru jadi besok, dan menahan pasien sampai
 * besok jelas tidak masuk akal. Tanpa jalan ini satu-satunya pilihan adalah
 * membatalkan order lalu memesan ulang — membuang nomor order dan, kalau
 * sampelnya sudah diambil, membuang sampelnya juga.
 *
 * Mengubah `menyusul` → `ditunggu` ikut menarik pasien kembali ke tahap lab;
 * sebaliknya melepaskannya. Keduanya lewat `statusSetelahLab()` supaya
 * aturannya tetap satu.
 */
export async function ubahSifatHasil(
  orderId: number,
  siteId: number,
  sifat: "ditunggu" | "menyusul",
): Promise<{ noOrder: string; visitId: number; statusKunjungan: string }> {
  return transaction(async (conn) => {
    /*
     * Kunjungan dikunci LEBIH DULU — lihat `lib/kunci.ts`.
     *
     * `statusSetelahLab()` menulis `visits` di ujung transaksi ini,
     * sementara `buatOrderLab` mengunci `visits` dahulu lalu membuat
     * ordernya. Tanpa baris di bawah keduanya membentuk siklus.
     */
    const kunjunganId = await visitIdDariOrderLab(conn, orderId);
    if (kunjunganId) await kunciKunjungan(conn, kunjunganId);

    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, visit_id, status, no_order, sifat_hasil FROM lab_orders
        WHERE id = ? AND site_id = ? FOR UPDATE`,
      [orderId, siteId],
    );
    const order = rows[0];
    if (!order) throw new Error("Order lab tidak ditemukan.");
    if (!["baru", "diproses"].includes(String(order.status))) {
      throw new Error(
        "Order ini sudah selesai atau dibatalkan — sifat hasilnya tidak lagi berpengaruh.",
      );
    }

    const visitId = Number(order.visit_id);
    await conn.execute(`UPDATE lab_orders SET sifat_hasil = ? WHERE id = ?`, [
      sifat, orderId,
    ]);

    const statusKunjungan = await statusSetelahLab(conn, visitId);
    await conn.execute(`UPDATE visits SET status = ? WHERE id = ?`, [
      statusKunjungan, visitId,
    ]);

    return { noOrder: String(order.no_order), visitId, statusKunjungan };
  });
}

export type KunjunganAps = RowDataPacket & {
  visit_id: number;
  antrean: string | null;
  no_rm: string;
  nama: string;
  tanggal_lahir: string;
  jenis_kelamin: "L" | "P";
  poli_nama: string;
  status: string;
};

/**
 * Kunjungan hari ini yang masih bisa dibebani pemeriksaan APS.
 *
 * Syaratnya satu: TAGIHANNYA BELUM DITUTUP. Pemeriksaan atas permintaan
 * sendiri tetap berbayar, dan menambahkannya ke kunjungan yang sudah lunas
 * berarti menaikkan angka pada struk yang sudah dicetak. Pasien yang sudah
 * membayar dan ingin menambah pemeriksaan harus didaftarkan sebagai
 * kunjungan baru — dan sejak hari ini itu memang bisa dilakukan pada hari
 * yang sama (lihat `daftarkanKunjungan`).
 */
export async function kunjunganAktifUntukAps(
  siteId: number | null,
): Promise<KunjunganAps[]> {
  return query<KunjunganAps>(
    `SELECT v.id AS visit_id, v.status,
            CONCAT(q.prefix, LPAD(q.nomor, 3, '0')) AS antrean,
            p.no_rm, p.nama, p.tanggal_lahir, p.jenis_kelamin,
            pol.nama AS poli_nama
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       JOIN polis pol  ON pol.id = v.poli_id
       LEFT JOIN queues q ON q.visit_id = v.id
       LEFT JOIN billing_transactions bt ON bt.visit_id = v.id
      WHERE v.tanggal = CURDATE()
        AND (? IS NULL OR v.site_id = ?)
        AND v.status NOT IN ('selesai','batal')
        AND (bt.id IS NULL OR bt.status NOT IN ('lunas','batal'))
      ORDER BY q.nomor`,
    [siteId, siteId],
  );
}

// ---------------------------------------------------------------------
// Worklist petugas lab
// ---------------------------------------------------------------------

export type OrderMasuk = RowDataPacket & {
  id: number;
  no_order: string;
  status: string;
  prioritas: string;
  sifat_hasil: "ditunggu" | "menyusul";
  atas_permintaan_sendiri: number;
  alasan_batal: string | null;
  ordered_at: string;
  catatan_klinis: string | null;
  visit_id: number;
  visit_status: string;
  antrean: string | null;
  no_rm: string;
  nama: string;
  tanggal_lahir: string;
  jenis_kelamin: "L" | "P";
  dokter_nama: string;
  jumlah_panel: number;
  jumlah_parameter: number;
  sudah_diisi: number;
  ada_kritis: number;
};

const SELECT_ORDER = `
  SELECT lo.id, lo.no_order, lo.status, lo.prioritas, lo.ordered_at, lo.catatan_klinis,
         lo.sifat_hasil, lo.atas_permintaan_sendiri, lo.alasan_batal,
         v.id AS visit_id, v.status AS visit_status,
         CONCAT(q.prefix, LPAD(q.nomor, 3, '0')) AS antrean,
         p.no_rm, p.nama, p.tanggal_lahir, p.jenis_kelamin,
         d.nama AS dokter_nama,
         (SELECT COUNT(*) FROM lab_order_panels lop
           WHERE lop.order_id = lo.id AND lop.status <> 'batal') AS jumlah_panel,
         (SELECT COUNT(*) FROM lab_order_panels lop
            JOIN lab_parameters lp ON lp.panel_id = lop.panel_id
            LEFT JOIN lab_results lr2
                   ON lr2.order_id = lop.order_id AND lr2.parameter_id = lp.id
           WHERE lop.order_id = lo.id AND lop.status <> 'batal'
             AND (lp.is_active = 1 OR lr2.id IS NOT NULL)) AS jumlah_parameter,
         (SELECT COUNT(*) FROM lab_results lr WHERE lr.order_id = lo.id) AS sudah_diisi,
         (SELECT COUNT(*) FROM lab_results lr
           WHERE lr.order_id = lo.id AND lr.flag IN ('LL','HH')) AS ada_kritis
    FROM lab_orders lo
    JOIN visits v   ON v.id = lo.visit_id
    JOIN patients p ON p.id = v.patient_id
    JOIN users d    ON d.id = lo.ordered_by
    LEFT JOIN queues q ON q.visit_id = v.id
`;

export async function orderMasuk(siteId: number | null): Promise<OrderMasuk[]> {
  return query<OrderMasuk>(
    `${SELECT_ORDER}
      WHERE lo.status IN ('baru','diproses')
        AND (? IS NULL OR lo.site_id = ?)
      ORDER BY FIELD(lo.prioritas,'cito','rutin'), lo.ordered_at`,
    [siteId, siteId],
  );
}

export async function orderSelesai(
  siteId: number | null,
  tanggal: string,
): Promise<OrderMasuk[]> {
  return query<OrderMasuk>(
    `${SELECT_ORDER}
      WHERE lo.status = 'selesai'
        AND DATE(lo.completed_at) = ?
        AND (? IS NULL OR lo.site_id = ?)
      ORDER BY lo.completed_at DESC`,
    [tanggal, siteId, siteId],
  );
}

export async function getOrderLab(
  orderId: number,
  siteId: number | null,
): Promise<(OrderMasuk & { site_id: number; nik: string }) | null> {
  return queryOne<OrderMasuk & { site_id: number; nik: string }>(
    `${SELECT_ORDER.replace("lo.catatan_klinis,", "lo.catatan_klinis, lo.site_id, p.nik,")}
      WHERE lo.id = ? AND (? IS NULL OR lo.site_id = ?)`,
    [orderId, siteId, siteId],
  );
}

export type ParameterOrder = RowDataPacket & {
  panel_id: number;
  panel_nama: string;
  panel_kategori: string | null;
  parameter_id: number;
  parameter_nama: string;
  satuan: string | null;
  tipe_nilai: string;
  pilihan: string[] | null;
  ref_low: string | null;
  ref_high: string | null;
  ref_teks: string | null;
  kritis_low: string | null;
  kritis_high: string | null;
  urutan: number;
  nilai_numerik: string | null;
  nilai_teks: string | null;
  flag: string | null;
  catatan: string | null;
};

export async function parameterOrder(orderId: number): Promise<ParameterOrder[]> {
  return query<ParameterOrder>(
    `SELECT lop.panel_id, lp.nama AS panel_nama, lp.kategori AS panel_kategori,
            par.id AS parameter_id, par.nama AS parameter_nama, par.satuan,
            par.tipe_nilai, par.pilihan, par.ref_low, par.ref_high, par.ref_teks,
            par.kritis_low, par.kritis_high, par.urutan,
            lr.nilai_numerik, lr.nilai_teks, lr.flag, lr.catatan
       FROM lab_order_panels lop
       JOIN lab_panels lp     ON lp.id = lop.panel_id
       JOIN lab_parameters par ON par.panel_id = lop.panel_id
       LEFT JOIN lab_results lr ON lr.order_id = lop.order_id AND lr.parameter_id = par.id
      WHERE lop.order_id = ? AND lop.status <> 'batal'
        /*
         * Parameter yang dinonaktifkan hilang dari order baru — TAPI tetap
         * tampil bila order ini sudah terlanjur punya hasilnya. Tanpa syarat
         * kedua, menonaktifkan parameter di tengah hari membuat angka yang
         * sudah diinput petugas lenyap dari layar, dan finalisasi menuntut
         * "seluruh parameter terisi" atas daftar yang diam-diam berubah.
         */
        AND (par.is_active = 1 OR lr.id IS NOT NULL)
      ORDER BY lp.kategori, lp.nama, par.urutan, par.id`,
    [orderId],
  );
}

/**
 * Menyimpan hasil pemeriksaan.
 *
 * Penanda L/H/kritis dihitung di server dari nilai rujukan yang berlaku
 * saat itu — bukan dikirim klien. Nilai rujukan juga di-snapshot ke baris
 * hasil, supaya cetakan lama tetap menampilkan rujukan yang dipakai waktu
 * itu meskipun master parameternya kemudian diubah.
 */
export async function simpanHasilLab(
  orderId: number,
  siteId: number,
  userId: number,
  input: HasilLabInput,
): Promise<{ jumlahKritis: number; selesai: boolean; statusKunjungan: string | null }> {
  return transaction(async (conn) => {
    /*
     * Kunjungan dikunci LEBIH DULU — lihat `lib/kunci.ts`.
     *
     * `statusSetelahLab()` menulis `visits` di ujung transaksi ini,
     * sementara `buatOrderLab` mengunci `visits` dahulu lalu membuat
     * ordernya. Tanpa baris di bawah keduanya membentuk siklus.
     */
    const kunjunganId = await visitIdDariOrderLab(conn, orderId);
    if (kunjunganId) await kunciKunjungan(conn, kunjunganId);

    const [orderRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, visit_id, status, site_id, no_order, sifat_hasil FROM lab_orders
        WHERE id = ? AND site_id = ? FOR UPDATE`,
      [orderId, siteId],
    );
    const order = orderRows[0];
    if (!order) throw new Error("Order lab tidak ditemukan.");
    if (order.status === "selesai") {
      throw new Error("Hasil order ini sudah difinalkan.");
    }
    if (order.status === "batal") throw new Error("Order ini sudah dibatalkan.");

    let jumlahKritis = 0;

    for (const h of input.hasil) {
      if (h.nilai === "") continue;

      const [parRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, satuan, tipe_nilai, ref_low, ref_high, ref_teks, kritis_low, kritis_high
           FROM lab_parameters WHERE id = ?`,
        [h.parameter_id],
      );
      const par = parRows[0];
      if (!par) continue;

      const numerik = par.tipe_nilai === "numerik";
      const nilaiNum = numerik ? Number(h.nilai) : null;

      const flag = hitungFlag(
        numerik && !Number.isNaN(nilaiNum) ? nilaiNum : null,
        {
          ref_low: par.ref_low === null ? null : Number(par.ref_low),
          ref_high: par.ref_high === null ? null : Number(par.ref_high),
          kritis_low: par.kritis_low === null ? null : Number(par.kritis_low),
          kritis_high: par.kritis_high === null ? null : Number(par.kritis_high),
        },
      );
      if (flag === "LL" || flag === "HH") jumlahKritis++;

      await conn.execute(
        `INSERT INTO lab_results
           (order_id, panel_id, parameter_id, nilai_numerik, nilai_teks, satuan,
            ref_teks, flag, catatan, entered_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           nilai_numerik = VALUES(nilai_numerik), nilai_teks = VALUES(nilai_teks),
           satuan = VALUES(satuan), ref_teks = VALUES(ref_teks), flag = VALUES(flag),
           catatan = VALUES(catatan), entered_by = VALUES(entered_by),
           entered_at = NOW()`,
        [
          orderId, h.panel_id, h.parameter_id,
          numerik && !Number.isNaN(nilaiNum) ? nilaiNum : null,
          numerik ? null : h.nilai,
          par.satuan ?? null, par.ref_teks ?? null, flag,
          h.catatan ?? null, userId,
        ],
      );
    }

    if (!input.finalkan) {
      await conn.execute(
        `UPDATE lab_orders SET status = 'diproses', processed_by = ? WHERE id = ?`,
        [userId, orderId],
      );
      return { jumlahKritis, selesai: false, statusKunjungan: null };
    }

    // Finalisasi menuntut seluruh parameter terisi — hasil separuh bukan hasil.
    const [belum] = await conn.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n
         FROM lab_order_panels lop
         JOIN lab_parameters par ON par.panel_id = lop.panel_id
         LEFT JOIN lab_results lr ON lr.order_id = lop.order_id AND lr.parameter_id = par.id
        WHERE lop.order_id = ? AND lop.status <> 'batal' AND lr.id IS NULL
          AND par.is_active = 1`,
      [orderId],
    );
    if (Number(belum[0].n) > 0) {
      throw new Error(
        `Masih ada ${Number(belum[0].n)} parameter yang belum diisi. Lengkapi dulu sebelum finalisasi.`,
      );
    }

    await conn.execute(
      `UPDATE lab_orders
          SET status = 'selesai', processed_by = ?, completed_at = NOW()
        WHERE id = ?`,
      [userId, orderId],
    );
    await conn.execute(
      `UPDATE lab_order_panels SET status = 'selesai' WHERE order_id = ?`,
      [orderId],
    );
    await conn.execute(
      `UPDATE lab_results SET verified_by = ?, verified_at = NOW() WHERE order_id = ?`,
      [userId, orderId],
    );

    const visitId = Number(order.visit_id);

    /*
     * Aturan ke mana pasien pergi dipakai BERSAMA dengan `batalkanOrderLab()`.
     * Order ini sudah ditandai `selesai` di atas, jadi ia tidak lagi terhitung
     * sebagai lab yang berjalan.
     */
    const statusBerikut = await statusSetelahLab(conn, visitId, {
      hasilDitunggu: String(order.sifat_hasil) === "ditunggu",
    });
    await conn.execute(`UPDATE visits SET status = ? WHERE id = ?`, [
      statusBerikut,
      visitId,
    ]);

    /*
     * Beri tahu dokter PEMESAN — bukan siaran ke peran. Order lab dibuat
     * satu dokter untuk menegakkan diagnosanya sendiri, jadi hanya ia yang
     * perlu tahu hasilnya sudah keluar.
     *
     * Nilai kritis dibedakan jenisnya dan disebut jumlahnya di judul, agar
     * terbaca tanpa membuka notifikasinya. Hasil kritis yang terlambat
     * dibaca adalah risiko klinis, bukan sekadar keterlambatan informasi.
     */
    const [pasienRows] = await conn.execute<RowDataPacket[]>(
      `SELECT p.nama, v.doctor_id, v.substitute_doctor_id
         FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.id = ?`,
      [visitId],
    );
    const pasien = pasienRows[0];
    if (pasien) {
      // Bila ada dokter pengganti, dialah yang sedang memeriksa pasien ini.
      const tujuan = Number(pasien.substitute_doctor_id ?? pasien.doctor_id);
      await kirimNotifikasi(
        { userId: tujuan },
        {
          jenis: jumlahKritis > 0 ? "hasil_lab_kritis" : "hasil_lab",
          judul:
            jumlahKritis > 0
              ? `NILAI KRITIS (${jumlahKritis}) — ${String(pasien.nama)}`
              : `Hasil lab siap — ${String(pasien.nama)}`,
          pesan: `${String(order.no_order ?? "")} selesai diperiksa.`.trim(),
          link: `/rme/${visitId}`,
          siteId,
        },
        conn,
      );
    }

    return { jumlahKritis, selesai: true, statusKunjungan: statusBerikut };
  });
}

// ---------------------------------------------------------------------
// Untuk layar dokter
// ---------------------------------------------------------------------

export type OrderRingkas = RowDataPacket & {
  id: number;
  no_order: string;
  status: string;
  prioritas: string;
  sifat_hasil: "ditunggu" | "menyusul";
  atas_permintaan_sendiri: number;
  ordered_at: string;
  completed_at: string | null;
  alasan_batal: string | null;
  dibatalkan_oleh: string | null;
  dibatalkan_at: string | null;
  panels: string;
  ada_kritis: number;
};

export async function orderLabKunjungan(visitId: number): Promise<OrderRingkas[]> {
  return query<OrderRingkas>(
    /*
     * Order BATAL ikut diambil, lengkap dengan alasan dan siapa yang
     * membatalkannya. Menghilangkannya dari layar akan membuat dokter
     * menunggu hasil yang tidak akan datang, tanpa satu pun petunjuk kenapa —
     * dan panel yang dibatalkan tetap harus terbaca di riwayat kunjungan.
     *
     * `lop.status <> 'batal'` sengaja TIDAK dipakai pada order yang batal:
     * seluruh panelnya ikut batal, sehingga daftarnya akan kosong dan barisnya
     * jadi tidak bisa dikenali.
     */
    `SELECT lo.id, lo.no_order, lo.status, lo.prioritas, lo.sifat_hasil,
            lo.atas_permintaan_sendiri, lo.ordered_at, lo.completed_at,
            lo.alasan_batal, lo.dibatalkan_at, u.nama AS dibatalkan_oleh,
            (SELECT GROUP_CONCAT(lp.nama SEPARATOR ', ')
               FROM lab_order_panels lop JOIN lab_panels lp ON lp.id = lop.panel_id
              WHERE lop.order_id = lo.id
                AND (lo.status = 'batal' OR lop.status <> 'batal')) AS panels,
            (SELECT COUNT(*) FROM lab_results lr
              WHERE lr.order_id = lo.id AND lr.flag IN ('LL','HH')) AS ada_kritis
       FROM lab_orders lo
       LEFT JOIN users u ON u.id = lo.dibatalkan_by
      WHERE lo.visit_id = ?
      ORDER BY lo.id DESC`,
    [visitId],
  );
}

export type HasilRingkas = RowDataPacket & {
  order_id: number;
  no_order: string;
  panel_nama: string;
  parameter_nama: string;
  nilai_numerik: string | null;
  nilai_teks: string | null;
  satuan: string | null;
  ref_teks: string | null;
  flag: string;
};

export async function hasilLabKunjungan(visitId: number): Promise<HasilRingkas[]> {
  return query<HasilRingkas>(
    `SELECT lr.order_id, lo.no_order, lp.nama AS panel_nama,
            par.nama AS parameter_nama, lr.nilai_numerik, lr.nilai_teks,
            lr.satuan, lr.ref_teks, lr.flag
       FROM lab_results lr
       JOIN lab_orders lo     ON lo.id = lr.order_id
       JOIN lab_panels lp     ON lp.id = lr.panel_id
       JOIN lab_parameters par ON par.id = lr.parameter_id
      WHERE lo.visit_id = ?
      ORDER BY lo.id DESC, lp.nama, par.urutan`,
    [visitId],
  );
}
