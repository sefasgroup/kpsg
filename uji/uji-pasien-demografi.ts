/**
 * Uji dua field demografi pada pendaftaran pasien baru.
 *
 *   node uji/jalankan.mjs uji-pasien-demografi.ts
 *
 * Butuh data contoh (scripts/data-contoh.ts) karena memakai cabang PST.
 */
import type { RowDataPacket } from "mysql2";
import { execute, pool, queryOne } from "@/lib/db";
import { buatPasien } from "@/lib/patients";
import { patientSchema, PENDIDIKAN, STATUS_PERKAWINAN } from "@/lib/validations/patient";

let gagal = 0;
const ok = (n: string, l: boolean, d = "") => {
  console.log(`  ${l ? "PASS" : "GAGAL"}  ${n}${d ? " — " + d : ""}`);
  if (!l) gagal++;
};

const site = Number((await queryOne<RowDataPacket & { id: number }>(
  `SELECT id FROM sites WHERE kode='PST'`))!.id);
const user = Number((await queryOne<RowDataPacket & { id: number }>(
  `SELECT id FROM users WHERE username='admin.pst'`))!.id);

await execute(`DELETE FROM patients WHERE nik LIKE '9999%'`);

const dasar = {
  nik: "9999000000000001", nama: "Uji Demografi", tanggal_lahir: "1990-05-17",
  jenis_kelamin: "L", jenis_pasien: "umum",
};

console.log("\n== Tersimpan ==");
const p = await buatPasien(
  patientSchema.parse({
    ...dasar, agama: "Islam", pekerjaan: "Wiraswasta",
    status_perkawinan: "Cerai Mati", pendidikan: "SMA/K",
  }),
  site, user,
);
const r = await queryOne<RowDataPacket & { status_perkawinan: string; pendidikan: string }>(
  `SELECT status_perkawinan, pendidikan FROM patients WHERE id = ?`, [p.id],
);
ok("status perkawinan tersimpan", r?.status_perkawinan === "Cerai Mati", String(r?.status_perkawinan));
ok("pendidikan tersimpan", r?.pendidikan === "SMA/K", String(r?.pendidikan));

console.log("\n== Boleh kosong ==");
const p2 = await buatPasien(
  patientSchema.parse({ ...dasar, nik: "9999000000000002", status_perkawinan: "", pendidikan: "" }),
  site, user,
);
const r2 = await queryOne<RowDataPacket & { status_perkawinan: null; pendidikan: null }>(
  `SELECT status_perkawinan, pendidikan FROM patients WHERE id = ?`, [p2.id],
);
ok("kosong disimpan sebagai NULL, bukan string kosong",
  r2?.status_perkawinan === null && r2?.pendidikan === null);

console.log("\n== Nilai di luar daftar ditolak ==");
for (const [field, nilai] of [
  ["pendidikan", "SMU"], ["pendidikan", "S1"],
  ["status_perkawinan", "Duda"], ["status_perkawinan", "menikah"],
] as const) {
  const h = patientSchema.safeParse({ ...dasar, nik: "9999000000000003", [field]: nilai });
  ok(`${field}="${nilai}" ditolak`, !h.success,
    "ejaan bebas membuat laporan demografi tidak bisa dikelompokkan");
}

console.log("\n== Seluruh pilihan dropdown sah ==");
for (const v of PENDIDIKAN) {
  ok(`pendidikan "${v}"`, patientSchema.safeParse({ ...dasar, pendidikan: v }).success);
}
for (const v of STATUS_PERKAWINAN) {
  ok(`status "${v}"`, patientSchema.safeParse({ ...dasar, status_perkawinan: v }).success);
}

await execute(`DELETE FROM patients WHERE nik LIKE '9999%'`);
console.log(`\n${gagal === 0 ? "SEMUA LULUS" : `${gagal} GAGAL`}\n`);
await pool.end();
process.exit(gagal === 0 ? 0 : 1);
