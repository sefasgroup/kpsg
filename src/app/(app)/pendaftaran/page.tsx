import type { Metadata } from "next";
import {
  CalendarCheck, CalendarClock, ClipboardList, UserPlus, Users,
} from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SegarkanBerkala } from "@/components/ui/segarkan-berkala";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { hitungPasien } from "@/lib/patients";
import {
  daftarDokter, daftarPoli, kunjunganTanggal, kunjunganTertunda,
} from "@/lib/visits";
import { tanggalHariIni } from "@/lib/tanggal";
import { opsiPenjamin } from "@/lib/penjamin";
import { PendaftaranClient } from "./pendaftaran-client";
import { KunjunganHariIni, type BarisKunjungan } from "./kunjungan-hari-ini";

export const metadata: Metadata = { title: "Pendaftaran Pasien" };
export const dynamic = "force-dynamic";

export default async function PendaftaranPage() {
  const session = await requireRole("admin_cabang", "super_admin");
  const site = session.siteId;
  const hariIni = tanggalHariIni();

  const [kunjungan, poliList, dokterList, totalPasien, tertunda, penjamin] =
    await Promise.all([
      kunjunganTanggal(site, hariIni),
      daftarPoli(site),
      daftarDokter(site),
      hitungPasien(site),
      kunjunganTertunda(site, hariIni),
      opsiPenjamin(),
    ]);

  const baru = kunjungan.filter((v) => v.jenis_kunjungan === "baru").length;
  const belumSelesai = kunjungan.filter(
    (v) => v.status !== "selesai" && v.status !== "batal",
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Kunjungan Hari Ini" value={kunjungan.length} icon={CalendarCheck} />
        <StatCard label="Pasien Baru Hari Ini" value={baru} icon={UserPlus} />
        <StatCard
          label="Masih Dalam Proses"
          value={belumSelesai}
          tone={belumSelesai > 0 ? "info" : "default"}
          icon={ClipboardList}
        />
        <StatCard label="Total Pasien Terdaftar" value={totalPasien} icon={Users} />
      </div>

      <PendaftaranClient
        penjamin={penjamin.map((p) => ({
          id: Number(p.id), kode: p.kode, nama: p.nama,
        }))}
        poliList={poliList.map((p) => ({ id: p.id, nama: p.nama }))}
        dokterList={dokterList.map((d) => ({
          id: d.id,
          nama: [d.gelar_depan, d.nama].filter(Boolean).join(" "),
          // Keterangan menyebut kondisi hari ini, bukan sekadar spesialisasi:
          // petugas frontdesk perlu tahu sebelum memilih.
          keterangan: d.pengganti_nama
            ? `digantikan ${d.pengganti_nama}`
            : Number(d.tanpa_pengganti) === 1
              ? "BERHALANGAN — belum ada pengganti"
              : d.spesialisasi,
          nonaktif: Number(d.tanpa_pengganti) === 1,
        }))}
      />

      {/*
        ---------- Kunjungan tertunda dari hari sebelumnya ----------
        Pendaftaran adalah SATU-SATUNYA tempat kunjungan bisa dibatalkan.
        Selama layar ini hanya menampilkan hari ini, kunjungan yang tertinggal
        semalam tidak punya jalan keluar sama sekali: tidak muncul di unit mana
        pun, dan tidak bisa ditutup dari mana pun.

        Diletakkan DI ATAS daftar hari ini karena inilah yang butuh keputusan;
        daftar hari ini berjalan sendiri.
      */}
      {tertunda.length > 0 ? (
        <Card className="border-warning/30">
          <CardHeader>
            <CardTitle icon={CalendarClock}>Tertunda dari Hari Sebelumnya</CardTitle>
          </CardHeader>
          <p className="mb-2.5 text-meta text-ink-muted">
            Kunjungan ini belum selesai maupun dibatalkan, sehingga masih
            dianggap sedang dilayani oleh sistem. Batalkan bila pasien memang
            tidak jadi dilayani — kunci stok resepnya ikut dilepas.
          </p>
          <KunjunganHariIni data={tertunda as unknown as BarisKunjungan[]} tampilkanTanggal />
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle icon={ClipboardList}>Kunjungan Hari Ini</CardTitle>
          <SegarkanBerkala />
        </CardHeader>
        <KunjunganHariIni data={kunjungan as unknown as BarisKunjungan[]} />
      </Card>
    </div>
  );
}
