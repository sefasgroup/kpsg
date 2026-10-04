# Migrasi basis data

Berkas di folder ini dijalankan **otomatis saat deploy** oleh
`scripts/migrasi.mjs`, setelah build berhasil dan sebelum server di-restart.
Tiap berkas dijalankan **tepat sekali**, urut nama, dan dicatat di tabel
`schema_migrations`. Sebelum ada yang dijalankan, basis data dibackup ke
`../backup-kpsg/pra-migrasi`.

```
npm run db:migrasi                 # jalankan yang tertunda
npm run db:migrasi -- --lihat      # lihat saja
```

## Aturan menulis migrasi baru

1. **Nama berkas** `YYYY-MM-DD-keterangan.sql`. Urutan nama = urutan jalan.
2. **Jangan ubah berkas yang sudah di-deploy.** Ia tidak akan dijalankan lagi;
   koreksi ditulis sebagai migrasi baru.
3. **Harus cocok dengan kode LAMA.** Migrasi jalan saat server masih melayani
   versi sebelumnya, dan tetap terpasang bila deploy gagal sesudahnya. Tambah
   kolom/tabel boleh; menghapus atau mengganti nama kolom yang masih dibaca
   kode lama harus dipecah ke dua deploy.
4. **Ubah juga `db/schema.sql`** dengan isi yang sama, dan tambahkan nama
   berkasnya ke daftar `INSERT INTO schema_migrations` di akhir berkas itu.
   Tanpanya pemasangan baru menjalankan ulang migrasi yang isinya sudah ada.
5. **Tanpa `USE nama_db`** — runner sudah tersambung ke basis data yang benar.

Bila migrasi gagal, deploy berhenti dan server tetap di versi lama. DDL MySQL
tidak bisa di-rollback: periksa pernyataan mana yang sudah terlanjur jalan
sebelum mengulang deploy.
