# Rancangan Database — SIM Klinik Sahabat Gamma

**Sumber kebenaran:** [`db/schema.sql`](../db/schema.sql) · **Data awal:** [`db/seed.sql`](../db/seed.sql)
**Target:** MySQL 8.0+ · InnoDB · `utf8mb4_unicode_ci`
**Status:** sudah diverifikasi jalan di MySQL 8.0.30 — 52 tabel, seluruh FK & CHECK aktif.

---

## 1. Cara menjalankan

```bash
mysql -u root < db/schema.sql
mysql -u root < db/seed.sql
```

Seed membuat 1 cabang (`KPSG-01`) dan 8 akun demo. **Password semua akun: `kpsg12345`** dengan `must_change_pw = 1`.
Hash bcrypt di `seed.sql` adalah placeholder — **ganti sebelum go-live.**

| Username | Role |
|---|---|
| `superadmin` | Super Admin |
| `admin` | Admin Cabang / HR |
| `dokter`, `dokter2` | Dokter |
| `perawat` | Perawat |
| `lab` | Petugas Laboratorium |
| `farmasi` | Petugas Farmasi |
| `kasir` | Kasir |

---

## 2. Peta tabel (61)

| Kelompok | Tabel |
|---|---|
| **Setup & identitas** | `sites` `roles` `permissions` `role_permissions` `users` `user_sites` `doctor_profiles` `sequences` |
| **HR** | `polis` `doctor_schedules` `schedule_exceptions` `leave_requests` `attendances` |
| **Master klinis** | `icd10_codes` `medical_procedures` `site_procedure_tariffs` `lab_panels` `lab_parameters` |
| **Katalog & inventori** | `item_categories` `suppliers` `items` `item_stocks` `item_batches` `stock_movements` `purchases` `purchase_items` `stock_opnames` `stock_opname_items` |
| **Pasien & kunjungan** | `patients` `patient_allergies` `visits` `queues` |
| **Perawat** | `nurse_assessments` `nurse_bmhp_usage` |
| **Dokter / RME** | `medical_assessments` `assessment_diagnoses` `assessment_procedures` |
| **Laboratorium** | `lab_orders` `lab_order_panels` `lab_results` |
| **Resep (parent-child)** | `prescriptions` `prescription_items` `prescription_racikans` `prescription_racikan_ingredients` |
| **Kasir** | `cashier_shifts` `billing_transactions` `billing_items` |
| **Dokumen** | `medical_certificates` |
| **Penjamin & klaim** | `payers` `payer_tariffs` `claims` `claim_items` `claim_payments` |
| **Kepatuhan** | `consents` `patient_safety_incidents` |
| **Sistem** | `audit_logs` `settings` `notifications` `satusehat_sync_logs` `bpjs_sync_logs` |

---

## 3. Keputusan desain yang perlu dipahami sebelum menulis kode

### 3.1 `visits` adalah poros seluruh sistem

Setiap modul menempel ke satu `visit_id`, bukan ke `patient_id`. Ini membuat satu kunjungan dapat dilacak utuh: antrean → pengkajian perawat → asesmen dokter → order lab → resep → tagihan. Kolom `visits.status` adalah **state machine** yang menggerakkan worklist tiap role:

```
terdaftar → menunggu_perawat → dikaji_perawat → menunggu_dokter
   → dalam_pemeriksaan → [menunggu_lab] → menunggu_farmasi
   → menunggu_kasir → selesai
```

Setiap perpindahan status hanya boleh dilakukan oleh role pemiliknya, dan wajib dicatat di `audit_logs`.

### 3.2 Satu katalog untuk obat, bahan racikan, dan BMHP

`items.tipe ∈ {obat, bmhp, alkes}`.

Alasan: `CLAUDE.md` §3.1 mensyaratkan BMHP perawat **otomatis memotong stok dan masuk tagihan** — perilaku yang identik dengan obat. Memisah katalog BMHP berarti menduplikasi kartu stok, monitoring kadaluarsa, dan logika billing. Satu katalog + satu ledger (`stock_movements`) menghilangkan duplikasi itu.

Flag `items.is_racikable` menentukan apakah sebuah item boleh muncul di pencarian bahan `<RacikanBuilder>`.

### 3.3 `stock_movements` adalah satu-satunya sumber kebenaran stok

`item_stocks.qty_on_hand` hanyalah cache. **Setiap** pemotongan wajib menulis satu baris ledger:

| Peristiwa | `jenis` | `ref_type` |
|---|---|---|
| Perawat pakai BMHP | `keluar_bmhp` | `nurse_bmhp_usage` |
| Farmasi serahkan obat paten | `keluar_resep` | `prescription_item` |
| Farmasi racik puyer | `keluar_racikan` | `racikan_ingredient` |
| Penerimaan barang | `masuk_pembelian` | `purchase` |
| Koreksi opname | `masuk_opname` / `keluar_opname` | `opname` |
| Pengeluaran non-resep | `keluar_kadaluarsa` / `keluar_rusak` / `keluar_koreksi` | `pengeluaran_manual` |
| Penarikan batch kadaluarsa | `keluar_kadaluarsa` | `batch` |

**Batch dikonsumsi FEFO.** `kurangiStok()` membagi pemotongan ke batch yang paling cepat kadaluarsa; batch tanpa tanggal kadaluarsa diletakkan paling belakang. Pemotongan yang melintasi beberapa batch menghasilkan satu baris ledger per batch — jumlah `qty_delta`-nya tetap sama dengan yang diminta, jadi rekonsiliasi tidak berubah.

**Stok kadaluarsa terkunci dari pasien.** Untuk `keluar_resep`, `keluar_racikan`, dan `keluar_bmhp`, batch yang sudah lewat tanggal kadaluarsa dilewati dalam alokasi DAN jumlahnya dikurangkan dari saldo yang dianggap tersedia. Tanpa yang kedua, farmasi masih bisa menyerahkan lebih banyak daripada barang layak yang benar-benar ada. Barang kadaluarsa hanya bisa keluar lewat pemusnahan, pencatatan rusak, atau koreksi opname.

Dua invarian yang diuji `uji-rekonsiliasi.ts`:

```
item_stocks.qty_on_hand  =  SUM(stock_movements.qty_delta)
SUM(item_batches.qty)   <=  item_stocks.qty_on_hand
```

**Koreksi opname memakai selisih terhadap potret, bukan terhadap saldo saat finalisasi.** Lembar hitung menyimpan `qty_sistem` sebagai potret saat dibuka; koreksi yang diterapkan adalah `qty_fisik − qty_sistem`. Bedanya menentukan: bila ada resep yang diserahkan di sela penghitungan, memaksa saldo menjadi `qty_fisik` akan menghapus pengeluaran yang sah itu. Bila koreksi tetap akan membuat saldo minus, finalisasi ditolak seluruhnya — bukan sebagian.

Tabel `nurse_bmhp_usage`, `prescription_items`, dan `prescription_racikan_ingredients` masing-masing menyimpan `stock_movement_id` sebagai bukti pemotongan. **Kolom itu NULL = stok belum dipotong.** Ini yang membuat status "sudah disiapkan" tidak bisa dipalsukan.

Rekonsiliasi kapan pun:
```sql
SELECT i.kode, i.nama, s.qty_on_hand,
       COALESCE(SUM(m.qty_delta), 0) AS qty_ledger
FROM items i
JOIN item_stocks s     ON s.item_id = i.id AND s.site_id = ?
LEFT JOIN stock_movements m ON m.item_id = i.id AND m.site_id = ?
GROUP BY i.id
HAVING s.qty_on_hand <> qty_ledger;   -- harus kosong
```

### 3.4 Resep parent-child (inti sistem, `CLAUDE.md` §7)

```
prescriptions (header)
├── prescription_items                  ← obat PATEN, punya aturan_pakai
└── prescription_racikans (header)      ← punya aturan_pakai + biaya_jasa_racik
    └── prescription_racikan_ingredients ← bahan mentah, dasar potong stok
```

Aturan yang ditegakkan **di level database**, bukan hanya di form:

```sql
CONSTRAINT ck_pit_signa CHECK (CHAR_LENGTH(TRIM(aturan_pakai)) > 0)   -- obat paten
CONSTRAINT ck_prc_signa CHECK (CHAR_LENGTH(TRIM(aturan_pakai)) > 0)   -- racikan
```

`CLAUDE.md` §4 menyebut Aturan Pakai **wajib diisi**. Validasi `zod` di frontend bisa di-bypass lewat API; CHECK constraint tidak bisa. Sudah diuji: `INSERT` dengan `aturan_pakai = '   '` ditolak dengan `Check constraint 'ck_pit_signa' is violated`.

**Satu resep BERJALAN per kunjungan — bukan satu baris.** Aturannya ditegakkan lewat kolom terhitung, bukan lewat `UNIQUE (visit_id)`:

```sql
visit_aktif BIGINT UNSIGNED GENERATED ALWAYS AS (IF(status <> 'batal', visit_id, NULL)) STORED,
UNIQUE KEY uq_rx_visit_aktif (visit_aktif)
```

Bedanya bukan gaya penulisan. Dengan `UNIQUE (visit_id)` yang lama, resep yang sudah dibatalkan **mengunci kunjungannya selamanya**: `simpanResep()` masuk ke cabang INSERT dan gagal dengan `Duplicate entry ... for key 'uq_rx_visit'` — padahal pesan galat yang dilihat dokter berbunyi persis *"Batalkan resep lalu terbitkan resep baru."* Mengikuti petunjuk aplikasi sendiri berujung galat MySQL mentah.

NULL tidak pernah bentrok dengan NULL pada indeks unik, sehingga resep batal boleh menumpuk sebagai riwayat sementara yang hidup tetap tunggal. Menimpa baris lama akan jauh lebih mudah — dan akan menghapus jejak resep yang pernah dituliskan untuk seorang pasien.

> `fk_rx_visit` dulu bersandar pada `uq_rx_visit` sebagai indeks penopang, jadi `ix_rx_visit (visit_id)` wajib dipasang **sebelum** indeks lama dijatuhkan.

> **`qty_bahan` adalah untuk keseluruhan racikan, bukan per bungkus.** Ini didokumentasikan di komentar kolom dan wajib dieja di UI. Salah tafsir di sini = kesalahan dosis.

### 3.4b `billing_transactions.status` — `draft` bukan piutang

| Status | Artinya | Boleh disebut piutang? |
|---|---|---|
| `draft` | Tagihan lahir bersama kunjungan dan terus bertambah selama pasien dilayani (konsultasi, BMHP perawat, tarif lab). Angkanya belum final. | **Tidak** |
| `menunggu` | Sudah final, tinggal dibayar. | Ya |
| `lunas` | Terbayar. | — |
| `batal` | **Final** — dipakai hanya saat kunjungannya sendiri dibatalkan, karena `uq_bt_visit` membuat satu kunjungan hanya punya satu tagihan. Pembayaran yang salah dikembalikan ke `menunggu`, bukan ke `batal` (`CLAUDE.md` §3.2). |  — |

Perbedaan `draft` dan `menunggu` gampang terlewat karena keduanya sama-sama "belum dibayar". Laporan cabang dulu menjumlahkannya jadi satu angka berlabel *Belum Dibayar* — akibatnya angka piutang naik setiap kali seorang pasien masuk ruang periksa, lalu turun lagi begitu ia membayar, tanpa satu rupiah pun pernah tertunggak. `ringkasanCabang()` kini melaporkan keduanya terpisah (`menungguKasir` dan `dalamPelayanan`), dan hanya yang pertama yang tampil sebagai angka utama.

### 3.5 Jasa racik mengalir ke billing sebagai baris terpisah

`prescription_racikans.biaya_jasa_racik` → satu baris `billing_items` dengan `kategori = 'jasa_racik'`, terpisah dari `kategori = 'racikan'` (nilai bahannya). `CLAUDE.md` §4 menyebutnya sebagai komponen biaya tersendiri, dan pemisahan ini juga membuat laporan pendapatan jasa apoteker langsung bisa ditarik.

### 3.6 Kasir tidak pernah menerima diagnosa

`billing_items` menyimpan `deskripsi` (teks siap cetak), bukan referensi ke diagnosa. Layar kasir hanya membaca:

```sql
SELECT bt.*, p.nama, p.no_rm
FROM billing_transactions bt
JOIN visits v   ON v.id = bt.visit_id
JOIN patients p ON p.id = v.patient_id
WHERE bt.site_id = ? AND bt.status = 'menunggu';
-- TIDAK PERNAH menyentuh medical_assessments / assessment_diagnoses
```

`CLAUDE.md` §2.1 poin 7: "Detail diagnosa klinis disembunyikan di layar kasir." Diimplementasikan sebagai **tidak dikirim dari server**, bukan `display:none` di klien.

### 3.7 Multi-site

Setiap tabel operasional membawa `site_id`. **Setiap query wajib memfilternya.** Sumber `site_id` adalah sesi user (`users.site_id`), tidak pernah dari parameter request — kecuali Super Admin (`users.site_id IS NULL`) yang boleh memilih cabang lewat `<SiteSwitcher>`.

Data yang **global** (tanpa `site_id`): `icd10_codes`, `medical_procedures`, `lab_panels`, `lab_parameters`, `items`, `item_categories`, `suppliers`, `roles`, `permissions`.
Data yang **per-cabang**: stok (`item_stocks`, `item_batches`), seluruh transaksi, penomoran (`sequences`), dan override tarif (`site_procedure_tariffs`).

`patients.nik` `UNIQUE` secara global — satu orang = satu pasien di seluruh jaringan cabang. `no_rm` unik per cabang.

**Penugasan lintas cabang (`user_sites`).** `users.site_id` adalah cabang induk; `user_sites` memuat penugasan tambahan — mis. dokter yang praktik di dua cabang. Cabang induk sengaja TIDAK ikut tercatat di `user_sites` agar pencabutannya tidak ambigu.

Setiap query yang menyaring pengguna per cabang memakai satu predikat bersama, `SQL_BERTUGAS_DI_CABANG` di `lib/auth.ts`:

```sql
( ? IS NULL
  OR u.site_id = ?
  OR EXISTS (SELECT 1 FROM user_sites us
              WHERE us.user_id = u.id AND us.site_id = ?) )
```

Ditulis sekali supaya tidak ada layar yang ketinggalan saat aturan penugasan berubah.

**Tiga jebakan yang sudah pernah termakan.** `users.site_id` terlihat seperti "cabang pegawai ini" dan karena itu dipakai sebagai penyaring — padahal ia hanya cabang induk:

| Tempat | Akibat memakai `users.site_id` |
|---|---|
| `absensiHarian()` | Dokter tiga cabang hanya bisa diabsen di satu; di dua cabang lain ia tidak muncul sama sekali, padahal di sanalah ia hadir. |
| `daftarkanKunjungan()` | Halangan jadwal dicari per cabang, sementara `putuskanCuti()` hanya membuat pengecualian di cabang pengaju — dokter yang cuti di Pusat tetap bisa didaftari pasien di Cimahi. Layar pendaftaran (`daftarDokter`) sudah menandainya berhalangan **tanpa** penyaring cabang, jadi petugas melihat peringatan lalu servernya menerima. |
| `tambahPengecualian()`, `ajukanCuti()` | Tidak memeriksa kepemilikan sama sekali, sehingga id pegawai dari cabang lain diterima begitu saja. |

Aturannya: **halangan seorang dokter berlaku lintas cabang, tindakannya tidak.** Pendaftaran karena itu mencari `schedule_exceptions` tanpa penyaring cabang tetapi mendahulukan baris cabang aktif — hanya pengganti dari cabang itulah yang benar-benar bisa melayani pasiennya. Semuanya dijaga `uji/uji-hr-lintas-cabang.ts`.

Daftar cabang yang boleh diakses IKUT DI DALAM TOKEN sesi yang ditandatangani, bukan dibaca dari database saat pemeriksaan — `getSession()` juga dipanggil dari middleware Edge Runtime, tempat mysql2 tidak jalan. Konsekuensinya: perubahan penugasan baru berlaku setelah pengguna masuk kembali.

### 3.8 Penomoran dokumen

Tabel `sequences` dikunci dengan `SELECT ... FOR UPDATE` di dalam transaksi yang sama dengan pembuatan dokumen:

```sql
START TRANSACTION;
SELECT last_number FROM sequences
 WHERE site_id=? AND seq_key='resep' AND periode=? FOR UPDATE;
UPDATE sequences SET last_number = last_number + 1 WHERE ...;
-- INSERT prescriptions ... COMMIT;
```

Format: `{prefix_cabang}/{kode}/{periode}/{nomor}` — mis. `KPSG-01/R/202608/000123`.

| `seq_key` | Dokumen | Contoh |
|---|---|---|
| `rm` | No. Rekam Medis | `KPSG-01-000123` |
| `visit` | Kunjungan | `KPSG-01/V/202608/00045` |
| `resep` | E-Resep | `KPSG-01/R/202608/00012` |
| `lab` | Order laboratorium | `KPSG-01/L/202608/00007` |
| `invoice` | Tagihan kasir | `KPSG-01/INV/202608/00031` |
| `surat` | Surat keterangan | `KPSG-01/SKET/202608/0004` |
| `penerimaan` | Penerimaan barang | `KPSG-01/TRM/202608/00003` |
| `opname` | Lembar stock opname | `KPSG-01/SO/202608/0002` |

Cabang baru otomatis mendapat kedelapan penomoran ini saat dibuat.

### 3.9 Dokter pengganti

`visits.doctor_id` = dokter **terjadwal**. `visits.substitute_doctor_id` = dokter yang **benar-benar melayani**.
`medical_assessments.doctor_id` = penandatangan asesmen — inilah yang dicetak di dokumen medis dan yang dipakai untuk perhitungan jasa dokter. Ketiganya sengaja dipisah agar laporan produktivitas dokter tetap akurat saat ada penggantian.

`schedule_exceptions` menyimpan riwayat penggantiannya, dengan `CHECK (substitute_doctor_id <> doctor_id)`.

### 3.10 Rekam medis tidak pernah dihapus

Tidak ada `deleted_at` pada tabel klinis dan transaksional. Pembatalan memakai `status = 'batal'` + `alasan_batal`, dan setiap perubahan tercatat di `audit_logs` (`data_before` / `data_after` sebagai JSON). `deleted_at` hanya ada pada master data (`sites`, `users`, `items`).

### 3.11 Kolom terhitung (generated columns)

| Tabel | Kolom | Rumus |
|---|---|---|
| `nurse_assessments` | `imt` | `berat_badan / (tinggi_badan/100)²` — STORED |
| `stock_opname_items` | `selisih` | `qty_fisik - qty_sistem` — STORED |
| `prescriptions` | `visit_aktif` | `IF(status <> 'batal', visit_id, NULL)` — STORED, dasar `uq_rx_visit_aktif` (§3.4) |

Terverifikasi: BB 72,5 kg / TB 170 cm → IMT 25,09.

---

### 3.12 Penjamin, klaim, dan piutang

**Penjamin global, klaim per cabang.** Satu kontrak perusahaan berlaku untuk seluruh jaringan — sama seperti `suppliers` dan katalog obat. Yang lahir di cabang adalah tagihannya, jadi `claims` membawa `site_id`.

**Urutan kewenangan harga** (`tarifTindakanBerlaku()` di `lib/penjamin.ts`):

```
payer_tariffs  →  site_procedure_tariffs  →  medical_procedures.tarif
 (kontrak)          (kebijakan cabang)          (global)
```

Tidak boleh dibalik: kontrak adalah kesepakatan tertulis dengan pihak luar, tarif cabang hanya kebijakan internal. Menagih penjamin di atas harga kontrak adalah cara tercepat membuat seluruh berkas klaim ditolak.

`simpanAsesmen()` **menghitung ulang** tarif ini di server dan mengabaikan angka dari formulir. Dua sebabnya: harga tidak pernah boleh berasal dari kiriman klien, dan tanpa perhitungan ulang `payer_tariffs` tersimpan rapi tanpa pernah dibaca siapa pun — persis keadaan yang ditemukan simulasi hari klinik.

**Pembagian tanggungan** hidup di SATU fungsi, `bagiTanggungan()`:

| `plafon` | Arti |
|---|---|
| `< 0` | tidak ada penjamin; pasien menanggung seluruhnya |
| `= 0` | penjamin menanggung seluruhnya (tanpa batas) |
| `> 0` | penjamin sampai plafon, selisihnya ke pasien |

`billing.ts` dan `cashier.ts` memanggilnya, tidak menyalinnya. Aturan uang yang ditulis dua kali adalah dua aturan yang akan menyimpang.

**Tagihan penjamin ditandai LUNAS**, dengan `payment_method = 'penjamin'` bila pasien tidak menyetor apa pun. Uangnya belum masuk, dan itu tercatat di klaimnya — bukan dengan menahan pasien di kasir. Konsekuensinya harus disadari: **pendapatan pada laporan ≠ kas pada shift kasir**. Selisihnya adalah tanggungan penjamin, dan itu memang piutang.

> `tutupShift()` dan `ringkasanShift()` karena itu menjumlahkan **`dibayar - kembalian`**, bukan `total`. Dengan `total`, pasien berplafon yang menyetor 53.000 atas tagihan 153.000 tercatat 153.000, dan kasir menutup shift dengan selisih minus 100.000 yang tidak bisa dijelaskannya — setiap hari.

**Piutang tidak ditabelkan.** Ia diturunkan dari klaim dikurangi `claim_payments`, pola yang sama dengan saldo stok terhadap `stock_movements` (§3.3). Angka piutang yang disimpan terpisah adalah angka yang bisa menyimpang dari sumbernya, dan ketika itu terjadi tidak ada cara mengetahui mana yang benar.

**`jatuh_tempo` dibekukan** saat klaim diajukan, dihitung dari termin kontrak. Bila dihitung ulang setiap kali laporan dibuka, mengubah termin akan mengubah umur seluruh piutang lama — dan tagihan yang terlambat tiga bulan bisa mendadak tampak belum jatuh tempo.

### 3.13 Kepatuhan: persetujuan & insiden

`consents.isi` menyimpan **kalimat utuh** yang ditandatangani, bukan rujukan ke templat. Templatnya hidup sebagai konstanta di `lib/consent-templat.ts`; sebuah tabel master hanya akan memberi kesan bahwa mengubah templat mengubah dokumen lama — kesan yang justru harus dihindari.

`patient_safety_incidents.pelapor_id` **boleh NULL**: pelaporan anonim harus mungkin, karena budaya keselamatan pasien runtuh begitu melapor terasa seperti mengaku salah. Anonim berarti kolomnya benar-benar NULL, bukan disembunyikan di layar — tetapi `audit_logs` tetap mencatat siapa yang menekan kirim, supaya jalur anonim tidak jadi pintu untuk laporan palsu.

Daftar peran pada menu `Lapor Insiden` (`lib/rbac.ts`) **wajib sama** dengan `ROLE_LAPOR` di `mutu/ikp/actions.ts`. Keduanya pernah berbeda: aksinya mengizinkan lima peran sementara menunya hanya dua, sehingga apoteker yang menemukan insiden dilempar middleware ke dashboard.

### 3.14 Laporan wajib tidak menyimpan angka baru

SIPNAP dan LB1 sama-sama **diturunkan**, bukan ditabelkan:

| Laporan | Sumbernya | Yang ditambahkan ke skema |
|---|---|---|
| **SIPNAP** | `stock_movements` (§3.3) | `items.is_psikotropika`, `golongan_narkotika`, `no_izin_edar` |
| **LB1** | `assessment_diagnoses` + `visits` | tidak ada |

Menyalin angkanya ke tabel laporan berarti menciptakan angka kedua yang bisa berbeda dari kartu stok — dan pada laporan yang bisa diaudit petugas Dinkes, dua angka yang berbeda lebih buruk daripada tidak ada laporan.

Keduanya melaporkan **kesiapan** lebih dulu: SIPNAP membandingkan saldo hitungan dengan saldo gudang (selisih = temuan, bukan pembulatan), LB1 menghitung kunjungan yang **tidak** masuk laporan. Tanpa angka kedua itu, laporan tetap tercetak rapi dengan nilai yang terlalu kecil dan tidak ada satu pun tanda bahwa sebagian data tidak terhitung.

### 3.15 Urutan kunci baris & deadlock

Deadlock InnoDB tidak lahir dari satu transaksi yang salah, melainkan dari dua transaksi yang masing-masing benar tetapi mengambil kunci yang sama dalam urutan berbeda. **Tujuh siklus seperti itu pernah ada di sistem ini**, semuanya dibuktikan melempar `ER_LOCK_DEADLOCK` (errno 1213) sebelum diperbaiki — lihat `uji/uji-konkurensi.ts`.

#### Aturan urutan (`lib/kunci.ts`)

```
1. visits
2. prescriptions · lab_orders            (dokumen anak kunjungan)
3. billing_transactions · billing_items
4. item_stocks · item_batches            (menurut item_id menaik)
5. sequences                             (paling akhir, paling singkat)
```

Urutannya mengikuti alur pasien, bukan kenyamanan menulis. **Apa pun yang kelak menyentuh `visits` harus menguncinya lebih dulu**, meski id kunjungannya baru diketahui setelah membaca tabel lain — `visitIdDariResep()`, `visitIdDariOrderLab()`, dan `visitIdDariTagihan()` ada untuk itu, dan ketiganya membaca tanpa kunci sehingga tidak memperkenalkan siklus baru.

Empat siklus yang ditutup aturan ini:

| Satu sisi | Sisi lain |
|---|---|
| `simpanAsesmen`: visits → billing | `prosesPembayaran`: billing → visits |
| `simpanResep`: visits → prescriptions | `serahkanResep`: prescriptions → visits |
| `buatOrderLab`: visits → lab_orders | `simpanHasilLab`: lab_orders → visits |
| resep `[A,B]` | resep `[B,A]` |

Yang keempat ditutup `kunciStok()`: seluruh kunci stok diambil di muka menurut `item_id`, sehingga loop di bawahnya tetap bebas menyusuri item menurut urutan yang diketik dokter — struk, etiket, dan baris tagihan tidak berubah.

#### Gap lock: jebakan yang lebih sering, dan lebih tak terduga

Tiga siklus sisanya **tidak** berasal dari urutan kunci. Keduanya lahir dari hal yang tampak tidak berbahaya sama sekali:

> `SELECT … FOR UPDATE` atas baris yang **belum ada** tidak mengunci baris apa pun — ia mengambil **gap lock**. `INSERT` dari transaksi lain ke gap yang sama lalu menabraknya, dan salah satu dibunuh.

| Tempat | Pemicunya di klinik | Bukti |
|---|---|---|
| `pastikanTagihan()` | dua kunjungan mendapat tagihan pertamanya bersamaan | 12/12 deadlock |
| `catatAbsensi()` | seluruh staf absen masuk dalam beberapa menit yang sama | 11/12 |
| `simpanResep()` | dua dokter meresepkan untuk **pasien berbeda** | 12/12 |
| `bukaShift()` | dua kasir membuka shift | 11/12 |

Pada tiga yang terakhir kedua pihak **tidak berbagi satu pun data** — itulah sebabnya tidak seorang pun akan menduganya dari membaca kode.

**Polanya:** baca biasa dulu; kunci hanya bila barisnya memang ada, dan lewat *primary key* (record lock, tanpa gap). Kebenarannya diserahkan pada kunci unik di database (`uq_bt_visit`, `uq_att`, `uq_ci_billing_aktif`) plus jalur pemulihan `ER_DUP_ENTRY` — bukan pada penguncian di aplikasi.

#### Menjaganya tetap berlaku

- `uji/uji-higiene-kode.ts` §2 menolak transaksi baru yang menulis `visits` tanpa `kunciKunjungan()` lebih dulu.
- `uji/uji-konkurensi.ts` menjalankan ketujuh pasangan lewat fungsi aplikasi asli, 12 putaran masing-masing.

Ketiga siklus gap lock **hanya ditemukan** karena uji itu memakai fungsi sebenarnya. Percobaan sintetis sebelumnya menguji pasangan yang sudah diduga — dan karena itu tidak akan pernah menemukan yang tidak diduga.

### 3.16 Penguncian yang terlalu luas

`buatKlaim()` semula mengunci seluruh tagihan sebulan beserta baris kunjungannya (`FOR UPDATE` atas ratusan baris) selama transaksi berjalan, menahan kasir yang kebetulan menyentuh salah satunya. Kuncinya dibuang; yang menjaga "satu tagihan hanya di satu klaim berjalan" adalah `uq_ci_billing_aktif`, dan pihak yang kalah balapan mendapat duplicate key — jawaban yang benar dengan harga yang jauh lebih murah.

Pola yang sama berlaku umum di berkas ini: **kunci unik lebih murah daripada kunci baris**, dan lebih sulit dilupakan.

---

## 4. Kesiapan integrasi TAHAP 2 (`CLAUDE.md` §6, §8)

**SatuSehat** — kolom pemetaan FHIR sudah disiapkan sejak awal agar tidak perlu migrasi struktural nanti:

| Tabel | Kolom | Resource FHIR |
|---|---|---|
| `sites` | `satusehat_org_id` | `Organization` |
| `doctor_profiles` | `satusehat_practitioner_id` | `Practitioner` |
| `patients` | `satusehat_patient_id` | `Patient` (kunci: NIK) |
| `items` | `kfa_code` | Kamus Farmasi & Alkes |
| `medical_procedures` | `icd9cm` | `Procedure` |
| `assessment_diagnoses` | `icd10_code` | `Condition` |

`satusehat_sync_logs` mencatat setiap percobaan sinkronisasi beserta payload & respons — dibutuhkan untuk menelusuri kegagalan kirim.

**BPJS FKTP** — struktur sudah disiapkan tanpa integrasi apa pun:

| Tabel | Kolom |
|---|---|
| `sites` | `kode_faskes_bpjs` |
| `doctor_profiles` | `kode_dokter_bpjs` |
| `patients` | `bpjs_kelas`, `bpjs_faskes_terdaftar`, `bpjs_status_peserta`, `bpjs_dicek_at` |
| `visits` | `bpjs_no_kunjungan`, `bpjs_jenis_kunjungan`, `bpjs_status_pulang`, `bpjs_no_rujukan` |
| `bpjs_sync_logs` | bentuknya sama dengan `satusehat_sync_logs` — masalah yang ditelusuri identik |

Sengaja **tidak** dibuat: pemanggilan API, penjadwal sinkronisasi, dan pemetaan diagnosa ke kode BPJS. Ketiganya bergantung pada spesifikasi dan kredensial yang belum ada, dan menebaknya sekarang berarti menulis kode yang harus dibuang.

**Payment Gateway** — `billing_transactions.payment_method` (`tunai` `qris` `transfer` `kartu_debit` `kartu_kredit` `bpjs` `lainnya`) dan `payment_ref` sudah tersedia sesuai `CLAUDE.md` §6, siap diisi oleh callback gateway tanpa perubahan skema.

---

## 5. Indeks penting

| Indeks | Untuk |
|---|---|
| `visits.ix_visit_worklist (site_id, tanggal, status)` | Worklist perawat/dokter/farmasi/kasir — query terpanas di sistem |
| `queues.ix_q_board (site_id, tanggal, status)` | Papan antrean (polling tiap beberapa detik) |
| `stock_movements.ix_sm_kartu (site_id, item_id, created_at)` | Kartu stok per item |
| `item_batches.ix_ib_fefo (site_id, item_id, tanggal_kadaluarsa)` | Pengambilan FEFO & monitoring kadaluarsa |
| `prescriptions.ix_rx_worklist (site_id, status, created_at)` | Antrean resep masuk di apotek |
| `icd10_codes.ft_icd` (FULLTEXT) | Autocomplete diagnosa |
| `patients.uq_pat_nik` | Deteksi pasien lama saat pendaftaran |

---

## 6. Yang belum dikerjakan (sengaja)

- **Isi master ICD-10 lengkap** — seed hanya memuat 10 kode tersering. Impor daftar resmi Kemenkes dibutuhkan sebelum UAT.
- **Retensi & arsip** `audit_logs` — perlu kebijakan partisi setelah volume nyata diketahui.
- **Replikasi antar-cabang** — MVP mengasumsikan satu instans MySQL terpusat untuk semua cabang. Bila nanti tiap cabang butuh instans lokal (mode offline), rancangan `sequences` per-site sudah menyiapkan jalannya, tetapi strategi sinkronisasi belum dirancang.
