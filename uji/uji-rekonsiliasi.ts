/**
 * Rekonsiliasi kartu stok terhadap cache saldo (docs/DATABASE.md §3.3).
 *
 * `item_stocks.qty_on_hand` hanyalah cache; kebenarannya ada di
 * `stock_movements`. Bila keduanya pernah menyimpang, salah satu jalur
 * pemotongan berarti tidak lewat lib/stock.ts. Uji ini menjaring hal itu
 * di seluruh cabang sekaligus.
 *
 *   node uji/jalankan.mjs uji-rekonsiliasi.ts
 */
import type { RowDataPacket } from "mysql2";
import { pool, query } from "../src/lib/db";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

console.log("\n== Kartu stok vs cache saldo ==");

const menyimpang = await query<RowDataPacket & {
  site: string; kode: string; nama: string; cache: string; ledger: string;
}>(
  `SELECT st.nama AS site, i.kode, i.nama,
          s.qty_on_hand AS cache,
          COALESCE((SELECT SUM(m.qty_delta) FROM stock_movements m
                     WHERE m.item_id = i.id AND m.site_id = s.site_id), 0) AS ledger
     FROM item_stocks s
     JOIN items i  ON i.id = s.item_id
     JOIN sites st ON st.id = s.site_id
    HAVING cache <> ledger`,
);

ok(
  "saldo cache sama dengan jumlah kartu stok di seluruh cabang",
  menyimpang.length === 0,
  menyimpang.length === 0
    ? "tidak ada penyimpangan"
    : menyimpang.map((m) => `${m.site}/${m.kode}: cache ${m.cache} vs ledger ${m.ledger}`).join("; "),
);

const minus = await query<RowDataPacket & { kode: string; nama: string; qty: string }>(
  `SELECT i.kode, i.nama, s.qty_on_hand AS qty
     FROM item_stocks s JOIN items i ON i.id = s.item_id
    WHERE s.qty_on_hand < 0`,
);
ok(
  "tidak ada saldo negatif",
  minus.length === 0,
  minus.map((m) => `${m.kode} = ${m.qty}`).join("; ") || "seluruh saldo >= 0",
);

const qtyNegatif = await query<RowDataPacket & { id: number; jenis: string }>(
  `SELECT id, jenis FROM stock_movements WHERE qty <= 0`,
);
ok(
  "kolom qty di kartu stok selalu positif",
  qtyNegatif.length === 0,
  "arah pergerakan ditentukan oleh `jenis` dan `qty_delta`, bukan tanda pada `qty`",
);

const arahSalah = await query<RowDataPacket & { id: number; jenis: string; qty_delta: string }>(
  `SELECT id, jenis, qty_delta FROM stock_movements
    WHERE (jenis LIKE 'masuk[_]%' AND qty_delta < 0)
       OR (jenis LIKE 'keluar[_]%' AND qty_delta > 0)`,
);
ok(
  "arah qty_delta selaras dengan jenis pergerakan",
  arahSalah.length === 0,
  arahSalah.map((a) => `#${a.id} ${a.jenis} ${a.qty_delta}`).join("; ") || "masuk_* positif, keluar_* negatif",
);

/*
 * Sejak batch dikonsumsi FEFO, sisa seluruh batch tidak boleh melebihi
 * saldo gudang. Bila melebihi, ada pemotongan yang mengurangi saldo tanpa
 * mengurangi batch — artinya ada jalur yang tidak lewat `kurangiStok()`.
 */
const batchLebih = await query<RowDataPacket & {
  site: string; kode: string; batch: string; stok: string;
}>(
  `SELECT st.nama AS site, i.kode,
          COALESCE(SUM(b.qty), 0) AS batch,
          MAX(s.qty_on_hand) AS stok
     FROM item_stocks s
     JOIN items i  ON i.id = s.item_id
     JOIN sites st ON st.id = s.site_id
     LEFT JOIN item_batches b ON b.item_id = s.item_id AND b.site_id = s.site_id
    GROUP BY s.site_id, s.item_id, st.nama, i.kode
   HAVING batch > stok`,
);
ok(
  "sisa seluruh batch tidak melebihi saldo gudang",
  batchLebih.length === 0,
  batchLebih
    .map((b) => `${b.site}/${b.kode}: batch ${b.batch} > stok ${b.stok}`)
    .join("; ") || "konsumsi FEFO konsisten",
);

const yatim = await query<RowDataPacket & { id: number }>(
  `SELECT m.id FROM stock_movements m
    LEFT JOIN item_stocks s ON s.item_id = m.item_id AND s.site_id = m.site_id
   WHERE s.item_id IS NULL`,
);
ok(
  "setiap pergerakan punya baris saldo di cabangnya",
  yatim.length === 0,
  yatim.length === 0 ? "tidak ada pergerakan yatim" : `${yatim.length} pergerakan tanpa saldo`,
);

console.log(`\n${gagal === 0 ? "SEMUA UJI LULUS" : `${gagal} UJI GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
