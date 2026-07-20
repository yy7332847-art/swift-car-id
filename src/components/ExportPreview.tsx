import { useMemo, useState } from "react";
import { X, Download, Share2, MapPin, Flag, CheckCircle2, AlertTriangle } from "lucide-react";
import { TrackingMap } from "@/components/TrackingMap";
import type { GeoPoint, PlateWaypoint } from "@/lib/geo";

export interface ExportPreviewProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (opts: { kind: "gpx" | "kml"; includeWaypoints: boolean; useSmoothed: boolean }) => Promise<void> | void;
  rawPath: GeoPoint[];
  smoothedPath: GeoPoint[] | null;
  waypoints: PlateWaypoint[];
}

export function ExportPreview({ open, onClose, onConfirm, rawPath, smoothedPath, waypoints }: ExportPreviewProps) {
  const [kind, setKind] = useState<"gpx" | "kml">("gpx");
  const [includeWaypoints, setIncludeWaypoints] = useState(true);
  const [useSmoothed, setUseSmoothed] = useState(!!smoothedPath);
  const [busy, setBusy] = useState(false);

  const activePath = useSmoothed && smoothedPath ? smoothedPath : rawPath;
  const markers = useMemo(() => includeWaypoints ? waypoints.map((w, i) => ({
    id: `wpt-${i}`,
    lat: w.lat, lng: w.lng,
    label: w.label,
    status: (w.status ?? "detected") as "matched" | "detected" | "incomplete",
  })) : [], [includeWaypoints, waypoints]);

  const matched = waypoints.filter((w) => w.status === "matched").length;
  const incomplete = waypoints.filter((w) => w.status === "incomplete").length;
  const detected = waypoints.length - matched - incomplete;

  if (!open) return null;

  async function handleConfirm() {
    try {
      setBusy(true);
      await onConfirm({ kind, includeWaypoints, useSmoothed });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="relative w-full max-w-[440px] rounded-t-3xl bg-background p-4 shadow-2xl sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="inline-flex items-center gap-2 text-sm font-black">
            <Share2 className="h-4 w-4 text-primary" /> معاينة قبل التصدير
          </h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg bg-muted"><X className="h-4 w-4" /></button>
        </div>

        <div className="mb-3">
          <TrackingMap path={activePath} markers={markers} height={200} />
        </div>

        {smoothedPath && (
          <div className="mb-3 rounded-2xl border border-border/60 p-2">
            <p className="mb-1.5 text-[10.5px] font-bold text-muted-foreground">نسخة المسار</p>
            <div className="grid grid-cols-2 gap-1.5 text-[10.5px]">
              <button
                onClick={() => setUseSmoothed(false)}
                className={`rounded-lg p-2 text-center font-bold ${!useSmoothed ? "bg-primary text-primary-foreground" : "bg-muted"}`}
              >قبل التنعيم<span className="ml-1 font-mono">({rawPath.length})</span></button>
              <button
                onClick={() => setUseSmoothed(true)}
                className={`rounded-lg p-2 text-center font-bold ${useSmoothed ? "bg-success text-success-foreground" : "bg-muted"}`}
              >بعد التنعيم<span className="ml-1 font-mono">({smoothedPath.length})</span></button>
            </div>
          </div>
        )}

        <div className="mb-3 grid grid-cols-3 gap-1.5 text-center text-[10px]">
          <Stat icon={CheckCircle2} tone="success" value={matched} label="مطابقة" />
          <Stat icon={AlertTriangle} tone="warning" value={incomplete} label="ناقصة" />
          <Stat icon={Flag} tone="muted" value={detected} label="أخرى" />
        </div>

        <label className="mb-3 flex items-center gap-2 rounded-xl border border-border/60 p-2.5 text-[11px] font-bold">
          <input type="checkbox" checked={includeWaypoints} onChange={(e) => setIncludeWaypoints(e.target.checked)} className="accent-primary" />
          <MapPin className="h-3.5 w-3.5 text-primary" />
          إدراج نقاط اللوحات كمحددات ({waypoints.length})
        </label>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => setKind("gpx")}
            className={`rounded-xl p-2.5 text-center text-xs font-bold ${kind === "gpx" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          >GPX</button>
          <button
            onClick={() => setKind("kml")}
            className={`rounded-xl p-2.5 text-center text-xs font-bold ${kind === "kml" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          >KML</button>
        </div>

        <div className="rounded-xl bg-muted/50 p-2.5 text-[10.5px] text-muted-foreground">
          سيتم تضمين: <span className="font-bold text-foreground">{activePath.length}</span> نقطة مسار
          {includeWaypoints && <> + <span className="font-bold text-foreground">{waypoints.length}</span> نقطة لوحة</>}
          {" "}بصيغة <span className="font-bold text-foreground uppercase">{kind}</span>.
        </div>

        <button
          onClick={handleConfirm}
          disabled={busy || activePath.length < 2}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary p-3 text-sm font-black text-primary-foreground disabled:opacity-50"
        >
          <Download className="h-4 w-4" /> {busy ? "جاري التصدير..." : "تصدير الآن"}
        </button>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, tone, value, label }: { icon: React.ComponentType<{ className?: string }>; tone: "success" | "warning" | "muted"; value: number; label: string }) {
  const cls = tone === "success" ? "bg-success/15 text-success" : tone === "warning" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground";
  return (
    <div className={`rounded-lg p-2 ${cls}`}>
      <Icon className="mx-auto mb-0.5 h-3.5 w-3.5" />
      <p className="font-black tabular-nums">{value}</p>
      <p className="text-[9px] opacity-80">{label}</p>
    </div>
  );
}
