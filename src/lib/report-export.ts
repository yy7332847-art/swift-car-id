// Shared session report exporters (PDF / Excel).
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";

export interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  total_detected: number;
  total_matched: number;
  total_incomplete: number;
}

interface DetectedRow {
  plate_raw: string | null;
  is_matched: boolean;
  is_incomplete: boolean;
  detected_at: string;
  suspect_part: string | null;
  correction_note: string | null;
  plates?: { plate_raw: string; bank: string | null; car_type: string | null; chassis: string | null; plate_date: string | null } | null;
}

async function loadSessionRows(sessionId: string): Promise<DetectedRow[]> {
  const { data } = await supabase
    .from("detected_plates")
    .select("plate_raw, is_matched, is_incomplete, detected_at, suspect_part, correction_note, plates:matched_plate_id(plate_raw, bank, car_type, chassis, plate_date)")
    .eq("session_id", sessionId)
    .order("detected_at", { ascending: true });
  return (data ?? []) as unknown as DetectedRow[];
}

export function sessionDurationSec(s: SessionRow): number {
  if (!s.ended_at) return 0;
  return Math.max(0, Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000));
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60), r = sec % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

export async function exportSessionExcel(session: SessionRow): Promise<void> {
  const rows = await loadSessionRows(session.id);
  const data = rows.map((d, i) => ({
    "#": i + 1,
    "الوقت": new Date(d.detected_at).toLocaleTimeString("ar-EG"),
    "اللوحة": d.plate_raw ?? "",
    "الحالة": d.is_matched ? "مطابقة" : d.is_incomplete ? "غير مكتملة" : "غير موجودة",
    "الجزء المشكوك": d.suspect_part ?? "",
    "ملاحظة": d.correction_note ?? "",
    "النوع": d.plates?.car_type ?? "",
    "البنك": d.plates?.bank ?? "",
    "الهيكل": d.plates?.chassis ?? "",
    "التاريخ": d.plates?.plate_date ?? "",
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "تقرير الجلسة");
  XLSX.writeFile(wb, `session-${session.id.slice(0, 8)}.xlsx`);
}

export async function exportSessionPDF(session: SessionRow): Promise<void> {
  const rows = await loadSessionRows(session.id);
  const doc = new jsPDF({ orientation: "portrait", unit: "pt" });
  doc.setFontSize(14);
  doc.text(`Session Report - ${new Date(session.started_at).toLocaleString()}`, 40, 40);
  doc.setFontSize(10);
  doc.text(`Duration: ${formatDuration(sessionDurationSec(session))} | Total: ${session.total_detected} | Matched: ${session.total_matched} | Incomplete: ${session.total_incomplete}`, 40, 60);
  autoTable(doc, {
    startY: 80,
    head: [["#", "Time", "Plate", "Status", "Type", "Bank", "Chassis"]],
    body: rows.map((d, i) => [
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
  doc.save(`session-${session.id.slice(0, 8)}.pdf`);
}
