import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "default" | "success" | "warning" | "danger" | "info";

const TONE: Record<Tone, string> = {
  default: "text-ink",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
};

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: Tone;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-label text-ink-muted">{label}</p>
        {Icon ? <Icon className="size-4 text-ink-faint" aria-hidden /> : null}
      </div>
      <p className={cn("mt-1.5 text-display tabular", TONE[tone])}>{value}</p>
      {sub ? <p className={cn("mt-0.5 text-meta", tone === "default" ? "text-ink-faint" : TONE[tone])}>{sub}</p> : null}
    </div>
  );
}
