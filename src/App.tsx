import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Filter, MediaItem, LibraryStats, ScanProgress } from "./types";
import {
  getMedia, getStats, scanDirectories, pickDirectories,
  onScanProgress, onThumbReady, ffmpegStatus, generateThumbs, downloadFfmpeg, setMediaLocation, updateVideoDetails,
  checkRoots, removeRoots,
  importTakeoutMetadata, moveToTrash, restoreTrash,
  copyFilesToClipboard,
  peekUndo, applyUndo,
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
  const [assignmentItem, setAssignmentItem] = useState<MediaItem | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [hasFfmpeg, setHasFfmpeg] = useState(true);
  const [ffmpegDismissed, setFfmpegDismissed] = useState(false);
  const [thumbError, setThumbError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [thumbMap, setThumbMap] = useState<Map<string, string>>(new Map());
  const [sessionRoots, setSessionRootsState] = useState<string[]>([]);
  const [startupPrompt, setStartupPrompt] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [missingRoots, setMissingRoots] = useState<string[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [takeoutOpen, setTakeoutOpen] = useState(false);
  const [trashConfirmOpen, setTrashConfirmOpen] = useState(false);
  const [fileOpBusy, setFileOpBusy] = useState(false);
  const [fileOpMessage, setFileOpMessage] = useState<string | null>(null);
  const [visibleDay, setVisibleDay] = useState<string | null>(null);
  const [undoPreview, setUndoPreview] = useState<import("./types").UndoPreview | null>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const pendingThumbs = useRef<Map<string, string>>(new Map());
  const didAutoGen = useRef(false);
  const startupResolved = useRef(false);
  const gridScrollTop = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  const setSessionRoots = useCallback((roots: string[]) => {
    const unique = Array.from(new Set(roots));
    setSessionRootsState(unique);
    setFilter((current) => ({ ...current, roots: unique.length ? unique : ["__sortedview_no_active_root__"] }));
  }, []);

  useEffect(() => {
    if (!stats || startupResolved.current) return;
    startupResolved.current = true;
    if (stats.roots.length) setStartupPrompt(true);
    else { setSessionRoots([]); setLibraryReady(true); }
  }, [setSessionRoots, stats]);

  useEffect(() => {
    if (!sessionRoots.length) return;
    let cancelled = false;
    const inspect = async () => {
      const missing = await checkRoots(sessionRoots).catch(() => []);
      if (!cancelled && missing.length) setMissingRoots((current) => current.length ? current : missing);
    };
    void inspect();
    const timer = window.setInterval(inspect, 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [sessionRoots]);

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
    if (!libraryReady || didAutoGen.current || scanning) return;
    if (items.some((i) => !i.thumb_path)) {
      didAutoGen.current = true;
      generateThumbs().catch((e) => console.error(e));
    }
  }, [items, scanning, libraryReady]);

  const startScan = async () => {
    const dirs = await pickDirectories();
    if (!dirs.length) return;
    setSettingsOpen(false);
    setSessionRoots([...sessionRoots, ...dirs]);
    didAutoGen.current = false; // yeni tarama sonrasi otomatik uretim yeniden
    setScanning(true);
    setScan({ phase: "walking", processed: 0, total: 0, current: "" });
    try { await scanDirectories(dirs, true); }
    catch (e) { console.error(e); setScanning(false); }
  };

  const startFreshSession = async () => {
    const dirs = await pickDirectories();
    if (!dirs.length) return;
    setStartupPrompt(false); setSettingsOpen(false); setLibraryReady(true);
    setSessionRoots(dirs);
    didAutoGen.current = false;
    setScanning(true);
    setScan({ phase: "walking", processed: 0, total: 0, current: "" });
    try { await scanDirectories(dirs, true); } catch (error) { console.error(error); setScanning(false); }
  };

  const keepPreviousRoots = () => {
    const roots = stats?.roots ?? [];
    setSessionRoots(roots); setStartupPrompt(false); setLibraryReady(true);
  };

  const removeSessionRoots = async (roots: string[]) => {
    await removeRoots(roots, true);
    const next = sessionRoots.filter((root) => !roots.includes(root));
    setSessionRoots(next);
    setMissingRoots([]);
    await refresh({ ...filterRef.current, roots: next.length ? next : ["__sortedview_no_active_root__"] });
  };

  const toggleSelect = (id: number) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };

  const addSelect = useCallback((id: number) => {
    setSelected((current) => current.has(id) ? current : new Set(current).add(id));
  }, []);

  const removeSelect = useCallback((id: number) => {
    setSelected((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current); next.delete(id); return next;
    });
  }, []);

  const startSelectFrom = useCallback((id: number) => {
    setSelectMode(true);
    setSelected((current) => new Set(current).add(id));
  }, []);

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
  const selectedItems = useMemo(() => displayItems.filter((item) => selected.has(item.id)), [displayItems, selected]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable = !!target?.closest("input, textarea, select, [contenteditable='true']");
      if (editable && !(event.ctrlKey && event.key.toLowerCase() === "f")) return;
      if (lightbox != null || undoPreview || takeoutOpen || trashConfirmOpen || settingsOpen || startupPrompt || missingRoots.length) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey && key === "a") {
        event.preventDefault();
        if (event.shiftKey) {
          const day = visibleDay;
          const dayItems = day ? displayItems.filter((item) => (item.taken_at ?? item.modified_at)?.slice(0, 10) === day || (day === "__nodate__" && !(item.taken_at ?? item.modified_at))) : [];
          setView("grid"); setSelectMode(true); setSelected(new Set(dayItems.map((item) => item.id)));
        }
        else { setView("grid"); setSelectMode(true); setSelected(new Set(displayItems.map((item) => item.id))); }
      } else if (event.ctrlKey && key === "z") {
        event.preventDefault();
        void peekUndo(sessionRoots).then((preview) => {
          if (preview) setUndoPreview(preview);
          else setFileOpMessage(t("undo.none"));
        }).catch((error) => setFileOpMessage(String(error)));
      } else if (event.ctrlKey && key === "c" && selectedItems.length) {
        event.preventDefault();
        void copyFilesToClipboard(selectedItems.map((item) => item.path))
          .then(() => setFileOpMessage(t("shortcut.copied", { n: selectedItems.length })))
          .catch((error) => setFileOpMessage(String(error)));
      } else if (event.ctrlKey && key === "f") {
        event.preventDefault(); searchInputRef.current?.focus(); searchInputRef.current?.select();
      } else if ((event.ctrlKey && key === "r") || event.key === "F5") {
        event.preventDefault(); void refresh(filterRef.current);
      } else if (event.key === "Delete" && selectedItems.length) {
        event.preventDefault(); setTrashConfirmOpen(true);
      } else if (event.key === "Escape" && selectMode && lightbox == null) {
        event.preventDefault(); setSelected(new Set()); setSelectMode(false);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [displayItems, lightbox, missingRoots.length, refresh, selectedItems, selectMode, sessionRoots, settingsOpen, startupPrompt, t, takeoutOpen, trashConfirmOpen, undoPreview, visibleDay]);

  const confirmUndo = async () => {
    if (!undoPreview) return;
    setFileOpBusy(true);
    try {
      const root = undoPreview.root;
      const result = await applyUndo(undoPreview.id);
      setUndoPreview(null);
      if (result.succeeded && await checkRoots([root]).then((missing) => !missing.length)) await scanDirectories([root], true);
      setFileOpMessage(t("undo.result", { ok: result.succeeded, errors: result.errors.length }));
      await refresh(filterRef.current);
    } catch (error) { setFileOpMessage(String(error)); }
    finally { setFileOpBusy(false); }
  };

  const showOnMap = (item: MediaItem) => {
    if (item.gps_lat == null || item.gps_lon == null) return;
    setLightbox(null);
    setView("map");
    setMapFocus({ lat: item.gps_lat, lon: item.gps_lon, key: Date.now() });
  };

  // Lightbox acikken haritayi gizle: WebView2'de donanim hizlandirmali <video>
  // ayri bir katmanda oynadigi icin Leaflet karolarinin arkasinda kalabiliyor.
  // Harita yuzeyini gizleyince video her zaman ustte oynar.
  useEffect(() => {
    document.body.classList.toggle("lightbox-open", lightbox != null);
    return () => document.body.classList.remove("lightbox-open");
  }, [lightbox]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || lightbox != null || view !== "map") return;
      if (assignmentItem) setAssignmentItem(null);
      setView("grid");
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [assignmentItem, lightbox, view]);

  const startLocationAssignment = (item: MediaItem) => {
    setLightbox(null); setAssignmentItem(item); setView("map");
  };

  const saveAssignedLocation = async (lat: number, lon: number) => {
    if (!assignmentItem) return;
    await setMediaLocation(assignmentItem, lat, lon);
    setAssignmentItem(null);
    setMapFocus({ lat, lon, key: Date.now() });
    await refresh(filterRef.current);
  };

  const saveVideoDetails = async (item: MediaItem, fileName: string, takenAt: string) => {
    await updateVideoDetails(item, fileName, takenAt);
    setLightbox(null);
    await refresh(filterRef.current);
  };

  const runTakeoutImport = async (scope: "selected" | "all") => {
    setFileOpBusy(true); setFileOpMessage(null);
    try {
      const targets = scope === "selected"
        ? selectedItems
        : await getMedia({ roots: sessionRoots.length ? sessionRoots : ["__sortedview_no_active_root__"] });
      const result = await importTakeoutMetadata(targets);
      setFileOpMessage(t("takeout.result", { ok: result.succeeded, skipped: result.skipped, errors: result.errors.length }));
      await refresh(filterRef.current);
    } catch (error) { setFileOpMessage(String(error)); }
    finally { setFileOpBusy(false); }
  };

  const confirmMoveToTrash = async () => {
    setFileOpBusy(true); setFileOpMessage(null);
    try {
      const result = await moveToTrash(selectedItems);
      setTrashConfirmOpen(false); setSelected(new Set());
      setFileOpMessage(t("trash.result", { ok: result.succeeded, errors: result.errors.length }));
      await refresh(filterRef.current);
    } catch (error) { setFileOpMessage(String(error)); }
    finally { setFileOpBusy(false); }
  };

  const restoreDeletedItems = async () => {
    setFileOpBusy(true); setFileOpMessage(null);
    try {
      const result = await restoreTrash(sessionRoots);
      if (result.succeeded) await scanDirectories(sessionRoots, true);
      setFileOpMessage(t("restore.result", { ok: result.succeeded, errors: result.errors.length }));
      setSettingsOpen(false);
    } catch (error) { setFileOpMessage(String(error)); }
    finally { setFileOpBusy(false); }
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
            ref={searchInputRef}
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
        <button className="settings-btn" onClick={() => setSettingsOpen(true)} aria-label={t("settings.title")}>⚙</button>
        <button className={selectMode ? "primary" : ""} onClick={() => { setSelectMode(!selectMode); setSelected(new Set()); }}>
          {selectMode ? t("btn.selectDone") : t("btn.select")}
        </button>
        <button onClick={() => { setTakeoutOpen(true); setFileOpMessage(null); }} disabled={!sessionRoots.length}>JSON</button>
        {selectMode && selected.size > 0 && <button className="danger-button" onClick={() => setTrashConfirmOpen(true)}>🗑 {t("trash.action")}</button>}
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
          <MapView items={displayItems} onOpen={setLightbox} focusLocation={mapFocus}
            assignmentItem={assignmentItem} onAssign={saveAssignedLocation} onCancelAssign={() => setAssignmentItem(null)} />
        ) : (
          <PhotoGrid
            items={displayItems}
            onOpen={setLightbox}
            selected={selected}
            onToggleSelect={toggleSelect}
            onAddSelect={addSelect}
            onRemoveSelect={removeSelect}
            onStartSelect={startSelectFrom}
            selectMode={selectMode}
            groupByDay={groupByDay}
            initialScrollTop={gridScrollTop.current}
            onScrollPosition={(top) => { gridScrollTop.current = top; }}
            onVisibleDayChange={setVisibleDay}
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
        <Lightbox items={displayItems} index={lightbox} onClose={() => setLightbox(null)}
          onEscape={() => { setLightbox(null); setView("grid"); }} onNav={nav}
          onShowMap={showOnMap} onAddLocation={startLocationAssignment} onUpdateVideo={saveVideoDetails} />
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
      {startupPrompt && (
        <div className="modal-backdrop startup-backdrop">
          <div className="modal session-modal" role="dialog" aria-modal="true">
            <header>{t("startup.title")}</header>
            <div className="content">
              <p>{t("startup.body")}</p>
              <div className="session-root-list">{stats?.roots.map((root) => <div key={root}>📁 {root}</div>)}</div>
            </div>
            <footer>
              <button onClick={startFreshSession}>{t("startup.fresh")}</button>
              <button className="primary" onClick={keepPreviousRoots}>{t("startup.keep")}</button>
            </footer>
          </div>
        </div>
      )}
      {settingsOpen && (
        <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <div className="modal session-modal" role="dialog" aria-modal="true">
            <header>{t("settings.title")}<button className="ghost" onClick={() => setSettingsOpen(false)}>✕</button></header>
            <div className="content">
              <p>{t("settings.activeRoots")}</p>
              <div className="settings-roots">
                {sessionRoots.map((root) => <div className="settings-root" key={root}><span>📁 {root}</span><button onClick={() => void removeSessionRoots([root])}>{t("settings.remove")}</button></div>)}
                {!sessionRoots.length && <div className="root-empty">{t("settings.none")}</div>}
              </div>
              <button className="restore-button" disabled={!sessionRoots.length || fileOpBusy} onClick={() => void restoreDeletedItems()}>↶ {t("restore.action")}</button>
            </div>
            <footer>
              <button onClick={startFreshSession}>{t("settings.newSession")}</button>
              <button className="primary" onClick={startScan}>＋ {t("settings.addRoot")}</button>
            </footer>
          </div>
        </div>
      )}
      {missingRoots.length > 0 && (
        <div className="modal-backdrop disconnect-backdrop">
          <div className="modal session-modal" role="alertdialog" aria-modal="true">
            <header>⚠ {t("disconnect.title")}</header>
            <div className="content">
              <p>{t("disconnect.body")}</p>
              <div className="session-root-list">{missingRoots.map((root) => <div key={root}>{root}</div>)}</div>
            </div>
            <footer><button className="primary" onClick={() => void removeSessionRoots(missingRoots)}>{t("disconnect.ok")}</button></footer>
          </div>
        </div>
      )}
      {takeoutOpen && (
        <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !fileOpBusy) setTakeoutOpen(false); }}>
          <div className="modal session-modal" role="dialog" aria-modal="true">
            <header>{t("takeout.title")}<button className="ghost" disabled={fileOpBusy} onClick={() => setTakeoutOpen(false)}>✕</button></header>
            <div className="content">
              <p>{t("takeout.body")}</p>
              <div className="badge-note takeout-guard">🛡 {t("takeout.guard")}</div>
              {fileOpMessage && <div className="operation-result">{fileOpMessage}</div>}
            </div>
            <footer>
              <button disabled={fileOpBusy || !selectedItems.length} onClick={() => void runTakeoutImport("selected")}>{t("takeout.selected", { n: selectedItems.length })}</button>
              <button className="primary" disabled={fileOpBusy} onClick={() => void runTakeoutImport("all")}>{fileOpBusy ? t("btn.working") : t("takeout.all")}</button>
            </footer>
          </div>
        </div>
      )}
      {trashConfirmOpen && (
        <div className="modal-backdrop">
          <div className="modal session-modal" role="alertdialog" aria-modal="true">
            <header>🗑 {t("trash.title")}</header>
            <div className="content"><p>{t("trash.warning", { n: selectedItems.length })}</p><div className="warn-box">{t("trash.manual")}</div></div>
            <footer>
              <button disabled={fileOpBusy} onClick={() => setTrashConfirmOpen(false)}>{t("btn.cancel")}</button>
              <button className="danger-button" disabled={fileOpBusy} onClick={() => void confirmMoveToTrash()}>{fileOpBusy ? t("btn.working") : t("trash.confirm")}</button>
            </footer>
          </div>
        </div>
      )}
      {fileOpMessage && !takeoutOpen && !trashConfirmOpen && (
        <div className="toast" onClick={() => setFileOpMessage(null)}>{fileOpMessage}</div>
      )}
      {undoPreview && (
        <div className="modal-backdrop undo-backdrop">
          <div className="modal session-modal" role="alertdialog" aria-modal="true">
            <header>↶ {t("undo.title")}</header>
            <div className="content">
              <p>{t("undo.body", { action: undoPreview.label })}</p>
              <div className="session-root-list undo-files">{undoPreview.files.map((file, index) => <div key={`${file}-${index}`}>{file}</div>)}</div>
              <div className="path-box">{undoPreview.root}</div>
            </div>
            <footer>
              <button disabled={fileOpBusy} onClick={() => setUndoPreview(null)}>{t("btn.cancel")}</button>
              <button className="primary" disabled={fileOpBusy} onClick={() => void confirmUndo()}>{fileOpBusy ? t("btn.working") : t("undo.confirm")}</button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
