-- Penanda "perlu didahulukan" yang diisi Pendaftaran saat pasien datang.
--
-- Kenapa di `visits` dan bukan mengandalkan `nurse_assessments.triase`:
-- triase baru ada SETELAH perawat memeriksa pasien. Pada saat perawat memilih
-- siapa yang dipanggil berikutnya, triase seluruh pasien yang menunggu masih
-- NULL — mengurutkan dengannya berarti mengurutkan dengan data yang belum ada.
-- Penanda ini diisi oleh petugas yang bertemu pasien PALING AWAL.
--
-- Ini BUKAN triase. Petugas pendaftaran tidak melakukan penilaian klinis; ia
-- hanya menandai bahwa kondisi pasien terlihat tidak bisa menunggu antrean.
-- Penilaian klinis tetap wewenang perawat lewat kolom triase.

ALTER TABLE visits
  ADD COLUMN didahulukan TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Ditandai Pendaftaran; menaikkan pasien di antrean perawat & dokter'
    AFTER rujukan_dari,
  ADD COLUMN alasan_didahulukan VARCHAR(160) NULL
    COMMENT 'Wajib bila didahulukan = 1, mis. "Sesak napas, tampak pucat"'
    AFTER didahulukan,
  -- Penanda tanpa alasan tidak bisa dipertanggungjawabkan, dan perawat yang
  -- memanggil tidak tahu apa yang harus dilihat lebih dulu.
  ADD CONSTRAINT ck_v_didahulukan
    CHECK (didahulukan = 0 OR alasan_didahulukan IS NOT NULL);
