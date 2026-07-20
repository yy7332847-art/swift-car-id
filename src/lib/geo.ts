// Geolocation helpers: permissions, filtering/smoothing, export (GPX/KML), share.
// Uses Capacitor Geolocation when available (native Android/iOS) and falls back
// to the browser's navigator.geolocation on the web.

export interface GeoPoint {
  lat: number;
  lng: number;
  /** Unix ms timestamp of the sample. Optional for backwards compatibility. */
  t?: number;
  /** Reported accuracy in meters (optional). */
  acc?: number;
}

export type PermissionState = "granted" | "denied" | "prompt" | "unsupported";

type CapGeoloc = {
  checkPermissions: () => Promise<{ location: string }>;
  requestPermissions: (opts?: { permissions: string[] }) => Promise<{ location: string }>;
  watchPosition: (
    opts: { enableHighAccuracy?: boolean; timeout?: number },
    cb: (pos: { coords: { latitude: number; longitude: number; accuracy: number } } | null, err?: Error) => void,
  ) => Promise<string>;
  clearWatch: (opts: { id: string }) => Promise<void>;
};

let capGeoloc: CapGeoloc | null = null;
let capLoaded = false;

async function loadCap(): Promise<CapGeoloc | null> {
  if (capLoaded) return capGeoloc;
  capLoaded = true;
  try {
    // Only try to load on native platforms to keep the web bundle unaffected.
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
    if (!w.Capacitor?.isNativePlatform?.()) return null;
    const mod = (await import(/* @vite-ignore */ "@capacitor/geolocation")) as { Geolocation: CapGeoloc };
    capGeoloc = mod.Geolocation;
    return capGeoloc;
  } catch {
    return null;
  }
}

export async function checkGeoPermission(): Promise<PermissionState> {
  const cap = await loadCap();
  if (cap) {
    try {
      const r = await cap.checkPermissions();
      return (r.location as PermissionState) || "prompt";
    } catch {
      return "prompt";
    }
  }
  if (!("geolocation" in navigator)) return "unsupported";
  try {
    const anyNav = navigator as unknown as { permissions?: { query: (o: { name: PermissionName }) => Promise<PermissionStatus> } };
    if (anyNav.permissions?.query) {
      const s = await anyNav.permissions.query({ name: "geolocation" as PermissionName });
      return (s.state as PermissionState) || "prompt";
    }
  } catch {
    // ignore
  }
  return "prompt";
}

export async function requestGeoPermission(): Promise<PermissionState> {
  const cap = await loadCap();
  if (cap) {
    try {
      const r = await cap.requestPermissions({ permissions: ["location"] });
      return (r.location as PermissionState) || "prompt";
    } catch {
      return "denied";
    }
  }
  // On the web, permission is granted by successful getCurrentPosition().
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve("unsupported");
    navigator.geolocation.getCurrentPosition(
      () => resolve("granted"),
      (err) => resolve(err.code === err.PERMISSION_DENIED ? "denied" : "prompt"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

export interface WatchHandle {
  stop: () => Promise<void> | void;
}

export async function watchGeo(
  onPoint: (pt: { lat: number; lng: number; acc: number }) => void,
  onError: (msg: string, code?: "denied" | "unavailable" | "timeout") => void,
): Promise<WatchHandle> {
  const cap = await loadCap();
  if (cap) {
    const id = await cap.watchPosition({ enableHighAccuracy: true, timeout: 15000 }, (pos, err) => {
      if (err) return onError(err.message || "تعذر قراءة الموقع");
      if (!pos) return;
      onPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy });
    });
    return { stop: () => cap.clearWatch({ id }) };
  }
  if (!("geolocation" in navigator)) {
    onError("الموقع الجغرافي غير مدعوم على هذا الجهاز", "unavailable");
    return { stop: () => undefined };
  }
  const wid = navigator.geolocation.watchPosition(
    (p) => onPoint({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy ?? 0 }),
    (err) => {
      const code = err.code === err.PERMISSION_DENIED ? "denied" : err.code === err.TIMEOUT ? "timeout" : "unavailable";
      onError(err.message || "تعذر قراءة الموقع", code);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 1500 },
  );
  return { stop: () => navigator.geolocation.clearWatch(wid) };
}

/** Haversine distance in meters. */
export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2), s2 = Math.sin(dLng / 2);
  const c = s1 * s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(c));
}

/**
 * Decide whether to accept a new GPS sample.
 * Rejects: bad accuracy (>60m), teleport jumps (>50 m/s ≈ 180km/h), tiny jitter (<3m within 3s).
 */
export function shouldAcceptPoint(prev: GeoPoint | null, next: GeoPoint): boolean {
  if ((next.acc ?? 0) > 60) return false;
  if (!prev) return true;
  const dt = ((next.t ?? Date.now()) - (prev.t ?? Date.now())) / 1000;
  const d = haversine(prev, next);
  if (dt > 0 && d / dt > 50) return false; // impossible speed
  if (d < 3 && dt < 3) return false; // jitter
  return true;
}

/** Exponential smoothing on the last N samples to soften GPS noise. */
export function smoothPath(points: GeoPoint[], alpha = 0.55): GeoPoint[] {
  if (points.length <= 2) return points;
  const out: GeoPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[i - 1];
    const cur = points[i];
    out.push({
      lat: prev.lat * (1 - alpha) + cur.lat * alpha,
      lng: prev.lng * (1 - alpha) + cur.lng * alpha,
      t: cur.t,
      acc: cur.acc,
    });
  }
  return out;
}

// ---------- Export: GPX & KML ----------

function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] as string));
}

export function pathToGPX(path: GeoPoint[], name = "PlateCheck Session"): string {
  const trkpts = path.map((p) => {
    const t = p.t ? `<time>${new Date(p.t).toISOString()}</time>` : "";
    return `<trkpt lat="${p.lat}" lon="${p.lng}">${t}</trkpt>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PlateCheck" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${esc(name)}</name><trkseg>${trkpts}</trkseg></trk>
</gpx>`;
}

export function pathToKML(path: GeoPoint[], name = "PlateCheck Session"): string {
  const coords = path.map((p) => `${p.lng},${p.lat},0`).join(" ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name)}</name>
<Style id="line"><LineStyle><color>ffef7d2b</color><width>4</width></LineStyle></Style>
<Placemark><name>${esc(name)}</name><styleUrl>#line</styleUrl>
<LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>
</Placemark></Document></kml>`;
}

export function downloadFile(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function shareOrDownload(name: string, content: string, mime: string): Promise<"shared" | "downloaded"> {
  try {
    const file = new File([content], name, { type: mime });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean; share?: (d: { files: File[]; title?: string }) => Promise<void> };
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], title: name });
      return "shared";
    }
  } catch {
    // fall through to download
  }
  downloadFile(name, content, mime);
  return "downloaded";
}
