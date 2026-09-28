"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { SearchBar } from "./search-bar";

/**
 * Autocomplete generik berbasis Server Action.
 * Dipakai untuk ICD-10, tindakan medis, obat, dan bahan racikan —
 * pola pencariannya sama, hanya sumber datanya berbeda.
 */
export function Autocomplete<T>({
  cari,
  onPilih,
  placeholder,
  renderBaris,
  keyOf,
  nonaktif,
  minKarakter = 2,
}: {
  cari: (keyword: string) => Promise<T[]>;
  onPilih: (item: T) => void;
  placeholder: string;
  renderBaris: (item: T) => React.ReactNode;
  keyOf: (item: T) => string | number;
  /** Menonaktifkan baris tertentu, mis. obat yang stoknya habis. */
  nonaktif?: (item: T) => boolean;
  minKarakter?: number;
}) {
  const [keyword, setKeyword] = useState("");
  const [mencari, startCari] = useTransition();
  const [cache, setCache] = useState<{ q: string; rows: T[] }>({ q: "", rows: [] });

  const q = keyword.trim();

  useEffect(() => {
    if (q.length < minKarakter) return;
    /*
     * Jawaban yang datang setelah kata kunci berganti DIBUANG. Tanpa ini
     * pencarian "para" yang lambat bisa tiba sesudah "parac" dan menimpa
     * cache-nya — daftar lalu menampilkan "tidak ada hasil untuk parac"
     * padahal hasilnya sudah ada.
     */
    let usang = false;
    const timer = setTimeout(() => {
      startCari(async () => {
        try {
          const rows = await cari(q);
          if (!usang) setCache({ q, rows });
        } catch {
          if (!usang) setCache({ q, rows: [] });
        }
      });
    }, 250);
    return () => {
      usang = true;
      clearTimeout(timer);
    };
    // `cari` sengaja tidak dijadikan dependensi: ia adalah referensi Server
    // Action yang stabil per modul, dan memasukkannya memicu pencarian ulang
    // setiap render induk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, minKarakter]);

  const hasil = q.length >= minKarakter && cache.q === q ? cache.rows : [];

  return (
    <div className="flex flex-col gap-2">
      <SearchBar
        value={keyword}
        onChange={setKeyword}
        loading={mencari}
        placeholder={placeholder}
      />

      {hasil.length > 0 ? (
        <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-md border border-line bg-surface p-1">
          {hasil.map((item) => {
            const mati = nonaktif?.(item) ?? false;
            return (
              <li key={keyOf(item)}>
                <button
                  type="button"
                  disabled={mati}
                  onClick={() => {
                    onPilih(item);
                    setKeyword("");
                  }}
                  className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                >
                  <Plus className="size-3.5 shrink-0 text-brand-600" aria-hidden />
                  {renderBaris(item)}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {q.length >= minKarakter && hasil.length === 0 && !mencari ? (
        <p className="text-meta text-ink-faint">Tidak ada hasil untuk “{q}”.</p>
      ) : null}
    </div>
  );
}
