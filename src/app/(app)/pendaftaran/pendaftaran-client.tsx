"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IdCard, TicketPlus, TriangleAlert, UserPlus, UserSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchBar } from "@/components/ui/search-bar";
import { hitungUmur } from "@/lib/format";
import { cariPasienAction } from "./actions";
import { PasienBaruForm } from "./pasien-baru-form";
import {
  DaftarKunjunganModal,
  type Opsi,
  type OpsiPenjamin,
  type PasienTerpilih,
} from "./daftar-kunjungan-modal";

type Hasil = PasienTerpilih & { site_nama: string | null };

export function PendaftaranClient({
  poliList,
  dokterList,
  penjamin,
}: {
  poliList: Opsi[];
  dokterList: Opsi[];
  penjamin: OpsiPenjamin[];
}) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [mencari, startCari] = useTransition();

  // Hasil disimpan bersama kata kunci yang menghasilkannya, supaya hasil lama
  // tidak sempat tampil untuk kata kunci yang sedang diketik.
  const [cache, setCache] = useState<{ q: string; rows: Hasil[] }>({
    q: "",
    rows: [],
  });

  const [pasienBaruOpen, setPasienBaruOpen] = useState(false);
  const [pasienDipilih, setPasienDipilih] = useState<PasienTerpilih | null>(null);

  const q = keyword.trim();

  // Debounce agar tidak menembak server tiap ketikan.
  useEffect(() => {
    if (q.length < 2) return;
    const timer = setTimeout(() => {
      startCari(async () => {
        const res = await cariPasienAction(q);
        setCache({ q, rows: res.ok ? (res.data as unknown as Hasil[]) : [] });
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  // Turunan, bukan state — hasil hanya dianggap sahih bila kata kuncinya cocok.
  const sudahCari = q.length >= 2 && cache.q === q;
  const hasil = sudahCari ? cache.rows : [];

  const nikDiketik = /^\d{6,16}$/.test(q) ? q : undefined;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle icon={UserSearch}>Cari Pasien</CardTitle>
          <Button variant="primary" size="sm" onClick={() => setPasienBaruOpen(true)}>
            <UserPlus />
            Pasien Baru
          </Button>
        </CardHeader>

        <SearchBar
          value={keyword}
          onChange={setKeyword}
          loading={mencari}
          autoFocus
          placeholder="Ketik NIK, No. RM, atau nama pasien…"
        />

        {q.length > 0 && q.length < 2 ? (
          <p className="mt-2 text-meta text-ink-faint">
            Ketik minimal 2 karakter untuk mulai mencari.
          </p>
        ) : null}

        {sudahCari && hasil.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1.5">
            {hasil.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setPasienDipilih(p)}
                  className="flex w-full items-center gap-3 rounded-md border border-line bg-surface-alt px-3 py-2.5 text-left transition-colors hover:border-brand-400 hover:bg-brand-50"
                >
                  <IdCard className="size-4 shrink-0 text-ink-faint" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-ink">
                      {p.nama}
                      {p.alergi ? (
                        <span className="ml-2 inline-flex items-center gap-1 align-middle text-micro text-danger">
                          <TriangleAlert className="size-3" aria-hidden />
                          alergi
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-meta text-ink-muted">
                      <span className="font-mono">{p.no_rm}</span> · NIK{" "}
                      <span className="font-mono">{p.nik}</span> ·{" "}
                      {p.jenis_kelamin === "L" ? "L" : "P"} ·{" "}
                      {hitungUmur(p.tanggal_lahir)} th
                      {p.site_nama ? ` · ${p.site_nama}` : ""}
                    </p>
                  </div>
                  <Badge variant="brand">
                    <TicketPlus />
                    Daftarkan
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {sudahCari && hasil.length === 0 && !mencari ? (
          <div className="mt-3 rounded-md border border-dashed border-line-strong bg-surface-alt px-4 py-6 text-center">
            <p className="text-body text-ink">
              Tidak ada pasien cocok dengan “{q}”.
            </p>
            <p className="mt-1 text-meta text-ink-muted">
              Pencarian mencakup seluruh cabang — satu NIK hanya boleh punya satu
              rekam medis.
            </p>
            <Button
              variant="primary"
              size="sm"
              className="mt-3"
              onClick={() => setPasienBaruOpen(true)}
            >
              <UserPlus />
              Daftarkan sebagai Pasien Baru
            </Button>
          </div>
        ) : null}

        {q.length === 0 ? (
          <p className="mt-2 text-meta text-ink-faint">
            Cari dulu sebelum membuat rekam medis baru — mencegah RM ganda untuk
            pasien yang pernah berobat di cabang mana pun.
          </p>
        ) : null}
      </Card>

      <PasienBaruForm
        open={pasienBaruOpen}
        onClose={() => setPasienBaruOpen(false)}
        nikAwal={nikDiketik}
        onCreated={(p) => {
          // Langsung lanjut ke pendaftaran kunjungan — frontdesk jarang
          // hanya ingin membuat RM tanpa mendaftarkan kunjungannya.
          setKeyword(String(p.no_rm));
          router.refresh();
        }}
      />

      <DaftarKunjunganModal
        open={pasienDipilih !== null}
        onClose={() => setPasienDipilih(null)}
        pasien={pasienDipilih}
        poliList={poliList}
        dokterList={dokterList}
        penjamin={penjamin}
        onRegistered={() => {
          setKeyword("");
          router.refresh();
        }}
      />
    </>
  );
}
