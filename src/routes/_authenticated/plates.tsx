// Plates browser: virtual-scrolled table over the user's active batch with
// search, status filters, and scan history per row (count + last session + last location).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { motion } from "motion/react";
import { Search, MapPin, Clock, CheckCircle2, AlertTriangle, Circle, Download, Loader2, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/plates")({
  component: PlatesPage,
  errorComponent: ({ error }) => <div className="p-6 text-sm text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6 text-sm">غير موجود</div>,
});


const sel = (s: string): string => s;
const PAGE = 60;

type StatusFilter = "all" | "scanned" | "unscanned" | "matched" | "incomplete";

interface PlateRow {
  id: string;
  plate_raw: string;
  bank: string | null;
  car_type: string | null;
  chassis: string | null;
  plate_date: string | null;
}

interface ScanStats {
  count: number;
  last_at: string | null;
  last_session_id: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_matched: boolean;
  last_incomplete: boolean;
}

function PlatesPage() {
  const qc = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Active batch
  const { data: batch } = useQuery({
    queryKey: ["active-batch"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase.from("plate_batches").select(sel("id, file_name, plates_count, activated_at")).eq("user_id", u.user.id).eq("is_active", true).maybeSingle();
      return data as { id: string; file_name: string; plates_count: number; activated_at: string } | null;
    },
  });

  // Coverage stats (total + unique scanned)
  const { data: coverage } = useQuery({
    enabled: !!batch,
    queryKey: ["plates-coverage", batch?.id],
    queryFn: async () => {
      if (!batch) return { total: 0, scanned: 0 };
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return { total: 0, scanned: 0 };
      const { data } = await supabase.from("detected_plates").select(sel("matched_plate_id")).eq("user_id", u.user.id).not("matched_plate_id", "is", null).returns<{ matched_plate_id: string }[]>();
      const uniq = new Set((data ?? []).map((r) => r.matched_plate_id));
      return { total: batch.plates_count, scanned: uniq.size };
    },
  });

  // Paginated plate rows (server-side search + filter)
  const { data: pageData, isFetching } = useQuery({
    enabled: !!batch,
    queryKey: ["plates-page", batch?.id, debounced, status],
    queryFn: async () => {
      if (!batch) return { rows: [] as PlateRow[], total: 0 };
      let q = supabase.from("plates").select(sel("id, plate_raw, bank, car_type, chassis, plate_date"), { count: "exact" }).eq("batch_id", batch.id).order("plate_raw", { ascending: true }).limit(PAGE * 20);
      if (debounced) q = q.ilike("plate_raw", `%${debounced}%`);
      const { data, count } = await q.returns<PlateRow[]>();
      return { rows: data ?? [], total: count ?? 0 };
    },
  });

  const plates = pageData?.rows ?? [];

  // Fetch scan stats for currently-loaded plate ids
  const { data: statsMap } = useQuery({
    enabled: plates.length > 0,
    queryKey: ["plates-stats", plates.map((p) => p.id).join(",")],
    queryFn: async () => {
      const ids = plates.map((p) => p.id);
      const map = new Map<string, ScanStats>();
      // Chunked IN queries (Supabase limit)
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const { data } = await supabase
          .from("detected_plates")
          .select(sel("matched_plate_id, detected_at, session_id, latitude, longitude, is_matched, is_incomplete"))
          .in("matched_plate_id", chunk)
          .order("detected_at", { ascending: false })
          .returns<{ matched_plate_id: string; detected_at: string; session_id: string; latitude: number | null; longitude: number | null; is_matched: boolean; is_incomplete: boolean }[]>();
        for (const r of data ?? []) {
          const cur = map.get(r.matched_plate_id);
          if (!cur) {
            map.set(r.matched_plate_id, { count: 1, last_at: r.detected_at, last_session_id: r.session_id, last_lat: r.latitude, last_lng: r.longitude, last_matched: r.is_matched, last_incomplete: r.is_incomplete });
          } else {
            cur.count += 1;
          }
        }
      }
      return map;
    },
  });

  const filtered = useMemo(() => {
    if (status === "all") return plates;
    return plates.filter((p) => {
      const s = statsMap?.get(p.id);
      if (status === "unscanned") return !s;
      if (status === "scanned") return !!s;
      if (status === "matched") return !!s?.last_matched;
      if (status === "incomplete") return !!s?.last_incomplete;
      return true;
    });
  }, [plates, statsMap, status]);

  const rowVirt = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 108,
    overscan: 8,
  });

  const pct = coverage && coverage.total > 0 ? Math.round((coverage.scanned / coverage.total) * 100) : 0;

  const exportCsv = () => {
    const header = "اللوحة,البنك,النوع,الهيكل,التاريخ,عدد مرات الفحص,آخر فحص,آخر جلسة\n";
    const body = filtered.map((p) => {
      const s = statsMap?.get(p.id);
      const cols = [p.plate_raw, p.bank ?? "", p.car_type ?? "", p.chassis ?? "", p.plate_date ?? "", s?.count ?? 0, s?.last_at ?? "", s?.last_session_id ?? ""];
      return cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",");
    }).join("\n");
    const blob = new Blob(["\uFEFF" + header + body], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `plates-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!batch) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">لا يوجد ملف Excel مفعّل بعد.</p>
        <Link to="/upload" className="mt-4 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">رفع ملف</Link>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-140px)] flex-col px-3 pt-3">
      {/* Header stats */}
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-2 grid grid-cols-3 gap-2">
        <Stat label="الإجمالي" value={coverage?.total ?? 0} />
        <Stat label="تم فحصها" value={coverage?.scanned ?? 0} tone="ok" />
        <Stat label="التغطية" value={pct} suffix="%" tone="primary" />
      </motion.div>

      {/* Search + filters */}
      <div className="mb-2 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث برقم اللوحة..."
            className="w-full rounded-xl border border-border/60 bg-card/60 py-2 pr-9 pl-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <button onClick={exportCsv} aria-label="تصدير" className="grid h-10 w-10 place-items-center rounded-xl border border-border/60 bg-card/60 active:scale-95">
          <Download className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
        {(["all", "scanned", "unscanned", "matched", "incomplete"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold transition-all ${status === s ? "bg-primary text-primary-foreground" : "border border-border/60 bg-card/60 text-muted-foreground"}`}
          >
            {s === "all" ? "الكل" : s === "scanned" ? "تم فحصها" : s === "unscanned" ? "لم تُفحص" : s === "matched" ? "مطابقة" : "ناقصة"}
          </button>
        ))}
      </div>

      {/* Virtualized list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-2xl border border-border/40 bg-card/30">
        {isFetching && filtered.length === 0 && (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {!isFetching && filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">لا توجد نتائج</div>
        )}
        <div style={{ height: rowVirt.getTotalSize(), position: "relative" }}>
          {rowVirt.getVirtualItems().map((v) => {
            const p = filtered[v.index];
            const s = statsMap?.get(p.id);
            return (
              <div
                key={p.id}
                style={{ position: "absolute", top: 0, right: 0, left: 0, transform: `translateY(${v.start}px)` }}
                className="border-b border-border/30 px-3 py-2.5"
              >
                <PlateRowCard row={p} stats={s} />
              </div>
            );
          })}
        </div>
      </div>

      {pageData && plates.length < (pageData.total ?? 0) && (
        <p className="mt-1 text-center text-[10px] text-muted-foreground">عرض {plates.length.toLocaleString("ar-EG")} من {(pageData.total ?? 0).toLocaleString("ar-EG")} — ابحث لتصفية النتائج</p>
      )}
    </div>
  );
}

function Stat({ label, value, suffix, tone }: { label: string; value: number; suffix?: string; tone?: "ok" | "primary" }) {
  const color = tone === "ok" ? "text-emerald-500" : tone === "primary" ? "text-primary" : "";
  return (
    <div className="glass rounded-xl p-2 text-center">
      <p className={`text-lg font-black ${color}`}>{value.toLocaleString("ar-EG")}{suffix ?? ""}</p>
      <p className="text-[9.5px] text-muted-foreground">{label}</p>
    </div>
  );
}

function PlateRowCard({ row, stats }: { row: PlateRow; stats: ScanStats | undefined }) {
  const status = !stats ? "unscanned" : stats.last_matched ? "matched" : stats.last_incomplete ? "incomplete" : "scanned";
  const Icon = status === "matched" ? CheckCircle2 : status === "incomplete" ? AlertTriangle : Circle;
  const color = status === "matched" ? "text-emerald-500" : status === "incomplete" ? "text-amber-500" : status === "scanned" ? "text-primary" : "text-muted-foreground";
  return (
    <div className="flex items-start gap-2.5">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-base font-black tracking-wider" dir="ltr">{row.plate_raw}</p>
          {stats && (
            <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
              {stats.count} {stats.count === 1 ? "مرة" : "مرات"}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-muted-foreground">
          {row.car_type && <span>🚗 {row.car_type}</span>}
          {row.bank && <span>🏦 {row.bank}</span>}
          {row.chassis && <span>#{row.chassis}</span>}
          {row.plate_date && <span>📅 {row.plate_date}</span>}
        </div>
        {stats && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px]">
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              {new Date(stats.last_at!).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" })}
            </span>
            {stats.last_lat != null && stats.last_lng != null && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {stats.last_lat.toFixed(3)}, {stats.last_lng.toFixed(3)}
              </span>
            )}
            {stats.last_session_id && (
              <Link to="/sessions/$id" params={{ id: stats.last_session_id }} className="inline-flex items-center gap-1 font-bold text-primary">
                <ExternalLink className="h-3 w-3" /> آخر جلسة
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
