-- =====================================================================
--  SIM KLINIK KPSG — Data awal (roles, permissions, master minimal, demo)
--  Jalankan SETELAH schema.sql
-- =====================================================================

SET NAMES utf8mb4;
USE `simklinik_kpsg`;

-- ---------------------------------------------------------------------
-- 1. 7 ROLE (CLAUDE.md §2.1) — tetap, tidak boleh dihapus
-- ---------------------------------------------------------------------
INSERT INTO roles (code, nama, deskripsi) VALUES
  ('super_admin',  'Super Admin',            'Tingkat pusat / IT. Setup cabang, user, master data global.'),
  ('admin_cabang', 'Admin Cabang / HR',      'Operasional harian cabang, jadwal, cuti, dokter pengganti, laporan.'),
  ('dokter',       'Dokter',                 'Wewenang klinis penuh: RME, SOAP, order lab, e-resep.'),
  ('perawat',      'Perawat',                'Eksklusif: antrean, triase, pengkajian awal, BMHP.'),
  ('petugas_lab',  'Petugas Laboratorium',   'Eksklusif: order lab, input hasil, cetak hasil.'),
  ('farmasi',      'Petugas Farmasi/Apotek', 'Eksklusif: inventori, e-resep, racikan, etiket.'),
  ('kasir',        'Kasir / Billing',        'Eksklusif: tagihan, pembayaran, struk. Tanpa akses diagnosa.');

-- ---------------------------------------------------------------------
-- 2. PERMISSIONS — sumber kebenaran untuk generate menu & guard route
-- ---------------------------------------------------------------------
INSERT INTO permissions (code, modul, deskripsi) VALUES
  -- setup
  ('site.manage',        'setup',   'CRUD cabang'),
  ('user.manage',        'setup',   'CRUD pengguna & role'),
  ('masterdata.manage',  'setup',   'CRUD master data global'),
  ('audit.view',         'setup',   'Lihat audit log'),
  ('setting.manage',     'setup',   'Ubah pengaturan sistem'),
  -- hr
  ('schedule.manage',    'hr',      'Kelola jadwal praktik'),
  ('substitute.assign',  'hr',      'Tetapkan dokter pengganti'),
  ('leave.approve',      'hr',      'Setujui cuti/izin'),
  ('attendance.manage',  'hr',      'Kelola absensi'),
  ('report.site',        'hr',      'Laporan performa cabang'),
  ('siteprofile.manage', 'hr',      'Ubah profil cabang'),
  -- pendaftaran
  ('patient.read',       'pendaftaran', 'Cari & lihat data pasien'),
  ('patient.manage',     'pendaftaran', 'Buat & ubah data pasien'),
  ('visit.create',       'pendaftaran', 'Daftarkan kunjungan'),
  ('queue.manage',       'pendaftaran', 'Kelola antrean'),
  -- perawat
  ('queue.call',         'perawat', 'Panggil pasien'),
  ('nurse.assess',       'perawat', 'Input triase, TTV, antropometri'),
  ('bmhp.record',        'perawat', 'Catat pemakaian BMHP'),
  -- dokter
  ('emr.read',           'dokter',  'Baca rekam medis lengkap'),
  ('emr.write',          'dokter',  'Tulis asesmen SOAP & diagnosa'),
  ('procedure.record',   'dokter',  'Input tindakan medis'),
  ('laborder.create',    'dokter',  'Buat order laboratorium'),
  ('prescription.create','dokter',  'Buat e-resep (paten & racikan)'),
  ('certificate.issue',  'dokter',  'Terbitkan surat keterangan'),
  -- lab
  ('laborder.process',   'lab',     'Proses order lab'),
  ('labresult.write',    'lab',     'Input & verifikasi hasil lab'),
  ('labresult.print',    'lab',     'Cetak hasil lab'),
  -- farmasi
  ('prescription.dispense','farmasi','Validasi & serahkan resep'),
  ('racikan.prepare',    'farmasi', 'Siapkan racikan & potong bahan'),
  ('inventory.read',     'farmasi', 'Lihat stok & kartu stok'),
  ('inventory.inbound',  'farmasi', 'Penerimaan barang'),
  ('inventory.outbound', 'farmasi', 'Pengeluaran barang'),
  ('inventory.opname',   'farmasi', 'Stock opname'),
  ('etiket.print',       'farmasi', 'Cetak etiket obat'),
  -- kasir
  ('billing.read',       'kasir',   'Lihat tagihan (tanpa diagnosa)'),
  ('billing.pay',        'kasir',   'Proses pembayaran'),
  ('billing.void',       'kasir',   'Batalkan transaksi'),
  ('billing.print',      'kasir',   'Cetak struk'),
  ('shift.manage',       'kasir',   'Buka & tutup kasir');

-- Pemetaan role -> permission (strict segregation of duties)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE (r.code='super_admin'  AND p.code IN ('site.manage','user.manage','masterdata.manage','audit.view','setting.manage'))
   OR (r.code='admin_cabang' AND p.code IN ('schedule.manage','substitute.assign','leave.approve','attendance.manage','report.site','siteprofile.manage','patient.read','patient.manage','visit.create','queue.manage'))
   OR (r.code='dokter'       AND p.code IN ('patient.read','emr.read','emr.write','procedure.record','laborder.create','prescription.create','certificate.issue'))
   OR (r.code='perawat'      AND p.code IN ('patient.read','queue.call','queue.manage','nurse.assess','bmhp.record'))
   OR (r.code='petugas_lab'  AND p.code IN ('laborder.process','labresult.write','labresult.print'))
   OR (r.code='farmasi'      AND p.code IN ('prescription.dispense','racikan.prepare','inventory.read','inventory.inbound','inventory.outbound','inventory.opname','etiket.print'))
   OR (r.code='kasir'        AND p.code IN ('billing.read','billing.pay','billing.void','billing.print','shift.manage'));

-- ---------------------------------------------------------------------
-- 3. CABANG
-- ---------------------------------------------------------------------
INSERT INTO sites (kode, nama, nama_legal, no_izin_klinik, alamat, kota, provinsi, telepon, email) VALUES
  ('KPSG-01', 'KPSG Pusat', 'Klinik Pratama Sahabat Gamma',
   '440/0001/DPMPTSP/2025', 'Jl. Contoh Raya No. 1', 'Jakarta Selatan', 'DKI Jakarta',
   '021-1234567', 'pusat@sahabatgamma.id');

-- ---------------------------------------------------------------------
-- 4. PENGGUNA DEMO
--    password semua akun: "kpsg12345"
--    hash bcrypt cost 10 — WAJIB diganti sebelum go-live
-- ---------------------------------------------------------------------
SET @pw := '$2b$10$fLuHLNCVkWxvPIbvraRat.zRvQIdC7FUhpDVcCVyNuLQbJ3H5QRAW';
SET @site := (SELECT id FROM sites WHERE kode='KPSG-01');

INSERT INTO users (site_id, role_id, nip, nama, username, email, password_hash, must_change_pw) VALUES
  (NULL,  (SELECT id FROM roles WHERE code='super_admin'),  'SA-001', 'Administrator Sistem',  'superadmin', 'it@sefasgroup.com', @pw, 1),
  (@site, (SELECT id FROM roles WHERE code='admin_cabang'), 'AC-001', 'Rina Kusuma',           'admin',      NULL, @pw, 1),
  (@site, (SELECT id FROM roles WHERE code='dokter'),       'DR-001', 'Rafi Santoso',          'dokter',     NULL, @pw, 1),
  (@site, (SELECT id FROM roles WHERE code='dokter'),       'DR-002', 'Sinta Halim',           'dokter2',    NULL, @pw, 1),
  (@site, (SELECT id FROM roles WHERE code='perawat'),      'PR-001', 'Dewi Lestari',          'perawat',    NULL, @pw, 1),
  (@site, (SELECT id FROM roles WHERE code='petugas_lab'),  'LB-001', 'Agus Prasetyo',         'lab',        NULL, @pw, 1),
  (@site, (SELECT id FROM roles WHERE code='farmasi'),      'AP-001', 'Maya Anggraini',        'farmasi',    NULL, @pw, 1),
  (@site, (SELECT id FROM roles WHERE code='kasir'),        'KS-001', 'Budi Hartono',          'kasir',      NULL, @pw, 1);

INSERT INTO doctor_profiles (user_id, no_str, no_sip, spesialisasi, gelar_depan, tarif_konsultasi) VALUES
  ((SELECT id FROM users WHERE username='dokter'),  'STR-1234567', 'SIP-001/2026', 'Dokter Umum', 'dr.', 50000),
  ((SELECT id FROM users WHERE username='dokter2'), 'STR-7654321', 'SIP-002/2026', 'Dokter Umum', 'dr.', 50000);

-- ---------------------------------------------------------------------
-- 5. MASTER DATA MINIMAL
-- ---------------------------------------------------------------------
INSERT INTO polis (site_id, kode, nama, prefix_antrean) VALUES
  (@site, 'UMUM', 'Poli Umum',  'A'),
  (@site, 'GIGI', 'Poli Gigi',  'B'),
  (@site, 'KIA',  'Poli KIA',   'C');

INSERT INTO icd10_codes (code, nama_id, nama_en, bab) VALUES
  ('J06.9', 'Infeksi saluran napas atas akut, tidak spesifik', 'Acute upper respiratory infection, unspecified', 'Penyakit Sistem Pernapasan'),
  ('K30',   'Dispepsia',                                        'Functional dyspepsia', 'Penyakit Sistem Pencernaan'),
  ('I10',   'Hipertensi esensial (primer)',                     'Essential (primary) hypertension', 'Penyakit Sistem Sirkulasi'),
  ('E11.9', 'Diabetes melitus tipe 2 tanpa komplikasi',         'Type 2 diabetes mellitus without complications', 'Endokrin & Metabolik'),
  ('A09',   'Diare dan gastroenteritis diduga infeksi',         'Infectious gastroenteritis and colitis, unspecified', 'Penyakit Infeksi'),
  ('R50.9', 'Demam, tidak spesifik',                            'Fever, unspecified', 'Gejala & Tanda'),
  ('J00',   'Nasofaringitis akut (common cold)',                'Acute nasopharyngitis', 'Penyakit Sistem Pernapasan'),
  ('L23.9', 'Dermatitis kontak alergi, penyebab tidak spesifik','Allergic contact dermatitis, unspecified cause', 'Penyakit Kulit'),
  ('M54.5', 'Nyeri punggung bawah',                             'Low back pain', 'Muskuloskeletal'),
  ('Z00.0', 'Pemeriksaan kesehatan umum',                       'General medical examination', 'Faktor Status Kesehatan');

-- `is_konsultasi` menandai tindakan yang ter-select otomatis di form dokter
-- dan satu-satunya yang boleh didiskon. Tanpa satu pun baris bertanda, form
-- dokter tampil tanpa tindakan bawaan — bukan galat, tetapi konsultasi jadi
-- harus dipilih manual setiap kali.
INSERT INTO medical_procedures (kode, nama, kategori, is_konsultasi, tarif) VALUES
  ('TDK-001', 'Konsultasi Dokter Umum',      'Konsultasi', 1, 50000),
  ('TDK-002', 'Perawatan Luka Ringan',       'Tindakan',   0,  75000),
  ('TDK-003', 'Perawatan Luka Sedang',       'Tindakan',   0, 150000),
  ('TDK-004', 'Injeksi Intramuskular',       'Tindakan',   0,  35000),
  ('TDK-005', 'Nebulizer',                   'Tindakan',   0,  65000),
  ('TDK-006', 'Pemasangan Infus',            'Tindakan',   0, 100000),
  ('TDK-007', 'Ekstraksi Kuku',              'Tindakan',   0, 250000),
  ('TDK-008', 'Hecting (per jahitan)',       'Tindakan',   0,  40000),
  ('TDK-009', 'Tindik / Insisi Abses',       'Tindakan',   0, 200000),
  ('TDK-010', 'EKG',                         'Penunjang',  0,  85000);

INSERT INTO lab_panels (kode, nama, kategori, tarif) VALUES
  ('LAB-HDL', 'Hematologi Lengkap', 'Hematologi',    85000),
  ('LAB-GDS', 'Gula Darah Sewaktu', 'Kimia Klinik',  25000),
  ('LAB-GDP', 'Gula Darah Puasa',   'Kimia Klinik',  25000),
  ('LAB-CHO', 'Profil Lipid',       'Kimia Klinik', 120000),
  ('LAB-UA',  'Asam Urat',          'Kimia Klinik',  35000),
  ('LAB-URN', 'Urinalisa Lengkap',  'Urinalisa',     55000);

INSERT INTO lab_parameters (panel_id, kode, nama, satuan, tipe_nilai, ref_low, ref_high, ref_teks, kritis_low, kritis_high, urutan) VALUES
  ((SELECT id FROM lab_panels WHERE kode='LAB-HDL'), 'HB',   'Hemoglobin',  'g/dL',    'numerik', 13.0, 17.0, '13,0 - 17,0',  7.0, 20.0, 1),
  ((SELECT id FROM lab_panels WHERE kode='LAB-HDL'), 'HT',   'Hematokrit',  '%',       'numerik', 40.0, 54.0, '40 - 54',      20.0, 60.0, 2),
  ((SELECT id FROM lab_panels WHERE kode='LAB-HDL'), 'LEU',  'Leukosit',    '10^3/uL', 'numerik',  4.0, 10.0, '4,0 - 10,0',    1.0, 30.0, 3),
  ((SELECT id FROM lab_panels WHERE kode='LAB-HDL'), 'TRO',  'Trombosit',   '10^3/uL', 'numerik',150.0,450.0, '150 - 450',    50.0, 1000.0, 4),
  ((SELECT id FROM lab_panels WHERE kode='LAB-HDL'), 'ERI',  'Eritrosit',   '10^6/uL', 'numerik',  4.5,  5.9, '4,5 - 5,9',    NULL, NULL, 5),
  ((SELECT id FROM lab_panels WHERE kode='LAB-GDS'), 'GDS',  'Glukosa Sewaktu','mg/dL','numerik', 70.0,200.0, '< 200',        40.0, 400.0, 1),
  ((SELECT id FROM lab_panels WHERE kode='LAB-GDP'), 'GDP',  'Glukosa Puasa',  'mg/dL','numerik', 70.0,100.0, '70 - 100',     40.0, 400.0, 1),
  ((SELECT id FROM lab_panels WHERE kode='LAB-CHO'), 'CHOL', 'Kolesterol Total','mg/dL','numerik',NULL,200.0, '< 200',        NULL, NULL, 1),
  ((SELECT id FROM lab_panels WHERE kode='LAB-CHO'), 'TG',   'Trigliserida',   'mg/dL','numerik',NULL,150.0, '< 150',        NULL, NULL, 2),
  ((SELECT id FROM lab_panels WHERE kode='LAB-CHO'), 'HDLC', 'HDL',            'mg/dL','numerik',40.0, NULL, '> 40',         NULL, NULL, 3),
  ((SELECT id FROM lab_panels WHERE kode='LAB-CHO'), 'LDLC', 'LDL',            'mg/dL','numerik',NULL,100.0, '< 100',        NULL, NULL, 4),
  ((SELECT id FROM lab_panels WHERE kode='LAB-UA'),  'UA',   'Asam Urat',      'mg/dL','numerik', 3.4,  7.0, '3,4 - 7,0',    NULL, NULL, 1),
  ((SELECT id FROM lab_panels WHERE kode='LAB-URN'), 'UWRN', 'Warna',          NULL,   'teks',   NULL, NULL, 'Kuning jernih',NULL, NULL, 1),
  ((SELECT id FROM lab_panels WHERE kode='LAB-URN'), 'UPRO', 'Protein',        NULL,   'pilihan',NULL, NULL, 'Negatif',      NULL, NULL, 2),
  ((SELECT id FROM lab_panels WHERE kode='LAB-URN'), 'UGLU', 'Glukosa Urin',   NULL,   'pilihan',NULL, NULL, 'Negatif',      NULL, NULL, 3);

UPDATE lab_parameters SET pilihan = JSON_ARRAY('Negatif','+1','+2','+3','+4')
 WHERE kode IN ('UPRO','UGLU');

INSERT INTO item_categories (nama, tipe) VALUES
  ('Analgesik & Antipiretik','obat'), ('Antibiotik','obat'), ('Antihistamin','obat'),
  ('Antasida & Saluran Cerna','obat'), ('Antihipertensi','obat'), ('Antidiabetes','obat'),
  ('Ekspektoran & Mukolitik','obat'), ('Vitamin & Suplemen','obat'), ('Kortikosteroid','obat'),
  ('Bahan Racikan','obat'),
  ('Habis Pakai Umum','bmhp'), ('Perawatan Luka','bmhp'), ('Injeksi & Infus','bmhp');

INSERT INTO items (kode, tipe, nama, nama_generik, category_id, bentuk_sediaan, satuan_dasar, hpp, harga_jual, min_stock, is_racikable, butuh_resep) VALUES
  ('OBT-001','obat','Paracetamol 500 mg','Paracetamol',(SELECT id FROM item_categories WHERE nama='Analgesik & Antipiretik'),'Tablet','tablet',  350,   500, 100, 1, 0),
  ('OBT-002','obat','Amoxicillin 500 mg','Amoxicillin',(SELECT id FROM item_categories WHERE nama='Antibiotik'),             'Kapsul','kapsul', 1800,  2500,  60, 1, 1),
  ('OBT-003','obat','Ambroxol 30 mg','Ambroxol',       (SELECT id FROM item_categories WHERE nama='Ekspektoran & Mukolitik'),'Tablet','tablet',  850,  1200,  60, 1, 1),
  ('OBT-004','obat','Cetirizine 10 mg','Cetirizine',   (SELECT id FROM item_categories WHERE nama='Antihistamin'),           'Tablet','tablet', 1000,  1500,  50, 1, 1),
  ('OBT-005','obat','CTM 4 mg','Chlorpheniramine',     (SELECT id FROM item_categories WHERE nama='Antihistamin'),           'Tablet','tablet',  150,   300, 100, 1, 1),
  ('OBT-006','obat','Omeprazole 20 mg','Omeprazole',   (SELECT id FROM item_categories WHERE nama='Antasida & Saluran Cerna'),'Kapsul','kapsul',2100,  3000,  40, 0, 1),
  ('OBT-007','obat','Amlodipine 5 mg','Amlodipine',    (SELECT id FROM item_categories WHERE nama='Antihipertensi'),         'Tablet','tablet', 1200,  1800,  40, 0, 1),
  ('OBT-008','obat','Metformin 500 mg','Metformin',    (SELECT id FROM item_categories WHERE nama='Antidiabetes'),           'Tablet','tablet',  550,   800,  40, 0, 1),
  ('OBT-009','obat','Dexamethasone 0,5 mg','Dexamethasone',(SELECT id FROM item_categories WHERE nama='Kortikosteroid'),     'Tablet','tablet',  200,   400,  60, 1, 1),
  ('OBT-010','obat','Vitamin B Kompleks','Vitamin B Complex',(SELECT id FROM item_categories WHERE nama='Vitamin & Suplemen'),'Tablet','tablet', 300,   600,  80, 1, 0),
  ('OBT-011','obat','Laktosa (bahan pengisi)','Lactose',(SELECT id FROM item_categories WHERE nama='Bahan Racikan'),         'Serbuk','gram',    500,   700, 200, 1, 0),
  ('OBT-012','obat','Cangkang Kapsul No. 2','Empty Capsule',(SELECT id FROM item_categories WHERE nama='Bahan Racikan'),     'Kapsul','kapsul',  100,   200, 300, 1, 0),
  ('BMP-001','bmhp','Kapas Alkohol (per lembar)',NULL,(SELECT id FROM item_categories WHERE nama='Habis Pakai Umum'),NULL,'lembar',  200,   500, 200, 0, 0),
  ('BMP-002','bmhp','Plester Luka',NULL,             (SELECT id FROM item_categories WHERE nama='Perawatan Luka'),  NULL,'lembar',  500,  1000, 100, 0, 0),
  ('BMP-003','bmhp','Kasa Steril 5x5',NULL,          (SELECT id FROM item_categories WHERE nama='Perawatan Luka'),  NULL,'lembar', 1500,  2500, 100, 0, 0),
  ('BMP-004','bmhp','Handscoon Non-Steril (pasang)',NULL,(SELECT id FROM item_categories WHERE nama='Habis Pakai Umum'),NULL,'pasang',1200,2000, 200, 0, 0),
  ('BMP-005','bmhp','Spuit 3cc',NULL,                (SELECT id FROM item_categories WHERE nama='Injeksi & Infus'), NULL,'pcs',    2000,  3500,  80, 0, 0),
  ('BMP-006','bmhp','Povidone Iodine 10% (per ml)',NULL,(SELECT id FROM item_categories WHERE nama='Perawatan Luka'),NULL,'ml',     150,   300, 500, 0, 0),
  ('BMP-007','bmhp','Masker Medis',NULL,             (SELECT id FROM item_categories WHERE nama='Habis Pakai Umum'),NULL,'pcs',     800,  1500, 200, 0, 0);

-- Saldo stok awal cabang pusat.
--
-- Saldo awal WAJIB ikut ditulis ke kartu stok, bukan hanya ke cache.
-- `item_stocks` hanyalah cache; kebenarannya ada di `stock_movements`
-- (docs/DATABASE.md §3.3). Bila saldo awal tidak punya baris ledger,
-- rekonsiliasi selamanya menunjukkan selisih sebesar saldo awal — dan
-- alat untuk menemukan kebocoran stok jadi tidak bisa dipakai sejak
-- hari pertama.
SET @apoteker = (SELECT id FROM users WHERE username = 'farmasi');

INSERT INTO item_stocks (site_id, item_id, qty_on_hand)
SELECT @site, id, 250 FROM items;

INSERT INTO stock_movements
  (site_id, item_id, jenis, qty, qty_delta, qty_after, hpp, ref_type, catatan, created_by)
SELECT @site, id, 'masuk_koreksi', 250, 250, 250, hpp, 'saldo_awal',
       'Saldo awal implementasi sistem', @apoteker
  FROM items;

-- ---------------------------------------------------------------------
-- 6. PENGATURAN DEFAULT
-- ---------------------------------------------------------------------
INSERT INTO settings (site_id, skey, svalue, tipe) VALUES
  (NULL,  'app.nama',                'SIM Klinik Sahabat Gamma', 'string'),
  (NULL,  'app.versi_dokumen',       '2.5',                       'string'),
  (@site, 'billing.pembulatan',      '100',                       'number'),
  (@site, 'billing.paket',           '125000,130000,170000,175000', 'string'),
  (@site, 'billing.biaya_admin',     '0',                         'number'),
  (@site, 'racikan.jasa_racik_default','5000',                    'number'),
  (@site, 'antrean.reset_harian',    'true',                      'boolean'),
  (@site, 'stok.peringatan_kadaluarsa_hari','90',                 'number'),
  (@site, 'cetak.printer_thermal',   '80',                        'number');

-- Inisialisasi penomoran
INSERT INTO sequences (site_id, seq_key, periode, last_number) VALUES
  (@site, 'rm',      '-', 0),
  (@site, 'visit',   '-', 0),
  (@site, 'resep',   '-', 0),
  (@site, 'invoice', '-', 0),
  (@site, 'lab',     '-', 0),
  (@site, 'surat',   '-', 0),
  (@site, 'penerimaan', '-', 0),
  (@site, 'opname',     '-', 0);

-- Supplier awal untuk penerimaan barang
INSERT INTO suppliers (kode, nama, kontak, telepon, alamat) VALUES
  ('SUP-KF',  'PT Kimia Farma Trading & Distribution', 'Bagian Penjualan', '021-5501234', 'Jl. Budi Utomo No. 1, Jakarta Pusat'),
  ('SUP-APL', 'PT Anugrah Pharmindo Lestari',          'Customer Service', '021-4609999', 'Jl. Pulo Kambing II, Jakarta Timur'),
  ('SUP-BSP', 'PT Bina San Prima',                     'Sales Farmasi',    '022-6030222', 'Jl. Purnawarman No. 47, Bandung');
