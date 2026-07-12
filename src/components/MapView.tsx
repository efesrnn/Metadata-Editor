import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import type { MediaItem } from "../types";
import { fileSrc } from "../api";
import { useI18n } from "../i18n";

interface Props {
  items: MediaItem[];
  onOpen: (index: number) => void;
  focusLocation?: { lat: number; lon: number; key: number } | null;
  assignmentItem?: MediaItem | null;
  onAssign?: (lat: number, lon: number) => Promise<void>;
  onCancelAssign?: () => void;
}

function gradient(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `linear-gradient(135deg, hsl(${hue} 45% 40%), hsl(${(hue + 40) % 360} 50% 26%))`;
}

function mediaDay(item: MediaItem): string | null {
  const value = item.taken_at ?? item.modified_at;
  return value ? value.slice(0, 10) : null;
}

// Bir oge icin kart HTML'i (thumbnail veya poster + video rozeti)
function pinHtml(it: MediaItem, size: number): string {
  const inner = it.thumb_path
    ? `<img src="${fileSrc(it.thumb_path)}" alt="" />`
    : `<div class="poster" style="background:${gradient(it.file_name)}"></div>`;
  const play = it.kind === "video"
    ? `<span class="pin-play">▶</span>`
    : "";
  return `<div class="map-pin" style="width:${size}px;height:${size}px">${inner}${play}</div>`;
}

export default function MapView({ items, onOpen, focusLocation, assignmentItem, onAssign, onCancelAssign }: Props) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const draftMarkerRef = useRef<L.Marker | null>(null);
  const focusMarkerRef = useRef<L.CircleMarker | null>(null);
  const [draft, setDraft] = useState<{ lat: number; lon: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Haritayi bir kez olustur
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;
    const map = L.map(el, { zoomControl: true, worldCopyJump: true }).setView([20, 0], 2);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);

    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 55,
      iconCreateFunction: (cluster) => {
        const children = cluster.getAllChildMarkers();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const thumb = (children[0] as any)?._thumbUrl as string | undefined;
        const count = cluster.getChildCount();
        const bg = thumb ? `background-image:url('${thumb}')` : "background:#334";
        return L.divIcon({
          html: `<div class="map-cluster" style="${bg}"><span class="badge-count">${count}</span></div>`,
          className: "map-cluster-wrap",
          iconSize: [64, 64],
        });
      },
    });
    map.addLayer(cluster);
    mapRef.current = map;
    clusterRef.current = cluster;
    // Kapsayici yeni gorunur oldugunda boyutu tazele (aksi halde griler kalir).
    // Lightbox acildiginda harita display:none olur; kapaninca ResizeObserver
    // yeniden boyutlandirmayi yakalayip tazeler.
    setTimeout(() => map.invalidateSize(), 120);
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) mapRef.current?.invalidateSize();
    });
    ro.observe(el);

    return () => { ro.disconnect(); map.remove(); mapRef.current = null; clusterRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !assignmentItem) {
      setDraft(null); setError(null);
      draftMarkerRef.current?.remove();
      draftMarkerRef.current = null;
      return;
    }
    map.getContainer().classList.add("is-picking");
    const choose = (event: L.LeafletMouseEvent) => {
      const next = { lat: event.latlng.lat, lon: event.latlng.lng };
      setDraft(next);
      const icon = L.divIcon({ html: '<div class="location-draft-pin"><span>+</span></div>', className: "location-draft-wrap", iconSize: [34, 46], iconAnchor: [17, 44] });
      if (draftMarkerRef.current) draftMarkerRef.current.setLatLng(event.latlng);
      else draftMarkerRef.current = L.marker(event.latlng, { icon, zIndexOffset: 2000 }).addTo(map);
    };
    map.on("click", choose);
    return () => { map.off("click", choose); map.getContainer().classList.remove("is-picking"); };
  }, [assignmentItem]);

  // Ogeler degisince isaretcileri yenile
  useEffect(() => {
    const map = mapRef.current, cluster = clusterRef.current;
    if (!map || !cluster) return;
    cluster.clearLayers();

    const assignmentDay = assignmentItem ? mediaDay(assignmentItem) : null;
    const visibleItems = assignmentItem
      ? items.filter((item) => item.kind === "video" && item.gps_lat != null && mediaDay(item) === assignmentDay)
      : items;
    const located = visibleItems
      .map((it, index) => ({ it, index }))
      .filter(({ it }) => it.gps_lat != null && it.gps_lon != null);

    const markers: L.Marker[] = [];
    for (const { it, index } of located) {
      const icon = L.divIcon({
        html: pinHtml(it, 52),
        className: "map-pin-wrap",
        iconSize: [52, 52],
        iconAnchor: [26, 26],
      });
      const marker = L.marker([it.gps_lat!, it.gps_lon!], { icon });
      // Kume ikonunda kullanmak icin thumbnail url'sini iliştir
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (marker as any)._thumbUrl = it.thumb_path ? fileSrc(it.thumb_path) : undefined;
      const originalIndex = items.findIndex((item) => item.id === it.id);
      marker.on("click", () => onOpen(originalIndex >= 0 ? originalIndex : index));
      markers.push(marker);
    }
    cluster.addLayers(markers);

    if (markers.length > 0 && !focusLocation) {
      try { map.fitBounds(cluster.getBounds().pad(0.2), { maxZoom: 14 }); } catch { /* ignore */ }
    }
  }, [items, onOpen, assignmentItem, focusLocation]);

  useEffect(() => {
    if (!focusLocation || !mapRef.current) return;
    const map = mapRef.current;
    const point: L.LatLngExpression = [focusLocation.lat, focusLocation.lon];
    map.stop();
    map.invalidateSize();
    map.setView(point, 18, { animate: false });
    focusMarkerRef.current?.remove();
    focusMarkerRef.current = L.circleMarker(point, {
      radius: 18, color: "#ffffff", weight: 3, fillColor: "#4f8cff", fillOpacity: .35,
      pane: "markerPane",
    }).addTo(map);
    const timer = window.setTimeout(() => {
      map.stop(); map.invalidateSize(); map.setView(point, 18, { animate: false });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [focusLocation]);

  const assignmentDay = assignmentItem ? mediaDay(assignmentItem) : null;
  const count = items.filter((item) => item.gps_lat != null && (!assignmentItem || (item.kind === "video" && mediaDay(item) === assignmentDay))).length;

  return (
    <div className="map-view">
      <div ref={containerRef} className="map-canvas" />
      {count === 0 && <div className="map-empty">{t("map.empty")}</div>}
      {count > 0 && <div className="map-badge">{t("map.count", { n: count })}</div>}
      {assignmentItem && (
        <div className="map-picker-panel">
          <div className="picker-title">{t("map.pickTitle")}</div>
          <div className="picker-file">{assignmentItem.file_name}</div>
          <div className="picker-suggestions">{t("map.suggestions", { n: count })}</div>
          <p>{draft ? `${draft.lat.toFixed(5)}, ${draft.lon.toFixed(5)}` : t("map.pickHint")}</p>
          {error && <div className="err">{error}</div>}
          <div className="picker-actions">
            <button onClick={onCancelAssign}>{t("btn.cancel")}</button>
            <button className="primary" disabled={!draft || saving} onClick={async () => {
              if (!draft || !onAssign) return;
              setSaving(true); setError(null);
              try { await onAssign(draft.lat, draft.lon); } catch (e) { setError(String(e)); }
              finally { setSaving(false); }
            }}>{saving ? t("map.saving") : t("map.saveLocation")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
