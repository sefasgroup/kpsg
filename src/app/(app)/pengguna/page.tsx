import type { Metadata } from "next";
import { ShieldCheck, UserCog, Users } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { requireRole } from "@/lib/auth";
import { daftarCabang, daftarPengguna } from "@/lib/master";
import { formatRupiah, formatTanggalPendek } from "@/lib/format";
import { FormPengguna, ResetPassword, TogglePengguna } from "./pengguna-client";

export const metadata: Metadata = { title: "Pengguna & Role" };
export const dynamic = "force-dynamic";

export default async function PenggunaPage() {
  await requireRole("super_admin");

  const [pengguna, cabang] = await Promise.all([daftarPengguna(), daftarCabang()]);

  const aktif = pengguna.filter((p) => p.is_active === 1).length;
  const superAdmin = pengguna.filter(
    (p) => p.role_code === "super_admin" && p.is_active === 1,
  ).length;
  const belumLogin = pengguna.filter((p) => p.last_login_at === null).length;

  const opsiCabang = cabang.map((c) => ({ id: c.id, nama: c.nama }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Total Pengguna" value={pengguna.length} icon={Users} />
        <StatCard label="Aktif" value={aktif} tone="success" />
        <StatCard
          label="Super Admin Aktif"
          value={superAdmin}
          tone={superAdmin === 1 ? "warning" : "default"}
          sub={superAdmin === 1 ? "Hanya satu — tidak bisa dinonaktifkan" : undefined}
          icon={ShieldCheck}
        />
        <StatCard label="Belum Pernah Login" value={belumLogin} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle icon={UserCog}>Pengguna & Role</CardTitle>
          <FormPengguna cabang={opsiCabang} />
        </CardHeader>

        <p className="mb-3 text-meta text-ink-muted">
          Satu akun terikat pada satu peran dan satu cabang. Peran menentukan
          menu yang dirender sekaligus route yang boleh diakses — tidak ada
          peran ganda dalam satu akun operasional.
        </p>

        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="bg-surface-alt">
                {["Nama", "Username", "Peran", "Cabang", "Login Terakhir", "Status", "Aksi"].map((h) => (
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
              {pengguna.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-1.5">
                    <p className="text-ink">
                      {[p.gelar_depan, p.nama].filter(Boolean).join(" ")}
                    </p>
                    {p.role_code === "dokter" ? (
                      <p className="text-meta text-ink-faint">
                        {p.spesialisasi ?? "—"}
                        {p.tarif_konsultasi
                          ? ` · ${formatRupiah(p.tarif_konsultasi)}`
                          : ""}
                        {p.no_sip ? ` · SIP ${p.no_sip}` : ""}
                      </p>
                    ) : p.nip ? (
                      <p className="text-meta text-ink-faint">NIP {p.nip}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-meta text-ink-muted">
                    {p.username}
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge variant={p.role_code === "super_admin" ? "racikan" : "neutral"}>
                      {p.role_nama}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5 text-meta text-ink-muted">
                    {p.site_nama ?? (
                      <span className="text-ink-faint">Lintas cabang</span>
                    )}
                    {/* Penugasan tambahan ditulis lengkap, bukan sekadar
                        "+2": siapa bertugas di mana adalah informasi yang
                        dicari orang saat membuka layar ini. */}
                    {p.cabang_tambahan ? (
                      <span className="block text-micro text-brand-700">
                        + {p.cabang_tambahan}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5 text-meta text-ink-muted">
                    {p.last_login_at ? (
                      formatTanggalPendek(p.last_login_at)
                    ) : (
                      <span className="text-ink-faint">belum pernah</span>
                    )}
                    {p.must_change_pw === 1 ? (
                      <span className="block text-micro text-warning uppercase">
                        wajib ganti password
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge variant={p.is_active === 1 ? "success" : "danger"}>
                      {p.is_active === 1 ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex gap-0.5">
                      <FormPengguna
                        cabang={opsiCabang}
                        pemicu="edit"
                        awal={{
                          id: p.id,
                          nama: p.nama,
                          username: p.username,
                          role_code: p.role_code,
                          site_id: p.site_id ? String(p.site_id) : "",
                          site_ids: p.site_ids_tambahan
                            ? p.site_ids_tambahan.split(",").map(Number)
                            : [],
                          nip: p.nip ?? "",
                          email: p.email ?? "",
                          telepon: p.telepon ?? "",
                          password: "",
                          no_str: p.no_str ?? "",
                          no_sip: p.no_sip ?? "",
                          spesialisasi: p.spesialisasi ?? "",
                          gelar_depan: p.gelar_depan ?? "",
                          tarif_konsultasi: p.tarif_konsultasi ?? "0",
                        }}
                      />
                      <ResetPassword id={p.id} nama={p.nama} />
                      <TogglePengguna id={p.id} aktif={p.is_active === 1} nama={p.nama} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
