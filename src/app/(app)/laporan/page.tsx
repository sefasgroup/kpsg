import type { Metadata } from "next";
import {
  Activity, BadgeAlert, Banknote, CalendarRange, Pill, Stethoscope, Users, Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import {
  diagnosaTeratas, kunjunganHarian, metodeBayar, obatTeratas,
  pendapatanKategori, produktivitasDokter, ringkasanCabang, ringkasanSdm,
} from "@/lib/laporan";
import { KATEGORI_LABEL } from "@/lib/billing-labels";
import { formatAngka, formatRupiah, formatTanggalPendek } from "@/lib/format";
import { METODE_LABEL as METODE_LABEL_KASIR } from "@/lib/validations/cashier";
import { tanggalHariIni, tanggalValid, tambahHari } from "@/lib/tanggal";

export const metadata: Metadata = { title: "Laporan Cabang" };
export const dynamic = "force-dynamic";

// Satu sumber label dengan layar kasir — termasuk "penjamin", yang dulu
// tertinggal di sini sehingga kuncinya tampil mentah.
const METODE_LABEL: Record<string, string> = METODE_LABEL_KASIR;

export default async function LaporanPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string }>;
}) {
  const session = await requireRole("admin_cabang", "super_admin");
  const sp = await searchParams;

  if (!session.siteId) {
    return (
      <EmptyState
        icon={Activity}
        title="Pilih cabang terlebih dahulu"
        description="Laporan selalu terikat pada satu cabang. Pilih cabang aktif di kanan atas."
      />
    );
  }
  const siteId = session.siteId;

  const sampai = tanggalValid(sp.sampai) ? sp.sampai : tanggalHariIni();
  const dari = tanggalValid(sp.dari) ? sp.dari : tambahHari(sampai, -29);

  const [ring, harian, kategori, metode, diagnosa, dokter, obat, sdm] =
    await Promise.all([
      ringkasanCabang(siteId, dari, sampai),
      kunjunganHarian(siteId, dari, sampai),
      pendapatanKategori(siteId, dari, sampai),
      metodeBayar(siteId, dari, sampai),
      diagnosaTeratas(siteId, dari, sampai),
      produktivitasDokter(siteId, dari, sampai),
      obatTeratas(siteId, dari, sampai),
      ringkasanSdm(siteId, dari, sampai),
    ]);

  const totalKategori = kategori.reduce((n, k) => n + Number(k.nilai), 0);
  const puncakHarian = Math.max(1, ...harian.map((h) => Number(h.kunjungan)));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle icon={CalendarRange}>Periode Laporan</CardTitle>
          <form className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              name="dari"
              defaultValue={dari}
              max={tanggalHariIni()}
              className="h-8 rounded-md border border-line bg-surface px-2 text-meta text-ink"
            />
            <span className="text-meta text-ink-faint">s.d.</span>
            <input
              type="date"
              name="sampai"
              defaultValue={sampai}
              max={tanggalHariIni()}
              className="h-8 rounded-md border border-line bg-surface px-2 text-meta text-ink"
            />
            <button
              type="submit"
              className="h-8 rounded-md border border-brand-600 bg-brand-600 px-3 text-meta font-medium text-white transition-colors hover:bg-brand-700"
            >
              Terapkan
            </button>
          </form>
        </CardHeader>
        <p className="text-meta text-ink-muted">
          {formatTanggalPendek(dari)} – {formatTanggalPendek(sampai)}. Pendapatan
          dihitung dari transaksi berstatus <strong>lunas</strong> saja agar
          laporan tetap cocok dengan kas. Yang belum dibayar dipisah dua:{" "}
          <strong>menunggu di kasir</strong> (tagihan sudah final, tinggal
          dibayar) dan <strong>masih dilayani</strong> (pasien belum selesai,
          angkanya masih bergerak) — hanya yang pertama yang berarti piutang.
        </p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Kunjungan" value={formatAngka(ring.kunjungan)} sub={`${ring.pasienBaru} pasien baru`} icon={Users} />
        <StatCard label="Pendapatan" value={formatRupiah(ring.pendapatan)} sub={`${ring.transaksiLunas} transaksi lunas`} icon={Banknote} />
        <StatCard
          label="Rata-rata / Transaksi"
          value={formatRupiah(ring.rataPerKunjungan)}
          icon={Wallet}
        />
        {/*
          Kartu ini dulu berlabel "Belum Dibayar" dan menjumlahkan tagihan
          `draft` dengan `menunggu`. Akibatnya angka piutang naik setiap
          kali seorang pasien masuk ruang periksa — uang dari pekerjaan
          yang bahkan belum selesai dihitung.

          Yang tampil sebagai angka utama sekarang hanya yang benar-benar
          bisa ditagih; pekerjaan yang masih berjalan turun ke baris
          bawahnya, tetap terlihat tetapi tidak lagi menyamar jadi piutang.
        */}
        <StatCard
          label="Menunggu di Kasir"
          value={formatRupiah(ring.nilaiMenungguKasir)}
          sub={
            ring.dalamPelayanan > 0
              ? `${ring.menungguKasir} tagihan siap dibayar · ${ring.dalamPelayanan} pasien masih dilayani (${formatRupiah(ring.nilaiDalamPelayanan)})`
              : `${ring.menungguKasir} tagihan siap dibayar`
          }
          tone={ring.menungguKasir > 0 ? "warning" : "default"}
          icon={BadgeAlert}
        />
      </div>

      {sdm.penggantiTanpaDokter > 0 ? (
        <p className="rounded-lg border border-danger/25 bg-danger-bg px-4 py-2.5 text-body text-ink">
          <strong>{sdm.penggantiTanpaDokter} hari</strong> ada dokter berhalangan
          tanpa dokter pengganti pada periode ini. Pasien tidak bisa didaftarkan
          ke dokter tersebut pada tanggal itu — tetapkan penggantinya di menu
          Dokter Pengganti.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle icon={Activity}>Kunjungan Harian</CardTitle>
            <span className="text-meta text-ink-faint">{harian.length} hari beroperasi</span>
          </CardHeader>
          {harian.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-3 py-8 text-center text-meta text-ink-faint">
              Tidak ada kunjungan pada periode ini.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-md border border-line">
              <table className="w-full border-collapse text-body">
                <thead className="sticky top-0">
                  <tr className="bg-surface-alt">
                    {["Tanggal", "Kunjungan", "Baru", "Selesai", "Pendapatan"].map((c) => (
                      <th key={c} className="border-b border-line px-3 py-2 text-left text-label font-medium whitespace-nowrap text-ink-muted">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {harian.map((h) => (
                    <tr key={h.tanggal} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-1.5 whitespace-nowrap text-meta text-ink">
                        {formatTanggalPendek(h.tanggal)}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-8 shrink-0 tabular text-ink">{Number(h.kunjungan)}</span>
                          {/* Batang proporsional — perbandingan antar hari
                              terbaca tanpa perlu grafik terpisah. */}
                          <span
                            className="h-2 rounded-sm bg-brand-500"
                            style={{ width: `${(Number(h.kunjungan) / puncakHarian) * 100}%`, minWidth: "2px" }}
                            aria-hidden
                          />
                        </div>
                      </td>
                      <td className="px-3 py-1.5 tabular text-ink-muted">{Number(h.baru)}</td>
                      <td className="px-3 py-1.5 tabular text-ink-muted">{Number(h.selesai)}</td>
                      <td className="px-3 py-1.5 tabular text-ink">{formatRupiah(h.pendapatan)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle icon={Wallet}>Komposisi Pendapatan</CardTitle>
          </CardHeader>
          {kategori.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-3 py-8 text-center text-meta text-ink-faint">
              Belum ada transaksi lunas pada periode ini.
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {kategori.map((k) => {
                  const persen = totalKategori > 0 ? (Number(k.nilai) / totalKategori) * 100 : 0;
                  return (
                    <li key={k.kategori}>
                      <div className="flex items-baseline justify-between gap-3 text-body">
                        <span className={k.kategori === "racikan" || k.kategori === "jasa_racik" ? "text-racikan" : "text-ink"}>
                          {KATEGORI_LABEL[k.kategori] ?? k.kategori}
                        </span>
                        <span className="tabular text-ink">
                          {formatRupiah(k.nilai)}
                          <span className="ml-1.5 text-meta text-ink-faint">{persen.toFixed(1)}%</span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-sm bg-surface-alt">
                        <div
                          className={`h-1.5 rounded-sm ${
                            k.kategori === "racikan" || k.kategori === "jasa_racik"
                              ? "bg-racikan"
                              : "bg-brand-500"
                          }`}
                          style={{ width: `${persen}%` }}
                          aria-hidden
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-4 border-t border-line pt-3">
                <p className="mb-2 text-label text-ink-muted">Metode Pembayaran</p>
                <div className="flex flex-wrap gap-2">
                  {metode.map((m) => (
                    <span
                      key={m.payment_method ?? "kosong"}
                      className="rounded-md border border-line px-2.5 py-1 text-meta"
                    >
                      <span className="text-ink">
                        {METODE_LABEL[m.payment_method ?? ""] ?? "Belum dicatat"}
                      </span>
                      <span className="ml-1.5 tabular text-ink-muted">
                        {formatRupiah(m.nilai)}
                      </span>
                      <span className="ml-1 text-micro text-ink-faint">×{Number(m.jumlah)}</span>
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle icon={Stethoscope}>Diagnosa Terbanyak</CardTitle>
            <span className="text-meta text-ink-faint">15 teratas</span>
          </CardHeader>
          {diagnosa.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-3 py-8 text-center text-meta text-ink-faint">
              Belum ada diagnosa tercatat pada periode ini.
            </p>
          ) : (
            <ol className="flex flex-col gap-1">
              {diagnosa.map((d, i) => (
                <li key={d.code} className="flex items-baseline gap-2.5 text-body">
                  <span className="w-5 shrink-0 text-right text-meta text-ink-faint">{i + 1}</span>
                  <span className="w-16 shrink-0 font-mono text-meta text-brand-700">{d.code}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{d.nama_id}</span>
                  <span className="shrink-0 tabular text-ink-muted">{Number(d.jumlah)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle icon={Pill}>Obat & BMHP Terbanyak Keluar</CardTitle>
            <span className="text-meta text-ink-faint">Senilai harga jual</span>
          </CardHeader>
          {obat.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-3 py-8 text-center text-meta text-ink-faint">
              Belum ada obat keluar pada periode ini.
            </p>
          ) : (
            <ol className="flex flex-col gap-1">
              {obat.map((o, i) => (
                <li key={o.kode} className="flex items-baseline gap-2.5 text-body">
                  <span className="w-5 shrink-0 text-right text-meta text-ink-faint">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{o.nama}</span>
                  <span className="shrink-0 tabular text-ink-muted">
                    {formatAngka(Number(o.qty))} {o.satuan_dasar}
                  </span>
                  <span className="w-28 shrink-0 text-right tabular text-ink">
                    {formatRupiah(o.nilai)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={Users}>Produktivitas Dokter</CardTitle>
          <span className="text-meta text-ink-faint">
            Dihitung ke dokter yang benar-benar melayani
          </span>
        </CardHeader>

        {dokter.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-3 py-8 text-center text-meta text-ink-faint">
            Belum ada kunjungan yang ditangani dokter pada periode ini.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-surface-alt">
                  {["Dokter", "Kunjungan", "Sebagai Pengganti", "Asesmen Final", "Resep", "Pendapatan"].map((c) => (
                    <th key={c} className="border-b border-line px-3 py-2 text-left text-label font-medium whitespace-nowrap text-ink-muted">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dokter.map((d) => {
                  const belumFinal = Number(d.kunjungan) - Number(d.asesmen_final);
                  return (
                    <tr key={d.doctor_id} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-1.5 text-ink">
                        {d.gelar_depan ? `${d.gelar_depan} ` : ""}{d.nama}
                      </td>
                      <td className="px-3 py-1.5 tabular text-ink">{Number(d.kunjungan)}</td>
                      <td className="px-3 py-1.5 tabular text-ink-muted">
                        {Number(d.sebagai_pengganti) > 0 ? (
                          <Badge variant="info">{Number(d.sebagai_pengganti)}</Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-1.5 tabular">
                        <span className="text-ink">{Number(d.asesmen_final)}</span>
                        {belumFinal > 0 ? (
                          <span className="ml-1.5 text-meta text-warning">
                            {belumFinal} belum final
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-1.5 tabular text-ink-muted">{Number(d.resep)}</td>
                      <td className="px-3 py-1.5 tabular text-ink">{formatRupiah(d.pendapatan)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle icon={BadgeAlert}>Ringkasan SDM</CardTitle>
        </CardHeader>
        <div className="grid gap-3 sm:grid-cols-5">
          <StatCard label="Hadir" value={sdm.hadir} />
          <StatCard label="Terlambat" value={sdm.terlambat} tone={sdm.terlambat > 0 ? "warning" : "default"} />
          <StatCard label="Alpha" value={sdm.alfa} tone={sdm.alfa > 0 ? "danger" : "default"} />
          <StatCard
            label="Cuti Menunggu Persetujuan"
            value={sdm.cutiPending}
            tone={sdm.cutiPending > 0 ? "warning" : "default"}
          />
          <StatCard
            label="Berhalangan Tanpa Pengganti"
            value={sdm.penggantiTanpaDokter}
            tone={sdm.penggantiTanpaDokter > 0 ? "danger" : "default"}
          />
        </div>
      </Card>
    </div>
  );
}
