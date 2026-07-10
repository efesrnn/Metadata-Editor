import { useEffect, useRef } from "react";
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
}

function gradient(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `linear-gradient(135deg, hsl(${hue} 45% 40%), hsl(${(hue + 40) % 360} 50% 26%))`;
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

export default function MapView({ items, onOpen, focusLocation }: Props) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);

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
    // Kapsayici yeni gorunur oldugunda boyutu tazele (aksi halde griler kalir)
    setTimeout(() => map.invalidateSize(), 120);

    return () => { map.remove(); mapRef.current = null; clusterRef.current = null; };
  }, []);

  // Ogeler degisince isaretcileri yenile
  useEffect(() => {
    const map = mapRef.current, cluster = clusterRef.current;
    if (!map || !cluster) return;
    cluster.clearLayers();

    const located = items
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
      marker.on("click", () => onOpen(index));
      markers.push(marker);
    }
    cluster.addLayers(markers);

    if (markers.length > 0) {
      try { map.fitBounds(cluster.getBounds().pad(0.2), { maxZoom: 14 }); } catch { /* ignore */ }
    }
  }, [items, onOpen]);

  useEffect(() => {
    if (!focusLocation || !mapRef.current) return;
    const map = mapRef.current;
    map.invalidateSize();
    map.setView([focusLocation.lat, focusLocation.lon], 16, { animate: true });
  }, [focusLocation]);

  const count = items.filter((i) => i.gps_lat != null).length;

  return (
    <div className="map-view">
      <div ref={containerRef} className="map-canvas" />
      {count === 0 && <div className="map-empty">{t("map.empty")}</div>}
      {count > 0 && <div className="map-badge">{t("map.count", { n: count })}</div>}
    </div>
  );
}
