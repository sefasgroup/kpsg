/**
 * Memeriksa data contoh multi-cabang yang dibuat `scripts/data-contoh.ts`.
 *
 *   node uji/jalankan.mjs scripts/data-contoh.ts    # isi dulu
 *   node uji/jalankan.mjs uji-data-contoh.ts        # baru periksa
 *
 * Yang diuji bukan datanya semata, melainkan hal yang paling mudah salah pada
 * sistem multi-cabang: apakah penugasan benar-benar membatasi, apakah daftar
 * dokter di pendaftaran tersaring per cabang, dan apakah stok tiap cabang
 * benar-benar terpisah. Kekeliruan seperti "stok cabang tertukar" tidak
 * terlihat dari layar — hanya dari pemeriksaan seperti ini.
 */
import type { RowDataPacket } from "mysql2";
import { pool, query, queryOne } from "@/lib/db";
import { cabangPengguna } from "@/lib/auth";
import { daftarDokter } from "@/lib/visits";

let gagal = 0;
const ok = (n: string, l: boolean, d = "") => {
  console.log(`  ${l ? "PASS" : "GAGAL"}  ${n}${d ? " — " + d : ""}`);
  if (!l) gagal++;
};

const site: Record<string, number> = {};
for (const r of await query<RowDataPacket & { id: number; kode: string }>(
  `SELECT id, kode FROM sites`,
)) site[r.kode] = Number(r.id);

if (!site.PST || !site.CMH || !site.SMD) {
  console.log(`
Data contoh belum ada — uji ini dilewati, bukan gagal.

    node uji/jalankan.mjs scripts/data-contoh.ts
`);
  await pool.end();
  process.exit(0);
}

console.log("\n== Penugasan cabang ==");

/*
 * Diuji sebagai INVARIAN, bukan sebagai bentuk data seed.
 *
 * Versi sebelumnya memaku "dr.bayu bertugas di 3 cabang". Begitu Super Admin
 * mengubah penugasannya lewat UI — hal yang wajar dan tercatat di audit log —
 * uji ini gagal dan terbaca seperti kerusakan kode. Suite yang berteriak
 * palsu akan mulai diabaikan, termasuk saat teriakannya benar.
 *
 * Yang diperiksa sekarang: apa pun penugasannya, `cabangPengguna()` harus
 * sama persis dengan cabang induk + `user_sites`.
 */
const dokter = await query<RowDataPacket & {
  id: number; username: string; nama: string; site_id: number; tambahan: string | null;
}>(
  `SELECT u.id, u.username, u.nama, u.site_id,
          (SELECT GROUP_CONCAT(us.site_id) FROM user_sites us WHERE us.user_id = u.id) AS tambahan
     FROM users u JOIN roles r ON r.id = u.role_id
    WHERE r.code = 'dokter' AND u.deleted_at IS NULL`,
);

ok("ada dokter di data contoh", dokter.length > 0, `${dokter.length} dokter`);

const cabangDari = (d: { site_id: number; tambahan: string | null }) => {
  const s = new Set<number>([Number(d.site_id)]);
  for (const x of (d.tambahan ?? "").split(",").filter(Boolean)) s.add(Number(x));
  return s;
};

for (const d of dokter) {
  const harap = cabangDari(d);
  const nyata = new Set(await cabangPengguna(Number(d.id), Number(d.site_id)));
  ok(
    `${d.username}: penugasan = induk + user_sites`,
    harap.size === nyata.size && [...harap].every((s) => nyata.has(s)),
    `harap {${[...harap].join(",")}} nyata {${[...nyata].join(",")}}`,
  );
}

const multi = dokter.filter((d) => (d.tambahan ?? "").length > 0);
ok(
  "minimal satu dokter ditugaskan lintas cabang",
  multi.length > 0,
  multi.map((d) => d.username).join(", ") || "tidak ada — jalur multi-cabang tidak teruji",
);

console.log("\n== Daftar dokter per cabang (yang dilihat Pendaftaran) ==");

for (const kode of ["PST", "CMH", "SMD"] as const) {
  const s = site[kode];
  // Siapa yang SEHARUSNYA muncul dihitung dari penugasan, bukan dihafal —
  // inilah invariannya: daftar di Pendaftaran = siapa yang ditugaskan di sana.
  const harap = dokter
    .filter((d) => cabangDari(d).has(s))
    .map((d) => d.nama)
    .sort();

  const nyata = (await daftarDokter(s)).map((x) => x.nama).sort();
  ok(
    `${kode}: ${harap.length} dokter sesuai penugasan`,
    harap.length === nyata.length && harap.every((h, i) => h === nyata[i]),
    nyata.join(", ") || "(kosong)",
  );
}

console.log("\n== Stok terpisah per cabang ==");
for (const kode of ["PST", "CMH", "SMD"]) {
  const r = await queryOne<RowDataPacket & { n: number; q: string }>(
    `SELECT COUNT(*) n, COALESCE(SUM(qty_on_hand),0) q FROM item_stocks WHERE site_id = ?`,
    [site[kode]],
  );
  ok(`${kode} punya stok sendiri`, Number(r?.n) > 0, `${r?.n} item, total ${Number(r?.q)}`);
}

const silang = await queryOne<RowDataPacket & { n: number }>(
  `SELECT COUNT(*) n FROM item_stocks a JOIN item_stocks b
     ON a.item_id = b.item_id AND a.site_id <> b.site_id
    WHERE a.qty_on_hand = b.qty_on_hand AND a.site_id < b.site_id`,
);
ok(
  "saldo antar cabang tidak seragam",
  Number(silang?.n) < 20,
  `${silang?.n} pasang kebetulan sama — kalau semua sama, kemungkinan tertukar`,
);

console.log("\n== Pengaturan & tarif per cabang ==");
for (const [kode, skey, harap] of [
  ["PST", "racikan.jasa_racik_default", "5000"],
  ["CMH", "racikan.jasa_racik_default", "4000"],
  ["SMD", "racikan.jasa_racik_default", "3500"],
  ["CMH", "cetak.printer_thermal", "58"],
] as const) {
  const r = await queryOne<RowDataPacket & { svalue: string }>(
    `SELECT svalue FROM settings WHERE site_id = ? AND skey = ?`, [site[kode], skey],
  );
  ok(`${kode} ${skey} = ${harap}`, r?.svalue === harap, String(r?.svalue));
}

const tarif = await queryOne<RowDataPacket & { t: string }>(
  `SELECT t.tarif t FROM site_procedure_tariffs t
     JOIN medical_procedures p ON p.id = t.procedure_id
    WHERE t.site_id = ? AND p.kode = 'TND-001'`, [site.SMD],
);
ok("Sumedang punya override tarif konsultasi", Number(tarif?.t) === 35000, String(tarif?.t));

const tanpaOverride = await queryOne<RowDataPacket & { n: number }>(
  `SELECT COUNT(*) n FROM site_procedure_tariffs t
     JOIN medical_procedures p ON p.id = t.procedure_id
    WHERE t.site_id = ? AND p.kode = 'TND-002'`, [site.SMD],
);
ok("tindakan tanpa override jatuh ke tarif dasar", Number(tanpaOverride?.n) === 0);

console.log("\n== Batch kadaluarsa di Pusat ==");
const exp = await query<RowDataPacket & { no_batch: string; sisa: number }>(
  `SELECT no_batch, DATEDIFF(tanggal_kadaluarsa, CURDATE()) sisa
     FROM item_batches WHERE site_id = ? AND no_batch LIKE 'PST-EXP%'`, [site.PST],
);
ok("batch hampir kadaluarsa ada", exp.some((b) => b.sisa > 0 && b.sisa <= 30));
ok("batch sudah kadaluarsa ada", exp.some((b) => b.sisa < 0), exp.map((b) => `${b.no_batch}:${b.sisa}h`).join(" "));

console.log(`\n${gagal === 0 ? "SEMUA LULUS" : `${gagal} GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
