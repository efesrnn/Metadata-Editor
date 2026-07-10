import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Filter, MediaItem, LibraryStats, ScanProgress } from "./types";
import {
  getMedia, getStats, scanDirectories, pickDirectories,
  onScanProgress, onThumbReady, ffmpegStatus, generateThumbs, downloadFfmpeg,
} from "./api";
import { useI18n, buildSearchIndex, norm } from "./i18n";
import Sidebar from "./components/Sidebar";
import PhotoGrid from "./components/PhotoGrid";
import MapView from "./components/MapView";
import Lightbox from "./components/Lightbox";
import GroupingModal from "./components/GroupingModal";
import MergeModal from "./components/MergeModal";

const logoUrl = "/sortedview_icon.png";

export default function App() {
  const { t, lang, setLang } = useI18n();
  const [filter, setFilter] = useState<Filter>({ sortBy: "taken_at", sortDir: "desc" });
  const [items, setItems] = useState<MediaItem[]>([]);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [search, setSearch] = useState("");
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [showGroup, setShowGroup] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [view, setView] = useState<"grid" | "map">("grid");
  const [mapFocus, setMapFocus] = useState<{ lat: number; lon: number; key: number } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [hasFfmpeg, setHasFfmpeg] = useState(true);
  const [ffmpegDismissed, setFfmpegDismissed] = useState(false);
  const [thumbError, setThumbError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [thumbMap, setThumbMap] = useState<Map<string, string>>(new Map());
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const pendingThumbs = useRef<Map<string, string>>(new Map());
  const didAutoGen = useRef(false);

  const refresh = useCallback(async (f: Filter) => {
    const [m, s] = await Promise.all([getMedia(f), getStats()]);
    setItems(m); setStats(s);
  }, []);

  useEffect(() => {
    ffmpegStatus().then(setHasFfmpeg);
  }, []);

  // Yapisal filtre degisince yeniden getir (arama HARIC — o istemci tarafinda).
  // Ilk yuklemede de ilk filtre ile calisir.
  useEffect(() => { refresh(filter); }, [filter, refresh]);

  // Tarama ilerlemesi
  useEffect(() => {
    let un: (() => void) | undefined;
    onScanProgress((p) => {
      setScan(p);
      if (p.phase === "done") {
        setScanning(false);
        setTimeout(() => setScan(null), 1500);
        refresh(filterRef.current);
      }
    }).then((u) => (un = u));
    return () => un?.();
  }, [refresh]);

  // Canli onizleme akisi: her hazir thumbnail'i topla, ~200ms'de bir uygula.
  useEffect(() => {
    let un: (() => void) | undefined;
    onThumbReady((tr) => { pendingThumbs.current.set(tr.path, tr.thumb); }).then((u) => (un = u));
    const iv = window.setInterval(() => {
      if (pendingThumbs.current.size === 0) return;
      setThumbMap((prev) => {
        const m = new Map(prev);
        pendingThumbs.current.forEach((v, k) => m.set(k, v));
        return m;
      });
      pendingThumbs.current.clear();
    }, 200);
    return () => { un?.(); window.clearInterval(iv); };
  }, []);

  // Istemci tarafi, iki dilli, aksan-duyarsiz arama (thumb'dan bagimsiz — index stabil)
  const indexed = useMemo(() => items.map((it) => ({ it, s: buildSearchIndex(it) })), [items]);
  const filtered = useMemo(() => {
    const q = norm(search.trim());
    if (!q) return items;
    return indexed.filter((x) => x.s.includes(q)).map((x) => x.it);
  }, [indexed, items, search]);
  // Canli gelen onizlemeleri uygula (index'i bozmadan)
  const displayItems = useMemo(() => {
    if (thumbMap.size === 0) return filtered;
    return filtered.map((it) =>
      !it.thumb_path && thumbMap.has(it.path) ? { ...it, thumb_path: thumbMap.get(it.path)! } : it
    );
  }, [filtered, thumbMap]);

  // Otomatik arka plan: eksik onizleme varsa (yeni tarama/acilis sonrasi) bir kez uret.
  useEffect(() => {
    if (didAutoGen.current || scanning) return;
    if (items.some((i) => !i.thumb_path)) {
      didAutoGen.current = true;
      generateThumbs().catch((e) => console.error(e));
    }
  }, [items, scanning]);

  const startScan = async () => {
    const dirs = await pickDirectories();
    if (!dirs.length) return;
    didAutoGen.current = false; // yeni tarama sonrasi otomatik uretim yeniden
    setScanning(true);
    setScan({ phase: "walking", processed: 0, total: 0, current: "" });
    try { await scanDirectories(dirs, true); }
    catch (e) { console.error(e); setScanning(false); }
  };

  const toggleSelect = (id: number) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };

  const nav = (dir: number) => {
    setLightbox((i) => {
      if (i == null) return i;
      const next = i + dir;
      return next >= 0 && next < displayItems.length ? next : i;
    });
  };

  // Onizlemesi olmayan videolar (yeniden taramadan uretilebilir)
  const missingVideoThumbs = useMemo(
    () => items.filter((i) => i.kind === "video" && !i.thumb_path).length,
    [items]
  );

  // Video onizlemelerini uret; ffmpeg yoksa uygulama kendisi indirir (kullanici bir sey kurmaz).
  const generatePreviews = async () => {
    setThumbError(null);
    setScanning(true);
    try {
      if (!hasFfmpeg) {
        setScan({ phase: "download", processed: 0, total: 0, current: "" });
        await downloadFfmpeg();
        const ok = await ffmpegStatus();
        setHasFfmpeg(ok);
        if (!ok) { setThumbError(t("thumbs.error")); setScanning(false); setScan(null); return; }
      }
      setScan({ phase: "thumbnails", processed: 0, total: missingVideoThumbs, current: "" });
      await generateThumbs(); // ilerleme + "done" olayi dinleyici tarafindan islenir
    } catch (e) {
      console.error(e);
      setThumbError(t("thumbs.error"));
      setScanning(false); setScan(null);
    }
  };

  const groupByDay = (filter.sortBy ?? "taken_at") === "taken_at" || filter.sortBy === "modified_at";
  const defaultDest = stats?.roots?.[0] ?? "";
  const scanPct = scan && scan.total ? Math.round((scan.processed / scan.total) * 100) : 0;
  const showThumbBanner = missingVideoThumbs > 0 && !ffmpegDismissed;

  const showOnMap = (item: MediaItem) => {
    if (item.gps_lat == null || item.gps_lon == null) return;
    setLightbox(null);
    setView("map");
    setMapFocus({ lat: item.gps_lat, lon: item.gps_lon, key: Date.now() });
  };

  return (
    <div className="app">
      <div className="toolbar">
        <div className="brand"><img src={logoUrl} alt="" aria-hidden="true" /> {t("brand")}</div>
        <div className="search" role="search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            placeholder={t("search.placeholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t("search.placeholder")}
          />
        </div>
        <div className="seg" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === "grid"} className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>▦ {t("view.grid")}</button>
          <button role="tab" aria-selected={view === "map"} className={view === "map" ? "active" : ""} onClick={() => setView("map")}>◍ {t("view.map")}</button>
        </div>
        <div className="spacer" />
        {selectMode && <span aria-live="polite" style={{ color: "var(--text-dim)", fontSize: 13 }}>{t("count.selected", { n: selected.size })}</span>}
        <button className="lang-btn" onClick={() => setLang(lang === "tr" ? "en" : "tr")} aria-label={t("btn.language")}>
          {lang === "tr" ? "🇬🇧 EN" : "🇹🇷 TR"}
        </button>
        <button className={selectMode ? "primary" : ""} onClick={() => { setSelectMode(!selectMode); setSelected(new Set()); }}>
          {selectMode ? t("btn.selectDone") : t("btn.select")}
        </button>
        <button onClick={() => setShowMerge(true)}>{t("btn.merge")}</button>
        <button onClick={() => setShowGroup(true)} disabled={!stats?.total}>{t("btn.group")}</button>
        <button className="primary" onClick={startScan} disabled={scanning}>
          {scanning ? t("btn.scanning") : `+ ${t("btn.scan")}`}
        </button>
      </div>

      {showThumbBanner && (
        <div className="info-banner">
          <span>🎬 {t("thumbs.banner", { n: missingVideoThumbs })}</span>
          <button className="primary" onClick={generatePreviews} disabled={scanning}>
            {t("thumbs.generate")}
          </button>
          {thumbError && <span className="err">{thumbError}</span>}
          <div className="spacer" />
          <button className="ghost" onClick={() => setFfmpegDismissed(true)}>{t("ffmpeg.dismiss")}</button>
        </div>
      )}

      <div className="body">
        <Sidebar stats={stats} filter={filter} setFilter={setFilter} visibleCount={displayItems.length} />
        {displayItems.length === 0 ? (
          <div className="empty">
            <div style={{ fontSize: 48 }} aria-hidden="true">🖼️</div>
            <div>
              <b>{t("empty.title")}</b><br />
              {t("empty.body")}
            </div>
            <button className="primary" onClick={startScan}>+ {t("btn.scan")}</button>
            {!hasFfmpeg && <div className="warn">{t("empty.ffmpeg")}</div>}
          </div>
        ) : view === "map" ? (
          <MapView items={displayItems} onOpen={setLightbox} focusLocation={mapFocus} />
        ) : (
          <PhotoGrid
            items={displayItems}
            onOpen={setLightbox}
            selected={selected}
            onToggleSelect={toggleSelect}
            selectMode={selectMode}
            groupByDay={groupByDay}
          />
        )}
      </div>

      {scan ? (
        <div className="scanbar" aria-live="polite">
          <span>{t(`scan.${scan.phase}`)}</span>
          <div className="progress" role="progressbar" aria-valuenow={scanPct} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${scanPct}%` }} />
          </div>
          <span>{scan.processed}/{scan.total || "…"} {scan.current && `· ${scan.current}`}</span>
        </div>
      ) : (
        <div className="scanbar">
          <span>{t("footer.summary", { total: stats?.total ?? 0, photos: stats?.photos ?? 0, videos: stats?.videos ?? 0, gps: stats?.withGps ?? 0 })}</span>
          <div className="spacer" style={{ flex: 1 }} />
          <span style={{ color: "var(--text-dim)" }}>{t("footer.note")}</span>
        </div>
      )}

      {lightbox != null && displayItems[lightbox] && (
        <Lightbox items={displayItems} index={lightbox} onClose={() => setLightbox(null)} onNav={nav} onShowMap={showOnMap} />
      )}
      {showGroup && (
        <GroupingModal
          filter={filter}
          defaultDest={defaultDest}
          onClose={() => setShowGroup(false)}
          onApplied={() => refresh(filter)}
        />
      )}
      {showMerge && (
        <MergeModal onClose={() => setShowMerge(false)} onApplied={() => refresh(filter)} />
      )}
    </div>
  );
}
