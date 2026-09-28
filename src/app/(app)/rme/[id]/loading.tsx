import { KerangkaKeterangan, Skeleton } from "@/components/ui/skeleton";

/**
 * Layar pemeriksaan dokter menimpa kerangka umum `(app)/loading.tsx`.
 *
 * Alasannya bukan estetika: layar ini yang paling berat di seluruh sistem
 * (kunjungan, asesmen, resep, order lab, riwayat, surat — semuanya dimuat
 * sekaligus), sehingga justru di sinilah jeda paling terasa. Kerangka
 * umum berbentuk "ringkasan + daftar" akan berkedip jadi bentuk yang sama
 * sekali lain begitu data sampai.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
      <Skeleton className="h-4 w-36" />

      {/* Header pasien — balok besar nomor antrean + identitas. */}
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start gap-3">
          <Skeleton className="size-12 shrink-0" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-5 w-56 max-w-full" />
            <Skeleton className="mt-1.5 h-3 w-72 max-w-full" />
            <Skeleton className="mt-1.5 h-3 w-64 max-w-full" />
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2 border-t border-line pt-2.5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-3 w-16" />
          ))}
        </div>
      </div>

      {/* Badan SOAP: kolom isi + rel navigasi di kanan pada layar lebar. */}
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[1fr_10rem] lg:items-start">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="rounded-lg border border-line bg-surface p-4">
              <Skeleton className="h-4 w-52" />
              <Skeleton className="mt-3 h-20 w-full" />
            </div>
          ))}
        </div>
        <div className="hidden flex-col gap-1 rounded-md border border-line bg-surface p-1 lg:flex">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>

      <KerangkaKeterangan>Memuat rekam medis pasien…</KerangkaKeterangan>
    </div>
  );
}
