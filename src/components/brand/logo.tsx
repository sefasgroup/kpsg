import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Aturan pemakaian logo — docs/DESIGN-SYSTEM.md §1.2
 *
 * <BrandMark>     : mark saja. Sidebar, favicon, thermal, etiket.
 * <BrandLockup>   : mark + wordmark HTML. Sidebar (lebih tajam daripada
 *                   men-scale logo bertext ke tinggi 36px).
 * <BrandFullLogo> : file logo bertext asli. Login & kop surat A4/A5 —
 *                   satu-satunya tempat identitas perlu dieja penuh.
 */

export function BrandMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src="/brand/kpsg-mark-192.png"
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      priority
    />
  );
}

export function BrandLockup({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <BrandMark size={28} />
      <div className="leading-tight">
        <p className="text-meta text-ink-muted">Klinik Pratama</p>
        <p className="text-h2 text-brand-700">Sahabat Gamma</p>
      </div>
    </div>
  );
}

export function BrandFullLogo({
  width = 260,
  className,
}: {
  width?: number;
  className?: string;
}) {
  return (
    <Image
      src="/brand/kpsg-logo-1024.png"
      alt="Klinik Pratama Sahabat Gamma"
      width={width}
      height={Math.round((width * 186) / 1024)}
      className={className}
      priority
    />
  );
}
