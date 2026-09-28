-- =====================================================================
--  DATA CONTOH — hanya untuk pengembangan & demo UI.
--  JANGAN dijalankan di lingkungan produksi.
--
--  Jalankan setelah schema.sql + seed.sql:
--    mysql -u root < db/seed-demo.sql
--
--  Membersihkannya kembali (urutannya penting - anak sebelum induk):
--    DELETE FROM queues
--    DELETE FROM visits
--    DELETE FROM patient_allergies
--    DELETE FROM patients
-- =====================================================================

SET NAMES utf8mb4;
USE `simklinik_kpsg`;

SET @site  := (SELECT id FROM sites WHERE kode = 'KPSG-01');
SET @poli  := (SELECT id FROM polis WHERE kode = 'UMUM' AND site_id = @site);
SET @dok   := (SELECT id FROM users WHERE username = 'dokter');
SET @admin := (SELECT id FROM users WHERE username = 'admin');

INSERT INTO patients
  (site_id, no_rm, nik, nama, tempat_lahir, tanggal_lahir, jenis_kelamin,
   gol_darah, alamat, kota, telepon, jenis_pasien, no_bpjs, created_by)
VALUES
  (@site, 'KPSG-01-000001', '3201234567890001', 'Budi Santoso', 'Bogor',
   '1986-03-11', 'L', 'B', 'Jl. Mawar No. 12', 'Jakarta Selatan',
   '081234567890', 'umum', NULL, @admin),
  (@site, 'KPSG-01-000002', '3201234567890002', 'Siti Aminah', 'Depok',
   '1994-11-02', 'P', 'O', 'Jl. Melati No. 5', 'Depok',
   '081298765432', 'bpjs', '0001234567890', @admin),
  (@site, 'KPSG-01-000003', '3201234567890003', 'Ahmad Fauzi', 'Bekasi',
   '2018-07-24', 'L', 'A', 'Jl. Kenanga No. 8', 'Bekasi',
   '081211112222', 'umum', NULL, @admin);

-- Alergi tampil sebagai pita merah persisten di header pasien
-- (docs/DESIGN-SYSTEM.md §3.1) dan tidak bisa ditutup.
INSERT INTO patient_allergies (patient_id, jenis, nama_alergen, reaksi, keparahan, recorded_by)
VALUES
  ((SELECT id FROM patients WHERE nik = '3201234567890001'),
   'obat', 'Penisilin', 'Ruam & sesak napas', 'berat', @admin),
  ((SELECT id FROM patients WHERE nik = '3201234567890003'),
   'makanan', 'Udang', 'Gatal-gatal', 'sedang', @admin);

-- Sinkronkan penomoran agar pendaftaran berikutnya lanjut dari 000003
INSERT INTO sequences (site_id, seq_key, periode, last_number)
VALUES (@site, 'rm', '-', 3)
ON DUPLICATE KEY UPDATE last_number = GREATEST(last_number, 3);

INSERT INTO visits
  (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
   jenis_kunjungan, cara_bayar, status, registered_by)
VALUES
  (@site, (SELECT id FROM patients WHERE nik='3201234567890001'),
   'KPSG-01/V/DEMO/00001', CURDATE(), @poli, @dok, 'baru', 'umum', 'menunggu_perawat', @admin),
  (@site, (SELECT id FROM patients WHERE nik='3201234567890002'),
   'KPSG-01/V/DEMO/00002', CURDATE(), @poli, @dok, 'baru', 'bpjs', 'menunggu_perawat', @admin),
  (@site, (SELECT id FROM patients WHERE nik='3201234567890003'),
   'KPSG-01/V/DEMO/00003', CURDATE(), @poli, @dok, 'baru', 'umum', 'menunggu_dokter', @admin);

INSERT INTO queues (site_id, visit_id, poli_id, tanggal, prefix, nomor)
SELECT @site, v.id, @poli, CURDATE(), 'A',
       ROW_NUMBER() OVER (ORDER BY v.id)
  FROM visits v
 WHERE v.no_visit LIKE 'KPSG-01/V/DEMO/%';

-- Pasien keempat: sudah selesai diperiksa dokter dan menunggu apotek.
-- Dipakai untuk mendemokan layar penyiapan resep + cetak etiket.
INSERT INTO patients
  (site_id, no_rm, nik, nama, tempat_lahir, tanggal_lahir, jenis_kelamin,
   gol_darah, alamat, kota, telepon, jenis_pasien, created_by)
VALUES
  (@site, 'KPSG-01-000004', '3201234567890004', 'Rina Marlina', 'Jakarta',
   '1991-06-30', 'P', 'A', 'Jl. Anggrek No. 21', 'Jakarta Selatan',
   '081377778888', 'umum', @admin);

UPDATE sequences SET last_number = GREATEST(last_number, 4)
 WHERE site_id = @site AND seq_key = 'rm' AND periode = '-';

INSERT INTO visits
  (site_id, patient_id, no_visit, tanggal, poli_id, doctor_id,
   jenis_kunjungan, cara_bayar, status, registered_by)
VALUES
  (@site, (SELECT id FROM patients WHERE nik = '3201234567890004'),
   'KPSG-01/V/DEMO/00004', CURDATE(), @poli, @dok, 'baru', 'umum',
   'menunggu_farmasi', @admin);

SET @visit4 := (SELECT id FROM visits WHERE no_visit = 'KPSG-01/V/DEMO/00004');

INSERT INTO nurse_assessments
  (visit_id, site_id, nurse_id, triase, keluhan_utama,
   td_sistolik, td_diastolik, nadi, respirasi, suhu, spo2, kesadaran,
   berat_badan, tinggi_badan, skala_nyeri)
VALUES
  (@visit4, @site, (SELECT id FROM users WHERE username = 'perawat'),
   'hijau', 'Nyeri ulu hati dan batuk berdahak',
   118, 76, 82, 18, 36.8, 98, 'compos_mentis', 58, 160, 3);

INSERT INTO medical_assessments
  (visit_id, site_id, doctor_id, subjective, objective, assessment, plan,
   status, finalized_at)
VALUES
  (@visit4, @site, @dok,
   'Nyeri ulu hati sejak 5 hari, memberat setelah makan pedas. Batuk berdahak 3 hari.',
   'Abdomen: nyeri tekan epigastrium. Paru: ronki basah halus kedua lapang bawah.',
   'Dispepsia fungsional dengan ISPA', 'Terapi simptomatik, kontrol bila memberat.',
   'final', NOW());

INSERT INTO assessment_diagnoses (assessment_id, icd10_code, tipe)
SELECT id, 'K30', 'primer'   FROM medical_assessments WHERE visit_id = @visit4
UNION ALL
SELECT id, 'J06.9', 'sekunder' FROM medical_assessments WHERE visit_id = @visit4;

-- E-Resep: satu obat paten + satu racikan (struktur parent-child lengkap)
INSERT INTO prescriptions
  (site_id, visit_id, no_resep, doctor_id, catatan_umum, status)
VALUES
  (@site, @visit4, 'KPSG-01/R/DEMO/00001', @dok,
   'Puyer dibuat terpisah, jangan dicampur dengan omeprazole.', 'baru');

SET @rx := (SELECT id FROM prescriptions WHERE no_resep = 'KPSG-01/R/DEMO/00001');

INSERT INTO prescription_items
  (prescription_id, item_id, qty, satuan, aturan_pakai, harga_satuan, subtotal, urutan)
SELECT @rx, i.id, 10, 'kapsul',
       '1 x sehari 1 kapsul sebelum makan', i.harga_jual, 10 * i.harga_jual, 0
  FROM items i WHERE i.kode = 'OBT-006';

INSERT INTO prescription_racikans
  (prescription_id, nama_racikan, bentuk_sediaan, qty_jadi, satuan_jadi,
   aturan_pakai, biaya_jasa_racik, urutan)
VALUES
  (@rx, 'Puyer Batuk Dewasa', 'puyer', 12, 'bungkus',
   '3 x sehari 1 bungkus sesudah makan', 5000, 0);

SET @racikan := (SELECT id FROM prescription_racikans WHERE prescription_id = @rx);

-- Jumlah bahan adalah untuk KESELURUHAN racikan (12 bungkus), bukan per bungkus.
INSERT INTO prescription_racikan_ingredients
  (racikan_id, item_id, qty_bahan, satuan, harga_satuan, subtotal)
SELECT @racikan, i.id, x.qty, 'tablet', i.harga_jual, x.qty * i.harga_jual
  FROM items i
  JOIN (SELECT 'OBT-001' AS kode, 6 AS qty
        UNION ALL SELECT 'OBT-003', 4
        UNION ALL SELECT 'OBT-005', 3) x ON x.kode = i.kode;

INSERT INTO queues (site_id, visit_id, poli_id, tanggal, prefix, nomor)
VALUES (@site, @visit4, @poli, CURDATE(), 'A', 4);

-- Pengkajian perawat untuk pasien ketiga (yang berstatus `menunggu_dokter`),
-- supaya panel TTV di layar dokter ada isinya saat demo.
-- Nilainya sengaja abnormal agar penandaan merah terlihat:
-- suhu 38,4 °C · SpO2 94% · IMT 16,2 (anak kurus).
INSERT INTO nurse_assessments
  (visit_id, site_id, nurse_id, triase, keluhan_utama, riwayat_singkat,
   td_sistolik, td_diastolik, nadi, respirasi, suhu, spo2, kesadaran,
   berat_badan, tinggi_badan, skala_nyeri, risiko_jatuh)
SELECT v.id, @site, (SELECT id FROM users WHERE username = 'perawat'),
       'kuning', 'Demam tinggi 3 hari, batuk berdahak', 'Belum pernah kejang demam',
       135, 85, 110, 26, 38.4, 94, 'compos_mentis',
       22.5, 118, 4, 'rendah'
  FROM visits v
 WHERE v.no_visit = 'KPSG-01/V/DEMO/00003';
