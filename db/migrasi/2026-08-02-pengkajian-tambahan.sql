-- =====================================================================
-- Menambah parameter pengkajian awal perawat.
--
--   mysql -u root simklinik_kpsg < db/migrasi/2026-08-02-pengkajian-tambahan.sql
--
-- Aman dijalankan pada basis data berisi: hanya menambah kolom NULL,
-- tidak menyentuh baris yang sudah ada. Perubahan yang sama sudah
-- dimasukkan ke db/schema.sql agar instalasi baru ikut memilikinya —
-- keduanya HARUS diubah bersamaan, kalau tidak instalasi baru dan lama
-- akan menyimpang tanpa ada yang menyadarinya.
-- =====================================================================

ALTER TABLE nurse_assessments
  -- `riwayat_singkat` dulu menampung penyakit DAN pengobatan sekaligus.
  -- Dipisah karena obat yang sedang diminum pasien dibutuhkan dokter untuk
  -- memeriksa interaksi obat, sementara riwayat penyakit tidak.
  ADD COLUMN riwayat_pengobatan TEXT NULL
      COMMENT 'Obat yang sedang/baru diminum pasien' AFTER riwayat_singkat,

  ADD COLUMN keadaan_umum ENUM('baik','sedang','buruk') NULL AFTER kesadaran,
  ADD COLUMN keadaan_gizi ENUM('baik','kurang','buruk') NULL AFTER keadaan_umum,

  -- GCS disimpan per komponen, bukan hanya totalnya: dua pasien dengan
  -- total 10 bisa sangat berbeda keadaannya (E4V1M5 vs E2V4M4), dan
  -- perubahan per komponen itulah yang dipantau.
  ADD COLUMN gcs_e TINYINT UNSIGNED NULL COMMENT 'Eye 1-4' AFTER keadaan_gizi,
  ADD COLUMN gcs_v TINYINT UNSIGNED NULL COMMENT 'Verbal 1-5' AFTER gcs_e,
  ADD COLUMN gcs_m TINYINT UNSIGNED NULL COMMENT 'Motorik 1-6' AFTER gcs_v,

  -- Total dihitung database, bukan dikirim form: nilai yang bisa dikirim
  -- klien bisa tidak cocok dengan komponennya.
  ADD COLUMN gcs_total TINYINT UNSIGNED AS (
        CASE WHEN gcs_e IS NOT NULL AND gcs_v IS NOT NULL AND gcs_m IS NOT NULL
        THEN gcs_e + gcs_v + gcs_m END
      ) STORED AFTER gcs_m;

-- Rentang GCS ditegakkan di database, bukan hanya di form. Salah ketik
-- seperti E5 akan tersimpan diam-diam dan membuat totalnya menyesatkan —
-- dan angka GCS dipakai untuk memutuskan rujukan.
ALTER TABLE nurse_assessments
  ADD CONSTRAINT ck_na_gcs_e CHECK (gcs_e IS NULL OR gcs_e BETWEEN 1 AND 4),
  ADD CONSTRAINT ck_na_gcs_v CHECK (gcs_v IS NULL OR gcs_v BETWEEN 1 AND 5),
  ADD CONSTRAINT ck_na_gcs_m CHECK (gcs_m IS NULL OR gcs_m BETWEEN 1 AND 6);
