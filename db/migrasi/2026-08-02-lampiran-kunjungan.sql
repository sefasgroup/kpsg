-- Dokumen pendukung rekam medis, diunggah dokter dari layar pemeriksaan.
--
-- Berkasnya sendiri TIDAK disimpan di database maupun di `public/` — hanya
-- kuncinya yang dicatat di sini. Isinya ada di `storage/rekam/` dan hanya
-- keluar lewat `app/api/berkas/`, yang memeriksa sesi dan hak akses per
-- berkas. Lihat catatan di src/lib/berkas.ts.
--
-- Kategori `rekam` sengaja dipisah dari `lampiran` (yang dipakai lampiran
-- cuti pegawai): aturan siapa yang boleh membacanya sama sekali berbeda.

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
  sha256       CHAR(64) NOT NULL COMMENT 'Untuk mendeteksi unggahan ganda & memverifikasi keutuhan',
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
