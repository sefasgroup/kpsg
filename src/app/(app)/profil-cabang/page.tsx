import type { Metadata } from "next";
import { Building2, Stethoscope, UserCog, Users } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { getProfilCabang, statistikCabang } from "@/lib/laporan";
import { formatAngka } from "@/lib/format";
import { FormProfilCabang } from "./profil-form";

export const metadata: Metadata = { title: "Profil Cabang" };
export const dynamic = "force-dynamic";

export default async function ProfilCabangPage() {
  const session = await requireRole("admin_cabang", "super_admin");

  if (!session.siteId) {
    return (
      <EmptyState
        icon={Building2}
        title="Pilih cabang terlebih dahulu"
        description="Halaman ini mengelola identitas satu cabang. Pilih cabang aktif di kanan atas."
      />
    );
  }

  const [profil, stat] = await Promise.all([
    getProfilCabang(session.siteId),
    statistikCabang(session.siteId),
  ]);

  if (!profil) {
    return <EmptyState icon={Building2} title="Cabang tidak ditemukan" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Pengguna Aktif" value={Number(stat?.pengguna ?? 0)} icon={UserCog} />
        <StatCard label="Dokter" value={Number(stat?.dokter ?? 0)} icon={Stethoscope} />
        <StatCard label="Pasien Terdaftar" value={formatAngka(Number(stat?.pasien ?? 0))} icon={Users} />
        <StatCard
          label="Total Kunjungan"
          value={formatAngka(Number(stat?.kunjungan ?? 0))}
          sub={`${Number(stat?.poli ?? 0)} poli aktif`}
          icon={Building2}
        />
      </div>

      <FormProfilCabang
        awal={{
          kode: profil.kode,
          nama: profil.nama,
          nama_legal: profil.nama_legal,
          no_izin_klinik: profil.no_izin_klinik,
          npwp: profil.npwp,
          alamat: profil.alamat,
          kelurahan: profil.kelurahan,
          kecamatan: profil.kecamatan,
          kota: profil.kota,
          provinsi: profil.provinsi,
          kode_pos: profil.kode_pos,
          telepon: profil.telepon,
          email: profil.email,
          header_cetak: profil.header_cetak,
          footer_cetak: profil.footer_cetak,
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle icon={Building2}>Batas Wewenang</CardTitle>
        </CardHeader>
        <ul className="flex flex-col gap-1.5 text-body text-ink">
          <li>
            <strong>Bisa diubah di sini:</strong> identitas dan kontak cabang yang
            tercetak di kop surat seluruh dokumen medis.
          </li>
          <li>
            <strong>Hanya Super Admin:</strong> membuat cabang baru, mengubah kode
            cabang, menonaktifkan cabang, serta menambah pengguna dan perannya.
          </li>
          <li>
            <strong>Tidak bisa diubah:</strong> kode cabang{" "}
            <span className="font-mono">{profil.kode}</span> — kode ini sudah
            melekat pada setiap No. RM, nomor resep, dan nomor invoice yang pernah
            terbit.
          </li>
        </ul>
        <p className="mt-3 text-meta text-ink-muted">
          Setiap perubahan di halaman ini tercatat di Audit Log lengkap dengan
          nilai sebelumnya.
        </p>
      </Card>
    </div>
  );
}
