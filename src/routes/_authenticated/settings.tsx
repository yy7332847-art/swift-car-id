import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Battery, Bell, Mail, RotateCcw, Save, Info, Zap, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_SETTINGS, loadSettings, resetSettings, saveSettings, type AppSettings } from "@/lib/settings";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "الإعدادات — مجدي للتشييك" },
      { name: "description", content: "ضبط إعدادات التتبع والتنبيهات وتوفير البطارية داخل التطبيق." },
      { property: "og:title", content: "الإعدادات — مجدي للتشييك" },
      { property: "og:description", content: "خصّص أداء التطبيق والتتبع حسب احتياجك." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [s, setS] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setS(loadSettings()); }, []);

  function update<K extends keyof AppSettings>(k: K, v: AppSettings[K]) {
    setS((prev) => ({ ...prev, [k]: v }));
    setDirty(true);
  }
  function updateBS<K extends keyof AppSettings["batterySaver"]>(k: K, v: AppSettings["batterySaver"][K]) {
    setS((prev) => ({ ...prev, batterySaver: { ...prev.batterySaver, [k]: v } }));
    setDirty(true);
  }
  function persist() {
    saveSettings(s);
    setDirty(false);
    toast.success("تم حفظ الإعدادات");
  }
  function doReset() {
    const def = resetSettings();
    setS(def);
    setDirty(false);
    toast.success("تمت إعادة الإعدادات الافتراضية");
  }

  const bs = s.batterySaver;

  return (
    <div className="px-5 pt-8 pb-8">
      <Link to="/account" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ChevronRight className="h-4 w-4" /> حسابي
      </Link>
      <h1 className="mb-1 text-xl font-black">الإعدادات</h1>
      <p className="mb-5 text-xs text-muted-foreground">خصّص أداء التتبع والتنبيهات</p>

      {/* Battery Saver */}
      <section className="glass mb-4 rounded-2xl p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-success/15 text-success"><Battery className="h-4 w-4" /></div>
          <div className="flex-1">
            <p className="text-sm font-black">وضع توفير البطارية</p>
            <p className="text-[10.5px] text-muted-foreground">تقليل تحديثات GPS ديناميكياً حسب سرعة الحركة</p>
          </div>
          <Switch checked={bs.enabled} onChange={(v) => updateBS("enabled", v)} />
        </div>

        <div className={bs.enabled ? "space-y-4" : "pointer-events-none space-y-4 opacity-40"}>
          <NumberField
            icon={Zap}
            label="عتبة التوقف (م/ث)"
            hint="أقل من هذه السرعة يعتبر الجهاز ثابتاً — تقل تحديثات GPS"
            value={bs.stationaryBelow}
            min={0.1} max={2} step={0.1}
            onChange={(v) => updateBS("stationaryBelow", v)}
          />
          <NumberField
            icon={Zap}
            label="عتبة المشي (م/ث)"
            hint="بين التوقف وهذه السرعة يعتبر مشياً"
            value={bs.walkingBelow}
            min={1} max={6} step={0.5}
            onChange={(v) => updateBS("walkingBelow", v)}
          />
          <NumberField
            icon={MapPin}
            label="فاصل التوقف (ثانية)"
            hint="كلما زاد وفّرت بطارية أكثر لكن يقل تفصيل المسار"
            value={bs.intervalStationarySec}
            min={2} max={30} step={1}
            onChange={(v) => updateBS("intervalStationarySec", v)}
          />
          <NumberField
            icon={MapPin}
            label="فاصل المشي (ثانية)"
            hint="زيادته يقلل استهلاك البطارية"
            value={bs.intervalWalkingSec}
            min={1} max={15} step={1}
            onChange={(v) => updateBS("intervalWalkingSec", v)}
          />
          <NumberField
            icon={MapPin}
            label="فاصل القيادة (ثانية)"
            hint="أقل قيمة = دقة أعلى للمسار لكن استهلاك أعلى"
            value={bs.intervalDrivingSec}
            min={0.5} max={5} step={0.5}
            onChange={(v) => updateBS("intervalDrivingSec", v)}
          />
          <NumberField
            icon={Info}
            label="حد أقصى لدقة GPS (متر)"
            hint="النقاط الأكبر من هذه الدقة سيتم رفضها لتنقية المسار"
            value={bs.maxAccuracyMeters}
            min={20} max={150} step={5}
            onChange={(v) => updateBS("maxAccuracyMeters", v)}
          />
        </div>
      </section>

      {/* Notifications */}
      <section className="glass mb-4 rounded-2xl p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/15 text-primary"><Bell className="h-4 w-4" /></div>
          <div>
            <p className="text-sm font-black">تنبيهات انتهاء الباقة</p>
            <p className="text-[10.5px] text-muted-foreground">يتم تنبيهك قبل انتهاء اشتراكك</p>
          </div>
        </div>

        <NumberField
          icon={Bell}
          label="التنبيه قبل الانتهاء (أيام)"
          hint="مثال: 3 يعني تحصل على تنبيه قبل انتهاء الاشتراك بثلاثة أيام"
          value={s.expiryNotifyDays}
          min={1} max={14} step={1}
          onChange={(v) => update("expiryNotifyDays", v)}
        />

        <div className="mt-3 flex items-center justify-between rounded-xl border border-border/60 p-3">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            <div>
              <p className="text-xs font-bold">تنبيه داخل التطبيق</p>
              <p className="text-[10px] text-muted-foreground">شريط تنبيه في أعلى الشاشات</p>
            </div>
          </div>
          <Switch checked={s.expiryInAppNotify} onChange={(v) => update("expiryInAppNotify", v)} />
        </div>

        <div className="mt-2 flex items-center justify-between rounded-xl border border-border/60 p-3">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            <div>
              <p className="text-xs font-bold">إشعار عبر الإيميل</p>
              <p className="text-[10px] text-muted-foreground">يتطلب إعداد نطاق البريد من قبل الإدارة</p>
            </div>
          </div>
          <Switch checked={s.expiryEmailNotify} onChange={(v) => update("expiryEmailNotify", v)} />
        </div>
      </section>

      <div className="sticky bottom-24 z-30 grid grid-cols-2 gap-2">
        <button onClick={doReset} className="glass inline-flex items-center justify-center gap-2 rounded-2xl p-3 text-xs font-black">
          <RotateCcw className="h-4 w-4" /> إعادة افتراضي
        </button>
        <button
          onClick={persist}
          disabled={!dirty}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary p-3 text-xs font-black text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-40"
        >
          <Save className="h-4 w-4" /> حفظ
        </button>
      </div>
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted"}`}
      aria-pressed={checked}
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-background shadow transition-all ${checked ? "left-6" : "left-1"}`} />
    </button>
  );
}

function NumberField({
  icon: Icon, label, hint, value, min, max, step, onChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; hint: string;
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" /> {label}
        </span>
        <span className="rounded-lg bg-muted px-2 py-0.5 font-mono text-[11px] font-black tabular-nums">{value}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
      <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>
    </div>
  );
}
