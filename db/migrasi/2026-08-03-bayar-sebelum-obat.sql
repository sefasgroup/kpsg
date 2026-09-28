-- Alur baru: pasien MEMBAYAR sebelum obat diserahkan.
--
--   Dokter → Farmasi (validasi: kunci stok & harga)
--          → Kasir (bayar)
--          → Farmasi (serahkan: potong stok, cetak etiket)
--          → Selesai
--
-- Sebelum ini farmasi menyerahkan obat LEBIH DULU, lalu pasien mengantre
-- lagi di kasir. Dua akibatnya: pasien mengantre dua kali setelah dokter,
-- dan obat keluar dari gudang sebelum dibayar.
--
-- Kunci perubahannya: PEMOTONGAN STOK DAN PENAGIHAN DIPISAH. Farmasi
-- mengunci (mereservasi) stok dan menghargai resep saat validasi; stok baru
-- benar-benar berkurang saat obat diserahkan. Tanpa reservasi, pasien yang
-- sudah membayar bisa menemukan stoknya habis terpakai resep lain.

-- 1. Tahap baru: sudah bayar, menunggu obat diambil di farmasi.
ALTER TABLE visits
  MODIFY COLUMN status ENUM(
    'terdaftar','menunggu_perawat','dikaji_perawat',
    'menunggu_dokter','dalam_pemeriksaan',
    'menunggu_lab','menunggu_farmasi','menunggu_kasir','menunggu_obat',
    'selesai','batal'
  ) NOT NULL DEFAULT 'terdaftar';

-- 2. Stok terreservasi.
--
--    `qty_on_hand` TIDAK dikurangi saat reservasi — barangnya masih ada di
--    rak. Yang berkurang adalah jumlah yang boleh dijanjikan ke pasien lain:
--    tersedia = qty_on_hand - qty_reserved.
ALTER TABLE item_stocks
  ADD COLUMN qty_reserved DECIMAL(14,3) NOT NULL DEFAULT 0
    COMMENT 'Dikunci untuk resep yang sudah divalidasi & menunggu dibayar/diambil'
    AFTER qty_on_hand,
  ADD CONSTRAINT ck_is_reserved CHECK (qty_reserved >= 0);

-- 3. Penanda apakah satu resep sedang memegang reservasi.
--
--    Penanda eksplisit, bukan disimpulkan dari status resep: reservasi harus
--    dilepas TEPAT sekali. Menyimpulkannya dari status membuat pelepasan
--    ganda mungkin terjadi bila ada dua jalur yang mengubah status.
ALTER TABLE prescriptions
  ADD COLUMN stok_direservasi TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Resep ini sedang mengunci stok; dilepas saat diserahkan atau dibatalkan'
    AFTER status;
