/**
 * Uji penyimpanan berkas unggahan dan impor massal master data.
 *
 *   node uji/jalankan.mjs uji-berkas-impor.ts
 */
import type { RowDataPacket } from "mysql2";
import { deflateSync } from "node:zlib";
import { execute, pool, query, queryOne } from "../src/lib/db";
import { BerkasDitolak, bacaBerkas, hapusBerkas, simpanBerkas } from "../src/lib/berkas";
import { imporItem, imporTindakan } from "../src/lib/master";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

/** PNG 1×1 yang sah, dirakit langsung supaya uji tidak butuh berkas contoh. */
function pngMungil(): Buffer {
  const crc32 = (b: Buffer) => {
    let c = ~0;
    for (const byte of b) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (tipe: string, data: Buffer) => {
    const isi = Buffer.concat([Buffer.from(tipe, "latin1"), data]);
    const out = Buffer.alloc(isi.length + 8);
    out.writeUInt32BE(data.length, 0);
    isi.copy(out, 4);
    out.writeUInt32BE(crc32(isi), isi.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from([0, 0]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const berkasDari = (isi: Buffer | string, nama: string, tipe: string) =>
  new File([new Uint8Array(Buffer.from(isi as never))], nama, { type: tipe });

// =====================================================================
console.log("\n== 1. Penyimpanan berkas ==");
// =====================================================================

const png = pngMungil();
const simpan = await simpanBerkas(berkasDari(png, "logo.png", "image/png"), "logo");

ok("berkas tersimpan dan mengembalikan kunci", Boolean(simpan.kunci));
ok(
  "kunci berpola kategori/YYYYMM/acak.ext",
  /^logo\/\d{6}\/[a-f0-9]{32}\.png$/.test(simpan.kunci),
  simpan.kunci,
);
ok(
  "nama asli TIDAK dipakai di sistem berkas",
  !simpan.kunci.includes("logo.png"),
  "di situlah path traversal dan nama berbahaya masuk",
);

const dibaca = await bacaBerkas(simpan.kunci);
ok("berkas bisa dibaca kembali", dibaca?.isi.equals(png) === true);
ok("MIME ditentukan dari ekstensi kanonis", dibaca?.mime === "image/png");

// --- Penolakan ---
let p1 = "";
try {
  // Mengaku PNG, isinya teks biasa.
  await simpanBerkas(berkasDari("bukan gambar sama sekali", "x.png", "image/png"), "logo");
} catch (e) { p1 = (e as Error).message; }
ok(
  "berkas yang MENGAKU PNG tapi isinya bukan ditolak",
  p1.includes("tidak didukung"),
  "File.type berasal dari peramban dan bisa dipalsukan",
);

let p2 = "";
// PNG sah untuk ttd — seharusnya lolos; yang diuji berikutnya adalah PDF.
const ttd = await simpanBerkas(berkasDari(png, "x.png", "image/png"), "ttd");
ok("PNG diterima untuk kategori tanda tangan", ttd.kunci.startsWith("ttd/"));
try {
  await simpanBerkas(
    berkasDari("%PDF-1.4 palsu", "x.pdf", "application/pdf"),
    "ttd",
  );
} catch (e) { p2 = (e as Error).message; }
ok("PDF ditolak untuk kategori tanda tangan", p2.includes("tidak didukung"), p2);
await hapusBerkas(ttd.kunci);

const pdf = await simpanBerkas(
  berkasDari("%PDF-1.4\n% surat dokter", "surat.pdf", "application/pdf"),
  "lampiran",
);
ok("PDF diterima untuk lampiran", pdf.kunci.endsWith(".pdf"));

let p3 = "";
try {
  await simpanBerkas(berkasDari("", "kosong.png", "image/png"), "logo");
} catch (e) { p3 = (e as Error).message; }
ok("berkas kosong ditolak", p3.includes("kosong"));

let p4 = "";
try {
  const besar = Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)]);
  await simpanBerkas(berkasDari(besar, "besar.png", "image/png"), "logo");
} catch (e) { p4 = (e as Error).message; }
ok("berkas melebihi batas ukuran ditolak", p4.includes("melebihi"), p4);
ok("galat penolakan bertipe BerkasDitolak", new BerkasDitolak("x") instanceof Error);

// --- Path traversal ---
for (const jahat of [
  "../.env.local",
  "logo/202608/../../../package.json",
  "logo/202608/aaaa.png/../../../.env",
  "..%2f..%2f.env",
  "/etc/passwd",
  "logo/202608/short.png",
]) {
  ok(`kunci berbahaya ditolak: ${jahat.slice(0, 34)}`, (await bacaBerkas(jahat)) === null);
}

await hapusBerkas(simpan.kunci);
ok("berkas bisa dihapus", (await bacaBerkas(simpan.kunci)) === null);
await hapusBerkas(simpan.kunci);
ok("menghapus berkas yang sudah tidak ada bukan galat", true);
await hapusBerkas(pdf.kunci);

// =====================================================================
console.log("\n== 2. Impor massal katalog ==");
// =====================================================================

await execute(`DELETE FROM items WHERE kode LIKE 'UJIIMP%'`);
await execute(`DELETE FROM medical_procedures WHERE kode LIKE 'UJIIMP%'`);

const csvItem = [
  "kode,tipe,nama,satuan,hpp,jual,min,bentuk,racik,resep",
  "UJIIMP-1,obat,Amoksisilin Uji 500,tablet,900,2000,50,Kaplet,1,1",
  "UJIIMP-2,bmhp,Kasa Uji 10x10,pcs,2500,5000,30,,0,0",
  "UJIIMP-3,obat,Rugi Uji,tablet,5000,1000,10,,0,1", // jual < hpp
  "UJIIMP-4,vitamin,Tipe Salah,tablet,100,200,0,,0,1", // tipe tak dikenal
  ",obat,Tanpa Kode,tablet,100,200,0,,0,1",
  'UJIIMP-5,obat,"Paracetamol Uji, 500 mg",tablet,300,900,20,Tablet,1,0', // koma dalam kutip
].join("\n");

const h1 = await imporItem(csvItem, ",", true);
ok("baris sah masuk", h1.masuk === 3, `${h1.masuk} masuk`);
ok("baris rusak dilewati, bukan membatalkan impor", h1.dilewati === 3, `${h1.dilewati} dilewati`);
ok(
  "galat dilaporkan lengkap dengan nomor baris dan alasan",
  h1.galat.length === 3 && h1.galat.every((g) => g.baris > 0 && g.alasan.length > 0),
  h1.galat.map((g) => `#${g.baris} ${g.alasan}`).join(" | "),
);
ok(
  "harga jual di bawah HPP ditolak juga lewat impor",
  h1.galat.some((g) => g.alasan.includes("di bawah HPP")),
  "impor tidak boleh jadi jalan pintas melanggar aturan form",
);
ok("tipe tak dikenal ditolak", h1.galat.some((g) => g.alasan.includes("tidak dikenal")));

const koma = await queryOne<RowDataPacket & { nama: string }>(
  `SELECT nama FROM items WHERE kode = 'UJIIMP-5'`,
);
ok(
  "koma di dalam tanda kutip tidak memecah kolom",
  koma?.nama === "Paracetamol Uji, 500 mg",
  koma?.nama,
);

const cek = await queryOne<RowDataPacket & {
  tipe: string; hpp: string; is_racikable: number; butuh_resep: number;
}>(`SELECT tipe, hpp, is_racikable, butuh_resep FROM items WHERE kode='UJIIMP-1'`);
ok(
  "seluruh kolom terpetakan benar",
  cek?.tipe === "obat" && Number(cek.hpp) === 900 &&
    cek.is_racikable === 1 && cek.butuh_resep === 1,
);

// Impor ulang harus MEMPERBARUI, bukan menggandakan.
const h2 = await imporItem(
  "UJIIMP-1,obat,Amoksisilin Uji 500 REVISI,tablet,950,2100,60,Kaplet,1,1",
  ",",
  false,
);
ok("impor ulang memperbarui, bukan menggandakan", h2.diperbarui === 1 && h2.masuk === 0);
const jml = await queryOne<RowDataPacket & { n: number }>(
  `SELECT COUNT(*) n FROM items WHERE kode='UJIIMP-1'`,
);
ok("tidak ada baris kembar", Number(jml?.n) === 1);
const revisi = await queryOne<RowDataPacket & { nama: string }>(
  `SELECT nama FROM items WHERE kode='UJIIMP-1'`,
);
ok("nilai lama tertimpa nilai baru", revisi?.nama.includes("REVISI") === true);

const h3 = await imporItem(csvItem, ",", false);
ok(
  "tanpa lewati-header, baris judul ikut jadi galat",
  h3.dilewati === 4,
  "operator diberi tahu, bukan diam-diam menyimpan baris judul sebagai data",
);

// --- Kategori otomatis ---
await execute(`DELETE FROM item_categories WHERE nama LIKE 'UjiKat%'`);

const hk = await imporItem(
  [
    "UJIIMP-K1,obat,Obat Kat A,tablet,100,300,0,,0,1,UjiKat Antibiotik",
    "UJIIMP-K2,obat,Obat Kat B,tablet,100,300,0,,0,1,UjiKat Antibiotik",
    "UJIIMP-K3,bmhp,BMHP Kat,pcs,100,300,0,,0,0,UjiKat Luka",
  ].join("\n"),
  ",",
  false,
);
ok("baris berkategori masuk", hk.masuk === 3);

const kat = await query<RowDataPacket & { nama: string; tipe: string }>(
  `SELECT nama, tipe FROM item_categories WHERE nama LIKE 'UjiKat%' ORDER BY nama`,
);
ok(
  "kategori baru dibuat otomatis, tidak digandakan per baris",
  kat.length === 2,
  `${kat.length} kategori untuk 3 baris (2 di antaranya kategori sama)`,
);
ok(
  "kategori dibuat dengan tipe item-nya",
  kat.find((k) => k.nama === "UjiKat Antibiotik")?.tipe === "obat" &&
    kat.find((k) => k.nama === "UjiKat Luka")?.tipe === "bmhp",
);

const terpasang = await queryOne<RowDataPacket & { nama: string }>(
  `SELECT c.nama FROM items i JOIN item_categories c ON c.id = i.category_id
    WHERE i.kode = 'UJIIMP-K1'`,
);
ok("item tersambung ke kategorinya", terpasang?.nama === "UjiKat Antibiotik");

// Impor ulang TANPA kolom kategori tidak boleh menghapus kategori yang ada.
await imporItem("UJIIMP-K1,obat,Obat Kat A Revisi,tablet,100,300,0,,0,1", ",", false);
const tetap = await queryOne<RowDataPacket & { nama: string | null }>(
  `SELECT c.nama FROM items i LEFT JOIN item_categories c ON c.id = i.category_id
    WHERE i.kode = 'UJIIMP-K1'`,
);
ok(
  "impor ulang tanpa kolom kategori tidak mengosongkan kategori",
  tetap?.nama === "UjiKat Antibiotik",
  "kolom kosong berarti 'tidak disebut', bukan 'hapus'",
);

await execute(`DELETE FROM items WHERE kode LIKE 'UJIIMP-K%'`);
await execute(`DELETE FROM item_categories WHERE nama LIKE 'UjiKat%'`);

// =====================================================================
console.log("\n== 3. Impor massal tindakan ==");
// =====================================================================

const h4 = await imporTindakan(
  [
    "kode,nama,kategori,tarif,icd9",
    "UJIIMP-T1,Jahit Luka Uji,Tindakan,150000,86.59",
    "UJIIMP-T2,Nebulisasi Uji,Tindakan,bukan-angka,93.94",
    "UJIIMP-T3,Tanpa Tarif Uji,Tindakan,,",
  ].join("\n"),
  ",",
  true,
);
ok("tindakan sah masuk", h4.masuk === 2, `${h4.masuk} masuk`);
ok("tarif bukan angka ditolak", h4.galat.some((g) => g.alasan.includes("bukan angka")));

const t1 = await queryOne<RowDataPacket & { tarif: string; icd9cm: string }>(
  `SELECT tarif, icd9cm FROM medical_procedures WHERE kode='UJIIMP-T1'`,
);
ok("tarif & ICD-9-CM tersimpan", Number(t1?.tarif) === 150000 && t1?.icd9cm === "86.59");

const t3 = await queryOne<RowDataPacket & { tarif: string }>(
  `SELECT tarif FROM medical_procedures WHERE kode='UJIIMP-T3'`,
);
ok("tarif kosong dianggap nol, bukan ditolak", Number(t3?.tarif) === 0);

// =====================================================================
await execute(`DELETE FROM items WHERE kode LIKE 'UJIIMP%'`);
await execute(`DELETE FROM medical_procedures WHERE kode LIKE 'UJIIMP%'`);
const sisa = await query<RowDataPacket & { kode: string }>(
  `SELECT kode FROM items WHERE kode LIKE 'UJIIMP%'`,
);
ok("data uji dibersihkan", sisa.length === 0);

console.log(`\n${gagal === 0 ? "SEMUA UJI LULUS" : `${gagal} UJI GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
