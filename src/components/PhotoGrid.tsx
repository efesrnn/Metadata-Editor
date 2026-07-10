import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { MediaItem } from "../types";
import { fileSrc } from "../api";
import { useI18n, formatSectionDate } from "../i18n";

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
  selectMode: boolean;
  groupByDay: boolean;
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

export default function PhotoGrid({ items, onOpen, selected, onToggleSelect, selectMode, groupByDay }: Props) {
  const { t, lang } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(0);

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

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop), []);

  const activate = (c: Cell) => (selectMode ? onToggleSelect(c.item.id) : onOpen(c.index));

  return (
    <div className="grid-wrap" ref={wrapRef} onScroll={onScroll} role="grid" aria-label="Media">
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
              onClick={() => activate(c)}
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
    </div>
  );
}
