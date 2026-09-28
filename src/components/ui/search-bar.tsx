"use client";

import { Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pola search-first dari prototipe klinik.html — modul klinis dimulai
 * dari pencarian, bukan dari daftar semua pasien.
 */
export function SearchBar({
  value,
  onChange,
  placeholder = "Cari…",
  loading,
  autoFocus,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  loading?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3",
        "focus-within:border-brand-400",
        className,
      )}
    >
      <Search className="size-4 shrink-0 text-ink-faint" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {loading ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-ink-faint" aria-hidden />
      ) : value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Bersihkan pencarian"
          className="shrink-0 rounded-sm text-ink-faint hover:text-ink"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
