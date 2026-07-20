// Shared session report exporters (PDF / Excel).
// PDF is rendered via html2canvas → jsPDF so Arabic text ships correctly.
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
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

function esc(v: unknown): string {
  const s = v == null ? "" : String(v);
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function buildReportHTML(session: SessionRow, rows: DetectedRow[]): string {
  const started = new Date(session.started_at).toLocaleString("ar-EG");
  const dur = formatDuration(sessionDurationSec(session));
  const bodyRows = rows.map((d, i) => {
    const status = d.is_matched ? "مطابقة" : d.is_incomplete ? "ناقصة" : "غير موجودة";
    const cls = d.is_matched ? "ok" : d.is_incomplete ? "warn" : "bad";
    return `<tr>
      <td>${i + 1}</td>
      <td>${esc(new Date(d.detected_at).toLocaleTimeString("ar-EG"))}</td>
      <td class="plate">${esc(d.plate_raw ?? "")}</td>
      <td><span class="pill ${cls}">${status}</span></td>
      <td>${esc(d.plates?.car_type ?? "")}</td>
      <td>${esc(d.plates?.bank ?? "")}</td>
      <td>${esc(d.plates?.chassis ?? "")}</td>
    </tr>`;
  }).join("");
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet"/>
    <style>
      *{box-sizing:border-box;font-family:'Cairo',system-ui,sans-serif}
      body{margin:0;padding:24px;background:#fff;color:#111;width:794px}
      .brand{display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:3px solid #1e64b4}
      .brand h1{margin:0;font-size:20px;color:#1e64b4;font-weight:900}
      .brand .sub{font-size:11px;color:#555}
      .meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0}
      .card{border:1px solid #e2e2e2;border-radius:10px;padding:10px;text-align:center}
      .card .k{font-size:10px;color:#666}
      .card .v{font-size:16px;font-weight:900;margin-top:4px}
      table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}
      th,td{border:1px solid #ddd;padding:6px 8px;text-align:right}
      th{background:#f5f8ff;color:#1e64b4;font-weight:900}
      td.plate{font-family:'Cairo',monospace;font-weight:900;letter-spacing:2px}
      .pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:900}
      .pill.ok{background:#d9f5e2;color:#0a7d33}
      .pill.warn{background:#fff2cc;color:#8a6100}
      .pill.bad{background:#fde1e1;color:#a11616}
      .footer{margin-top:20px;padding-top:10px;border-top:1px solid #eee;text-align:center;font-size:10px;color:#666}
    </style></head><body>
      <div class="brand">
        <div>
          <h1>إدارة حسام مجدي</h1>
          <div class="sub">تقرير جلسة تسجيل — نظام تشييك اللوحات</div>
        </div>
        <div style="text-align:left;font-size:11px;color:#555">
          <div>تاريخ الجلسة</div>
          <div style="font-weight:900;color:#111">${esc(started)}</div>
        </div>
      </div>
      <div class="meta">
        <div class="card"><div class="k">إجمالي</div><div class="v">${session.total_detected}</div></div>
        <div class="card"><div class="k">مطابقة</div><div class="v" style="color:#0a7d33">${session.total_matched}</div></div>
        <div class="card"><div class="k">ناقصة</div><div class="v" style="color:#8a6100">${session.total_incomplete}</div></div>
        <div class="card"><div class="k">المدة</div><div class="v">${dur}</div></div>
      </div>
      <table>
        <thead><tr><th>#</th><th>الوقت</th><th>اللوحة</th><th>الحالة</th><th>النوع</th><th>البنك</th><th>الهيكل</th></tr></thead>
        <tbody>${bodyRows || `<tr><td colspan="7" style="text-align:center;color:#888;padding:20px">لا توجد بيانات</td></tr>`}</tbody>
      </table>
      <div class="footer">إدارة حسام مجدي © ${new Date().getFullYear()} — تم توليد التقرير في ${new Date().toLocaleString("ar-EG")}</div>
    </body></html>`;
}

async function waitFonts(): Promise<void> {
  try {
    // @ts-expect-error document.fonts is standard on modern browsers
    if (document.fonts?.ready) await document.fonts.ready;
  } catch { /* ignore */ }
}

export async function exportSessionPDF(session: SessionRow): Promise<void> {
  const rows = await loadSessionRows(session.id);
  const host = document.createElement("iframe");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = "820px";
  host.style.height = "1200px";
  host.style.border = "0";
  document.body.appendChild(host);
  try {
    const doc = host.contentDocument!;
    doc.open();
    doc.write(buildReportHTML(session, rows));
    doc.close();
    await new Promise((r) => setTimeout(r, 400));
    // Wait for fonts to load inside iframe
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f = (doc as any).fonts;
    if (f?.ready) await f.ready;
    await waitFonts();
    const target = doc.body;
    const canvas = await html2canvas(target, { scale: 2, useCORS: true, backgroundColor: "#ffffff", windowWidth: 820 });
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const img = canvas.toDataURL("image/png");
    let remaining = imgHeight;
    let offset = 0;
    while (remaining > 0) {
      pdf.addImage(img, "PNG", 0, -offset, imgWidth, imgHeight);
      remaining -= pageHeight;
      offset += pageHeight;
      if (remaining > 0) pdf.addPage();
    }
    pdf.save(`session-${session.id.slice(0, 8)}.pdf`);
  } finally {
    host.remove();
  }
}
