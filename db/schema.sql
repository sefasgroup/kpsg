-- =====================================================================
--  SIM KLINIK — KLINIK PRATAMA SAHABAT GAMMA
--  Skema MySQL 8.0+ · InnoDB · utf8mb4
--  Turunan dari CLAUDE.md v2.5 §7
--
--  Konvensi:
--   - PK  : BIGINT UNSIGNED AUTO_INCREMENT bernama `id`
--   - FK  : <tabel_singular>_id
--   - Multi-site: setiap tabel operasional membawa `site_id` (WAJIB difilter
--     di setiap query — lihat docs/DATABASE.md §Multi-site)
--   - Waktu: DATETIME (aplikasi menyimpan waktu lokal cabang, lihat sites.timezone)
--   - Uang : DECIMAL(14,2) — tidak pernah FLOAT
--   - Rekam medis TIDAK PERNAH di-hard delete; hanya dibatalkan + audit log
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS `simklinik_kpsg`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `simklinik_kpsg`;


-- =====================================================================
-- 1. SETUP & IDENTITAS (CLAUDE.md §7 — sites & users)
-- =====================================================================

CREATE TABLE sites (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kode              VARCHAR(20)     NOT NULL COMMENT 'Prefix nomor dokumen, mis. JKS',
  nama              VARCHAR(150)    NOT NULL,
  nama_legal        VARCHAR(200)    NULL COMMENT 'Nama badan hukum untuk kop surat',
  no_izin_klinik    VARCHAR(100)    NULL,
  npwp              VARCHAR(30)     NULL,
  alamat            TEXT            NULL,
  kelurahan         VARCHAR(100)    NULL,
  kecamatan         VARCHAR(100)    NULL,
  kota              VARCHAR(100)    NULL,
  provinsi          VARCHAR(100)    NULL,
  kode_pos          VARCHAR(10)     NULL,
  telepon           VARCHAR(30)     NULL,
  email             VARCHAR(150)    NULL,
  logo_path         VARCHAR(255)    NULL COMMENT 'Override logo per cabang; default aset KPSG',
  header_cetak      TEXT            NULL COMMENT 'Baris tambahan kop surat',
  footer_cetak      TEXT            NULL,
  timezone          VARCHAR(64)     NOT NULL DEFAULT 'Asia/Jakarta',
  kode_faskes_bpjs VARCHAR(20) NULL COMMENT 'Kode FKTP di BPJS (P-Care & Antrean FKTP)',
  satusehat_org_id  VARCHAR(64)     NULL COMMENT 'FHIR Organization ID (TAHAP 2)',
  is_active         TINYINT(1)      NOT NULL DEFAULT 1,
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at        DATETIME        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sites_kode (kode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE roles (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(40)  NOT NULL COMMENT '7 role tetap — lihat seed.sql',
  nama        VARCHAR(100) NOT NULL,
  deskripsi   VARCHAR(255) NULL,
  is_system   TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '1 = tidak boleh dihapus',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE permissions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(80)  NOT NULL COMMENT 'mis. prescription.create, billing.pay',
  modul       VARCHAR(40)  NOT NULL,
  deskripsi   VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_permissions_code (code),
  KEY ix_permissions_modul (modul)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE role_permissions (
  role_id       BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role       FOREIGN KEY (role_id)       REFERENCES roles(id)       ON DELETE CASCADE,
  CONSTRAINT fk_rp_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE users (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id        BIGINT UNSIGNED NULL COMMENT 'NULL hanya untuk Super Admin (lintas cabang)',
  role_id        BIGINT UNSIGNED NOT NULL,
  nip            VARCHAR(40)  NULL,
  nama           VARCHAR(150) NOT NULL,
  username       VARCHAR(60)  NOT NULL,
  email          VARCHAR(150) NULL,
  password_hash  VARCHAR(255) NOT NULL,
  telepon        VARCHAR(30)  NULL,
  foto_path      VARCHAR(255) NULL,
  must_change_pw TINYINT(1)   NOT NULL DEFAULT 1,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at  DATETIME     NULL,
  created_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at     DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  KEY ix_users_site_role (site_id, role_id, is_active),
  CONSTRAINT fk_users_site FOREIGN KEY (site_id) REFERENCES sites(id),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Penugasan lintas cabang (mis. dokter praktik di 2 cabang)
CREATE TABLE user_sites (
  user_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, site_id),
  CONSTRAINT fk_us_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_us_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE doctor_profiles (
  user_id                   BIGINT UNSIGNED NOT NULL,
  no_str                    VARCHAR(60)  NULL COMMENT 'Surat Tanda Registrasi',
  no_sip                    VARCHAR(60)  NULL COMMENT 'Surat Izin Praktik',
  sip_berlaku_sampai        DATE         NULL,
  spesialisasi              VARCHAR(100) NULL,
  gelar_depan               VARCHAR(30)  NULL,
  gelar_belakang            VARCHAR(30)  NULL,
  tarif_konsultasi          DECIMAL(14,2) NOT NULL DEFAULT 0,
  ttd_path                  VARCHAR(255) NULL COMMENT 'Tanda tangan untuk dokumen cetak',
  kode_dokter_bpjs VARCHAR(20) NULL COMMENT 'Kode dokter di P-Care',
  satusehat_practitioner_id VARCHAR(64)  NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_dp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Penomoran dokumen per cabang per periode (no_rm, no_visit, no_resep, no_invoice, ...)
CREATE TABLE sequences (
  site_id     BIGINT UNSIGNED NOT NULL,
  seq_key     VARCHAR(40)  NOT NULL COMMENT 'rm | visit | resep | invoice | lab | surat | queue',
  periode     VARCHAR(10)  NOT NULL DEFAULT '-' COMMENT 'YYYY, YYYYMM, YYYYMMDD, atau "-" bila berkelanjutan',
  last_number BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, seq_key, periode),
  CONSTRAINT fk_seq_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- 2. MANAJEMEN HR (CLAUDE.md §4 — Jadwal, Absensi, Dokter Pengganti)
-- =====================================================================

CREATE TABLE polis (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id     BIGINT UNSIGNED NULL COMMENT 'NULL = master global',
  kode        VARCHAR(20)  NOT NULL,
  nama        VARCHAR(100) NOT NULL,
  prefix_antrean CHAR(2)   NOT NULL DEFAULT 'A',
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_polis (site_id, kode),
  CONSTRAINT fk_polis_site FOREIGN KEY (site_id) REFERENCES sites(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE doctor_schedules (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id      BIGINT UNSIGNED NOT NULL,
  doctor_id    BIGINT UNSIGNED NOT NULL,
  poli_id      BIGINT UNSIGNED NOT NULL,
  hari         TINYINT UNSIGNED NOT NULL COMMENT '1=Senin .. 7=Minggu',
  jam_mulai    TIME NOT NULL,
  jam_selesai  TIME NOT NULL,
  kuota        SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 = tanpa batas',
  berlaku_dari DATE NULL,
  berlaku_sampai DATE NULL,
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  created_by   BIGINT UNSIGNED NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_ds_lookup (site_id, hari, is_active),
  KEY ix_ds_doctor (doctor_id, hari),
  CONSTRAINT fk_ds_site   FOREIGN KEY (site_id)   REFERENCES sites(id),
  CONSTRAINT fk_ds_doctor FOREIGN KEY (doctor_id) REFERENCES users(id),
  CONSTRAINT fk_ds_poli   FOREIGN KEY (poli_id)   REFERENCES polis(id),
  CONSTRAINT ck_ds_jam CHECK (jam_selesai > jam_mulai)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Pengecualian jadwal + penetapan DOKTER PENGGANTI (CLAUDE.md §2.1 poin 2)
CREATE TABLE schedule_exceptions (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id              BIGINT UNSIGNED NOT NULL,
  doctor_schedule_id   BIGINT UNSIGNED NULL,
  doctor_id            BIGINT UNSIGNED NOT NULL COMMENT 'Dokter yang berhalangan',
  tanggal              DATE NOT NULL,
  jenis                ENUM('libur','cuti','izin','sakit','ganti_jam','tambahan') NOT NULL,
  substitute_doctor_id BIGINT UNSIGNED NULL COMMENT 'Dokter pengganti',
  jam_mulai            TIME NULL,
  jam_selesai          TIME NULL,
  alasan               VARCHAR(255) NULL,
  status               ENUM('pending','disetujui','ditolak') NOT NULL DEFAULT 'pending',
  approved_by          BIGINT UNSIGNED NULL,
  approved_at          DATETIME NULL,
  created_by           BIGINT UNSIGNED NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_se_lookup (site_id, tanggal, status),
  CONSTRAINT fk_se_site      FOREIGN KEY (site_id)   REFERENCES sites(id),
  CONSTRAINT fk_se_doctor    FOREIGN KEY (doctor_id) REFERENCES users(id),
  CONSTRAINT fk_se_sub       FOREIGN KEY (substitute_doctor_id) REFERENCES users(id),
  CONSTRAINT fk_se_schedule  FOREIGN KEY (doctor_schedule_id)   REFERENCES doctor_schedules(id),
  CONSTRAINT ck_se_sub CHECK (substitute_doctor_id IS NULL OR substitute_doctor_id <> doctor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE leave_requests (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id       BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  jenis         ENUM('cuti_tahunan','izin','sakit','cuti_melahirkan','lainnya') NOT NULL,
  tanggal_mulai DATE NOT NULL,
  tanggal_akhir DATE NOT NULL,
  jumlah_hari   SMALLINT UNSIGNED NOT NULL,
  alasan        TEXT NULL,
  lampiran_path VARCHAR(255) NULL,
  status        ENUM('pending','disetujui','ditolak','dibatalkan') NOT NULL DEFAULT 'pending',
  approved_by   BIGINT UNSIGNED NULL,
  approved_at   DATETIME NULL,
  catatan_approval VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_lr_user (user_id, status),
  KEY ix_lr_site (site_id, tanggal_mulai),
  CONSTRAINT fk_leave_site FOREIGN KEY (site_id) REFERENCES sites(id),
  CONSTRAINT fk_leave_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT ck_leave_tanggal CHECK (tanggal_akhir >= tanggal_mulai)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE attendances (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id     BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  tanggal     DATE NOT NULL,
  jam_masuk   DATETIME NULL,
  jam_pulang  DATETIME NULL,
  status      ENUM('hadir','terlambat','izin','sakit','cuti','alpha','libur') NOT NULL DEFAULT 'hadir',
  metode      ENUM('web','kiosk','manual') NOT NULL DEFAULT 'web',
  catatan     VARCHAR(255) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_att (user_id, tanggal),
  KEY ix_att_site (site_id, tanggal),
  CONSTRAINT fk_att_site FOREIGN KEY (site_id) REFERENCES sites(id),
  CONSTRAINT fk_att_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- 3. MASTER DATA KLINIS
-- =====================================================================

CREATE TABLE icd10_codes (
  code      VARCHAR(10)  NOT NULL,
  nama_id   VARCHAR(255) NOT NULL,
  nama_en   VARCHAR(255) NULL,
  bab       VARCHAR(120) NULL,
  is_active TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (code),
  KEY ix_icd_nama (nama_id(64)),
  FULLTEXT KEY ft_icd (nama_id, nama_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE medical_procedures (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kode       VARCHAR(30)  NOT NULL,
  nama       VARCHAR(150) NOT NULL,
  kategori   VARCHAR(60)  NULL,
  -- Tindakan konsultasi: ter-select otomatis di form dokter dan SATU-SATUNYA
  -- tindakan yang boleh didiskon. Biaya konsultasi sepenuhnya lewat sini —
  -- `doctor_profiles.tarif_konsultasi` tidak lagi menagih otomatis.
  is_konsultasi TINYINT(1) NOT NULL DEFAULT 0,
  tarif      DECIMAL(14,2) NOT NULL DEFAULT 0,
  icd9cm     VARCHAR(10)  NULL COMMENT 'Untuk SatuSehat (TAHAP 2)',
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mp_kode (kode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Override tarif per cabang (opsional; jatuh ke tarif global bila tidak ada baris)
CREATE TABLE site_procedure_tariffs (
  site_id      BIGINT UNSIGNED NOT NULL,
  procedure_id BIGINT UNSIGNED NOT NULL,
  tarif        DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (site_id, procedure_id),
  CONSTRAINT fk_spt_site FOREIGN KEY (site_id)      REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_spt_proc FOREIGN KEY (procedure_id) REFERENCES medical_procedures(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE lab_panels (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kode      VARCHAR(30)  NOT NULL,
  nama      VARCHAR(150) NOT NULL,
  kategori  VARCHAR(60)  NULL COMMENT 'Hematologi | Kimia Klinik | Urinalisa | Imunoserologi',
  tarif     DECIMAL(14,2) NOT NULL DEFAULT 0,
  is_active TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lp_kode (kode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE lab_parameters (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  panel_id      BIGINT UNSIGNED NOT NULL,
  kode          VARCHAR(30)  NOT NULL,
  nama          VARCHAR(150) NOT NULL,
  satuan        VARCHAR(30)  NULL,
  tipe_nilai    ENUM('numerik','teks','pilihan') NOT NULL DEFAULT 'numerik',
  pilihan       JSON NULL COMMENT 'Untuk tipe_nilai = pilihan, mis. ["Negatif","Positif"]',
  ref_low       DECIMAL(12,4) NULL,
  ref_high      DECIMAL(12,4) NULL,
  ref_teks      VARCHAR(100)  NULL COMMENT 'Nilai rujukan yang dicetak apa adanya',
  kritis_low    DECIMAL(12,4) NULL,
  kritis_high   DECIMAL(12,4) NULL,
  urutan        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  -- Parameter DINONAKTIFKAN, tidak dihapus: `lab_results.parameter_id`
  -- adalah foreign key tanpa ON DELETE, sehingga penghapusan akan ditolak
  -- database atau memusnahkan hasil pemeriksaan pasien lama.
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lpar (panel_id, kode),
  CONSTRAINT fk_lpar_panel FOREIGN KEY (panel_id) REFERENCES lab_panels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- 4. KATALOG & INVENTORI (obat, bahan racikan, BMHP — satu katalog)
--    Alasan: BMHP perawat butuh potong stok + masuk billing persis
--    seperti obat (CLAUDE.md §3.1 "Automasi Sistem Backend").
-- =====================================================================

CREATE TABLE item_categories (
  id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nama     VARCHAR(100) NOT NULL,
  tipe     ENUM('obat','bmhp','alkes') NOT NULL DEFAULT 'obat',
  PRIMARY KEY (id),
  UNIQUE KEY uq_ic (nama, tipe)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE suppliers (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kode      VARCHAR(30)  NOT NULL,
  nama      VARCHAR(150) NOT NULL,
  kontak    VARCHAR(100) NULL,
  telepon   VARCHAR(30)  NULL,
  alamat    TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sup_kode (kode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE items (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kode              VARCHAR(30)  NOT NULL,
  tipe              ENUM('obat','bmhp','alkes') NOT NULL DEFAULT 'obat',
  nama              VARCHAR(180) NOT NULL,
  nama_generik      VARCHAR(180) NULL,
  kandungan         VARCHAR(255) NULL,
  category_id       BIGINT UNSIGNED NULL,
  bentuk_sediaan    VARCHAR(40)  NULL COMMENT 'Tablet | Kapsul | Sirup | Salep | Injeksi | ...',
  satuan_dasar      VARCHAR(20)  NOT NULL DEFAULT 'pcs' COMMENT 'Satuan penyimpanan stok',
  satuan_kemasan    VARCHAR(20)  NULL COMMENT 'Box, Strip, Botol',
  isi_per_kemasan   INT UNSIGNED NOT NULL DEFAULT 1,
  hpp               DECIMAL(14,2) NOT NULL DEFAULT 0,
  harga_jual        DECIMAL(14,2) NOT NULL DEFAULT 0,
  min_stock         INT NOT NULL DEFAULT 0,
  is_racikable      TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = boleh dipakai sebagai bahan racikan',
  is_prekursor      TINYINT(1) NOT NULL DEFAULT 0,
  is_narkotika      TINYINT(1) NOT NULL DEFAULT 0,
  -- Penggolongan wajib untuk laporan SIPNAP bulanan ke Kemenkes.
  -- Angkanya sendiri tidak ditabelkan: saldo & mutasi dihitung dari
  -- `stock_movements`, sumber kebenaran tunggal stok (§3.3).
  is_psikotropika   TINYINT(1) NOT NULL DEFAULT 0,
  golongan_narkotika ENUM('I','II','III') NULL,
  no_izin_edar      VARCHAR(40) NULL COMMENT 'NIE BPOM',
  butuh_resep       TINYINT(1) NOT NULL DEFAULT 1,
  kfa_code          VARCHAR(40) NULL COMMENT 'Kamus Farmasi & Alkes (SatuSehat, TAHAP 2)',
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at        DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_items_kode (kode),
  KEY ix_items_tipe (tipe, is_active),
  KEY ix_items_nama (nama(64)),
  CONSTRAINT fk_items_cat FOREIGN KEY (category_id) REFERENCES item_categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Saldo stok per cabang (denormalisasi terkontrol; kebenaran ada di stock_movements)
CREATE TABLE item_stocks (
  site_id      BIGINT UNSIGNED NOT NULL,
  item_id      BIGINT UNSIGNED NOT NULL,
  qty_on_hand  DECIMAL(14,3) NOT NULL DEFAULT 0,
  -- Dikunci untuk resep yang sudah divalidasi dan menunggu dibayar/diambil.
  -- `qty_on_hand` TIDAK dikurangi saat reservasi — barangnya masih di rak.
  -- Tersedia untuk pasien lain = qty_on_hand - qty_reserved.
  qty_reserved DECIMAL(14,3) NOT NULL DEFAULT 0,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, item_id),
  CONSTRAINT ck_is_reserved CHECK (qty_reserved >= 0),
  CONSTRAINT fk_is_site FOREIGN KEY (site_id) REFERENCES sites(id),
  CONSTRAINT fk_is_item FOREIGN KEY (item_id) REFERENCES items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Batch/lot untuk monitoring kadaluarsa & FEFO
CREATE TABLE item_batches (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id       BIGINT UNSIGNED NOT NULL,
  item_id       BIGINT UNSIGNED NOT NULL,
  no_batch      VARCHAR(60) NULL,
  tanggal_kadaluarsa DATE NULL,
  qty           DECIMAL(14,3) NOT NULL DEFAULT 0,
  hpp           DECIMAL(14,2) NOT NULL DEFAULT 0,
  supplier_id   BIGINT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_ib_fefo (site_id, item_id, tanggal_kadaluarsa),
  KEY ix_ib_exp  (site_id, tanggal_kadaluarsa),
  CONSTRAINT fk_ib_site FOREIGN KEY (site_id) REFERENCES sites(id),
  CONSTRAINT fk_ib_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT fk_ib_sup  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- KARTU STOK — sumber kebenaran seluruh pergerakan stok.
-- Setiap pemotongan (resep paten, bahan racikan, BMHP perawat) WAJIB lewat sini.
CREATE TABLE stock_movements (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id     BIGINT UNSIGNED NOT NULL,
  item_id     BIGINT UNSIGNED NOT NULL,
  batch_id    BIGINT UNSIGNED NULL,
  jenis       ENUM(
                'masuk_pembelian','masuk_retur','masuk_koreksi','masuk_opname',
                'keluar_resep','keluar_racikan','keluar_bmhp','keluar_kadaluarsa',
                'keluar_rusak','keluar_koreksi','keluar_opname'
              ) NOT NULL,
  qty         DECIMAL(14,3) NOT NULL COMMENT 'Selalu positif; arah ditentukan oleh `jenis`',
  qty_delta   DECIMAL(14,3) NOT NULL COMMENT 'Bertanda: + masuk, - keluar',
  qty_after   DECIMAL(14,3) NOT NULL COMMENT 'Saldo setelah pergerakan',
  hpp         DECIMAL(14,2) NOT NULL DEFAULT 0,
  ref_type    VARCHAR(40) NULL COMMENT 'prescription_item | racikan_ingredient | nurse_bmhp | purchase | opname',
  ref_id      BIGINT UNSIGNED NULL,
  catatan     VARCHAR(255) NULL,
  created_by  BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_sm_kartu (site_id, item_id, created_at),
  -- Kartu stok satu item memakai ix_sm_kartu. Laporan yang menyapu
  -- seluruh cabang pada satu rentang tanggal tidak bisa memakainya
  -- (item_id tidak ada di kondisinya), jadi perlu indeksnya sendiri.
  KEY ix_sm_periode (site_id, created_at),
  KEY ix_sm_ref (ref_type, ref_id),
  CONSTRAINT fk_sm_site FOREIGN KEY (site_id) REFERENCES sites(id),
  CONSTRAINT fk_sm_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT fk_sm_batch FOREIGN KEY (batch_id) REFERENCES item_batches(id),
  CONSTRAINT fk_sm_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE purchases (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id       BIGINT UNSIGNED NOT NULL,
  no_penerimaan VARCHAR(40) NOT NULL,
  supplier_id   BIGINT UNSIGNED NULL,
  no_faktur     VARCHAR(60) NULL,
  tanggal       DATE NOT NULL,
  subtotal      DECIMAL(14,2) NOT NULL DEFAULT 0,
  diskon        DECIMAL(14,2) NOT NULL DEFAULT 0,
  ppn           DECIMAL(14,2) NOT NULL DEFAULT 0,
  total         DECIMAL(14,2) NOT NULL DEFAULT 0,
  status        ENUM('draft','diterima','batal') NOT NULL DEFAULT 'draft',
  catatan       TEXT NULL,
  created_by    BIGINT UNSIGNED NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pur_no (site_id, no_penerimaan),
  CONSTRAINT fk_pur_site FOREIGN KEY (site_id) REFERENCES sites(id),
  CONSTRAINT fk_pur_sup  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_pur_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE purchase_items (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  purchase_id  BIGINT UNSIGNED NOT NULL,
  item_id      BIGINT UNSIGNED NOT NULL,
  no_batch     VARCHAR(60) NULL,
  tanggal_kadaluarsa DATE NULL,
  qty          DECIMAL(14,3) NOT NULL,
  harga_satuan DECIMAL(14,2) NOT NULL DEFAULT 0,
  subtotal     DECIMAL(14,2) NOT NULL DEFAULT 0,
  batch_id     BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY ix_pi_purchase (purchase_id),
  CONSTRAINT fk_pi_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
  CONSTRAINT fk_pi_item     FOREIGN KEY (item_id)     REFERENCES items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE stock_opnames (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id     BIGINT UNSIGNED NOT NULL,
  no_opname   VARCHAR(40) NOT NULL,
  tanggal     DATE NOT NULL,
  status      ENUM('draft','final','batal') NOT NULL DEFAULT 'draft',
  catatan     TEXT NULL,
  created_by  BIGINT UNSIGNED NOT NULL,
  finalized_by BIGINT UNSIGNED NULL,
  finalized_at DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_so_no (site_id, no_opname),
  CONSTRAINT fk_so_site FOREIGN KEY (site_id) REFERENCES sites(id),
  CONSTRAINT fk_so_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE stock_opname_items (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  opname_id    BIGINT UNSIGNED NOT NULL,
  item_id      BIGINT UNSIGNED NOT NULL,
  qty_sistem   DECIMAL(14,3) NOT NULL,
  qty_fisik    DECIMAL(14,3) NOT NULL,
  selisih      DECIMAL(14,3) AS (qty_fisik - qty_sistem) STORED,
  catatan      VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_soi (opname_id, item_id),
  CONSTRAINT fk_soi_opname FOREIGN KEY (opname_id) REFERENCES stock_opnames(id) ON DELETE CASCADE,
  CONSTRAINT fk_soi_item   FOREIGN KEY (item_id)   REFERENCES items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- 5. PASIEN & KUNJUNGAN (CLAUDE.md §7 — patients)
-- =====================================================================

CREATE TABLE patients (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id             BIGINT UNSIGNED NOT NULL COMMENT 'Cabang tempat RM pertama dibuat',
  no_rm               VARCHAR(30)  NOT NULL,
  nik                 CHAR(16)     NOT NULL COMMENT 'WAJIB — syarat SatuSehat (CLAUDE.md §6)',
  no_kk               VARCHAR(16)  NULL,
  nama                VARCHAR(150) NOT NULL,
  tempat_lahir        VARCHAR(100) NULL,
  tanggal_lahir       DATE         NOT NULL,
  jenis_kelamin       ENUM('L','P') NOT NULL,
  gol_darah           ENUM('A','B','AB','O') NULL,
  rhesus              ENUM('+','-') NULL,
  agama               VARCHAR(30)  NULL,
  status_perkawinan   VARCHAR(30)  NULL,
  pendidikan          VARCHAR(40)  NULL,
  pekerjaan           VARCHAR(80)  NULL,
  alamat              TEXT         NULL,
  rt                  VARCHAR(5)   NULL,
  rw                  VARCHAR(5)   NULL,
  kelurahan           VARCHAR(100) NULL,
  kecamatan           VARCHAR(100) NULL,
  kota                VARCHAR(100) NULL,
  provinsi            VARCHAR(100) NULL,
  kode_pos            VARCHAR(10)  NULL,
  telepon             VARCHAR(30)  NULL,
  email               VARCHAR(150) NULL,
  pj_nama             VARCHAR(150) NULL COMMENT 'Penanggung jawab',
  pj_hubungan         VARCHAR(40)  NULL,
  pj_telepon          VARCHAR(30)  NULL,
  jenis_pasien        ENUM('umum','bpjs','asuransi','perusahaan') NOT NULL DEFAULT 'umum',
  -- Penjamin BAWAAN pasien. Yang berlaku untuk penagihan adalah
  -- `visits.payer_id`, yang disalin dari sini saat mendaftar — kepesertaan
  -- berubah, kunjungan yang sudah ditagihkan tidak boleh ikut berubah.
  payer_id            BIGINT UNSIGNED NULL,
  no_anggota          VARCHAR(40)  NULL COMMENT 'No. peserta/kartu di penjamin',
  -- Rumah BPJS: tempat menaruh hasil cek eligibilitas. Belum diisi
  -- integrasi apa pun (TAHAP 2).
  bpjs_kelas          ENUM('1','2','3') NULL,
  bpjs_faskes_terdaftar VARCHAR(180) NULL COMMENT 'FKTP peserta; belum tentu klinik ini',
  bpjs_status_peserta ENUM('aktif','nonaktif','belum_dicek') NULL DEFAULT 'belum_dicek',
  bpjs_dicek_at       DATETIME NULL,
  no_bpjs             VARCHAR(20)  NULL,
  no_asuransi         VARCHAR(40)  NULL,
  foto_path           VARCHAR(255) NULL,
  satusehat_patient_id VARCHAR(64) NULL,
  is_active           TINYINT(1)   NOT NULL DEFAULT 1,
  created_by          BIGINT UNSIGNED NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pat_nik (nik) COMMENT 'Satu NIK = satu pasien lintas cabang',
  UNIQUE KEY uq_pat_rm  (site_id, no_rm),
  KEY ix_pat_nama (nama(64)),
  KEY ix_pat_lahir (tanggal_lahir),
  CONSTRAINT fk_pat_site FOREIGN KEY (site_id) REFERENCES sites(id),
  CONSTRAINT ck_pat_nik CHECK (nik REGEXP '^[0-9]{16}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE patient_allergies (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  patient_id  BIGINT UNSIGNED NOT NULL,
  jenis       ENUM('obat','makanan','lingkungan','lainnya') NOT NULL DEFAULT 'obat',
  item_id     BIGINT UNSIGNED NULL COMMENT 'Diisi bila alergen ada di katalog obat',
  nama_alergen VARCHAR(150) NOT NULL,
  reaksi      VARCHAR(255) NULL,
  keparahan   ENUM('ringan','sedang','berat') NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  recorded_by BIGINT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_pa_patient (patient_id, is_active),
  CONSTRAINT fk_pa_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  CONSTRAINT fk_pa_item    FOREIGN KEY (item_id)    REFERENCES items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Kunjungan = 1 baris per pasien per pendaftaran. Poros seluruh sistem.
CREATE TABLE visits (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id              BIGINT UNSIGNED NOT NULL,
  patient_id           BIGINT UNSIGNED NOT NULL,
  no_visit             VARCHAR(40) NOT NULL,
  tanggal              DATE NOT NULL,
  waktu_daftar         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  poli_id              BIGINT UNSIGNED NOT NULL,
  doctor_id            BIGINT UNSIGNED NOT NULL COMMENT 'Dokter terjadwal',
  substitute_doctor_id BIGINT UNSIGNED NULL COMMENT 'Dokter pengganti yang benar-benar melayani',
  jenis_kunjungan      ENUM('baru','lama') NOT NULL DEFAULT 'lama',
  cara_bayar           ENUM('umum','bpjs','asuransi','perusahaan') NOT NULL DEFAULT 'umum',
  -- Penjamin yang BERLAKU untuk kunjungan ini; dibekukan saat mendaftar.
  payer_id             BIGINT UNSIGNED NULL,
  no_anggota           VARCHAR(40) NULL,
  -- Rumah BPJS (P-Care). Belum dipakai integrasi apa pun.
  bpjs_no_kunjungan    VARCHAR(40) NULL,
  bpjs_jenis_kunjungan ENUM('sakit','sehat','kia','kb') NULL,
  bpjs_status_pulang   ENUM('berobat_jalan','rujuk_lanjut','meninggal','kontrol') NULL,
  bpjs_no_rujukan      VARCHAR(40) NULL,
  rujukan_dari         VARCHAR(150) NULL,
  -- Ditandai Pendaftaran saat pasien datang. BUKAN triase: petugas pendaftaran
  -- tidak menilai secara klinis, hanya menandai bahwa kondisi pasien terlihat
  -- tidak bisa menunggu antrean. Dipakai karena `nurse_assessments.triase`
  -- baru ada SETELAH perawat memeriksa — pada saat perawat memilih siapa yang
  -- dipanggil, triase seluruh pasien menunggu masih NULL.
  didahulukan          TINYINT(1) NOT NULL DEFAULT 0,
  alasan_didahulukan   VARCHAR(160) NULL COMMENT 'Wajib bila didahulukan = 1',
  -- Alur bayar-dulu: farmasi disentuh DUA kali. `menunggu_farmasi` = resep
  -- menunggu divalidasi & dihargai; `menunggu_obat` = sudah lunas, pasien
  -- tinggal mengambil obatnya. Kunjungan ditutup di farmasi, bukan di kasir.
  status               ENUM(
                          'terdaftar','menunggu_perawat','dikaji_perawat',
                          'menunggu_dokter','dalam_pemeriksaan',
                          'menunggu_lab','menunggu_farmasi','menunggu_kasir',
                          'menunggu_obat','selesai','batal'
                       ) NOT NULL DEFAULT 'terdaftar',
  alasan_batal         VARCHAR(255) NULL,
  dibatalkan_by        BIGINT UNSIGNED NULL,
  dibatalkan_at        DATETIME NULL,
  registered_by        BIGINT UNSIGNED NOT NULL,
  selesai_at           DATETIME NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_visit_no (site_id, no_visit),
  KEY ix_visit_worklist (site_id, tanggal, status),
  KEY ix_visit_patient (patient_id, tanggal),
  KEY ix_visit_doctor (doctor_id, tanggal, status),
  CONSTRAINT fk_v_site    FOREIGN KEY (site_id)    REFERENCES sites(id),
  CONSTRAINT fk_v_patient FOREIGN KEY (patient_id) REFERENCES patients(id),
  CONSTRAINT fk_v_poli    FOREIGN KEY (poli_id)    REFERENCES polis(id),
  CONSTRAINT fk_v_doctor  FOREIGN KEY (doctor_id)  REFERENCES users(id),
  CONSTRAINT fk_v_sub     FOREIGN KEY (substitute_doctor_id) REFERENCES users(id),
  CONSTRAINT fk_v_reg     FOREIGN KEY (registered_by) REFERENCES users(id),
  -- Penanda tanpa alasan tidak bisa dipertanggungjawabkan, dan perawat yang
  -- memanggil tidak tahu apa yang harus dilihat lebih dulu.
  CONSTRAINT ck_v_didahulukan
    CHECK (didahulukan = 0 OR alasan_didahulukan IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE queues (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id      BIGINT UNSIGNED NOT NULL,
  visit_id     BIGINT UNSIGNED NOT NULL,
  poli_id      BIGINT UNSIGNED NOT NULL,
  tanggal      DATE NOT NULL,
  prefix       CHAR(2) NOT NULL DEFAULT 'A',
  nomor        SMALLINT UNSIGNED NOT NULL,
  status       ENUM('menunggu','dipanggil','dilayani','terlewat','selesai','batal') NOT NULL DEFAULT 'menunggu',
  dipanggil_at DATETIME NULL,
  dipanggil_by BIGINT UNSIGNED NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_q (site_id, poli_id, tanggal, prefix, nomor),
  UNIQUE KEY uq_q_visit (visit_id),
  KEY ix_q_board (site_id, tanggal, status),
  CONSTRAINT fk_q_site  FOREIGN KEY (site_id)  REFERENCES sites(id),
  CONSTRAINT fk_q_visit FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE CASCADE,
  CONSTRAINT fk_q_poli  FOREIGN KEY (poli_id)  REFERENCES polis(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- 6. PENGKAJIAN AWAL PERAWAT (CLAUDE.md §3.1 & §4)
-- =====================================================================

CREATE TABLE nurse_assessments (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  visit_id       BIGINT UNSIGNED NOT NULL,
  site_id        BIGINT UNSIGNED NOT NULL,
  nurse_id       BIGINT UNSIGNED NOT NULL,
  triase         ENUM('merah','kuning','hijau','hitam') NOT NULL DEFAULT 'hijau',
  keluhan_utama  TEXT NOT NULL,
  riwayat_singkat TEXT NULL COMMENT 'Riwayat penyakit dahulu',
  riwayat_pengobatan TEXT NULL COMMENT 'Obat yang sedang/baru diminum pasien',
  -- Tanda-Tanda Vital
  td_sistolik    SMALLINT UNSIGNED NULL COMMENT 'mmHg',
  td_diastolik   SMALLINT UNSIGNED NULL COMMENT 'mmHg',
  nadi           SMALLINT UNSIGNED NULL COMMENT 'x/menit',
  respirasi      SMALLINT UNSIGNED NULL COMMENT 'x/menit',
  suhu           DECIMAL(4,1) NULL COMMENT 'derajat C',
  spo2           TINYINT UNSIGNED NULL COMMENT '%',
  kesadaran      ENUM('compos_mentis','apatis','somnolen','sopor','koma') NULL,
  keadaan_umum   ENUM('baik','sedang','buruk') NULL,
  keadaan_gizi   ENUM('baik','kurang','buruk') NULL,
  -- GCS disimpan per komponen, bukan hanya totalnya: dua pasien dengan total
  -- 10 bisa sangat berbeda keadaannya (E4V1M5 vs E2V4M4), dan perubahan per
  -- komponen itulah yang dipantau.
  gcs_e          TINYINT UNSIGNED NULL COMMENT 'Eye 1-4',
  gcs_v          TINYINT UNSIGNED NULL COMMENT 'Verbal 1-5',
  gcs_m          TINYINT UNSIGNED NULL COMMENT 'Motorik 1-6',
  gcs_total      TINYINT UNSIGNED AS (
                    CASE WHEN gcs_e IS NOT NULL AND gcs_v IS NOT NULL AND gcs_m IS NOT NULL
                    THEN gcs_e + gcs_v + gcs_m END
                 ) STORED,
  -- Antropometri
  berat_badan    DECIMAL(6,2) NULL COMMENT 'kg',
  tinggi_badan   DECIMAL(6,2) NULL COMMENT 'cm',
  lingkar_perut  DECIMAL(6,2) NULL COMMENT 'cm',
  imt            DECIMAL(6,2) AS (
                    CASE WHEN tinggi_badan > 0 AND berat_badan > 0
                    THEN berat_badan / POW(tinggi_badan/100, 2) END
                 ) STORED,
  -- Skrining
  skala_nyeri    TINYINT UNSIGNED NULL COMMENT '0-10',
  risiko_jatuh   ENUM('rendah','sedang','tinggi') NULL,
  status_alergi_dikonfirmasi TINYINT(1) NOT NULL DEFAULT 0,
  catatan        TEXT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_na_visit (visit_id),
  KEY ix_na_site (site_id, created_at),
  CONSTRAINT fk_na_visit FOREIGN KEY (visit_id) REFERENCES visits(id),
  CONSTRAINT fk_na_site  FOREIGN KEY (site_id)  REFERENCES sites(id),
  CONSTRAINT fk_na_nurse FOREIGN KEY (nurse_id) REFERENCES users(id),
  CONSTRAINT ck_na_nyeri CHECK (skala_nyeri IS NULL OR skala_nyeri BETWEEN 0 AND 10),
  -- Rentang GCS ditegakkan di sini, bukan hanya di form: salah ketik seperti
  -- E5 akan tersimpan diam-diam dan membuat totalnya menyesatkan — dan angka
  -- GCS dipakai untuk memutuskan rujukan.
  CONSTRAINT ck_na_gcs_e CHECK (gcs_e IS NULL OR gcs_e BETWEEN 1 AND 4),
  CONSTRAINT ck_na_gcs_v CHECK (gcs_v IS NULL OR gcs_v BETWEEN 1 AND 5),
  CONSTRAINT ck_na_gcs_m CHECK (gcs_m IS NULL OR gcs_m BETWEEN 1 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Jembatan BMHP perawat -> potong stok farmasi + masuk tagihan (CLAUDE.md §7)
CREATE TABLE nurse_bmhp_usage (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  visit_id            BIGINT UNSIGNED NOT NULL,
  nurse_assessment_id BIGINT UNSIGNED NULL,
  site_id             BIGINT UNSIGNED NOT NULL,
  item_id             BIGINT UNSIGNED NOT NULL,
  qty                 DECIMAL(14,3) NOT NULL,
  satuan              VARCHAR(20) NOT NULL,
  harga_satuan        DECIMAL(14,2) NOT NULL DEFAULT 0,
  subtotal            DECIMAL(14,2) NOT NULL DEFAULT 0,
  stock_movement_id   BIGINT UNSIGNED NULL COMMENT 'Bukti pemotongan stok',
  recorded_by         BIGINT UNSIGNED NOT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_nbu_visit (visit_id),
  KEY ix_nbu_item (site_id, item_id, created_at),
  CONSTRAINT fk_nbu_visit FOREIGN KEY (visit_id) REFERENCES visits(id),
  CONSTRAINT fk_nbu_na    FOREIGN KEY (nurse_assessment_id) REFERENCES nurse_assessments(id),
  CONSTRAINT fk_nbu_site  FOREIGN KEY (site_id)  REFERENCES sites(id),
  CONSTRAINT fk_nbu_item  FOREIGN KEY (item_id)  REFERENCES items(id),
  CONSTRAINT fk_nbu_sm    FOREIGN KEY (stock_movement_id) REFERENCES stock_movements(id),
  CONSTRAINT fk_nbu_user  FOREIGN KEY (recorded_by) REFERENCES users(id),
  CONSTRAINT ck_nbu_qty CHECK (qty > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- 7. ASESMEN DOKTER / RME (CLAUDE.md §7 — medical_assessments)
-- =====================================================================

CREATE TABLE medical_assessments (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  visit_id      BIGINT UNSIGNED NOT NULL,
  site_id       BIGINT UNSIGNED NOT NULL,
  doctor_id     BIGINT UNSIGNED NOT NULL COMMENT 'Dokter yang benar-benar memeriksa (bisa dokter pengganti)',
  -- SOAP
  subjective    TEXT NULL COMMENT 'S — anamnesis',
  objective     TEXT NULL COMMENT 'O — pemeriksaan fisik',
  assessment    TEXT NULL COMMENT 'A — narasi penilaian (kode ICD-10 di assessment_diagnoses)',
  plan          TEXT NULL COMMENT 'P — rencana tatalaksana',
  edukasi       TEXT NULL,
  prognosis     VARCHAR(100) NULL,
  status        ENUM('draft','final','batal') NOT NULL DEFAULT 'draft',
  finalized_at  DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ma_visit (visit_id),
  KEY ix_ma_doctor (doctor_id, created_at),
  CONSTRAINT fk_ma_visit  FOREIGN KEY (visit_id)  REFERENCES visits(id),
  CONSTRAINT fk_ma_site   FOREIGN KEY (site_id)   REFERENCES sites(id),
  CONSTRAINT fk_ma_doctor FOREIGN KEY (doctor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE assessment_diagnoses (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  assessment_id BIGINT UNSIGNED NOT NULL,
  icd10_code    VARCHAR(10) NOT NULL,
  tipe          ENUM('primer','sekunder','komplikasi') NOT NULL DEFAULT 'primer',
  keterangan    VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ad (assessment_id, icd10_code),
  CONSTRAINT fk_ad_assessment FOREIGN KEY (assessment_id) REFERENCES medical_assessments(id) ON DELETE CASCADE,
  CONSTRAINT fk_ad_icd        FOREIGN KEY (icd10_code)    REFERENCES icd10_codes(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE assessment_procedures (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  assessment_id BIGINT UNSIGNED NOT NULL,
  procedure_id  BIGINT UNSIGNED NOT NULL,
  qty           SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  tarif         DECIMAL(14,2) NOT NULL DEFAULT 0,
  diskon        DECIMAL(14,2) NOT NULL DEFAULT 0
                COMMENT 'Potongan nominal; hanya untuk tindakan konsultasi',
  alasan_diskon VARCHAR(160) NULL COMMENT 'Opsional — kebijakan pribadi dokter',
  subtotal      DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'qty * tarif - diskon',
  executed_by   BIGINT UNSIGNED NULL,
  catatan       VARCHAR(255) NULL,
  PRIMARY KEY (id),
  -- Diskon tidak boleh melebihi nilai tindakannya. Tanpa batas ini, satu
  -- salah ketik nol menghasilkan subtotal negatif yang justru MENGURANGI
  -- total tagihan pasien, dan itu baru ketahuan saat kas kasir tidak cocok.
  CONSTRAINT ck_ap_diskon CHECK (diskon >= 0 AND diskon <= qty * tarif),
  KEY ix_ap_assessment (assessment_id),
  CONSTRAINT fk_ap_assessment FOREIGN KEY (assessment_id) REFERENCES medical_assessments(id) ON DELETE CASCADE,
  CONSTRAINT fk_ap_proc       FOREIGN KEY (procedure_id)  REFERENCES medical_procedures(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- 8. LABORATORIUM (CLAUDE.md §4)
-- =====================================================================

CREATE TABLE lab_orders (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id       BIGINT UNSIGNED NOT NULL,
  visit_id      BIGINT UNSIGNED NOT NULL,
  no_order      VARCHAR(40) NOT NULL,
  ordered_by    BIGINT UNSIGNED NOT NULL COMMENT 'Dokter',
  prioritas     ENUM('rutin','cito') NOT NULL DEFAULT 'rutin',
  -- Menentukan apakah pasien TERTAHAN menunggu hasil. Darah rutin yang jadi
  -- 20 menit ditunggu; kultur resistensi yang jadi lima hari tidak mungkin
  -- ditunggu. Tanpa pembedaan ini dua kebutuhan yang sama-sama benar saling
  -- meniadakan — lihat db/migrasi/2026-08-18-alur-lab-dan-pembatalan.sql.
  sifat_hasil   ENUM('ditunggu','menyusul') NOT NULL DEFAULT 'ditunggu',
  -- APS: diminta pasien sendiri. `ordered_by` adalah petugas lab, bukan
  -- dokter — rekam medis tidak boleh menunjukkan dokter memesan sesuatu
  -- yang tidak pernah ia pesan.
  atas_permintaan_sendiri TINYINT(1) NOT NULL DEFAULT 0,
  catatan_klinis TEXT NULL,
  status        ENUM('baru','diproses','selesai','batal') NOT NULL DEFAULT 'baru',
  ordered_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_by  BIGINT UNSIGNED NULL COMMENT 'Petugas lab',
  completed_at  DATETIME NULL,
  alasan_batal  VARCHAR(255) NULL,
  dibatalkan_by BIGINT UNSIGNED NULL,
  dibatalkan_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lo_no (site_id, no_order),
  KEY ix_lo_worklist (site_id, status, ordered_at),
  KEY ix_lo_visit (visit_id),
  KEY ix_lo_sifat (visit_id, status, sifat_hasil),
  CONSTRAINT fk_lo_site  FOREIGN KEY (site_id)  REFERENCES sites(id),
  CONSTRAINT fk_lo_visit FOREIGN KEY (visit_id) REFERENCES visits(id),
  CONSTRAINT fk_lo_doc   FOREIGN KEY (ordered_by) REFERENCES users(id),
  CONSTRAINT fk_lo_cancel FOREIGN KEY (dibatalkan_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE lab_order_panels (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id  BIGINT UNSIGNED NOT NULL,
  panel_id  BIGINT UNSIGNED NOT NULL,
  tarif     DECIMAL(14,2) NOT NULL DEFAULT 0,
  status    ENUM('menunggu','selesai','batal') NOT NULL DEFAULT 'menunggu',
  PRIMARY KEY (id),
  UNIQUE KEY uq_lop (order_id, panel_id),
  CONSTRAINT fk_lop_order FOREIGN KEY (order_id) REFERENCES lab_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_lop_panel FOREIGN KEY (panel_id) REFERENCES lab_panels(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE lab_results (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id      BIGINT UNSIGNED NOT NULL,
  panel_id      BIGINT UNSIGNED NOT NULL,
  parameter_id  BIGINT UNSIGNED NOT NULL,
  nilai_numerik DECIMAL(12,4) NULL,
  nilai_teks    VARCHAR(255) NULL,
  satuan        VARCHAR(30)  NULL,
  ref_teks      VARCHAR(100) NULL COMMENT 'Snapshot nilai rujukan saat pemeriksaan',
  flag          ENUM('N','L','H','LL','HH') NOT NULL DEFAULT 'N'
                COMMENT 'N normal, L rendah, H tinggi, LL/HH kritis',
  catatan       VARCHAR(255) NULL,
  entered_by    BIGINT UNSIGNED NOT NULL,
  entered_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_by   BIGINT UNSIGNED NULL,
  verified_at   DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lr (order_id, parameter_id),
  KEY ix_lr_order (order_id),
  CONSTRAINT fk_lr_order FOREIGN KEY (order_id)     REFERENCES lab_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_lr_panel FOREIGN KEY (panel_id)     REFERENCES lab_panels(id),
  CONSTRAINT fk_lr_param FOREIGN KEY (parameter_id) REFERENCES lab_parameters(id),
  CONSTRAINT fk_lr_user  FOREIGN KEY (entered_by)   REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Dokumen pendukung rekam medis, diunggah dokter dari layar pemeriksaan.
--
-- Berkasnya sendiri TIDAK disimpan di database maupun di `public/` — hanya
-- kuncinya yang dicatat di sini. Isinya ada di `storage/rekam/` dan hanya
-- keluar lewat `app/api/berkas/`, yang memeriksa sesi dan hak akses per
-- berkas. Lihat catatan di src/lib/berkas.ts.
CREATE TABLE visit_documents (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id      BIGINT UNSIGNED NOT NULL,
  visit_id     BIGINT UNSIGNED NOT NULL,
  patient_id   BIGINT UNSIGNED NOT NULL
               COMMENT 'Disalin dari kunjungan agar dokumen bisa ditelusuri per pasien',
  kunci        VARCHAR(255) NOT NULL COMMENT 'Jalur relatif di storage/, mis. rekam/202608/<hex>.pdf',
  nama_asli    VARCHAR(255) NOT NULL COMMENT 'Nama berkas dari pengunggah — tampilan saja, tidak pernah dipakai sebagai jalur',
  keterangan   VARCHAR(255) NULL COMMENT 'Diisi dokter, mis. "Hasil USG abdomen 1 Agu"',
  mime         VARCHAR(100) NOT NULL,
  ukuran       INT UNSIGNED NOT NULL COMMENT 'byte',
  sha256       CHAR(64) NOT NULL,
  uploaded_by  BIGINT UNSIGNED NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Dokumen medis tidak dihapus permanen. Penghapusan hanya menyembunyikannya
  -- dari layar; barisnya tetap ada supaya rekam medis tidak berubah diam-diam.
  deleted_at   DATETIME NULL,
  deleted_by   BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vd_kunci (kunci),
  KEY ix_vd_visit (visit_id, deleted_at),
  KEY ix_vd_patient (patient_id, deleted_at),
  CONSTRAINT fk_vd_site    FOREIGN KEY (site_id)     REFERENCES sites(id),
  CONSTRAINT fk_vd_visit   FOREIGN KEY (visit_id)    REFERENCES visits(id) ON DELETE CASCADE,
  CONSTRAINT fk_vd_patient FOREIGN KEY (patient_id)  REFERENCES patients(id),
  CONSTRAINT fk_vd_user    FOREIGN KEY (uploaded_by) REFERENCES users(id),
  CONSTRAINT fk_vd_del     FOREIGN KEY (deleted_by)  REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- 9. RESEP — STRUKTUR PARENT-CHILD (CLAUDE.md §7, inti sistem)
-- =====================================================================

CREATE TABLE prescriptions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id       BIGINT UNSIGNED NOT NULL,
  visit_id      BIGINT UNSIGNED NOT NULL,
  no_resep      VARCHAR(40) NOT NULL,
  doctor_id     BIGINT UNSIGNED NOT NULL,
  catatan_umum  TEXT NULL,
  -- `disiapkan` = sudah divalidasi farmasi: stok dikunci, harga final,
  -- menunggu pasien membayar di kasir. Obat baru keluar pada `diserahkan`.
  status        ENUM('baru','diterima_farmasi','disiapkan','diserahkan','batal')
                NOT NULL DEFAULT 'baru',
  stok_direservasi TINYINT(1) NOT NULL DEFAULT 0
                COMMENT 'Resep ini sedang mengunci stok; dilepas saat diserahkan atau dibatalkan',
  is_iter       TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Resep boleh diulang',
  iter_sisa     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_by   BIGINT UNSIGNED NULL COMMENT 'Petugas farmasi',
  received_at   DATETIME NULL,
  dispensed_by  BIGINT UNSIGNED NULL,
  dispensed_at  DATETIME NULL,
  alasan_batal  VARCHAR(255) NULL,
  -- Aturannya "satu resep BERJALAN per kunjungan", bukan "satu baris".
  -- MySQL tidak punya partial index, jadi aturan itu ditulis lewat kolom
  -- turunan: berisi `visit_id` selama resepnya hidup, NULL begitu
  -- dibatalkan — dan NULL tidak pernah bentrok dengan NULL di indeks unik.
  -- Tanpa ini, resep yang dibatalkan mengunci kunjungannya selamanya dan
  -- "batalkan lalu terbitkan resep baru" berujung ER_DUP_ENTRY.
  visit_aktif   BIGINT UNSIGNED GENERATED ALWAYS AS (IF(status <> 'batal', visit_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rx_no (site_id, no_resep),
  UNIQUE KEY uq_rx_visit_aktif (visit_aktif) COMMENT 'Satu resep berjalan per kunjungan; yang dibatalkan menumpuk sebagai riwayat',
  KEY ix_rx_visit (visit_id) COMMENT 'Penopang fk_rx_visit setelah uq_rx_visit dilepas',
  KEY ix_rx_worklist (site_id, status, created_at),
  CONSTRAINT fk_rx_site   FOREIGN KEY (site_id)   REFERENCES sites(id),
  CONSTRAINT fk_rx_visit  FOREIGN KEY (visit_id)  REFERENCES visits(id),
  CONSTRAINT fk_rx_doctor FOREIGN KEY (doctor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Obat PATEN (non-racikan)
CREATE TABLE prescription_items (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  prescription_id BIGINT UNSIGNED NOT NULL,
  item_id         BIGINT UNSIGNED NOT NULL,
  qty             DECIMAL(14,3) NOT NULL,
  satuan          VARCHAR(20) NOT NULL,
  aturan_pakai    VARCHAR(255) NOT NULL
                  COMMENT 'WAJIB (CLAUDE.md §4). Mis: "3 x sehari 1 tablet sesudah makan"',
  catatan         VARCHAR(255) NULL,
  harga_satuan    DECIMAL(14,2) NOT NULL DEFAULT 0,
  subtotal        DECIMAL(14,2) NOT NULL DEFAULT 0,
  qty_diserahkan  DECIMAL(14,3) NOT NULL DEFAULT 0,
  stock_movement_id BIGINT UNSIGNED NULL,
  urutan          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_pit_rx (prescription_id),
  CONSTRAINT fk_pit_rx   FOREIGN KEY (prescription_id) REFERENCES prescriptions(id) ON DELETE CASCADE,
  CONSTRAINT fk_pit_item FOREIGN KEY (item_id)         REFERENCES items(id),
  CONSTRAINT fk_pit_sm   FOREIGN KEY (stock_movement_id) REFERENCES stock_movements(id),
  CONSTRAINT ck_pit_qty  CHECK (qty > 0),
  -- REGEXP, bukan TRIM(): TRIM() di MySQL hanya membuang SPASI, sehingga
  -- aturan pakai berisi tab atau newline saja akan lolos dan tercetak
  -- kosong di etiket obat. Pola ini menuntut minimal satu karakter
  -- bukan-spasi apa pun.
  CONSTRAINT ck_pit_signa CHECK (aturan_pakai REGEXP '[^[:space:]]')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Header RACIKAN
CREATE TABLE prescription_racikans (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  prescription_id   BIGINT UNSIGNED NOT NULL,
  nama_racikan      VARCHAR(150) NOT NULL COMMENT 'Mis: Puyer Batuk Anak',
  bentuk_sediaan    ENUM('puyer','kapsul','sirup','salep','krim','lainnya') NOT NULL DEFAULT 'puyer',
  qty_jadi          DECIMAL(14,3) NOT NULL COMMENT 'Jumlah sediaan jadi, mis. 12 bungkus',
  satuan_jadi       VARCHAR(20) NOT NULL DEFAULT 'bungkus',
  aturan_pakai      VARCHAR(255) NOT NULL COMMENT 'WAJIB (CLAUDE.md §4)',
  biaya_jasa_racik  DECIMAL(14,2) NOT NULL DEFAULT 0
                    COMMENT 'Masuk billing sebagai baris tersendiri (CLAUDE.md §4)',
  catatan           VARCHAR(255) NULL,
  is_disiapkan      TINYINT(1) NOT NULL DEFAULT 0,
  disiapkan_by      BIGINT UNSIGNED NULL,
  disiapkan_at      DATETIME NULL,
  urutan            SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_prc_rx (prescription_id),
  CONSTRAINT fk_prc_rx FOREIGN KEY (prescription_id) REFERENCES prescriptions(id) ON DELETE CASCADE,
  CONSTRAINT ck_prc_qty CHECK (qty_jadi > 0),
  -- Lihat catatan pada ck_pit_signa — TRIM() tidak membuang tab/newline.
  CONSTRAINT ck_prc_signa CHECK (aturan_pakai REGEXP '[^[:space:]]')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Komposisi racikan -> dasar pemotongan stok bahan mentah
CREATE TABLE prescription_racikan_ingredients (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  racikan_id        BIGINT UNSIGNED NOT NULL,
  item_id           BIGINT UNSIGNED NOT NULL COMMENT 'Obat mentah (tablet/serbuk) dari katalog',
  qty_bahan         DECIMAL(14,3) NOT NULL
                    COMMENT 'Untuk KESELURUHAN racikan, bukan per bungkus',
  satuan            VARCHAR(20) NOT NULL,
  harga_satuan      DECIMAL(14,2) NOT NULL DEFAULT 0,
  subtotal          DECIMAL(14,2) NOT NULL DEFAULT 0,
  stock_movement_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pri (racikan_id, item_id),
  CONSTRAINT fk_pri_racikan FOREIGN KEY (racikan_id) REFERENCES prescription_racikans(id) ON DELETE CASCADE,
  CONSTRAINT fk_pri_item    FOREIGN KEY (item_id)    REFERENCES items(id),
  CONSTRAINT fk_pri_sm      FOREIGN KEY (stock_movement_id) REFERENCES stock_movements(id),
  CONSTRAINT ck_pri_qty CHECK (qty_bahan > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- 10. KASIR & BILLING (CLAUDE.md §4, §6)
-- =====================================================================

CREATE TABLE cashier_shifts (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id        BIGINT UNSIGNED NOT NULL,
  cashier_id     BIGINT UNSIGNED NOT NULL,
  dibuka_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ditutup_at     DATETIME NULL,
  kas_awal       DECIMAL(14,2) NOT NULL DEFAULT 0,
  kas_akhir_sistem DECIMAL(14,2) NOT NULL DEFAULT 0,
  kas_akhir_fisik  DECIMAL(14,2) NULL,
  selisih        DECIMAL(14,2) NULL,
  catatan        TEXT NULL,
  PRIMARY KEY (id),
  KEY ix_cs_site (site_id, dibuka_at),
  CONSTRAINT fk_cs_site FOREIGN KEY (site_id) REFERENCES sites(id),
  CONSTRAINT fk_cs_user FOREIGN KEY (cashier_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE billing_transactions (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id        BIGINT UNSIGNED NOT NULL,
  visit_id       BIGINT UNSIGNED NOT NULL,
  no_invoice     VARCHAR(40) NOT NULL,
  subtotal       DECIMAL(14,2) NOT NULL DEFAULT 0,
  diskon         DECIMAL(14,2) NOT NULL DEFAULT 0,
  pembulatan     DECIMAL(14,2) NOT NULL DEFAULT 0,
  total          DECIMAL(14,2) NOT NULL DEFAULT 0,
  -- Pembagian tanggungan. Dihitung `bagiTanggungan()` di lib/penjamin.ts —
  -- SATU-SATUNYA tempat aturannya hidup; kasir & billing memanggilnya.
  payer_id          BIGINT UNSIGNED NULL,
  tanggung_penjamin DECIMAL(14,2) NOT NULL DEFAULT 0,
  tanggung_pasien   DECIMAL(14,2) NOT NULL DEFAULT 0,
  dibayar        DECIMAL(14,2) NOT NULL DEFAULT 0,
  kembalian      DECIMAL(14,2) NOT NULL DEFAULT 0,
  -- `penjamin` dipakai saat SELURUH tagihan ditanggung penjamin sehingga
  -- pasien tidak mengeluarkan uang. Tagihan tetap LUNAS agar gerbang
  -- farmasi (obat hanya keluar setelah lunas) tidak perlu diubah —
  -- piutangnya hidup di `claims`, bukan dengan menahan pasien.
  payment_method ENUM('tunai','qris','transfer','kartu_debit','kartu_kredit','bpjs','penjamin','lainnya') NULL
                 COMMENT 'CLAUDE.md §6 — Payment Gateway readiness',
  payment_ref    VARCHAR(100) NULL COMMENT 'No. approval EDC / trx id QRIS',
  status         ENUM('draft','menunggu','lunas','batal') NOT NULL DEFAULT 'draft',
  cashier_id     BIGINT UNSIGNED NULL,
  shift_id       BIGINT UNSIGNED NULL,
  paid_at        DATETIME NULL,
  alasan_batal   VARCHAR(255) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bt_no (site_id, no_invoice),
  UNIQUE KEY uq_bt_visit (visit_id),
  KEY ix_bt_worklist (site_id, status, created_at),
  KEY ix_bt_paid (site_id, paid_at),
  CONSTRAINT fk_bt_site  FOREIGN KEY (site_id)  REFERENCES sites(id),
  CONSTRAINT fk_bt_visit FOREIGN KEY (visit_id) REFERENCES visits(id),
  CONSTRAINT fk_bt_cash  FOREIGN KEY (cashier_id) REFERENCES users(id),
  CONSTRAINT fk_bt_shift FOREIGN KEY (shift_id) REFERENCES cashier_shifts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Rincian tagihan. CATATAN PENTING:
-- tabel ini SENGAJA tidak menyimpan diagnosa. Layar kasir hanya membaca
-- billing_* + patients(nama,no_rm) — tidak pernah menyentuh
-- medical_assessments / assessment_diagnoses (CLAUDE.md §2.1 poin 7).
CREATE TABLE billing_items (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  billing_id   BIGINT UNSIGNED NOT NULL,
  kategori     ENUM('jasa_dokter','tindakan','laboratorium','obat','racikan',
                    'jasa_racik','bmhp','administrasi','lainnya') NOT NULL,
  ref_type     VARCHAR(40) NULL COMMENT 'assessment_procedure | lab_order_panel | prescription_item | prescription_racikan | nurse_bmhp_usage',
  ref_id       BIGINT UNSIGNED NULL,
  deskripsi    VARCHAR(255) NOT NULL,
  qty          DECIMAL(14,3) NOT NULL DEFAULT 1,
  harga_satuan DECIMAL(14,2) NOT NULL DEFAULT 0,
  diskon       DECIMAL(14,2) NOT NULL DEFAULT 0,
  subtotal     DECIMAL(14,2) NOT NULL DEFAULT 0,
  urutan       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_bi_billing (billing_id, kategori),
  KEY ix_bi_ref (ref_type, ref_id),
  CONSTRAINT fk_bi_billing FOREIGN KEY (billing_id) REFERENCES billing_transactions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- 11. DOKUMEN & CETAK (CLAUDE.md §5)
-- =====================================================================

CREATE TABLE medical_certificates (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id     BIGINT UNSIGNED NOT NULL,
  visit_id    BIGINT UNSIGNED NOT NULL,
  jenis       ENUM('sakit','sehat','rujukan','keterangan_lain') NOT NULL,
  no_surat    VARCHAR(50) NOT NULL,
  isi         JSON NOT NULL COMMENT 'Field spesifik per jenis (lama istirahat, tujuan rujukan, dsb)',
  issued_by   BIGINT UNSIGNED NOT NULL,
  issued_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mc_no (site_id, no_surat),
  KEY ix_mc_visit (visit_id),
  CONSTRAINT fk_mc_site  FOREIGN KEY (site_id)  REFERENCES sites(id),
  CONSTRAINT fk_mc_visit FOREIGN KEY (visit_id) REFERENCES visits(id),
  CONSTRAINT fk_mc_user  FOREIGN KEY (issued_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- 12. SISTEM
-- =====================================================================

CREATE TABLE audit_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id     BIGINT UNSIGNED NULL,
  user_id     BIGINT UNSIGNED NULL,
  aksi        VARCHAR(60) NOT NULL COMMENT 'create | update | delete | login | print | dispense | pay | void',
  entity      VARCHAR(60) NOT NULL,
  entity_id   BIGINT UNSIGNED NULL,
  data_before JSON NULL,
  data_after  JSON NULL,
  ip_address  VARCHAR(45) NULL,
  user_agent  VARCHAR(255) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_al_entity (entity, entity_id),
  KEY ix_al_user (user_id, created_at),
  KEY ix_al_site (site_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE settings (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id   BIGINT UNSIGNED NULL COMMENT 'NULL = pengaturan global',
  skey      VARCHAR(80) NOT NULL,
  svalue    TEXT NULL,
  tipe      ENUM('string','number','boolean','json') NOT NULL DEFAULT 'string',
  PRIMARY KEY (id),
  UNIQUE KEY uq_set (site_id, skey),
  CONSTRAINT fk_set_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE notifications (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id    BIGINT UNSIGNED NULL,
  user_id    BIGINT UNSIGNED NULL COMMENT 'NULL = broadcast ke role',
  role_id    BIGINT UNSIGNED NULL,
  jenis      VARCHAR(40) NOT NULL COMMENT 'resep_masuk | hasil_lab | stok_menipis | kadaluarsa | cuti',
  judul      VARCHAR(150) NOT NULL,
  pesan      TEXT NULL,
  link       VARCHAR(255) NULL,
  is_read    TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_notif_user (user_id, is_read, created_at),
  KEY ix_notif_role (site_id, role_id, is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Persiapan TAHAP 2 (CLAUDE.md §8) — belum dipakai di MVP
CREATE TABLE satusehat_sync_logs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id       BIGINT UNSIGNED NOT NULL,
  entity        VARCHAR(60) NOT NULL,
  entity_id     BIGINT UNSIGNED NOT NULL,
  resource_type VARCHAR(40) NOT NULL COMMENT 'Patient | Encounter | Condition | MedicationRequest | Observation',
  fhir_id       VARCHAR(64) NULL,
  status        ENUM('pending','sukses','gagal') NOT NULL DEFAULT 'pending',
  request_body  JSON NULL,
  response_body JSON NULL,
  error_message TEXT NULL,
  synced_at     DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_ssl_entity (entity, entity_id),
  KEY ix_ssl_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- 13. PENJAMIN, KLAIM, & KEPATUHAN
--
-- Penjamin (BPJS/asuransi/perusahaan) beserta klaim kolektifnya,
-- persetujuan pasien, insiden keselamatan pasien, dan log sinkronisasi
-- BPJS yang strukturnya sudah disiapkan tanpa integrasi.
-- =====================================================================

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

-- ---------------------------------------------------------------------
-- Foreign key yang menunjuk `payers`.
--
-- Ditulis di AKHIR berkas, bukan di dalam CREATE TABLE masing-masing:
-- `patients`, `visits`, dan `billing_transactions` didefinisikan sebelum
-- `payers`, dan MySQL menolak FK ke tabel yang belum ada.
-- ---------------------------------------------------------------------
ALTER TABLE patients
  ADD CONSTRAINT fk_pat_payer FOREIGN KEY (payer_id) REFERENCES payers(id);

ALTER TABLE visits
  ADD CONSTRAINT fk_v_payer FOREIGN KEY (payer_id) REFERENCES payers(id);
CREATE INDEX ix_v_payer ON visits (payer_id, tanggal);

ALTER TABLE billing_transactions
  ADD CONSTRAINT fk_bt_payer FOREIGN KEY (payer_id) REFERENCES payers(id);
CREATE INDEX ix_bt_payer ON billing_transactions (payer_id, status);

CREATE INDEX ix_items_sipnap ON items (is_narkotika, is_psikotropika);
