/**
 * Uji penugasan multi-cabang (`user_sites`) dan notifikasi.
 *
 *   node uji/jalankan.mjs uji-multisite.ts
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, query, queryOne } from "../src/lib/db";
import { SQL_BERTUGAS_DI_CABANG, cabangPengguna } from "../src/lib/auth";
import { bolehKeCabang, bolehPindahCabang, effectiveSiteId, type SessionUser } from "../src/lib/session";
import { simpanPengguna } from "../src/lib/master";
import { penggunaSchema } from "../src/lib/validations/master";
import { daftarDokter } from "../src/lib/visits";
import { daftarPegawai } from "../src/lib/hr";
import {
  hitungBelumDibaca, kirimNotifikasi, notifikasiSaya,
  periksaAmbangStok, tandaiDibaca, tandaiSemuaDibaca,
} from "../src/lib/notifications";

let gagal = 0;
const ok = (nama: string, lulus: boolean, detail = "") => {
  console.log(`  ${lulus ? "PASS" : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
  if (!lulus) gagal++;
};

const TANDA = "UJIMS";
const U = "ujims"; // username wajib huruf kecil

async function bersih() {
  const sites = (
    await query<RowDataPacket & { id: number }>(`SELECT id FROM sites WHERE kode LIKE '${TANDA}%'`)
  ).map((r) => r.id);
  await execute(`DELETE FROM notifications WHERE judul LIKE '${TANDA}%'`);
  await execute(`DELETE FROM user_sites WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${U}%')`);
  if (sites.length) {
    const s = sites.join(",");
    await execute(`DELETE FROM notifications WHERE site_id IN (${s})`);
    await execute(`DELETE FROM user_sites WHERE site_id IN (${s})`);
    await execute(`DELETE FROM stock_movements WHERE site_id IN (${s})`);
    await execute(`DELETE FROM item_stocks WHERE site_id IN (${s})`);
  }
  await execute(`DELETE FROM doctor_profiles WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${U}%')`);
  await execute(`DELETE FROM users WHERE username LIKE '${U}%'`);
  await execute(`DELETE FROM items WHERE kode LIKE '${TANDA}%'`);
  if (sites.length) await execute(`DELETE FROM sites WHERE id IN (${sites.join(",")})`);
}
await bersih();

const siteA = (await execute(`INSERT INTO sites (kode, nama) VALUES ('${TANDA}-A', 'Uji MS Cabang A')`)).insertId;
const siteB = (await execute(`INSERT INTO sites (kode, nama) VALUES ('${TANDA}-B', 'Uji MS Cabang B')`)).insertId;
const siteC = (await execute(`INSERT INTO sites (kode, nama) VALUES ('${TANDA}-C', 'Uji MS Cabang C')`)).insertId;

// =====================================================================
console.log("\n== 1. Penugasan lintas cabang ==");
// =====================================================================

const dokterGanda = await simpanPengguna(
  penggunaSchema.parse({
    nama: "Dokter Dua Cabang", username: `${U}ganda`, role_code: "dokter",
    site_id: siteA, site_ids: [siteB], password: "rahasia12345",
    tarif_konsultasi: 50000,
  }),
);
const dokterTunggal = await simpanPengguna(
  penggunaSchema.parse({
    nama: "Dokter Satu Cabang", username: `${U}tunggal`, role_code: "dokter",
    site_id: siteA, password: "rahasia12345", tarif_konsultasi: 50000,
  }),
);
const perawatB = await simpanPengguna(
  penggunaSchema.parse({
    nama: "Perawat B", username: `${U}perawat`, role_code: "perawat",
    site_id: siteB, password: "rahasia12345",
  }),
);

const cabangGanda = await cabangPengguna(dokterGanda.id, siteA);
ok("cabang induk selalu jadi elemen pertama", cabangGanda[0] === siteA, cabangGanda.join(","));
ok("penugasan tambahan ikut terbaca", cabangGanda.includes(siteB) && cabangGanda.length === 2);
ok("dokter satu cabang hanya punya satu", (await cabangPengguna(dokterTunggal.id, siteA)).length === 1);

// Cabang induk tidak boleh tercatat ganda di user_sites.
await simpanPengguna(
  penggunaSchema.parse({
    nama: "Dokter Dua Cabang", username: `${U}ganda`, role_code: "dokter",
    site_id: siteA, site_ids: [siteA, siteB], tarif_konsultasi: 50000,
  }),
  dokterGanda.id,
);
const barisUS = await query<RowDataPacket & { site_id: number }>(
  `SELECT site_id FROM user_sites WHERE user_id = ?`, [dokterGanda.id]);
ok(
  "cabang induk tidak ikut disimpan di user_sites",
  barisUS.length === 1 && Number(barisUS[0].site_id) === siteB,
  "duplikasi membuat pencabutan cabang induk jadi ambigu",
);

// Pencabutan harus benar-benar menghapus.
await simpanPengguna(
  penggunaSchema.parse({
    nama: "Dokter Dua Cabang", username: `${U}ganda`, role_code: "dokter",
    site_id: siteA, site_ids: [siteC], tarif_konsultasi: 50000,
  }),
  dokterGanda.id,
);
const setelahUbah = await cabangPengguna(dokterGanda.id, siteA);
ok(
  "penugasan yang dicabut benar-benar hilang",
  !setelahUbah.includes(siteB) && setelahUbah.includes(siteC),
  `${setelahUbah.join(",")} — menambah saja akan menyisakan akses lama`,
);

// Kembalikan ke A + B untuk uji berikutnya.
await simpanPengguna(
  penggunaSchema.parse({
    nama: "Dokter Dua Cabang", username: `${U}ganda`, role_code: "dokter",
    site_id: siteA, site_ids: [siteB], tarif_konsultasi: 50000,
  }),
  dokterGanda.id,
);

// Cabang nonaktif tidak boleh memberi akses.
await execute(`UPDATE sites SET is_active = 0 WHERE id = ?`, [siteB]);
ok(
  "penugasan ke cabang nonaktif diabaikan",
  !(await cabangPengguna(dokterGanda.id, siteA)).includes(siteB),
  "penugasan lama tidak boleh menghidupkan kembali cabang yang ditutup",
);
await execute(`UPDATE sites SET is_active = 1 WHERE id = ?`, [siteB]);

// =====================================================================
console.log("\n== 2. Aturan perpindahan cabang (murni, tanpa database) ==");
// =====================================================================

const sesi = (o: Partial<SessionUser>): SessionUser => ({
  id: 1, nama: "x", username: "x", role: "dokter", roleNama: "Dokter",
  siteId: siteA, siteNama: null, siteIds: [siteA], mustChangePw: false, ...o,
});

ok("satu penugasan → tidak boleh berpindah", !bolehPindahCabang(sesi({})));
ok("dua penugasan → boleh berpindah", bolehPindahCabang(sesi({ siteIds: [siteA, siteB] })));
ok("Super Admin selalu boleh", bolehPindahCabang(sesi({ role: "super_admin", siteIds: [] })));

ok("cabang penugasan diizinkan", bolehKeCabang(sesi({ siteIds: [siteA, siteB] }), siteB));
ok("cabang di luar penugasan ditolak", !bolehKeCabang(sesi({ siteIds: [siteA, siteB] }), siteC));
ok("Super Admin boleh ke cabang mana pun", bolehKeCabang(sesi({ role: "super_admin", siteIds: [] }), siteC));

ok(
  "effectiveSiteId menolak cabang di luar penugasan",
  effectiveSiteId(sesi({ siteIds: [siteA] }), siteC) === siteA,
  "jatuh kembali ke cabang induk, bukan mengikuti permintaan",
);
ok(
  "effectiveSiteId menerima cabang penugasan",
  effectiveSiteId(sesi({ siteIds: [siteA, siteB] }), siteB) === siteB,
);

// =====================================================================
console.log("\n== 3. Dokter tugas-ganda muncul di cabang keduanya ==");
// =====================================================================

const dokterA = (await daftarDokter(siteA)).map((d) => d.id);
const dokterB = (await daftarDokter(siteB)).map((d) => d.id);
const dokterC = (await daftarDokter(siteC)).map((d) => d.id);

ok("dokter tugas-ganda muncul di cabang induk", dokterA.includes(dokterGanda.id));
ok(
  "dokter tugas-ganda MUNCUL di cabang penugasan tambahan",
  dokterB.includes(dokterGanda.id),
  "inilah yang sebelumnya tidak mungkin — pendaftaran menyaring dengan users.site_id saja",
);
ok("dokter satu cabang TIDAK muncul di cabang lain", !dokterB.includes(dokterTunggal.id));
ok("cabang tanpa penugasan tetap kosong", !dokterC.includes(dokterGanda.id));

const pegawaiB = (await daftarPegawai(siteB)).map((p) => p.id);
ok("daftar pegawai HR ikut memuat penugasan tambahan", pegawaiB.includes(dokterGanda.id));
ok("daftar pegawai tetap memuat pegawai asli cabang", pegawaiB.includes(perawatB.id));

const semua = (await daftarDokter(null)).map((d) => d.id);
ok("siteId null (Super Admin) memuat semua dokter", semua.includes(dokterGanda.id) && semua.includes(dokterTunggal.id));

// Predikat SQL bersamanya benar-benar dipakai lintas modul.
const cek = await queryOne<RowDataPacket & { n: number }>(
  `SELECT COUNT(*) AS n FROM users u WHERE u.id = ? AND ${SQL_BERTUGAS_DI_CABANG}`,
  [dokterGanda.id, siteB, siteB, siteB],
);
ok("predikat SQL bersama berjalan", Number(cek?.n) === 1);

// =====================================================================
console.log("\n== 4. Notifikasi ==");
// =====================================================================

const sesiPerawatB = sesi({
  id: perawatB.id, role: "perawat", roleNama: "Perawat",
  siteId: siteB, siteIds: [siteB],
});
const sesiDokterGanda = sesi({
  id: dokterGanda.id, role: "dokter", siteId: siteA, siteIds: [siteA, siteB],
});

await kirimNotifikasi(
  { userId: dokterGanda.id },
  { jenis: "hasil_lab", judul: `${TANDA} hasil lab pribadi`, siteId: siteA },
);
await kirimNotifikasi(
  { roleCode: "perawat", siteId: siteB },
  { jenis: "resep_masuk", judul: `${TANDA} siaran perawat B`, siteId: siteB },
);
await kirimNotifikasi(
  { roleCode: "perawat", siteId: siteA },
  { jenis: "resep_masuk", judul: `${TANDA} siaran perawat A`, siteId: siteA },
);

const notifDokter = await notifikasiSaya(sesiDokterGanda);
ok("notifikasi perorangan sampai ke pemiliknya", notifDokter.some((n) => n.judul.endsWith("pribadi")));
ok("notifikasi peran lain tidak bocor", !notifDokter.some((n) => n.judul.includes("perawat")));

const notifPerawat = await notifikasiSaya(sesiPerawatB);
ok("siaran peran sampai ke perannya", notifPerawat.some((n) => n.judul.endsWith("perawat B")));
ok(
  "siaran peran TERSARING per cabang",
  !notifPerawat.some((n) => n.judul.endsWith("perawat A")),
  "perawat cabang B tidak melihat antrean kerja cabang A",
);
ok("siaran ditandai sebagai bersama", notifPerawat.find((n) => n.judul.endsWith("perawat B"))!.untuk_peran === 1);
ok("notifikasi pribadi tidak ditandai bersama", notifDokter.find((n) => n.judul.endsWith("pribadi"))!.untuk_peran === 0);

ok("hitungan belum dibaca benar", (await hitungBelumDibaca(sesiPerawatB)) === 1);

// --- Kepemilikan ---
const notifOrangLain = notifDokter.find((n) => n.judul.endsWith("pribadi"))!;
ok(
  "orang lain tidak bisa menandai notifikasi pribadi",
  !(await tandaiDibaca(notifOrangLain.id, sesiPerawatB)),
  "syarat kepemilikan ada di klausa WHERE, bukan cek terpisah",
);
ok("pemiliknya bisa menandai", await tandaiDibaca(notifOrangLain.id, sesiDokterGanda));
ok("setelah dibaca, hitungan turun", (await hitungBelumDibaca(sesiDokterGanda)) === 0);

await kirimNotifikasi(
  { roleCode: "perawat", siteId: siteB },
  { jenis: "kadaluarsa", judul: `${TANDA} siaran kedua`, siteId: siteB },
);
ok("tandai semua hanya menyentuh milik sendiri", (await tandaiSemuaDibaca(sesiPerawatB)) === 2);
ok("tidak ada sisa belum dibaca", (await hitungBelumDibaca(sesiPerawatB)) === 0);

// --- Ambang stok ---
const itemUji = (
  await execute(
    `INSERT INTO items (kode, tipe, nama, satuan_dasar, hpp, harga_jual, min_stock)
     VALUES ('${TANDA}-OBT', 'obat', 'Uji Obat Ambang', 'tablet', 100, 500, 10)`,
  )
).insertId;
await execute(
  `INSERT INTO item_stocks (site_id, item_id, qty_on_hand) VALUES (?,?,?)`,
  [siteB, itemUji, 50],
);

await periksaAmbangStok(siteB, [itemUji]);
const sesiFarmasiB = sesi({ id: 999999, role: "farmasi", siteId: siteB, siteIds: [siteB] });
ok(
  "stok di atas minimum tidak memicu peringatan",
  (await notifikasiSaya(sesiFarmasiB)).length === 0,
);

await execute(`UPDATE item_stocks SET qty_on_hand = 5 WHERE site_id=? AND item_id=?`, [siteB, itemUji]);
await periksaAmbangStok(siteB, [itemUji]);
const peringatan = await notifikasiSaya(sesiFarmasiB);
ok("stok di bawah minimum memicu peringatan", peringatan.length === 1, peringatan[0]?.judul);
ok("jenisnya stok_menipis", peringatan[0]?.jenis === "stok_menipis");

await periksaAmbangStok(siteB, [itemUji]);
ok(
  "peringatan tidak digandakan selama yang lama belum dibaca",
  (await notifikasiSaya(sesiFarmasiB)).length === 1,
  "membanjiri antrean farmasi dengan peringatan identik tidak membantu siapa pun",
);

await execute(`UPDATE item_stocks SET qty_on_hand = 0 WHERE site_id=? AND item_id=?`, [siteB, itemUji]);
await tandaiSemuaDibaca(sesiFarmasiB);
await periksaAmbangStok(siteB, [itemUji]);
const habis = await notifikasiSaya(sesiFarmasiB, { hanyaBelumDibaca: true });
ok("stok habis dibedakan dari menipis", habis[0]?.jenis === "stok_habis", habis[0]?.judul);

ok(
  "peringatan tidak bocor ke cabang lain",
  (await notifikasiSaya(sesi({ id: 999998, role: "farmasi", siteId: siteA, siteIds: [siteA] }))).length === 0,
);

// =====================================================================
await bersih();
console.log(`\n${gagal === 0 ? "SEMUA UJI LULUS" : `${gagal} UJI GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
