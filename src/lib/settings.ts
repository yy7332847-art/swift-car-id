// User-tunable app settings persisted in localStorage.
// Covers: battery-saver thresholds for GPS, and subscription expiry
// notification threshold (in days).

export interface BatterySaverConfig {
  /** Enable dynamic accuracy/interval based on movement speed. */
  enabled: boolean;
  /** Below this speed (m/s), device is considered stationary. */
  stationaryBelow: number;
  /** Between stationary and this speed => walking. */
  walkingBelow: number;
  /** Minimum interval (seconds) between accepted GPS points when stationary. */
  intervalStationarySec: number;
  /** Interval when walking. */
  intervalWalkingSec: number;
  /** Interval when driving. */
  intervalDrivingSec: number;
  /** Maximum acceptable GPS accuracy radius in meters (larger → rejected). */
  maxAccuracyMeters: number;
}

export interface DuplicateDetectionConfig {
  /** Enable smart duplicate detection during recording. */
  enabled: boolean;
  /** Time window in minutes for candidate duplicate matching. */
  windowMinutes: number;
  /** Distance threshold in meters — below this AND within window → likely same car. */
  distanceMeters: number;
  /** Auto-mark as same car when both time and distance are within thresholds (no prompt). */
  autoMergeCloseCaptures: boolean;
}

export interface AppSettings {
  batterySaver: BatterySaverConfig;
  duplicateDetection: DuplicateDetectionConfig;
  /** Days before subscription expiry to start notifying the user. */
  expiryNotifyDays: number;
  /** Enable in-app expiry banner. */
  expiryInAppNotify: boolean;
  /** Enable email expiry reminders (requires email setup). */
  expiryEmailNotify: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  batterySaver: {
    enabled: true,
    stationaryBelow: 0.5,
    walkingBelow: 2,
    intervalStationarySec: 6,
    intervalWalkingSec: 3,
    intervalDrivingSec: 1,
    maxAccuracyMeters: 60,
  },
  duplicateDetection: {
    enabled: true,
    windowMinutes: 10,
    distanceMeters: 300,
    autoMergeCloseCaptures: false,
  },
  expiryNotifyDays: 3,
  expiryInAppNotify: true,
  expiryEmailNotify: false,
};

const KEY = "platecheck:settings:v1";

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      batterySaver: { ...DEFAULT_SETTINGS.batterySaver, ...(parsed.batterySaver ?? {}) },
      duplicateDetection: { ...DEFAULT_SETTINGS.duplicateDetection, ...(parsed.duplicateDetection ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: AppSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent("platecheck:settings-changed", { detail: s }));
  } catch {
    // ignore
  }
}

export function resetSettings(): AppSettings {
  saveSettings(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}
