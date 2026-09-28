/**
 * Runner uji: menjalankan berkas .ts di folder ini dengan mengimpor
 * MODUL APLIKASI YANG SEBENARNYA, bukan menyalin ulang SQL-nya.
 *
 * Latar belakangnya: bug `LIMIT ?` lolos dari lebih dari seratus assertion
 * karena skrip uji lama memakai `pool.query()` sementara aplikasi memakai
 * `pool.execute()`. Uji yang tidak melewati jalur kode asli hanya menguji
 * skrip ujinya sendiri.
 *
 * `server-only` dipetakan ke `empty.js` — berkas yang sama yang dipakai
 * Next.js lewat kondisi ekspor `react-server`. Marker itu memang hanya
 * penanda bundler, bukan pengaman runtime.
 *
 * Pemakaian:
 *   node uji/jalankan.mjs uji-inventori.ts        # berkas di folder uji/
 *   node uji/jalankan.mjs scripts/data-contoh.ts  # berkas lain, relatif ke akar
 *
 * Skrip pengisian data juga dijalankan lewat runner ini supaya ia memakai
 * pustaka aplikasi yang sebenarnya — saldo awal stok masuk lewat jalur yang
 * sama dengan Penerimaan asli, bukan INSERT yang bisa melenceng dari kartu
 * stok.
 */
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const berkas = process.argv[2];

if (!berkas) {
  console.error("Pemakaian: node uji/jalankan.mjs <berkas.ts>");
  process.exit(2);
}

// Kredensial DB disamakan dengan default lib/db.ts bila .env tidak terbaca.
process.env.DB_HOST ??= "127.0.0.1";
process.env.DB_USER ??= "root";
process.env.DB_NAME ??= "simklinik_kpsg";

const jiti = createJiti(import.meta.url, {
  alias: {
    "server-only": path.join(dir, "..", "node_modules", "server-only", "empty.js"),
    "@": path.join(dir, "..", "src"),
  },
  interopDefault: true,
});

// Nama polos dicari di folder uji/; apa pun yang bermuatan path diselesaikan
// dari direktori kerja, supaya skrip di scripts/ bisa ikut memakai runner ini.
const target = /[\\/]/.test(berkas)
  ? path.resolve(process.cwd(), berkas)
  : path.join(dir, berkas);

await jiti.import(target);
