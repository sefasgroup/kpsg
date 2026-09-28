import "server-only";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

/**
 * URUTAN PENGAMBILAN KUNCI BARIS — satu aturan untuk seluruh sistem.
 *
 * MASALAH YANG DITUTUP MODUL INI
 *
 * Deadlock InnoDB tidak lahir dari satu transaksi yang salah, melainkan
 * dari dua transaksi yang masing-masing benar tetapi mengambil kunci yang
 * sama dalam urutan berbeda. Empat siklus seperti itu ada di sistem ini dan
 * SUDAH TERBUKTI melempar `ER_LOCK_DEADLOCK` (errno 1213) saat dicoba:
 *
 *   | Siklus | Satu sisi | Sisi lain |
 *   |---|---|---|
 *   | `visits` ↔ `billing_transactions` | `simpanAsesmen`: visits → billing | `prosesPembayaran`: billing → visits |
 *   | `visits` ↔ `prescriptions` | `simpanResep`: visits → prescriptions | `serahkanResep`: prescriptions → visits |
 *   | `visits` ↔ `lab_orders` | `buatOrderLab`: visits → lab | `simpanHasilLab`: lab → visits |
 *   | `item_stocks` ↔ `item_stocks` | resep [A,B] | resep [B,A] |
 *
 * Yang terakhir paling sering terjadi di klinik sibuk: dua resep divalidasi
 * bersamaan dan berbagi dua obat yang sama dengan urutan berbeda di
 * masing-masing resep. Tidak ada yang salah pada kodenya; yang salah adalah
 * urutannya tidak ditentukan siapa pun.
 *
 * ATURANNYA
 *
 *   1. visits
 *   2. prescriptions · lab_orders            (dokumen anak kunjungan)
 *   3. billing_transactions · billing_items
 *   4. item_stocks · item_batches            (diurutkan menurut item_id)
 *   5. sequences                             (paling akhir, paling singkat)
 *
 * Urutannya mengikuti alur pasien, bukan urutan yang paling nyaman ditulis:
 * `visits` adalah poros seluruh sistem (docs/DATABASE.md §3.1), jadi apa pun
 * yang kelak menyentuh kunjungan harus menguncinya LEBIH DULU — meski id
 * kunjungannya sendiri baru diketahui setelah membaca tabel lain.
 *
 * Membaca tanpa `FOR UPDATE` tidak mengambil kunci sama sekali (InnoDB
 * REPEATABLE READ memakai snapshot), jadi mencari `visit_id` lewat
 * pembacaan biasa lalu menguncinya tidak memperkenalkan siklus baru.
 */

/**
 * Mengunci baris kunjungan — SELALU pernyataan pertama dalam transaksi yang
 * kelak menyentuh `visits`, langsung maupun lewat helper.
 *
 * Mengembalikan status kunjungannya sekalian, karena hampir setiap
 * pemanggil membutuhkannya untuk penjagaan berikutnya.
 */
export async function kunciKunjungan(
  conn: PoolConnection,
  visitId: number,
): Promise<{ id: number; status: string; site_id: number } | null> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT id, status, site_id FROM visits WHERE id = ? FOR UPDATE`,
    [visitId],
  );
  const v = rows[0];
  return v
    ? { id: Number(v.id), status: String(v.status), site_id: Number(v.site_id) }
    : null;
}

/**
 * Mencari id kunjungan dari sebuah resep TANPA mengunci resepnya.
 *
 * Dipakai pada awal transaksi farmasi: kunjungannya harus dikunci lebih
 * dulu, sementara id-nya baru diketahui dari resep. Pembacaan snapshot ini
 * tidak mengambil kunci, jadi ia tidak melanggar urutan yang sedang
 * ditegakkan.
 */
export async function visitIdDariResep(
  conn: PoolConnection,
  prescriptionId: number,
): Promise<number | null> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT visit_id FROM prescriptions WHERE id = ?`,
    [prescriptionId],
  );
  return rows[0] ? Number(rows[0].visit_id) : null;
}

/** Sama, dari sebuah order lab. */
export async function visitIdDariOrderLab(
  conn: PoolConnection,
  orderId: number,
): Promise<number | null> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT visit_id FROM lab_orders WHERE id = ?`,
    [orderId],
  );
  return rows[0] ? Number(rows[0].visit_id) : null;
}

/** Sama, dari sebuah tagihan. */
export async function visitIdDariTagihan(
  conn: PoolConnection,
  billingId: number,
): Promise<number | null> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT visit_id FROM billing_transactions WHERE id = ?`,
    [billingId],
  );
  return rows[0] ? Number(rows[0].visit_id) : null;
}

/**
 * Mengunci baris `item_stocks` untuk sekumpulan item, SELALU menurut
 * `item_id` menaik.
 *
 * Inilah penutup siklus keempat, dan cara kerjanya perlu dieja.
 *
 * Urutannya memakai `item_id`, bukan nama: id tidak pernah berubah,
 * sedangkan nama bisa disunting di master data dan mengubah urutan tanpa
 * ada yang menyadarinya.
 *
 * `validasiResep()` dan `serahkanResep()` menyusuri item resep menurut
 * `urutan` — urutan yang DIKETIK DOKTER. Dua resep yang berbagi obat A dan
 * B karena itu bisa mengambil kunci dengan urutan berlawanan, dan MySQL
 * membunuh salah satunya. Di klinik sibuk ini bukan kemungkinan teoretis:
 * dua resep divalidasi bersamaan sepanjang hari, dan katalog obat yang
 * dipakai sebagian besar resep memang sempit.
 *
 * Perbaikannya TIDAK mengubah urutan penyusuran — struk, etiket, dan baris
 * tagihan tetap mengikuti urutan dokter. Yang dilakukan hanyalah mengambil
 * seluruh kuncinya lebih dulu dalam urutan yang pasti; sesudah itu loop di
 * bawahnya bebas berjalan dengan urutan apa pun, karena kuncinya sudah
 * dipegang transaksi ini.
 *
 * `INSERT … ON DUPLICATE KEY UPDATE site_id = site_id` dipakai — bukan
 * `SELECT … FOR UPDATE` — karena baris saldo bisa belum ada. Mengunci baris
 * yang tidak ada menghasilkan *gap lock*, yang justru melahirkan deadlock
 * jenis lain. Mekanisme yang sama sudah dipakai `tambahStok()` dan
 * `kurangiStok()` untuk memastikan barisnya ada.
 */
export async function kunciStok(
  conn: PoolConnection,
  siteId: number,
  itemIds: number[],
): Promise<void> {
  const urut = [...new Set(itemIds.map(Number))]
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
  if (urut.length === 0) return;

  await conn.execute(
    `INSERT INTO item_stocks (site_id, item_id, qty_on_hand)
     VALUES ${urut.map(() => "(?,?,0)").join(",")}
     ON DUPLICATE KEY UPDATE site_id = site_id`,
    urut.flatMap((id) => [siteId, id]),
  );
}

/**
 * Seluruh item yang stoknya akan disentuh oleh satu resep — obat paten
 * maupun bahan mentah racikannya.
 *
 * Dikumpulkan dalam SATU kueri supaya `kunciStok()` bisa dipanggil sekali
 * di awal, sebelum loop mana pun berjalan.
 */
export async function itemResep(
  conn: PoolConnection,
  prescriptionId: number,
): Promise<number[]> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT pi.item_id FROM prescription_items pi WHERE pi.prescription_id = ?
     UNION
     SELECT ri.item_id FROM prescription_racikan_ingredients ri
       JOIN prescription_racikans pr ON pr.id = ri.racikan_id
      WHERE pr.prescription_id = ?`,
    [prescriptionId, prescriptionId],
  );
  return rows.map((r) => Number(r.item_id));
}
