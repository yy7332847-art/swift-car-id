import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, Loader2, Trash2, CheckCircle2, RotateCcw, Star, AlertTriangle, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import * as XLSX from "xlsx";
import { normalizePlate, splitPlate } from "@/lib/plate-utils";

export const Route = createFileRoute("/_authenticated/upload")({
  component: UploadPage,
});

interface ParsedRow {
  rowNumber: number;
  plate_raw: string;
  bank: string | null;
  car_type: string | null;
  chassis: string | null;
  plate_date: string | null;
}

interface UploadIssue {
  rowNumber: number;
  plateRaw: string;
  reason: string;
}

function guessCol(headers: string[], candidates: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] ?? "").trim();
    for (const c of candidates) if (h.includes(c)) return i;
  }
  return -1;
}

function parseExcel(file: File): Promise<{ rows: ParsedRow[]; headers: string[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        let bestSheet = wb.SheetNames[0];
        let bestCount = 0;
        for (const name of wb.SheetNames) {
          const s = wb.Sheets[name];
          const arr = XLSX.utils.sheet_to_json<unknown[]>(s, { header: 1, defval: "" });
          if (arr.length > bestCount) { bestCount = arr.length; bestSheet = name; }
        }
        const sheet = wb.Sheets[bestSheet];
        const arr = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
        if (arr.length < 2) return resolve({ rows: [], headers: [] });
        const headers = (arr[0] as unknown[]).map((h) => String(h ?? "").trim());
        const plateIdx = guessCol(headers, ["اللوحة", "لوحة", "plate"]);
        const bankIdx = guessCol(headers, ["البنك", "bank"]);
        const typeIdx = guessCol(headers, ["النوع", "type", "الموديل"]);
        const chassisIdx = guessCol(headers, ["الهيكل", "chassis", "vin"]);
        const dateIdx = guessCol(headers, ["التاريخ", "date"]);
        if (plateIdx === -1) return reject(new Error("لم يتم العثور على عمود اللوحة"));
        const rows: ParsedRow[] = [];
        for (let i = 1; i < arr.length; i++) {
          const row = arr[i] as unknown[];
          const rawPlate = String(row[plateIdx] ?? "").trim();
          if (!rawPlate) continue;
          rows.push({
            rowNumber: i + 1,
            plate_raw: rawPlate,
            bank: bankIdx >= 0 ? String(row[bankIdx] ?? "").trim() || null : null,
            car_type: typeIdx >= 0 ? String(row[typeIdx] ?? "").trim() || null : null,
            chassis: chassisIdx >= 0 ? String(row[chassisIdx] ?? "").trim() || null : null,
            plate_date: dateIdx >= 0 ? String(row[dateIdx] ?? "").trim() || null : null,
          });
        }
        resolve({ rows, headers });
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function UploadPage() {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [uploadReport, setUploadReport] = useState<{ success: number; failed: UploadIssue[]; fileName: string } | null>(null);

  const { data: batches, refetch } = useQuery({
    queryKey: ["batches"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data } = await supabase
        .from("plate_batches")
        .select("id, file_name, plates_count, created_at, is_active, activated_at")
        .eq("user_id", u.user.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  async function handleFile(file: File) {
    setLastFile(file);
    setUploading(true);
    setProgress(null);
    setUploadReport(null);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("غير مسجّل");
      toast.info("جاري تحليل الملف...");
      const { rows } = await parseExcel(file);
      if (rows.length === 0) throw new Error("الملف لا يحتوي على بيانات");
      const failed: UploadIssue[] = [];
      const validRows = rows.filter((r) => {
        const normalized = normalizePlate(r.plate_raw);
        const { letters, digits } = splitPlate(normalized);
        const ok = letters.length === 3 && digits.length === 4;
        if (!ok) failed.push({ rowNumber: r.rowNumber, plateRaw: r.plate_raw, reason: `تنسيق غير صحيح: يجب 3 حروف و4 أرقام — الموجود ${letters.length} حروف و${digits.length} أرقام` });
        return ok;
      });
      if (validRows.length === 0) {
        setUploadReport({ success: 0, failed, fileName: file.name });
        throw new Error("كل الصفوف فشلت بسبب تنسيق اللوحات");
      }

      const { data: batch, error: batchErr } = await supabase
        .from("plate_batches")
        .insert({ user_id: u.user.id, file_name: file.name, plates_count: validRows.length })
        .select("id")
        .single();
      if (batchErr) throw batchErr;

      const CHUNK = 1000;
      let insertedCount = 0;
      setProgress({ done: 0, total: validRows.length });
      for (let i = 0; i < validRows.length; i += CHUNK) {
        const slice = validRows.slice(i, i + CHUNK).map((r) => {
          const normalized = normalizePlate(r.plate_raw);
          const { letters, digits } = splitPlate(normalized);
          const { rowNumber: _rowNumber, ...clean } = r;
          void _rowNumber;
          return { ...clean, user_id: u.user!.id, batch_id: batch.id, plate_normalized: normalized, letters: letters || null, digits: digits || null };
        });
        const { error } = await supabase.from("plates").insert(slice);
        if (error) {
          for (const r of validRows.slice(i, i + CHUNK)) failed.push({ rowNumber: r.rowNumber, plateRaw: r.plate_raw, reason: error.message });
          continue;
        }
        insertedCount += slice.length;
        setProgress({ done: Math.min(i + CHUNK, validRows.length), total: validRows.length });
      }
      if (insertedCount === 0) {
        await supabase.from("plate_batches").delete().eq("id", batch.id);
        setUploadReport({ success: 0, failed, fileName: file.name });
        throw new Error("لم يتم قبول أي لوحة من الملف");
      }
      // Auto-activate the new batch
      await supabase.rpc("set_active_plate_batch", { _batch_id: batch.id });
      if (insertedCount !== validRows.length) await supabase.from("plate_batches").update({ plates_count: insertedCount }).eq("id", batch.id);
      setUploadReport({ success: insertedCount, failed, fileName: file.name });
      toast.success(`تم رفع ${insertedCount.toLocaleString("ar-EG")} لوحة وتفعيل النسخة الجديدة`);
      qc.invalidateQueries({ queryKey: ["batches"] });
      qc.invalidateQueries({ queryKey: ["home-stats"] });
      qc.invalidateQueries({ queryKey: ["plates-index"] });
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "فشل الرفع");
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  async function activate(id: string) {
    setBusyId(id);
    const { error } = await supabase.rpc("set_active_plate_batch", { _batch_id: id });
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("تم الرجوع إلى هذه النسخة");
    qc.invalidateQueries({ queryKey: ["batches"] });
    qc.invalidateQueries({ queryKey: ["plates-index"] });
  }

  async function deleteBatch(id: string) {
    if (!confirm("حذف هذه النسخة وكل لوحاتها؟")) return;
    setBusyId(id);
    const { error } = await supabase.from("plate_batches").delete().eq("id", id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("تم الحذف");
    qc.invalidateQueries({ queryKey: ["batches"] });
    qc.invalidateQueries({ queryKey: ["home-stats"] });
    qc.invalidateQueries({ queryKey: ["plates-index"] });
  }

  const active = batches?.find((b) => b.is_active);

  return (
    <div className="px-5 pt-8">
      <h1 className="mb-1 text-2xl font-black">إدارة نسخ Excel</h1>
      <p className="mb-5 text-sm text-muted-foreground">ارفع نسخة يومية أو ارجع لأي نسخة سابقة</p>

      <label className={`block rounded-3xl border-2 border-dashed border-primary/40 bg-primary/5 p-8 text-center transition ${uploading ? "opacity-50" : "hover:bg-primary/10 cursor-pointer"}`}>
        <input type="file" accept=".xlsx,.xls" className="hidden" disabled={uploading} onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-primary text-primary-foreground glow-primary">
          {uploading ? <Loader2 className="h-8 w-8 animate-spin" /> : <Upload className="h-8 w-8" strokeWidth={2.5} />}
        </div>
        <p className="font-bold">{uploading ? "جاري الرفع..." : "اضغط لاختيار ملف"}</p>
        <p className="mt-1 text-xs text-muted-foreground">.xlsx أو .xls</p>
        {progress && (
          <div className="mt-4">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            <p className="mt-2 text-xs">{progress.done.toLocaleString("ar-EG")} / {progress.total.toLocaleString("ar-EG")}</p>
          </div>
        )}
      </label>

      {uploadReport && (
        <div className="mt-4 rounded-2xl border border-border bg-card/80 p-4">
          <div className="mb-3 flex items-start gap-2">
            {uploadReport.failed.length ? <AlertTriangle className="mt-0.5 h-5 w-5 text-warning" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black">تقرير رفع الملف</p>
              <p className="truncate text-[11px] text-muted-foreground">{uploadReport.fileName}</p>
            </div>
            {lastFile && uploadReport.failed.length > 0 && (
              <button onClick={() => handleFile(lastFile)} disabled={uploading} className="inline-flex items-center gap-1 rounded-lg bg-primary/15 px-2 py-1.5 text-[10px] font-bold text-primary disabled:opacity-50">
                <RefreshCw className="h-3 w-3" /> إعادة المحاولة
              </button>
            )}
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl bg-success/10 p-2"><p className="font-black text-success">{uploadReport.success.toLocaleString("ar-EG")}</p><p className="text-[9px] text-muted-foreground">تم قبولها</p></div>
            <div className="rounded-xl bg-warning/10 p-2"><p className="font-black text-warning">{uploadReport.failed.length.toLocaleString("ar-EG")}</p><p className="text-[9px] text-muted-foreground">فشلت</p></div>
          </div>
          {uploadReport.failed.length > 0 && (
            <div className="max-h-48 overflow-auto space-y-1.5">
              {uploadReport.failed.slice(0, 80).map((f) => (
                <div key={`${f.rowNumber}-${f.plateRaw}`} className="rounded-xl bg-warning/10 px-3 py-2 text-[11px] text-warning">
                  صف {f.rowNumber}: <span className="font-mono">{f.plateRaw || "—"}</span> — {f.reason}
                </div>
              ))}
              {uploadReport.failed.length > 80 && <p className="text-center text-[11px] text-muted-foreground">والمزيد… أصلح الملف وأعد المحاولة</p>}
            </div>
          )}
        </div>
      )}

      {active && (
        <div className="mt-5 rounded-2xl border border-success/40 bg-success/10 p-4">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 fill-success text-success" />
            <span className="text-xs font-bold text-success">النسخة النشطة حالياً</span>
          </div>
          <p className="mt-1 truncate text-sm font-bold">{active.file_name}</p>
          <p className="text-[11px] text-muted-foreground">
            {active.plates_count.toLocaleString("ar-EG")} لوحة • آخر تحديث: {new Date(active.activated_at ?? active.created_at).toLocaleString("ar-EG")}
          </p>
        </div>
      )}

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-bold text-muted-foreground">كل النسخ ({batches?.length ?? 0})</h2>
        <AnimatePresence>
          {batches && batches.length > 0 ? (
            <div className="space-y-2">
              {batches.map((b) => (
                <motion.div key={b.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} className={`glass rounded-2xl p-3 ${b.is_active ? "border border-success/50" : ""}`}>
                  <div className="flex items-start gap-3">
                    <FileSpreadsheet className="mt-0.5 h-8 w-8 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-bold">{b.file_name}</p>
                        {b.is_active && <span className="inline-flex items-center gap-1 rounded-full bg-success/20 px-2 py-0.5 text-[9px] font-bold text-success"><CheckCircle2 className="h-2.5 w-2.5" />نشطة</span>}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {b.plates_count.toLocaleString("ar-EG")} لوحة • رُفع: {new Date(b.created_at).toLocaleString("ar-EG")}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {!b.is_active && (
                      <button disabled={busyId === b.id} onClick={() => activate(b.id)} className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground disabled:opacity-50">
                        <RotateCcw className="h-3 w-3" /> رجوع لهذه النسخة
                      </button>
                    )}
                    <button disabled={busyId === b.id} onClick={() => deleteBatch(b.id)} className="rounded-lg bg-destructive/20 px-3 py-1.5 text-[11px] font-bold text-destructive disabled:opacity-50">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl bg-muted/50 p-6 text-center text-sm text-muted-foreground">لا توجد نسخ بعد</p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
