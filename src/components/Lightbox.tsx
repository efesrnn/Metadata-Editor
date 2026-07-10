import { useEffect } from "react";
import type { MediaItem } from "../types";
import { fileSrc } from "../api";

interface Props {
  items: MediaItem[];
  index: number;
  onClose: () => void;
  onNav: (dir: number) => void;
}

function fmtSize(b: number): string {
  if (b > 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (b > 1e6) return (b / 1e6).toFixed(1) + " MB";
  if (b > 1e3) return (b / 1e3).toFixed(0) + " KB";
  return b + " B";
}

export default function Lightbox({ items, index, onClose, onNav }: Props) {
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

  const rows: [string, string | null][] = [
    ["Tur", it.kind === "video" ? "Video" : "Fotograf"],
    ["Cekim tarihi", it.taken_at?.replace("T", " ") ?? null],
    ["Degistirme", it.modified_at?.replace("T", " ") ?? null],
    ["Boyut", it.width && it.height ? `${it.width} × ${it.height}` : null],
    ["Dosya boyutu", fmtSize(it.size_bytes)],
    ["Kamera", [it.camera_make, it.camera_model].filter(Boolean).join(" ") || null],
    ["Konum", it.gps_lat != null ? `${it.gps_lat.toFixed(5)}, ${it.gps_lon?.toFixed(5)}` : null],
    ["Sure", it.duration_s ? `${it.duration_s.toFixed(1)} sn` : null],
    ["Klasor", it.root],
  ];

  return (
    <div className="lightbox" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="stage">
        <button className="nav prev" onClick={() => onNav(-1)}>‹</button>
        {it.kind === "video" ? (
          <video src={src} controls autoPlay />
        ) : (
          <img src={src} alt={it.file_name} />
        )}
        <button className="nav next" onClick={() => onNav(1)}>›</button>
      </div>
      <button className="close" onClick={onClose}>✕ Kapat</button>
      <div className="meta-panel">
        <h2>{it.file_name}</h2>
        {it.gps_lat != null && (
          <a
            href={`https://www.openstreetmap.org/?mlat=${it.gps_lat}&mlon=${it.gps_lon}#map=15/${it.gps_lat}/${it.gps_lon}`}
            target="_blank" rel="noreferrer"
            className="badge-note" style={{ marginBottom: 12, display: "inline-block", textDecoration: "none" }}
          >📍 Haritada goster</a>
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
