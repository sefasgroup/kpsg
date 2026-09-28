/**
 * Templat & label persetujuan — modul NETRAL, aman diimpor Client Component.
 *
 * Dipisah dari `lib/kepatuhan.ts` dengan alasan yang sama seperti
 * `*-labels.ts` lainnya: modul itu `server-only` dan menarik mysql2, jadi
 * mengimpornya dari komponen klien akan menyeret driver database ke bundel
 * browser.
 *
 * Templat disimpan sebagai konstanta kode, BUKAN tabel master. Yang
 * tersimpan di `consents.isi` adalah kalimat utuh hasil isian, sehingga
 * dokumen yang sudah ditandatangani tidak pernah merujuk templat ini.
 * Sebuah tabel master hanya akan memberi kesan bahwa mengubah templat
 * mengubah dokumen lama — kesan yang justru harus dihindari.
 */

export const JENIS_CONSENT = ["umum", "tindakan", "penolakan", "privasi"] as const;

export const LABEL_JENIS_CONSENT: Record<(typeof JENIS_CONSENT)[number], string> = {
  umum: "Persetujuan Umum",
  tindakan: "Persetujuan Tindakan",
  penolakan: "Penolakan Tindakan",
  privasi: "Pelepasan Informasi",
};

export const TEMPLAT_KLIEN: Record<
  (typeof JENIS_CONSENT)[number],
  { judul: string; isi: string }
> = {
  umum: {
    judul: "Persetujuan Umum Pelayanan Kesehatan",
    isi:
      "Saya menyatakan bersedia menjalani pemeriksaan, pengobatan, dan " +
      "tindakan kedokteran dasar di Klinik Pratama Sahabat Gamma sesuai " +
      "kebutuhan medis saya. Saya memahami bahwa untuk tindakan tertentu " +
      "akan dimintakan persetujuan tersendiri setelah diberikan penjelasan. " +
      "Saya juga menyetujui pemrosesan data kesehatan saya untuk keperluan " +
      "pelayanan, penagihan, dan pelaporan sesuai ketentuan yang berlaku.",
  },
  tindakan: {
    judul: "Persetujuan Tindakan Kedokteran",
    isi:
      "Setelah mendapat penjelasan mengenai diagnosis, tujuan tindakan, " +
      "tata cara, risiko, komplikasi yang mungkin terjadi, serta alternatif " +
      "tindakan lain beserta risikonya, dan setelah diberi kesempatan " +
      "bertanya, saya menyatakan MENYETUJUI dilakukannya tindakan tersebut.",
  },
  penolakan: {
    judul: "Penolakan Tindakan Kedokteran",
    isi:
      "Setelah mendapat penjelasan mengenai diagnosis, tujuan tindakan, " +
      "risiko bila tindakan tidak dilakukan, serta alternatif yang tersedia, " +
      "saya menyatakan MENOLAK dilakukannya tindakan tersebut. Saya memahami " +
      "dan menerima segala akibat dari keputusan saya ini, dan membebaskan " +
      "klinik beserta tenaga kesehatannya dari tanggung jawab atas akibat " +
      "penolakan tersebut.",
  },
  privasi: {
    judul: "Persetujuan Pelepasan Informasi Kesehatan",
    isi:
      "Saya menyetujui pemberian informasi mengenai kondisi kesehatan saya " +
      "kepada pihak yang saya sebutkan di bawah ini, untuk keperluan yang " +
      "saya nyatakan. Saya memahami bahwa persetujuan ini dapat saya tarik " +
      "kembali sewaktu-waktu secara tertulis.",
  },
};
