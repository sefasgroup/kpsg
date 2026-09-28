import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity, CalendarDays, FileSearch, FlaskConical, Pill, Stethoscope, TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { cariPasien } from "@/lib/patients";
import { kopKlinik } from "@/lib/dokumen";
import { alergiPasien, riwayatKunjungan, riwayatLab, ringkasanPasien } from "@/lib/riwayat";
import { formatJam, formatTanggal, formatTanggalPendek, hitungUmur } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/visit-status";
import { CetakRekamMedis } from "@/components/cetak/cetak-rekam-medis";
import { AksiRiwayat } from "./aksi-riwayat";

export const metadata: Metadata = { title: "Riwayat Pasien" };
export const dynamic = "force-dynamic";

const FLAG_LABEL: Record<string, string> = {
  N: "Normal", L: "Rendah", H: "Tinggi", LL: "KRITIS ↓", HH: "KRITIS ↑",
};

export default async function RiwayatPasienPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pasien?: string }>;
}) {
  // Pencarian riwayat sengaja lintas cabang (docs/DATABASE.md §3.7), jadi
  // sesinya hanya dipakai sebagai penjaga akses, bukan penyaring data.
  const session = await requireRole("dokter", "super_admin");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const pasienId = Number(sp.pasien) || 0;

  const hasil = q.length >= 2 && !pasienId ? await cariPasien(q, 20) : [];

  const pencarian = (
    <Card>
      <CardHeader>
        <CardTitle icon={FileSearch}>Cari Pasien</CardTitle>
      </CardHeader>
      <form className="flex flex-wrap items-center gap-2">
        <input
          name="q"
          defaultValue={q}
          autoFocus
          placeholder="Nama, NIK, atau No. RM…"
          className="h-9 min-w-64 flex-1 rounded-md border border-line bg-surface px-3 text-body text-ink"
        />
        <button
          type="submit"
          className="h-9 rounded-md border border-brand-600 bg-brand-600 px-3.5 text-body font-medium text-white transition-colors hover:bg-brand-700"
        >
          Cari
        </button>
      </form>
      <p className="mt-2 text-meta text-ink-muted">
        Pencarian berlaku lintas cabang — satu NIK adalah satu pasien di seluruh
        jaringan, sehingga riwayatnya tidak terputus saat ia berobat di cabang lain.
      </p>

      {hasil.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1">
          {hasil.map((p) => (
            <li key={p.id}>
              <Link
                href={`/riwayat-pasien?pasien=${p.id}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-line px-3 py-2 transition-colors hover:bg-brand-50"
              >
                <span className="text-ink">{p.nama}</span>
                <span className="font-mono text-meta text-ink-muted">{p.no_rm}</span>
                <span className="font-mono text-micro text-ink-faint">NIK {p.nik}</span>
                <span className="ml-auto text-meta text-ink-muted">
                  {hitungUmur(p.tanggal_lahir)} th · {p.jenis_kelamin === "L" ? "Laki-laki" : "Perempuan"}
                </span>
                {p.alergi ? <Badge variant="danger">Alergi</Badge> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : q.length >= 2 && !pasienId ? (
        <p className="mt-3 text-meta text-ink-faint">Tidak ada pasien cocok dengan “{q}”.</p>
      ) : null}
    </Card>
  );

  if (!pasienId) {
    return (
      <div className="flex flex-col gap-4">
        {pencarian}
        <EmptyState
          icon={FileSearch}
          title="Belum ada pasien dipilih"
          description="Cari pasien untuk melihat seluruh riwayat kunjungan, diagnosa, resep, dan hasil laboratoriumnya."
        />
      </div>
    );
  }

  const [pasien, kunjungan, alergi, lab, klinik] = await Promise.all([
    ringkasanPasien(pasienId),
    riwayatKunjungan(pasienId, 50),
    alergiPasien(pasienId),
    riwayatLab(pasienId, 200),
    kopKlinik(session.siteId),
  ]);

  if (!pasien) {
    return (
      <div className="flex flex-col gap-4">
        {pencarian}
        <EmptyState icon={FileSearch} title="Pasien tidak ditemukan" />
      </div>
    );
  }

  const abnormal = lab.filter((l) => l.flag !== "N");

  return (
    <div className="flex flex-col gap-4">
      {pencarian}

      {alergi.length > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-bg px-4 py-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <div>
            <p className="text-h2 text-danger">Alergi Tercatat</p>
            <ul className="mt-1 flex flex-col gap-0.5 text-body text-ink">
              {alergi.map((a) => (
                <li key={a.id}>
                  <strong>{a.nama_alergen}</strong>
                  <span className="text-ink-muted"> ({a.jenis})</span>
                  {a.keparahan ? (
                    <span className="ml-1.5 text-meta uppercase text-danger">{a.keparahan}</span>
                  ) : null}
                  {a.reaksi ? <span className="text-ink-muted"> — {a.reaksi}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle icon={Stethoscope}>{pasien.nama}</CardTitle>
          <span className="font-mono text-meta text-ink-muted">{pasien.no_rm}</span>
        </CardHeader>

        {/* Tombol keluaran diletakkan tepat di kartu identitas — di sinilah
            petugas berada saat memutuskan mencetak resume pasien ini. */}
        <div className="mb-3 border-b border-line pb-3">
          <AksiRiwayat
            data={{
              klinik,
              pasien: {
                nama: pasien.nama,
                noRm: pasien.no_rm,
                nik: pasien.nik,
                tanggalLahir: pasien.tanggal_lahir,
                jenisKelamin: pasien.jenis_kelamin,
                alamat: pasien.alamat,
                telepon: pasien.telepon,
                golDarah: pasien.gol_darah,
                jumlahKunjungan: Number(pasien.jumlah_kunjungan),
              },
              alergi: alergi.map((a) => ({
                nama_alergen: a.nama_alergen,
                jenis: a.jenis,
                keparahan: a.keparahan,
                reaksi: a.reaksi,
              })),
              kunjungan: kunjungan.map((k) => ({
                id: k.id,
                no_visit: k.no_visit,
                tanggal: k.tanggal,
                poli: k.poli,
                site_nama: k.site_nama,
                dokter: k.dokter,
                dokter_pengganti: k.dokter_pengganti,
                ttv: k.ttv,
                diagnosa: k.diagnosa,
                subjective: k.subjective,
                objective: k.objective,
                assessment: k.assessment,
                plan: k.plan,
                tindakan: k.tindakan,
                obat: k.obat,
                racikan: k.racikan,
                lab: k.lab,
              })),
              lab: lab.map((l) => ({
                tanggal: l.tanggal,
                panel: l.panel,
                parameter: l.parameter,
                nilai: l.nilai,
                satuan: l.satuan,
                ref_teks: l.ref_teks,
                flag: l.flag,
              })),
              dicetakOleh: session.nama,
              dicetakPada: `${formatTanggal(new Date())} ${formatJam(new Date())}`,
            }}
          />
        </div>

        <div className="grid gap-x-6 gap-y-1.5 text-body sm:grid-cols-3">
          {[
            ["NIK", pasien.nik],
            ["Tanggal Lahir", `${formatTanggal(pasien.tanggal_lahir)} (${hitungUmur(pasien.tanggal_lahir)} th)`],
            ["Jenis Kelamin", pasien.jenis_kelamin === "L" ? "Laki-laki" : "Perempuan"],
            ["Golongan Darah", pasien.gol_darah ?? "—"],
            ["Cara Bayar", pasien.jenis_pasien],
            ["Telepon", pasien.telepon ?? "—"],
            ["Alamat", pasien.alamat ?? "—"],
          ].map(([k, v]) => (
            <p key={k} className="flex gap-2">
              <span className="w-32 shrink-0 text-ink-muted">{k}</span>
              <span className="text-ink">{v}</span>
            </p>
          ))}
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total Kunjungan" value={Number(pasien.jumlah_kunjungan)} icon={CalendarDays} />
        <StatCard
          label="Kunjungan Terakhir"
          value={pasien.kunjungan_terakhir ? formatTanggalPendek(pasien.kunjungan_terakhir) : "—"}
          icon={Activity}
        />
        <StatCard
          label="Hasil Lab Tidak Normal"
          value={abnormal.length}
          tone={abnormal.length > 0 ? "warning" : "default"}
          sub={`dari ${lab.length} parameter`}
          icon={FlaskConical}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={CalendarDays}>Riwayat Kunjungan</CardTitle>
          <span className="text-meta text-ink-faint">Terbaru di atas · maks. 50</span>
        </CardHeader>

        {kunjungan.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-3 py-8 text-center text-meta text-ink-faint">
            Belum ada kunjungan tercatat.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {kunjungan.map((k) => (
              <li key={k.id} className="rounded-md border border-line">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-alt px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-ink">{formatTanggal(k.tanggal)}</span>
                    <span className="font-mono text-micro text-ink-faint">{k.no_visit}</span>
                    <Badge variant="brand">{k.poli}</Badge>
                    <span className="text-meta text-ink-muted">
                      {k.dokter_pengganti ? (
                        <>
                          {k.dokter_pengganti}{" "}
                          <span className="text-ink-faint">(menggantikan {k.dokter})</span>
                        </>
                      ) : (
                        k.dokter
                      )}
                    </span>
                    <span className="text-micro text-ink-faint">{k.site_nama}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={k.status === "selesai" ? "success" : "neutral"}>
                      {STATUS_LABEL[k.status] ?? k.status}
                    </Badge>
                    {/* Rekam medis kunjungan INI — bukan resume seluruh
                        riwayat. Bekerja juga untuk kunjungan di cabang lain,
                        yang tidak bisa dibuka lewat layar pemeriksaan. */}
                    <CetakRekamMedis visitId={k.id} ringkas />
                  </div>
                </div>

                <div className="grid gap-x-6 gap-y-2 px-3 py-2.5 sm:grid-cols-2">
                  {k.ttv ? (
                    <Bagian label="Tanda Vital" isi={k.ttv} />
                  ) : null}
                  {k.diagnosa ? (
                    <Bagian label="Diagnosa (ICD-10)" isi={k.diagnosa} tebal />
                  ) : null}
                  {k.subjective ? <Bagian label="S — Anamnesis" isi={k.subjective} /> : null}
                  {k.objective ? <Bagian label="O — Pemeriksaan" isi={k.objective} /> : null}
                  {k.assessment ? <Bagian label="A — Penilaian" isi={k.assessment} /> : null}
                  {k.plan ? <Bagian label="P — Rencana" isi={k.plan} /> : null}
                  {k.tindakan ? <Bagian label="Tindakan" isi={k.tindakan} /> : null}
                  {k.lab ? <Bagian label="Laboratorium" isi={k.lab} /> : null}
                  {k.obat ? <Bagian label="Obat Paten" isi={k.obat} icon={Pill} /> : null}
                  {k.racikan ? <Bagian label="Racikan" isi={k.racikan} racikan /> : null}
                  {k.edukasi ? <Bagian label="Edukasi" isi={k.edukasi} /> : null}

                  {!k.subjective && !k.diagnosa ? (
                    <p className="text-meta text-ink-faint sm:col-span-2">
                      Kunjungan ini belum memiliki catatan pemeriksaan dokter.
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {lab.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle icon={FlaskConical}>Hasil Laboratorium</CardTitle>
            <span className="text-meta text-ink-faint">Terbaru di atas</span>
          </CardHeader>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-surface-alt">
                  {["Tanggal", "Panel", "Parameter", "Hasil", "Satuan", "Rujukan", "Penanda"].map((c) => (
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
                {lab.map((l, i) => (
                  <tr key={`${l.visit_id}-${l.parameter}-${i}`} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5 whitespace-nowrap text-meta text-ink-muted">
                      {formatTanggalPendek(l.tanggal)}
                    </td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">{l.panel}</td>
                    <td className="px-3 py-1.5 text-ink">{l.parameter}</td>
                    <td
                      className={`px-3 py-1.5 tabular ${
                        l.flag === "LL" || l.flag === "HH"
                          ? "font-bold text-danger"
                          : l.flag !== "N"
                            ? "font-medium text-warning"
                            : "text-ink"
                      }`}
                    >
                      {l.nilai}
                    </td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">{l.satuan ?? "—"}</td>
                    <td className="px-3 py-1.5 text-meta text-ink-muted">{l.ref_teks ?? "—"}</td>
                    <td className="px-3 py-1.5">
                      {/* Penanda ditulis sebagai teks, bukan hanya warna —
                          layar ini sering dibaca sambil mencetak hitam-putih. */}
                      <span
                        className={`text-meta ${
                          l.flag === "LL" || l.flag === "HH"
                            ? "font-bold text-danger"
                            : l.flag !== "N"
                              ? "text-warning"
                              : "text-ink-faint"
                        }`}
                      >
                        {FLAG_LABEL[l.flag] ?? l.flag}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Bagian({
  label,
  isi,
  tebal,
  racikan,
  icon: Icon,
}: {
  label: string;
  isi: string;
  tebal?: boolean;
  racikan?: boolean;
  icon?: typeof Pill;
}) {
  return (
    <div>
      <p className="flex items-center gap-1 text-label text-ink-muted">
        {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
        {label}
      </p>
      <p
        className={`mt-0.5 whitespace-pre-line text-body ${
          racikan ? "text-racikan" : tebal ? "font-medium text-ink" : "text-ink"
        }`}
      >
        {isi}
      </p>
    </div>
  );
}
