-- =====================================================================
-- Alur laboratorium asinkron, validasi dokter, dan pembatalan
-- Dijalankan: 18 Agustus 2026
-- =====================================================================
--
-- Empat perubahan yang saling berkaitan:
--
-- 1. `lab_orders.sifat_hasil` — inti alur lab yang baru. Dokterlah yang
--    menentukan apakah hasil sebuah pemeriksaan DITUNGGU (menentukan
--    diagnosa hari ini, pasien tertahan) atau MENYUSUL (untuk tindak
--    lanjut, pasien jalan terus). Tanpa pembedaan ini, dua kebutuhan yang
--    sama-sama benar saling meniadakan: menahan semua pasien berarti kultur
--    resistensi lima hari menghentikan pelayanan, sedangkan tidak menahan
--    siapa pun berarti dokter tidak pernah membaca hasil yang ia pesan.
--
-- 2. `lab_orders.atas_permintaan_sendiri` — pemeriksaan yang diminta pasien
--    sendiri, bukan diinstruksikan dokter. Dibuat sebagai order TERSENDIRI
--    dengan `ordered_by` petugas lab, bukan ditempelkan ke order dokter:
--    rekam medis adalah dokumen hukum, dan nama dokter di bawahnya tidak
--    boleh menanggung pemeriksaan yang tidak pernah ia pesan.
--
-- 3. Jejak pembatalan pada `visits` dan `lab_orders` — sebelumnya alasan
--    pembatalan order ditempelkan ke `catatan_klinis`, mencampur catatan
--    klinis dokter dengan catatan administratif.
--
-- 4. `lab_parameters.is_active` — parameter dinonaktifkan, TIDAK dihapus.
--    `lab_results.parameter_id` adalah foreign key tanpa ON DELETE, jadi
--    penghapusan akan ditolak database atau memusnahkan hasil pasien lama.
-- =====================================================================

-- --- 1. Jejak pembatalan kunjungan ------------------------------------
ALTER TABLE visits
  ADD COLUMN dibatalkan_by BIGINT UNSIGNED NULL AFTER alasan_batal,
  ADD COLUMN dibatalkan_at DATETIME NULL AFTER dibatalkan_by,
  ADD CONSTRAINT fk_v_cancel FOREIGN KEY (dibatalkan_by) REFERENCES users(id);

-- --- 2. Sifat hasil, APS, dan jejak pembatalan order ------------------
ALTER TABLE lab_orders
  ADD COLUMN sifat_hasil ENUM('ditunggu','menyusul') NOT NULL DEFAULT 'ditunggu'
      COMMENT 'ditunggu = pasien tertahan sampai hasil keluar; menyusul = pasien jalan terus'
      AFTER prioritas,
  ADD COLUMN atas_permintaan_sendiri TINYINT(1) NOT NULL DEFAULT 0
      COMMENT 'APS — diminta pasien, ordered_by adalah petugas lab'
      AFTER sifat_hasil,
  ADD COLUMN alasan_batal VARCHAR(255) NULL AFTER completed_at,
  ADD COLUMN dibatalkan_by BIGINT UNSIGNED NULL AFTER alasan_batal,
  ADD COLUMN dibatalkan_at DATETIME NULL AFTER dibatalkan_by,
  ADD CONSTRAINT fk_lo_cancel FOREIGN KEY (dibatalkan_by) REFERENCES users(id);

-- Worklist lab menyaring order yang menahan pasien dari yang tidak.
CREATE INDEX ix_lo_sifat ON lab_orders (visit_id, status, sifat_hasil);

-- --- 3. Parameter lab dinonaktifkan, bukan dihapus --------------------
ALTER TABLE lab_parameters
  ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER urutan;
