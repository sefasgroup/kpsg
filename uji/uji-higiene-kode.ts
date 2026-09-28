/**
 * Uji HIGIENE KODE — dua invarian yang tidak dijaga alat lain.
 *
 *   node uji/jalankan.mjs uji/uji-higiene-kode.ts
 *
 * Uji ini murni statis: tidak menyentuh database, jadi cepat dan bisa
 * dijalankan kapan saja.
 *
 * YANG DIJAGA
 *
 * 1. **Komentar SQL yang berakhir titik koma.** Setiap pemecah perintah
 *    yang naif memotong statement di situ, dan gejalanya berupa galat
 *    sintaks yang menunjuk baris yang tampak sempurna. Sudah terjadi sekali
 *    pada `db/schema.sql` dan sekali pada `db/seed-demo.sql`. `tsc` tidak
 *    bisa menolongnya — berkasnya bukan TypeScript.
 *
 * 2. **Urutan pengambilan kunci baris.** Setiap transaksi yang menulis
 *    `visits` wajib menguncinya lebih dulu (`lib/kunci.ts`). Empat deadlock
 *    nyata lahir dari pelanggaran aturan ini, dan aturan yang hanya
 *    dituliskan di komentar akan dilanggar lagi oleh modul berikutnya.
 *
 * YANG TIDAK DIJAGA DI SINI, DAN MENGAPA
 *
 * Backtick yang menutup template literal SQL di tempat salah sudah membuat
 * pekerjaan berhenti empat kali di proyek ini, jadi wajar ingin menjaganya.
 * Percobaan pertama menghitung kegenapan backtick per berkas — dan gagal
 * pada berkas ini sendiri, karena komentar dokumentasi memang boleh memuat
 * backtick tak berpasangan. Percobaan kedua mencari backtick di dalam
 * komentar SQL — dan mencurigai dokumentasinya sendiri.
 *
 * Keduanya dibuang. `npm run typecheck` sudah menangkap SELURUH empat
 * kejadian itu sebagai *unterminated string*, dan penjaga yang berteriak
 * pada berkas yang benar lebih buruk daripada tidak ada penjaga.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pool } from "../src/lib/db";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

function berkasTs(dir: string): string[] {
  const hasil: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) hasil.push(...berkasTs(p));
    else if (e.name.endsWith(".ts")) hasil.push(p);
  }
  return hasil;
}

// =====================================================================
console.log("\n== 1. Komentar SQL tidak berakhir titik koma ==");
// =====================================================================
const sqlBerkas = [
  ...readdirSync("db/migrasi").map((f) => join("db/migrasi", f)),
  "db/schema.sql",
  "db/seed.sql",
  "db/seed-demo.sql",
].filter((p) => p.endsWith(".sql"));

const titikKoma: string[] = [];
for (const p of sqlBerkas) {
  for (const [i, baris] of readFileSync(p, "utf8").split("\n").entries()) {
    const t = baris.trim();
    if (t.startsWith("--") && t.endsWith(";")) titikKoma.push(`${p}:${i + 1}`);
  }
}
ok(`${sqlBerkas.length} berkas SQL bersih`, titikKoma.length === 0,
  titikKoma.join(", "));

// =====================================================================
console.log("\n== 2. Urutan kunci baris ditegakkan ==");
// =====================================================================
/*
 * Transaksi yang menulis `visits` — langsung lewat `UPDATE visits` atau
 * tidak langsung lewat `statusSetelahLab()` — harus menguncinya sebagai
 * kunci PERTAMA, lewat `kunciKunjungan()`.
 *
 * Empat siklus deadlock yang terbukti melempar errno 1213:
 *
 *   visits ↔ billing_transactions   (asesmen vs pembayaran)
 *   visits ↔ prescriptions          (revisi resep vs penyerahan obat)
 *   visits ↔ lab_orders             (order lab vs input hasil)
 *   item_stocks ↔ item_stocks       (dua resep, urutan item terbalik)
 *
 * Tiga yang pertama dijaga di sini. Yang keempat dijaga `kunciStok()`, yang
 * mengambil seluruh kunci stok menurut `item_id` sebelum loop mana pun
 * berjalan.
 */
const pelanggar: string[] = [];
let diperiksa = 0;

for (const p of berkasTs("src/lib")) {
  const baris = readFileSync(p, "utf8").split("\n");
  let fn = "?";
  for (let i = 0; i < baris.length; i++) {
    const m = /^(?:export )?async function ([A-Za-z0-9_]+)/.exec(baris[i].trim());
    if (m) fn = m[1];
    if (!baris[i].includes("transaction(async (conn)")) continue;

    let depth = 0;
    const blok: string[] = [];
    for (let j = i; j < baris.length; j++) {
      blok.push(baris[j]);
      depth += (baris[j].match(/\(/g) ?? []).length - (baris[j].match(/\)/g) ?? []).length;
      if (j > i && depth <= 0) break;
    }
    const teks = blok.join("\n");
    if (!/UPDATE visits/.test(teks) && !teks.includes("statusSetelahLab")) {
      i += blok.length - 1;
      continue;
    }
    diperiksa++;

    let pertama: string | null = null;
    for (let k = 0; k < blok.length; k++) {
      if (/\bkunciKunjungan\(/.test(blok[k])) {
        pertama = "visits";
        break;
      }
      if (blok[k].includes("FOR UPDATE")) {
        const ctx = blok.slice(Math.max(0, k - 6), k + 1).join("\n");
        pertama = (/\b(?:FROM|UPDATE)\s+([a-z_]+)/.exec(ctx) ?? [, "?"])[1] ?? "?";
        break;
      }
    }
    if (pertama !== "visits") {
      pelanggar.push(`${p}::${fn} (kunci pertama: ${pertama})`);
    }
    i += blok.length - 1;
  }
}

ok(`${diperiksa} transaksi penulis visits menguncinya lebih dulu`,
  pelanggar.length === 0, pelanggar.join(" · "));

/*
 * Penjaga terhadap penjaganya sendiri: bila tidak ada satu pun transaksi
 * yang terdeteksi, yang rusak adalah pendeteksinya — bukan kodenya. Uji
 * yang selalu lulus karena tidak memeriksa apa pun adalah uji yang paling
 * berbahaya di seluruh berkas.
 */
ok("pendeteksinya sendiri masih menemukan transaksi", diperiksa >= 10,
  `${diperiksa} transaksi terdeteksi`);

// =====================================================================
console.log(gagal === 0 ? "\nSEMUA UJI LULUS\n" : `\n${gagal} UJI GAGAL\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
