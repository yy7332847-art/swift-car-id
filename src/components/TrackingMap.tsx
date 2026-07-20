import { useEffect, useRef } from "react";
import type * as L from "leaflet";

export interface GeoPoint { lat: number; lng: number }
export interface PlateMarker extends GeoPoint {
  id: string;
  label: string;
  status: "matched" | "incomplete" | "detected";
}

interface Props {
  path: GeoPoint[];
  markers?: PlateMarker[];
  follow?: boolean;      // if true, recenter to last point
  showCar?: boolean;     // show car icon at last point
  height?: number;
  className?: string;
  onMarkerClick?: (id: string) => void;
}

// Emoji-based car icon so we don't need any image assets.
function carIcon(L: typeof import("leaflet")) {
  return L.divIcon({
    className: "",
    html: `<div style="font-size:26px;line-height:1;transform:translate(-50%,-90%);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))">🚗</div>`,
    iconSize: [0, 0],
  });
}

function plateIcon(Ll: typeof import("leaflet"), status: PlateMarker["status"], label: string) {
  const color = status === "matched" ? "#10b981" : status === "incomplete" ? "#f59e0b" : "#3b82f6";
  const html = `
    <div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))">
      <div style="background:${color};color:#fff;padding:2px 6px;border-radius:8px;font-size:10px;font-weight:800;font-family:ui-monospace,monospace;white-space:nowrap;border:1.5px solid #fff">${label}</div>
      <div style="width:10px;height:10px;background:${color};border:2px solid #fff;border-radius:50%;margin-top:-2px"></div>
    </div>`;
  return Ll.divIcon({ className: "", html, iconSize: [0, 0] });
}

export function TrackingMap({ path, markers = [], follow = false, showCar = false, height = 220, className = "", onMarkerClick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polyRef = useRef<L.Polyline | null>(null);
  const carRef = useRef<L.Marker | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);

  // init once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const Ll = await import("leaflet");
      if (cancelled || !containerRef.current) return;
      leafletRef.current = Ll;
      const initial: [number, number] = path[0] ? [path[0].lat, path[0].lng] : [24.7136, 46.6753]; // Riyadh default
      const map = Ll.map(containerRef.current, {
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,
      }).setView(initial, 16);
      Ll.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        subdomains: "abcd",
      }).addTo(map);
      Ll.control.zoom({ position: "topleft" }).addTo(map);
      polyRef.current = Ll.polyline([], { color: "#2563eb", weight: 5, opacity: 0.85, lineJoin: "round" }).addTo(map);
      markerLayerRef.current = Ll.layerGroup().addTo(map);
      mapRef.current = map;
      // force a size refresh (tiles look grey until this runs when container size changes)
      setTimeout(() => map.invalidateSize(), 50);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      polyRef.current = null;
      carRef.current = null;
      markerLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // update polyline + car
  useEffect(() => {
    const Ll = leafletRef.current;
    const map = mapRef.current;
    const poly = polyRef.current;
    if (!Ll || !map || !poly) return;
    const latlngs = path.map((p) => [p.lat, p.lng] as [number, number]);
    poly.setLatLngs(latlngs);

    const last = latlngs[latlngs.length - 1];
    if (showCar && last) {
      if (!carRef.current) {
        carRef.current = Ll.marker(last, { icon: carIcon(Ll), interactive: false, keyboard: false }).addTo(map);
      } else {
        carRef.current.setLatLng(last);
      }
    }
    if (follow && last) {
      map.panTo(last, { animate: true, duration: 0.6 });
    } else if (latlngs.length > 1) {
      try { map.fitBounds(poly.getBounds(), { padding: [30, 30], maxZoom: 17 }); } catch { /* empty bounds */ }
    } else if (last) {
      map.setView(last, 16);
    }
  }, [path, follow, showCar]);

  // update plate markers
  useEffect(() => {
    const Ll = leafletRef.current;
    const layer = markerLayerRef.current;
    if (!Ll || !layer) return;
    layer.clearLayers();
    for (const m of markers) {
      const marker = Ll.marker([m.lat, m.lng], { icon: plateIcon(Ll, m.status, m.label) });
      if (onMarkerClick) marker.on("click", () => onMarkerClick(m.id));
      marker.addTo(layer);
    }
  }, [markers, onMarkerClick]);

  return (
    <div
      ref={containerRef}
      className={`w-full overflow-hidden rounded-2xl border border-border bg-muted ${className}`}
      style={{ height }}
    />
  );
}

/** Open a lat/lng in the user's map app of choice. */
export function openInMaps(lat: number, lng: number) {
  const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
