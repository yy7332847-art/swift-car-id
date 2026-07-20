// Smart duplicate detection for captured plates within a recording session.
// Given a new candidate capture and the existing entries, decides whether it
// looks like a duplicate of a recent capture (same normalized plate, within
// the configured time window and GPS distance).
//
// Returned decision:
//   - "none"     → no candidate found; treat as a new unique capture
//   - "auto"     → very high confidence (within distance + window) and user opted
//                  for auto-merge → mark as duplicate silently
//   - "prompt"   → likely duplicate; ask the user "same car or different?"

import type { DuplicateDetectionConfig } from "./settings";

export interface DuplicateCandidateEntry {
  id: string;
  normalized: string;
  spokenAt: number;
  latitude?: number | null;
  longitude?: number | null;
  /** Prior user decision on this entry; entries already marked "different" are excluded. */
  duplicateDecision?: "same" | "different" | "unresolved" | null;
  /** If this entry itself is already a duplicate, we resolve to its root. */
  duplicateOfId?: string | null;
}

export interface DuplicateMatch {
  kind: "auto" | "prompt";
  original: DuplicateCandidateEntry;
  distanceMeters: number | null;
  gapSeconds: number;
  reason: "same-location" | "same-window" | "very-close";
}

const R = 6371000; // Earth radius in meters
export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Resolve to the root (non-duplicate) entry so we always compare against the original capture. */
function resolveRoot(entry: DuplicateCandidateEntry, all: DuplicateCandidateEntry[]): DuplicateCandidateEntry {
  if (!entry.duplicateOfId) return entry;
  const parent = all.find((e) => e.id === entry.duplicateOfId);
  return parent ? resolveRoot(parent, all) : entry;
}

export function detectDuplicate(
  candidate: { normalized: string; latitude?: number | null; longitude?: number | null; spokenAt: number },
  entries: DuplicateCandidateEntry[],
  config: DuplicateDetectionConfig,
): DuplicateMatch | null {
  if (!config.enabled) return null;
  if (!candidate.normalized) return null;

  const windowMs = config.windowMinutes * 60 * 1000;
  const now = candidate.spokenAt;

  // Find the most recent same-normalized entry that is not a "different" confirmation
  // and falls inside the time window.
  const sameSet = entries
    .filter((e) => e.normalized === candidate.normalized)
    .filter((e) => e.duplicateDecision !== "different")
    .filter((e) => now - e.spokenAt <= windowMs && now - e.spokenAt >= 0)
    .sort((a, b) => b.spokenAt - a.spokenAt);

  if (sameSet.length === 0) return null;

  const nearest = sameSet[0];
  const root = resolveRoot(nearest, entries);
  const gapSeconds = Math.round((now - nearest.spokenAt) / 1000);

  let distance: number | null = null;
  if (candidate.latitude != null && candidate.longitude != null && root.latitude != null && root.longitude != null) {
    distance = haversine(
      { lat: candidate.latitude, lng: candidate.longitude },
      { lat: root.latitude, lng: root.longitude },
    );
  }

  // Decide reason strength.
  const closeByLocation = distance != null && distance <= config.distanceMeters;
  // "very close" = same location AND < 1/3 of the window → obviously same car
  const veryClose = closeByLocation && gapSeconds * 1000 < windowMs / 3;

  let reason: DuplicateMatch["reason"];
  if (veryClose) reason = "very-close";
  else if (closeByLocation) reason = "same-location";
  else reason = "same-window";

  const kind: DuplicateMatch["kind"] = veryClose && config.autoMergeCloseCaptures ? "auto" : "prompt";
  return { kind, original: root, distanceMeters: distance, gapSeconds, reason };
}

export function formatGap(seconds: number): string {
  if (seconds < 60) return `${seconds} ث`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m} د ${s} ث` : `${m} د`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h} س ${rm} د` : `${h} س`;
}

export function formatDistance(meters: number | null): string {
  if (meters == null) return "بدون موقع";
  if (meters < 1) return "نفس الموقع تقريباً";
  if (meters < 1000) return `${Math.round(meters)} م`;
  return `${(meters / 1000).toFixed(2)} كم`;
}
