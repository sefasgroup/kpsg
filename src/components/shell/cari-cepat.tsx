"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CornerDownLeft, Lock, Search, TriangleAlert } from "lucide-react";
import { formatTanggalPendek, hitungUmur } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/visit-status";
import { cariCepatAction } from "./cari-actions";
import type { BarisCari } from "@/lib/pencarian";

/**
 * Pencarian cepat lintas modul — Ctrl/⌘ + K.
 *
 * MASALAH YANG DITUTUP KOMPONEN INI
 *
 * Setiap layar dijangkau dengan menyusuri sidebar, sehingga pertanyaan
 * paling sering di klinik — "pasien X sekarang di mana?" — hanya bisa
 * dijawab oleh orang yang SUDAH tahu jawabannya, karena ia harus menebak
 * modulnya lebih dulu. Kotak ini membalik urutannya: ketik namanya, sistem
 * yang memberi tahu ia sedang di mana.
 *
 * KEPUTUSAN YANG MEMBENTUKNYA
 *
 * - **Hasil selalu tampil, tautan belum tentu.** Peran yang tidak punya
 *   layar untuk pasien itu tetap melihat posisinya. Menjawab "di mana"
 *   tidak butuh izin membuka rekamnya, dan menyembunyikan barisnya hanya
 *   membuat pemisahan tugas terasa seperti kerusakan.
 *
 * - **Dijalankan setelah berhenti mengetik, bukan tiap ketukan.** Tanpa
 *   jeda, mengetik "Gideon" berarti enam kueri lintas tabel; lima di
 *   antaranya hasilnya dibuang sebelum sempat terbaca.
 *
 * - **Balasan yang menyalip dibuang.** Kueri yang berangkat lebih dulu
 *   bisa tiba belakangan. Tanpa nomor urut, huruf terakhir yang diketik
 *   bisa menampilkan hasil huruf sebelumnya — dan di layar berisi nama
 *   pasien, itu bukan sekadar kedipan. Hasil lama yang masih relevan tetap
 *   ditampilkan (diredupkan) selagi kueri baru berjalan; yang dibuang
 *   adalah balasannya, bukan tampilannya.
 */
export function CariCepat() {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [buka, setBuka] = useState(false);
  const [q, setQ] = useState("");
  const [sorot, setSorot] = useState(0);

  /*
   * Hasil disimpan BERSAMA kata kunci yang menghasilkannya.
   *
   * Dengan begitu "sedang memuat" dan "hasil sudah basi" tidak perlu
   * disimpan sebagai state tersendiri — keduanya cukup diturunkan dengan
   * membandingkan `untuk` dan ketikan sekarang. Pola yang sama dipakai
   * `notif-bell.tsx` dan `nav-laci.tsx`; state yang bisa diturunkan adalah
   * state yang bisa tidak sinkron.
   */
  const [data, setData] = useState<{ untuk: string; rows: BarisCari[] } | null>(
    null,
  );

  const kata = q.trim();
  const memuat = kata.length >= 2 && (data === null || data.untuk !== kata);

  /*
   * Hasil lama SENGAJA dibiarkan terlihat selama kueri baru berjalan,
   * hanya diredupkan. Mengosongkan daftar tiap ketukan membuat layar
   * berkedip-kedip persis saat mata sedang membaca nama.
   */
  const hasil = kata.length < 2 ? [] : (data?.rows ?? []);
  const sorotAman = hasil.length === 0 ? 0 : Math.min(sorot, hasil.length - 1);
  const barisSorot = hasil[sorotAman] ?? null;

  // Nomor urut permintaan — penjaga terhadap balasan yang saling menyalip.
  const urutRef = useRef(0);

  // ---- Pintasan papan ketik global ------------------------------------
  useEffect(() => {
    function tekan(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setBuka((b) => !b);
      }
    }
    document.addEventListener("keydown", tekan);
    return () => document.removeEventListener("keydown", tekan);
  }, []);

  // ---- Buka/tutup <dialog> --------------------------------------------
  // `<dialog>` dipakai supaya fokus terkurung dan Esc bekerja tanpa kode
  // tambahan — pola yang sama dengan `components/ui/modal.tsx`.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (buka && !el.open) {
      el.showModal();
      inputRef.current?.focus();
    }
    if (!buka && el.open) el.close();
  }, [buka]);

  /*
   * Baris tersorot ditarik ke dalam pandangan.
   *
   * Daftar dibatasi 60vh, jadi hasil ke-7 dan ke-8 berada di luar layar
   * pada laptop. Tanpa ini, panah turun terasa berhenti bekerja di tengah
   * daftar — sorotannya tetap bergerak, hanya tidak terlihat lagi.
   */
  const daftarRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    daftarRef.current
      ?.querySelector<HTMLElement>('[data-sorot="1"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [sorotAman]);

  // ---- Pencarian bertunda ---------------------------------------------
  useEffect(() => {
    if (kata.length < 2) return;

    const nomor = ++urutRef.current;
    const tunda = setTimeout(async () => {
      try {
        const rows = await cariCepatAction(kata);
        if (nomor !== urutRef.current) return; // sudah disusul ketikan baru
        setData({ untuk: kata, rows });
        setSorot(0);
      } catch {
        // Jaringan putus sesaat: hasil lama dibiarkan, bukan diganti
        // daftar kosong yang terbaca sebagai "pasiennya tidak ada".
        if (nomor === urutRef.current) setData({ untuk: kata, rows: [] });
      }
    }, 250);

    return () => clearTimeout(tunda);
  }, [kata]);

  function tutup() {
    setBuka(false);
    setQ("");
    setData(null);
    setSorot(0);
  }

  function pilih(b: BarisCari) {
    if (!b.link) return;
    tutup();
    router.push(b.link);
  }

  /*
   * Dipasang pada <dialog>, BUKAN pada input.
   *
   * Sekali pengguna menyentuh salah satu baris hasil dengan tetikus, fokus
   * pindah dari kotak ketik ke tombol baris itu — dan panah naik/turun yang
   * hanya dipasang di input diam-diam berhenti bekerja tepat pada saat
   * pengguna paling ingin memakainya. Di tingkat dialog, penekanan dari
   * elemen mana pun di dalamnya tetap sampai.
   */
  function navigasi(e: React.KeyboardEvent<HTMLDialogElement>) {
    if (hasil.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSorot((i) => (i + 1) % hasil.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSorot((i) => (i - 1 + hasil.length) % hasil.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setSorot(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setSorot(hasil.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pilih(hasil[sorotAman]);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setBuka(true)}
        aria-label="Cari pasien"
        className="flex items-center gap-1.5 rounded-md border border-line bg-surface-alt px-2 py-1.5 text-meta text-ink-faint transition-colors hover:border-line-strong hover:text-ink-muted md:px-2.5"
      >
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="hidden md:inline">Cari pasien…</span>
        <kbd className="hidden rounded-sm border border-line bg-surface px-1 font-sans text-micro text-ink-faint lg:inline">
          Ctrl K
        </kbd>
      </button>

      <dialog
        ref={dialogRef}
        onKeyDown={navigasi}
        onCancel={(e) => {
          e.preventDefault();
          tutup();
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current) tutup();
        }}
        /*
         * Ditambatkan di ATAS, bukan di tengah: daftar hasil tumbuh ke
         * bawah, dan kotak yang tetap di tengah membuat baris pertama
         * melompat setiap kali jumlah hasil berubah.
         */
        className="mx-auto mt-[8vh] w-[calc(100%-2rem)] max-w-xl rounded-lg border border-line bg-surface p-0 text-ink shadow-overlay backdrop:bg-ink/40"
      >
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
          <Search className="size-4 shrink-0 text-ink-faint" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nama pasien, NIK, atau No. RM…"
            aria-label="Cari pasien"
            role="combobox"
            aria-expanded={hasil.length > 0}
            aria-controls="cari-cepat-daftar"
            aria-activedescendant={
              hasil.length > 0 ? `cari-cepat-opsi-${sorotAman}` : undefined
            }
            className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none"
          />
          {memuat ? (
            <span className="text-meta text-ink-faint">mencari…</span>
          ) : null}
        </div>

        <div
          className={`max-h-[60vh] overflow-y-auto transition-opacity ${
            memuat && hasil.length > 0 ? "opacity-50" : ""
          }`}
        >
          {q.trim().length < 2 ? (
            <p className="px-3.5 py-6 text-center text-meta text-ink-faint">
              Ketik minimal 2 huruf. Pencarian mencakup seluruh cabang —
              satu NIK adalah satu pasien di seluruh jaringan.
            </p>
          ) : hasil.length === 0 && !memuat ? (
            <p className="px-3.5 py-6 text-center text-meta text-ink-faint">
              Tidak ada pasien yang cocok.
            </p>
          ) : (
            <ul id="cari-cepat-daftar" ref={daftarRef} role="listbox">
              {hasil.map((b, i) => {
                const bisa = Boolean(b.link);
                const disorot = i === sorotAman;
                return (
                  <li key={b.patientId} className="border-b border-line last:border-b-0">
                    {/*
                      Baris yang tidak bisa dibuka TIDAK di-`disabled`.

                      Tombol disabled tidak menerima hover, tidak bisa
                      disorot, dan tidak menjelaskan apa pun — sehingga
                      papan ketik terlihat rusak padahal yang berlaku
                      hanyalah pemisahan tugas. Barisnya tetap ikut
                      disorot; yang berbeda hanya keterangan di kakinya.
                    */}
                    <button
                      type="button"
                      id={`cari-cepat-opsi-${i}`}
                      role="option"
                      aria-selected={disorot}
                      aria-disabled={!bisa}
                      data-sorot={disorot ? "1" : undefined}
                      tabIndex={-1}
                      onMouseEnter={() => setSorot(i)}
                      onClick={() => pilih(b)}
                      className={`flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors ${
                        bisa ? "cursor-pointer" : "cursor-default"
                      } ${disorot ? (bisa ? "bg-brand-50" : "bg-surface-alt") : ""}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-medium text-ink">
                          {b.nama}
                          {b.alergi ? (
                            <span className="ml-2 inline-flex items-center gap-1 align-middle text-micro text-danger uppercase">
                              <TriangleAlert className="size-3" aria-hidden />
                              alergi: {b.alergi}
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate text-meta text-ink-muted">
                          <span className="font-mono">{b.noRm}</span> ·{" "}
                          <span className="font-mono">{b.nik}</span> ·{" "}
                          {b.jenisKelamin === "L" ? "L" : "P"} ·{" "}
                          {hitungUmur(b.tanggalLahir)} th
                        </p>

                        {/*
                          Baris posisi — inti dari seluruh kotak ini. Tanpa
                          baris ini, pencarian hanya mengulang daftar pasien
                          yang sudah ada di layar Riwayat.
                        */}
                        {b.status ? (
                          <p className="mt-0.5 truncate text-meta">
                            <span className="font-medium text-brand-700">
                              {STATUS_LABEL[b.status] ?? b.status}
                            </span>
                            {b.poliNama ? (
                              <span className="text-ink-muted"> · {b.poliNama}</span>
                            ) : null}
                            {b.antrean ? (
                              <span className="text-ink-muted">
                                {" "}
                                · antrean{" "}
                                <span className="font-mono">{b.antrean}</span>
                              </span>
                            ) : null}
                            {b.tanggal ? (
                              <span className="text-ink-faint">
                                {" "}
                                · {formatTanggalPendek(b.tanggal)}
                              </span>
                            ) : null}
                          </p>
                        ) : (
                          <p className="mt-0.5 text-meta text-ink-faint">
                            Tidak sedang dalam kunjungan.
                          </p>
                        )}

                        {/*
                          Ketiadaan tautan selalu DIJELASKAN. Baris yang
                          diam-diam tidak bisa ditekan terbaca sebagai
                          kerusakan, bukan sebagai aturan.
                        */}
                        {b.cabangLain ? (
                          <p className="mt-0.5 flex items-center gap-1 text-meta text-warning">
                            <Building2 className="size-3" aria-hidden />
                            Kunjungan di cabang {b.siteNama} — pindah cabang
                            dulu untuk membukanya.
                          </p>
                        ) : !bisa && b.status ? (
                          <p className="mt-0.5 text-meta text-ink-faint">
                            Belum ada yang bisa Anda kerjakan untuk pasien ini.
                          </p>
                        ) : null}
                      </div>

                      {bisa ? (
                        <CornerDownLeft
                          className={`mt-1 size-3.5 shrink-0 ${
                            disorot ? "text-brand-600" : "text-ink-faint"
                          }`}
                          aria-hidden
                        />
                      ) : (
                        <Lock className="mt-1 size-3.5 shrink-0 text-ink-faint" aria-hidden />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/*
          Kaki yang IKUT BERUBAH. "Enter buka" yang tetap tertulis di bawah
          baris yang memang tidak bisa dibuka adalah janji yang dilanggar
          setiap kali ditekan — dan itulah yang terbaca sebagai kerusakan.
        */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-surface-alt px-3.5 py-2 text-micro text-ink-faint">
          <span>↑ ↓ pilih</span>
          {barisSorot && !barisSorot.link ? (
            <span className="text-warning">
              Enter tidak tersedia — baris ini tidak bisa Anda buka
            </span>
          ) : (
            <span>Enter buka</span>
          )}
          <span>Esc tutup</span>
        </div>
      </dialog>
    </>
  );
}
