-- Pembulatan paket di kasir (billing.paket).
--
-- OPSIONAL: tanpa baris ini kasir tetap memakai nilai bawaan
-- 125000,130000,170000,175000. Baris ini hanya diperlukan supaya nilainya
-- bisa diubah lewat layar Pengaturan. Aman diulang.
INSERT INTO settings (site_id, skey, svalue, tipe)
SELECT s.id, 'billing.paket', '125000,130000,170000,175000', 'string'
  FROM sites s
 WHERE s.deleted_at IS NULL
ON DUPLICATE KEY UPDATE site_id = settings.site_id;
