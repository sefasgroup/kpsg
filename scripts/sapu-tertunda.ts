/**
 * Sapuan harian: memberi tahu Admin Cabang tentang kunjungan yang menggantung.
 *
 *   node uji/jalankan.mjs scripts/sapu-tertunda.ts
 *   node uji/jalankan.mjs scripts/sapu-tertunda.ts --hari=3   # hanya yang ≥3 hari
 *   node uji/jalankan.mjs scripts/sapu-tertunda.ts --lihat    # lihat saja, jangan kirim
 *
 * MASALAH YANG DITUTUP SKRIP INI
 *
 * Kunjungan yang tidak pernah tuntas tidak hilang dengan sendirinya: statusnya
 * tetap `menunggu_dokter` (atau tahap mana pun), dan sistem terus menganggapnya
 * sedang dilayani. Sejak layar Dokter, Perawat, dan Pendaftaran punya bagian
 * "Tertunda dari Hari Sebelumnya", kunjungan itu memang sudah TERLIHAT — tetapi
 * hanya oleh orang yang kebetulan membuka layarnya.
 *
 * Yang paling merugikan bukan kunjungannya sendiri melainkan yang ikut
 * tersangkut di dalamnya: resep yang sudah divalidasi tetap MENGUNCI STOK.
 * Obatnya ada di rak, sistem menolak memakainya untuk pasien lain, dan tidak
 * ada satu pun layar yang menjelaskan sebabnya.
 *
 * MENJADWALKANNYA (Windows Task Scheduler)
 *
 *   Program : node
 *   Argumen : uji\jalankan.mjs scripts\sapu-tertunda.ts
 *   Mulai di: C:\laragon\www\KPSG
 *   Pemicu  : harian, 07.00 — sebelum klinik buka
 *
 * Aman diulang: cabang yang sudah diberi tahu hari ini dilewati, jadi
 * percobaan ulang penjadwal tidak menumpuk notifikasi yang sama.
 */
import { pool } from "../src/lib/db";
import { sapuKunjunganTertunda } from "../src/lib/notifications";

const arg = process.argv.slice(2);
const lihatSaja = arg.includes("--lihat");
const cocokHari = arg.find((a) => a.startsWith("--hari="));
const ambangHari = cocokHari ? Number(cocokHari.split("=")[1]) : 1;

if (!Number.isFinite(ambangHari) || ambangHari < 1) {
  console.error("--hari harus bilangan bulat minimal 1.");
  process.exit(2);
}

console.log(
  `\nSapuan kunjungan tertunda — ambang ${ambangHari} hari` +
  (lihatSaja ? " (LIHAT SAJA, tidak mengirim notifikasi)" : ""),
);

/*
 * Mode `--lihat` memanggil sapuan dengan ambang yang mustahil terpenuhi
 * supaya tidak ada notifikasi terkirim? TIDAK — itu akan berbohong tentang
 * jumlahnya. Yang dilakukan: jalankan sapuan sungguhan hanya bila tidak
 * `--lihat`; untuk `--lihat`, baca angkanya lewat kueri yang sama tanpa
 * mengirim apa pun.
 */
const hasil = lihatSaja
  ? await (async () => {
      const { query } = await import("../src/lib/db");
      type Baris = import("mysql2").RowDataPacket & {
        site_nama: string; jumlah: number; hari_tertua: number;
      };
      const rows = await query<Baris>(
        `SELECT s.nama AS site_nama, COUNT(*) AS jumlah,
                MAX(DATEDIFF(CURDATE(), v.tanggal)) AS hari_tertua
           FROM visits v JOIN sites s ON s.id = v.site_id
          WHERE v.status NOT IN ('selesai','batal')
            AND v.tanggal <= DATE_SUB(CURDATE(), INTERVAL ? DAY)
          GROUP BY s.nama ORDER BY s.nama`,
        [ambangHari],
      );
      return rows.map((r) => ({
        siteId: 0,
        siteNama: String(r.site_nama),
        jumlah: Number(r.jumlah),
        hariTertua: Number(r.hari_tertua),
        terkirim: false,
      }));
    })()
  : await sapuKunjunganTertunda(ambangHari);

if (hasil.length === 0) {
  console.log("\n  Tidak ada kunjungan tertunda. Tidak ada yang perlu dikirim.\n");
} else {
  console.log("");
  for (const h of hasil) {
    console.log(
      `  ${h.siteNama.padEnd(24)} ${String(h.jumlah).padStart(3)} kunjungan` +
      `  · tertua ${h.hariTertua} hari` +
      (lihatSaja
        ? ""
        : h.terkirim
          ? "  · notifikasi TERKIRIM"
          : "  · dilewati (sudah diberi tahu hari ini)"),
    );
  }
  const total = hasil.reduce((n, h) => n + h.jumlah, 0);
  console.log(`\n  Total ${total} kunjungan tertunda di ${hasil.length} cabang.\n`);
}

await pool.end();
