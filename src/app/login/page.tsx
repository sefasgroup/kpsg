import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandFullLogo } from "@/components/brand/logo";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Masuk" };

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");

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
          <LoginForm />
        </div>

        <p className="mt-5 text-center text-meta text-ink-faint">
          Klinik Pratama Sahabat Gamma · SIM Klinik v1.0
        </p>
      </div>
    </main>
  );
}
