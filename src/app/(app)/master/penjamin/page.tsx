import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { daftarPenjamin, tarifPenjamin } from "@/lib/penjamin";
import { cariTindakanAction, cariBarangAction } from "./cari-actions";
import { PenjaminClient, type BarisPenjamin, type BarisTarif } from "./penjamin-client";

export const metadata: Metadata = { title: "Penjamin & Tarif Kontrak" };
export const dynamic = "force-dynamic";

export default async function MasterPenjaminPage({
  searchParams,
}: {
  searchParams: Promise<{ penjamin?: string }>;
}) {
  await requireRole("super_admin");
  const sp = await searchParams;
  const terpilihId = Number(sp.penjamin) || null;

  const daftar = await daftarPenjamin();
  const tarif = terpilihId ? await tarifPenjamin(terpilihId) : [];

  return (
    <PenjaminClient
      daftar={daftar.map<BarisPenjamin>((p) => ({
        id: Number(p.id),
        kode: p.kode,
        nama: p.nama,
        jenis: p.jenis,
        npwp: p.npwp,
        alamat: p.alamat,
        telepon: p.telepon,
        email: p.email,
        pic_nama: p.pic_nama,
        pic_telepon: p.pic_telepon,
        termin_hari: Number(p.termin_hari),
        plafon: Number(p.plafon_per_kunjungan),
        catatan: p.catatan,
        is_active: Number(p.is_active) === 1,
        jumlahTarif: Number(p.jumlah_tarif),
        jumlahPasien: Number(p.jumlah_pasien),
      }))}
      tarifTerpilih={tarif.map<BarisTarif>((t) => ({
        id: Number(t.id),
        sasaran: t.sasaran,
        kodeSasaran: t.kode_sasaran,
        jenisSasaran: t.jenis_sasaran,
        harga: Number(t.harga),
        hargaNormal: Number(t.harga_normal),
      }))}
      terpilihId={terpilihId}
      cariTindakan={cariTindakanAction}
      cariBarang={cariBarangAction}
    />
  );
}
