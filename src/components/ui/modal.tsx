"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Modal berbasis <dialog> agar fokus terkurung dan Esc bekerja tanpa
 * kode tambahan — penting karena banyak operator klinik memakai keyboard.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const SIZE = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl" };

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Klik di backdrop (di luar kotak konten) menutup modal.
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-lg border border-line bg-surface p-0 text-ink",
        "shadow-overlay backdrop:bg-ink/40",
        SIZE[size],
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
        <div>
          <h2 className="text-h2 text-ink">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-meta text-ink-muted">{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup"
          className="rounded-md p-1 text-ink-faint transition-colors hover:bg-surface-alt hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>

      {footer ? (
        <div className="flex justify-end gap-2 border-t border-line bg-surface-alt px-5 py-3">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
