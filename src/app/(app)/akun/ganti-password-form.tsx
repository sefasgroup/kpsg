"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { gantiPasswordAction } from "./actions";

export function GantiPasswordForm({ wajib, beranda }: { wajib: boolean; beranda: string }) {
  const router = useRouter();
  const [f, setF] = useState({ lama: "", baru: "", ulang: "" });
  const [galat, setGalat] = useState<{ field?: string; pesan: string } | null>(null);
  const [proses, setProses] = useState(false);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const err = (k: string) => (galat?.field === k ? galat.pesan : undefined);

  async function simpan(e: React.FormEvent) {
    e.preventDefault();
    setProses(true);
    setGalat(null);
    try {
      const h = await gantiPasswordAction(f);
      if (!h.ok) {
        setGalat({ field: h.field, pesan: h.error });
        toast.error(h.error);
        return;
      }
      toast.success("Password berhasil diganti.");
      setF({ lama: "", baru: "", ulang: "" });
      if (wajib) router.replace(beranda);
      router.refresh();
    } catch {
      toast.error("Gagal menghubungi server. Coba lagi.");
    } finally {
      setProses(false);
    }
  }

  return (
    <form onSubmit={simpan} className="flex flex-col gap-3">
      <Field label="Password saat ini" htmlFor="lama" required error={err("lama")}>
        <Input id="lama" type="password" autoComplete="current-password" value={f.lama} onChange={set("lama")} />
      </Field>
      <Field label="Password baru" htmlFor="baru" required hint="Minimal 8 karakter" error={err("baru")}>
        <Input id="baru" type="password" autoComplete="new-password" value={f.baru} onChange={set("baru")} />
      </Field>
      <Field label="Ulangi password baru" htmlFor="ulang" required error={err("ulang")}>
        <Input id="ulang" type="password" autoComplete="new-password" value={f.ulang} onChange={set("ulang")} />
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={proses || !f.lama || !f.baru || !f.ulang}>
          <KeyRound />
          {proses ? "Menyimpan…" : "Ganti Password"}
        </Button>
      </div>
    </form>
  );
}
