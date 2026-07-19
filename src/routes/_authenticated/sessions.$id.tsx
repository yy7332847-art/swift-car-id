import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "motion/react";
import { ChevronRight, Download, FileText, CheckCircle2, AlertTriangle, Car } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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
  plates?: {
    plate_raw: string;
    bank: string | null;
    car_type: string | null;
    chassis: string | null;
    plate_date: string | null;
  } | null;
}

function SessionDetailPage() {
  const { id } = Route.useParams();

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
        .select("id, plate_raw, plate_normalized, is_matched, is_incomplete, detected_at, matched_plate_id, plates:matched_plate_id(plate_raw, bank, car_type, chassis, plate_date)")
        .eq("session_id", id)
        .order("detected_at", { ascending: true });
      return (data ?? []) as unknown as DetectedRow[];
    },
  });

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
      head: [["#", "Time", "Plate", "Status", "Type", "Bank", "Chassis"]],
      body: detected.map((d, i) => [
        i + 1,
        new Date(d.detected_at).toLocaleTimeString(),
        d.plate_raw ?? "",
        d.is_matched ? "MATCH" : d.is_incomplete ? "INCOMPLETE" : "NOT FOUND",
        d.plates?.car_type ?? "",
        d.plates?.bank ?? "",
        d.plates?.chassis ?? "",
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 100, 180] },
    });
    doc.save(`session-${id.slice(0, 8)}.pdf`);
    toast.success("تم تصدير PDF");
  }

  if (!session) return <div className="px-5 pt-8">جاري التحميل...</div>;

  return (
    <div className="px-5 pt-8">
      <Link to="/sessions" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ChevronRight className="h-4 w-4" /> الجلسات
      </Link>
      <h1 className="mb-1 text-xl font-black">تقرير الجلسة</h1>
      <p className="mb-4 text-xs text-muted-foreground">{new Date(session.started_at).toLocaleString("ar-EG")}</p>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <div className="glass rounded-xl p-3 text-center"><p className="text-xl font-black">{session.total_detected}</p><p className="text-[10px] text-muted-foreground">مكتشفة</p></div>
        <div className="glass rounded-xl p-3 text-center border border-success/40"><p className="text-xl font-black text-success">{session.total_matched}</p><p className="text-[10px] text-muted-foreground">مطابقة</p></div>
        <div className="glass rounded-xl p-3 text-center border border-warning/40"><p className="text-xl font-black text-warning">{session.total_incomplete}</p><p className="text-[10px] text-muted-foreground">غير مكتملة</p></div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2">
        <button onClick={exportPDF} className="glass flex items-center justify-center gap-2 rounded-xl p-3 text-sm font-bold">
          <FileText className="h-4 w-4 text-destructive" /> تصدير PDF
        </button>
        <button onClick={exportExcel} className="glass flex items-center justify-center gap-2 rounded-xl p-3 text-sm font-bold">
          <Download className="h-4 w-4 text-success" /> تصدير Excel
        </button>
      </div>

      <div className="space-y-2">
        {detected?.map((d, i) => (
          <motion.div key={d.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.01 }} className={`glass rounded-xl p-3 ${d.is_matched ? "border border-success/40" : d.is_incomplete ? "border border-warning/40" : ""}`}>
            <div className="flex items-center gap-3">
              <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${d.is_matched ? "bg-success/20 text-success" : d.is_incomplete ? "bg-warning/20 text-warning" : "bg-muted"}`}>
                {d.is_matched ? <CheckCircle2 className="h-4 w-4" /> : d.is_incomplete ? <AlertTriangle className="h-4 w-4" /> : <Car className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-bold">{d.plate_raw}</p>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(d.detected_at).toLocaleTimeString("ar-EG")}
                  {d.plates?.car_type && ` • ${d.plates.car_type}`}
                  {d.plates?.bank && ` • ${d.plates.bank}`}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
        {(!detected || detected.length === 0) && <p className="text-center text-sm text-muted-foreground">لا توجد لوحات مسجلة</p>}
      </div>
    </div>
  );
}
