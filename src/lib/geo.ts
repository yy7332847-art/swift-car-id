// Geolocation helpers: preflight/permissions, dynamic accuracy, background
// tracking, filtering/smoothing, GPX/KML export with timestamps/heading, share.
// Uses Capacitor Geolocation (and optional background plugin) on native
// Android/iOS and falls back to navigator.geolocation on the web.

export interface GeoPoint {
  lat: number;
  lng: number;
  /** Unix ms timestamp of the sample. Optional for backwards compatibility. */
  t?: number;
  /** Reported accuracy in meters (optional). */
  acc?: number;
  /** Reported speed in m/s (optional). */
  spd?: number;
  /** Heading in degrees (0..360) — derived if not provided. */
  hdg?: number;
}

export type PermissionState = "granted" | "denied" | "prompt" | "unsupported";

/** Full preflight result the UI shows before starting a recording session. */
export interface GeoPreflight {
  supported: boolean;
  permission: PermissionState;
  /** true when Capacitor is available and running natively (Android/iOS). */
  native: boolean;
  /** true when Android — used to render Android-specific hints. */
  android: boolean;
  /** true if background geolocation plugin is available (foreground service). */
  backgroundAvailable: boolean;
  /** high-accuracy is always requested; this flag reports whether the OS
   *  is likely running in low-accuracy (network-only) mode based on a sample. */
  highAccuracy: boolean;
  /** Result of a probe getCurrentPosition (helps detect GPS off). */
  probe?: { lat: number; lng: number; acc: number } | null;
  probeError?: string;
}

type CapGeoloc = {
  checkPermissions: () => Promise<{ location: string }>;
  requestPermissions: (opts?: { permissions: string[] }) => Promise<{ location: string }>;
  getCurrentPosition: (opts?: { enableHighAccuracy?: boolean; timeout?: number }) => Promise<{ coords: { latitude: number; longitude: number; accuracy: number; speed?: number | null; heading?: number | null } }>;
  watchPosition: (
    opts: { enableHighAccuracy?: boolean; timeout?: number },
    cb: (pos: { coords: { latitude: number; longitude: number; accuracy: number; speed?: number | null; heading?: number | null } } | null, err?: Error) => void,
  ) => Promise<string>;
  clearWatch: (opts: { id: string }) => Promise<void>;
};

type BackgroundGeoloc = {
  addWatcher: (
    opts: { backgroundMessage?: string; backgroundTitle?: string; requestPermissions?: boolean; stale?: boolean; distanceFilter?: number },
    cb: (loc: { latitude: number; longitude: number; accuracy: number; speed?: number | null; bearing?: number | null; time?: number } | null, err?: { code: string; message: string }) => void,
  ) => Promise<string>;
  removeWatcher: (opts: { id: string }) => Promise<void>;
};

let capGeoloc: CapGeoloc | null = null;
let capLoaded = false;
let bgGeoloc: BackgroundGeoloc | null = null;
let bgLoaded = false;

function isNative(): boolean {
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } };
  return !!w.Capacitor?.isNativePlatform?.();
}
export function isAndroid(): boolean {
  const w = window as unknown as { Capacitor?: { getPlatform?: () => string } };
  if (w.Capacitor?.getPlatform?.() === "android") return true;
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

async function loadCap(): Promise<CapGeoloc | null> {
  if (capLoaded) return capGeoloc;
  capLoaded = true;
  try {
    if (!isNative()) return null;
    const mod = (await import(/* @vite-ignore */ "@capacitor/geolocation")) as { Geolocation: CapGeoloc };
    capGeoloc = mod.Geolocation;
    return capGeoloc;
  } catch {
    return null;
  }
}

async function loadBgGeoloc(): Promise<BackgroundGeoloc | null> {
  if (bgLoaded) return bgGeoloc;
  bgLoaded = true;
  try {
    if (!isNative()) return null;
    const mod = (await import(/* @vite-ignore */ "@capacitor-community/background-geolocation")) as { BackgroundGeolocation: BackgroundGeoloc };
    bgGeoloc = mod.BackgroundGeolocation;
    return bgGeoloc;
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
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve("unsupported");
    navigator.geolocation.getCurrentPosition(
      () => resolve("granted"),
      (err) => resolve(err.code === err.PERMISSION_DENIED ? "denied" : "prompt"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

/** Run a full pre-flight before starting a recording. UI displays each field. */
export async function runGeoPreflight(): Promise<GeoPreflight> {
  const native = isNative();
  const android = isAndroid();
  const cap = await loadCap();
  const bg = await loadBgGeoloc();
  const supported = !!cap || ("geolocation" in navigator);
  let permission = await checkGeoPermission();
  if (permission === "prompt") permission = await requestGeoPermission();

  const result: GeoPreflight = {
    supported,
    permission,
    native,
    android,
    backgroundAvailable: !!bg,
    highAccuracy: true,
    probe: null,
  };
  if (permission !== "granted") return result;

  // Probe once to confirm GPS is actually on and get accuracy hint.
  try {
    if (cap) {
      const pos = await cap.getCurrentPosition({ enableHighAccuracy: true, timeout: 8000 });
      result.probe = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
      result.highAccuracy = pos.coords.accuracy <= 40;
    } else {
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (p) => { result.probe = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy ?? 0 }; result.highAccuracy = (p.coords.accuracy ?? 0) <= 40; resolve(); },
          (err) => { result.probeError = err.message || "تعذر قراءة الموقع"; resolve(); },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
        );
      });
    }
  } catch (e) {
    result.probeError = e instanceof Error ? e.message : "GPS probe failed";
  }
  return result;
}

export interface WatchHandle {
  stop: () => Promise<void> | void;
}

export interface WatchOptions {
  /** Use the background geolocation plugin (foreground service on Android). */
  background?: boolean;
  /** UI text shown in the Android notification when background=true. */
  backgroundTitle?: string;
  backgroundMessage?: string;
}

export async function watchGeo(
  onPoint: (pt: { lat: number; lng: number; acc: number; spd?: number | null; hdg?: number | null }) => void,
  onError: (msg: string, code?: "denied" | "unavailable" | "timeout") => void,
  opts: WatchOptions = {},
): Promise<WatchHandle> {
  // Prefer background plugin when requested and available (Android foreground
  // service keeps GPS alive when the screen is off).
  if (opts.background) {
    const bg = await loadBgGeoloc();
    if (bg) {
      const id = await bg.addWatcher(
        {
          backgroundTitle: opts.backgroundTitle ?? "PlateCheck — تتبع نشط",
          backgroundMessage: opts.backgroundMessage ?? "يتم تسجيل مسار الجلسة",
          requestPermissions: true,
          stale: false,
          distanceFilter: 2,
        },
        (loc, err) => {
          if (err) return onError(err.message || "تعذر قراءة الموقع", err.code === "NOT_AUTHORIZED" ? "denied" : "unavailable");
          if (!loc) return;
          onPoint({ lat: loc.latitude, lng: loc.longitude, acc: loc.accuracy, spd: loc.speed ?? null, hdg: loc.bearing ?? null });
        },
      );
      return { stop: () => bg.removeWatcher({ id }) };
    }
    // Fall through to standard watch if plugin not installed.
  }

  const cap = await loadCap();
  if (cap) {
    const id = await cap.watchPosition({ enableHighAccuracy: true, timeout: 15000 }, (pos, err) => {
      if (err) return onError(err.message || "تعذر قراءة الموقع");
      if (!pos) return;
      onPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, spd: pos.coords.speed ?? null, hdg: pos.coords.heading ?? null });
    });
    return { stop: () => cap.clearWatch({ id }) };
  }
  if (!("geolocation" in navigator)) {
    onError("الموقع الجغرافي غير مدعوم على هذا الجهاز", "unavailable");
    return { stop: () => undefined };
  }
  const wid = navigator.geolocation.watchPosition(
    (p) => onPoint({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy ?? 0, spd: p.coords.speed ?? null, hdg: p.coords.heading ?? null }),
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

/** Forward azimuth (bearing in degrees, 0..360) from a to b. */
export function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const toDeg = (n: number) => (n * 180) / Math.PI;
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng);
  const brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

/** Battery-saver aware acceptance criteria. Dynamic min interval based on
 *  the last observed speed and current buffer size (long sessions get sparser
 *  points to keep GPX/localStorage small). */
export interface AcceptOpts {
  /** m/s — last observed speed; 0 when stationary. */
  speed?: number;
  /** current stored point count — used to raise the interval on long runs. */
  bufferSize?: number;
  /** true to relax quality checks (e.g. indoor start). */
  batterySaver?: boolean;
}
export function shouldAcceptPoint(prev: GeoPoint | null, next: GeoPoint, opts: AcceptOpts = {}): boolean {
  const maxAcc = opts.batterySaver ? 80 : 60;
  if ((next.acc ?? 0) > maxAcc) return false;
  if (!prev) return true;
  const dt = ((next.t ?? Date.now()) - (prev.t ?? Date.now())) / 1000;
  const d = haversine(prev, next);
  if (dt > 0 && d / dt > 50) return false; // impossible speed

  // Dynamic min interval: stationary → 6s, walking → 3s, driving → 1s.
  const speed = opts.speed ?? (dt > 0 ? d / dt : 0);
  const sizeBoost = (opts.bufferSize ?? 0) > 800 ? 2 : (opts.bufferSize ?? 0) > 400 ? 1.5 : 1;
  const minInterval = (speed < 0.5 ? 6 : speed < 2 ? 3 : 1) * sizeBoost;
  const minDistance = speed < 0.5 ? 5 : 3;
  if (dt < minInterval && d < minDistance) return false;
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
      spd: cur.spd,
      hdg: cur.hdg,
    });
  }
  return out;
}

/** Fully rebuild a smoothed path from raw stored points with optional
 *  progress reporting. Applies shouldAcceptPoint then smoothPath. */
export async function rebuildPath(
  raw: GeoPoint[],
  onProgress?: (pct: number) => void,
  opts: AcceptOpts = {},
): Promise<GeoPoint[]> {
  const accepted: GeoPoint[] = [];
  let prev: GeoPoint | null = null;
  for (let i = 0; i < raw.length; i++) {
    if (shouldAcceptPoint(prev, raw[i], opts)) {
      accepted.push(raw[i]);
      prev = raw[i];
    }
    if (onProgress && (i % 50 === 0 || i === raw.length - 1)) {
      onProgress(Math.round(((i + 1) / raw.length) * 100));
      // yield to keep UI responsive
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return smoothPath(accepted);
}

// ---------- Export: GPX & KML ----------

function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] as string));
}

export interface PlateWaypoint {
  lat: number;
  lng: number;
  label: string;
  t?: number;
  status?: "matched" | "detected" | "incomplete";
}

export interface ExportOptions {
  /** Include plate hits as GPX/KML waypoints alongside the track. */
  waypoints?: PlateWaypoint[];
  /** Session name shown in file. */
  name?: string;
}

export function pathToGPX(path: GeoPoint[], nameOrOpts: string | ExportOptions = "PlateCheck Session"): string {
  const opts: ExportOptions = typeof nameOrOpts === "string" ? { name: nameOrOpts } : nameOrOpts;
  const name = opts.name ?? "PlateCheck Session";
  const trkpts = path.map((p, i) => {
    const time = p.t ? `<time>${new Date(p.t).toISOString()}</time>` : "";
    const prev = path[i - 1];
    const hdg = p.hdg ?? (prev ? bearingDeg(prev, p) : undefined);
    const cog = hdg != null ? `<course>${hdg.toFixed(1)}</course>` : "";
    const spd = p.spd != null ? `<speed>${p.spd.toFixed(2)}</speed>` : "";
    const ext = p.acc != null ? `<extensions><accuracy>${p.acc.toFixed(1)}</accuracy></extensions>` : "";
    return `<trkpt lat="${p.lat}" lon="${p.lng}">${time}${cog}${spd}${ext}</trkpt>`;
  }).join("");
  const wpts = (opts.waypoints ?? []).map((w) => {
    const time = w.t ? `<time>${new Date(w.t).toISOString()}</time>` : "";
    const sym = w.status === "matched" ? "Flag, Green" : w.status === "incomplete" ? "Flag, Red" : "Flag, Blue";
    return `<wpt lat="${w.lat}" lon="${w.lng}"><name>${esc(w.label)}</name>${time}<sym>${sym}</sym></wpt>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PlateCheck" xmlns="http://www.topografix.com/GPX/1/1">
${wpts}
<trk><name>${esc(name)}</name><trkseg>${trkpts}</trkseg></trk>
</gpx>`;
}

export function pathToKML(path: GeoPoint[], nameOrOpts: string | ExportOptions = "PlateCheck Session"): string {
  const opts: ExportOptions = typeof nameOrOpts === "string" ? { name: nameOrOpts } : nameOrOpts;
  const name = opts.name ?? "PlateCheck Session";
  const coords = path.map((p) => `${p.lng},${p.lat},0`).join(" ");
  // gx:Track adds per-point timestamps for playback in Google Earth.
  const whens = path.map((p) => `<when>${p.t ? new Date(p.t).toISOString() : ""}</when>`).join("");
  const gxCoords = path.map((p) => `<gx:coord>${p.lng} ${p.lat} 0</gx:coord>`).join("");
  const wpts = (opts.waypoints ?? []).map((w) => {
    const color = w.status === "matched" ? "ff2bd47a" : w.status === "incomplete" ? "ff2b7def" : "ffef7d2b";
    return `<Placemark><name>${esc(w.label)}</name>${w.t ? `<TimeStamp><when>${new Date(w.t).toISOString()}</when></TimeStamp>` : ""}<Style><IconStyle><color>${color}</color></IconStyle></Style><Point><coordinates>${w.lng},${w.lat},0</coordinates></Point></Placemark>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>${esc(name)}</name>
<Style id="line"><LineStyle><color>ffef7d2b</color><width>4</width></LineStyle></Style>
<Placemark><name>${esc(name)}</name><styleUrl>#line</styleUrl>
<LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>
</Placemark>
<Placemark><name>${esc(name)} — Timed Track</name><gx:Track>${whens}${gxCoords}</gx:Track></Placemark>
${wpts}
</Document></kml>`;
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
