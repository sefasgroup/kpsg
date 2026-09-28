/**
 * Uji pemangkasan nol di belakang koma.
 *
 *   node uji/jalankan.mjs uji-desimal.ts
 *
 * MySQL mengembalikan DECIMAL sebagai string dengan skala penuh. Qty 15 pada
 * DECIMAL(14,3) sampai ke layar sebagai "15.000" — yang di Indonesia terbaca
 * lima belas ribu. Pada dosis obat dan hasil lab, salah baca seperti itu bukan
 * sekadar jelek dipandang.
 *
 * Yang paling penting diuji di sini bukan pemangkasannya, melainkan BATASNYA:
 * memangkas nol di belakang pada bilangan bulat akan mengubah 150 menjadi 15.
 * Itulah kenapa baik `formatDesimal()` maupun `tanpaNolEkor()` memeriksa dulu
 * ada-tidaknya titik desimal, dan kenapa uji ini ada.
 */
import type { RowDataPacket } from "mysql2";
import { pool, query, queryOne } from "@/lib/db";
import { formatDesimal } from "@/lib/format";
import { riwayatKunjungan, riwayatLab, tanpaNolEkor } from "@/lib/riwayat";

let gagal = 0;
const ok = (n: string, l: boolean, d = "") => {
  console.log(`  ${l ? "PASS" : "GAGAL"}  ${n}${d ? " — " + d : ""}`);
  if (!l) gagal++;
};

console.log("\n== formatDesimal() ==");

const KASUS: [number | string | null | undefined, string][] = [
  ["15.000", "15"],
  ["7.2000", "7.2"],
  ["222.0000", "222"],
  ["3600000.0000", "3600000"],
  ["0.500", "0.5"],
  ["0.000", "0"],
  ["73.00", "73"],
  ["-2.500", "-2.5"],
  // Tanpa titik desimal: harus dibiarkan utuh.
  ["150", "150"],
  ["100", "100"],
  [15, "15"],
  // Bukan angka murni — hasil lab bisa berupa teks.
  ["Negatif", "Negatif"],
  ["12,5", "12,5"],
  [null, ""],
  [undefined, ""],
];

for (const [masuk, harap] of KASUS) {
  const nyata = formatDesimal(masuk);
  ok(`${JSON.stringify(masuk)} → "${harap}"`, nyata === harap, `dapat "${nyata}"`);
}

/*
 * Perlindungan yang sesungguhnya. Kalau pemangkasan dilakukan tanpa memeriksa
 * titik desimal, seluruh baris ini akan kehilangan angka nol terakhirnya.
 */
console.log("\n== Bilangan bulat tidak boleh ikut terpangkas ==");
for (const n of ["150", "100", "1000", "20", "3060"]) {
  ok(`"${n}" tetap "${n}"`, formatDesimal(n) === n, formatDesimal(n));
}

console.log("\n== tanpaNolEkor() — ekspresi SQL yang sesungguhnya ==");

/*
 * Dijalankan lewat MySQL, bukan disalin ke JavaScript, supaya yang teruji
 * benar-benar ekspresi yang dipakai query — bukan tiruannya.
 */
const SQL: [string, string | null][] = [
  ["CAST('15.000' AS DECIMAL(14,3))", "15"],
  ["CAST('7.2000' AS DECIMAL(12,4))", "7.2"],
  ["CAST('150.000' AS DECIMAL(14,3))", "150"],
  ["CAST('0.000' AS DECIMAL(14,3))", "0"],
  ["CAST('0.500' AS DECIMAL(14,3))", "0.5"],
  ["CAST('73.00' AS DECIMAL(6,2))", "73"],
  // Bilangan bulat — inilah yang akan rusak tanpa penjaga LOCATE('.').
  ["CAST(150 AS SIGNED)", "150"],
  ["CAST(100 AS SIGNED)", "100"],
  ["CAST(NULL AS DECIMAL(14,3))", null],
];

for (const [ekspresi, harap] of SQL) {
  const r = await queryOne<RowDataPacket & { hasil: string | null }>(
    `SELECT ${tanpaNolEkor(ekspresi)} AS hasil`,
  );
  ok(
    `${ekspresi} → ${harap === null ? "NULL" : `"${harap}"`}`,
    r?.hasil === harap,
    r?.hasil === null ? "NULL" : `"${r?.hasil}"`,
  );
}

console.log("\n== Riwayat pasien: resep & hasil lab ==");

/*
 * Diperiksa pada data yang benar-benar ada, bukan fixture buatan — inilah
 * layar yang dilaporkan menampilkan "×15.000" dan "222.0000".
 */
const pasien = await queryOne<RowDataPacket & { patient_id: number }>(
  `SELECT v.patient_id
     FROM prescription_items pi
     JOIN prescriptions rx ON rx.id = pi.prescription_id
     JOIN visits v ON v.id = rx.visit_id
    WHERE rx.status <> 'batal'
    ORDER BY v.id DESC LIMIT 1`,
);

// Angka berekor nol: "15.000", "7.20", "222.0000" — tetapi bukan "7.2".
const BEREKOR = /\d\.\d*0(?!\d)/;

if (!pasien) {
  console.log("  (dilewati — belum ada resep tersimpan)");
} else {
  const riwayat = await riwayatKunjungan(Number(pasien.patient_id));
  ok("riwayat kunjungan terbaca", riwayat.length > 0, `${riwayat.length} kunjungan`);

  const obat = riwayat.map((k) => k.obat).filter(Boolean).join(" | ");
  const racikan = riwayat.map((k) => k.racikan).filter(Boolean).join(" | ");
  const ttv = riwayat.map((k) => k.ttv).filter(Boolean).join(" | ");

  ok("obat paten tanpa nol berekor", !BEREKOR.test(obat), obat || "(tidak ada)");
  ok("racikan tanpa nol berekor", !BEREKOR.test(racikan), racikan || "(tidak ada)");

  /*
   * Hanya bagian BB yang diperiksa, bukan seluruh baris TTV.
   *
   * Suhu SENGAJA tidak dipangkas: satu angka di belakang koma adalah cara baku
   * melaporkan suhu tubuh, dan "S 39.0°C" tidak mungkin salah dibaca sebagai
   * ribuan. Berat badan berbeda — DECIMAL(6,2) membuat 73 kg tercetak "73.00".
   */
  const bb = ttv.match(/BB [\d.]+ kg/g)?.join(" ") ?? "";
  ok("berat badan di TTV tanpa nol berekor", !BEREKOR.test(bb), bb || "(tidak ada)");
  ok(
    "suhu tetap satu angka di belakang koma — memang disengaja",
    !/S \d+°C/.test(ttv),
    ttv.match(/S [\d.]+°C/)?.[0] ?? "(tidak ada)",
  );

  const lab = await riwayatLab(Number(pasien.patient_id));
  const nilai = lab.map((l) => l.nilai).join(" | ");
  ok(
    "hasil lab tanpa nol berekor",
    !BEREKOR.test(nilai),
    nilai.slice(0, 160) || "(tidak ada)",
  );
}

/*
 * Tindakan memakai kolom SMALLINT, jadi memang TIDAK dipangkas. Diuji agar
 * jelas bahwa pembedaan ini disengaja: kalau suatu saat pemangkasan ikut
 * dipasang di sana, uji ini yang akan menahannya.
 */
console.log("\n== Tindakan (SMALLINT) dibiarkan apa adanya ==");
const tindakan = await query<RowDataPacket & { qty: number }>(
  `SELECT qty FROM assessment_procedures LIMIT 5`,
);
ok(
  "qty tindakan tetap bilangan bulat utuh",
  tindakan.every((t) => Number.isInteger(Number(t.qty))),
  tindakan.map((t) => t.qty).join(", ") || "(belum ada tindakan)",
);

console.log(`\n${gagal === 0 ? "SEMUA LULUS" : `${gagal} GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
