"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Building2, CheckCheck, Users } from "lucide-react";
import { gayaNotifikasi, waktuRelatif } from "@/lib/notification-labels";
import toast from "react-hot-toast";
import {
  bukaNotifikasiAction,
  muatNotifikasiAction,
  tandaiSemuaDibacaAction,
} from "./notif-actions";

export type NotifItem = {
  id: number;
  jenis: string;
  judul: string;
  pesan: string | null;
  link: string | null;
  is_read: number;
  created_at: string;
  untuk_peran: number;
  site_id: number | null;
  site_nama: string | null;
};

export function NotifBell({
  awal,
  belumDibaca,
  siteAktif,
}: {
  awal: NotifItem[];
  belumDibaca: number;
  /** Cabang aktif — untuk menandai notifikasi yang datang dari cabang lain. */
  siteAktif: number | null;
}) {
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [proses, mulai] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);

  /*
   * Data server adalah sumber kebenaran; hasil muat-ulang dari dalam panel
   * hanya menimpanya sementara.
   *
   * Penimpaan disimpan bersama data server yang menjadi dasarnya (`dari`).
   * Begitu layout dirender ulang, `awal` menjadi array baru sehingga
   * penimpaan otomatis kedaluwarsa — tanpa perlu menyalin state di dalam
   * effect, yang memicu render berantai.
   */
  const [lokal, setLokal] = useState<
    { dari: NotifItem[]; rows: NotifItem[]; belum: number } | null
  >(null);
  const aktif = lokal && lokal.dari === awal ? lokal : null;
  const daftar = aktif ? aktif.rows : awal;
  const setDaftar = (d: { rows: NotifItem[]; belumDibaca: number }) =>
    setLokal({ dari: awal, rows: d.rows, belum: d.belumDibaca });

  /*
   * Notifikasi mendesak yang sudah pernah diserukan lewat toast.
   *
   * Disemai dengan seluruh id yang ADA saat halaman dimuat, sehingga
   * tumpukan lama tidak meledak jadi lima toast sekaligus begitu petugas
   * membuka aplikasi. Yang diserukan hanyalah yang benar-benar datang
   * SELAGI layar terbuka — itulah satu-satunya hal yang tidak akan
   * dilihatnya dengan cara lain.
   */
  const [diumumkan] = useState(() => new Set(awal.map((n) => n.id)));

  useEffect(() => {
    if (!buka) return;
    function klikLuar(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) setBuka(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setBuka(false);
    }
    document.addEventListener("mousedown", klikLuar);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", klikLuar);
      document.removeEventListener("keydown", esc);
    };
  }, [buka]);

  function bukaPanel() {
    const berikutnya = !buka;
    setBuka(berikutnya);
    // Muat ulang saat dibuka: notifikasi bisa masuk setelah halaman dirender.
    if (berikutnya) {
      mulai(async () => setDaftar(await muatNotifikasiAction()));
    }
  }

  /**
   * Menyerukan satu notifikasi mendesak lewat toast.
   *
   * Sengaja BUKAN `toast.error`: warna merah polos tidak memberi tahu apa
   * pun tentang isinya, dan toast yang tidak bisa ditindaklanjuti hanya
   * memindahkan pekerjaan mencari ke pengguna. Toast ini membawa judul,
   * pesan, dan satu tombol yang langsung membuka kunjungannya.
   *
   * `duration` panjang dan bukan tak terhingga: petugas yang sedang
   * menangani pasien lain tidak boleh dipaksa menutup kotak, tetapi juga
   * tidak boleh kehilangan pesannya dalam empat detik.
   */
  function serukan(n: NotifItem) {
    const g = gayaNotifikasi(n.jenis);
    const Icon = g.icon;
    toast.custom(
      (t) => (
        <div
          className={`flex w-88 max-w-[calc(100vw-2rem)] items-start gap-2.5 rounded-lg border border-danger/30 bg-surface p-3 shadow-overlay ${
            t.visible ? "" : "opacity-0"
          }`}
          role="alert"
        >
          <Icon className={`mt-0.5 size-4 shrink-0 ${g.warna}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-micro font-medium text-danger uppercase">{g.label}</p>
            <p className="mt-0.5 text-body font-medium text-ink">{n.judul}</p>
            {n.pesan ? (
              <p className="mt-0.5 text-meta text-ink-muted">{n.pesan}</p>
            ) : null}
            <div className="mt-2 flex gap-2">
              {n.link ? (
                <button
                  type="button"
                  onClick={() => {
                    toast.dismiss(t.id);
                    buka1(n);
                  }}
                  className="rounded-sm bg-brand-600 px-2 py-0.5 text-meta font-medium text-white transition-colors hover:bg-brand-700"
                >
                  Buka
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => toast.dismiss(t.id)}
                className="rounded-sm px-2 py-0.5 text-meta text-ink-muted transition-colors hover:bg-surface-alt hover:text-ink"
              >
                Nanti
              </button>
            </div>
          </div>
        </div>
      ),
      // id disamakan dengan id notifikasi: satu peristiwa = satu toast,
      // meski efek sempat berjalan dua kali (mis. Strict Mode).
      { id: `notif-${n.id}`, duration: 20_000, position: "top-right" },
    );
  }

  function buka1(n: NotifItem) {
    mulai(async () => {
      /*
       * Menandai terbaca dan berpindah cabang dikerjakan satu aksi server.
       * Notifikasi bisa berasal dari cabang lain — dokter yang ditugaskan di
       * beberapa cabang akan mendapat 404 kalau tautannya dibuka sementara
       * cabang aktifnya masih yang lama.
       */
      const { link, pindahKe } = await bukaNotifikasiAction(n.id);
      setBuka(false);

      // Perpindahan cabang diberitahukan, tidak diam-diam: seluruh layar
      // (antrean, stok, tarif) ikut berganti, dan pengguna harus tahu.
      if (pindahKe) toast.success(`Berpindah ke cabang ${pindahKe}`);

      if (link) router.push(link);
      else router.refresh();
    });
  }

  /*
   * Penarikan berkala harus memakai `setDaftar` TERBARU, bukan yang
   * tertangkap saat efek dipasang: penimpaan lokal disimpan bersama `awal`
   * yang menjadi dasarnya, dan closure basi akan menyimpannya dengan
   * `awal` lama — hasil tarikan lalu dibuang diam-diam pada render
   * berikutnya. Ref ini disegarkan setiap render, jadi selalu mutakhir.
   */
  const terapkanRef = useRef<(d: { rows: NotifItem[]; belumDibaca: number }) => void>(
    () => {},
  );
  const bukaRef = useRef(false);

  useEffect(() => {
    bukaRef.current = buka;
    terapkanRef.current = (d) => {
      setDaftar(d);

      // Yang mendesak tidak boleh menunggu ditemukan. Nilai kritis lab dan
      // resep yang dikembalikan berarti seseorang sedang tertahan; lencana
      // kecil di pojok layar bukan cara memberitahukannya.
      for (const n of d.rows) {
        if (n.is_read || diumumkan.has(n.id)) continue;
        if (!gayaNotifikasi(n.jenis).mendesak) continue;
        diumumkan.add(n.id);
        serukan(n);
      }
    };
  });

  /*
   * MASALAH YANG DITUTUP EFEK INI
   *
   * `belumDibaca` dihitung sekali di layout dan tidak pernah lagi. Dokter
   * yang duduk di layar pemeriksaan selama dua puluh menit karena itu
   * TIDAK PERNAH diberi tahu apa pun — termasuk nilai kritis lab yang
   * seluruh alur lab asinkron bergantung padanya. Notifikasinya sampai ke
   * basis data, tidak pernah sampai ke matanya.
   *
   * Penarikan dijeda saat tab tersembunyi (layar klinik dibiarkan terbuka
   * sepanjang hari) dan saat panel sedang dibuka (daftar yang bergeser
   * di bawah kursor membuat orang menekan baris yang salah).
   */
  useEffect(() => {
    const jeda = 45_000;
    let hidup = true;

    async function tarik() {
      if (document.hidden || bukaRef.current) return;
      try {
        const d = await muatNotifikasiAction();
        if (hidup) terapkanRef.current(d);
      } catch {
        // Jaringan klinik putus sesaat bukan alasan menampilkan galat:
        // putaran berikutnya mencoba lagi 45 detik kemudian.
      }
    }

    const putaran = setInterval(tarik, jeda);
    function saatTerlihat() {
      if (!document.hidden) tarik();
    }
    document.addEventListener("visibilitychange", saatTerlihat);

    return () => {
      hidup = false;
      clearInterval(putaran);
      document.removeEventListener("visibilitychange", saatTerlihat);
    };
  }, []);

  /*
   * Setelah ada hasil tarikan, ANGKA ITU yang berlaku — termasuk bila
   * hasilnya nol. Mempertahankan `belumDibaca` dari server sebagai
   * cadangan akan membuat lencana tersangkut di angka lama tepat setelah
   * "Tandai semua" ditekan.
   */
  const belum = aktif ? aktif.belum : belumDibaca;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={bukaPanel}
        aria-label={belum > 0 ? `Notifikasi, ${belum} belum dibaca` : "Notifikasi"}
        aria-expanded={buka}
        className="relative rounded-md p-1.5 text-ink-muted transition-colors hover:bg-surface-alt hover:text-ink"
      >
        <Bell className="size-4" aria-hidden />
        {belum > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] leading-4 font-medium text-white">
            {belum > 99 ? "99+" : belum}
          </span>
        ) : null}
      </button>

      {buka ? (
        <div className="absolute right-0 z-50 mt-1.5 w-88 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface shadow-overlay">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <span className="text-label text-ink">
              Notifikasi
              {belum > 0 ? (
                <span className="ml-1.5 text-meta text-ink-muted">{belum} belum dibaca</span>
              ) : null}
            </span>
            {belum > 0 ? (
              <button
                type="button"
                disabled={proses}
                onClick={() =>
                  mulai(async () => {
                    await tandaiSemuaDibacaAction();
                    setDaftar(await muatNotifikasiAction());
                  })
                }
                className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-meta text-ink-muted transition-colors hover:bg-surface-alt hover:text-ink disabled:opacity-60"
              >
                <CheckCheck className="size-3.5" aria-hidden />
                Tandai semua
              </button>
            ) : null}
          </div>

          <ul className="max-h-96 overflow-y-auto">
            {daftar.length === 0 ? (
              <li className="px-3 py-8 text-center text-meta text-ink-faint">
                Belum ada notifikasi.
              </li>
            ) : (
              daftar.map((n) => {
                const g = gayaNotifikasi(n.jenis);
                const Icon = g.icon;
                return (
                  <li key={n.id} className="border-b border-line last:border-b-0">
                    <button
                      type="button"
                      disabled={proses}
                      onClick={() => buka1(n)}
                      className={`flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-alt disabled:opacity-60 ${
                        n.is_read ? "" : "bg-brand-50/60"
                      }`}
                    >
                      <Icon className={`mt-0.5 size-4 shrink-0 ${g.warna}`} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5">
                          <span
                            className={`min-w-0 flex-1 truncate text-body ${
                              n.is_read ? "text-ink-muted" : "text-ink"
                            }`}
                          >
                            {n.judul}
                          </span>
                          {!n.is_read ? (
                            <span
                              className="size-1.5 shrink-0 rounded-full bg-brand-600"
                              aria-label="belum dibaca"
                            />
                          ) : null}
                        </span>
                        {n.pesan ? (
                          <span className="mt-0.5 block truncate text-meta text-ink-muted">
                            {n.pesan}
                          </span>
                        ) : null}
                        <span className="mt-0.5 flex items-center gap-1.5 text-micro text-ink-faint">
                          {/* Label jenis ikut ditulis: warna ikon saja tidak
                              cukup sebagai penanda. */}
                          <span className={g.mendesak ? "font-medium text-danger" : ""}>
                            {g.label}
                          </span>
                          <span>·</span>
                          <span>{waktuRelatif(n.created_at)}</span>
                          {/* Cabang lain ditandai TERANG-TERANGAN: menekannya
                              memindahkan cabang aktif, dan itu mengubah
                              antrean, stok, dan tarif yang terlihat. */}
                          {n.site_nama && n.site_id !== siteAktif ? (
                            <>
                              <span>·</span>
                              <span className="flex items-center gap-0.5 font-medium text-warning">
                                <Building2 className="size-3" aria-hidden />
                                {n.site_nama}
                              </span>
                            </>
                          ) : null}
                          {n.untuk_peran ? (
                            <>
                              <span>·</span>
                              <span
                                className="flex items-center gap-0.5"
                                title="Ditujukan ke seluruh petugas dengan peran ini"
                              >
                                <Users className="size-3" aria-hidden />
                                bersama
                              </span>
                            </>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
