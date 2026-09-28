# Privacy Policy DocSwap

Terakhir diperbarui: 26 April 2026

## Ringkasan

DocSwap adalah aplikasi untuk mengonversi file PDF menjadi DOCX menggunakan layanan pemrosesan jarak jauh. Kebijakan ini menjelaskan data apa yang diproses, untuk tujuan apa data digunakan, kepada siapa data dikirim, bagaimana data diamankan, berapa lama data dapat dipertahankan, dan pilihan apa yang tersedia bagi pengguna.

Kebijakan ini berlaku untuk aplikasi **DocSwap** dan pengembang atau penerbit yang tercantum pada listing Google Play untuk aplikasi ini.

DocSwap tidak mewajibkan pendaftaran akun dan tidak membuat profil akun pengguna di dalam aplikasi. Jika Anda memiliki pertanyaan privasi atau permintaan penghapusan data, hubungi **docswappdf@gmail.com**.

---

## 1. Data yang Diproses

Saat Anda memakai aplikasi ini, DocSwap dapat memproses:

- **File PDF** yang Anda pilih untuk dikonversi
- **Nama file** dan **ukuran file**
- **Data teknis permintaan**, termasuk alamat IP atau informasi koneksi serupa, untuk kuota harian, rate limiting, dan pencegahan penyalahgunaan
- **Riwayat konversi lokal**, seperti nama file hasil, nama file sumber, ukuran file, tanggal konversi, dan lokasi file lokal
- **Metadata operasional terbatas**, seperti nama file, ukuran file, status permintaan, pengenal teknis deduplikasi, dan data koneksi yang dapat muncul dalam observability atau log teknis hosting untuk reliabilitas, debugging, dan keamanan

DocSwap tidak dengan sengaja mengumpulkan data profil seperti nama atau email, kecuali Anda sendiri menghubungi kami melalui email support.

---

## 2. Cara Data Digunakan

Data diproses untuk tujuan berikut:

- Menjalankan konversi PDF ke DOCX
- Menyimpan hasil konversi dan riwayat secara lokal di perangkat Anda
- Menegakkan kuota harian penggunaan
- Menerapkan rate limiting dan melindungi layanan dari penyalahgunaan
- Membuka atau membagikan file hasil saat Anda secara eksplisit memicu tindakan tersebut

---

## 3. Pihak Ketiga dan Berbagi Data

Saat Anda menekan tombol convert:

1. File PDF dikirim ke backend DocSwap
2. Backend meneruskan file ke **Cloudmersive** untuk diproses menjadi DOCX
3. Hasil konversi dikembalikan ke aplikasi Anda

Cloudmersive bertindak sebagai penyedia layanan pemrosesan dokumen. Silakan lihat kebijakan privasi mereka di:

- https://cloudmersive.com/privacy-policy

DocSwap tidak membagikan data Anda untuk tujuan iklan atau pemasaran, dan tidak menjual data pribadi Anda. File hanya dibagikan ke aplikasi lain ketika Anda secara eksplisit memilih tindakan share atau open.

---

## 4. Penyimpanan Lokal di Perangkat

### Android

- File hasil konversi disimpan di penyimpanan lokal aplikasi
- Aplikasi juga dapat membuat salinan ekspor ke folder **Documents/DocSwap** pada Android modern yang mendukung alur tersebut
- Riwayat konversi disimpan secara lokal agar Anda dapat membuka kembali hasil sebelumnya
- DocSwap menonaktifkan backup cloud Android untuk data private aplikasi sejauh pengaturan platform tersebut dihormati, walau pada sebagian perangkat proses device-to-device migration masih bisa memindahkan data aplikasi tergantung perilaku Android atau vendor perangkat

### Web

- Riwayat konversi disimpan secara lokal di browser atau perangkat
- File hasil web dapat tersedia sebagai file sesi lokal atau browser sampai sesi dibersihkan

---

## 5. Izin dan Akses Perangkat

Pada Android, build saat ini dirancang untuk menggunakan system file picker, penyimpanan private aplikasi, dan API dokumen platform jika memungkinkan, alih-alih meminta izin storage atau media yang luas. Aplikasi mengakses file hanya untuk:

- Memilih file PDF dari perangkat
- Menyimpan file hasil konversi
- Membuka file hasil
- Membagikan file hasil ke aplikasi lain atas tindakan Anda

Akses ini digunakan untuk fungsi utama aplikasi dan bukan untuk tujuan iklan atau profiling.

---

## 6. Keamanan, Retensi, Penghapusan, dan Data at Rest

- **Data in transit**: file dan data permintaan dikirim melalui **HTTPS/TLS** antara aplikasi, backend DocSwap, dan layanan konversi pihak ketiga
- **Data at rest di perangkat Anda**: file hasil, riwayat lokal, dan salinan ekspor tetap berada di perangkat Anda sampai Anda menghapusnya, membersihkan data aplikasi, atau uninstall aplikasi
- **Penyimpanan sementara di backend**: respons hasil konversi dapat disimpan sementara untuk kebutuhan deduplikasi atau duplicate request handling selama sekitar **60 detik**; reservation kuota dapat dipertahankan sekitar **10 menit** sebelum dipangkas otomatis
- **Kuota harian**: data kuota berlaku untuk hari kuota aktif; record lama tidak dipakai kembali untuk perhitungan kuota hari berikutnya, meskipun retensi internal pada infrastruktur hosting dapat mengikuti kebijakan platform
- **Log teknis dan observability**: penyedia hosting atau layanan terkait dapat menyimpan metadata teknis terbatas untuk kebutuhan operasional, reliabilitas, debugging, keamanan, dan pencegahan penyalahgunaan sesuai pengaturan platform dan kebijakan mereka
- **Arsip permanen dokumen**: backend DocSwap dirancang agar tidak dengan sengaja menyimpan arsip jangka panjang file dokumen yang diunggah untuk konversi setelah proses konversi selesai
- **Penegasan enkripsi**: kebijakan ini menegaskan penggunaan enkripsi untuk **data in transit**; DocSwap tidak membuat klaim terpisah bahwa seluruh data **at rest** selalu dienkripsi secara mandiri oleh aplikasi, karena perlindungan data at rest juga bergantung pada penyimpanan perangkat, sistem operasi, hosting, dan penyedia layanan terkait
- **Retensi pihak ketiga**: retensi data pada penyedia pihak ketiga seperti Cloudmersive dan hosting mengikuti kebijakan privasi serta pengaturan platform mereka masing-masing

---

## 7. Iklan dan Analitik

Versi DocSwap saat ini tidak menyertakan:

- SDK iklan pihak ketiga seperti AdMob
- SDK analitik atau pelacakan pihak ketiga seperti Firebase Analytics

Jika praktik data di masa depan berubah, kebijakan ini akan diperbarui.

---

## 8. Pilihan Pengguna

Anda dapat:

- Menghapus riwayat lokal melalui aplikasi
- Menghapus file hasil konversi dari perangkat Anda
- Membersihkan data aplikasi
- Uninstall aplikasi
- Menghubungi kami untuk pertanyaan terkait privasi

Karena DocSwap tidak membuat akun pengguna di dalam aplikasi, tidak ada alur penghapusan akun di dalam aplikasi.

---

## 9. Kontak

Untuk pertanyaan terkait privacy policy atau permintaan data:

- **Email**: docswappdf@gmail.com

---

## 10. Catatan untuk Publikasi

Untuk kepatuhan Google Play, versi privacy policy yang dipublikasikan pada URL publik harus konsisten secara substansi dengan kebijakan di dalam aplikasi ini.
