import { cn } from "@/lib/utils";

/**
 * Kerangka pemuatan (skeleton).
 *
 * MENGAPA BUKAN SPINNER
 *
 * Spinner berkata "tunggu"; kerangka berkata "tunggu, dan beginilah bentuk
 * yang akan muncul". Untuk layar yang dibuka puluhan kali sehari oleh orang
 * yang sama, bentuk itu sendiri sudah jadi penanda: petugas tahu ia membuka
 * layar yang benar sebelum datanya sampai.
 *
 * Kerangka SENGAJA tidak meniru datanya. Tidak ada angka palsu, tidak ada
 * nama palsu — hanya balok abu. Data palsu yang sekilas terbaca sebagai
 * data asli adalah hal terakhir yang boleh ada di layar klinis.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-surface-alt", className)}
      {...props}
    />
  );
}

/** Sebaris angka ringkasan — bentuk `<StatCard>`. */
export function KerangkaStat({ jumlah = 3 }: { jumlah?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {Array.from({ length: jumlah }, (_, i) => (
        <div key={i} className="rounded-lg border border-line bg-surface p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2.5 h-7 w-14" />
        </div>
      ))}
    </div>
  );
}

/** Card berisi daftar baris — bentuk worklist di hampir semua modul. */
export function KerangkaDaftar({ baris = 5 }: { baris?: number }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-5 w-8" />
      </div>
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: baris }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-md border border-line bg-surface-alt/60 px-3 py-2.5"
          >
            <Skeleton className="size-11 shrink-0 bg-surface-alt" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-48 max-w-full bg-surface-alt" />
              <Skeleton className="mt-1.5 h-3 w-64 max-w-full bg-surface-alt" />
            </div>
            <Skeleton className="hidden h-5 w-20 shrink-0 bg-surface-alt sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Teks pendamping kerangka.
 *
 * Kerangka menjelaskan BENTUK, kalimat ini menjelaskan SEBAB. Tanpanya,
 * layar yang lama memuat karena jaringan klinik sedang lambat tidak bisa
 * dibedakan dari layar yang macet.
 */
export function KerangkaKeterangan({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-center text-meta text-ink-faint"
      role="status"
      aria-live="polite"
    >
      {children}
    </p>
  );
}
