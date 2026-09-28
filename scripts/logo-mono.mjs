/**
 * Membuat versi hitam-putih murni (1-bit) dari logo untuk printer thermal.
 *
 * Printer thermal 58/80 mm hanya bisa menyalakan atau tidak menyalakan
 * setiap titik — tidak ada abu-abu. Logo berwarna yang dikirim apa adanya
 * akan di-*dither* oleh driver menjadi bercak yang tidak terbaca. Ambang
 * ditentukan di sini supaya hasilnya bisa dilihat dan diatur, bukan
 * diserahkan ke driver.
 *
 * Ditulis tanpa dependensi: PNG di-decode dan di-encode langsung memakai
 * `zlib` bawaan Node. Menambah `sharp` hanya untuk satu berkas aset yang
 * dibuat sekali tidak sepadan.
 *
 * Pemakaian:
 *   node scripts/logo-mono.mjs                        # 192px, berdasarkan alpha
 *   node scripts/logo-mono.mjs --mode=luma --ambang=0.6
 *   node scripts/logo-mono.mjs --lebar=384            # printer 80mm resolusi tinggi
 */
import { readFile, writeFile } from "node:fs/promises";
import { deflateSync, inflateSync } from "node:zlib";
import path from "node:path";

const arg = process.argv.slice(2);
const ambil = (n, bawaan) => {
  const v = arg.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
  return v === undefined ? bawaan : Number(v);
};

/**
 * Mode penentuan hitam/putih:
 *
 *   alpha (default) — piksel yang TIDAK transparan jadi hitam.
 *   luma            — piksel yang lebih gelap dari ambang jadi hitam.
 *
 * `alpha` adalah yang benar untuk logo berwarna di atas latar transparan.
 * Dengan `luma`, bagian logo yang kebetulan berwarna terang (mis. hijau
 * muda pada mark KPSG) terbaca sebagai latar dan HILANG — bentuknya jadi
 * tidak utuh, padahal seluruh mark seharusnya tercetak pekat.
 */
const MODE = arg.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "alpha";
const AMBANG = ambil("ambang", MODE === "alpha" ? 0.5 : 0.62);
const LEBAR_TARGET = ambil("lebar", 192);

const SUMBER = path.join(process.cwd(), "public", "brand", "kpsg-mark-512.png");
const TUJUAN = path.join(process.cwd(), "public", "brand", "kpsg-mark-mono.png");

// --- Decode PNG -----------------------------------------------------------

function bacaPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("Bukan berkas PNG.");

  let off = 8;
  let ihdr = null;
  const idat = [];

  while (off < buf.length) {
    const panjang = buf.readUInt32BE(off);
    const tipe = buf.subarray(off + 4, off + 8).toString("latin1");
    const data = buf.subarray(off + 8, off + 8 + panjang);

    if (tipe === "IHDR") {
      ihdr = {
        lebar: data.readUInt32BE(0),
        tinggi: data.readUInt32BE(4),
        kedalaman: data[8],
        warna: data[9],
        interlace: data[12],
      };
    } else if (tipe === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (tipe === "IEND") break;

    off += 12 + panjang;
  }

  if (!ihdr) throw new Error("IHDR tidak ditemukan.");
  if (ihdr.kedalaman !== 8) {
    throw new Error(`Kedalaman ${ihdr.kedalaman} bit belum didukung (butuh 8).`);
  }
  if (ihdr.interlace !== 0) throw new Error("PNG interlaced belum didukung.");

  const kanal = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.warna];
  if (!kanal) throw new Error(`Tipe warna ${ihdr.warna} belum didukung.`);

  const mentah = inflateSync(Buffer.concat(idat));
  const bpp = kanal;
  const perBaris = ihdr.lebar * bpp;
  const piksel = Buffer.alloc(ihdr.tinggi * perBaris);

  // Un-filter per scanline (spesifikasi PNG §9).
  for (let y = 0; y < ihdr.tinggi; y++) {
    const filter = mentah[y * (perBaris + 1)];
    const baris = mentah.subarray(y * (perBaris + 1) + 1, (y + 1) * (perBaris + 1));
    const keluar = piksel.subarray(y * perBaris, (y + 1) * perBaris);
    const atas = y > 0 ? piksel.subarray((y - 1) * perBaris, y * perBaris) : null;

    for (let i = 0; i < perBaris; i++) {
      const a = i >= bpp ? keluar[i - bpp] : 0;
      const b = atas ? atas[i] : 0;
      const c = atas && i >= bpp ? atas[i - bpp] : 0;
      const x = baris[i];
      let nilai;
      switch (filter) {
        case 0: nilai = x; break;
        case 1: nilai = x + a; break;
        case 2: nilai = x + b; break;
        case 3: nilai = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          nilai = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`Filter ${filter} tidak dikenal.`);
      }
      keluar[i] = nilai & 0xff;
    }
  }

  return { ...ihdr, kanal, piksel };
}

// --- Encode PNG grayscale 1-bit -------------------------------------------

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(tipe, data) {
  const isi = Buffer.concat([Buffer.from(tipe, "latin1"), data]);
  const out = Buffer.alloc(isi.length + 8);
  out.writeUInt32BE(data.length, 0);
  isi.copy(out, 4);
  out.writeUInt32BE(crc32(isi), isi.length + 4);
  return out;
}

function tulisPng1Bit(lebar, tinggi, bit) {
  const perBaris = Math.ceil(lebar / 8);
  const mentah = Buffer.alloc(tinggi * (perBaris + 1));

  for (let y = 0; y < tinggi; y++) {
    mentah[y * (perBaris + 1)] = 0; // filter None — hemat & cukup untuk 1-bit
    for (let x = 0; x < lebar; x++) {
      if (bit[y * lebar + x]) {
        mentah[y * (perBaris + 1) + 1 + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lebar, 0);
  ihdr.writeUInt32BE(tinggi, 4);
  ihdr[8] = 1; // kedalaman 1 bit
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(mentah, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Proses ---------------------------------------------------------------

const png = bacaPng(await readFile(SUMBER));
const skala = png.lebar / LEBAR_TARGET;
const tinggiTarget = Math.max(1, Math.round(png.tinggi / skala));

const bit = new Uint8Array(LEBAR_TARGET * tinggiTarget);
let hitam = 0;

for (let y = 0; y < tinggiTarget; y++) {
  for (let x = 0; x < LEBAR_TARGET; x++) {
    // Rata-rata kotak sumber (box filter) — mengecilkan dengan mengambil
    // satu piksel saja membuat garis tipis logo hilang sama sekali.
    const x0 = Math.floor(x * skala), x1 = Math.min(png.lebar, Math.ceil((x + 1) * skala));
    const y0 = Math.floor(y * skala), y1 = Math.min(png.tinggi, Math.ceil((y + 1) * skala));

    let jumlah = 0, n = 0;
    for (let sy = y0; sy < y1; sy++) {
      for (let sx = x0; sx < x1; sx++) {
        const i = (sy * png.lebar + sx) * png.kanal;
        const p = png.piksel;
        let lum, alpha = 1;

        if (png.kanal >= 3) {
          // Luma Rec. 601 — mendekati cara mata menimbang terang warna.
          lum = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255;
          if (png.kanal === 4) alpha = p[i + 3] / 255;
        } else {
          lum = p[i] / 255;
          if (png.kanal === 2) alpha = p[i + 1] / 255;
        }

        /*
         * `jumlah` selalu berarti SEBERAPA GELAP piksel ini seharusnya,
         * 0 = putih bersih, 1 = hitam pekat. Menyeragamkan artinya untuk
         * kedua mode mencegah salah tanda yang membuat hasilnya terbalik
         * (logo putih di atas blok hitam).
         *
         * Bagian transparan selalu dianggap PUTIH: kertas thermal memang
         * putih, dan menganggapnya hitam akan mencetak kotak pekat.
         */
        jumlah +=
          MODE === "alpha"
            ? alpha
            : alpha * (1 - lum);
        n++;
      }
    }

    const gelap = n > 0 ? jumlah / n : 0;
    // bit 1 = putih (grayscale 1-bit: 0 gelap, 1 terang)
    const putih = MODE === "alpha" ? gelap < AMBANG : gelap <= 1 - AMBANG;
    bit[y * LEBAR_TARGET + x] = putih ? 1 : 0;
    if (!putih) hitam++;
  }
}

const total = LEBAR_TARGET * tinggiTarget;
const persen = ((hitam / total) * 100).toFixed(1);

await writeFile(TUJUAN, tulisPng1Bit(LEBAR_TARGET, tinggiTarget, bit));

console.log(`
Logo mono dibuat: public/brand/kpsg-mark-mono.png
  Sumber   : ${path.basename(SUMBER)} (${png.lebar}×${png.tinggi}, ${png.kanal} kanal)
  Hasil    : ${LEBAR_TARGET}×${tinggiTarget}, 1-bit grayscale
  Mode     : ${MODE}
  Ambang   : ${AMBANG}
  Tinta    : ${persen}% piksel hitam
`);

if (Number(persen) < 3) {
  console.log("Terlalu terang — logo akan nyaris tak terlihat. Coba --ambang lebih tinggi.\n");
} else if (Number(persen) > 60) {
  console.log("Terlalu pekat — akan tercetak sebagai blok hitam. Coba --ambang lebih rendah.\n");
}
