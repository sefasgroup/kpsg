-- Konsultasi dokter sebagai TINDAKAN, dengan diskon per kebijakan dokter.
--
-- Latar belakang: sebelum ini biaya konsultasi terbit dari DUA tempat —
-- `doctor_profiles.tarif_konsultasi` (otomatis saat asesmen difinalkan) dan
-- tindakan TDK-001 bila dokter memilihnya. Keduanya aktif berarti pasien
-- tertagih konsultasi dua kali. Penagihan otomatis itu kini DIMATIKAN
-- (lihat simpanAsesmen di src/lib/doctor.ts); konsultasi sepenuhnya menjadi
-- baris tindakan supaya dokter bisa menghapus atau mendiskonnya.

-- 1. Penanda tindakan mana yang berperan sebagai konsultasi.
--    Dipakai untuk dua hal: memilih default di form dokter, dan menentukan
--    tindakan mana yang boleh didiskon.
ALTER TABLE medical_procedures
  ADD COLUMN is_konsultasi TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Tindakan konsultasi: ter-select otomatis di form dokter & boleh didiskon'
    AFTER kategori;

-- Tindakan konsultasi yang sudah ada ikut ditandai. Aman dijalankan pada
-- basis data yang belum punya barisnya — tidak ada yang tersentuh.
UPDATE medical_procedures
   SET is_konsultasi = 1
 WHERE kategori = 'Konsultasi' OR nama LIKE 'Konsultasi%';

-- 2. Diskon pada tindakan.
ALTER TABLE assessment_procedures
  ADD COLUMN diskon DECIMAL(14,2) NOT NULL DEFAULT 0
    COMMENT 'Potongan nominal; hanya untuk tindakan konsultasi'
    AFTER tarif,
  ADD COLUMN alasan_diskon VARCHAR(160) NULL
    COMMENT 'Opsional — kebijakan pribadi dokter'
    AFTER diskon,
  -- Diskon tidak boleh melebihi nilai tindakannya. Tanpa batas ini, satu
  -- salah ketik nol menghasilkan subtotal negatif yang justru MENGURANGI
  -- total tagihan pasien — dan itu tidak akan terlihat sampai kasir menutup
  -- kas dan angkanya tidak cocok.
  ADD CONSTRAINT ck_ap_diskon CHECK (diskon >= 0 AND diskon <= qty * tarif);
