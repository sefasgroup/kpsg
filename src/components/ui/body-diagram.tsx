"use client";

import { useId } from "react";
import { X } from "lucide-react";
import type { TitikLokalis } from "@/lib/validations/doctor";

/**
 * Body diagram status lokalis — dokter menandai titik keluhan pada gambar
 * tubuh tampak depan dan belakang, lalu memberi keterangan per titik.
 *
 * Koordinatnya disimpan dalam PERSEN, bukan piksel. Gambar ini tampil dengan
 * ukuran berbeda di layar, di modal pratinjau, dan di kertas A4; koordinat
 * piksel akan meleset di dua dari tiga tempat itu.
 *
 * Siluetnya satu `<path>` tertutup dan simetris, bukan tumpukan bentuk —
 * bentuk yang bertumpuk memperlihatkan garis tepi di dalam badan.
 */

const SILUET =
  "M 60 8 C 70 8 78 18 78 32 C 78 44 72 52 68 55 L 66 58 " +
  "C 72 60 82 64 88 72 C 93 82 96 100 98 122 C 100 142 101 162 102 180 " +
  "C 103 190 104 198 100 203 C 96 207 92 204 91 196 " +
  "C 90 186 88 168 86 150 C 84 128 82 110 79 92 L 76 88 " +
  "C 75 108 74 128 74 145 C 74 155 75 162 76 170 " +
  "C 76 195 75 225 73 250 C 72 265 71 275 72 283 C 73 289 76 291 74 293 " +
  "L 64 293 C 62 291 62 286 62 280 C 62 250 61 215 60 178 " +
  "C 59 215 58 250 58 280 C 58 286 58 291 56 293 " +
  "L 46 293 C 44 291 47 289 48 283 C 49 275 48 265 47 250 " +
  "C 45 225 44 195 44 170 C 45 162 46 155 46 145 " +
  "C 46 128 45 108 44 88 L 41 92 " +
  "C 38 110 36 128 34 150 C 32 168 30 186 29 196 " +
  "C 28 204 24 207 20 203 C 16 198 17 190 18 180 " +
  "C 19 162 20 142 22 122 C 24 100 27 82 32 72 " +
  "C 38 64 48 60 54 58 L 52 55 C 48 52 42 44 42 32 C 42 18 50 8 60 8 Z";

const LEBAR = 120;
const TINGGI = 300;

export function BodyDiagram({
  titik,
  onTambah,
  onUbah,
  onHapus,
  terkunci = false,
}: {
  titik: TitikLokalis[];
  onTambah?: (t: TitikLokalis) => void;
  onUbah?: (i: number, keterangan: string) => void;
  onHapus?: (i: number) => void;
  terkunci?: boolean;
}) {
  const uid = useId();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap justify-center gap-4">
        {(["depan", "belakang"] as const).map((sisi) => (
          <Gambar
            key={sisi}
            sisi={sisi}
            uid={uid}
            titik={titik}
            terkunci={terkunci}
            onTambah={onTambah}
          />
        ))}
      </div>

      {!terkunci ? (
        <p className="text-center text-meta text-ink-faint">
          Klik pada gambar untuk menandai titik keluhan.
        </p>
      ) : null}

      {titik.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {titik.map((t, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-danger text-micro font-bold text-white">
                {i + 1}
              </span>
              <span className="w-20 shrink-0 text-meta text-ink-muted capitalize">
                {t.sisi}
              </span>
              <input
                value={t.keterangan}
                disabled={terkunci}
                maxLength={255}
                placeholder="Keterangan — mis. nyeri tekan, bengkak, luka 3 cm"
                onChange={(e) => onUbah?.(i, e.target.value)}
                className="h-8 min-w-0 flex-1 basis-64 rounded-md border border-line bg-surface px-2.5 text-body text-ink disabled:bg-surface-alt"
              />
              {!terkunci ? (
                <button
                  type="button"
                  aria-label={`Hapus titik ${i + 1}`}
                  onClick={() => onHapus?.(i)}
                  className="rounded-md p-1 text-ink-faint transition-colors hover:bg-surface-alt hover:text-danger"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Gambar({
  sisi,
  uid,
  titik,
  terkunci,
  onTambah,
}: {
  sisi: "depan" | "belakang";
  uid: string;
  titik: TitikLokalis[];
  terkunci: boolean;
  onTambah?: (t: TitikLokalis) => void;
}) {
  // Nomor titik mengikuti urutan di SELURUH daftar, bukan per sisi — supaya
  // angka pada gambar cocok dengan angka pada daftar keterangan di bawahnya.
  const milikSisi = titik
    .map((t, i) => ({ t, nomor: i + 1 }))
    .filter((x) => x.t.sisi === sisi);

  function klik(e: React.MouseEvent<SVGSVGElement>) {
    if (terkunci || !onTambah) return;
    const kotak = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - kotak.left) / kotak.width) * 100;
    const y = ((e.clientY - kotak.top) / kotak.height) * 100;
    onTambah({
      sisi,
      x: Math.round(Math.min(Math.max(x, 0), 100) * 10) / 10,
      y: Math.round(Math.min(Math.max(y, 0), 100) * 10) / 10,
      keterangan: "",
    });
  }

  return (
    <figure className="flex flex-col items-center gap-1">
      <svg
        viewBox={`0 0 ${LEBAR} ${TINGGI}`}
        onClick={klik}
        role={terkunci ? "img" : "button"}
        aria-label={`Tandai titik keluhan — tampak ${sisi}`}
        className={`h-64 w-auto rounded-md border border-line bg-surface ${
          terkunci ? "" : "cursor-crosshair hover:border-brand-400"
        }`}
      >
        <path
          d={SILUET}
          fill="var(--color-surface-alt, #f3f6f5)"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinejoin="round"
          className="text-ink-muted"
        />
        {/* Garis tengah hanya pada tampak belakang — penanda kolumna vertebra,
            membantu dokter menempatkan titik nyeri punggung. */}
        {sisi === "belakang" ? (
          <line
            x1={60} y1={64} x2={60} y2={168}
            stroke="currentColor" strokeWidth={0.8} strokeDasharray="4 3"
            className="text-ink-faint"
          />
        ) : null}

        {milikSisi.map(({ t, nomor }) => (
          <g key={`${uid}-${nomor}`} pointerEvents="none">
            <circle
              cx={(t.x / 100) * LEBAR}
              cy={(t.y / 100) * TINGGI}
              r={9}
              fill="var(--color-danger, #b91c1c)"
              stroke="#fff"
              strokeWidth={1.5}
            />
            <text
              x={(t.x / 100) * LEBAR}
              y={(t.y / 100) * TINGGI + 3.5}
              textAnchor="middle"
              fontSize={10}
              fontWeight={700}
              fill="#fff"
            >
              {nomor}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="text-meta text-ink-muted capitalize">{sisi}</figcaption>
    </figure>
  );
}
