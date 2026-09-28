import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandFullLogo } from "@/components/brand/logo";
import { sesiSah } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Masuk" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sesi?: string }>;
}) {
  // Diperiksa ke database juga: token yang masih bertanda tangan tetapi
  // akunnya sudah berubah akan memantulkan pengguna /login ↔ /dashboard.
  if (await sesiSah()) redirect("/dashboard");
  const { sesi } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Satu-satunya layar yang memakai logo bertext (DESIGN-SYSTEM §1.2) */}
        <div className="mb-7 flex justify-center">
          <BrandFullLogo width={250} />
        </div>

        <div className="rounded-lg border border-line bg-surface p-6">
          <h1 className="text-h1 text-ink">Masuk ke SIM Klinik</h1>
          <p className="mt-1 mb-5 text-meta text-ink-muted">
            Gunakan akun yang diberikan administrator. Setiap akun terikat pada
            satu peran dan satu cabang.
          </p>
          {sesi === "berakhir" ? (
            <p className="mb-4 rounded-md border border-warning/25 bg-warning-bg px-3 py-2 text-meta text-ink">
              Sesi Anda berakhir karena akun diubah administrator (mis. password
              direset atau peran/cabang diganti). Silakan masuk kembali.
            </p>
          ) : null}
          <LoginForm />
        </div>

        <p className="mt-5 text-center text-meta text-ink-faint">
          Klinik Pratama Sahabat Gamma · SIM Klinik v1.0
        </p>
      </div>
    </main>
  );
}
