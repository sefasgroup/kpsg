"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { bolehKeCabang, setActiveSite } from "@/lib/session";
import {
  hitungBelumDibaca,
  notifikasiSaya,
  tandaiDibaca,
  tandaiSemuaDibaca,
  type NotifikasiRow,
} from "@/lib/notifications";

/**
 * Seluruh aksi di sini mengambil identitas dari sesi, tidak pernah dari
 * parameter — notifikasi orang lain tidak boleh bisa dibaca atau ditandai
 * hanya dengan menebak id-nya.
 */

/**
 * Muat ulang daftar notifikasi BESERTA jumlah yang belum dibaca.
 *
 * Keduanya dikembalikan sekali jalan, bukan lewat dua aksi terpisah:
 * daftar dibatasi 30 baris sementara lencana harus menghitung seluruhnya,
 * dan menurunkan angka lencana dari daftar yang terpotong akan membuatnya
 * berbohong begitu notifikasi melewati 30.
 */
export async function muatNotifikasiAction(): Promise<{
  rows: NotifikasiRow[];
  belumDibaca: number;
}> {
  const session = await requireSession();
  const [rows, belumDibaca] = await Promise.all([
    notifikasiSaya(session, { limit: 30 }),
    hitungBelumDibaca(session),
  ]);
  return { rows, belumDibaca };
}

export async function tandaiDibacaAction(id: number): Promise<boolean> {
  const session = await requireSession();
  const berhasil = await tandaiDibaca(id, session);
  if (berhasil) revalidatePath("/", "layout");
  return berhasil;
}

/**
 * Membuka notifikasi: menandainya terbaca DAN berpindah ke cabang tempat
 * peristiwanya terjadi.
 *
 * Tanpa perpindahan itu, dokter multi-cabang menekan notifikasi lalu
 * mendapat 404. Penyebabnya bukan tautannya melainkan cabang aktifnya:
 * `dr.bayu` masuk dengan cabang induk Pusat, sementara pasien yang
 * memanggilnya ada di Sumedang, dan setiap layar detail menyaring
 * `WHERE site_id = <cabang aktif>`.
 *
 * Berpindah otomatis adalah perilaku yang benar, bukan sekadar tambalan:
 * notifikasi itu artinya "ada yang menunggu Anda DI SANA". Membiarkan
 * pengguna menebak sendiri cabang mana yang harus dipilih hanya memindahkan
 * kebingungannya.
 */
export async function bukaNotifikasiAction(
  id: number,
): Promise<{ link: string | null; pindahKe: string | null }> {
  const session = await requireSession();

  // Notifikasi diambil lewat daftar milik sesi ini — bukan dicari langsung
  // berdasarkan id — supaya id milik orang lain tidak bisa dipakai mengintip
  // cabang mana pun.
  const notif = (await notifikasiSaya(session, { limit: 100 })).find((n) => n.id === id);
  if (!notif) return { link: null, pindahKe: null };

  if (!notif.is_read) await tandaiDibaca(id, session);

  let pindahKe: string | null = null;
  if (
    notif.site_id &&
    notif.site_id !== session.siteId &&
    bolehKeCabang(session, notif.site_id)
  ) {
    await setActiveSite(notif.site_id);
    pindahKe = notif.site_nama;
  }

  revalidatePath("/", "layout");
  return { link: notif.link, pindahKe };
}

export async function tandaiSemuaDibacaAction(): Promise<number> {
  const session = await requireSession();
  const n = await tandaiSemuaDibaca(session);
  revalidatePath("/", "layout");
  return n;
}
