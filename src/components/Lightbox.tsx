import { useEffect } from "react";
import type { MediaItem } from "../types";
import { fileSrc } from "../api";
import { useI18n, placeLabel } from "../i18n";

interface Props {
  items: MediaItem[];
  index: number;
  onClose: () => void;
  onNav: (dir: number) => void;
  onShowMap: (item: MediaItem) => void;
}

function fmtSize(b: number): string {
  if (b > 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (b > 1e6) return (b / 1e6).toFixed(1) + " MB";
  if (b > 1e3) return (b / 1e3).toFixed(0) + " KB";
  return b + " B";
}

export default function Lightbox({ items, index, onClose, onNav, onShowMap }: Props) {
  const { t } = useI18n();
  const it = items[index];

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onNav(-1);
      if (e.key === "ArrowRight") onNav(1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, onNav]);

  if (!it) return null;
  const src = fileSrc(it.path);

  const locationName = placeLabel(it);
  const rows: [string, string | null][] = [
    [t("meta.type"), it.kind === "video" ? t("kind.video") : t("kind.photo")],
    [t("meta.taken"), it.taken_at?.replace("T", " ") ?? null],
    [t("meta.modified"), it.modified_at?.replace("T", " ") ?? null],
    [t("meta.dimensions"), it.width && it.height ? `${it.width} × ${it.height}` : null],
    [t("meta.fileSize"), fmtSize(it.size_bytes)],
    [t("meta.camera"), [it.camera_make, it.camera_model].filter(Boolean).join(" ") || null],
    [t("meta.location"), locationName ?? (it.gps_lat != null ? `${it.gps_lat.toFixed(5)}, ${it.gps_lon?.toFixed(5)}` : null)],
    [t("meta.duration"), it.duration_s ? `${it.duration_s.toFixed(1)} s` : null],
    [t("meta.folder"), it.root],
  ];

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={it.file_name}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="stage">
        <button className="nav prev" onClick={() => onNav(-1)} aria-label={t("lb.prev")}>‹</button>
        {it.kind === "video" ? (
          <video src={src} controls autoPlay aria-label={it.file_name} />
        ) : (
          <img src={src} alt={it.file_name} />
        )}
        <button className="nav next" onClick={() => onNav(1)} aria-label={t("lb.next")}>›</button>
      </div>
      <button className="close" onClick={onClose}>✕ {t("lb.close")}</button>
      <div className="meta-panel">
        <h2>{it.file_name}</h2>
        {it.gps_lat != null && (
          <button
            type="button"
            onClick={() => onShowMap(it)}
            className="badge-note" style={{ marginBottom: 12, display: "inline-block", textDecoration: "none" }}
          >📍 {locationName ? `${locationName} · ` : ""}{t("lb.showMap")}</button>
        )}
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div className="meta-row" key={k}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
        <p className="path-box" style={{ marginTop: 16 }}>{it.path}</p>
      </div>
    </div>
  );
}
