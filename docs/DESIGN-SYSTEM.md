# Design System — SIM Klinik Sahabat Gamma

**Versi:** 1.0 · **Turunan dari:** `CLAUDE.md` v2.5
**Nama internal design system:** *Gamma UI*

---

## 0. Keputusan atas prototipe `klinik.html`

`klinik.html` (prototipe "KlinikPro", 3.996 baris) **dipakai sebagai rujukan struktural, bukan rujukan visual atau fungsional.**

| Aspek | Verdict | Alasan |
|---|---|---|
| Sistem token & skala (radius, spacing, tipografi, densitas tabel) | ✅ **Diadopsi** | Matang, konsisten, densitas cocok untuk aplikasi klinis |
| Anatomi komponen (card `.card`/`.ch`/`.ct`, badge `.b`, stat card `.sc`, tabs `.rm-tab`, tabel `.tbl`) | ✅ **Diadopsi** → dijadikan komponen React | Vocabulary komponen sudah tepat sasaran |
| Information architecture beberapa modul (Apotek 6 tab, Rekam Medis search-first + empty state, Kasir 2 langkah) | ✅ **Diadopsi** | Alurnya benar |
| Palet warna (primary biru `#185FA5`) | ❌ **Diganti** | Brand KPSG adalah hijau. Biru diturunkan jadi warna *info/lab* saja |
| Branding "KlinikPro" + ikon generik `ti-building-hospital` | ❌ **Diganti** | Wajib pakai logo KPSG terlampir |
| Navigasi (satu sidebar berisi semua modul untuk semua orang) | ❌ **Dirombak** | Melanggar *strict segregation of duties* §2.1. Sidebar wajib per-role |
| Obat Racikan (parent-child), BMHP perawat, Jasa Racik, Etiket obat, Dokter Pengganti, SOAP, Antropometri | ❌ **Tidak ada sama sekali** | Justru ini pembeda utama di `CLAUDE.md`. Harus dirancang dari nol |

Hasil audit kata kunci pada `klinik.html`: `Racikan` 0 · `BMHP` 0 · `Jasa Racik` 0 · `Puyer` 0 · `SOAP` 0 · `Antropometri` 0 · `Dokter Pengganti` 0.

**Kesimpulan:** ambil DNA-nya, ganti kulitnya, tambal lubang fungsionalnya. Dokumen ini adalah hasilnya.

---

## 1. Brand

### 1.1 Aset logo

| File | Ukuran sumber | Turunan di `public/brand/` |
|---|---|---|
| `logo KPSG with text.png` | 2000×2000 (isi 1832×333) | `kpsg-logo-1024.png`, `-512`, `-320` |
| `logo KPSG no text.png` | 2000×2000 (isi 1849×1849 setelah dipersegikan) | `kpsg-mark-512.png`, `-192`, `-96`, `-64`, `-32` |

Semua sudah di-*trim* (whitespace dibuang), latar transparan.

### 1.2 Aturan pemakaian logo

| Konteks | Varian | Alasan |
|---|---|---|
| Halaman **Login** | **With text** (`kpsg-logo-512`, lebar ±260px) | Satu-satunya layar di mana identitas klinik perlu dieja penuh |
| **Sidebar** (lebar 236px) | **Mark** 28×28 + teks HTML "Klinik Pratama / **Sahabat Gamma**" | Logo bertext di-scale 200px jadi tinggi 36px → wordmark ±11px, tidak terbaca. Teks HTML lebih tajam & bisa ikut tema |
| Sidebar **collapsed** (64px) | **Mark** 28×28 | — |
| **Favicon / PWA icon** | **Mark** (32, 192, 512) | — |
| **Kop surat A4/A5** (Surat Sakit, Rujukan, Hasil Lab) | **With text**, tinggi 16mm, rata kiri, didampingi blok alamat cabang dari tabel `sites` | Dokumen resmi wajib menampilkan nama badan hukum |
| **Struk thermal 58/80mm** | **Mark**, monokrom hitam, tinggi ±10mm + nama klinik sebagai teks | Printer thermal 1-bit; gradasi hijau jadi bercak |
| **Etiket obat (stiker)** | **Mark** kecil (±6mm) di pojok kiri atas | Ruang sangat terbatas, prioritas ke Aturan Pakai |
| **Tiket antrean** | **Mark** monokrom | — |

> **Catatan produksi:** untuk cetak thermal & etiket, konversi mark ke **1-bit hitam** (jangan kirim PNG hijau ke ESC/POS). Sediakan `kpsg-mark-mono.png` saat modul cetak dikerjakan (Fase 4).

**Ruang aman:** minimal ½ tinggi mark di semua sisi. **Ukuran minimum:** mark 24px layar / 8mm cetak; logo bertext 160px layar / 30mm cetak.
**Dilarang:** mengubah warna logo, memberi outline/shadow, meletakkan di atas foto atau di atas `brand-500`–`brand-900` tanpa versi putih.

### 1.3 Warna brand (diekstrak langsung dari file logo)

| Hex | Peran di logo | Peran di UI |
|---|---|---|
| `#1D9270` | Kuadran teal (dominan) | **PRIMARY** — tombol utama, state aktif, link |
| `#0E5A4D` | Kuadran teal gelap | `brand-700`, hover primary, kop surat |
| `#3B9E44` | Kuadran daun | `leaf-500` — aksen sekunder, **success** |
| `#59CD84` | Kuadran daun muda | `leaf-400` — highlight, chart |
| `#033007` | Wordmark | `ink-brand` — heading tebal, teks kop surat |

---

## 2. Design Tokens

Semua token hidup di `src/app/globals.css` sebagai CSS custom properties dan diekspos ke Tailwind v4 lewat `@theme inline`. **Jangan pernah menulis hex mentah di komponen.**

### 2.1 Palet brand

```
brand-50   #EDF7F3      brand-500  #1D9270  ← PRIMARY
brand-100  #D6EEE5      brand-600  #16785D
brand-200  #ADDCCB      brand-700  #0E5A4D
brand-300  #7CC6AC      brand-800  #0A4238
brand-400  #45AC8B      brand-900  #033007  ← ink-brand
```

### 2.2 Palet semantik

Karena **primary sudah hijau**, warna status wajib dibuat berjarak agar tidak tertukar dengan "tombol utama".

| Token | Hex | Bg lembut | Dipakai untuk |
|---|---|---|---|
| `success` | `#2F8F3C` | `#EDF7EE` | Lunas, stok aman, hasil lab normal |
| `warning` | `#B45309` | `#FDF3E3` | Stok menipis, kadaluarsa <3 bln, menunggu validasi |
| `danger` | `#C02626` | `#FCEDED` | **Alergi**, stok habis, hasil lab kritis, batal |
| `info` | `#1D6FA5` | `#E9F2FA` | Order lab, informasi netral, tautan dokumen |
| `violet` | `#5B4BC4` | `#EFEEFC` | **Racikan** (penanda khusus obat racikan) |

> `violet` sengaja dialokasikan khusus untuk **racikan**. Di seluruh sistem — resep dokter, worklist apotek, baris tagihan kasir, etiket — racikan selalu bertanda ungu. Ini kanal visual yang membedakan alur parent-child dari obat paten sekali lihat.

**Warna triase** (dipakai apa adanya, standar nasional, selalu didampingi label teks — tidak pernah warna saja):
`triage-red #C02626` · `triage-yellow #C98A00` · `triage-green #2F8F3C` · `triage-black #262626`

### 2.3 Netral (sedikit ber-tint hijau agar menyatu dengan brand)

```
canvas        #F4F6F5    (latar aplikasi)
surface       #FFFFFF    (card, sidebar, topbar)
surface-alt   #EDF1EF    (header tabel, baris zebra, input disabled)
border        #DCE3E0
border-strong #C3CDC9
ink           #101B17    (teks utama)
ink-muted     #5A6B64    (label, meta)
ink-faint     #8A9A94    (placeholder, hint)
```

### 2.4 Tipografi

- **UI:** `Inter` (via `next/font/google`, variable) — sama dengan prototipe, terbukti nyaman untuk tabel padat.
- **Angka:** wajib `font-variant-numeric: tabular-nums` pada semua kolom numerik (stok, harga, TTV, hasil lab) agar digit sejajar antar baris.
- **Monospace:** `ui-monospace` untuk No. RM, kode obat, kode ICD-10, nomor resep.

| Skala | Ukuran / line-height | Pemakaian |
|---|---|---|
| `display` | 24 / 32, 600 | Angka besar di dashboard |
| `h1` | 18 / 26, 600 | Judul halaman |
| `h2` | 15 / 22, 600 | Judul card |
| `body` | 13.5 / 20, 400 | Teks & tabel (default `<body>`) |
| `label` | 12 / 16, 500 | Label form |
| `meta` | 11.5 / 16, 400 | Keterangan sekunder |
| `micro` | 10.5 / 14, 600, +0.4px tracking, uppercase | Section header sidebar, badge |

### 2.5 Bentuk, jarak, elevasi

- **Radius:** `sm 6px` · `md 8px` (default: input, tombol, badge kotak) · `lg 12px` (card, modal) · `full` (pill).
- **Spacing:** kelipatan 4. Padding card `16px`, gap antar card `12px`, padding sel tabel `8px 12px`.
- **Elevasi:** hanya 3 level. `flat` (border saja — default card) · `raised` `0 1px 2px rgb(16 27 23 / .06), 0 1px 3px rgb(16 27 23 / .04)` (dropdown, popover) · `overlay` `0 12px 32px rgb(16 27 23 / .14)` (modal, drawer).
  Aplikasi klinis = permukaan datar + garis. Bayangan hanya untuk sesuatu yang benar-benar melayang.
- **Focus ring:** `2px solid brand-500` + `2px offset`. Wajib terlihat di semua elemen interaktif — banyak operator klinik bekerja dengan keyboard.

### 2.6 Densitas

Dua mode, disimpan di preferensi user:
- **Compact** (default untuk Pendaftaran, Apotek, Kasir, Lab): tinggi baris 34px.
- **Comfortable** (default untuk RME dokter): tinggi baris 42px.

---

## 3. Inventaris Komponen

Ekivalen React dari kelas prototipe, ditempatkan di `src/components/ui/`.

| Komponen | Asal di prototipe | Catatan |
|---|---|---|
| `<Card>` / `<CardHeader>` / `<CardTitle>` | `.card` `.ch` `.ct` | Judul selalu didampingi ikon |
| `<Badge variant>` | `.b .b-g .b-r .b-a .b-b` | Varian: brand, success, warning, danger, info, **racikan**, neutral |
| `<StatCard>` | `.sc` | label · nilai · delta (naik/turun/netral) |
| `<DataTable>` | `.tbl` + `.pagi` | Dibangun di atas **TanStack Table** (sort, filter, pagination) |
| `<Tabs>` | `.rm-tab` | Underline, mendukung badge jumlah per tab |
| `<SearchBar>` | `.sbar` | Pola *search-first* + `<EmptyState>`, dipertahankan dari prototipe |
| `<EmptyState>` | `#rm-empty` | Ikon + judul + petunjuk tindakan |
| `<Button variant size>` | `.btn .btn-p .btn-sm` | primary · secondary · ghost · danger; sm/md |
| `<Field>` / `<Input>` / `<Select>` / `<Textarea>` | `.fi` | Terhubung `react-hook-form`, menampilkan error `zod` |
| `<Modal>` / `<Drawer>` | modal prototipe | Drawer untuk detail pasien di samping worklist |
| `<Toast>` | — (baru) | `react-hot-toast`, sesuai §1.3 `CLAUDE.md` |
| `<SiteSwitcher>` | `.branch-sel` | Multi-site; **read-only** untuk role non-pusat |
| `<RoleNav>` | `.ni` `.ns` | Menu di-*generate* dari matriks izin, bukan di-hardcode |
| `<PrintSheet>` | — (baru) | Pembungkus `react-to-print`; preset `thermal58` `thermal80` `a4` `a5` `label` |

### 3.1 Komponen khusus domain (tidak ada di prototipe — inti sistem ini)

| Komponen | Dipakai oleh | Ringkas |
|---|---|---|
| `<VitalSignsForm>` | Perawat | TTV + antropometri (BB, TB, LP) + auto-hitung IMT + flag nilai abnormal |
| `<TriageSelector>` | Perawat | 4 kartu warna standar, wajib berlabel teks |
| `<BmhpPicker>` | Perawat | Autocomplete BMHP → langsung potong stok + masuk billing (§4 `CLAUDE.md`) |
| `<AllergyBanner>` | Semua role klinis | Pita merah persisten di header pasien; **tidak bisa ditutup** |
| `<Icd10Search>` | Dokter | Autocomplete kode+nama, mendukung diagnosa primer/sekunder |
| **`<RacikanBuilder>`** | Dokter | Lihat §4 — komponen paling kompleks di sistem |
| `<SignaInput>` | Dokter | Aturan Pakai: preset cepat (3×1, 2×1, dst) + teks bebas. **Wajib, tidak bisa submit kosong** |
| `<PrescriptionCart>` | Dokter | Daftar campuran item paten & racikan dalam satu resep |
| `<LabResultGrid>` | Petugas Lab | Input nilai + nilai rujukan + penanda otomatis L/H/kritis |
| `<StockLedger>` | Farmasi | Kartu stok: inbound, outbound, opname, pemakaian racikan |
| `<EtiketLabel>` | Farmasi | Pratinjau + cetak stiker (§5.3 `CLAUDE.md`) |
| `<BillingSheet>` | Kasir | Rekap per kategori; **kolom diagnosa disembunyikan permanen** |
| `<ScheduleGrid>` | Admin/HR | Jadwal praktik + penetapan Dokter Pengganti |

---

## 4. Pola Kunci: `<RacikanBuilder>`

Satu-satunya bagian yang wajib dirancang sangat hati-hati, karena ia menjembatani resep → potong stok bahan mentah → biaya jasa racik → etiket.

```
┌─ Racikan  ────────────────────────────────────── [violet-500 kiri 3px] ─┐
│ Nama Racikan   [ Puyer Batuk Anak            ]                          │
│ Bentuk Sediaan [ Puyer ▾ ]   Jumlah Jadi [ 12 ] bungkus                 │
│                                                                          │
│ Komposisi per keseluruhan racikan                    [+ Tambah Bahan]   │
│ ┌────────────────────────┬──────────┬────────┬───────────────────────┐  │
│ │ Bahan (obat mentah)    │ Qty      │ Satuan │ Stok tersedia         │  │
│ ├────────────────────────┼──────────┼────────┼───────────────────────┤  │
│ │ Paracetamol 500 mg     │   6      │ tablet │ 342  ✓                │  │
│ │ Ambroxol 30 mg         │   4      │ tablet │  87  ✓                │  │
│ │ CTM 4 mg               │   3      │ tablet │   2  ⚠ stok kurang    │  │
│ └────────────────────────┴──────────┴────────┴───────────────────────┘  │
│                                                                          │
│ Aturan Pakai *  [3×1] [2×1] [1×1] [Custom]                              │
│ [ 3 x sehari 1 bungkus sesudah makan                                 ]  │
│                                                                          │
│ Jasa Racik      Rp [ 5.000 ]         Estimasi bahan  Rp 4.150           │
└──────────────────────────────────────────────────────────────────────────┘
```

Aturan yang mengikat:
1. **Aturan Pakai wajib** — tombol simpan disabled selama kosong (`zod: min(1)`), sesuai §4 `CLAUDE.md`.
2. **Validasi stok bahan real-time** — bahan dengan stok kurang diberi tanda merah; resep tetap boleh dikirim (keputusan klinis milik dokter), tetapi apotek menerima peringatan blokir saat menyiapkan.
3. **Qty bahan = untuk keseluruhan racikan**, bukan per bungkus. Label ini harus eksplisit di UI — ini sumber kesalahan resep yang paling sering.
4. **Jasa racik** mengalir otomatis ke `billing_transactions` sebagai baris tersendiri (§4 `CLAUDE.md`), bukan dilebur ke harga obat.
5. Setiap racikan = **satu blok bertanda violet**, obat paten = blok netral. Perbedaan ini konsisten dari layar dokter sampai struk kasir.

---

## 5. Navigasi per Role (menggantikan sidebar tunggal prototipe)

Sidebar **di-generate dari matriks izin**. Role tidak pernah melihat menu yang tidak boleh diaksesnya — bukan sekadar disabled, tapi tidak dirender, dan route-nya ditolak di server (middleware + pengecekan ulang di layer data).

| Role | Menu |
|---|---|
| **Super Admin** | Dashboard Sistem · Cabang · Pengguna & Role · Master Data (Poli, Tindakan, ICD-10, Katalog Obat & BMHP, Panel Lab, Tarif) · Audit Log · Pengaturan Sistem |
| **Admin Cabang / HR** | Dashboard Cabang · Jadwal Praktik · **Dokter Pengganti** · Absensi · Cuti & Izin · Laporan Cabang · Profil Cabang |
| **Dokter** | Antrean Saya · Rekam Medis (SOAP) · E-Resep · Order Lab · Surat Keterangan · Jadwal Saya |
| **Perawat** | Antrean & Triase · Pengkajian Awal · Input BMHP |
| **Petugas Lab** | Order Masuk · Input Hasil · Riwayat & Cetak |
| **Farmasi** | Resep Masuk · Worklist Racikan · Inventori · Penerimaan · Pengeluaran · Stock Opname · Monitoring Kadaluarsa |
| **Kasir** | Tagihan Menunggu · Riwayat Transaksi · Tutup Kasir |

Aturan penegakan:
- **Perawat, Lab, Farmasi, Kasir** tidak punya rute apa pun ke RME penuh (`CLAUDE.md` §2.1: *eksklusif*).
- **Kasir tidak pernah menerima kolom diagnosa** — dibuang di query, bukan di-`hidden` lewat CSS.
- **Site switcher** aktif hanya untuk Super Admin; role lain terkunci pada `site_id` miliknya.

### 5.1 Tiga bentuk menurut lebar layar

Isi menunya sama persis di ketiganya (`components/shell/nav-isi.tsx`) —
yang berubah hanya wadahnya.

| Lebar | Bentuk | Alasan |
|---|---|---|
| `< md` (<768) | disembunyikan; dijangkau lewat **laci** | Layar sesempit itu tidak punya ruang untuk navigasi permanen |
| `md`–`lg` | **rel 64px**, hanya ikon | Berpindah modul tetap satu ketukan, isi layar tetap lapang |
| `≥ lg` | **penuh 236px** | Bentuk aslinya |

Tombol laci tetap tersedia sampai `lg`, jadi rel ikon tidak pernah berdiri
sendiri: petugas yang lupa arti sebuah ikon selalu punya jalan melihat
namanya. Ikon tanpa nama boleh jadi jalan pintas, tidak boleh jadi
satu-satunya jalan. Pada rel, label tetap ada sebagai `title` **dan**
`sr-only`.

### 5.2 Pencarian cepat — Ctrl / ⌘ + K

Navigasi lewat sidebar mensyaratkan pengguna **sudah tahu** pasiennya ada di
modul mana. Kotak pencarian membalik urutan itu: ketik nama, NIK, atau
No. RM, dan sistem yang menjawab pasiennya sedang di mana.

Dua aturan yang membentuknya (`lib/pencarian.ts`):

- **Pasien dicari lintas cabang, tindakan tidak.** Satu NIK adalah satu
  pasien di seluruh jaringan (`docs/DATABASE.md` §3.7), tetapi setiap layar
  detail menyaring `site_id`. Kunjungan di cabang lain karena itu ditandai
  dan **tidak** ditautkan — tautan yang berujung 404 lebih buruk daripada
  tidak ada tautan.
- **Tautan mengikuti peran DAN status.** Tiap peran punya layar dengan id
  berbeda (dokter: kunjungan · lab: order · farmasi: resep · kasir:
  tagihan), dan id itu hanya diberikan bila statusnya berarti perannya
  memang punya pekerjaan. Tagihan lahir sebagai `draft` sejak pendaftaran;
  tanpa saringan ini kasir akan dilempar ke layar pembayaran pasien yang
  belum diperiksa.

Peran yang tidak punya layar untuk pasien itu **tetap melihat barisnya**
beserta posisinya; yang hilang hanya tombolnya. Menjawab "di mana" tidak
butuh izin membuka rekamnya.

---

## 6. Pola Cetak

Satu abstraksi `<PrintSheet preset>` dengan CSS `@page` per preset. Kop surat selalu ditarik dari `sites` (§5 `CLAUDE.md`).

| Preset | `@page` | Dokumen |
|---|---|---|
| `thermal58` | 58mm auto, monokrom, tanpa margin | Tiket antrean |
| `thermal80` | 80mm auto, monokrom | Struk kasir, copy resep |
| `a4` / `a5` | margin 15mm, kop surat penuh | Surat Sakit/Sehat, Rujukan, Hasil Lab |
| `label` | 50×30mm, tanpa kop | **Etiket obat** |

**Etiket obat** — hierarki visual wajib (§5.3 `CLAUDE.md`):
```
[mark] Klinik Pratama Sahabat Gamma          01/08/2026
Nama Pasien: Budi Santoso
Puyer Batuk Anak                    ← nama obat/racikan, 11pt bold
3 × SEHARI 1 BUNGKUS                ← ATURAN PAKAI, 13pt bold, elemen terbesar
SESUDAH MAKAN
```
Aturan Pakai adalah elemen terbesar di stiker. Ini yang dibaca pasien di rumah; nama klinik boleh kecil.

---

## 7. Aksesibilitas & keandalan operasional

- Kontras teks minimal **4.5:1**. `brand-500 #1D9270` di atas putih = 3.4:1 → **tidak boleh untuk teks kecil**; untuk teks gunakan `brand-700 #0E5A4D` (7.1:1). Untuk tombol primary, teks putih di atas `brand-600 #16785D` (4.9:1).
- Warna tidak pernah menjadi satu-satunya pembawa makna: triase, status stok, hasil lab kritis, dan racikan selalu disertai label/ikon.
- Target sentuh minimal 36×36px (tablet dipakai di ruang perawat). `<Button size="sm">` setinggi 32px di desktop dan naik ke 36px lewat varian `pointer-coarse` — `sm` ada untuk tabel padat, jadi menyamakannya dengan `md` secara menyeluruh akan menghapus alasan keberadaannya.
- Isian panjang yang belum tersimpan (form asesmen) memicu konfirmasi bawaan peramban saat tab ditutup, **dan** menampilkan penanda "Ada perubahan yang belum disimpan" di bilah tombol. Penanda itu bukan hiasan: App Router tidak menyediakan kait untuk membatalkan perpindahan di dalam aplikasi, sehingga untuk kasus itu penanda adalah satu-satunya peringatan.
- Semua aksi destruktif (batal transaksi, hapus resep terkirim, koreksi opname) butuh konfirmasi eksplisit + tercatat di audit log.
- Toast bukan satu-satunya umpan balik untuk operasi kritis (potong stok, pembayaran) — status akhir harus tetap terbaca di layar setelah toast hilang.

---

## 8. Keadaan Layar (State Layar)

Tiga keadaan berikut wajib punya jawaban di setiap modul. Sebelum bagian ini
ada, ketiganya berakhir sama: layar yang tidak berubah, dan petugas yang
menyimpulkan sistemnya rusak.

### 8.1 Sedang memuat — `loading.tsx`

Setiap layar `force-dynamic` dan langsung memukul MySQL. Tanpa batas
pemuatan, Next.js menahan layar **lama** tanpa perubahan apa pun sampai
kuerinya selesai — klik yang terbaca sebagai klik yang tidak terbaca.

- `src/app/(app)/loading.tsx` — kerangka umum "ringkasan + daftar", berlaku
  untuk seluruh modul.
- Modul yang bentuknya sungguh berbeda menimpanya sendiri
  (`rme/[id]/loading.tsx`).
- Kerangka **tidak pernah meniru data**. Balok abu, bukan angka contoh:
  data palsu yang sekilas terbaca sebagai data asli adalah hal terakhir yang
  boleh ada di layar klinis.

### 8.2 Gagal — `error.tsx`, `not-found.tsx`, `global-error.tsx`

| Berkas | Menangkap | Pesan intinya |
|---|---|---|
| `(app)/error.tsx` | Galat di dalam halaman | "Coba lagi" + kode gangguan untuk IT |
| `(app)/not-found.tsx` | `notFound()` di layar detail | Menyebut **cabang aktif** sebagai penyebab tersering |
| `global-error.tsx` | Galat di root layout | Satu-satunya berkas yang boleh memakai hex mentah — token belum tentu termuat |

Pesan galat asli **tidak** ditampilkan (bisa memuat potongan SQL);
`error.digest` **justru** ditampilkan, karena itulah satu-satunya benang
antara layar petugas dan baris log server.

### 8.3 Basi — `<SegarkanBerkala>`

Layar antrean yang dirender sekali lalu diam adalah layar yang berbohong.
Semua worklist memakai `<SegarkanBerkala />` di `CardHeader` daftar
utamanya:

- **berhenti saat tab tersembunyi** — layar klinik dibiarkan terbuka
  sepanjang hari; menyegarkan data yang tidak dilihat siapa pun hanya
  membebani MySQL;
- **menyegarkan seketika saat tab kembali terlihat** — justru pada saat itu
  datanya paling basi;
- **terlihat, bukan diam-diam** — cip menyatakan kapan terakhir diperbarui,
  dan menekannya menyegarkan sekarang juga.

Lonceng notifikasi menarik datanya sendiri tiap 45 detik dengan aturan yang
sama, ditambah satu: notifikasi bertanda `mendesak` (nilai kritis lab, resep
dikembalikan, order lab dibatalkan) **diserukan lewat toast**, bukan hanya
menaikkan angka lencana. Lencana kecil di pojok layar bukan cara memberi
tahu dokter bahwa pasiennya tertahan.
