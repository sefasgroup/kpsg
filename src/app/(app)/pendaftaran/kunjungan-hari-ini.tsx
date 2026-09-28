"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import toast from "react-hot-toast";
import { UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Field, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { StatusVisitBadge } from "@/components/ui/status-badge";
import { formatJam, formatTanggalPendek, hitungUmur } from "@/lib/format";
import { batalkanKunjunganAction } from "./actions";

/** Kunjungan yang sudah tuntas atau sudah batal tidak bisa dibatalkan lagi. */
const BISA_DIBATALKAN = (status: string) =>
  !["selesai", "batal"].includes(status);

export type BarisKunjungan = {
  id: number;
  no_visit: string;
  waktu_daftar: string;
  status: string;
  jenis_kunjungan: "baru" | "lama";
  cara_bayar: string;
  no_rm: string;
  nama: string;
  tanggal_lahir: string;
  jenis_kelamin: "L" | "P";
  poli_nama: string;
  dokter_nama: string;
  antrean: string | null;
};

export function KunjunganHariIni({
  data,
  tampilkanTanggal,
}: {
  data: BarisKunjungan[];
  /** Untuk daftar tertunda: jam saja tidak cukup, harinya yang menentukan. */
  tampilkanTanggal?: boolean;
}) {
  const router = useRouter();
  /** Kunjungan yang sedang dimintakan pembatalan — null berarti dialog tutup. */
  const [batal, setBatal] = useState<BarisKunjungan | null>(null);
  const [alasan, setAlasan] = useState("");
  const [proses, setProses] = useState(false);

  async function jalankanPembatalan() {
    if (!batal) return;
    setProses(true);
    try {
      const hasil = await batalkanKunjunganAction(batal.id, alasan);
      if (!hasil.ok) {
        toast.error(hasil.error, { duration: 9000 });
        return;
      }
      setBatal(null);
      setAlasan("");
      toast.success(
        `Kunjungan ${hasil.data.noVisit} — ${hasil.data.pasien} dibatalkan.`,
        { duration: 6000 },
      );
      router.refresh();
    } finally {
      setProses(false);
    }
  }

  const columns = useMemo<ColumnDef<BarisKunjungan, unknown>[]>(
    () => [
      {
        accessorKey: "antrean",
        header: "Antrean",
        cell: ({ row }) => (
          <span className="font-mono font-semibold text-brand-700">
            {row.original.antrean ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "waktu_daftar",
        header: tampilkanTanggal ? "Tanggal" : "Jam",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-ink-muted">
            {tampilkanTanggal
              ? `${formatTanggalPendek(row.original.waktu_daftar)} ${formatJam(row.original.waktu_daftar)}`
              : formatJam(row.original.waktu_daftar)}
          </span>
        ),
      },
      {
        accessorKey: "nama",
        header: "Pasien",
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.original.nama}</p>
            <p className="truncate text-meta text-ink-muted">
              <span className="font-mono">{row.original.no_rm}</span> ·{" "}
              {row.original.jenis_kelamin === "L" ? "L" : "P"} ·{" "}
              {hitungUmur(row.original.tanggal_lahir)} th
            </p>
          </div>
        ),
      },
      { accessorKey: "poli_nama", header: "Poli" },
      {
        accessorKey: "dokter_nama",
        header: "Dokter",
        cell: ({ row }) => (
          <span className="text-ink-muted">{row.original.dokter_nama}</span>
        ),
      },
      {
        accessorKey: "jenis_kunjungan",
        header: "Kunjungan",
        cell: ({ row }) => (
          <span className="text-meta text-ink-muted capitalize">
            {row.original.jenis_kunjungan}
          </span>
        ),
      },
      {
        accessorKey: "cara_bayar",
        header: "Bayar",
        cell: ({ row }) => (
          <span className="text-meta text-ink-muted uppercase">
            {row.original.cara_bayar}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusVisitBadge status={row.original.status} />,
      },
      {
        id: "aksi",
        header: "",
        cell: ({ row }) =>
          BISA_DIBATALKAN(row.original.status) ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Batalkan kunjungan ${row.original.no_visit}`}
              onClick={() => {
                setBatal(row.original);
                setAlasan("");
              }}
            >
              <UserX />
              Batalkan
            </Button>
          ) : null,
      },
    ],
    [tampilkanTanggal],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        emptyMessage="Belum ada kunjungan terdaftar hari ini."
      />

      <Modal
        open={batal !== null}
        onClose={() => setBatal(null)}
        size="sm"
        title="Batalkan Kunjungan"
        description={
          batal ? `${batal.antrean ?? "—"} · ${batal.nama} · ${batal.poli_nama}` : undefined
        }
        footer={
          <>
            <Button onClick={() => setBatal(null)} disabled={proses}>
              Tutup
            </Button>
            <Button variant="danger" onClick={jalankanPembatalan} disabled={proses}>
              <UserX />
              {proses ? "Membatalkan…" : "Batalkan Kunjungan"}
            </Button>
          </>
        }
      >
        <ul className="mb-2.5 flex list-inside list-disc flex-col gap-1 text-meta text-ink-muted">
          <li>Nomor antreannya ditutup dan pasien hilang dari seluruh worklist.</li>
          <li>
            Resep yang sudah terbit dibatalkan dan <strong>kunci stoknya
            dilepas</strong> — obatnya kembali tersedia untuk pasien lain.
          </li>
          <li>Order lab yang belum selesai ikut dibatalkan beserta tarifnya.</li>
          <li>
            Ditolak bila pasien sudah membayar atau obatnya sudah diserahkan.
          </li>
        </ul>
        <Field label="Alasan Pembatalan" required>
          <Textarea
            rows={3}
            value={alasan}
            maxLength={255}
            onChange={(e) => setAlasan(e.target.value)}
            placeholder="mis. Pasien pulang sebelum dipanggil / salah daftar, poli keliru"
          />
        </Field>
      </Modal>
    </>
  );
}
