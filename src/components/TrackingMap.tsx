import { useEffect, useRef } from "react";
import type * as L from "leaflet";

export interface GeoPoint { lat: number; lng: number; t?: number }
export interface PlateMarker extends GeoPoint {
  id: string;
  label: string;
  status: "matched" | "incomplete" | "detected";
}

interface Props {
  path: GeoPoint[];
  markers?: PlateMarker[];
  follow?: boolean;
  showCar?: boolean;
  height?: number;
  className?: string;
  onMarkerClick?: (id: string) => void;
  /** Marker id to highlight, zoom to, and pulse. */
  focusId?: string | null;
  /** If set, renders only path[0..playbackIndex] and puts car there. */
  playbackIndex?: number | null;
  pathColor?: string;
}

function statusColor(s: PlateMarker["status"]): string {
  return s === "matched" ? "#10b981" : s === "incomplete" ? "#f59e0b" : "#3b82f6";
}

function carIcon(Ll: typeof import("leaflet")) {
  return Ll.divIcon({
    className: "",
    html: `<div style="font-size:26px;line-height:1;transform:translate(-50%,-90%);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))">🚗</div>`,
    iconSize: [0, 0],
  });
}

function plateIcon(Ll: typeof import("leaflet"), status: PlateMarker["status"], label: string, focused: boolean) {
  const color = statusColor(status);
  const scale = focused ? 1.35 : 1;
  const ring = focused
    ? `<div style="position:absolute;inset:-8px;border-radius:999px;border:3px solid ${color};animation:pcpulse 1.4s ease-out infinite;"></div>`
    : "";
  const html = `
    <div style="position:relative;transform:translate(-50%,-100%) scale(${scale});display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))">
      ${ring}
      <div style="background:${color};color:#fff;padding:2px 6px;border-radius:8px;font-size:10px;font-weight:800;font-family:ui-monospace,monospace;white-space:nowrap;border:1.5px solid #fff">${label}</div>
      <div style="width:10px;height:10px;background:${color};border:2px solid #fff;border-radius:50%;margin-top:-2px"></div>
    </div>`;
  return Ll.divIcon({ className: "", html, iconSize: [0, 0] });
}

// One-time keyframe injection for the pulse animation on the focused marker.
function ensurePulseCSS() {
  if (typeof document === "undefined") return;
  if (document.getElementById("pc-pulse-css")) return;
  const s = document.createElement("style");
  s.id = "pc-pulse-css";
  s.textContent = `@keyframes pcpulse{0%{transform:scale(1);opacity:.85}100%{transform:scale(1.9);opacity:0}}`;
  document.head.appendChild(s);
}

export function TrackingMap({ path, markers = [], follow = false, showCar = false, height = 220, className = "", onMarkerClick, focusId = null, playbackIndex = null, pathColor = "#dc2626" }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polyRef = useRef<L.Polyline | null>(null);
  const carRef = useRef<L.Marker | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const markerRefs = useRef<Map<string, L.Marker>>(new Map());
  const leafletRef = useRef<typeof import("leaflet") | null>(null);

  useEffect(() => {
    ensurePulseCSS();
    let cancelled = false;
    (async () => {
      const Ll = await import("leaflet");
      if (cancelled || !containerRef.current) return;
      leafletRef.current = Ll;
      const initialPoint = path[0] ?? markers[0];
      const initial: [number, number] = initialPoint ? [initialPoint.lat, initialPoint.lng] : [24.7136, 46.6753];
      const map = Ll.map(containerRef.current, { zoomControl: false, attributionControl: false, preferCanvas: true }).setView(initial, 16);
      Ll.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { maxZoom: 19, subdomains: "abcd" }).addTo(map);
      Ll.control.zoom({ position: "topleft" }).addTo(map);
      polyRef.current = Ll.polyline([], { color: pathColor, weight: 6, opacity: 0.9, lineJoin: "round", lineCap: "round" }).addTo(map);
      markerLayerRef.current = Ll.layerGroup().addTo(map);
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 50);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      polyRef.current = null;
      carRef.current = null;
      markerLayerRef.current = null;
      markerRefs.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // polyline + car + playback
  useEffect(() => {
    const Ll = leafletRef.current;
    const map = mapRef.current;
    const poly = polyRef.current;
    if (!Ll || !map || !poly) return;
    const sliced = playbackIndex != null && playbackIndex >= 0 ? path.slice(0, playbackIndex + 1) : path;
    const latlngs = sliced.map((p) => [p.lat, p.lng] as [number, number]);
    poly.setLatLngs(latlngs);
    poly.setStyle({ color: pathColor });
    const last = latlngs[latlngs.length - 1];
    const drawCar = showCar || playbackIndex != null || path.length > 0;
    if (drawCar && last) {
      if (!carRef.current) {
        carRef.current = Ll.marker(last, { icon: carIcon(Ll), interactive: false, keyboard: false }).addTo(map);
      } else {
        carRef.current.setLatLng(last);
      }
    } else if (!drawCar && carRef.current) {
      carRef.current.remove();
      carRef.current = null;
    }
    if (playbackIndex != null && last) {
      map.panTo(last, { animate: true, duration: 0.35 });
    } else if (follow && last) {
      map.panTo(last, { animate: true, duration: 0.6 });
    } else if (latlngs.length > 1 && focusId == null) {
      try { map.fitBounds(poly.getBounds(), { padding: [30, 30], maxZoom: 17 }); } catch { /* empty */ }
    } else if (markers.length > 0 && focusId == null) {
      try {
        map.fitBounds(Ll.latLngBounds(markers.map((m) => [m.lat, m.lng] as [number, number])), { padding: [35, 35], maxZoom: 17 });
      } catch { /* empty */ }
    } else if (last && focusId == null) {
      map.setView(last, 16);
    }
  }, [path, markers, follow, showCar, playbackIndex, focusId, pathColor]);

  // markers (spiderify overlapping coords in pixel space so every plate is visible at any zoom)
  useEffect(() => {
    const Ll = leafletRef.current;
    const map = mapRef.current;
    const layer = markerLayerRef.current;
    if (!Ll || !map || !layer) return;

    const render = () => {
      layer.clearLayers();
      markerRefs.current.clear();

      const keyOf = (lat: number, lng: number) => `${lat.toFixed(5)}:${lng.toFixed(5)}`;
      const groups = new Map<string, PlateMarker[]>();
      for (const m of markers) {
        const k = keyOf(m.lat, m.lng);
        const arr = groups.get(k) ?? [];
        arr.push(m);
        groups.set(k, arr);
      }

      for (const [, arr] of groups) {
        if (arr.length === 1) {
          const m = arr[0];
          const marker = Ll.marker([m.lat, m.lng], { icon: plateIcon(Ll, m.status, m.label, focusId === m.id) });
          if (onMarkerClick) marker.on("click", () => onMarkerClick(m.id));
          marker.addTo(layer);
          markerRefs.current.set(m.id, marker);
          continue;
        }
        // spiderify: fan out in pixel space around the shared center
        const center = arr[0];
        const centerPt = map.latLngToLayerPoint([center.lat, center.lng]);
        const n = arr.length;
        const radius = Math.max(48, 24 + n * 8);

        // center dot marking the true shared location
        const dotIcon = Ll.divIcon({
          className: "",
          html: `<div style="width:10px;height:10px;border-radius:999px;background:#2563eb;border:2px solid #fff;box-shadow:0 0 0 2px rgba(37,99,235,.35);transform:translate(-50%,-50%)"></div>`,
          iconSize: [10, 10],
        });
        Ll.marker([center.lat, center.lng], { icon: dotIcon, interactive: false, keyboard: false }).addTo(layer);

        arr.forEach((m, i) => {
          const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
          const px = centerPt.x + Math.cos(angle) * radius;
          const py = centerPt.y + Math.sin(angle) * radius;
          const ll = map.layerPointToLatLng([px, py]);

          Ll.polyline([[center.lat, center.lng], [ll.lat, ll.lng]], {
            color: "#2563eb",
            weight: 1.5,
            opacity: 0.7,
            dashArray: "3,3",
            interactive: false,
          }).addTo(layer);

          const marker = Ll.marker([ll.lat, ll.lng], { icon: plateIcon(Ll, m.status, m.label, focusId === m.id) });
          if (onMarkerClick) marker.on("click", () => onMarkerClick(m.id));
          marker.addTo(layer);
          markerRefs.current.set(m.id, marker);
        });
      }
    };

    render();
    map.on("zoomend", render);
    return () => { map.off("zoomend", render); };
  }, [markers, onMarkerClick, focusId]);

  // focus zoom
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusId) return;
    const m = markers.find((x) => x.id === focusId);
    if (!m) return;
    map.flyTo([m.lat, m.lng], Math.max(map.getZoom(), 18), { animate: true, duration: 0.6 });
  }, [focusId, markers]);

  return (
    <div ref={containerRef} className={`w-full overflow-hidden rounded-2xl border border-border bg-muted ${className}`} style={{ height }} />
  );
}

export function openInMaps(lat: number, lng: number) {
  const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
