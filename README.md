# SIM Klinik — Klinik Pratama Sahabat Gamma

Sistem Informasi Klinik multi-cabang. Rujukan fungsional ada di [`CLAUDE.md`](CLAUDE.md) v2.5.

| Dokumen | Isi |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Dokumen rujukan sistem (blueprint klien) |
| [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) | Brand, token, komponen, IA per-role, pola cetak |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Penjelasan rancangan database & keputusan desainnya |
| [`db/schema.sql`](db/schema.sql) | DDL MySQL — sumber kebenaran skema (52 tabel) |
| [`db/seed.sql`](db/seed.sql) | Role, permission, master data minimal, 8 akun demo |
| [`db/seed-demo.sql`](db/seed-demo.sql) | Pasien & kunjungan contoh — **hanya untuk dev**, jangan dipakai di produksi |
| [`reference/`](reference/) | Prototipe `klinik.html` & file logo asli (arsip) |

---

## Prasyarat

- **Node.js LTS** — diverifikasi pada **24.18.1** (npm 11.16.0).

  > **Jangan pakai Node 23.x.** Versi non-LTS itu membuat build worker
  > Next.js 16 crash di Windows dengan `STATUS_STACK_BUFFER_OVERRUN
  > (3221226505)`. Dev server tetap jalan sehingga gejalanya menipu —
  > yang gagal hanya `npm run build`. Sudah dikonfirmasi bukan masalah kode:
  > crash tetap terjadi dengan `globals.css` kosong, dengan `--webpack`
  > maupun Turbopack, sementara Tailwind + PostCSS berjalan normal di luar Next.

- **MySQL 8.0+** (MySQL 8.0.16+ diperlukan agar CHECK constraint ditegakkan).
  Diverifikasi pada 8.0.30.

## Menjalankan di browser lokal

### Sekali saja: persiapan

```bash
# 1. Basis data
mysql -u root -e "CREATE DATABASE IF NOT EXISTS simklinik_kpsg \
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root simklinik_kpsg < db/schema.sql

# 2. Environment — SESSION_SECRET wajib diisi, minimal 32 karakter
cp .env.example .env.local
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 3. Dependensi
npm install
```

Lalu pilih **salah satu** cara mengisi data:

| | Perintah | Untuk apa |
|---|---|---|
| **A. Contoh multi-cabang** | `mysql -u root simklinik_kpsg < db/seed.sql`<br>`node scripts/kosongkan.mjs --ya`<br>`node uji/jalankan.mjs scripts/data-contoh.ts` | **Pengujian menyeluruh.** 3 cabang, 21 akun, 45 item katalog, stok & tarif berbeda per cabang |
| **B. Contoh ringkas** | `mysql -u root simklinik_kpsg < db/seed.sql`<br>`mysql -u root simklinik_kpsg < db/seed-demo.sql` | Mencoba alur pasien cepat: 1 cabang, 8 akun, 4 pasien, antrean berjalan |
| **C. Kosong** | `mysql -u root simklinik_kpsg < db/seed.sql`<br>`node scripts/kosongkan.mjs --ya` | Menyiapkan data asli klinik — ikuti [docs/MASTER-DATA.md](docs/MASTER-DATA.md) |

Cara C menyisakan struktur RBAC dan satu akun `superadmin`; semua data contoh
dibuang.

#### Data contoh multi-cabang (cara A)

Dibuat oleh skrip, bukan berkas SQL — dan itu disengaja. **Saldo awal stok
masuk lewat `catatPenerimaan()`, fungsi yang sama dengan layar Penerimaan**,
sehingga kartu stok tetap konsisten. Data contoh yang melanggar invarian
sistemnya sendiri lebih buruk daripada tidak ada; `db/seed.sql` pernah
melakukan persis itu dan tidak ketahuan sampai uji rekonsiliasi ditulis.

| Cabang | Staf | Poli | Dokter |
|---|---|---|---|
| **PST** KPSG Pusat Bandung | 9 | Umum, Gigi, KIA | dr.rafi, drg.sinta, dr.bayu |
| **CMH** KPSG Cimahi | 6 | Umum, KIA | dr.putri, dr.bayu |
| **SMD** KPSG Sumedang | 5 | Umum | **tidak ada dokter tetap** — hanya dr.bayu (Jum–Sab) |

Tiap cabang punya stok, tarif tindakan, dan pengaturan (pembulatan, jasa
racik, lebar printer) yang **sengaja berbeda**, supaya kekeliruan
"cabang tertukar" langsung terlihat alih-alih lolos diam-diam.

Yang khusus disiapkan untuk menguji hal yang sulit diuji manual:

- **`dr.bayu`** bertugas di tiga cabang, **`admin.wilayah`** di dua — keduanya
  memunculkan pemilih cabang. Sumedang tanpa dokter tetap memaksa jalur
  multi-cabang benar-benar dipakai, bukan sekadar tersedia.
- **Batch hampir kadaluarsa (20 hari)** di Pusat → muncul di Monitoring Kadaluarsa.
- **Batch yang sudah kadaluarsa** di Pusat → harus **terkunci** dari penyerahan
  ke pasien, dan pesan "stok tidak cukup" menyebut jumlah yang terkunci itu.

Password semua akun: **`kpsg12345`**. Periksa hasilnya dengan:

```bash
node uji/jalankan.mjs uji-data-contoh.ts   # penugasan, isolasi stok, tarif
node uji/jalankan.mjs uji-rekonsiliasi.ts  # kartu stok = saldo gudang
```

### Menjalankan

```bash
npm run dev      # pengembangan — hot reload, di http://localhost:3000
```

Untuk menguji perilaku yang sebenarnya dilihat pengguna, jalankan versi
produksi — bukan dev server:

```bash
npm run build
npm run start    # http://localhost:3000
```

Perbedaannya bukan sekadar kecepatan. Dev server memuat ulang modul per
permintaan dan menyembunyikan galat yang hanya muncul saat build (impor
`server-only` yang bocor ke bundel klien, misalnya). **Uji terima (UAT)
harus memakai `npm run start`.**

> **Jangan `npm run build` sementara `npm run start` masih jalan.**
>
> `next start` membaca `.next` sekali saat start, sedangkan build menulis
> ulang seluruh isinya dengan nama chunk yang baru. Server lama lalu tetap
> menyajikan HTML yang menunjuk chunk yang sudah tidak ada, dan browser
> menampilkan:
>
> ```
> GET /_next/static/chunks/xxxx.js  500 (Internal Server Error)
> Uncaught ChunkLoadError: Failed to load chunk …
> ```
>
> Bukan kerusakan kode. Urutannya selalu **hentikan server → build →
> jalankan lagi**, lalu muat ulang paksa browser (`Ctrl+Shift+R`) supaya
> HTML lama yang menunjuk chunk lama ikut dibuang.

Port lain bila 3000 terpakai:

```bash
PORT=3401 npm run start                       # bash
$env:PORT=3401; npm run start                 # PowerShell
```

> Bila muncul `EADDRINUSE`, ada proses lama yang masih memegang port itu.
> Cari dan hentikan:
> ```bash
> netstat -ano | findstr :3000
> powershell -NoProfile -Command "Stop-Process -Id <PID> -Force"
> ```
> Selama proses lama masih hidup, ia terus melayani **kode versi lama** —
> perubahan tidak akan terlihat dan gejalanya menyesatkan.

### Browser memuat selamanya padahal server sehat

Gejala: halaman putih, tab berputar tanpa henti, dan di DevTools → Network
permintaan dokumen berstatus **Pending** selamanya. Terjadi juga di jendela
penyamaran, dan berpindah port tidak menolong.

**Penyebabnya bukan aplikasi ini.** Periksa dulu dari terminal:

```bash
curl -o /dev/null -w "%{http_code} %{time_total}s\n" http://localhost:3000/login
```

Kalau ini menjawab `200` dalam hitungan milidetik sementara browser tetap
menggantung, matikan **auto-detect proksi Windows**:

**Settings → Network & Internet → Proxy → "Automatically detect settings" → off**,
lalu tutup **semua** jendela Chrome dan buka lagi.

Alasannya: dengan WPAD aktif, Chrome mencari server proksi lewat DHCP/DNS
sebelum mengirim permintaan apa pun. Di jaringan yang tidak menjawab
pencarian itu, Chrome tertahan di tahap *proxy resolution* dan permintaannya
tidak pernah terkirim — termasuk ke `localhost`. `curl` tidak melakukan WPAD,
jadi ia lolos; itulah kenapa server tampak sehat dari terminal tetapi mati
dari browser.

Kalau setelan sistem tidak boleh diubah (mesin kantor), jalankan Chrome
dengan `chrome.exe --no-proxy-server` khusus untuk pengembangan.

Periksa status auto-detect tanpa mengubah apa pun:

```powershell
$b = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings\Connections' -Name DefaultConnectionSettings).DefaultConnectionSettings
"AUTO-DETECT (WPAD): $([bool]($b[8] -band 8))"
```

### Masuk

Buka http://localhost:3000. Password semua akun contoh: **`kpsg12345`**.

> **Ctrl / ⌘ + K** membuka pencarian cepat dari layar mana pun — ketik
> nama, NIK, atau No. RM, dan sistem menjawab pasiennya sedang di tahap
> mana, lengkap dengan tautan ke layar yang boleh Anda buka.

### Menjalankan simulasi satu hari klinik

```bash
npm run simulasi
```

Memerankan satu hari kerja penuh pada data uji tersendiri: empat pasien
dengan empat cara pembiayaan (umum, perusahaan, asuransi berplafon,
perusahaan lagi), lengkap dari pendaftaran → perawat → dokter → lab →
farmasi → kasir → penyerahan obat → klaim → laporan wajib.

Setiap tahap **memeriksa** keadaannya, bukan hanya menjalankannya, dan
datanya dibersihkan kembali di akhir. Dua bug ditemukan justru lewat cara
ini — keduanya di sambungan antar modul, tempat yang tidak pernah
disentuh uji per modul:

- `tutupShift()` menjumlahkan nilai tagihan, bukan uang yang masuk laci,
  sehingga kasir menutup shift dengan selisih minus setiap kali ada pasien
  berpenjamin;
- `payer_tariffs` tersimpan rapi tetapi tidak pernah dibaca siapa pun,
  sehingga berkas klaim berisi harga di atas yang disepakati kontrak.

### Menguji konkurensi

```bash
npm run uji uji/uji-konkurensi.ts
```

Menjalankan tujuh pasangan operasi **bersamaan** lewat fungsi aplikasi
asli, 12 putaran masing-masing, dan menghitung `ER_LOCK_DEADLOCK`. Semua
tujuh pernah meledak sebelum diperbaiki.

Tiga di antaranya tidak akan pernah ditemukan dengan membaca kode: pada
`catatAbsensi`, `simpanResep`, dan `bukaShift`, kedua pihak **tidak
berbagi satu pun data** — yang mereka rebutkan adalah *gap lock* pada
indeks, akibat mengunci baris yang belum ada lalu menyisipkannya. Lihat
[DATABASE.md §3.15](docs/DATABASE.md).

Seluruh uji lainnya dijalankan satu per satu:

```bash
npm run uji uji/uji-penjamin-klaim.ts
```

**Cara A — akun per cabang.** Polanya `peran.cabang`:

| Peran | Pusat | Cimahi | Sumedang |
|---|---|---|---|
| Admin Cabang / HR | `admin.pst` | `admin.cmh` | `admin.smd` |
| Perawat | `perawat.pst` | `perawat.cmh` | `perawat.smd` |
| Petugas Lab | `lab.pst` | `lab.cmh` | `lab.smd` |
| Farmasi | `farmasi.pst` | `farmasi.cmh` | `farmasi.smd` |
| Kasir | `kasir.pst` | `kasir.cmh` | `kasir.smd` |
| Dokter | `dr.rafi`, `drg.sinta` | `dr.putri` | — |

Lintas cabang: **`dr.bayu`** (Pusat + Cimahi + Sumedang) dan
**`admin.wilayah`** (Pusat + Cimahi). Ditambah `superadmin` untuk seluruh
cabang.

**Cara B — akun tunggal per peran:** `superadmin`, `admin`, `dokter`,
`dokter2`, `perawat`, `lab`, `farmasi`, `kasir`.

**Cara C:** `superadmin`, lalu segera
`node scripts/rotasi-kredensial.mjs --semua`.

> Penugasan cabang ikut di dalam token sesi yang ditandatangani, jadi
> perubahannya **baru berlaku setelah login ulang** (paling lama 10 jam).
> Ini konsekuensi pemeriksaan hak akses di Edge runtime yang tidak bisa
> mengakses MySQL — bukan sesuatu yang bisa dipercepat dari layar admin.

Hash di `seed.sql` adalah placeholder yang **ikut ke repositori** — siapa pun
yang pernah melihat repo tahu passwordnya. Aman untuk mencoba di laptop
sendiri, tidak untuk apa pun yang bisa dijangkau orang lain.

### Menelusuri alur lengkap dalam satu sesi

Pemisahan hak akses membuat satu pasien melewati beberapa peran. Cara paling
cepat mencobanya adalah membuka **beberapa jendela penyamaran (incognito)**
sekaligus — satu jendela per peran — karena sesi disimpan di cookie dan
login baru di jendela yang sama akan menggusur yang lama.

| Urutan | Cara A | Cara B | Kerjakan |
|---|---|---|---|
| 1 | `admin.pst` | `admin` | Pendaftaran → daftarkan pasien, pilih poli & dokter |
| 2 | `perawat.pst` | `perawat` | Pengkajian → TTV, keluhan, BMHP (stok langsung terpotong) |
| 3 | `dr.rafi` | `dokter` | Antrean Saya → SOAP, diagnosa ICD-10, tindakan, e-resep |
| 4 | `lab.pst` | `lab` | Order Masuk → input hasil (bila dokter mengorder lab) |
| 5 | `farmasi.pst` | `farmasi` | Resep Masuk → siapkan, serahkan, cetak etiket |
| 6 | `kasir.pst` | `kasir` | Tagihan Menunggu → bayar, cetak struk |

**Menguji multi-cabang (cara A).** Login sebagai `dr.bayu`, lalu berpindah
cabang lewat pemilih cabang di header. Yang layak diperhatikan: antrean,
stok, dan tarif harus ikut berganti, dan pasien cabang lain **tidak boleh**
muncul. Sumedang sengaja tidak punya dokter tetap, jadi jalur ini benar-benar
dipakai — bukan sekadar tersedia.

Pada cara C (basis data kosong) urutan ini **belum bisa dijalankan** sampai
master data terisi — poli, jadwal praktik, dan katalog obat harus ada lebih
dulu. Itulah yang diurutkan di [docs/MASTER-DATA.md](docs/MASTER-DATA.md).

### Mencetak

Dokumen dicetak lewat dialog cetak browser. Untuk struk dan etiket, atur
ukuran kertas ke **80 mm** (atau 58 mm) di dialog tersebut; memakai A4 akan
menghasilkan struk yang mengambang di tengah halaman. Aktifkan **Background
graphics** agar garis pemisah ikut tercetak.

---

## Tech stack

Sesuai `CLAUDE.md` §1.3:

| Kebutuhan | Dipakai |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 |
| Styling | Tailwind CSS v4 (token di `src/app/globals.css`) |
| Database | MySQL 8 via `mysql2` |
| Form & validasi | `react-hook-form` + `zod` |
| State | `zustand` |
| Data fetching | `@tanstack/react-query` |
| Tabel | `@tanstack/react-table` |
| Notifikasi | `react-hot-toast` |
| Cetak | `react-to-print` |
| Ikon | `lucide-react` |
| Sesi | `jose` (JWT cookie) + `bcryptjs` |

---

## Struktur

```
src/
  app/
    layout.tsx              Root layout, font Inter, Toaster
    page.tsx                Redirect ke /login atau /dashboard
    login/                  Halaman masuk (satu-satunya yang pakai logo bertext)
    (app)/
      layout.tsx            App shell: sidebar per-role + topbar multi-site
      dashboard/            Beranda per-role
    api/auth/               login & logout
  components/
    brand/logo.tsx          BrandMark / BrandLockup / BrandFullLogo
    shell/                  Sidebar, Topbar
    ui/                     Button, Card, Badge, Field, StatCard, EmptyState
  lib/
    db.ts                   Pool MySQL, transaction(), nextSequence(), limitAman()
    session.ts              JWT cookie — Edge-safe (jose saja)
    auth.ts                 Login, requireRole/requireAccess, auditLog — Node saja
    rbac.ts                 7 role + matriks navigasi (sumber menu & guard)
    tanggal.ts              Tanggal zona klinik — JANGAN pakai toISOString()
    format.ts               Rupiah, tanggal, umur, inisial
    stock.ts                Inti pergerakan stok — SEMUA pemotongan lewat sini
    inventory.ts            Penerimaan, pengeluaran, opname, batch kadaluarsa
    dokumen.ts              Surat keterangan (isi per jenis sebagai JSON)
    riwayat.ts              Riwayat rekam medis lintas kunjungan — baca saja
    laporan.ts              Laporan cabang & profil cabang
    *-labels.ts             Label netral yang boleh diimpor Client Component
  proxy.ts                  Guard RBAC lapis pertama (Next 16: eks-middleware.ts)
uji/
  jalankan.mjs              Runner uji: menjalankan .ts dengan modul aplikasi asli
  uji-*.ts                  Suite per modul
```

> **Pola `*-labels.ts`.** Modul di `lib/` yang menarik mysql2 diberi tanda
> `server-only`. Ketika sebuah Client Component mengimpor label dari modul itu,
> seluruh mysql2 ikut terseret ke bundel browser dan build gagal. Label yang
> dipakai bersama karena itu tinggal di berkas netral tersendiri:
> `visit-status.ts`, `billing-labels.ts`, `inventory-labels.ts`.

### Cara RBAC ditegakkan

Tiga lapis, sesuai `CLAUDE.md` §2.1 (*strict segregation of duties*):

1. **`src/lib/rbac.ts`** — satu matriks yang menghasilkan menu sidebar sekaligus
   daftar route yang boleh diakses. Menu di luar hak role **tidak dirender**.
2. **`src/proxy.ts`** — route di luar hak role dialihkan ke `/dashboard`.
3. **`requireRole()` / `requireAccess()`** di layer data — Route Handler bisa
   dipanggil langsung tanpa melewati proxy, jadi pengecekan diulang di server.

Khusus kasir: query tagihan **tidak pernah menyentuh** `medical_assessments`
atau `assessment_diagnoses` — diagnosa tidak dikirim dari server, bukan
disembunyikan di klien.

---

## Status pengerjaan (roadmap `CLAUDE.md` §8)

| Fase | Status |
|---|---|
| 1 — Database & arsitektur multi-site | **Selesai** — 52 tabel, tervalidasi di MySQL 8.0.30 |
| 2 — Autentikasi RBAC 7 role, app shell | **Selesai** — login, sesi, guard 3 lapis, sidebar per-role; diuji di build produksi untuk ketujuh role |
| 2 — **HR: jadwal praktik, dokter pengganti, cuti, absensi** | **Selesai** — tersambung langsung ke pendaftaran |
| 2 — **Super Admin: cabang, pengguna, master data, audit, pengaturan** | **Selesai** — seluruh menu sidebar kini punya halaman |
| 3 — **Pendaftaran & Antrean** | **Selesai** — cari pasien lintas cabang, RM baru, daftar kunjungan + nomor antrean, papan antrean per poli |
| 3 — **Pengkajian Perawat + BMHP** | **Selesai** — triase, TTV, antropometri (IMT otomatis), input BMHP yang memotong stok & masuk tagihan dalam satu transaksi |
| 3 — **Dokter: RME/SOAP, ICD-10, E-Resep + Racikan** | **Selesai** — asesmen SOAP, diagnosa ICD-10, tindakan, dan `<RacikanBuilder>` parent-child |
| 3 — **Laboratorium** | **Selesai** — order dari layar dokter, input hasil dengan penanda kritis otomatis, cetak A4 berkop surat |
| 4 — **Farmasi: penyiapan, penyerahan, potong stok, etiket** | **Selesai** — resep masuk, validasi stok, penyerahan atomik, cetak etiket, daftar stok |
| 4 — **Kasir: pembayaran, struk, shift** | **Selesai** — rincian tanpa diagnosa, hitung kembalian, struk thermal 80 mm, buka/tutup shift |
| 4 — **Inventori farmasi: penerimaan, pengeluaran, opname, kadaluarsa** | **Selesai** — batch & supplier, koreksi opname dari potret, penarikan batch kadaluarsa |
| 4 — **Dokter: surat keterangan, riwayat pasien, jadwal saya** | **Selesai** — 4 jenis surat A4 berkop, riwayat lintas cabang, jadwal 2 minggu + dokter pengganti |
| 4 — **Admin Cabang: laporan & profil cabang** | **Selesai** — pendapatan per kategori, produktivitas dokter, identitas kop surat |
| 4 — **Penugasan multi-cabang (`user_sites`)** | **Selesai** — dokter bisa praktik di lebih dari satu cabang dan berpindah di antaranya |
| 4 — **Notifikasi dalam aplikasi** | **Selesai** — resep masuk, hasil lab (termasuk nilai kritis), ambang stok, pengajuan & keputusan cuti |
| 4 — **Konsumsi batch FEFO** | **Selesai** — termasuk penguncian stok kadaluarsa dari penyerahan ke pasien |
| 4 — **Unggah berkas** | **Selesai** — lampiran cuti, di luar `public/`, dilayani route berautentikasi |
| 4 — **Impor massal katalog & tindakan** | **Selesai** — CSV/TSV, baris rusak dilaporkan per baris |
| 4 — **Rotasi kredensial & backup** | **Selesai** — `scripts/rotasi-kredensial.mjs`, `scripts/backup.mjs` |
| 4 — **Aset cetak thermal 1-bit** | **Selesai** — `scripts/logo-mono.mjs` |
| 5 — UAT & go-live | Belum |

**Seluruh menu di sidebar ketujuh role kini punya halaman** — 45 route, tidak ada
lagi yang mengembalikan 404.

Yang tersisa **bukan lagi pekerjaan kode**, melainkan dua hal yang hanya bisa
datang dari luar:

| Tersisa | Kenapa tidak bisa diselesaikan di sini |
|---|---|
| Master data asli KPSG (ICD-10 lengkap, katalog obat, tarif, panel lab) | Alat impornya siap; datanya milik klinik. Mengarang isinya berbahaya — lihat [Sebelum go-live](#sebelum-go-live) |
| TAHAP 2 — SatuSehat & Payment Gateway | Butuh kredensial sandbox Kemenkes dan akun penyedia pembayaran. Lapisan persiapan sudah ada (`satusehat_sync_logs`, `items.kfa_code`, `sites.satusehat_org_id`, NIK wajib, ICD-10, `payment_method`) |
| Fase 5 — UAT & go-live | Perlu pengguna asli klinik menjalankan alurnya |

### Yang sudah diuji pada modul Pendaftaran

Penomoran dokumen adalah bagian paling rawan di modul ini, jadi diuji khusus
terhadap kondisi balapan:

| Uji | Hasil |
|---|---|
| 20 permintaan nomor serentak | 20 nomor unik, urut 1–20 tanpa lompatan |
| NIK ganda lintas cabang | ditolak `uq_pat_nik` |
| NIK bukan 16 digit | ditolak `ck_pat_nik` |
| Daftar 2× di poli sama pada hari sama | ditolak guard aplikasi |
| Antrean yatim setelah rollback | tidak ada |

### Yang sudah diuji pada jalur stok BMHP

Jalur ini dipakai ulang oleh farmasi nanti (obat paten & bahan racikan), jadi
diuji lebih keras daripada modulnya sendiri menuntut:

| Uji | Hasil |
|---|---|
| Permintaan melebihi stok | ditolak, saldo tidak berubah |
| 15 pemotongan serentak @2 unit terhadap stok 10 | tepat 5 berhasil, saldo 0, tidak pernah minus |
| Kartu stok setelah uji serentak | 5 baris, total delta −10 |
| BMHP kedua gagal di tengah transaksi | stok utuh, pengkajian & tagihan **tidak** tersimpan |
| Jalur sukses | stok terpotong, `stock_movement_id` terisi, tagihan terbentuk, status → `menunggu_dokter` |
| IMT (60 kg / 165 cm) | 22,04 — generated column |

### Yang sudah diuji pada E-Resep

| Uji | Hasil |
|---|---|
| Aturan pakai `""`, `"   "`, `"\t"` — obat paten | ketiganya ditolak `ck_pit_signa` |
| Aturan pakai kosong — racikan | ditolak `ck_prc_signa` |
| Struktur parent-child | 1 paten + 1 racikan + 3 bahan tersimpan utuh |
| Hapus racikan | bahan ikut terhapus, tidak ada yang yatim |
| Bahan ganda dalam satu racikan | ditolak `uq_pri` |
| Resep kedua pada kunjungan sama | ditolak `uq_rx_visit` |
| `qty` 0 / `qty_bahan` negatif | ditolak `ck_pit_qty` / `ck_pri_qty` |
| Kode ICD-10 tidak dikenal | ditolak foreign key |

### Yang sudah diuji pada rantai resep → stok → tagihan

Ini uji terpenting di sistem: satu resep berisi 1 obat paten + 1 racikan
(3 bahan mentah), diserahkan lewat apotek.

| Uji | Hasil |
|---|---|
| Satu bahan racikan kurang (CTM: butuh 3, ada 2) | seluruh penyerahan dibatalkan |
| → obat paten & 2 bahan lain | **tidak** terpotong sama sekali |
| → resep, tagihan, bukti potong stok | tidak ada yang terbentuk |
| Stok cukup — obat paten | 100 → 90 |
| Stok cukup — bahan racikan (PCM/Ambroxol/CTM) | 100 → 94 / 96 / 97 |
| Kartu stok | 1 baris `keluar_resep` + 3 baris `keluar_racikan` |
| Baris tagihan `obat` | Rp 30.000 |
| Baris tagihan `racikan` | Rp 8.700 — bernama "Puyer Batuk Dewasa", bukan daftar tablet |
| Baris tagihan `jasa_racik` | Rp 5.000 — **baris tersendiri**, tidak dilebur |
| Total tagihan | Rp 43.700 = jumlah seluruh baris |
| Status akhir | resep `diserahkan`, kunjungan `menunggu_kasir` |
| Semua baris punya `stock_movement_id` | ya |
| Tabel `billing_*` punya kolom diagnosa/ICD | tidak ada — kasir memang tak bisa melihatnya |

Hierarki etiket juga diverifikasi dari HTML hasil render: aturan pakai **9pt**
(elemen terbesar), nama obat 7.5pt, nama pasien 6.5pt, nama klinik 5pt.

### Yang sudah diuji pada modul Kasir

Isolasi data klinis diuji dua arah — dari kode sumber dan dari HTML yang
benar-benar terkirim ke browser kasir:

| Uji | Hasil |
|---|---|
| `lib/cashier.ts` menyebut `medical_assessments` / `assessment_diagnoses` / `icd10_codes` / `assessment_procedures` | tidak satu pun (dicek pada kode, komentar diabaikan) |
| Tabel `billing_*` punya kolom klinis | tidak ada |
| HTML layar kasir memuat `K30`, `J06.9`, "Dispepsia", "epigastrium", "ronki", keluhan utama | **nol kemunculan** |
| Uang diterima kurang dari total | ditolak, tagihan tetap belum lunas |
| Diskon melebihi subtotal | ditolak |
| Subtotal saat bayar | dihitung ulang dari `billing_items`, bukan dari nilai kiriman klien |
| Pembulatan | selalu ke bawah — pasien tak pernah bayar lebih dari rincian |
| Bayar dua kali | ditolak |
| Tagihan pasien yang masih di apotek | tidak muncul di daftar siap bayar |
| Kas laci saat tutup shift | hanya menjumlahkan transaksi **tunai**; QRIS masuk total diterima tapi bukan kas |

Catatan implementasi: subtotal sengaja dihitung ulang di dalam transaksi
pembayaran. Kalau apotek menambah baris tepat sebelum kasir menekan bayar,
yang dipakai adalah nilai terbaru — bukan angka yang tampil di layar kasir
beberapa detik sebelumnya.

### Yang sudah diuji pada modul Laboratorium

Penanda hasil dihitung di server dari nilai rujukan, bukan dikirim klien.
Ambang kritis diperiksa **sebelum** rentang rujukan — nilai yang mengancam
nyawa harus muncul sebagai kritis, bukan sekadar "rendah".

Hemoglobin (rujukan 13,0–17,0 · kritis <7,0 atau >20,0):

| Nilai | Hasil | Alasan |
|---|---|---|
| 15,0 | `N` | di dalam rujukan |
| 11,5 | `L` | rendah, belum kritis |
| 18,5 | `H` | tinggi, belum kritis |
| 5,2 | `LL` | di bawah ambang kritis |
| 22,0 | `HH` | di atas ambang kritis |
| 7,0 | `L` | tepat di ambang → belum kritis |
| 13,0 / 17,0 | `N` | tepat di batas rujukan → normal |

Alur status setelah hasil difinalkan:

| Kondisi | Pasien menuju |
|---|---|
| Asesmen dokter masih draft | `menunggu_dokter` — hasil kembali ke dokter untuk menegakkan diagnosa |
| Asesmen final, tanpa resep | `menunggu_kasir` |
| Asesmen final, ada resep | `menunggu_farmasi` |
| Masih ada order lab lain berjalan | `menunggu_lab` |

Ditambah: tarif lab masuk tagihan **saat order dibuat** (Rp 85.000 terverifikasi),
finalisasi ditolak bila masih ada parameter kosong, dan lembar hasil A4 menarik
kop surat dari tabel `sites`.

### Yang sudah diuji pada modul HR

Dokter Pengganti tidak berdiri sendiri — ia harus benar-benar mengubah apa yang
bisa dipilih petugas pendaftaran:

| Uji | Hasil |
|---|---|
| Jadwal 11:00–15:00 vs 08:00–12:00 | terdeteksi bentrok (irisan waktu, bukan jam identik) |
| Jadwal 13:00–18:00 vs 08:00–12:00 | tidak bentrok — bersebelahan |
| Dokter sakit tanpa pengganti | ditandai "poli kosong" |
| Setelah pengganti ditetapkan | tidak kosong lagi, nama pengganti muncul |
| Pendaftaran ke dokter yang digantikan | `substitute_doctor_id` terisi **otomatis** |
| → `doctor_id` | tetap dokter terjadwal, agar laporan produktivitas akurat |
| Pendaftaran ke dokter berhalangan **tanpa** pengganti | ditolak, tidak ada kunjungan tersisa |
| Cuti dokter 3 hari disetujui | 3 pengecualian jadwal dibuat otomatis, langsung disetujui |
| → dokter tsb di daftar bertugas | langsung hilang, tanpa input kedua |
| Pengajuan cuti beririsan tanggal | ditolak |
| Calon pengganti yang sendiri berhalangan | ditolak |
| Daftar absensi | seluruh 7 staf tampil, termasuk yang belum absen |

---

## Catatan perbaikan penting: zona waktu

`new Date().toISOString().slice(0, 10)` mengembalikan tanggal **UTC**. Di WIB
(UTC+7), antara pukul 00:00 dan 07:00 waktu setempat ia mengembalikan tanggal
**kemarin** — sementara MySQL `CURDATE()` sudah berganti hari.

Akibatnya seluruh worklist yang memfilter `tanggal = ?` akan menampilkan data
kemarin, sedangkan pendaftaran baru masuk ke hari ini. Klinik yang buka pagi
berada tepat di rentang jam itu.

Bug ini ditemukan lewat uji modul HR (pencarian dokter pengganti diam-diam
gagal) dan terbukti nyata pada saat pengujian: tanggal UTC `2026-08-01`
sementara tanggal klinik sudah `2026-08-02`.

Seluruh 18 titik perhitungan tanggal dipindahkan ke
[`src/lib/tanggal.ts`](src/lib/tanggal.ts), yang menghitung tanggal di zona
klinik (`sites.timezone`, default `Asia/Jakarta`). **Jangan pakai
`toISOString()` untuk "hari ini"** — gunakan `tanggalHariIni()`.

## Catatan perbaikan penting: `LIMIT ?` pada prepared statement

MySQL menolak parameter `LIMIT` lewat protokol prepared statement
(`ER_WRONG_ARGUMENTS: Incorrect arguments to mysqld_stmt_execute`), dan
`pool.execute()` selalu memakai protokol itu.

Gejalanya sangat menipu: query yang sama **berjalan mulus** lewat
`pool.query()` maupun klien `mysql` CLI. Uji-uji SQL sebelumnya memakai
`query()`, jadi bug ini lolos sepenuhnya — padahal ia mematikan **seluruh
autocomplete di aplikasi**: cari pasien, BMHP, obat, bahan racikan, ICD-10,
tindakan, dan panel lab. Baru ketahuan ketika halaman `/audit` mengembalikan
500 di build produksi.

Sembilan query terkena. Semuanya kini memakai
[`limitAman()`](src/lib/db.ts) yang memaksa nilainya jadi bilangan bulat
dalam rentang wajar lalu menginterpolasinya ke SQL. Nilai LIMIT selalu
berasal dari kode sendiri, bukan input pengguna, jadi tidak ada celah injeksi.

**Pelajaran untuk pengujian:** uji query harus memakai `execute()` —
protokol yang benar-benar dipakai aplikasi — bukan `query()`.

### Yang sudah diuji pada modul Super Admin

| Uji | Hasil |
|---|---|
| Menonaktifkan satu-satunya Super Admin aktif | ditolak |
| Menurunkan peran Super Admin terakhir | ditolak |
| Password tersimpan | hash bcrypt, teks polos tidak ada di kolom |
| Password di audit log | tidak pernah tercatat |
| Username / kode cabang ganda | ditolak |
| Cabang baru | otomatis dapat 8 penomoran dokumen |
| Harga jual di bawah HPP | ditolak |
| Ambang kritis lab di dalam rentang rujukan | ditolak |
| Impor ICD-10 dengan 2 baris rusak | 3 baris valid tetap masuk, impor tidak dibatalkan |
| Peran operasional tanpa cabang | ditolak (hanya Super Admin boleh) |
| 9 query berpaginasi via `execute()` | seluruhnya lolos setelah perbaikan `LIMIT` |

> **Catatan perbaikan:** CHECK constraint aturan pakai semula memakai
> `CHAR_LENGTH(TRIM(...)) > 0`. `TRIM()` di MySQL hanya membuang **spasi**,
> sehingga aturan pakai berisi tab atau newline saja lolos dan akan tercetak
> kosong di etiket obat. Sekarang memakai `REGEXP '[^[:space:]]'`, yang
> menuntut minimal satu karakter bukan-spasi.


---

## Cara menjalankan uji

Sejak modul inventori, skrip uji **mengimpor fungsi aplikasi yang sebenarnya**
dari `src/lib/`, bukan menyalin ulang SQL-nya:

```bash
node uji/jalankan.mjs uji-inventori.ts     # 71 assertion
node uji/jalankan.mjs uji-dokumen.ts       # 55 assertion
node uji/jalankan.mjs uji-multisite.ts     # 40 assertion
node uji/jalankan.mjs uji-rekonsiliasi.ts  #  5 assertion — jalankan kapan saja
```

`uji/jalankan.mjs` menjalankan berkas TypeScript lewat `jiti` dan memetakan
`server-only` ke `empty.js` — berkas yang sama yang dipakai Next.js lewat
kondisi ekspor `react-server`. Marker itu memang hanya penanda bundler.

Perubahan pendekatan ini adalah akibat langsung dari bug `LIMIT ?`: skrip uji
lama memakai `pool.query()` sementara aplikasi memakai `pool.execute()`, jadi
lebih dari seratus assertion lolos sementara setiap autocomplete di aplikasi
sebenarnya mati. Uji yang tidak melewati jalur kode asli hanya menguji dirinya
sendiri.

### Yang sudah diuji pada modul Inventori Farmasi

`node uji/jalankan.mjs uji-inventori.ts` — 71 assertion.

| Uji | Hasil |
|---|---|
| Penerimaan menambah stok, kartu stok, dan batch | saldo, `masuk_pembelian`, `qty_after`, `batch_id` cocok |
| Item tanpa nomor batch & tanggal kadaluarsa | batch **tidak** dibuat (baris tanpa informasi) |
| Diskon melebihi nilai barang | ditolak; stok dan dokumen ikut ter-*rollback* |
| HPP katalog | hanya berubah bila dicentang eksplisit |
| Harga beli > harga jual / barang sudah kadaluarsa | diperingatkan, penerimaan **tidak** dibatalkan |
| Pengeluaran melebihi saldo | ditolak, saldo tidak berubah |
| Keterangan pengeluaran < 10 karakter | ditolak |
| `keluar_resep` diinput manual di layar pengeluaran | ditolak — jalurnya lewat resep agar tetap masuk tagihan |
| Lembar opname baru | memotret seluruh item; selisih awal nol |
| Opname kedua di cabang yang sama | ditolak; cabang lain tetap boleh |
| **Stok bergerak setelah potret diambil** | koreksi dihitung dari potret, pengeluaran di sela penghitungan **tidak** terhapus |
| Koreksi opname yang akan membuat stok minus | ditolak dengan nama item; **seluruh** koreksi ter-*rollback* |
| Finalisasi ganda / membatalkan opname final | ditolak |
| Batch mendekati vs jauh dari kadaluarsa | tersaring sesuai ambang `stok.peringatan_kadaluarsa_hari` |
| Penarikan batch | mengurangi saldo gudang **dan** isi batch, tercatat `keluar_kadaluarsa` |
| Penarikan melebihi isi batch / dari cabang lain | ditolak |
| 5 query berpaginasi via `execute()` | seluruhnya lolos |

### Yang sudah diuji pada Surat Keterangan, Riwayat Pasien, dan Laporan

`node uji/jalankan.mjs uji-dokumen.ts` — 55 assertion.

| Uji | Hasil |
|---|---|
| Nomor surat | berpola `KODE/SKET/YYYYMM/NNNN`, berurut, tidak kembar |
| Isi surat | hanya memuat field jenisnya sendiri — sisa isian jenis lain tidak ikut tersimpan |
| Dokter lain menerbitkan surat | ditolak |
| Dokter **pengganti** menerbitkan surat | diizinkan — ia yang benar-benar memeriksa |
| Kunjungan batal / cabang lain | ditolak |
| Surat sakit tanpa lama istirahat, rujukan tanpa faskes tujuan | ditolak per jenis |
| Riwayat pasien | lintas cabang; kunjungan batal tidak muncul |
| Pendapatan laporan | hanya transaksi `lunas`; tagihan menunggu dilaporkan terpisah |
| Produktivitas dokter | kunjungan dengan pengganti dihitung ke **pengganti**, bukan dokter terjadwal |
| Asesmen `draft` | tidak dihitung sebagai final |
| Simpan profil cabang | `kode` tidak ikut berubah |

---

## Konsumsi batch FEFO

`item_batches` dikonsumsi *first expired, first out* oleh `kurangiStok()` —
resep, racikan, BMHP, pengeluaran non-resep, maupun koreksi opname. Batch tanpa
tanggal kadaluarsa diletakkan paling belakang: yang tidak diketahui masa
berlakunya tidak boleh mendahului yang jelas akan kadaluarsa lebih dulu.

Bila satu pemotongan melintasi beberapa batch, kartu stok memuat **satu baris
per batch**. Jumlah `qty_delta`-nya tetap sama dengan yang diminta, jadi
rekonsiliasi tidak berubah.

### Yang paling penting: stok kadaluarsa terkunci dari pasien

FEFO polos justru mendahulukan batch yang **sudah lewat** tanggal kadaluarsa —
persis barang yang paling tidak boleh diserahkan. Karena itu:

- untuk `keluar_resep`, `keluar_racikan`, dan `keluar_bmhp`, batch kadaluarsa
  **dilewati** dalam alokasi;
- jumlahnya juga **dikurangkan dari saldo yang dianggap tersedia**. Tanpa ini,
  farmasi masih bisa menyerahkan lebih banyak daripada barang layak yang benar-benar
  ada — sisanya diam-diam terambil dari bagian tak berbatch sementara barang
  kadaluarsanya menumpuk;
- pesan penolakannya menyebut berapa unit yang terkunci dan menunjuk ke
  Monitoring Kadaluarsa.

Batch kadaluarsa hanya bisa keluar lewat pemusnahan, pencatatan rusak, atau
koreksi opname.

---

## Catatan perbaikan penting: saldo awal tidak masuk kartu stok

`uji-rekonsiliasi.ts` — yang membandingkan `item_stocks.qty_on_hand` dengan
jumlah `stock_movements.qty_delta` — gagal pada 19 dari 19 item: cache 250,
ledger 0.

Penyebabnya `db/seed.sql` sendiri:

```sql
INSERT INTO item_stocks (site_id, item_id, qty_on_hand)
SELECT @site, id, 250 FROM items;   -- tanpa baris ledger sama sekali
```

Seed melanggar aturan yang didokumentasikannya sendiri di `docs/DATABASE.md`
§3.3. Dampaknya bukan kosmetik: rekonsiliasi adalah **satu-satunya alat** untuk
menemukan kebocoran stok. Bila garis dasarnya sudah menyimpang 250 per item
sejak hari pertama, alat itu tidak akan pernah bisa dipakai — selisih akibat bug
nyata akan tenggelam di antara selisih bawaan.

Seed sekarang menuliskan saldo awal sebagai `masuk_koreksi` dengan
`ref_type = 'saldo_awal'`, dan database yang sudah berjalan disusulkan baris
ledger-nya. Rekonsiliasi kini bersih.

**Pelajaran:** invarian yang tidak pernah diuji bukan invarian. Aturan §3.3
sudah tertulis sejak awal dan tetap dilanggar oleh berkas seed di repositori
yang sama, selama enam modul, tanpa ada yang menyadarinya.


---

## Penugasan multi-cabang

Seorang dokter bisa praktik di lebih dari satu cabang. `users.site_id` adalah
**cabang induk**; penugasan tambahan tersimpan di `user_sites`.

Diatur Super Admin di **Pengguna & Role** — daftar centang "Penugasan Cabang
Tambahan". Cabang induk sengaja tidak ikut tercatat di `user_sites`: duplikasi
membuat pencabutan cabang induk jadi ambigu.

**Daftar penugasan ikut di dalam token sesi**, bukan dibaca dari database saat
pemeriksaan. Alasannya teknis sekaligus mendasar: `getSession()` juga dipanggil
dari middleware yang berjalan di Edge Runtime, dan mysql2 tidak jalan di sana.
Karena token bertanda tangan (HS256), daftarnya tidak bisa dipalsukan dari klien
— cookie `kpsg_site` yang menunjuk cabang di luar hak diabaikan, bukan
dipercaya.

> **Konsekuensi yang perlu diketahui operator:** perubahan penugasan baru
> berlaku setelah pengguna **masuk kembali** (paling lama satu shift, `MAX_AGE`
> 10 jam). Ini disebutkan di layar Pengguna & Role.

Pemilih cabang di kanan atas muncul bila pengguna punya lebih dari satu
penugasan. Pilihan "Semua Cabang" tetap khusus Super Admin — peran operasional
harus selalu berada di satu cabang, karena itulah batas isolasi datanya.

Satu predikat SQL dipakai bersama oleh setiap query yang menyaring pengguna per
cabang (`SQL_BERTUGAS_DI_CABANG` di `lib/auth.ts`). Ditulis sekali supaya tidak
ada layar yang ketinggalan — sebelum ini semuanya memakai `u.site_id = ?` dan
dokter tugas-ganda tidak pernah muncul di cabang keduanya.

## Notifikasi

Dua bentuk sasaran, dan bedanya menentukan:

| Bentuk | Kolom | Untuk apa |
|---|---|---|
| **Perorangan** | `user_id` | Tanggung jawab satu orang — mis. hasil lab yang ia pesan |
| **Peran di satu cabang** | `role_id` + `site_id` | Antrean kerja bersama — mis. resep masuk ke farmasi |

Resep masuk sengaja **tidak** ditujukan ke satu apoteker: bila orang itu libur,
resepnya menggantung tanpa ada yang tahu.

Pemicu yang sudah terpasang:

| Peristiwa | Jenis | Sasaran |
|---|---|---|
| Dokter menerbitkan resep baru | `resep_masuk` | peran Farmasi |
| Hasil lab difinalkan | `hasil_lab` / `hasil_lab_kritis` | dokter pemesan (atau penggantinya) |
| Saldo melewati stok minimum | `stok_menipis` / `stok_habis` | peran Farmasi |
| Pengajuan cuti masuk | `cuti_diajukan` | peran Admin Cabang |
| Cuti disetujui / ditolak | `cuti_diputuskan` | pemohon |

**Pengiriman notifikasi tidak pernah menggagalkan operasi bisnisnya.** Resep
yang sudah tersimpan tidak boleh ikut batal hanya karena baris notifikasi gagal
ditulis; `kirimNotifikasi()` menelan galatnya sendiri saat dipanggil di luar
transaksi. Peringatan ambang stok bahkan sengaja dijalankan **setelah**
transaksi penyerahan resep selesai.

Peringatan stok juga tidak digandakan: selama peringatan lama untuk item yang
sama belum dibaca, peringatan baru tidak dibuat. Membanjiri antrean farmasi
dengan pesan identik setiap satu tablet keluar tidak membantu siapa pun.

### Yang sudah diuji

`node uji/jalankan.mjs uji-multisite.ts` — 40 assertion.

| Uji | Hasil |
|---|---|
| Cabang induk di `user_sites` | tidak ikut disimpan |
| Penugasan dicabut lewat form | benar-benar hilang, bukan hanya ditambahi |
| Penugasan ke cabang nonaktif | diabaikan |
| Dokter tugas-ganda di layar pendaftaran cabang kedua | **muncul** (sebelumnya tidak mungkin) |
| Cookie `kpsg_site` menunjuk cabang di luar hak | diabaikan, jatuh ke cabang induk |
| `effectiveSiteId` dengan cabang di luar penugasan | menolak permintaan |
| Siaran peran | tersaring per cabang |
| Menandai notifikasi milik orang lain | ditolak (syarat kepemilikan di klausa `WHERE`) |
| Peringatan stok berulang | tidak digandakan selama yang lama belum dibaca |
| Stok habis vs menipis | dibedakan jenisnya |


---

## Sebelum go-live

Empat langkah wajib, semuanya bisa dijalankan sekarang.

### 0. Kosongkan data contoh

```bash
node scripts/backup.mjs                     # tidak bisa dibatalkan — amankan dulu
node scripts/kosongkan.mjs                  # tinjau: tidak menghapus apa pun
node scripts/kosongkan.mjs --ya             # hapus sungguhan
```

Bawaannya **tidak menghapus apa pun** — tanpa `--ya` skrip hanya menghitung
dan menampilkan apa yang akan hilang. Penghapusan data klinis tidak boleh
terjadi karena salah menekan panah-atas di terminal.

Yang sengaja dipertahankan, dan alasannya:

| Dipertahankan | Alasan |
|---|---|
| `roles`, `permissions`, `role_permissions` | Struktur, bukan data contoh. 7 role adalah kontrak dengan kode (CLAUDE.md §2.1); menghapusnya membuat aplikasi tidak bisa dijalankan |
| `settings` global | Identitas aplikasi, bukan data klinik |
| Satu akun `super_admin` | Tidak ada layar registrasi mandiri. Menghapus seluruh akun mengunci semua orang di luar sistem tanpa jalan masuk untuk membuat akun pertama |

Pemeriksaan kunci asing **tidak** dimatikan saat menghapus. Bila urutannya
salah MySQL menolak dan seluruh transaksi dibatalkan — lebih baik gagal
berisik daripada meninggalkan baris yatim diam-diam.

Untuk membersihkan sisa UAT tanpa kehilangan konfigurasi yang sudah diisi:

```bash
node scripts/kosongkan.mjs --ya --hanya-klinis
```

Pasien, kunjungan, resep, tagihan, dan stok percobaan dibuang; cabang, akun
staf, jadwal, poli, ICD-10, tindakan, panel lab, dan katalog tetap utuh.
Penomoran dokumen kembali ke 1 sehingga No. RM pasien asli pertama tidak
melanjutkan nomor pasien uji.

Stok dikembalikan ke **nol**, bukan dikurangi sebanyak yang terpakai. Saldo
gudang wajib selalu sama dengan jumlah seluruh pergerakannya; menghapus
sebagian pergerakan sambil menyisakan saldo justru memutus persamaan itu —
persis kesalahan yang dulu ada di `seed.sql`. Masukkan ulang saldo awal lewat
Penerimaan.

### 1. Ganti kredensial contoh

```bash
node scripts/rotasi-kredensial.mjs          # akun yang masih pakai hash seed
node scripts/rotasi-kredensial.mjs --semua  # seluruh akun aktif
```

Hash contoh di `db/seed.sql` sama untuk kedelapan akun **dan tertulis di berkas
yang ikut ke repositori**. `must_change_pw = 1` tidak menolong: siapa pun yang
pernah melihat repo tahu passwordnya dan bisa masuk lebih dulu. Password baru
ditampilkan sekali di layar, di-hash bcrypt cost 12, tidak disimpan ke berkas
mana pun, dan tidak masuk audit log.

### 2. Muat master data KPSG

Seluruh alat impornya sudah siap; datanya harus datang dari klinik.

**Urutannya penting** dan dirinci di **[docs/MASTER-DATA.md](docs/MASTER-DATA.md)** —
sebagian besar langkah benar-benar tidak bisa dikerjakan sebelum langkah
sebelumnya ada (form menolak, atau daftar pilihannya kosong). Ringkasnya:

| Data | Cara | Catatan |
|---|---|---|
| ICD-10 | Master Data → ICD-10 → **Impor Massal** | Seed hanya 10 kode; daftar Kemenkes puluhan ribu |
| Katalog obat & BMHP | Master Data → Katalog → **Impor Massal** | `kode, tipe, nama, satuan, HPP, harga jual, stok min, bentuk, racik, resep, kategori` — kategori dibuat otomatis |
| Tindakan & tarif | Master Data → Poli & Tindakan → **Impor Massal** | `kode, nama, kategori, tarif, ICD-9-CM` |
| Panel & parameter lab | Master Data → Panel Laboratorium | Manual — jumlahnya sedikit dan tiap parameter butuh rentang rujukan |
| **Saldo awal stok** | Farmasi → **Penerimaan** | **Jangan lewat `UPDATE item_stocks`** — lihat di bawah |

Saldo awal wajib masuk sebagai Penerimaan biasa, lengkap dengan nomor batch
dan tanggal kadaluarsa. Menyuntikkannya langsung ke `item_stocks` membuat
angka di layar terlihat benar dan justru itu bahayanya: kartu stok jadi
bohong (alat rekonsiliasi kehilangan gunanya), dan stok tanpa batch tidak
punya tanggal kadaluarsa sehingga **tidak pernah terkunci dari penyerahan ke
pasien**.

Baris rusak **dilewati dan dilaporkan per baris** beserta alasannya, bukan
membatalkan seluruh impor: berkas katalog klinik biasanya ribuan baris, dan
menggagalkan semuanya karena satu sel kosong memaksa mengulang dari awal
berkali-kali.

### 3. Siapkan backup

```bash
node scripts/backup.mjs --tujuan="D:\\backup-kpsg"
node scripts/backup.mjs --verifikasi "D:\\backup-kpsg\\2026-08-02_0930"
```

Menghasilkan dump `--single-transaction` (konsisten tanpa mengunci tabel,
jadi aman dijalankan saat klinik melayani), salinan `storage/`, dan
`MANIFEST.txt` berisi SHA-256 serta langkah pemulihan. Password MySQL
diteruskan lewat `MYSQL_PWD`, bukan argumen `-p` yang terlihat pengguna lain
di mesin yang sama.

Verifikasi bukan hiasan: backup yang rusak diam-diam sama saja dengan tidak
punya backup, dan baru ketahuan justru saat dibutuhkan.

**Jadwalkan** lewat Task Scheduler Windows, minimal harian. Dump memuat seluruh
rekam medis pasien — perlakukan seperti berkas rekam medis fisik.

---

## Unggah berkas

Berkas unggahan **tidak pernah** disimpan di `public/`. Apa pun di sana
dilayani tanpa pemeriksaan sesi sama sekali; lampiran cuti sakit adalah dokumen
medis pegawai, dan menaruhnya di sana berarti siapa pun yang mendapat URL-nya
bisa membacanya selamanya tanpa jejak.

Berkas disimpan di `storage/` (di luar repositori) dan hanya keluar lewat
`/api/berkas/…` yang memeriksa **dua** hal: pengguna sudah masuk, **dan**
pengguna berhak atas berkas itu.

| Kategori | Yang boleh membaca | Batas |
|---|---|---|
| `lampiran` | Pemohon sendiri + Admin Cabang tempat pengajuan | 5 MB · PDF/JPG/PNG |
| `logo` | Seluruh pengguna yang sudah masuk (muncul di kop surat) | 1 MB · PNG/JPG |
| `ttd` | **Hanya pemiliknya** | 512 KB · PNG |

Pertahanan yang dipasang:

- **Nama berkas selalu dibuat sendiri** dari 16 byte acak. Nama asli dari
  pengunggah tidak pernah menyentuh sistem berkas — di situlah *path traversal*
  dan nama berbahaya masuk.
- **Isi berkas diperiksa sendiri** lewat *magic bytes*. `File.type` berasal dari
  peramban dan bisa dibuat sesuka pengunggah; berkas apa pun bisa mengaku PNG.
- **Kunci divalidasi dua lapis**: pola ketat, lalu jalur hasilnya diperiksa
  ulang harus berada di dalam `storage/`.
- **404, bukan 403**, saat tidak berhak — membedakan keduanya membocorkan berkas
  mana yang ada.

### Tanda tangan dokter: sengaja tidak distempel otomatis

Kolom `doctor_profiles.ttd_path` bisa diisi, tetapi surat keterangan **tidak**
membubuhkannya secara otomatis. Menempelkan gambar tanda tangan ke setiap
dokumen yang dihasilkan sistem berarti siapa pun yang punya akses sistem bisa
menerbitkan surat yang tampak sah ditandatangani dokter. Itu keputusan
kebijakan klinik, bukan keputusan teknis — dan konsekuensinya hukum.

Blok tanda tangan saat ini mencetak nama dan No. SIP dengan ruang kosong untuk
tanda tangan basah. Bila klinik memutuskan sebaliknya, perubahannya kecil dan
terpusat di `app/(app)/surat/lembar-surat.tsx`.

---

## Aset cetak thermal

```bash
node scripts/logo-mono.mjs                 # 192px, berdasarkan alpha
node scripts/logo-mono.mjs --lebar=384     # printer 80mm resolusi tinggi
```

Printer thermal hanya bisa menyalakan atau tidak menyalakan tiap titik — tidak
ada abu-abu. Logo berwarna yang dikirim apa adanya akan di-*dither* driver jadi
bercak yang tidak terbaca.

Mode bawaan `alpha` (piksel tidak transparan → hitam) adalah yang benar untuk
logo berwarna di atas latar transparan. Dengan `--mode=luma`, bagian logo yang
kebetulan berwarna terang — hijau muda pada mark KPSG — terbaca sebagai latar
dan **hilang**; bentuknya jadi tidak utuh. Itu ditemukan saat memeriksa
hasilnya, bukan diasumsikan.

Ditulis tanpa dependensi: PNG di-decode dan di-encode langsung memakai `zlib`
bawaan Node.

### Yang sudah diuji pada FEFO, berkas, dan impor

`uji-fefo.ts` — 33 assertion · `uji-berkas-impor.ts` — 35 assertion.

| Uji | Hasil |
|---|---|
| Urutan konsumsi batch | kadaluarsa terdekat lebih dulu, tanpa-tanggal paling belakang |
| Pemotongan melintasi batas batch | satu baris kartu stok per batch, jumlah tetap sama |
| **Resep / racikan / BMHP** terhadap batch kadaluarsa | **dilewati** |
| Permintaan yang hanya bisa dipenuhi dari stok kadaluarsa | **ditolak**, pesan menyebut jumlah terkunci |
| Pemusnahan & koreksi opname | justru mengambil yang kadaluarsa |
| 15 pemotongan bersamaan atas stok 10 | tepat 5 berhasil, saldo nol, batch terkuras habis |
| Penarikan batch tertentu | melewati FEFO; melebihi isi batch ditolak |
| Invarian sisa batch ≤ saldo gudang | terpenuhi |
| Berkas mengaku PNG tapi isinya bukan | ditolak lewat magic bytes |
| Enam pola kunci berbahaya (traversal, escape, terlalu pendek) | seluruhnya ditolak |
| Impor: harga jual < HPP, tipe tak dikenal, kode kosong | dilewati + dilaporkan per baris |
| Impor: koma di dalam tanda kutip | tidak memecah kolom |
| Impor ulang | memperbarui, tidak menggandakan |
