"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { aktifkanParameterAction, hapusParameterAction } from "../../master-actions";

/**
 * Menghapus atau menonaktifkan satu parameter lab.
 *
 * Tombolnya BERBEDA menurut apakah parameter itu pernah dipakai, dan itu
 * bukan sekadar kosmetik: parameter yang punya hasil pemeriksaan tidak bisa
 * dihapus sama sekali — `lab_results.parameter_id` adalah foreign key tanpa
 * ON DELETE. Menampilkan tombol "Hapus" untuk keduanya lalu diam-diam
 * menonaktifkan yang satu akan membuat pengguna mengira datanya hilang
 * padahal masih ada, atau sebaliknya.
 */
export function HapusParameter({
  id,
  nama,
  terpakai,
  aktif,
}: {
  id: number;
  nama: string;
  /** Berapa hasil pemeriksaan yang memakai parameter ini. */
  terpakai: number;
  aktif: boolean;
}) {
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [proses, setProses] = useState(false);

  const bisaDihapus = terpakai === 0;

  async function jalankan() {
    setProses(true);
    try {
      const hasil = await hapusParameterAction(id);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 8000 });
        return;
      }
      setBuka(false);
      toast.success(
        hasil.data.dihapus
          ? `Parameter ${nama} dihapus.`
          : `Parameter ${nama} dinonaktifkan. Hasil pemeriksaan lama tetap utuh.`,
        { duration: 6000 },
      );
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  async function aktifkan() {
    setProses(true);
    try {
      const hasil = await aktifkanParameterAction(id);
      if (!hasil.ok) {
        toast.error(hasil.error);
        return;
      }
      toast.success(`Parameter ${nama} aktif kembali.`);
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  if (!aktif) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={aktifkan} disabled={proses}>
        <RotateCcw />
        Aktifkan
      </Button>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`${bisaDihapus ? "Hapus" : "Nonaktifkan"} parameter ${nama}`}
        onClick={() => setBuka(true)}
      >
        <Trash2 />
      </Button>

      <Modal
        open={buka}
        onClose={() => setBuka(false)}
        size="sm"
        title={bisaDihapus ? "Hapus parameter?" : "Nonaktifkan parameter?"}
        description={nama}
        footer={
          <>
            <Button onClick={() => setBuka(false)} disabled={proses}>
              Tutup
            </Button>
            <Button variant="danger" onClick={jalankan} disabled={proses}>
              <Trash2 />
              {proses ? "Memproses…" : bisaDihapus ? "Hapus" : "Nonaktifkan"}
            </Button>
          </>
        }
      >
        {bisaDihapus ? (
          <p className="text-meta text-ink-muted">
            Parameter ini belum pernah dipakai pada satu pun hasil pemeriksaan,
            jadi bisa benar-benar dihapus tanpa meninggalkan jejak.
          </p>
        ) : (
          <p className="text-meta text-ink-muted">
            Parameter ini sudah dipakai pada <strong>{terpakai} hasil
            pemeriksaan</strong>, jadi <strong>tidak dihapus</strong> melainkan
            dinonaktifkan. Ia hilang dari order baru, sementara hasil lama tetap
            terbaca lengkap dengan satuan dan nilai rujukan yang berlaku saat
            itu. Menghapusnya akan memusnahkan hasil pemeriksaan pasien.
          </p>
        )}
      </Modal>
    </>
  );
}
