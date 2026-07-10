import { useCallback, useEffect, useRef, useState } from "react";
import type { Filter, MediaItem, LibraryStats, ScanProgress } from "./types";
import {
  getMedia, getStats, scanDirectories, pickDirectories,
  onScanProgress, ffmpegStatus,
} from "./api";
import Sidebar from "./components/Sidebar";
import PhotoGrid from "./components/PhotoGrid";
import Lightbox from "./components/Lightbox";
import GroupingModal from "./components/GroupingModal";
import MergeModal from "./components/MergeModal";

export default function App() {
  const [filter, setFilter] = useState<Filter>({ sortBy: "taken_at", sortDir: "desc" });
  const [items, setItems] = useState<MediaItem[]>([]);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [search, setSearch] = useState("");
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [showGroup, setShowGroup] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [hasFfmpeg, setHasFfmpeg] = useState(true);
  const [scanning, setScanning] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const refresh = useCallback(async (f: Filter) => {
    const [m, s] = await Promise.all([getMedia(f), getStats()]);
    setItems(m); setStats(s);
  }, []);

  // Ilk yukleme
  useEffect(() => {
    refresh(filter);
    ffmpegStatus().then(setHasFfmpeg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scan ilerleme dinleyicisi
  useEffect(() => {
    let un: (() => void) | undefined;
    onScanProgress((p) => {
      setScan(p);
      if (p.phase === "done") {
        setScanning(false);
        setTimeout(() => setScan(null), 1500);
        refresh(filter);
      }
    }).then((u) => (un = u));
    return () => un?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Filtre degisince debounce ile yeniden getir
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => refresh({ ...filter, text: search || undefined }), 220);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [filter, search, refresh]);

  const startScan = async () => {
    const dirs = await pickDirectories();
    if (!dirs.length) return;
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
      return next >= 0 && next < items.length ? next : i;
    });
  };

  const defaultDest = stats?.roots?.[0] ?? "";
  const scanPct = scan && scan.total ? Math.round((scan.processed / scan.total) * 100) : 0;
  const phaseText: Record<string, string> = {
    walking: "Dosyalar taraniyor…", reading: "Metadata okunuyor",
    thumbnails: "Onizlemeler olusturuluyor", done: "Tamamlandi",
  };

  return (
    <div className="app">
      <div className="toolbar">
        <div className="brand"><span className="dot" /> MetaGallery</div>
        <div className="search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input placeholder="Ara: dosya adi, kamera, konum…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="spacer" />
        {selectMode && <span style={{ color: "var(--text-dim)", fontSize: 13 }}>{selected.size} secili</span>}
        <button className={selectMode ? "primary" : ""} onClick={() => { setSelectMode(!selectMode); setSelected(new Set()); }}>
          {selectMode ? "Secimi bitir" : "Sec"}
        </button>
        <button onClick={() => setShowMerge(true)}>Birlestir</button>
        <button onClick={() => setShowGroup(true)} disabled={!stats?.total}>Grupla / Bol</button>
        <button className="primary" onClick={startScan} disabled={scanning}>
          {scanning ? "Taraniyor…" : "+ Klasor tara"}
        </button>
      </div>

      <div className="body">
        <Sidebar stats={stats} filter={filter} setFilter={setFilter} visibleCount={items.length} />
        {items.length === 0 ? (
          <div className="empty">
            <div style={{ fontSize: 48 }}>🖼️</div>
            <div>
              <b>Henuz medya yok.</b><br />
              Baslamak icin bir klasor tarayin. Dosyalariniz <u>oldugu yerde kalir</u>, kopyalanmaz.
            </div>
            <button className="primary" onClick={startScan}>+ Klasor tara</button>
            {!hasFfmpeg && <div className="warn">Video onizlemeleri icin ffmpeg kurulu degil (opsiyonel).</div>}
          </div>
        ) : (
          <PhotoGrid
            items={items}
            onOpen={setLightbox}
            selected={selected}
            onToggleSelect={toggleSelect}
            selectMode={selectMode}
          />
        )}
      </div>

      {scan ? (
        <div className="scanbar">
          <span>{phaseText[scan.phase]}</span>
          <div className="progress"><div style={{ width: `${scanPct}%` }} /></div>
          <span>{scan.processed}/{scan.total || "…"} {scan.current && `· ${scan.current}`}</span>
        </div>
      ) : (
        <div className="scanbar">
          <span>{stats?.total ?? 0} oge · {stats?.photos ?? 0} foto · {stats?.videos ?? 0} video · {stats?.withGps ?? 0} konumlu</span>
          <div className="spacer" style={{ flex: 1 }} />
          <span style={{ color: "var(--text-dim)" }}>Filtreler uygulama icidir · gruplama gercek klasorlere etki eder</span>
        </div>
      )}

      {lightbox != null && (
        <Lightbox items={items} index={lightbox} onClose={() => setLightbox(null)} onNav={nav} />
      )}
      {showGroup && (
        <GroupingModal
          filter={{ ...filter, text: search || undefined }}
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
