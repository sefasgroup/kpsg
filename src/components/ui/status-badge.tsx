import { Badge, type BadgeVariant } from "./badge";
import { STATUS_LABEL } from "@/lib/visit-status";

/**
 * Warna status kunjungan mengikuti "siapa yang sedang menunggu ditangani":
 * netral = sedang dikerjakan, kuning = mengantre, hijau = tuntas, merah = batal.
 */
const VARIANT: Record<string, BadgeVariant> = {
  terdaftar: "neutral",
  menunggu_perawat: "warning",
  dikaji_perawat: "info",
  menunggu_dokter: "warning",
  dalam_pemeriksaan: "info",
  menunggu_lab: "warning",
  menunggu_farmasi: "warning",
  menunggu_kasir: "warning",
  menunggu_obat: "info",
  selesai: "success",
  batal: "danger",
};

export function StatusVisitBadge({ status }: { status: string }) {
  return (
    <Badge variant={VARIANT[status] ?? "neutral"}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}
