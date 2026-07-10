import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MediaItem } from "./types";

export type Lang = "en" | "tr";

export const MONTHS: Record<Lang, string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  tr: ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"],
};

type Dict = Record<string, string>;

const en: Dict = {
  brand: "SortedView",
  "search.placeholder": "Search: file name, camera, date, location…",
  "btn.select": "Select",
  "btn.selectDone": "Done",
  "count.selected": "{n} selected",
  "btn.merge": "Merge",
  "btn.group": "Group / Split",
  "btn.scan": "Scan folder",
  "btn.scanning": "Scanning…",
  "btn.language": "Türkçe",

  "side.library": "Library",
  "stat.total": "Total",
  "stat.shown": "Shown",
  "stat.photos": "Photos",
  "stat.videos": "Videos",
  "side.type": "Type",
  "type.all": "All",
  "type.photo": "Photos",
  "type.video": "Videos",
  "side.dateRange": "Date range",
  "side.year": "Year",
  "side.month": "Month",
  "month.all": "All months",
  "side.camera": "Camera",
  "camera.all": "All cameras",
  "side.location": "Location",
  "location.only": "Only items with location ({n})",
  "side.sort": "Sort",
  "sort.taken": "Date taken",
  "sort.modified": "Date modified",
  "sort.name": "File name",
  "sort.size": "File size",
  "sort.camera": "Camera",
  "sort.desc": "Newest first",
  "sort.asc": "Oldest first",
  "side.folders": "Folders",
  "btn.clearFilters": "Clear filters",

  "empty.title": "No media yet.",
  "empty.body": "To get started, scan a folder. Your files stay where they are — nothing is copied.",
  "empty.ffmpeg": "Video previews are created on demand — no setup needed.",
  "thumbs.banner": "{n} videos have no preview yet.",
  "thumbs.generate": "Generate video previews",
  "thumbs.downloading": "Preparing video support (one-time download)…",
  "thumbs.error": "Could not set up video support. Check your internet connection.",
  "ffmpeg.dismiss": "Dismiss",
  "scan.walking": "Scanning files…",
  "scan.reading": "Reading metadata",
  "scan.thumbnails": "Generating previews",
  "scan.download": "Preparing video support…",
  "scan.done": "Completed",
  "footer.summary": "{total} items · {photos} photos · {videos} videos · {gps} with location",
  "footer.note": "Filters are in-app · grouping affects real folders",

  "section.noDate": "No date",
  "today": "Today",
  "yesterday": "Yesterday",

  "lb.close": "Close",
  "lb.prev": "Previous",
  "lb.next": "Next",
  "lb.showMap": "Show on map",
  "meta.type": "Type",
  "meta.taken": "Date taken",
  "meta.modified": "Modified",
  "meta.dimensions": "Dimensions",
  "meta.fileSize": "File size",
  "meta.camera": "Camera",
  "meta.location": "Location",
  "meta.duration": "Duration",
  "meta.folder": "Folder",
  "meta.place": "Place",
  "kind.photo": "Photo",
  "kind.video": "Video",
  "view.grid": "Grid",
  "view.map": "Map",
  "map.empty": "No items with location. Scan photos that have GPS data.",
  "map.count": "{n} located items",

  "grp.title": "Group & split into folders",
  "grp.desc": "Works on the currently filtered items. Preview first, then apply.",
  "grp.type": "Grouping type",
  "grp.month": "Month by month",
  "grp.month.d": "Year / Month",
  "grp.year": "Year",
  "grp.year.d": "2023, 2024 …",
  "grp.byType": "Photo / Video",
  "grp.byType.d": "Photos / Videos",
  "grp.camera": "Camera",
  "grp.camera.d": "By device model",
  "grp.location": "Location",
  "grp.location.d": "With / without location",
  "grp.event": "Event",
  "grp.event.d": "By time gap",
  "grp.eventThreshold": "Event threshold (hours): {n}",
  "grp.mode": "Operation mode",
  "grp.copy": "Copy",
  "grp.copy.d": "Originals stay",
  "grp.move": "Move",
  "grp.move.d": "File goes to new place",
  "grp.alsoSplit": "Also split photos/videos within each group",
  "grp.dest": "Destination folder",
  "btn.selectShort": "Select…",
  "grp.summary": "{total} files, {groups} groups ({mode})",
  "grp.moreGroups": "… +{n} more groups",
  "grp.resultOk": "✓ {ok} succeeded, {fail} skipped/failed.",
  "mode.copy": "copy",
  "mode.move": "move",
  "btn.preview": "Preview",
  "btn.apply": "Apply",
  "btn.working": "Working…",
  "btn.close": "Close",

  "mrg.title": "Merge folders",
  "mrg.badge": "Merge always COPIES — originals are preserved, nothing is deleted.",
  "mrg.sources": "Source folders",
  "mrg.addSource": "+ Add source",
  "btn.remove": "Remove",
  "mrg.dest": "Destination (new merge folder)",
  "mrg.destPlaceholder": "e.g. D:\\Photos\\Merged",
  "mrg.flatten": "Flatten subfolder structure (put everything in one folder)",
  "mrg.summary": "{total} files will be copied, sources: {sources}",
  "mrg.resultOk": "✓ {ok} copied, {fail} skipped/failed.",
  "btn.mergeAction": "Merge",
};

const tr: Dict = {
  brand: "SortedView",
  "search.placeholder": "Ara: dosya adı, kamera, tarih, konum…",
  "btn.select": "Seç",
  "btn.selectDone": "Bitir",
  "count.selected": "{n} seçili",
  "btn.merge": "Birleştir",
  "btn.group": "Grupla / Böl",
  "btn.scan": "Klasör tara",
  "btn.scanning": "Taranıyor…",
  "btn.language": "English",

  "side.library": "Kütüphane",
  "stat.total": "Toplam",
  "stat.shown": "Görünen",
  "stat.photos": "Fotoğraf",
  "stat.videos": "Video",
  "side.type": "Tür",
  "type.all": "Tümü",
  "type.photo": "Fotoğraf",
  "type.video": "Video",
  "side.dateRange": "Tarih aralığı",
  "side.year": "Yıl",
  "side.month": "Ay",
  "month.all": "Tüm aylar",
  "side.camera": "Kamera",
  "camera.all": "Tüm kameralar",
  "side.location": "Konum",
  "location.only": "Yalnızca konumu olanlar ({n})",
  "side.sort": "Sıralama",
  "sort.taken": "Çekim tarihi",
  "sort.modified": "Değiştirme tarihi",
  "sort.name": "Dosya adı",
  "sort.size": "Dosya boyutu",
  "sort.camera": "Kamera",
  "sort.desc": "Önce en yeni",
  "sort.asc": "Önce en eski",
  "side.folders": "Klasörler",
  "btn.clearFilters": "Filtreleri temizle",

  "empty.title": "Henüz medya yok.",
  "empty.body": "Başlamak için bir klasör tarayın. Dosyalarınız olduğu yerde kalır — hiçbir şey kopyalanmaz.",
  "empty.ffmpeg": "Video önizlemeleri istendiğinde oluşturulur — kurulum gerekmez.",
  "thumbs.banner": "{n} videonun önizlemesi yok.",
  "thumbs.generate": "Video önizlemelerini oluştur",
  "thumbs.downloading": "Video desteği hazırlanıyor (tek seferlik indirme)…",
  "thumbs.error": "Video desteği kurulamadı. İnternet bağlantınızı kontrol edin.",
  "ffmpeg.dismiss": "Kapat",
  "scan.walking": "Dosyalar taranıyor…",
  "scan.reading": "Metadata okunuyor",
  "scan.thumbnails": "Önizlemeler oluşturuluyor",
  "scan.download": "Video desteği hazırlanıyor…",
  "scan.done": "Tamamlandı",
  "footer.summary": "{total} öğe · {photos} fotoğraf · {videos} video · {gps} konumlu",
  "footer.note": "Filtreler uygulama içidir · gruplama gerçek klasörlere etki eder",

  "section.noDate": "Tarihsiz",
  "today": "Bugün",
  "yesterday": "Dün",

  "lb.close": "Kapat",
  "lb.prev": "Önceki",
  "lb.next": "Sonraki",
  "lb.showMap": "Haritada göster",
  "meta.type": "Tür",
  "meta.taken": "Çekim tarihi",
  "meta.modified": "Değiştirme",
  "meta.dimensions": "Boyut",
  "meta.fileSize": "Dosya boyutu",
  "meta.camera": "Kamera",
  "meta.location": "Konum",
  "meta.duration": "Süre",
  "meta.folder": "Klasör",
  "meta.place": "Yer",
  "kind.photo": "Fotoğraf",
  "kind.video": "Video",
  "view.grid": "Izgara",
  "view.map": "Harita",
  "map.empty": "Konumu olan öğe yok. GPS verisi olan fotoğrafları tarayın.",
  "map.count": "{n} konumlu öğe",

  "grp.title": "Grupla & klasörlere böl",
  "grp.desc": "Şu an filtrelenmiş öğeler üzerinde çalışır. Önce önizleyin, sonra uygulayın.",
  "grp.type": "Gruplama türü",
  "grp.month": "Ay ay",
  "grp.month.d": "Yıl / Ay",
  "grp.year": "Yıl",
  "grp.year.d": "2023, 2024 …",
  "grp.byType": "Fotoğraf / Video",
  "grp.byType.d": "Fotoğraflar / Videolar",
  "grp.camera": "Kamera",
  "grp.camera.d": "Cihaz modeline göre",
  "grp.location": "Konum",
  "grp.location.d": "Konumlu / Konumsuz",
  "grp.event": "Etkinlik",
  "grp.event.d": "Zaman boşluğuna göre",
  "grp.eventThreshold": "Etkinlik eşiği (saat): {n}",
  "grp.mode": "İşlem modu",
  "grp.copy": "Kopyala",
  "grp.copy.d": "Orijinaller kalır",
  "grp.move": "Taşı",
  "grp.move.d": "Dosya yeni yere gider",
  "grp.alsoSplit": "Ayrıca her grupta foto/video olarak da ayır",
  "grp.dest": "Hedef klasör",
  "btn.selectShort": "Seç…",
  "grp.summary": "{total} dosya, {groups} grup ({mode})",
  "grp.moreGroups": "… +{n} grup daha",
  "grp.resultOk": "✓ {ok} başarılı, {fail} atlandı/hata.",
  "mode.copy": "kopyalama",
  "mode.move": "taşıma",
  "btn.preview": "Önizleme",
  "btn.apply": "Uygula",
  "btn.working": "Çalışıyor…",
  "btn.close": "Kapat",

  "mrg.title": "Klasörleri birleştir",
  "mrg.badge": "Birleştirme her zaman KOPYALAR — orijinaller korunur, hiçbir şey silinmez.",
  "mrg.sources": "Kaynak klasörler",
  "mrg.addSource": "+ Kaynak ekle",
  "btn.remove": "Kaldır",
  "mrg.dest": "Hedef (yeni birleştirme klasörü)",
  "mrg.destPlaceholder": "örn. D:\\Foto\\Birlesik",
  "mrg.flatten": "Alt klasör yapısını düzleştir (hepsini tek klasöre topla)",
  "mrg.summary": "{total} dosya kopyalanacak, kaynaklar: {sources}",
  "mrg.resultOk": "✓ {ok} kopyalandı, {fail} atlandı/hata.",
  "btn.mergeAction": "Birleştir",
};

const DICTS: Record<Lang, Dict> = { en, tr };

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem("lang");
    if (saved === "en" || saved === "tr") return saved;
  } catch { /* ignore */ }
  return navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  useEffect(() => {
    try { localStorage.setItem("lang", lang); } catch { /* ignore */ }
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18nCtx>(() => {
    const t = (key: string, vars?: Record<string, string | number>) => {
      let s = DICTS[lang][key] ?? DICTS.en[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
      return s;
    };
    return { lang, setLang: setLangState, t };
  }, [lang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useI18n must be used within I18nProvider");
  return c;
}

// ---- Arama yardımcıları: aksan-duyarsız, iki dilli ----

const FOLD: Record<string, string> = {
  "ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u",
  "â": "a", "î": "i", "û": "u", "é": "e", "è": "e", "á": "a", "ó": "o",
};

/** Metni küçük harfe indirir, aksan/ayraçları sadeleştirir (arama için). */
export function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[çğıöşüâîûéèáó]/g, (c) => FOLD[c] ?? c)
    .replace(/[-_/.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ABD eyaletleri: kod -> ad. "OH" ile "Ohio" aramalarını eşlemek için.
const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};
const US_STATE_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATES).map(([code, name]) => [norm(name), code])
);

const PHOTO_SYN = "photo image picture fotograf foto resim gorsel";
const VIDEO_SYN = "video film klip movie";

/** İnsan-okur yer etiketi: "Put-in-Bay, Ohio, US". */
export function placeLabel(it: MediaItem): string | null {
  const parts = [it.place_name, it.region, it.country].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Bir öğe için iki dilli, aksan-duyarsız arama dizini üretir. */
export function buildSearchIndex(it: MediaItem): string {
  const parts: string[] = [it.file_name, it.path, it.camera_make ?? "", it.camera_model ?? ""];
  if (it.year) parts.push(String(it.year));
  if (it.month && it.month >= 1 && it.month <= 12) {
    parts.push(MONTHS.en[it.month - 1], MONTHS.tr[it.month - 1]);
  }
  // Yer bilgisi + ABD eyalet kod/ad genişletmesi
  if (it.place_name) parts.push(it.place_name);
  if (it.country) parts.push(it.country);
  if (it.region) {
    parts.push(it.region);
    const upper = it.region.trim().toUpperCase();
    if (US_STATES[upper]) parts.push(US_STATES[upper]);          // "OH" -> "Ohio"
    const code = US_STATE_BY_NAME[norm(it.region)];
    if (code) parts.push(code);                                  // "Ohio" -> "OH"
  }
  parts.push(it.kind === "video" ? VIDEO_SYN : PHOTO_SYN);
  if (it.gps_lat != null) parts.push("location konum gps");
  return norm(parts.join(" "));
}

/** Google Photos tarzı gün başlığı metni. */
export function formatSectionDate(dateStr: string, lang: Lang): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - that.getTime()) / 86400000);
  if (diffDays === 0) return lang === "tr" ? "Bugün" : "Today";
  if (diffDays === 1) return lang === "tr" ? "Dün" : "Yesterday";
  const sameYear = d.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-US", {
    weekday: "long", day: "numeric", month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(d);
}
