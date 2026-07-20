import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Flame, MapPin, CalendarDays, Loader2, Layers } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";


export const Route = createFileRoute("/_authenticated/heatmap")({
  component: HeatmapPage,
});

type StatusFilter = "all" | "matched" | "incomplete" | "unknown";
type RangeDays = 7 | 14 | 30 | 60 | 90;

interface HeatPoint {
  lat: number;
  lng: number;
  status: "matched" | "incomplete" | "unknown";
  plate: string;
  at: number;
}

function HeatmapPage() {
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [intensity, setIntensity] = useState<number>(24);
  const [showMarkers, setShowMarkers] = useState(false);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["heatmap", rangeDays],
    queryFn: async () => {
      const since = new Date(Date.now() - rangeDays * 86400_000).toISOString();
      const { data, error } = await supabase
        .from("detected_plates")
        .select("plate_raw, is_matched, is_incomplete, latitude, longitude, detected_at")
        .gte("detected_at", since)
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .limit(10000);
      if (error) throw error;
      return (data ?? []).map<HeatPoint>((d) => ({
        lat: d.latitude as number,
        lng: d.longitude as number,
        status: d.is_matched ? "matched" : d.is_incomplete ? "incomplete" : "unknown",
        plate: d.plate_raw ?? "",
        at: new Date(d.detected_at).getTime(),
      }));
    },
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (status === "all") return rows;
    return rows.filter((r) => r.status === status);
  }, [rows, status]);

  const stats = useMemo(() => {
    const total = rows?.length ?? 0;
    const matched = rows?.filter((r) => r.status === "matched").length ?? 0;
    const incomplete = rows?.filter((r) => r.status === "incomplete").length ?? 0;
    const unknown = total - matched - incomplete;
    return { total, matched, incomplete, unknown };
  }, [rows]);

  const hotspots = useMemo(() => rankHotspots(filtered, 6), [filtered]);

  return (
    <div className="px-5 pt-8 pb-6">
      <Link to="/account" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ChevronRight className="h-4 w-4" /> حسابي
      </Link>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 flex items-center gap-2 text-xl font-black">
            <Flame className="h-5 w-5 text-destructive" /> الخريطة الحرارية
          </h1>
          <p className="text-xs text-muted-foreground">أكثر المناطق التقاطاً للوحات — آخر {rangeDays} يوماً</p>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-4 gap-2">
        <StatCard label="الكل" value={stats.total} tone="primary" active={status === "all"} onClick={() => setStatus("all")} />
        <StatCard label="مطابقة" value={stats.matched} tone="success" active={status === "matched"} onClick={() => setStatus("matched")} />
        <StatCard label="غير مكتملة" value={stats.incomplete} tone="warning" active={status === "incomplete"} onClick={() => setStatus("incomplete")} />
        <StatCard label="غير موجودة" value={stats.unknown} tone="muted" active={status === "unknown"} onClick={() => setStatus("unknown")} />
      </div>

      <div className="mb-3 glass rounded-2xl p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-black text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" /> نطاق التاريخ
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {([7, 14, 30, 60, 90] as RangeDays[]).map((d) => (
            <button
              key={d}
              onClick={() => setRangeDays(d)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition-all ${rangeDays === d ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              {d} يوم
            </button>
          ))}
        </div>
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px] font-bold">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Layers className="h-3.5 w-3.5" /> شدة الحرارة</span>
          <input type="range" min={10} max={50} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} className="flex-1 accent-primary" />
          <span className="tabular-nums w-8 text-center">{intensity}</span>
        </div>
        <label className="flex items-center gap-2 text-[11px] font-bold text-muted-foreground">
          <input type="checkbox" checked={showMarkers} onChange={(e) => setShowMarkers(e.target.checked)} className="accent-primary" />
          إظهار نقاط اللوحات فوق الخريطة
        </label>
      </div>

      <div className="mb-3 overflow-hidden rounded-2xl border border-border">
        <HeatmapLayer points={filtered} intensity={intensity} showMarkers={showMarkers} height={340} />
      </div>

      {isLoading && (
        <div className="mb-3 flex items-center justify-center gap-2 rounded-2xl bg-muted/40 p-4 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> جاري تحميل البيانات...
        </div>
      )}

      {filtered.length === 0 && !isLoading && (
        <div className="mb-3 rounded-2xl border border-warning/30 bg-warning/5 p-4 text-center text-xs text-warning">
          لا توجد إحداثيات متاحة لهذا الفلتر — تأكد من تفعيل الموقع أثناء الجلسات
        </div>
      )}

      {hotspots.length > 0 && (
        <div className="glass rounded-2xl p-3">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-black">
            <MapPin className="h-4 w-4 text-destructive" /> أكثر المناطق نشاطاً
          </div>
          <div className="space-y-1.5">
            {hotspots.map((h, i) => (
              <a
                key={i}
                href={`https://www.google.com/maps/search/?api=1&query=${h.lat},${h.lng}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card/70 p-2.5 text-xs transition-all hover:border-primary/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-black">
                    منطقة #{i + 1} — <span className="tabular-nums text-primary">{h.count}</span> لوحة
                  </p>
                  <p className="text-[10px] text-muted-foreground tabular-nums">
                    {h.lat.toFixed(4)}, {h.lng.toFixed(4)}
                    {h.matched > 0 && ` • ${h.matched} مطابقة`}
                  </p>
                </div>
                <MapPin className="h-4 w-4 shrink-0 text-primary" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone = "primary", active, onClick }: { label: string; value: number; tone?: "primary" | "success" | "warning" | "muted"; active?: boolean; onClick?: () => void }) {
  const toneCls =
    tone === "success" ? "border-success/40 text-success"
    : tone === "warning" ? "border-warning/40 text-warning"
    : tone === "muted" ? "border-border text-foreground"
    : "border-primary/40 text-primary";
  return (
    <button onClick={onClick} className={`glass rounded-xl border p-2 text-center transition-all ${toneCls} ${active ? "ring-2 ring-primary scale-[1.02]" : ""}`}>
      <p className="text-base font-black tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </button>
  );
}

function HeatmapLayer({ points, intensity, showMarkers, height }: { points: HeatPoint[]; intensity: number; showMarkers: boolean; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const heatRef = useRef<L.Layer | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, { zoomControl: true, attributionControl: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    map.setView([24.7136, 46.6753], 6); // Riyadh default
    mapRef.current = map;
    markerLayerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
      heatRef.current = null;
      markerLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (heatRef.current) {
      map.removeLayer(heatRef.current);
      heatRef.current = null;
    }
    if (points.length === 0) return;

    // Weight by status: matched hits are strongest
    const heatData: [number, number, number][] = points.map((p) => [
      p.lat,
      p.lng,
      p.status === "matched" ? 1 : p.status === "unknown" ? 0.7 : 0.4,
    ]);
    const layer = L.heatLayer(heatData, {
      radius: intensity,
      blur: Math.round(intensity * 0.7),
      maxZoom: 17,
      minOpacity: 0.35,
      gradient: { 0.2: "#22d3ee", 0.4: "#4ade80", 0.6: "#facc15", 0.8: "#fb923c", 1.0: "#ef4444" },
    });
    layer.addTo(map);
    heatRef.current = layer;

    // Fit bounds to points
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.15), { animate: true });
  }, [points, intensity]);

  useEffect(() => {
    const layer = markerLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!showMarkers) return;
    for (const p of points.slice(0, 800)) {
      const color = p.status === "matched" ? "#22c55e" : p.status === "incomplete" ? "#f59e0b" : "#94a3b8";
      L.circleMarker([p.lat, p.lng], {
        radius: 4,
        color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: 1,
      })
        .bindPopup(`<b>${p.plate || "لوحة"}</b><br/>${new Date(p.at).toLocaleString("ar-EG")}`)
        .addTo(layer);
    }
  }, [points, showMarkers]);

  return <div ref={ref} style={{ height, width: "100%" }} />;
}

function rankHotspots(points: HeatPoint[], top: number): { lat: number; lng: number; count: number; matched: number }[] {
  if (points.length === 0) return [];
  // Grid at ~250m resolution
  const step = 0.0025;
  const grid = new Map<string, { lat: number; lng: number; count: number; matched: number }>();
  for (const p of points) {
    const key = `${Math.round(p.lat / step)}:${Math.round(p.lng / step)}`;
    const g = grid.get(key);
    if (g) {
      g.count++;
      if (p.status === "matched") g.matched++;
      g.lat = (g.lat * (g.count - 1) + p.lat) / g.count;
      g.lng = (g.lng * (g.count - 1) + p.lng) / g.count;
    } else {
      grid.set(key, { lat: p.lat, lng: p.lng, count: 1, matched: p.status === "matched" ? 1 : 0 });
    }
  }
  return [...grid.values()].sort((a, b) => b.count - a.count).slice(0, top);
}
