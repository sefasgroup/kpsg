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
