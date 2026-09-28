import type { Metadata } from "next";
import { CalendarCheck, CalendarDays, Clock, UserCheck, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { bebanDokter, jadwalDokter, pengecualianDokter } from "@/lib/hr";
import { formatTanggalPendek } from "@/lib/format";
import { hariDalamMinggu, rentangTanggal, tambahHari, tanggalHariIni } from "@/lib/tanggal";

export const metadata: Metadata = { title: "Jadwal Saya" };
export const dynamic = "force-dynamic";

const NAMA_HARI = ["", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

const JENIS_LABEL: Record<string, string> = {
  libur: "Libur", cuti: "Cuti", izin: "Izin", sakit: "Sakit",
  ganti_jam: "Ganti Jam", tambahan: "Jadwal Tambahan",
};

const STATUS_TONE: Record<string, "success" | "warning" | "danger"> = {
  disetujui: "success", pending: "warning", ditolak: "danger",
};

/** Jam disimpan sebagai TIME (HH:MM:SS); detiknya tidak perlu ditampilkan. */
const jam = (t: string) => t.slice(0, 5);

export default async function JadwalSayaPage() {
  const session = await requireRole("dokter", "super_admin");

  const hariIni = tanggalHariIni();
  const akhir = tambahHari(hariIni, 13); // dua minggu ke depan

  const [jadwal, pengecualian, beban] = await Promise.all([
    jadwalDokter(session.id, session.siteId),
    pengecualianDokter(session.id, session.siteId, hariIni, akhir),
    bebanDokter(session.id, session.siteId, tambahHari(hariIni, -13), akhir),
  ]);

  const hariNo = hariDalamMinggu(hariIni);
  const jadwalHariIni = jadwal.filter((j) => Number(j.hari) === hariNo);
  const bebanHariIni = beban.find((b) => b.tanggal === hariIni);

  // Pengecualian dipetakan per tanggal agar kalender dua minggu bisa
  // menandai hari yang jadwalnya berubah, bukan hanya menampilkan daftar.
  const perTanggal = new Map<string, typeof pengecualian>();
  for (const p of pengecualian) {
    const list = perTanggal.get(p.tanggal) ?? [];
    list.push(p);
    perTanggal.set(p.tanggal, list);
  }
  const bebanPerTanggal = new Map(beban.map((b) => [b.tanggal, b]));

  const jamMingguan = jadwal.reduce((n, j) => {
    const [h1, m1] = j.jam_mulai.split(":").map(Number);
    const [h2, m2] = j.jam_selesai.split(":").map(Number);
    return n + (h2 * 60 + m2 - (h1 * 60 + m1)) / 60;
  }, 0);

  const sebagaiPengganti = pengecualian.filter((p) => p.digantikan_untuk);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard
          label="Praktik Hari Ini"
          value={jadwalHariIni.length > 0 ? jadwalHariIni.map((j) => `${jam(j.jam_mulai)}–${jam(j.jam_selesai)}`).join(", ") : "Tidak ada"}
          sub={NAMA_HARI[hariNo]}
          icon={Clock}
        />
        <StatCard
          label="Pasien Hari Ini"
          value={Number(bebanHariIni?.jumlah ?? 0)}
          sub={`${Number(bebanHariIni?.selesai ?? 0)} selesai`}
          icon={Users}
        />
        <StatCard
          label="Jam Praktik / Minggu"
          value={`${jamMingguan.toFixed(1)} jam`}
          sub={`${jadwal.length} sesi tetap`}
          icon={CalendarDays}
        />
        <StatCard
          label="Menggantikan Dokter Lain"
          value={sebagaiPengganti.length}
          sub="2 minggu ke depan"
          tone={sebagaiPengganti.length > 0 ? "info" : "default"}
          icon={UserCheck}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={CalendarDays}>Jadwal Praktik Tetap</CardTitle>
          <span className="text-meta text-ink-faint">
            Diatur oleh Admin Cabang
          </span>
        </CardHeader>

        {jadwal.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-3 py-8 text-center text-meta text-ink-faint">
            Belum ada jadwal praktik tetap untuk Anda. Hubungi Admin Cabang.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4, 5, 6, 7].map((h) => {
              const sesi = jadwal.filter((j) => Number(j.hari) === h);
              if (sesi.length === 0) return null;
              return (
                <div
                  key={h}
                  className={`rounded-md border px-3 py-2 ${
                    h === hariNo ? "border-brand-600 bg-brand-50" : "border-line"
                  }`}
                >
                  <p className="text-label text-ink-muted">
                    {NAMA_HARI[h]}
                    {h === hariNo ? (
                      <span className="ml-1.5 text-micro text-brand-700">hari ini</span>
                    ) : null}
                  </p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {sesi.map((j) => (
                      <li key={j.id} className="text-body">
                        <span className="tabular text-ink">
                          {jam(j.jam_mulai)}–{jam(j.jam_selesai)}
                        </span>
                        <span className="ml-1.5 text-meta text-ink-muted">{j.poli_nama}</span>
                        {j.kuota > 0 ? (
                          <span className="ml-1.5 text-micro text-ink-faint">
                            kuota {j.kuota}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle icon={CalendarCheck}>Dua Minggu ke Depan</CardTitle>
          <span className="text-meta text-ink-faint">
            {formatTanggalPendek(hariIni)} – {formatTanggalPendek(akhir)}
          </span>
        </CardHeader>

        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="bg-surface-alt">
                {["Tanggal", "Hari", "Jadwal", "Perubahan", "Pasien Terdaftar"].map((c) => (
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
              {rentangTanggal(hariIni, akhir).map((t) => {
                const h = hariDalamMinggu(t);
                const sesi = jadwal.filter((j) => Number(j.hari) === h);
                const ubah = perTanggal.get(t) ?? [];
                const b = bebanPerTanggal.get(t);
                const libur = ubah.some(
                  (u) => u.status === "disetujui" && ["libur", "cuti", "izin", "sakit"].includes(u.jenis) && !u.digantikan_untuk,
                );
                return (
                  <tr
                    key={t}
                    className={`border-b border-line last:border-b-0 ${t === hariIni ? "bg-brand-50" : ""}`}
                  >
                    <td className="px-3 py-1.5 whitespace-nowrap text-meta text-ink">
                      {formatTanggalPendek(t)}
                    </td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">{NAMA_HARI[h]}</td>
                    <td className="px-3 py-1.5">
                      {sesi.length === 0 ? (
                        <span className="text-meta text-ink-faint">—</span>
                      ) : (
                        <span className={libur ? "text-ink-faint line-through" : "tabular text-ink"}>
                          {sesi.map((j) => `${jam(j.jam_mulai)}–${jam(j.jam_selesai)} ${j.poli_nama}`).join(" · ")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {ubah.length === 0 ? (
                        <span className="text-meta text-ink-faint">—</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {ubah.map((u) => (
                            <span key={u.id} className="flex items-center gap-1">
                              <Badge variant={STATUS_TONE[u.status] ?? "neutral"}>
                                {u.digantikan_untuk
                                  ? `Menggantikan ${u.digantikan_untuk}`
                                  : JENIS_LABEL[u.jenis] ?? u.jenis}
                              </Badge>
                              {!u.digantikan_untuk && u.pengganti_nama ? (
                                <span className="text-micro text-ink-muted">
                                  digantikan {u.pengganti_nama}
                                </span>
                              ) : null}
                              {/* Hanya halangan yang butuh pengganti — ganti jam & jadwal
                                  tambahan justru dokter itu sendiri yang praktik. */}
                              {!u.digantikan_untuk && !u.pengganti_nama && u.status === "disetujui" &&
                              ["libur", "cuti", "izin", "sakit"].includes(u.jenis) ? (
                                <span className="text-micro text-danger">tanpa pengganti</span>
                              ) : null}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 tabular text-ink-muted">
                      {b ? Number(b.jumlah) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-meta text-ink-muted">
          Perubahan jadwal, cuti, dan penetapan dokter pengganti adalah wewenang
          Admin Cabang — layar ini menampilkannya, bukan mengubahnya. Hari yang
          ditandai <em>tanpa pengganti</em> berarti pasien tidak bisa didaftarkan
          ke Anda pada tanggal itu.
        </p>
      </Card>
    </div>
  );
}
