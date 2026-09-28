import type { RowDataPacket } from "mysql2";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { requireSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { hitungBelumDibaca, notifikasiSaya } from "@/lib/notifications";
import { bolehPindahCabang } from "@/lib/session";
import { tanggalHariIni } from "@/lib/tanggal";

type SiteRow = RowDataPacket & { id: number; nama: string };

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const bolehPindah = bolehPindahCabang(session);
  const lintasCabang = session.role === "super_admin";

  /*
   * Cabang yang boleh dipilih:
   *   - Super Admin  → seluruh cabang aktif;
   *   - lainnya      → hanya cabang penugasannya (users.site_id + user_sites).
   *
   * Penyaringan dilakukan di SQL, bukan di klien: daftar ini yang mengisi
   * pemilih cabang, dan pilihan di luar hak tidak boleh sampai terlihat.
   */
  const sites = !bolehPindah
    ? []
    : lintasCabang
      ? await query<SiteRow>(
          `SELECT id, nama FROM sites
            WHERE deleted_at IS NULL AND is_active = 1
            ORDER BY nama`,
        )
      : await query<SiteRow>(
          `SELECT id, nama FROM sites
            WHERE deleted_at IS NULL AND is_active = 1
              AND id IN (${session.siteIds.map(() => "?").join(",") || "NULL"})
            ORDER BY nama`,
          session.siteIds,
        );

  // Nama cabang aktif tidak selalu ada di token (mis. setelah berpindah),
  // jadi diambil dari daftar cabang yang sudah dimuat.
  const siteNama =
    sites.find((s) => s.id === session.siteId)?.nama ?? session.siteNama ?? null;

  const [notifikasi, belumDibaca] = await Promise.all([
    notifikasiSaya(session, { limit: 30 }),
    hitungBelumDibaca(session),
  ]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        role={session.role}
        nama={session.nama}
        roleNama={session.roleNama}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          role={session.role}
          nama={session.nama}
          roleNama={session.roleNama}
          siteNama={siteNama}
          sites={sites.map((s) => ({ id: s.id, nama: s.nama }))}
          activeSiteId={session.siteId}
          bolehPindah={bolehPindah}
          lintasCabang={lintasCabang}
          today={tanggalHariIni()}
          notifikasi={notifikasi.map((n) => ({
            id: n.id,
            jenis: n.jenis,
            judul: n.judul,
            pesan: n.pesan,
            link: n.link,
            is_read: n.is_read,
            created_at: n.created_at,
            untuk_peran: n.untuk_peran,
            site_id: n.site_id === null ? null : Number(n.site_id),
            site_nama: n.site_nama,
          }))}
          belumDibaca={belumDibaca}
        />
        {/*
          Padding ikut mengecil di layar sempit. 20px di setiap sisi layar
          375px berarti seperdelapan lebarnya habis untuk ruang kosong.
        */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-5">
          {children}
        </main>
      </div>
    </div>
  );
}
