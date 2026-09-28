"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import toast from "react-hot-toast";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

const schema = z.object({
  username: z.string().trim().min(1, "Username wajib diisi"),
  password: z.string().min(1, "Password wajib diisi"),
});

type FormValues = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const [lihatPassword, setLihatPassword] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      const { message } = await res.json().catch(() => ({ message: null }));
      const pesan = message ?? "Username atau password salah.";
      setError("password", { message: pesan });
      toast.error(pesan);
      return;
    }

    const { redirectTo } = await res.json();
    toast.success("Berhasil masuk");
    router.replace(redirectTo ?? "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Field label="Username" htmlFor="username" required error={errors.username?.message}>
        <Input
          id="username"
          autoComplete="username"
          autoFocus
          aria-invalid={Boolean(errors.username)}
          {...register("username")}
        />
      </Field>

      <Field label="Password" htmlFor="password" required error={errors.password?.message}>
        <div className="relative">
          <Input
            id="password"
            type={lihatPassword ? "text" : "password"}
            autoComplete="current-password"
            className="pr-10"
            aria-invalid={Boolean(errors.password)}
            {...register("password")}
          />
          <button
            type="button"
            onClick={() => setLihatPassword((v) => !v)}
            aria-label={lihatPassword ? "Sembunyikan password" : "Tampilkan password"}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-ink-faint hover:text-ink"
          >
            {lihatPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>

      <Button type="submit" variant="primary" disabled={isSubmitting} className="mt-1">
        <LogIn />
        {isSubmitting ? "Memeriksa…" : "Masuk"}
      </Button>
    </form>
  );
}
