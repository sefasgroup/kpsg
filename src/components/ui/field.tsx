import * as React from "react";
import { cn } from "@/lib/utils";

const control = cn(
  "w-full rounded-md border border-line bg-surface px-3 text-body text-ink",
  "transition-colors hover:border-line-strong",
  "disabled:bg-surface-alt disabled:text-ink-muted disabled:cursor-not-allowed",
  "aria-[invalid=true]:border-danger",
);

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(control, "h-9", className)} {...props} />;
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={cn(control, "h-9", className)} {...props} />;
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea ref={ref} className={cn(control, "min-h-20 py-2", className)} {...props} />
  );
});

/**
 * Pembungkus label + kontrol + pesan error.
 * `required` menampilkan penanda wajib — dipakai antara lain untuk
 * Aturan Pakai, yang wajib diisi per CLAUDE.md §4.
 */
export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  /** Boleh berupa elemen — mis. tombol kecil "salin dari perawat". */
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-label text-ink-muted">
        {label}
        {required ? (
          <span className="ml-0.5 text-danger" aria-label="wajib diisi">
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p className="text-meta text-danger">{error}</p>
      ) : hint ? (
        <p className="text-meta text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}
