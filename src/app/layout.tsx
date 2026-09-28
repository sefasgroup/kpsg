import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "react-hot-toast";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "SIM Klinik — Sahabat Gamma",
    template: "%s · SIM Klinik Sahabat Gamma",
  },
  description:
    "Sistem Informasi Klinik terintegrasi Klinik Pratama Sahabat Gamma — pendaftaran, RME, laboratorium, apotek, dan kasir multi-cabang.",
  icons: {
    icon: [
      { url: "/brand/kpsg-mark-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/kpsg-mark-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/brand/kpsg-mark-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1d9270",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className={`${inter.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        {children}
        {/* Umpan balik non-intrusif (CLAUDE.md §1.3) */}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              fontSize: "13.5px",
              borderRadius: "8px",
              border: "1px solid #dce3e0",
              color: "#101b17",
            },
            success: { iconTheme: { primary: "#2f8f3c", secondary: "#fff" } },
            error: { iconTheme: { primary: "#c02626", secondary: "#fff" } },
          }}
        />
      </body>
    </html>
  );
}
