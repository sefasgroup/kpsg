import { type NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { requireSession } from "@/lib/auth";
import { bacaBerkas } from "@/lib/berkas";
import { queryOne } from "@/lib/db";
import { pemilikLampiran } from "@/lib/lampiran-rme";

/**
 * Melayani berkas unggahan — SATU-SATUNYA jalan keluar dari `storage/`.
 *
 * Setiap permintaan diperiksa dua hal:
 *   1. pengguna sudah masuk;
 *   2. pengguna berhak atas berkas ITU.
 *
 * Poin kedua yang membedakannya dari sekadar "menaruh berkas di balik
 * login". Lampiran cuti sakit adalah dokumen medis pegawai: rekan sekerja
 * yang juga punya akun tidak berhak membacanya. Yang boleh hanya pemohon
 * sendiri dan Admin Cabang tempat pengajuan itu diajukan.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ kunci: string[] }> },
) {
  const session = await requireSession();
  const { kunci: bagian } = await ctx.params;
  const kunci = bagian.join("/");

  const boleh = await berhak(kunci, session);
  if (!boleh) {
    // 404, bukan 403: membedakan keduanya membocorkan berkas mana yang ada.
    return new NextResponse("Tidak ditemukan", { status: 404 });
  }

  const berkas = await bacaBerkas(kunci);
  if (!berkas) return new NextResponse("Tidak ditemukan", { status: 404 });

  return new NextResponse(new Uint8Array(berkas.isi), {
    headers: {
      "Content-Type": berkas.mime,
      // `inline` agar bisa dilihat langsung; `nosniff` agar peramban tidak
      // menebak-nebak tipe dan mengeksekusi isinya sebagai sesuatu yang lain.
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}

async function berhak(
  kunci: string,
  session: Awaited<ReturnType<typeof requireSession>>,
): Promise<boolean> {
  const kategori = kunci.split("/")[0];

  // Logo cabang muncul di kop surat setiap dokumen — seluruh pengguna
  // yang sudah masuk memang perlu melihatnya.
  if (kategori === "logo") return true;

  if (kategori === "lampiran") {
    const row = await queryOne<RowDataPacket & { user_id: number; site_id: number }>(
      `SELECT user_id, site_id FROM leave_requests WHERE lampiran_path = ?`,
      [kunci],
    );
    if (!row) return false;
    if (Number(row.user_id) === session.id) return true;
    if (session.role === "super_admin") return true;
    return (
      session.role === "admin_cabang" && Number(row.site_id) === session.siteId
    );
  }

  /*
   * Dokumen pendukung rekam medis.
   *
   * Dibatasi ke peran yang memang berwenang klinis (CLAUDE.md §2.1) dan ke
   * cabang tempat dokumen itu diunggah. Perawat, petugas lab, farmasi, dan
   * kasir TIDAK termasuk — pemisahan tugas di sistem ini ketat, dan kasir
   * secara khusus memang dirancang tidak melihat detail klinis. Berkas
   * seperti hasil USG atau rontgen adalah detail klinis.
   */
  if (kategori === "rekam") {
    if (session.role !== "dokter" && session.role !== "super_admin") return false;
    const doc = await pemilikLampiran(kunci);
    if (!doc) return false;
    return session.role === "super_admin" || doc.siteId === session.siteId;
  }

  if (kategori === "ttd") {
    const row = await queryOne<RowDataPacket & { user_id: number }>(
      `SELECT user_id FROM doctor_profiles WHERE ttd_path = ?`,
      [kunci],
    );
    if (!row) return false;
    // Tanda tangan hanya boleh diakses pemiliknya sendiri. Gambar tanda
    // tangan dokter adalah bahan pemalsuan surat keterangan; tidak ada
    // alasan operasional bagi orang lain untuk mengunduhnya.
    return Number(row.user_id) === session.id;
  }

  return false;
}
