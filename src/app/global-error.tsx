"use client";

import { useEffect } from "react";

/**
 * Jaring terakhir: kesalahan yang terjadi di ROOT LAYOUT sendiri.
 *
 * `(app)/error.tsx` hanya menangkap kesalahan di dalam halaman. Bila yang
 * gagal justru layout — misalnya kueri daftar cabang atau pembacaan sesi
 * di `(app)/layout.tsx` — batas itu ikut runtuh bersamanya, dan tanpa
 * berkas ini yang tersisa adalah layar putih.
 *
 * Berkas ini WAJIB merender `<html>` dan `<body>` sendiri karena ia
 * menggantikan seluruh pohon, termasuk root layout. Konsekuensinya: Inter,
 * globals.css, dan token warna semuanya belum tentu ada di sini. Gayanya
 * karena itu ditulis inline dengan nilai mentah — satu-satunya tempat di
 * seluruh proyek yang boleh melakukannya, justru karena di sinilah sistem
 * token tidak bisa diandalkan.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[SIM Klinik — global]", error);
  }, [error]);

  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f4f6f5",
          color: "#101b17",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: "26rem", textAlign: "center" }}>
          <p style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>
            Aplikasi gagal dimuat
          </p>
          <p
            style={{
              marginTop: "0.5rem",
              fontSize: "0.84375rem",
              lineHeight: 1.45,
              color: "#5a6b64",
            }}
          >
            Terjadi gangguan mendasar pada sistem. Data yang sudah tersimpan
            tidak terpengaruh. Coba muat ulang; bila tetap gagal, hubungi IT
            dan sebutkan kode gangguan di bawah.
          </p>

          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1rem",
              height: "2.25rem",
              padding: "0 1rem",
              borderRadius: "8px",
              border: "1px solid #16785d",
              background: "#16785d",
              color: "#fff",
              fontSize: "0.84375rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Muat Ulang
          </button>

          {error.digest ? (
            <p
              style={{
                marginTop: "1rem",
                fontSize: "0.65625rem",
                color: "#8a9a94",
              }}
            >
              Kode gangguan{" "}
              <span style={{ fontFamily: "ui-monospace, monospace" }}>
                {error.digest}
              </span>
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
