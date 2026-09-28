import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/auth";
import { daftarSetting } from "@/lib/master";
import { EditSetting } from "../master/master-forms";

export const metadata: Metadata = { title: "Pengaturan" };
export const dynamic = "force-dynamic";

/** Penjelasan tiap kunci — nama teknis saja tidak cukup untuk operator. */
const KETERANGAN: Record<string, string> = {
  "app.nama": "Nama aplikasi yang ditampilkan di dokumen dan judul halaman.",
  "app.versi_dokumen": "Versi dokumen rujukan yang menjadi acuan sistem ini.",
  "billing.pembulatan":
    "Kelipatan pembulatan total tagihan. Pembulatan selalu ke bawah, jadi pasien tak pernah membayar lebih dari rincian. Isi 0 untuk menonaktifkan.",
  "billing.biaya_admin": "Biaya administrasi otomatis per kunjungan.",
  "racikan.jasa_racik_default":
    "Nilai awal jasa racik saat dokter menambah racikan baru. Dokter tetap bisa mengubahnya per racikan.",
  "antrean.reset_harian": "Nomor antrean kembali dari 001 setiap hari.",
  "stok.peringatan_kadaluarsa_hari":
    "Berapa hari sebelum kadaluarsa item mulai diberi peringatan.",
  "cetak.printer_thermal": "Lebar kertas thermal dalam mm (58 atau 80).",
};

type BarisSetting = Awaited<ReturnType<typeof daftarSetting>>;

function Tabel({ rows }: { rows: BarisSetting }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full border-collapse text-body">
        <thead>
          <tr className="bg-surface-alt">
            {["Kunci", "Keterangan", "Tipe", "Nilai"].map((h) => (
              <th
                key={h}
                className="border-b border-line px-3 py-2 text-left text-label font-medium whitespace-nowrap text-ink-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} className="border-b border-line last:border-b-0">
              <td className="px-3 py-2 align-top font-mono text-meta text-brand-700">
                {s.skey}
              </td>
              <td className="max-w-md px-3 py-2 align-top text-meta text-ink-muted">
                {KETERANGAN[s.skey] ?? "—"}
              </td>
              <td className="px-3 py-2 align-top">
                <Badge variant="neutral">{s.tipe}</Badge>
              </td>
              <td className="px-3 py-2 align-top">
                <EditSetting
                  id={s.id}
                  skey={s.skey}
                  nilai={s.svalue ?? ""}
                  tipe={s.tipe}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


export default async function PengaturanPage() {
  const session = await requireRole("super_admin");
  const setting = await daftarSetting(session.siteId);

  const global = setting.filter((s) => s.site_id === null);
  const perCabang = setting.filter((s) => s.site_id !== null);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle icon={Settings}>Pengaturan Global</CardTitle>
          <Badge variant="neutral">Berlaku di semua cabang</Badge>
        </CardHeader>
        <Tabel rows={global} />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle icon={Settings}>Pengaturan Cabang</CardTitle>
          <Badge variant="brand">
            {session.siteId ? "Cabang aktif" : "Semua cabang"}
          </Badge>
        </CardHeader>
        <p className="mb-3 text-meta text-ink-muted">
          Nilai per-cabang menimpa nilai global untuk kunci yang sama. Gunakan
          pemilih cabang di kanan atas untuk berpindah.
        </p>
        <Tabel rows={perCabang} />
      </Card>
    </div>
  );
}
