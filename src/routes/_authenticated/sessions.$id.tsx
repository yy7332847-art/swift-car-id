import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "motion/react";
import { ChevronRight, Download, FileText, CheckCircle2, AlertTriangle, Car, MapPin, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { TrackingMap, type GeoPoint, openInMaps } from "@/components/TrackingMap";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/sessions/$id")({
  component: SessionDetailPage,
});

interface DetectedRow {
  id: string;
  plate_raw: string | null;
  plate_normalized: string | null;
  is_matched: boolean;
  is_incomplete: boolean;
  detected_at: string;
  matched_plate_id: string | null;
  latitude: number | null;
  longitude: number | null;
  plates?: {
    plate_raw: string;
    bank: string | null;
    car_type: string | null;
    chassis: string | null;
    plate_date: string | null;
  } | null;
}

type Filter = "all" | "matched" | "incomplete" | "unknown";

function SessionDetailPage() {
  const { id } = Route.useParams();
  const [filter, setFilter] = useState<Filter>("all");
  const [focusId, setFocusId] = useState<string | null>(null);

  const { data: session } = useQuery({
    queryKey: ["session", id],
    queryFn: async () => {
      const { data } = await supabase.from("recognition_sessions").select("*").eq("id", id).maybeSingle();
      return data;
    },
  });

  const { data: detected } = useQuery({
    queryKey: ["session-detected", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("detected_plates")
        .select("id, plate_raw, plate_normalized, is_matched, is_incomplete, detected_at, matched_plate_id, latitude, longitude, plates:matched_plate_id(plate_raw, bank, car_type, chassis, plate_date)")
        .eq("session_id", id)
        .order("detected_at", { ascending: true });
      return (data ?? []) as unknown as DetectedRow[];
    },
  });

  const filtered = useMemo(() => {
    if (!detected) return [];
    if (filter === "matched") return detected.filter((d) => d.is_matched);
    if (filter === "incomplete") return detected.filter((d) => d.is_incomplete);
    if (filter === "unknown") return detected.filter((d) => !d.is_matched && !d.is_incomplete);
    return detected;
  }, [detected, filter]);

  const path: GeoPoint[] = useMemo(() => {
    const raw = (session?.path as unknown as GeoPoint[] | undefined) ?? [];
    return Array.isArray(raw) ? raw.filter((p) => typeof p?.lat === "number" && typeof p?.lng === "number") : [];
  }, [session]);

  const markers = useMemo(() => filtered
    .filter((d) => d.latitude != null && d.longitude != null)
    .map((d) => ({
      id: d.id,
      lat: d.latitude!,
      lng: d.longitude!,
      label: d.plate_raw ?? "",
      status: d.is_matched ? "matched" as const : d.is_incomplete ? "incomplete" as const : "detected" as const,
    })), [filtered]);

  function exportExcel() {
    if (!detected) return;
    const rows = detected.map((d, i) => ({
      "#": i + 1,
      "الوقت": new Date(d.detected_at).toLocaleTimeString("ar-EG"),
      "اللوحة": d.plate_raw ?? "",
      "الحالة": d.is_matched ? "مطابقة" : d.is_incomplete ? "غير مكتملة" : "غير موجودة",
      "النوع": d.plates?.car_type ?? "",
      "البنك": d.plates?.bank ?? "",
      "الهيكل": d.plates?.chassis ?? "",
      "التاريخ": d.plates?.plate_date ?? "",
      "خط العرض": d.latitude ?? "",
      "خط الطول": d.longitude ?? "",
      "الخريطة": d.latitude != null && d.longitude != null ? `https://www.google.com/maps/search/?api=1&query=${d.latitude},${d.longitude}` : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تقرير الجلسة");
    XLSX.writeFile(wb, `session-${id.slice(0, 8)}.xlsx`);
    toast.success("تم تصدير Excel");
  }

  function exportPDF() {
    if (!detected || !session) return;
    const doc = new jsPDF({ orientation: "portrait", unit: "pt" });
    doc.setFontSize(14);
    doc.text(`Session Report - ${new Date(session.started_at).toLocaleString()}`, 40, 40);
    doc.setFontSize(10);
    doc.text(`Total: ${session.total_detected} | Matched: ${session.total_matched} | Incomplete: ${session.total_incomplete}`, 40, 60);
    autoTable(doc, {
      startY: 80,
      head: [["#", "Time", "Plate", "Status", "Type", "Bank", "Lat", "Lng"]],
      body: detected.map((d, i) => [
        i + 1,
        new Date(d.detected_at).toLocaleTimeString(),
        d.plate_raw ?? "",
        d.is_matched ? "MATCH" : d.is_incomplete ? "INCOMPLETE" : "NOT FOUND",
        d.plates?.car_type ?? "",
        d.plates?.bank ?? "",
        d.latitude?.toFixed(5) ?? "",
        d.longitude?.toFixed(5) ?? "",
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 100, 180] },
    });
    doc.save(`session-${id.slice(0, 8)}.pdf`);
    toast.success("تم تصدير PDF");
  }

  if (!session) return <div className="px-5 pt-8">جاري التحميل...</div>;

  const totalDet = detected?.length ?? 0;
  const totalMatched = detected?.filter((d) => d.is_matched).length ?? 0;
  const totalInc = detected?.filter((d) => d.is_incomplete).length ?? 0;
  const totalUnknown = totalDet - totalMatched - totalInc;

  return (
    <div className="px-5 pt-8">
      <Link to="/sessions" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ChevronRight className="h-4 w-4" /> الجلسات
      </Link>
      <h1 className="mb-1 text-xl font-black">تقرير الجلسة</h1>
      <p className="mb-4 text-xs text-muted-foreground">{new Date(session.started_at).toLocaleString("ar-EG")}</p>

      <div className="mb-4 grid grid-cols-4 gap-2">
        <StatCard label="مكتشفة" value={totalDet} active={filter === "all"} onClick={() => setFilter("all")} />
        <StatCard label="مطابقة" value={totalMatched} tone="success" active={filter === "matched"} onClick={() => setFilter("matched")} />
        <StatCard label="غير مكتملة" value={totalInc} tone="warning" active={filter === "incomplete"} onClick={() => setFilter("incomplete")} />
        <StatCard label="غير موجودة" value={totalUnknown} tone="muted" active={filter === "unknown"} onClick={() => setFilter("unknown")} />
      </div>

      {(path.length > 0 || markers.length > 0) && (
        <div className="mb-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 text-primary" /> مسار العربية على الخريطة
          </div>
          <TrackingMap
            path={path}
            markers={markers}
            height={240}
            onMarkerClick={(mid) => {
              setFocusId(mid);
              const el = document.getElementById(`plate-${mid}`);
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          />
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-2">
        <button onClick={exportPDF} className="glass flex items-center justify-center gap-2 rounded-xl p-3 text-sm font-bold">
          <FileText className="h-4 w-4 text-destructive" /> تصدير PDF
        </button>
        <button onClick={exportExcel} className="glass flex items-center justify-center gap-2 rounded-xl p-3 text-sm font-bold">
          <Download className="h-4 w-4 text-success" /> تصدير Excel
        </button>
      </div>

      <div className="space-y-2 pb-6">
        {filtered.map((d, i) => (
          <motion.div
            id={`plate-${d.id}`}
            key={d.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: i * 0.01 }}
            className={`glass rounded-xl p-3 transition-all ${
              d.is_matched ? "border border-success/40" : d.is_incomplete ? "border border-warning/40" : "border border-border"
            } ${focusId === d.id ? "ring-2 ring-primary" : ""}`}
          >
            <div className="flex items-center gap-3">
              <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${d.is_matched ? "bg-success/20 text-success" : d.is_incomplete ? "bg-warning/20 text-warning" : "bg-muted"}`}>
                {d.is_matched ? <CheckCircle2 className="h-4 w-4" /> : d.is_incomplete ? <AlertTriangle className="h-4 w-4" /> : <Car className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-bold tracking-widest" dir="rtl">{d.plate_raw}</p>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(d.detected_at).toLocaleTimeString("ar-EG")}
                  {d.plates?.car_type && ` • ${d.plates.car_type}`}
                  {d.plates?.bank && ` • ${d.plates.bank}`}
                </p>
              </div>
              {d.latitude != null && d.longitude != null && (
                <button
                  onClick={() => openInMaps(d.latitude!, d.longitude!)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary/15 px-2 py-1.5 text-[10.5px] font-bold text-primary"
                  title="فتح الإحداثيات على الخريطة"
                >
                  <ExternalLink className="h-3 w-3" /> خريطة
                </button>
              )}
            </div>
          </motion.div>
        ))}
        {filtered.length === 0 && (
          <p className="rounded-2xl bg-muted/40 p-6 text-center text-sm text-muted-foreground">
            {totalDet === 0 ? "لا توجد لوحات مسجلة في هذه الجلسة" : "لا توجد نتائج ضمن هذا الفلتر"}
          </p>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, tone, active, onClick }: { label: string; value: number; tone?: "success" | "warning" | "muted"; active?: boolean; onClick?: () => void }) {
  const border =
    tone === "success" ? "border-success/40"
      : tone === "warning" ? "border-warning/40"
        : tone === "muted" ? "border-border"
          : "border-primary/40";
  const text =
    tone === "success" ? "text-success"
      : tone === "warning" ? "text-warning"
        : tone === "muted" ? "text-muted-foreground"
          : "text-primary";
  return (
    <button
      onClick={onClick}
      className={`glass rounded-xl p-2.5 text-center transition-all ${border} ${active ? "ring-2 ring-primary scale-[1.02]" : "opacity-80 hover:opacity-100"}`}
    >
      <p className={`text-lg font-black ${text}`}>{value}</p>
      <p className="text-[9.5px] text-muted-foreground">{label}</p>
    </button>
  );
}
