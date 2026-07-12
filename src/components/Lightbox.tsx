import { useEffect, useState } from "react";
import type { MediaItem } from "../types";
import { fileSrc } from "../api";
import { useI18n, placeLabel } from "../i18n";

interface Props {
  items: MediaItem[];
  index: number;
  onClose: () => void;
  onEscape: () => void;
  onNav: (dir: number) => void;
  onShowMap: (item: MediaItem) => void;
  onAddLocation: (item: MediaItem) => void;
  onUpdateVideo: (item: MediaItem, fileName: string, takenAt: string) => Promise<void>;
}

function fmtSize(b: number): string {
  if (b > 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (b > 1e6) return (b / 1e6).toFixed(1) + " MB";
  if (b > 1e3) return (b / 1e3).toFixed(0) + " KB";
  return b + " B";
}

export default function Lightbox({ items, index, onClose, onEscape, onNav, onShowMap, onAddLocation, onUpdateVideo }: Props) {
  const { t } = useI18n();
  const it = items[index];
  const [infoOpen, setInfoOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(it?.file_name ?? "");
  const [editDate, setEditDate] = useState((it?.taken_at ?? it?.modified_at ?? "").slice(0, 16));
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!it) return;
    setEditName(it.file_name);
    setEditDate((it.taken_at ?? it.modified_at ?? "").slice(0, 16));
    setEditing(false); setEditError(null);
  }, [it]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
      if (e.key === "ArrowLeft") onNav(-1);
      if (e.key === "ArrowRight") onNav(1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onEscape, onNav]);

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
    <div className={`lightbox ${infoOpen ? "info-open" : "info-closed"}`} role="dialog" aria-modal="true" aria-label={it.file_name}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="stage">
        <button className="nav prev" onClick={() => onNav(-1)} aria-label={t("lb.prev")}>‹</button>
        {it.kind === "video" ? (
          <div className="video-shell"><video src={src} controls autoPlay playsInline aria-label={it.file_name} /></div>
        ) : (
          <img src={src} alt={it.file_name} />
        )}
        <button className="nav next" onClick={() => onNav(1)} aria-label={t("lb.next")}>›</button>
      </div>
      <button className="close" onClick={onClose}>✕ {t("lb.close")}</button>
      <button className="info-toggle" onClick={() => setInfoOpen((open) => !open)} aria-expanded={infoOpen}>
        {infoOpen ? "→" : "ⓘ"} <span>{infoOpen ? t("lb.hideInfo") : t("lb.showInfo")}</span>
      </button>
      <aside className="meta-panel" aria-hidden={!infoOpen}>
        <h2>{it.file_name}</h2>
        {it.kind === "video" && !editing && (
          <button className="video-edit-button" onClick={() => setEditing(true)}>✎ {t("lb.editVideo")}</button>
        )}
        {it.kind === "video" && editing && (
          <div className="video-edit-form">
            <label>{t("meta.fileName")}<input value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
            <label>{t("meta.taken")}<input type="datetime-local" step="1" value={editDate} onChange={(event) => setEditDate(event.target.value)} /></label>
            {editError && <div className="err">{editError}</div>}
            <div className="video-edit-actions">
              <button onClick={() => setEditing(false)}>{t("btn.cancel")}</button>
              <button className="primary" disabled={saving || !editName.trim() || !editDate} onClick={async () => {
                setSaving(true); setEditError(null);
                try {
                  const normalized = editDate.length === 16 ? `${editDate}:00` : editDate;
                  await onUpdateVideo(it, editName, normalized);
                } catch (error) { setEditError(String(error)); }
                finally { setSaving(false); }
              }}>{saving ? t("lb.savingVideo") : t("btn.save")}</button>
            </div>
          </div>
        )}
        {it.gps_lat != null && (
          <button
            type="button"
            onClick={() => onShowMap(it)}
            className="badge-note" style={{ marginBottom: 12, display: "inline-block", textDecoration: "none" }}
          >📍 {locationName ? `${locationName} · ` : ""}{t("lb.showMap")}</button>
        )}
        {it.gps_lat == null && (
          <button type="button" onClick={() => onAddLocation(it)} className="location-add">＋ {t("lb.addLocation")}</button>
        )}
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div className="meta-row" key={k}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
        <p className="path-box" style={{ marginTop: 16 }}>{it.path}</p>
      </aside>
    </div>
  );
}
