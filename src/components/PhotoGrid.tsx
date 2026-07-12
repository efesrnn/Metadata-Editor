import { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from "react";
import type { MediaItem } from "../types";
import { fileSrc } from "../api";
import { useI18n, formatSectionDate } from "../i18n";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { startDrag } from "@crabnebula/tauri-plugin-drag";

interface Cell {
  item: MediaItem;
  index: number;
  x: number; y: number; w: number; h: number;
}
interface Header { key: string; label: string; y: number; }

interface Props {
  items: MediaItem[];
  onOpen: (index: number) => void;
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  onAddSelect: (id: number) => void;
  onRemoveSelect: (id: number) => void;
  onStartSelect: (id: number) => void;
  selectMode: boolean;
  groupByDay: boolean;
  initialScrollTop?: number;
  onScrollPosition?: (top: number) => void;
  onVisibleDayChange?: (day: string | null) => void;
}

const TARGET_ROW_H = 210;
const GAP = 6;
const HEADER_H = 46;
const OVERSCAN = 800;

function aspect(it: MediaItem): number {
  if (it.width && it.height && it.height > 0) {
    const a = it.width / it.height;
    if (it.orientation && it.orientation >= 5 && it.orientation <= 8) return Math.min(Math.max(1 / a, 0.4), 3.2);
    return Math.min(Math.max(a, 0.4), 3.2);
  }
  return 1;
}
function fmtDuration(s: number | null): string {
  if (!s) return "";
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
function dayKey(it: MediaItem): string {
  const d = it.taken_at ?? it.modified_at;
  return d ? d.slice(0, 10) : "__nodate__";
}
function posterGradient(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `linear-gradient(135deg, hsl(${hue} 40% 32%), hsl(${(hue + 40) % 360} 45% 18%))`;
}

export default function PhotoGrid({ items, onOpen, selected, onToggleSelect, onAddSelect, onRemoveSelect, onStartSelect, selectMode, groupByDay, initialScrollTop = 0, onScrollPosition, onVisibleDayChange }: Props) {
  const { t, lang } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(0);
  const restored = useRef(false);
  const dragRef = useRef<{ startX: number; startY: number; startId: number; dragging: boolean; x: number; y: number; mode: "add" | "remove" } | null>(null);
  const autoScrollRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const suppressContextRef = useRef(false);
  const externalDragRef = useRef<{ startX: number; startY: number; item: MediaItem } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: MediaItem } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); };
  }, [contextMenu]);

  useEffect(() => () => { if (autoScrollRef.current != null) cancelAnimationFrame(autoScrollRef.current); }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { setWidth(el.clientWidth - 20); setViewH(el.clientHeight); });
    ro.observe(el);
    setWidth(el.clientWidth - 20); setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const { cells, headers, totalHeight } = useMemo(() => {
    const outCells: Cell[] = [];
    const outHeaders: Header[] = [];
    if (width <= 0 || items.length === 0) return { cells: outCells, headers: outHeaders, totalHeight: 0 };

    let y = 0;
    let row: { it: MediaItem; idx: number; a: number }[] = [];
    let rowAspect = 0;

    const flush = (isLast: boolean) => {
      if (row.length === 0) return;
      const gaps = GAP * (row.length - 1);
      let h = (width - gaps) / rowAspect;
      if (isLast) h = Math.min(h, TARGET_ROW_H);
      let x = 0;
      for (const r of row) {
        const w = h * r.a;
        outCells.push({ item: r.it, index: r.idx, x, y, w, h });
        x += w + GAP;
      }
      y += h + GAP;
      row = []; rowAspect = 0;
    };

    // Bölümlere ayır (gün gün) veya tek akış
    type Section = { key: string; label: string; items: { it: MediaItem; idx: number }[] };
    const sections: Section[] = [];
    if (groupByDay) {
      let cur: Section | null = null;
      items.forEach((it, idx) => {
        const k = dayKey(it);
        let section = cur;
        if (!section || section.key !== k) {
          const dateStr = it.taken_at ?? it.modified_at ?? "";
          section = { key: k, label: k === "__nodate__" ? t("section.noDate") : formatSectionDate(dateStr, lang), items: [] };
          sections.push(section);
          cur = section;
        }
        section.items.push({ it, idx });
      });
    } else {
      sections.push({ key: "all", label: "", items: items.map((it, idx) => ({ it, idx })) });
    }

    for (const sec of sections) {
      if (sec.label) {
        y += 8;
        outHeaders.push({ key: sec.key, label: sec.label, y });
        y += HEADER_H;
      }
      sec.items.forEach(({ it, idx }, i) => {
        const a = aspect(it);
        row.push({ it, idx, a });
        rowAspect += a;
        const projectedH = (width - GAP * (row.length - 1)) / rowAspect;
        if (projectedH <= TARGET_ROW_H) flush(false);
        if (i === sec.items.length - 1) flush(true);
      });
      y += 4;
    }

    return { cells: outCells, headers: outHeaders, totalHeight: y };
  }, [items, width, groupByDay, lang, t]);

  const visibleCells = useMemo(() => {
    const top = scrollTop - OVERSCAN, bot = scrollTop + viewH + OVERSCAN;
    return cells.filter((c) => c.y + c.h >= top && c.y <= bot);
  }, [cells, scrollTop, viewH]);

  const visibleHeaders = useMemo(() => {
    const top = scrollTop - OVERSCAN, bot = scrollTop + viewH + OVERSCAN;
    return headers.filter((h) => h.y + HEADER_H >= top && h.y <= bot);
  }, [headers, scrollTop, viewH]);

  useEffect(() => {
    if (!onVisibleDayChange) return;
    const topCell = cells.find((cell) => cell.y + cell.h >= scrollTop + 1);
    onVisibleDayChange(topCell ? dayKey(topCell.item) : null);
  }, [cells, onVisibleDayChange, scrollTop]);

  useLayoutEffect(() => {
    if (restored.current || !wrapRef.current || totalHeight <= 0) return;
    wrapRef.current.scrollTop = initialScrollTop;
    setScrollTop(initialScrollTop);
    restored.current = true;
  }, [initialScrollTop, totalHeight]);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    setScrollTop(top); onScrollPosition?.(top);
  }, [onScrollPosition]);

  const activate = (c: Cell) => (selectMode ? onToggleSelect(c.item.id) : onOpen(c.index));

  const applyItemAtPoint = useCallback((x: number, y: number, mode: "add" | "remove") => {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-media-id]");
    const id = Number(element?.dataset.mediaId);
    if (Number.isFinite(id)) mode === "add" ? onAddSelect(id) : onRemoveSelect(id);
  }, [onAddSelect, onRemoveSelect]);

  const stopDrag = useCallback(() => {
    dragRef.current = null;
    externalDragRef.current = null;
    if (autoScrollRef.current != null) cancelAnimationFrame(autoScrollRef.current);
    autoScrollRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
    return () => {
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
    };
  }, [stopDrag]);

  const runAutoScroll = useCallback(() => {
    const state = dragRef.current, wrap = wrapRef.current;
    if (!state?.dragging || !wrap) { autoScrollRef.current = null; return; }
    const rect = wrap.getBoundingClientRect();
    const edge = 72;
    let speed = 0;
    if (state.y > rect.bottom - edge) speed = Math.min(22, (state.y - (rect.bottom - edge)) * .45);
    else if (state.y < rect.top + edge) speed = -Math.min(22, ((rect.top + edge) - state.y) * .45);
    if (speed) {
      wrap.scrollTop += speed;
      applyItemAtPoint(state.x, Math.min(rect.bottom - 4, Math.max(rect.top + 4, state.y)), state.mode);
    }
    autoScrollRef.current = requestAnimationFrame(runAutoScroll);
  }, [applyItemAtPoint]);

  return (
    <div className={`grid-wrap${selectMode ? " drag-select-enabled" : ""}`} ref={wrapRef} onScroll={onScroll} role="grid" aria-label="Media"
      onPointerMove={(event) => {
        const external = externalDragRef.current;
        if (!selectMode && external && (event.buttons & 1) && Math.hypot(event.clientX - external.startX, event.clientY - external.startY) > 7) {
          externalDragRef.current = null;
          suppressClickRef.current = true;
          const draggedItems = selected.has(external.item.id)
            ? items.filter((item) => selected.has(item.id))
            : [external.item];
          void startDrag({
            item: draggedItems.map((item) => item.path),
            icon: external.item.thumb_path ?? external.item.path,
            mode: "copy",
          }).catch((error) => console.error("Native file drag failed", error));
          return;
        }
        const state = dragRef.current;
        const requiredButton = state?.mode === "remove" ? 2 : 1;
        if (!state || !selectMode || !(event.buttons & requiredButton)) return;
        state.x = event.clientX; state.y = event.clientY;
        if (!state.dragging && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > 7) {
          state.dragging = true;
          if (state.mode === "add") { suppressClickRef.current = true; onAddSelect(state.startId); }
          else { suppressContextRef.current = true; onRemoveSelect(state.startId); }
          if (autoScrollRef.current == null) autoScrollRef.current = requestAnimationFrame(runAutoScroll);
        }
        if (state.dragging) { event.preventDefault(); applyItemAtPoint(event.clientX, event.clientY, state.mode); }
      }}
      onPointerUp={stopDrag} onPointerCancel={stopDrag} onPointerLeave={(event) => { if (!(event.buttons & 1)) stopDrag(); }}>
      <div className="grid-inner" style={{ height: totalHeight }}>
        {visibleHeaders.map((h) => (
          <div key={h.key} className="section-label" style={{ top: h.y }}>{h.label}</div>
        ))}
        {visibleCells.map((c) => {
          const it = c.item;
          const isSel = selected.has(it.id);
          const isVideo = it.kind === "video";
          const hasThumb = !!it.thumb_path;
          const label = `${it.file_name}${it.taken_at ? " · " + it.taken_at.slice(0, 10) : ""}`;
          return (
            <div
              key={it.id}
              className={`cell${isSel ? " selected" : ""}`}
              style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={selectMode ? isSel : undefined}
              title={it.file_name}
              data-media-id={it.id}
              onPointerDown={(event) => {
                if (selectMode && (event.button === 0 || event.button === 2)) dragRef.current = {
                  startX: event.clientX, startY: event.clientY, startId: it.id, dragging: false,
                  x: event.clientX, y: event.clientY, mode: event.button === 2 ? "remove" : "add",
                };
                else if (!selectMode && event.button === 0) externalDragRef.current = { startX: event.clientX, startY: event.clientY, item: it };
              }}
              onContextMenu={(event) => {
                event.preventDefault(); event.stopPropagation();
                if (suppressContextRef.current) { suppressContextRef.current = false; return; }
                setContextMenu({ x: event.clientX, y: event.clientY, item: it });
              }}
              onClick={() => {
                if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                activate(c);
              }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(c); } }}
            >
              {hasThumb ? (
                <img
                  src={fileSrc(it.thumb_path!)}
                  loading="lazy"
                  alt={it.file_name}
                  draggable={false}
                  onLoad={(e) => e.currentTarget.classList.add("loaded")}
                />
              ) : isVideo ? (
                <div className="ph video-ph" style={{ background: posterGradient(it.file_name) }} aria-hidden="true" />
              ) : (
                <div className="ph" aria-hidden="true">🖼</div>
              )}

              {isVideo && (
                <div className="play-overlay" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                </div>
              )}
              <div className="sel" aria-hidden="true">✓</div>
              {isVideo && it.duration_s ? <div className="badge">{fmtDuration(it.duration_s)}</div> : null}
              {it.gps_lat != null && !isVideo && (
                <div className="badge left" aria-hidden="true">📍</div>
              )}
            </div>
          );
        })}
      </div>
      {contextMenu && (
        <div className="media-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
          <button onClick={() => { void revealItemInDir(contextMenu.item.path); setContextMenu(null); }}>⌖ {t("context.reveal")}</button>
          <button onClick={() => { onStartSelect(contextMenu.item.id); setContextMenu(null); }}>✓ {t("context.select")}</button>
        </div>
      )}
    </div>
  );
}
