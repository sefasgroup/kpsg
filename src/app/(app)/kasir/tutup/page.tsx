import type { Metadata } from "next";
import { DoorOpen, Wallet } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { ringkasanShift, shiftAktif } from "@/lib/cashier";
import { METODE_LABEL } from "@/lib/validations/cashier";
import { formatJam, formatRupiah, formatTanggalPendek } from "@/lib/format";
import { BukaShift, TutupShift } from "./shift-client";

export const metadata: Metadata = { title: "Tutup Kasir" };
export const dynamic = "force-dynamic";

type ShiftLalu = import("mysql2").RowDataPacket & {
  id: number;
  dibuka_at: string;
  ditutup_at: string;
  kas_awal: string;
  kas_akhir_sistem: string;
  kas_akhir_fisik: string;
  selisih: string;
  catatan: string | null;
};

export default async function TutupKasirPage() {
  const session = await requireRole("kasir", "super_admin");
  const siteId = session.siteId;

  // Shift terikat pada kasir yang login. Super Admin tidak punya shift —
  // ia memantau shift seluruh kasir, di cabang terpilih atau semua cabang.
  if (session.role === "super_admin") return <PantauShift siteId={siteId} />;

  if (!siteId) {
    return (
      <EmptyState
        icon={Wallet}
        title="Pilih cabang terlebih dahulu"
        description="Shift kasir terikat pada satu cabang."
      />
    );
  }

  const shift = await shiftAktif(siteId, session.id);
  const [ringkasan, riwayatShift] = await Promise.all([
    shift ? ringkasanShift(shift.id) : Promise.resolve([]),
    query<ShiftLalu>(
      `SELECT id, dibuka_at, ditutup_at, kas_awal, kas_akhir_sistem,
              kas_akhir_fisik, selisih, catatan
         FROM cashier_shifts
        WHERE site_id = ? AND cashier_id = ? AND ditutup_at IS NOT NULL
        ORDER BY id DESC LIMIT 10`,
      [siteId, session.id],
    ),
  ]);

  const tunaiMasuk = ringkasan.find((r) => r.metode === "tunai")?.total ?? 0;
  const totalSemua = ringkasan.reduce((n, r) => n + r.total, 0);
  const jumlahTrx = ringkasan.reduce((n, r) => n + r.jumlah, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle icon={Wallet}>Shift Berjalan</CardTitle>
            {shift ? (
              <Badge variant="success">Dibuka {formatJam(shift.dibuka_at)}</Badge>
            ) : (
              <Badge variant="neutral">Belum dibuka</Badge>
            )}
          </CardHeader>

          {!shift ? (
            <p className="text-body text-ink-muted">
              Belum ada shift berjalan. Buka shift untuk mulai mencatat kas —
              bila lupa, sistem akan membukanya otomatis dengan kas awal 0 saat
              transaksi pertama, supaya antrean pasien tidak tertahan.
            </p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-md border border-line bg-surface-alt px-3 py-2">
                  <p className="text-meta text-ink-muted">Transaksi</p>
                  <p className="text-display text-ink tabular">{jumlahTrx}</p>
                </div>
                <div className="rounded-md border border-line bg-surface-alt px-3 py-2">
                  <p className="text-meta text-ink-muted">Total Diterima</p>
                  <p className="text-display text-ink tabular">{formatRupiah(totalSemua)}</p>
                </div>
                <div className="rounded-md border border-line bg-surface-alt px-3 py-2">
                  <p className="text-meta text-ink-muted">Di antaranya tunai</p>
                  <p className="text-display text-success tabular">
                    {formatRupiah(tunaiMasuk)}
                  </p>
                </div>
              </div>

              {ringkasan.length > 0 ? (
                <div className="mt-3 overflow-x-auto rounded-md border border-line">
                  <table className="w-full border-collapse text-body">
                    <thead>
                      <tr className="bg-surface-alt">
                        <th className="border-b border-line px-3 py-2 text-left text-label font-medium text-ink-muted">Metode</th>
                        <th className="border-b border-line px-3 py-2 text-right text-label font-medium text-ink-muted">Transaksi</th>
                        <th className="border-b border-line px-3 py-2 text-right text-label font-medium text-ink-muted">Total</th>
                        <th className="border-b border-line px-3 py-2 text-left text-label font-medium text-ink-muted">Masuk ke</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ringkasan.map((r) => (
                        <tr key={r.metode} className="border-b border-line last:border-b-0">
                          <td className="px-3 py-1.5 text-ink">
                            {METODE_LABEL[r.metode as keyof typeof METODE_LABEL] ?? r.metode}
                          </td>
                          <td className="px-3 py-1.5 text-right text-ink-muted tabular">{r.jumlah}</td>
                          <td className="px-3 py-1.5 text-right text-ink tabular">
                            {formatRupiah(r.total)}
                          </td>
                          <td className="px-3 py-1.5 text-meta text-ink-faint">
                            {r.metode === "tunai" ? "Laci kasir" : "Rekening klinik"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-3 text-meta text-ink-faint">
                  Belum ada transaksi pada shift ini.
                </p>
              )}
            </>
          )}
        </Card>

        {riwayatShift.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle icon={DoorOpen}>Shift Sebelumnya</CardTitle>
            </CardHeader>
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full border-collapse text-body">
                <thead>
                  <tr className="bg-surface-alt">
                    {["Dibuka", "Ditutup", "Kas Awal", "Seharusnya", "Fisik", "Selisih", "Catatan"].map((h) => (
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
                  {riwayatShift.map((s) => {
                    const selisih = Number(s.selisih);
                    return (
                      <tr key={s.id} className="border-b border-line last:border-b-0">
                        <td className="px-3 py-1.5 text-meta text-ink-muted">
                          {formatTanggalPendek(s.dibuka_at)} {formatJam(s.dibuka_at)}
                        </td>
                        <td className="px-3 py-1.5 text-meta text-ink-muted">
                          {formatJam(s.ditutup_at)}
                        </td>
                        <td className="px-3 py-1.5 tabular">{formatRupiah(s.kas_awal)}</td>
                        <td className="px-3 py-1.5 tabular">{formatRupiah(s.kas_akhir_sistem)}</td>
                        <td className="px-3 py-1.5 tabular">{formatRupiah(s.kas_akhir_fisik)}</td>
                        <td
                          className={`px-3 py-1.5 tabular ${
                            selisih === 0 ? "text-success" : "text-danger"
                          }`}
                        >
                          {formatRupiah(selisih)}
                        </td>
                        <td className="px-3 py-1.5 text-meta text-ink-faint">
                          {s.catatan ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
      </div>

      <Card className="h-fit lg:sticky lg:top-0">
        <CardHeader>
          <CardTitle icon={Wallet}>{shift ? "Tutup Shift" : "Buka Shift"}</CardTitle>
        </CardHeader>
        {shift ? (
          <TutupShift
            shiftId={shift.id}
            kasAwal={Number(shift.kas_awal)}
            tunaiMasuk={tunaiMasuk}
          />
        ) : (
          <BukaShift />
        )}
      </Card>
    </div>
  );
}

type BarisShift = import("mysql2").RowDataPacket & {
  id: number;
  cabang: string;
  kasir: string;
  dibuka_at: string;
  ditutup_at: string | null;
  kas_awal: string;
  kas_akhir_sistem: string;
  kas_akhir_fisik: string | null;
  selisih: string | null;
  diterima: string;
  transaksi: number;
};

/** Pemantauan shift seluruh kasir — hanya baca (Super Admin). */
async function PantauShift({ siteId }: { siteId: number | null }) {
  const baris = await query<BarisShift>(
    `SELECT cs.id, st.nama AS cabang, u.nama AS kasir, cs.dibuka_at, cs.ditutup_at,
            cs.kas_awal, cs.kas_akhir_sistem, cs.kas_akhir_fisik, cs.selisih,
            (SELECT COALESCE(SUM(bt.dibayar - bt.kembalian), 0)
               FROM billing_transactions bt
              WHERE bt.shift_id = cs.id AND bt.status = 'lunas') AS diterima,
            (SELECT COUNT(*) FROM billing_transactions bt
              WHERE bt.shift_id = cs.id AND bt.status = 'lunas') AS transaksi
       FROM cashier_shifts cs
       JOIN users u  ON u.id = cs.cashier_id
       JOIN sites st ON st.id = cs.site_id
      WHERE (? IS NULL OR cs.site_id = ?)
      ORDER BY (cs.ditutup_at IS NULL) DESC, cs.id DESC
      LIMIT 50`,
    [siteId, siteId],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={Wallet}>Shift Kasir</CardTitle>
        <span className="text-meta text-ink-faint">
          {siteId ? "Cabang aktif" : "Semua cabang"} · 50 terakhir
        </span>
      </CardHeader>

      {baris.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-8 text-center text-meta text-ink-faint">
          Belum ada shift kasir.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="bg-surface-alt">
                {["Status", "Cabang", "Kasir", "Dibuka", "Ditutup", "Trx", "Diterima", "Kas Awal", "Seharusnya", "Fisik", "Selisih"].map((h) => (
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
              {baris.map((b) => {
                const selisih = b.selisih == null ? null : Number(b.selisih);
                return (
                  <tr key={b.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5">
                      {b.ditutup_at ? (
                        <Badge variant="neutral">Ditutup</Badge>
                      ) : (
                        <Badge variant="success">Berjalan</Badge>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">{b.cabang}</td>
                    <td className="px-3 py-1.5 text-ink">{b.kasir}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-meta text-ink-muted">
                      {formatTanggalPendek(b.dibuka_at)} {formatJam(b.dibuka_at)}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-meta text-ink-muted">
                      {b.ditutup_at ? formatJam(b.ditutup_at) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-ink-muted tabular">{b.transaksi}</td>
                    <td className="px-3 py-1.5 tabular">{formatRupiah(b.diterima)}</td>
                    <td className="px-3 py-1.5 tabular">{formatRupiah(b.kas_awal)}</td>
                    <td className="px-3 py-1.5 tabular">
                      {b.ditutup_at ? formatRupiah(b.kas_akhir_sistem) : "—"}
                    </td>
                    <td className="px-3 py-1.5 tabular">
                      {b.kas_akhir_fisik == null ? "—" : formatRupiah(b.kas_akhir_fisik)}
                    </td>
                    <td
                      className={`px-3 py-1.5 tabular ${
                        selisih == null ? "text-ink-faint" : selisih === 0 ? "text-success" : "text-danger"
                      }`}
                    >
                      {selisih == null ? "—" : formatRupiah(selisih)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
