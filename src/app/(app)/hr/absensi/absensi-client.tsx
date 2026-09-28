"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { STATUS_ABSEN_LABEL } from "@/lib/validations/hr";
import { absenAction, setStatusAbsensiAction } from "../actions";

export function TombolAbsen({
  userId,
  tanggal,
  sudahMasuk,
  sudahPulang,
}: {
  userId: number;
  tanggal: string;
  sudahMasuk: boolean;
  sudahPulang: boolean;
}) {
  const router = useRouter();
  const [proses, setProses] = useState(false);

  async function absen(aksi: "masuk" | "pulang") {
    setProses(true);
    try {
      const hasil = await absenAction(userId, tanggal, aksi);
      if (!hasil.ok) {
        toast.error(hasil.error);
        return;
      }
      toast.success(aksi === "masuk" ? "Jam masuk tercatat." : "Jam pulang tercatat.");
      router.refresh();
    } catch {
      toast.error("Gagal menghubungi server. Periksa koneksi lalu coba lagi.");
    } finally {
      setProses(false);
    }
  }

  if (sudahPulang) return null;

  return sudahMasuk ? (
    <Button size="sm" onClick={() => absen("pulang")} disabled={proses}>
      <LogOut />
      Pulang
    </Button>
  ) : (
    <Button size="sm" variant="primary" onClick={() => absen("masuk")} disabled={proses}>
      <LogIn />
      Masuk
    </Button>
  );
}

export function UbahStatus({
  userId,
  tanggal,
  status,
}: {
  userId: number;
  tanggal: string;
  status: string | null;
}) {
  const router = useRouter();
  const [proses, setProses] = useState(false);

  async function ubah(baru: string) {
    if (!baru) return;
    setProses(true);
    try {
      const hasil = await setStatusAbsensiAction(userId, tanggal, baru);
      if (!hasil.ok) {
        toast.error(hasil.error);
        return;
      }
      toast.success("Status absensi diperbarui.");
      router.refresh();
    } catch {
      toast.error("Gagal menghubungi server. Periksa koneksi lalu coba lagi.");
    } finally {
      setProses(false);
    }
  }

  return (
    <Select
      value={status ?? ""}
      disabled={proses}
      aria-label="Ubah status absensi"
      onChange={(e) => ubah(e.target.value)}
      className="h-8 w-32 text-meta"
    >
      <option value="">Belum absen</option>
      {Object.entries(STATUS_ABSEN_LABEL).map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </Select>
  );
}
