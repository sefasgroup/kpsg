import type { Metadata } from "next";
import { History, ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { daftarSurat, kopKlinik } from "@/lib/dokumen";
import { formatJam, formatTanggalPendek } from "@/lib/format";
import { tanggalHariIni } from "@/lib/tanggal";
import { CetakUlang, FormSurat } from "./surat-client";

export const metadata: Metadata = { title: "Surat Keterangan" };
export const dynamic = "force-dynamic";

const JENIS_LABEL: Record<string, string> = {
  sakit: "Keterangan Sakit",
  sehat: "Keterangan Sehat",
  rujukan: "Rujukan",
  keterangan_lain: "Keterangan Lain",
};

const JENIS_TONE: Record<string, "warning" | "success" | "info" | "neutral"> = {
  sakit: "warning",
  sehat: "success",
  rujukan: "info",
  keterangan_lain: "neutral",
};

export default async function SuratPage() {
  const session = await requireRole("dokter", "super_admin");

  const [klinik, riwayat, profil] = await Promise.all([
    kopKlinik(session.siteId),
    daftarSurat(session.siteId, { doctorId: session.id, limit: 50 }),
    queryOne<import("mysql2").RowDataPacket & { gelar_depan: string | null; no_sip: string | null }>(
      `SELECT gelar_depan, no_sip FROM doctor_profiles WHERE user_id = ?`,
      [session.id],
    ),
  ]);

  const hariIni = tanggalHariIni();
  const suratHariIni = riwayat.filter((r) => r.issued_at.slice(0, 10) === hariIni);
  const perJenis = riwayat.reduce<Record<string, number>>((acc, r) => {
    acc[r.jenis] = (acc[r.jenis] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Diterbitkan Hari Ini" value={suratHariIni.length} icon={ScrollText} />
        <StatCard
          label="Surat Sakit"
          value={perJenis.sakit ?? 0}
          sub="50 surat terakhir"
          tone={(perJenis.sakit ?? 0) > 0 ? "warning" : "default"}
        />
        <StatCard label="Rujukan" value={perJenis.rujukan ?? 0} sub="50 surat terakhir" />
      </div>

      {!profil?.no_sip ? (
        <p className="rounded-lg border border-warning/25 bg-warning-bg px-4 py-2.5 text-body text-ink">
          Nomor SIP Anda belum terisi di profil, sehingga blok tanda tangan surat
          akan tercetak tanpa SIP. Minta Super Admin melengkapinya di menu
          Pengguna &amp; Role sebelum surat dipakai pasien.
        </p>
      ) : null}

      <FormSurat
        klinik={klinik}
        dokter={session.nama}
        gelar={profil?.gelar_depan ?? null}
        noSip={profil?.no_sip ?? null}
        hariIni={hariIni}
      />

      <Card>
        <CardHeader>
          <CardTitle icon={History}>Surat yang Saya Terbitkan</CardTitle>
          <span className="text-meta text-ink-faint">50 terakhir</span>
        </CardHeader>

        {riwayat.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-3 py-8 text-center text-meta text-ink-faint">
            Anda belum pernah menerbitkan surat keterangan.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-surface-alt">
                  {["No. Surat", "Terbit", "Jenis", "Pasien", "No. RM", "Ringkasan", ""].map((c) => (
                    <th
                      key={c}
                      className="border-b border-line px-3 py-2 text-left text-label font-medium whitespace-nowrap text-ink-muted"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {riwayat.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5 font-mono text-meta text-ink">{r.no_surat}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-meta text-ink-muted">
                      {formatTanggalPendek(r.issued_at)} {formatJam(r.issued_at)}
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge variant={JENIS_TONE[r.jenis] ?? "neutral"}>
                        {JENIS_LABEL[r.jenis] ?? r.jenis}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-ink">{r.nama}</td>
                    <td className="px-3 py-1.5 font-mono text-meta text-ink-muted">{r.no_rm}</td>
                    <td className="max-w-xs truncate px-3 py-1.5 text-meta text-ink-muted">
                      {ringkas(r.jenis, r.data)}
                    </td>
                    <td className="px-3 py-1.5">
                      <CetakUlang
                        surat={{
                          klinik,
                          noSurat: r.no_surat,
                          jenis: r.jenis,
                          terbit: r.issued_at.slice(0, 10),
                          pasien: {
                            nama: r.nama,
                            noRm: r.no_rm,
                            nik: r.nik,
                            tanggalLahir: r.tanggal_lahir,
                            jenisKelamin: r.jenis_kelamin,
                            alamat: r.alamat,
                            pekerjaan: r.pekerjaan,
                          },
                          dokter: r.dokter,
                          gelar: r.dokter_gelar,
                          noSip: r.no_sip,
                          data: r.data,
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-meta text-ink-muted">
          Surat tidak bisa diubah setelah terbit. Bila ada kekeliruan, terbitkan
          surat baru — nomor lama tetap tercatat sehingga jejaknya tidak hilang.
        </p>
      </Card>
    </div>
  );
}

function ringkas(jenis: string, d: Record<string, unknown>): string {
  const t = (k: string) => (d[k] ? String(d[k]) : "");
  switch (jenis) {
    case "sakit":
      return `Istirahat ${t("lama_hari")} hari sejak ${t("mulai")}`;
    case "sehat":
      return `Keperluan: ${t("keperluan")}`;
    case "rujukan":
      return `Ke ${t("tujuan_faskes")}${t("tujuan_bagian") ? ` — ${t("tujuan_bagian")}` : ""}`;
    default:
      return t("perihal");
  }
}
