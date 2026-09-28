import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { query, queryOne, transaction } from "./db";
import { hitungUlangTagihan } from "./billing";
import { bagiTanggungan } from "./penjamin";
import { kunciKunjungan, visitIdDariTagihan } from "./kunci";
import { kirimNotifikasi } from "./notifications";
import type { PembayaranInput } from "./validations/cashier";

/**
 * MODUL KASIR — CLAUDE.md §2.1 poin 7.
 *
 * ==========================================================================
 * ATURAN YANG TIDAK BOLEH DILANGGAR:
 * Tidak satu pun query di file ini menyentuh `medical_assessments` atau
 * `assessment_diagnoses`. Diagnosa tidak "disembunyikan" di layar — ia tidak
 * pernah dikirim dari server. `billing_items.deskripsi` sudah berupa teks
 * siap cetak, jadi kasir tidak butuh referensi klinis apa pun.
 * ==========================================================================
 */

export type TagihanRow = RowDataPacket & {
  id: number;
  no_invoice: string;
  status: string;
  subtotal: string;
  diskon: string;
  pembulatan: string;
  total: string;
  dibayar: string;
  kembalian: string;
  payment_method: string | null;
  payment_ref: string | null;
  paid_at: string | null;
  created_at: string;
  visit_id: number;
  antrean: string | null;
  no_rm: string;
  nama: string;
  tanggal_lahir: string;
  jenis_kelamin: "L" | "P";
  cara_bayar: string;
  /* Pembagian tanggungan; `payer_nama` NULL bila pasien membayar sendiri. */
  payer_id: number | null;
  payer_nama: string | null;
  payer_jenis: string | null;
  tanggung_penjamin: string;
  tanggung_pasien: string;
  no_anggota: string | null;
  poli_nama: string;
  dokter_nama: string;
  kasir_nama: string | null;
};

// Perhatikan: JOIN hanya ke visits, patients, polis, users. Tidak ada
// medical_assessments di sini, dan tidak boleh ditambahkan.
const SELECT_TAGIHAN = `
  SELECT bt.id, bt.no_invoice, bt.status, bt.subtotal, bt.diskon, bt.pembulatan,
         bt.total, bt.dibayar, bt.kembalian, bt.payment_method, bt.payment_ref,
         bt.paid_at, bt.created_at,
         v.id AS visit_id, v.cara_bayar, v.no_anggota,
         bt.payer_id, pay.nama AS payer_nama, pay.jenis AS payer_jenis,
         bt.tanggung_penjamin, bt.tanggung_pasien,
         CONCAT(q.prefix, LPAD(q.nomor, 3, '0')) AS antrean,
         p.no_rm, p.nama, p.tanggal_lahir, p.jenis_kelamin,
         pol.nama AS poli_nama,
         COALESCE(sub.nama, d.nama) AS dokter_nama,
         k.nama AS kasir_nama
    FROM billing_transactions bt
    JOIN visits v   ON v.id = bt.visit_id
    JOIN patients p ON p.id = v.patient_id
    JOIN polis pol  ON pol.id = v.poli_id
    JOIN users d    ON d.id = v.doctor_id
    LEFT JOIN users sub ON sub.id = v.substitute_doctor_id
    LEFT JOIN queues q  ON q.visit_id = v.id
    LEFT JOIN users k   ON k.id = bt.cashier_id
    LEFT JOIN payers pay ON pay.id = bt.payer_id
`;

/** Tagihan yang siap dibayar: pasien sudah selesai di semua unit layanan. */
export async function tagihanMenunggu(siteId: number | null): Promise<TagihanRow[]> {
  return query<TagihanRow>(
    `${SELECT_TAGIHAN}
      WHERE bt.status IN ('draft','menunggu')
        AND v.status = 'menunggu_kasir'
        AND (? IS NULL OR bt.site_id = ?)
      ORDER BY q.nomor`,
    [siteId, siteId],
  );
}

/**
 * Tagihan yang belum boleh dibayar karena pasien masih di unit lain.
 * Ditampilkan terpisah supaya kasir tahu antreannya akan datang, tanpa
 * bisa memprosesnya lebih dulu.
 */
export async function tagihanBelumSiap(siteId: number | null): Promise<TagihanRow[]> {
  return query<TagihanRow>(
    `${SELECT_TAGIHAN}
      WHERE bt.status IN ('draft','menunggu')
        AND v.status NOT IN ('menunggu_kasir','selesai','batal')
        AND (? IS NULL OR bt.site_id = ?)
      ORDER BY q.nomor`,
    [siteId, siteId],
  );
}

export async function riwayatTransaksi(
  siteId: number | null,
  tanggal: string,
): Promise<TagihanRow[]> {
  return query<TagihanRow>(
    `${SELECT_TAGIHAN}
      WHERE bt.status IN ('lunas','batal')
        AND DATE(bt.paid_at) = ?
        AND (? IS NULL OR bt.site_id = ?)
      ORDER BY bt.paid_at DESC`,
    [tanggal, siteId, siteId],
  );
}

export async function getTagihan(
  billingId: number,
  siteId: number | null,
): Promise<(TagihanRow & { site_id: number; visit_status: string }) | null> {
  return queryOne<TagihanRow & { site_id: number; visit_status: string }>(
    `${SELECT_TAGIHAN.replace("bt.created_at,", "bt.created_at, bt.site_id, v.status AS visit_status,")}
      WHERE bt.id = ? AND (? IS NULL OR bt.site_id = ?)`,
    [billingId, siteId, siteId],
  );
}

export type BarisTagihan = RowDataPacket & {
  id: number;
  kategori: string;
  deskripsi: string;
  qty: string;
  harga_satuan: string;
  diskon: string;
  subtotal: string;
};

export async function rincianTagihan(billingId: number): Promise<BarisTagihan[]> {
  return query<BarisTagihan>(
    `SELECT id, kategori, deskripsi, qty, harga_satuan, diskon, subtotal
       FROM billing_items
      WHERE billing_id = ?
      ORDER BY FIELD(kategori,'jasa_dokter','tindakan','laboratorium','bmhp',
                     'obat','racikan','jasa_racik','administrasi','lainnya'), id`,
    [billingId],
  );
}

// Label ada di modul netral agar Client Component tidak ikut menarik mysql2.
export { KATEGORI_LABEL } from "./billing-labels";

// ---------------------------------------------------------------------
// Shift kasir
// ---------------------------------------------------------------------

export type Shift = RowDataPacket & {
  id: number;
  dibuka_at: string;
  ditutup_at: string | null;
  kas_awal: string;
  kas_akhir_sistem: string;
  kas_akhir_fisik: string | null;
  selisih: string | null;
  catatan: string | null;
};

export async function shiftAktif(
  siteId: number,
  cashierId: number,
): Promise<Shift | null> {
  return queryOne<Shift>(
    `SELECT * FROM cashier_shifts
      WHERE site_id = ? AND cashier_id = ? AND ditutup_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [siteId, cashierId],
  );
}

export async function bukaShift(
  siteId: number,
  cashierId: number,
  kasAwal: number,
): Promise<number> {
  return transaction(async (conn) => {
    /*
     * Pembacaan biasa, BUKAN `FOR UPDATE`.
     *
     * Predikatnya tidak unik (`ditutup_at IS NULL`), sehingga penguncian di
     * sini mengambil kunci rentang beserta gap-nya — dan `INSERT` shift
     * kasir lain menabraknya. Terbukti 11 dari 12 percobaan pada
     * `uji-konkurensi.ts` §7, padahal kedua kasir tidak berbagi data apa pun.
     *
     * Penjagaan ini memang bersifat penasihat: yang dicegah adalah SATU
     * kasir membuka dua shift, dan itu sudah dijaga tombol yang mengunci
     * dirinya saat diproses. Deadlock antar-kasir jauh lebih mahal daripada
     * kemungkinan teoretis satu orang menekan tombol dua kali dalam
     * milidetik yang sama.
     */
    const [ada] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM cashier_shifts
        WHERE site_id = ? AND cashier_id = ? AND ditutup_at IS NULL`,
      [siteId, cashierId],
    );
    if (ada[0]) throw new Error("Anda masih punya shift yang belum ditutup.");

    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO cashier_shifts (site_id, cashier_id, kas_awal) VALUES (?,?,?)`,
      [siteId, cashierId, kasAwal],
    );
    return res.insertId;
  });
}

/**
 * Menutup shift. Kas yang diharapkan dihitung dari transaksi TUNAI saja —
 * QRIS, transfer, dan kartu tidak menambah uang di laci.
 */
export async function tutupShift(
  shiftId: number,
  siteId: number,
  /** Kasir yang menutup — hanya boleh menutup shift MILIKNYA sendiri. */
  cashierId: number,
  kasFisik: number,
  catatan?: string | null,
): Promise<{ kasSistem: number; selisih: number }> {
  return transaction(async (conn) => {
    /*
     * `cashier_id` ikut disaring: id shift datang dari klien, dan tanpa
     * saringan ini kasir mana pun di cabang bisa menutup shift rekannya
     * dengan angka kas fisik karangan — selisihnya tercatat atas nama orang
     * lain, dan pembayaran berikutnya diam-diam membuka shift baru kas 0.
     */
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, kas_awal, ditutup_at FROM cashier_shifts
        WHERE id = ? AND site_id = ? AND cashier_id = ? FOR UPDATE`,
      [shiftId, siteId, cashierId],
    );
    const shift = rows[0];
    if (!shift) throw new Error("Shift tidak ditemukan.");
    if (shift.ditutup_at) throw new Error("Shift ini sudah ditutup.");

    /*
     * Yang dihitung adalah UANG YANG BENAR-BENAR MASUK LACI, bukan nilai
     * tagihannya: `dibayar - kembalian`.
     *
     * Sebelumnya kolomnya `SUM(total)`. Itu benar selama setiap pasien
     * membayar seluruh tagihannya sendiri — dan langsung salah begitu ada
     * penjamin. Pasien berplafon yang tagihannya 153.000 tetapi hanya
     * menyetor 53.000 tercatat sebagai 153.000, sehingga kas sistem lebih
     * besar 100.000 daripada yang ada di laci. Kasir menutup shift dengan
     * selisih minus yang tidak bisa dijelaskannya, setiap hari.
     */
    const [tunai] = await conn.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(dibayar - kembalian), 0) AS n FROM billing_transactions
        WHERE shift_id = ? AND status = 'lunas' AND payment_method = 'tunai'`,
      [shiftId],
    );

    const kasSistem = Number(shift.kas_awal) + Number(tunai[0].n);
    const selisih = kasFisik - kasSistem;

    await conn.execute(
      `UPDATE cashier_shifts
          SET ditutup_at = NOW(), kas_akhir_sistem = ?, kas_akhir_fisik = ?,
              selisih = ?, catatan = ?
        WHERE id = ?`,
      [kasSistem, kasFisik, selisih, catatan ?? null, shiftId],
    );

    return { kasSistem, selisih };
  });
}

export type RingkasanShift = {
  metode: string;
  jumlah: number;
  total: number;
};

/**
 * Rekap per metode bayar untuk lembar tutup kasir.
 *
 * Angkanya adalah yang DITERIMA lewat metode itu (`dibayar - kembalian`),
 * bukan nilai tagihannya — alasan yang sama dengan `tutupShift()`. Rekap
 * yang memakai `total` akan membuat baris "Tunai" pada lembar tutup kasir
 * tidak pernah cocok dengan uang yang dihitung.
 */
export async function ringkasanShift(shiftId: number): Promise<RingkasanShift[]> {
  const rows = await query<RowDataPacket & { payment_method: string; n: number; total: string }>(
    `SELECT payment_method, COUNT(*) AS n,
            COALESCE(SUM(dibayar - kembalian),0) AS total
       FROM billing_transactions
      WHERE shift_id = ? AND status = 'lunas'
      GROUP BY payment_method`,
    [shiftId],
  );
  return rows.map((r) => ({
    metode: r.payment_method,
    jumlah: Number(r.n),
    total: Number(r.total),
  }));
}

// ---------------------------------------------------------------------
// Pembayaran
// ---------------------------------------------------------------------

/**
 * Memproses pembayaran dan menutup kunjungan.
 *
 * Total dihitung ULANG dari `billing_items` di dalam transaksi ini —
 * tidak dipercayakan pada nilai yang dikirim klien. Kalau apotek menambah
 * baris tepat sebelum kasir menekan bayar, yang dipakai adalah nilai
 * terbaru, bukan yang tampil di layar kasir beberapa detik lalu.
 */
export async function prosesPembayaran(
  billingId: number,
  siteId: number,
  cashierId: number,
  shiftId: number | null,
  input: PembayaranInput,
  pembulatanKe: number,
): Promise<{ total: number; kembalian: number; noInvoice: string }> {
  return transaction(async (conn) => {
    /*
     * Kunjungan dikunci LEBIH DULU — lihat `lib/kunci.ts`.
     *
     * Transaksi ini kelak menulis `visits`, sementara `simpanAsesmen`,
     * `simpanPengkajian`, dan `buatOrderLab` mengunci `visits` dahulu lalu
     * meminta tagihannya. Tanpa baris di bawah, kedua arah itu membentuk
     * siklus dan MySQL melempar deadlock — sudah terbukti terjadi.
     *
     * Id kunjungannya dicari lewat pembacaan biasa yang tidak mengambil
     * kunci apa pun, jadi urutan yang sedang ditegakkan tetap utuh.
     */
    const visitId = await visitIdDariTagihan(conn, billingId);
    if (visitId) await kunciKunjungan(conn, visitId);

    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT bt.id, bt.no_invoice, bt.status, bt.visit_id, bt.payer_id,
              v.status AS visit_status,
              p.nama AS payer_nama, p.plafon_per_kunjungan
         FROM billing_transactions bt
         JOIN visits v ON v.id = bt.visit_id
         LEFT JOIN payers p ON p.id = bt.payer_id
        WHERE bt.id = ? AND bt.site_id = ? FOR UPDATE`,
      [billingId, siteId],
    );
    const bt = rows[0];
    if (!bt) throw new Error("Tagihan tidak ditemukan.");
    if (bt.status === "lunas") throw new Error("Tagihan ini sudah lunas.");
    if (bt.status === "batal") throw new Error("Tagihan ini sudah dibatalkan.");
    if (bt.visit_status !== "menunggu_kasir") {
      throw new Error(
        "Pasien belum selesai di unit layanan lain — tagihan belum bisa diproses.",
      );
    }

    /*
     * Shift dibaca ULANG dengan kunci di dalam transaksi ini. Pemanggil
     * mengambil shift aktif di luar transaksi; bila shift itu ditutup dari
     * tab lain di sela-selanya, pembayaran tunai akan menempel ke shift
     * yang kasnya sudah dihitung — hilang dari laporan penutupan dan tidak
     * bisa dibatalkan lagi.
     */
    if (shiftId !== null) {
      const [sh] = await conn.execute<RowDataPacket[]>(
        `SELECT ditutup_at FROM cashier_shifts
          WHERE id = ? AND site_id = ? AND cashier_id = ? FOR UPDATE`,
        [shiftId, siteId, cashierId],
      );
      if (!sh[0] || sh[0].ditutup_at) {
        throw new Error("Shift kasir baru saja ditutup. Muat ulang halaman lalu ulangi pembayaran.");
      }
    }

    // Subtotal dari sumbernya, bukan dari layar.
    const [rincian] = await conn.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(subtotal),0) AS n FROM billing_items WHERE billing_id = ?`,
      [billingId],
    );
    const subtotal = Number(rincian[0].n);

    if (input.diskon > subtotal) {
      throw new Error("Diskon tidak boleh melebihi subtotal tagihan.");
    }

    const setelahDiskon = subtotal - input.diskon;
    // Pembulatan ke bawah agar pasien tidak pernah membayar lebih dari
    // yang tertera pada rincian.
    const pembulatan =
      pembulatanKe > 1
        ? -(setelahDiskon % pembulatanKe)
        : 0;
    const total = setelahDiskon + pembulatan;

    /*
     * Yang ditagih ke PASIEN hanya bagiannya.
     *
     * Pembagian dihitung di sini dari `bagiTanggungan()` — sumber tunggal
     * aturannya — bukan dibaca dari kolom yang sudah tersimpan. Alasannya:
     * `diskon` dan `pembulatan` baru ditetapkan pada detik ini, sehingga
     * total yang jadi dasar pembagian belum tentu sama dengan total saat
     * baris biaya terakhir masuk.
     */
    const { penjamin: tanggungPenjamin, pasien: tanggungPasien } = bagiTanggungan(
      total,
      bt.payer_id ? Number(bt.plafon_per_kunjungan ?? 0) : -1,
    );

    /*
     * Pasien yang tidak menanggung apa pun tidak boleh dicatat "tunai
     * Rp 0" — struk dan laporan metode bayar akan menghitungnya sebagai
     * transaksi kas yang tidak pernah terjadi. Metodenya dipaksa
     * `penjamin`, dan itu pula yang tercetak di struknya.
     */
    const metode = tanggungPasien === 0 ? "penjamin" : input.payment_method;
    if (tanggungPasien > 0 && metode === "penjamin") {
      throw new Error(
        `Pasien masih menanggung ${tanggungPasien} (di atas plafon ${bt.payer_nama ?? "penjamin"}). ` +
          "Pilih metode pembayaran untuk bagian pasien.",
      );
    }

    /*
     * "BPJS" sebagai cara bayar bagian PASIEN berarti tidak ada uang yang
     * masuk dan tidak ada klaim yang bisa dibuat (tagihannya tanpa
     * penjamin) — pendapatannya lenyap. Pasien BPJS didaftarkan dengan
     * penjamin BPJS, sehingga bagiannya otomatis tertanggung.
     */
    if (tanggungPasien > 0 && metode === "bpjs") {
      throw new Error(
        "Bagian pasien tidak bisa dibayar dengan BPJS. Daftarkan kunjungan dengan penjamin BPJS, " +
          "atau pilih metode pembayaran lain.",
      );
    }

    const tunai = metode === "tunai";
    const dibayar = tunai ? input.dibayar : tanggungPasien;

    if (tunai && dibayar < tanggungPasien) {
      throw new Error("Uang yang diterima kurang dari bagian yang harus dibayar pasien.");
    }

    const kembalian = tunai ? dibayar - tanggungPasien : 0;

    await conn.execute(
      `UPDATE billing_transactions
          SET subtotal = ?, diskon = ?, pembulatan = ?, total = ?,
              tanggung_penjamin = ?, tanggung_pasien = ?,
              dibayar = ?, kembalian = ?, payment_method = ?, payment_ref = ?,
              status = 'lunas', cashier_id = ?, shift_id = ?, paid_at = NOW()
        WHERE id = ?`,
      [
        subtotal, input.diskon, pembulatan, total,
        tanggungPenjamin, tanggungPasien,
        dibayar, kembalian, metode, input.payment_ref ?? null,
        cashierId, shiftId, billingId,
      ],
    );

    /*
     * Kunjungan BELUM tentu selesai di sini.
     *
     * Sejak pasien membayar sebelum menerima obat, kasir bukan lagi ujung
     * alurnya: pasien masih harus mengambil obat di farmasi. Yang menutup
     * kunjungan adalah `serahkanResep()`. Menandainya selesai di sini akan
     * membuat pasien hilang dari layar farmasi dengan obat yang belum
     * pernah diambil — dan stoknya tetap terkunci selamanya.
     */
    const [resepBelumDiambil] = await conn.execute<RowDataPacket[]>(
      `SELECT 1 FROM prescriptions
        WHERE visit_id = ? AND status IN ('baru','diterima_farmasi','disiapkan')
        LIMIT 1`,
      [bt.visit_id],
    );
    const keFarmasi = resepBelumDiambil.length > 0;

    await conn.execute(
      keFarmasi
        ? `UPDATE visits SET status = 'menunggu_obat' WHERE id = ?`
        : `UPDATE visits SET status = 'selesai', selesai_at = NOW() WHERE id = ?`,
      [bt.visit_id],
    );
    if (!keFarmasi) {
      await conn.execute(
        `UPDATE queues SET status = 'selesai' WHERE visit_id = ?`,
        [bt.visit_id],
      );
    }

    if (keFarmasi) {
      const [p] = await conn.execute<RowDataPacket[]>(
        `SELECT p.nama, p.no_rm FROM visits v
           JOIN patients p ON p.id = v.patient_id WHERE v.id = ?`,
        [bt.visit_id],
      );
      await kirimNotifikasi(
        { roleCode: "farmasi", siteId },
        {
          jenis: "obat_siap",
          judul: `Lunas — obat bisa diserahkan: ${String(p[0]?.nama ?? "Pasien")}`,
          pesan: `No. RM ${String(p[0]?.no_rm ?? "-")} · ${String(bt.no_invoice)} sudah dibayar`,
          link: `/farmasi`,
          siteId,
        },
        conn,
      );
    }

    return { total, kembalian, noInvoice: String(bt.no_invoice) };
  });
}

/**
 * Apakah pembayaran tagihan ini masih boleh dibatalkan — dan bila tidak,
 * mengapa.
 *
 * Dipakai layar kasir untuk memutuskan menampilkan tombolnya atau
 * menampilkan sebabnya. Penjagaan yang sebenarnya tetap ada di
 * `batalkanPembayaran()`; ini hanya supaya kasir tidak menekan tombol yang
 * sudah pasti ditolak, lalu menebak-nebak alasannya di depan pasien.
 */
export async function alasanTakBolehBatal(
  billingId: number,
  siteId: number | null,
): Promise<string | null> {
  const row = await queryOne<RowDataPacket & {
    status: string; ditutup_at: string | null; no_resep_diserahkan: string | null;
    no_klaim: string | null;
  }>(
    `SELECT bt.status, cs.ditutup_at,
            (SELECT rx.no_resep FROM prescriptions rx
              WHERE rx.visit_id = bt.visit_id AND rx.status = 'diserahkan'
              LIMIT 1) AS no_resep_diserahkan,
            (SELECT c.no_klaim FROM claim_items ci JOIN claims c ON c.id = ci.claim_id
              WHERE ci.billing_aktif = bt.id LIMIT 1) AS no_klaim
       FROM billing_transactions bt
       LEFT JOIN cashier_shifts cs ON cs.id = bt.shift_id
      WHERE bt.id = ? AND (? IS NULL OR bt.site_id = ?)`,
    [billingId, siteId, siteId],
  );
  if (!row) return "Tagihan tidak ditemukan.";
  if (row.status !== "lunas") return "Tagihan ini belum dibayar.";
  if (row.no_resep_diserahkan) {
    return `Obat resep ${row.no_resep_diserahkan} sudah diserahkan ke pasien — koreksinya lewat retur obat.`;
  }
  if (row.ditutup_at) {
    return "Shift kasir yang memproses pembayaran ini sudah ditutup dan kasnya sudah dihitung.";
  }
  if (row.no_klaim) {
    return `Tagihan ini sedang diklaim di ${row.no_klaim} — batalkan atau keluarkan dari klaim lebih dulu.`;
  }
  return null;
}

/**
 * MEMBATALKAN PEMBAYARAN yang sudah terlanjur diproses.
 *
 * Kebutuhan nyata di meja kasir: salah metode bayar, salah nominal diskon,
 * atau pasien membatalkan setelah struk tercetak. Yang dilakukan bukan
 * menandai tagihan `batal` melainkan MENGEMBALIKANNYA ke `menunggu` — satu
 * kunjungan hanya boleh punya satu tagihan (`uq_bt_visit`), sehingga status
 * `batal` bersifat final dan akan menutup kunjungan itu dari penagihan
 * selamanya. Yang dibutuhkan justru sebaliknya: menagih ulang dengan benar.
 *
 * Tiga hal ditolak, dan ketiganya karena membalikkannya diam-diam merusak
 * sesuatu yang sudah terjadi di dunia nyata:
 *
 *   1. Obat sudah diserahkan — barang sudah keluar gudang. Koreksinya retur
 *      obat, bukan pembatalan bayar.
 *   2. Shift kasirnya sudah ditutup — kas fisik sudah dihitung dan
 *      selisihnya ditandatangani. Membatalkan transaksi di dalamnya membuat
 *      laporan shift berselisih dengan angka penutupan yang tersimpan.
 *   3. Tagihannya belum lunas — tidak ada pembayaran untuk dibatalkan.
 */
export async function batalkanPembayaran(
  billingId: number,
  siteId: number,
  alasan: string,
): Promise<{ noInvoice: string; total: number }> {
  return transaction(async (conn) => {
    /*
     * Kunjungan dikunci LEBIH DULU — lihat `lib/kunci.ts`.
     *
     * Transaksi ini kelak menulis `visits`, sementara `simpanAsesmen`,
     * `simpanPengkajian`, dan `buatOrderLab` mengunci `visits` dahulu lalu
     * meminta tagihannya. Tanpa baris di bawah, kedua arah itu membentuk
     * siklus dan MySQL melempar deadlock — sudah terbukti terjadi.
     *
     * Id kunjungannya dicari lewat pembacaan biasa yang tidak mengambil
     * kunci apa pun, jadi urutan yang sedang ditegakkan tetap utuh.
     */
    const visitId = await visitIdDariTagihan(conn, billingId);
    if (visitId) await kunciKunjungan(conn, visitId);

    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT bt.id, bt.no_invoice, bt.status, bt.total, bt.visit_id, bt.shift_id,
              v.status AS visit_status, cs.ditutup_at
         FROM billing_transactions bt
         JOIN visits v ON v.id = bt.visit_id
         LEFT JOIN cashier_shifts cs ON cs.id = bt.shift_id
        WHERE bt.id = ? AND bt.site_id = ? FOR UPDATE`,
      [billingId, siteId],
    );
    const bt = rows[0];
    if (!bt) throw new Error("Tagihan tidak ditemukan.");
    if (bt.status !== "lunas") {
      throw new Error(
        "Tagihan ini belum dibayar — tidak ada pembayaran yang perlu dibatalkan.",
      );
    }

    const [diserahkan] = await conn.execute<RowDataPacket[]>(
      `SELECT no_resep FROM prescriptions
        WHERE visit_id = ? AND status = 'diserahkan' LIMIT 1`,
      [bt.visit_id],
    );
    /*
     * Tagihan yang sedang diklaim ke penjamin tidak boleh dibuka lagi: klaim
     * membawa nilai yang diajukan dari tagihan ini, dan membayarnya ulang
     * (mis. dengan diskon lain) membuat klaim berselisih dengan tagihannya —
     * atau berakhir mengklaim tagihan yang kunjungannya dibatalkan.
     */
    const [diklaim] = await conn.execute<RowDataPacket[]>(
      `SELECT c.no_klaim FROM claim_items ci JOIN claims c ON c.id = ci.claim_id
        WHERE ci.billing_aktif = ? LIMIT 1`,
      [billingId],
    );
    if (diklaim[0]) {
      throw new Error(
        `Tagihan ini sedang diklaim di ${String(diklaim[0].no_klaim)}. ` +
        "Batalkan klaimnya lebih dulu sebelum membatalkan pembayaran.",
      );
    }

    if (diserahkan[0]) {
      throw new Error(
        `Obat resep ${String(diserahkan[0].no_resep)} sudah diserahkan ke pasien. ` +
        "Pembayaran tidak bisa dibatalkan karena barangnya sudah keluar gudang — " +
        "koreksinya lewat retur obat.",
      );
    }

    if (bt.ditutup_at) {
      throw new Error(
        "Shift kasir yang memproses pembayaran ini sudah ditutup dan kasnya " +
        "sudah dihitung. Pembatalan akan membuat laporan shift berselisih — " +
        "catat sebagai koreksi terpisah bersama penanggung jawab kas.",
      );
    }

    /*
     * Diskon dan pembulatan ikut dinolkan: keduanya keputusan kasir pada saat
     * membayar, bukan bagian dari tagihannya. Membiarkannya berarti diskon
     * yang sama terpasang diam-diam pada penagihan berikutnya.
     */
    await conn.execute(
      `UPDATE billing_transactions
          SET status = 'menunggu', dibayar = 0, kembalian = 0,
              diskon = 0, pembulatan = 0,
              payment_method = NULL, payment_ref = NULL,
              paid_at = NULL, cashier_id = NULL, shift_id = NULL,
              alasan_batal = ?
        WHERE id = ?`,
      [alasan.slice(0, 255), billingId],
    );
    const { total } = await hitungUlangTagihan(conn, billingId);

    // Pasien kembali ke antrean kasir, dari mana pun ia sudah terlanjur maju.
    await conn.execute(
      `UPDATE visits SET status = 'menunggu_kasir', selesai_at = NULL WHERE id = ?`,
      [bt.visit_id],
    );
    await conn.execute(
      `UPDATE queues SET status = 'dilayani' WHERE visit_id = ? AND status = 'selesai'`,
      [bt.visit_id],
    );

    /*
     * Farmasi WAJIB diberi tahu. Bila kunjungan tadi berstatus
     * `menunggu_obat`, apoteker sedang bersiap menyerahkan obat atas dasar
     * tagihan yang barusan tidak lagi lunas. `serahkanResep()` memang akan
     * menolaknya, tetapi penolakan mendadak di depan pasien bukan cara yang
     * benar untuk menyampaikan kabar ini.
     */
    if (bt.visit_status === "menunggu_obat") {
      const [p] = await conn.execute<RowDataPacket[]>(
        `SELECT p.nama, p.no_rm FROM visits v
           JOIN patients p ON p.id = v.patient_id WHERE v.id = ?`,
        [bt.visit_id],
      );
      await kirimNotifikasi(
        { roleCode: "farmasi", siteId },
        {
          jenis: "obat_siap",
          judul: `Pembayaran dibatalkan — ${String(p[0]?.nama ?? "Pasien")}`,
          pesan:
            `No. RM ${String(p[0]?.no_rm ?? "-")} · ${String(bt.no_invoice)} ` +
            `kembali ke kasir. JANGAN serahkan obatnya dulu — ${alasan}`,
          link: `/farmasi`,
          siteId,
        },
        conn,
      );
    }

    return { noInvoice: String(bt.no_invoice), total };
  });
}
