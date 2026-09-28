import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  // brand-600 dipakai (bukan brand-500) agar teks putih lolos kontras 4.5:1
  primary:
    "bg-brand-600 text-white border border-brand-600 hover:bg-brand-700 hover:border-brand-700 disabled:bg-brand-300 disabled:border-brand-300",
  secondary:
    "bg-surface text-ink border border-line hover:bg-surface-alt hover:border-line-strong",
  ghost:
    "bg-transparent text-ink-muted border border-transparent hover:bg-surface-alt hover:text-ink",
  danger:
    "bg-danger text-white border border-danger hover:brightness-90",
};

/*
 * `sm` tumbuh jadi 36px pada perangkat sentuh.
 *
 * DESIGN-SYSTEM §7 mensyaratkan target sentuh minimal 36×36px karena tablet
 * dipakai di ruang perawat, sementara `h-8` hanya 32px. Menaikkannya secara
 * menyeluruh bukan jawabannya: `sm` justru ada untuk tabel padat di layar
 * desktop, dan menyamakannya dengan `md` menghapus alasan keberadaannya.
 *
 * `pointer-coarse` menyelesaikan keduanya — persis pada perangkat yang
 * ditunjuk aturannya, dan tidak di tempat lain.
 */
const SIZE: Record<Size, string> = {
  sm: "h-8 pointer-coarse:h-9 px-2.5 text-meta gap-1.5",
  md: "h-9 px-3.5 text-body gap-2",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  className,
  variant = "secondary",
  size = "md",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium",
        "transition-colors disabled:cursor-not-allowed disabled:opacity-70",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...props}
    />
  );
}
