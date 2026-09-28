import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Card = permukaan datar bergaris. Bayangan hanya untuk elemen melayang. */
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface p-4",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mb-3 flex flex-wrap items-center justify-between gap-2",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  icon: Icon,
  children,
  className,
}: {
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2 className={cn("flex items-center gap-2 text-h2 text-ink", className)}>
      {Icon ? <Icon className="size-4 text-brand-600" aria-hidden /> : null}
      {children}
    </h2>
  );
}
