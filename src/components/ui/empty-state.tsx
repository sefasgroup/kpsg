import type { LucideIcon } from "lucide-react";

/**
 * Pola search-first: layar modul klinis dimulai kosong sampai pasien dipilih.
 * Diadopsi dari prototipe klinik.html (#rm-empty) — polanya sudah tepat.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-line bg-surface px-5 py-11 text-center">
      <Icon className="size-11 text-ink-faint" aria-hidden strokeWidth={1.5} />
      <p className="mt-2.5 text-h2 text-ink">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-meta text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
