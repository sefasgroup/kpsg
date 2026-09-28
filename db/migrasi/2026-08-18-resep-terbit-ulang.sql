-- =====================================================================
-- Resep yang dibatalkan harus bisa diterbitkan ulang.
--
-- MASALAH YANG DITUTUP MIGRASI INI
--
-- `uq_rx_visit (visit_id)` mengunci SATU baris resep per kunjungan, tanpa
-- memandang statusnya. Komentarnya sendiri berbunyi "revisi lewat
-- pembatalan + resep baru" — dan justru itulah yang dilarangnya: begitu
-- resep dibatalkan, `simpanResep()` masuk ke cabang INSERT dan gagal dengan
--
--     Duplicate entry '<visit_id>' for key 'prescriptions.uq_rx_visit'
--
-- Pesan galat yang dilihat dokter saat mencoba mengubah resep yang sudah
-- diterima farmasi berbunyi "Batalkan resep lalu terbitkan resep baru".
-- Mengikuti petunjuk itu membawanya ke galat MySQL mentah.
--
-- CARA MEMPERBAIKINYA
--
-- Aturan yang sebenarnya diinginkan bukan "satu baris per kunjungan"
-- melainkan "satu resep BERJALAN per kunjungan". MySQL tidak punya partial
-- index, jadi aturan itu ditulis lewat kolom turunan: `visit_aktif` berisi
-- `visit_id` selama resepnya hidup, dan NULL begitu dibatalkan — dan NULL
-- tidak pernah bentrok dengan NULL pada indeks unik.
--
-- Resep yang dibatalkan karena itu TETAP TERSIMPAN lengkap dengan
-- `no_resep`, `alasan_batal`, dan seluruh itemnya. Menimpa barisnya akan
-- jauh lebih mudah, dan akan menghapus jejak resep yang pernah dituliskan
-- untuk seorang pasien — persis hal yang tidak boleh hilang dari rekam
-- medis.
-- =====================================================================

ALTER TABLE prescriptions
  ADD COLUMN visit_aktif BIGINT UNSIGNED
    GENERATED ALWAYS AS (IF(status <> 'batal', visit_id, NULL)) STORED
    COMMENT 'visit_id selama resep hidup, NULL bila batal — dasar uq_rx_visit_aktif';

-- Indeks biasa dipasang LEBIH DULU. `fk_rx_visit` bersandar pada
-- `uq_rx_visit` sebagai indeks penopangnya, sehingga menjatuhkannya tanpa
-- pengganti ditolak MySQL:
--   Cannot drop index 'uq_rx_visit': needed in a foreign key constraint
ALTER TABLE prescriptions
  ADD KEY ix_rx_visit (visit_id);

ALTER TABLE prescriptions
  DROP INDEX uq_rx_visit,
  ADD UNIQUE KEY uq_rx_visit_aktif (visit_aktif)
    COMMENT 'Satu resep BERJALAN per kunjungan; yang dibatalkan boleh menumpuk sebagai riwayat';
