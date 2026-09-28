-- SOAP terstruktur di form dokter.
--
-- Sebelum ini S/O/A/P hanya empat kotak teks bebas. Rekam medis yang isinya
-- narasi lepas sulit dibaca ulang oleh dokter lain, tidak bisa ditarik jadi
-- laporan, dan tidak siap untuk pemetaan SatuSehat (CLAUDE.md §6).
--
-- CATATAN PENTING soal kolom yang "dari perawat":
-- keluhan utama, riwayat penyakit, riwayat pengobatan, dan keadaan umum/gizi
-- juga ada di `nurse_assessments`. Kolom di sini adalah SALINAN MILIK DOKTER,
-- bukan penggantinya. Form dokter mengisinya dari catatan perawat, lalu dokter
-- boleh menyuntingnya — dan suntingan itu TIDAK pernah menimpa catatan
-- perawat. Keduanya adalah pernyataan dua orang berbeda pada dua tahap
-- berbeda; menimpa yang satu dengan yang lain menghapus jejak siapa mencatat
-- apa, padahal justru itu yang dicari saat rekam medis dipersoalkan.

ALTER TABLE medical_assessments
  -- S — Subjective
  ADD COLUMN jenis_anamnesis ENUM('auto','allo') NULL
    COMMENT 'auto = dari pasien sendiri; allo = dari pengantar/keluarga'
    AFTER doctor_id,
  ADD COLUMN sumber_anamnesis VARCHAR(120) NULL
    COMMENT 'Wajib bila alloanamnesis, mis. "Ibu kandung"'
    AFTER jenis_anamnesis,
  ADD COLUMN keluhan_utama TEXT NULL AFTER subjective,
  ADD COLUMN riwayat_penyakit TEXT NULL AFTER keluhan_utama,
  ADD COLUMN riwayat_pengobatan TEXT NULL AFTER riwayat_penyakit,
  ADD COLUMN riwayat_alergi TEXT NULL AFTER riwayat_pengobatan,

  -- O — Objective
  ADD COLUMN keadaan_umum ENUM('baik','sedang','buruk') NULL AFTER objective,
  ADD COLUMN keadaan_gizi ENUM('baik','kurang','buruk') NULL AFTER keadaan_umum,
  ADD COLUMN status_lokalis TEXT NULL
    COMMENT 'JSON: {catatan, titik:[{sisi,x,y,keterangan}]} — titik pada body diagram'
    AFTER keadaan_gizi,

  -- P — Plan
  ADD COLUMN terapi TEXT NULL COMMENT 'Tatalaksana non-resep' AFTER plan;

-- Diagnosa banding. `komplikasi` dipertahankan agar asesmen lama tetap sah.
ALTER TABLE assessment_diagnoses
  MODIFY COLUMN tipe ENUM('primer','sekunder','komplikasi','banding')
    NOT NULL DEFAULT 'primer'
    COMMENT 'primer = diagnosa utama; banding = diagnosa banding (belum ditegakkan)';
