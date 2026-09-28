import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant =
  | "brand"
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "racikan";

const VARIANT: Record<BadgeVariant, string> = {
  brand: "bg-brand-50 text-brand-700 border-brand-200",
  neutral: "bg-surface-alt text-ink-muted border-line",
  success: "bg-success-bg text-success border-success/25",
  warning: "bg-warning-bg text-warning border-warning/25",
  danger: "bg-danger-bg text-danger border-danger/25",
  info: "bg-info-bg text-info border-info/25",
  // Ungu = penanda RACIKAN, konsisten dari layar dokter sampai struk kasir
  racikan: "bg-racikan-bg text-racikan border-racikan/25",
};

export function Badge({
  variant = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        "text-micro uppercase tracking-wide whitespace-nowrap",
        "[&_svg]:size-3 [&_svg]:shrink-0",
        VARIANT[variant],
        className,
      )}
      {...props}
    />
  );
}

/**
 * Triase — warna standar nasional.
 * Label teks WAJIB ikut tampil; warna tidak pernah jadi satu-satunya penanda.
 */
const TRIASE: Record<string, string> = {
  merah: "bg-triage-merah text-white border-triage-merah",
  kuning: "bg-triage-kuning text-white border-triage-kuning",
  hijau: "bg-triage-hijau text-white border-triage-hijau",
  hitam: "bg-triage-hitam text-white border-triage-hitam",
};

export function TriaseBadge({ level }: { level: keyof typeof TRIASE }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5",
        "text-micro uppercase tracking-wide",
        TRIASE[level],
      )}
    >
      Triase {level}
    </span>
  );
}
