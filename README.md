# SortedView

Metadata tabanlı, Google Photos benzeri masaüstü foto/video yöneticisi.
**Tauri 2 (Rust) + React/TypeScript.** Yalnızca Windows için yapılandırıldı.

## Temel ilkeler (garantiler)

- **Kopyalama yok:** Uygulama seçili dizindeki hiçbir foto/videoyu kendi klasörüne kopyalamaz. Önizleme ve oynatma, dosyalar **olduğu yerde** dururken Tauri asset protokolü ile yapılır.
- **Metadata'ya dokunulmaz:** Tüm EXIF/track metadata'sı **sadece okunur**. Hiçbir alan değiştirilmez.
- **Filtreleme uygulama içidir**, gerçek dosyalara etki etmez.
- **Gruplama gerçek klasörlere etki eder** (taşı/kopyala) ama her zaman **önce dry-run önizleme + onay** ister.
- **Merge her zaman kopyalar:** orijinaller korunur, hiçbir şey silinmez. İsim çakışmasında üstüne yazılmaz — ` (1)`, ` (2)` eklenir.
- İşlemler yalnızca kullanıcının seçtiği kök/hedef dizinlerde gerçekleşir.

## Kurulum & çalıştırma

Gereksinimler: Node.js, Rust (stable), ve Windows'ta [Tauri ön koşulları](https://tauri.app/start/prerequisites/) (Microsoft C++ Build Tools + WebView2 — Win11'de hazır gelir).

```powershell
cd "metadata script"
npm install
npm run app:dev      # geliştirme (hot reload)
```

Kurulabilir .exe/.msi üretmek için:

```powershell
npm run app:build    # çıktı: src-tauri/target/release/bundle/
```

### Video önizlemeleri (opsiyonel)

Video karesi thumbnail'ları için `ffmpeg` PATH'te olmalı. Yoksa videolar 🎬 rozetiyle listelenir, oynatma yine çalışır. Kurulum: `winget install Gyan.FFmpeg`.

## Dil / Language

Sağ üstteki **🇹🇷 TR / 🇬🇧 EN** düğmesiyle arayüz Türkçe ve İngilizce arasında anında geçer; tercih kaydedilir. Arama iki dilli ve **aksan-duyarsızdır** — "ağustos", "agustos" veya "august" aynı sonucu verir; "video", "foto", "fotoğraf", "resim" gibi terimler de çalışır. Ay/tür gibi klasör adları, gruplama sırasında seçili dile göre oluşturulur.

The top-right **🇹🇷 TR / 🇬🇧 EN** button switches the whole UI between Turkish and English instantly (preference is saved). Search is bilingual and **accent-insensitive**.

## Kullanım

1. **+ Klasör tara** ile bir veya birden çok klasör seç. Alt klasörler dahil paralel taranır; metadata okunur, thumbnail üretilir (ilerleme alt çubukta).
2. Sol panelden **filtrele** (tür, tarih aralığı, yıl/ay, kamera, konum, klasör) ve **sırala**. Üstten metinle ara.
3. Bir öğeye tıkla → **lightbox**; foto görüntülenir, video oynatılır, tüm metadata sağda; konum varsa haritada aç.
4. **Grupla / Böl:** filtrelenmiş öğeleri Yıl/Ay, tür, kamera, konum veya "etkinlik" (zaman boşluğu) klasörlerine böl. Kopyala veya taşı. Önizle → Uygula.
5. **Birleştir (Merge):** birden çok klasörü tek hedefe **kopyalar** (orijinaller korunur).

## Mimari

```
src-tauri/src/
  metadata.rs    EXIF+video metadata okuma (nom-exif v3, salt-okuma, thread-local parser)
  scanner.rs     walkdir + rayon paralel tarama, ilerleme olayları
  db.rs          SQLite index (rusqlite, WAL) — yalnız metadata, medya değil
  query.rs       dinamik filtre/sıralama SQL + facet istatistikleri
  thumbnails.rs  image crate (foto) + ffmpeg (video) → disk cache
  grouping.rs    dry-run plan + güvenli uygula (taşı/kopyala/merge)
  commands.rs    Tauri IPC komutları + uygulama state
src/
  App.tsx, components/  React arayüz (justified + virtualize grid, lightbox, modallar)
```

## Performans & optimizasyon notları (Bölüm 4)

- **Paralel tarama:** `rayon` ile tüm CPU çekirdekleri kullanılır; her worker thread kendi `MediaParser`'ını thread-local olarak yeniden kullanır (tampon geri dönüşümü, sıfır kilit).
- **Sanallaştırılmış grid:** yalnızca görünür hücreler DOM'a basılır (± ekran tamponu). On binlerce öğede bile akıcı kaydırma; justified layout aspect-ratio'dan hesaplanır.
- **Thumbnail cache:** içerik+mtime+boyut hash'iyle isimlendirilir; değişmemiş dosya yeniden üretilmez. Küçük uzun kenar (320px) hızlı decode.
- **SQLite index:** WAL modu, `taken_at`, `(year,month)`, `kind`, `camera`, `gps`, `root` üzerinde indeksler; filtreleme/sıralama tamamen DB'de. Toplu insert transaction ile (1000'lik chunk).
- **Lazy görseller:** `<img loading="lazy">` + object-fit cover.
- **UI donmaz:** ağır tarama `spawn_blocking` içinde; ilerleme olayları event ile akar.

Büyük kütüphane testi için önerilen doğrulama: 10k+ öğeli bir klasörde tarama süresi, RAM kullanımı ve kaydırma akıcılığı ölçülür; `PRAGMA cache_size` ve `TARGET_ROW_H`/`OVERSCAN` sabitleri ihtiyaca göre ayarlanır.

## Sorumluluk reddi

Taşıma/merge işlemleri dosya sistemini değiştirir. Uygulama orijinalleri korur ve üstüne yazmaz, ancak eski dosyaların silinmesi tamamen kullanıcının inisiyatifindedir — bu konuda sorumluluk alınmaz.
