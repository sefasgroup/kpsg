-- =====================================================================
-- Penjamin & klaim, SIPNAP, persetujuan tindakan, insiden keselamatan
-- pasien, dan "rumah" BPJS.
--
-- Empat kebutuhan berbeda, satu migrasi, karena ketiganya menyentuh tabel
-- yang sama (`patients`, `visits`, `billing_transactions`) dan memecahnya
-- jadi empat migrasi hanya menambah tiga kesempatan untuk berhenti di
-- tengah.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PENJAMIN (payers)
--
-- Sebelum ini, `cara_bayar` hanya berupa label empat pilihan. Tagihan
-- pasien perusahaan terbentuk dengan benar, tetapi tidak ada satu pun
-- yang bisa menagihkannya sebagai berkas ke perusahaannya — dan bagi
-- Klinik Pratama, penjamin (BPJS, asuransi, perusahaan) biasanya adalah
-- sumber pendapatan terbesar, bukan pasien tunai.
--
-- Global, bukan per cabang: satu kontrak perusahaan berlaku untuk seluruh
-- jaringan, sama seperti `suppliers`. Yang per cabang adalah klaimnya.
-- ---------------------------------------------------------------------
CREATE TABLE payers (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kode          VARCHAR(30)  NOT NULL,
  nama          VARCHAR(180) NOT NULL,
  jenis         ENUM('bpjs','asuransi','perusahaan') NOT NULL DEFAULT 'perusahaan',
  npwp          VARCHAR(30)  NULL,
  alamat        TEXT         NULL,
  telepon       VARCHAR(30)  NULL,
  email         VARCHAR(150) NULL,
  pic_nama      VARCHAR(150) NULL,
  pic_telepon   VARCHAR(30)  NULL,
  -- Termin pembayaran kontrak. Dasar perhitungan umur piutang: klaim yang
  -- melewati termin adalah klaim yang perlu ditagih ulang, bukan sekadar
  -- klaim yang belum dibayar.
  termin_hari   SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  -- Batas tanggung penjamin per kunjungan; 0 = tanpa batas. Selisihnya
  -- jadi tanggungan pasien di kasir.
  plafon_per_kunjungan DECIMAL(14,2) NOT NULL DEFAULT 0,
  catatan       TEXT         NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  deleted_at    DATETIME     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payer_kode (kode),
  KEY ix_payer_aktif (is_active, nama)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Tarif kontrak per penjamin — menimpa tarif global maupun tarif cabang.
--
-- Satu baris menyebut TEPAT SATU sasaran: tindakan atau barang, tidak
-- pernah keduanya dan tidak pernah kosong. CHECK-nya ada supaya baris
-- yang tidak menunjuk apa pun tidak bisa masuk sama sekali.
CREATE TABLE payer_tariffs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payer_id      BIGINT UNSIGNED NOT NULL,
  procedure_id  BIGINT UNSIGNED NULL,
  item_id       BIGINT UNSIGNED NULL,
  harga         DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (id),
  -- NULL tidak bentrok dengan NULL pada indeks unik, jadi kedua kunci ini
  -- hidup berdampingan di satu tabel tanpa saling mengganggu.
  UNIQUE KEY uq_ptar_proc (payer_id, procedure_id),
  UNIQUE KEY uq_ptar_item (payer_id, item_id),
  CONSTRAINT ck_ptar_sasaran CHECK (
    (procedure_id IS NULL) <> (item_id IS NULL)
  ),
  CONSTRAINT fk_ptar_payer FOREIGN KEY (payer_id)     REFERENCES payers(id) ON DELETE CASCADE,
  CONSTRAINT fk_ptar_proc  FOREIGN KEY (procedure_id) REFERENCES medical_procedures(id),
  CONSTRAINT fk_ptar_item  FOREIGN KEY (item_id)      REFERENCES items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Penjamin melekat pada pasien (default) DAN pada kunjungan (yang berlaku).
--
-- Keduanya perlu: kepesertaan bisa berubah, dan kunjungan yang sudah
-- ditagihkan tidak boleh berubah penjaminnya hanya karena data pasiennya
-- diperbarui setahun kemudian.
ALTER TABLE patients
  ADD COLUMN payer_id BIGINT UNSIGNED NULL AFTER jenis_pasien,
  ADD COLUMN no_anggota VARCHAR(40) NULL COMMENT 'No. peserta/kartu di penjamin ini' AFTER payer_id,
  ADD CONSTRAINT fk_pat_payer FOREIGN KEY (payer_id) REFERENCES payers(id);

ALTER TABLE visits
  ADD COLUMN payer_id BIGINT UNSIGNED NULL AFTER cara_bayar,
  ADD COLUMN no_anggota VARCHAR(40) NULL AFTER payer_id,
  ADD CONSTRAINT fk_v_payer FOREIGN KEY (payer_id) REFERENCES payers(id);
CREATE INDEX ix_v_payer ON visits (payer_id, tanggal);


-- Pembagian tanggungan pada tagihan.
--
-- `payment_method` mendapat nilai `penjamin`: tagihan yang ditanggung
-- penuh tetap ditandai LUNAS supaya gerbang farmasi (obat hanya keluar
-- setelah lunas) tidak perlu diutak-atik sama sekali. Uangnya belum
-- diterima, dan itu tercatat di klaimnya — bukan dengan menahan pasien.
ALTER TABLE billing_transactions
  MODIFY COLUMN payment_method ENUM(
    'tunai','qris','transfer','kartu_debit','kartu_kredit','bpjs','penjamin','lainnya'
  ) NULL,
  ADD COLUMN payer_id BIGINT UNSIGNED NULL AFTER visit_id,
  ADD COLUMN tanggung_penjamin DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER total,
  ADD COLUMN tanggung_pasien   DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER tanggung_penjamin,
  ADD CONSTRAINT fk_bt_payer FOREIGN KEY (payer_id) REFERENCES payers(id);
CREATE INDEX ix_bt_payer ON billing_transactions (payer_id, status);


-- ---------------------------------------------------------------------
-- 2. KLAIM KOLEKTIF & PIUTANG
--
-- Piutang SENGAJA tidak dibuat sebagai tabel tersendiri. Ia diturunkan
-- dari klaim dan pembayarannya — pola yang sama dengan stok, yang saldonya
-- selalu bisa dihitung ulang dari `stock_movements`. Angka piutang yang
-- disimpan terpisah adalah angka yang bisa menyimpang dari sumbernya, dan
-- tidak ada cara mengetahui mana yang benar.
-- ---------------------------------------------------------------------
CREATE TABLE claims (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id         BIGINT UNSIGNED NOT NULL,
  payer_id        BIGINT UNSIGNED NOT NULL,
  no_klaim        VARCHAR(40) NOT NULL,
  periode_dari    DATE NOT NULL,
  periode_sampai  DATE NOT NULL,
  status          ENUM('draft','diajukan','disetujui','lunas','batal')
                    NOT NULL DEFAULT 'draft',
  total_diajukan  DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_disetujui DECIMAL(14,2) NOT NULL DEFAULT 0,
  diajukan_at     DATETIME NULL,
  diajukan_by     BIGINT UNSIGNED NULL,
  -- Jatuh tempo dihitung dari tanggal pengajuan + termin penjamin, dan
  -- DIBEKUKAN di sini: termin kontrak bisa berubah, umur piutang yang
  -- sudah berjalan tidak boleh ikut berubah karenanya.
  jatuh_tempo     DATE NULL,
  alasan_batal    VARCHAR(255) NULL,
  catatan         TEXT NULL,
  created_by      BIGINT UNSIGNED NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_claim_no (site_id, no_klaim),
  KEY ix_claim_worklist (site_id, status, periode_dari),
  KEY ix_claim_payer (payer_id, status),
  CONSTRAINT fk_claim_site  FOREIGN KEY (site_id)  REFERENCES sites(id),
  CONSTRAINT fk_claim_payer FOREIGN KEY (payer_id) REFERENCES payers(id),
  CONSTRAINT fk_claim_user  FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_claim_ajuan FOREIGN KEY (diajukan_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Satu tagihan hanya boleh berada di satu klaim BERJALAN.
--
-- Pola `visit_aktif` pada `prescriptions` diulang di sini dengan sengaja:
-- di sana `UNIQUE (visit_id)` polos membuat resep yang dibatalkan mengunci
-- kunjungannya selamanya. Kalau kunci di bawah ini juga polos, tagihan
-- yang klaimnya dibatalkan tidak akan pernah bisa diklaim ulang — dan
-- klaim memang sering ditolak lalu diajukan lagi.
CREATE TABLE claim_items (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  claim_id        BIGINT UNSIGNED NOT NULL,
  billing_id      BIGINT UNSIGNED NOT NULL,
  nilai_diajukan  DECIMAL(14,2) NOT NULL DEFAULT 0,
  nilai_disetujui DECIMAL(14,2) NULL COMMENT 'NULL = belum diverifikasi penjamin',
  alasan_koreksi  VARCHAR(255) NULL,
  is_void         TINYINT(1) NOT NULL DEFAULT 0,
  billing_aktif   BIGINT UNSIGNED
                    GENERATED ALWAYS AS (IF(is_void = 0, billing_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ci_billing_aktif (billing_aktif),
  KEY ix_ci_claim (claim_id, is_void),
  CONSTRAINT fk_ci_claim   FOREIGN KEY (claim_id)   REFERENCES claims(id) ON DELETE CASCADE,
  CONSTRAINT fk_ci_billing FOREIGN KEY (billing_id) REFERENCES billing_transactions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Pembayaran klaim boleh dicicil: penjamin sering membayar sebagian dulu.
CREATE TABLE claim_payments (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  claim_id    BIGINT UNSIGNED NOT NULL,
  tanggal     DATE NOT NULL,
  jumlah      DECIMAL(14,2) NOT NULL,
  metode      ENUM('transfer','tunai','cek','lainnya') NOT NULL DEFAULT 'transfer',
  ref         VARCHAR(80) NULL COMMENT 'No. bukti transfer / giro',
  catatan     VARCHAR(255) NULL,
  created_by  BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_cp_claim (claim_id, tanggal),
  CONSTRAINT ck_cp_positif CHECK (jumlah > 0),
  CONSTRAINT fk_cp_claim FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE,
  CONSTRAINT fk_cp_user  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------
-- 3. SIPNAP — narkotika & psikotropika
--
-- `is_narkotika` sudah ada; pasangannya tidak. Laporan bulanan narkotika
-- dan psikotropika ke Kemenkes adalah kewajiban hukum apotek, dan tanpa
-- penggolongan yang lengkap laporan itu tidak bisa disusun sama sekali.
--
-- Angkanya sendiri TIDAK ditabelkan: saldo awal, masuk, keluar, dan saldo
-- akhir semuanya sudah terkandung di `stock_movements`. Yang dibutuhkan
-- hanya penggolongan dan nomor izin edarnya.
-- ---------------------------------------------------------------------
ALTER TABLE items
  ADD COLUMN is_psikotropika TINYINT(1) NOT NULL DEFAULT 0 AFTER is_narkotika,
  ADD COLUMN golongan_narkotika ENUM('I','II','III') NULL
    COMMENT 'Golongan menurut UU Narkotika; wajib pada laporan SIPNAP' AFTER is_psikotropika,
  ADD COLUMN no_izin_edar VARCHAR(40) NULL COMMENT 'NIE BPOM' AFTER golongan_narkotika;

CREATE INDEX ix_items_sipnap ON items (is_narkotika, is_psikotropika);


-- ---------------------------------------------------------------------
-- 4. PERSETUJUAN TINDAKAN (informed & general consent)
--
-- Standar akreditasi klinik mensyaratkan persetujuan terdokumentasi.
-- `medical_certificates` hanya menangani dokumen KELUAR (surat sakit,
-- rujukan); persetujuan adalah dokumen MASUK dan tidak punya tempat.
--
-- Isi persetujuan disimpan sebagai teks utuh, bukan rujukan ke templat:
-- kalimat yang ditandatangani pasien tahun ini harus tetap terbaca apa
-- adanya meski templatnya diubah tahun depan.
-- ---------------------------------------------------------------------
CREATE TABLE consents (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id         BIGINT UNSIGNED NOT NULL,
  visit_id        BIGINT UNSIGNED NOT NULL,
  patient_id      BIGINT UNSIGNED NOT NULL,
  jenis           ENUM('umum','tindakan','penolakan','privasi') NOT NULL,
  judul           VARCHAR(180) NOT NULL,
  isi             TEXT NOT NULL COMMENT 'Kalimat persetujuan apa adanya saat ditandatangani',
  -- Untuk consent tindakan: apa yang dijelaskan sebelum pasien setuju.
  penjelasan_oleh BIGINT UNSIGNED NULL COMMENT 'Petugas yang memberi penjelasan',
  procedure_id    BIGINT UNSIGNED NULL,
  -- Penandatangan bisa bukan pasiennya sendiri (anak, tidak sadar).
  penandatangan   VARCHAR(150) NOT NULL,
  hubungan        VARCHAR(60) NOT NULL DEFAULT 'Pasien sendiri',
  saksi_nama      VARCHAR(150) NULL,
  status          ENUM('setuju','menolak','dibatalkan') NOT NULL DEFAULT 'setuju',
  alasan_batal    VARCHAR(255) NULL,
  ditandatangani_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by      BIGINT UNSIGNED NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_consent_visit (visit_id, jenis),
  KEY ix_consent_patient (patient_id, ditandatangani_at),
  CONSTRAINT fk_cons_site    FOREIGN KEY (site_id)    REFERENCES sites(id),
  CONSTRAINT fk_cons_visit   FOREIGN KEY (visit_id)   REFERENCES visits(id),
  CONSTRAINT fk_cons_patient FOREIGN KEY (patient_id) REFERENCES patients(id),
  CONSTRAINT fk_cons_proc    FOREIGN KEY (procedure_id) REFERENCES medical_procedures(id),
  CONSTRAINT fk_cons_jelas   FOREIGN KEY (penjelasan_oleh) REFERENCES users(id),
  CONSTRAINT fk_cons_user    FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------
-- 5. INSIDEN KESELAMATAN PASIEN (IKP)
--
-- Pelaporan KTD/KNC/KPC/KTC/sentinel adalah syarat akreditasi klinik.
--
-- `pelapor_id` boleh NULL — pelaporan anonim harus mungkin. Budaya
-- keselamatan pasien runtuh begitu melapor terasa seperti mengaku salah,
-- dan sistem yang mewajibkan nama pelapor memastikan hal itu terjadi.
-- ---------------------------------------------------------------------
CREATE TABLE patient_safety_incidents (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id         BIGINT UNSIGNED NOT NULL,
  no_ikp          VARCHAR(40) NOT NULL,
  visit_id        BIGINT UNSIGNED NULL COMMENT 'NULL bila insiden tidak terkait kunjungan tertentu',
  patient_id      BIGINT UNSIGNED NULL,
  tanggal         DATE NOT NULL,
  waktu           TIME NULL,
  lokasi          VARCHAR(120) NOT NULL,
  -- KPC: kondisi berpotensi cedera · KNC: nyaris cedera (belum terpapar)
  -- KTC: cedera tidak terjadi (terpapar, tidak cedera) · KTD: tidak
  -- diharapkan (cedera terjadi) · sentinel: kematian/cedera permanen.
  jenis           ENUM('kpc','knc','ktc','ktd','sentinel') NOT NULL,
  -- Matriks grading nasional (biru/hijau/kuning/merah) menentukan siapa
  -- yang wajib menindaklanjuti dan seberapa cepat.
  grading         ENUM('biru','hijau','kuning','merah') NULL,
  kronologi       TEXT NOT NULL,
  dampak          TEXT NULL,
  tindakan_segera TEXT NULL,
  analisis        TEXT NULL COMMENT 'Akar masalah (RCA) untuk grading kuning/merah',
  rekomendasi     TEXT NULL,
  status          ENUM('baru','investigasi','selesai','ditutup') NOT NULL DEFAULT 'baru',
  pelapor_id      BIGINT UNSIGNED NULL COMMENT 'NULL = pelaporan anonim',
  ditutup_by      BIGINT UNSIGNED NULL,
  ditutup_at      DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ikp_no (site_id, no_ikp),
  KEY ix_ikp_worklist (site_id, status, tanggal),
  KEY ix_ikp_rekap (site_id, tanggal, jenis),
  CONSTRAINT fk_ikp_site    FOREIGN KEY (site_id)    REFERENCES sites(id),
  CONSTRAINT fk_ikp_visit   FOREIGN KEY (visit_id)   REFERENCES visits(id),
  CONSTRAINT fk_ikp_patient FOREIGN KEY (patient_id) REFERENCES patients(id),
  CONSTRAINT fk_ikp_pelapor FOREIGN KEY (pelapor_id) REFERENCES users(id),
  CONSTRAINT fk_ikp_tutup   FOREIGN KEY (ditutup_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------
-- 6. "RUMAH" BPJS — struktur saja, tanpa integrasi
--
-- Yang dibangun di sini hanya tempat menaruh data supaya aktivasi nanti
-- tidak menuntut migrasi struktural — pola yang sama dengan kolom FHIR
-- SatuSehat yang sudah disiapkan sejak awal.
--
-- Sengaja TIDAK dibuat: pemanggilan API, penjadwal sinkronisasi, dan
-- pemetaan diagnosa ke kode BPJS. Ketiganya bergantung pada spesifikasi
-- dan kredensial yang belum ada, dan menebaknya sekarang berarti menulis
-- kode yang harus dibuang.
-- ---------------------------------------------------------------------
ALTER TABLE sites
  ADD COLUMN kode_faskes_bpjs VARCHAR(20) NULL
    COMMENT 'Kode FKTP di BPJS — dipakai P-Care & Antrean FKTP' AFTER satusehat_org_id;

ALTER TABLE doctor_profiles
  ADD COLUMN kode_dokter_bpjs VARCHAR(20) NULL
    COMMENT 'Kode dokter di P-Care' AFTER satusehat_practitioner_id;

ALTER TABLE patients
  ADD COLUMN bpjs_kelas ENUM('1','2','3') NULL AFTER no_anggota,
  ADD COLUMN bpjs_faskes_terdaftar VARCHAR(180) NULL
    COMMENT 'FKTP tempat peserta terdaftar; bukan tentu klinik ini' AFTER bpjs_kelas,
  ADD COLUMN bpjs_status_peserta ENUM('aktif','nonaktif','belum_dicek') NULL DEFAULT 'belum_dicek'
    COMMENT 'Hasil cek eligibilitas terakhir' AFTER bpjs_faskes_terdaftar,
  ADD COLUMN bpjs_dicek_at DATETIME NULL AFTER bpjs_status_peserta;

ALTER TABLE visits
  ADD COLUMN bpjs_no_kunjungan VARCHAR(40) NULL
    COMMENT 'No. kunjungan yang dikembalikan P-Care' AFTER no_anggota,
  ADD COLUMN bpjs_jenis_kunjungan ENUM('sakit','sehat','kia','kb') NULL
    COMMENT 'Klasifikasi kunjungan FKTP untuk pelaporan kapitasi' AFTER bpjs_no_kunjungan,
  ADD COLUMN bpjs_status_pulang ENUM('berobat_jalan','rujuk_lanjut','meninggal','kontrol')
    NULL AFTER bpjs_jenis_kunjungan,
  ADD COLUMN bpjs_no_rujukan VARCHAR(40) NULL AFTER bpjs_status_pulang;

-- Log sinkronisasi memakai bentuk yang sama dengan `satusehat_sync_logs`,
-- karena masalah yang harus ditelusuri persis sama: kiriman mana yang
-- gagal, dengan payload apa, dan dijawab apa.
CREATE TABLE bpjs_sync_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id     BIGINT UNSIGNED NULL,
  entity      VARCHAR(40) NOT NULL COMMENT 'peserta | kunjungan | rujukan | antrean',
  entity_id   BIGINT UNSIGNED NULL,
  aksi        VARCHAR(40) NOT NULL,
  status      ENUM('sukses','gagal','tertunda') NOT NULL DEFAULT 'tertunda',
  http_status SMALLINT UNSIGNED NULL,
  request     JSON NULL,
  response    JSON NULL,
  pesan       VARCHAR(255) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_bsl_entity (entity, entity_id),
  KEY ix_bsl_gagal (status, created_at),
  CONSTRAINT fk_bsl_site FOREIGN KEY (site_id) REFERENCES sites(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
