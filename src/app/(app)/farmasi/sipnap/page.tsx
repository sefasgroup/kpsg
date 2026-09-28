import type { Metadata } from "next";
import { AlertTriangle, CalendarRange, FileSpreadsheet, Pill } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { kesiapanSipnap, rekapSipnap } from "@/lib/sipnap";
import { formatAngka, formatTanggalPendek } from "@/lib/format";
import { awalBulan, tanggalHariIni, tanggalValid } from "@/lib/tanggal";

export const metadata: Metadata = { title: "Laporan SIPNAP" };
export const dynamic = "force-dynamic";

export default async function SipnapPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string }>;
}) {
  const session = await requireRole("farmasi", "super_admin");
  const sp = await searchParams;

  if (!session.siteId) {
    return (
      <EmptyState
        icon={FileSpreadsheet}
        title="Pilih cabang terlebih dahulu"
        description="Laporan SIPNAP terikat pada satu cabang — stok narkotika dicatat per gudang cabang."
      />
    );
  }
  const siteId = session.siteId;

  /*
   * Bawaan periode = bulan berjalan, bukan 30 hari terakhir.
   *
   * SIPNAP dilaporkan per bulan takwim. Rentang bergulir akan menghasilkan
   * angka yang tidak pernah cocok dengan formulir yang harus dikirim.
   */
  const dari = tanggalValid(sp.dari) ? sp.dari : awalBulan(tanggalHariIni());
  const sampai = tanggalValid(sp.sampai) ? sp.sampai : tanggalHariIni();

  /*
   * Rekapnya dijalankan SEKALI lalu diteruskan ke perhitungan kesiapan.
   * Menjalankan keduanya paralel terlihat lebih cepat, padahal keduanya
   * memuat kueri yang sama — hasilnya dua kali beban untuk angka identik.
   */
  const baris = await rekapSipnap(siteId, dari, sampai);
  const siap = await kesiapanSipnap(siteId, dari, sampai, baris);

  const periodeBerakhirHariIni = sampai >= tanggalHariIni();

  return (
    <div className="flex flex-col gap-4">
      <Card className="no-print">
        <CardHeader>
          <CardTitle icon={CalendarRange}>Periode Pelaporan</CardTitle>
          <form className="flex flex-wrap items-center gap-2">
            <input
              type="date" name="dari" defaultValue={dari} max={tanggalHariIni()}
              className="h-8 rounded-md border border-line bg-surface px-2 text-meta text-ink"
            />
            <span className="text-meta text-ink-faint">s.d.</span>
            <input
              type="date" name="sampai" defaultValue={sampai} max={tanggalHariIni()}
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
          Laporan bulanan narkotika &amp; psikotropika ke Kemenkes.{" "}
          <strong>Angkanya tidak disimpan terpisah</strong> — saldo awal,
          pemasukan, dan pengeluaran dihitung langsung dari kartu stok, supaya
          laporan dan kartu stok tidak mungkin berbeda saat diperiksa.
        </p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Item Dilaporkan" value={siap.jumlahItem} icon={Pill} />
        <StatCard label="Narkotika" value={siap.narkotika} />
        <StatCard label="Psikotropika" value={siap.psikotropika} />
        <StatCard
          label="Data Belum Lengkap"
          value={siap.tanpaGolongan + siap.tanpaIzinEdar}
          sub={
            siap.tanpaGolongan + siap.tanpaIzinEdar > 0
              ? `${siap.tanpaGolongan} tanpa golongan · ${siap.tanpaIzinEdar} tanpa NIE`
              : "Golongan & NIE lengkap"
          }
          tone={siap.tanpaGolongan + siap.tanpaIzinEdar > 0 ? "warning" : "success"}
          icon={AlertTriangle}
        />
      </div>

      {/*
        Peringatan selisih hanya bermakna bila periodenya berakhir hari ini:
        saldo akhir periode LAMPAU memang boleh berbeda dari saldo sekarang,
        karena ada pergerakan sesudahnya.
      */}
      {periodeBerakhirHariIni && siap.selisih > 0 ? (
        <p className="rounded-lg border border-danger/25 bg-danger-bg px-4 py-2.5 text-body text-ink">
          <strong>{siap.selisih} item</strong> saldo hitungannya tidak sama
          dengan saldo yang tercatat di gudang. Untuk periode yang berakhir
          hari ini keduanya harus identik — periksa kartu stoknya sebelum
          laporan dikirim, karena selisih pada narkotika adalah temuan
          pemeriksaan, bukan sekadar salah input.
        </p>
      ) : null}

      {siap.tanpaGolongan > 0 ? (
        <p className="rounded-lg border border-warning/30 bg-warning-bg px-4 py-2.5 text-body text-ink">
          <strong>{siap.tanpaGolongan} item narkotika</strong> belum diisi
          golongannya (I/II/III). Formulir SIPNAP mewajibkan kolom itu —
          lengkapi di Katalog Obat sebelum melapor.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle icon={FileSpreadsheet}>
            Rekap {formatTanggalPendek(dari)} – {formatTanggalPendek(sampai)}
          </CardTitle>
          <Badge variant="brand">{baris.length} item</Badge>
        </CardHeader>

        {baris.length === 0 ? (
          <EmptyState
            icon={Pill}
            title="Tidak ada narkotika atau psikotropika untuk dilaporkan"
            description="Item baru muncul di sini bila ditandai narkotika/psikotropika di Katalog Obat dan pernah bersaldo atau bergerak pada periode ini."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-line bg-surface-alt text-left text-label text-ink-muted">
                  <th className="px-2 py-1.5">Nama / Kode</th>
                  <th className="px-2 py-1.5">Gol.</th>
                  <th className="px-2 py-1.5">NIE</th>
                  <th className="px-2 py-1.5 text-right">Saldo Awal</th>
                  <th className="px-2 py-1.5 text-right">Masuk</th>
                  <th className="px-2 py-1.5 text-right">Keluar</th>
                  <th className="px-2 py-1.5 text-right">Saldo Akhir</th>
                </tr>
              </thead>
              <tbody>
                {baris.map((b) => {
                  const beda =
                    periodeBerakhirHariIni &&
                    Number(b.saldo_akhir) !== Number(b.saldo_sistem);
                  return (
                    <tr
                      key={b.item_id}
                      className={`border-b border-line last:border-b-0 ${beda ? "bg-danger-bg" : ""}`}
                    >
                      <td className="px-2 py-1.5">
                        <span className="text-ink">{b.nama}</span>
                        <span className="ml-1.5 font-mono text-meta text-ink-faint">
                          {b.kode}
                        </span>
                        {b.nama_generik ? (
                          <span className="block text-meta text-ink-faint">
                            {b.nama_generik}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge variant={b.golongan === "narkotika" ? "danger" : "warning"}>
                          {b.golongan === "narkotika"
                            ? `Nark. ${b.golongan_narkotika ?? "—"}`
                            : "Psiko."}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-meta text-ink-muted">
                        {b.no_izin_edar ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular">
                        {formatAngka(Number(b.saldo_awal))}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular text-success">
                        {Number(b.masuk) > 0 ? `+${formatAngka(Number(b.masuk))}` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular text-danger">
                        {Number(b.keluar) > 0 ? `−${formatAngka(Number(b.keluar))}` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium tabular">
                        {formatAngka(Number(b.saldo_akhir))} {b.satuan_dasar}
                        {beda ? (
                          <span className="block text-micro text-danger">
                            gudang: {formatAngka(Number(b.saldo_sistem))}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
