import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { MediaItem } from "../types";
import { fileSrc } from "../api";

interface Cell {
  item: MediaItem;
  index: number;
  x: number; y: number; w: number; h: number;
}

interface Props {
  items: MediaItem[];
  onOpen: (index: number) => void;
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  selectMode: boolean;
}

const TARGET_ROW_H = 210;
const GAP = 6;
const OVERSCAN = 800; // px tampon (virtualization)

function aspect(it: MediaItem): number {
  if (it.width && it.height && it.height > 0) {
    const a = it.width / it.height;
    // Yon (orientation) 5-8 arasi 90 derece donmus demek
    if (it.orientation && it.orientation >= 5 && it.orientation <= 8) return 1 / a;
    return Math.min(Math.max(a, 0.4), 3.2);
  }
  return 1;
}

function fmtDuration(s: number | null): string {
  if (!s) return "";
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function PhotoGrid({ items, onOpen, selected, onToggleSelect, selectMode }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth - 20);
      setViewH(el.clientHeight);
    });
    ro.observe(el);
    setWidth(el.clientWidth - 20);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Justified layout hesabi (satirlari doldurup genisliğe olcekle)
  const { cells, totalHeight } = useMemo(() => {
    const out: Cell[] = [];
    if (width <= 0 || items.length === 0) return { cells: out, totalHeight: 0 };

    let row: { it: MediaItem; idx: number; a: number }[] = [];
    let rowAspect = 0;
    let y = 0;

    const flush = (isLast: boolean) => {
      if (row.length === 0) return;
      const gaps = GAP * (row.length - 1);
      let h = (width - gaps) / rowAspect;
      if (isLast) h = Math.min(h, TARGET_ROW_H);
      let x = 0;
      for (const r of row) {
        const w = h * r.a;
        out.push({ item: r.it, index: r.idx, x, y, w, h });
        x += w + GAP;
      }
      y += h + GAP;
      row = []; rowAspect = 0;
    };

    items.forEach((it, idx) => {
      const a = aspect(it);
      row.push({ it, idx, a });
      rowAspect += a;
      const projectedH = (width - GAP * (row.length - 1)) / rowAspect;
      if (projectedH <= TARGET_ROW_H) flush(false);
    });
    flush(true);

    return { cells: out, totalHeight: y };
  }, [items, width]);

  // Sanallaştırma: yalniz gorunur hucreler
  const visible = useMemo(() => {
    const top = scrollTop - OVERSCAN;
    const bot = scrollTop + viewH + OVERSCAN;
    return cells.filter((c) => c.y + c.h >= top && c.y <= bot);
  }, [cells, scrollTop, viewH]);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  return (
    <div className="grid-wrap" ref={wrapRef} onScroll={onScroll}>
      <div className="grid-inner" style={{ height: totalHeight }}>
        {visible.map((c) => {
          const it = c.item;
          const isSel = selected.has(it.id);
          return (
            <div
              key={it.id}
              className={`cell${isSel ? " selected" : ""}`}
              style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
              onClick={() => (selectMode ? onToggleSelect(it.id) : onOpen(c.index))}
            >
              {it.thumb_path ? (
                <img src={fileSrc(it.thumb_path)} loading="lazy" alt={it.file_name} />
              ) : (
                <div className="ph">
                  {it.kind === "video" ? "🎬" : "🖼"}
                </div>
              )}
              <div className="sel">✓</div>
              {it.kind === "video" && (
                <div className="badge">▶ {fmtDuration(it.duration_s)}</div>
              )}
              {it.gps_lat != null && it.kind === "photo" && (
                <div className="badge" style={{ left: 6, right: "auto" }}>📍</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
