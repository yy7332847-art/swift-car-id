#!/usr/bin/env node
// Offline readiness audit — scans dist/ for external network dependencies that
// would break the app when installed on a device without internet.
// Usage: npm run build:android && node scripts/offline-audit.mjs
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const DIST = existsSync("dist-capacitor") ? "dist-capacitor" : "dist";
const ROOT = process.cwd();
const HERE = join(ROOT, DIST);

const RED = "\x1b[31m", YEL = "\x1b[33m", GRN = "\x1b[32m", BLU = "\x1b[34m", BOLD = "\x1b[1m", NC = "\x1b[0m";

if (!existsSync(HERE)) {
  console.error(`${RED}✗ مجلد ${DIST}/ غير موجود. شغّل أولاً: npm run build:android${NC}`);
  process.exit(1);
}

// Allow-list: origins the app is designed to call online (Supabase, our APIs).
// These do NOT count as "breaks offline" because the offline queue handles them.
const ONLINE_OK = [
  /supabase\.co/i,
  /connector-gateway\.lovable\.dev/i,
  /lovable\.app/i,
  /openai\.com/i,
];

// Hard fail: external assets that MUST be local (fonts, styles, scripts, images).
const ASSET_PATTERNS = [
  { re: /https?:\/\/fonts\.googleapis\.com[^\s"')]+/g,       kind: "font-css",   fix: "نزّل الخط محلياً وضعه في public/fonts/ ثم استخدم @font-face" },
  { re: /https?:\/\/fonts\.gstatic\.com[^\s"')]+/g,          kind: "font-file",  fix: "نزّل ملفات .woff2 إلى public/fonts/" },
  { re: /https?:\/\/(?:unpkg|cdn\.jsdelivr|cdnjs)[^\s"')]+/g, kind: "cdn-script", fix: "ثبّت الحزمة عبر bun add بدلاً من CDN" },
  { re: /https?:\/\/[a-z0-9.-]+\.tile\.openstreetmap\.org[^\s"')]*/g, kind: "map-tiles", fix: "مقبول للخريطة أونلاين فقط — أخفِ الخريطة تلقائياً في الوضع offline" },
];

const EMBEDDED_DOC_URLS = [
  /cdnjs\.cloudflare\.com\/ajax\/libs\/pdfobject/i,
];

const results = { ok: [], warn: [], fail: [] };
const sourceResults = { fail: [] };
const seen = new Set();

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (/\.(html|css|js|mjs|json|txt|webmanifest)$/i.test(name)) scanFile(p);
  }
}

function scanFile(path, base = HERE, target = results) {
  const rel = relative(base, path);
  const content = readFileSync(path, "utf8");
  // Extract all URLs
  const urls = content.match(/https?:\/\/[^\s"'`)<>]+/g) ?? [];
  for (const url of urls) {
    const key = `${rel}::${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const clean = url.replace(/[.,;:!?)]+$/, "");
    if (EMBEDDED_DOC_URLS.some((r) => r.test(clean))) continue;
    const asset = ASSET_PATTERNS.find((a) => a.re.test(clean));
    a: {
      if (asset) {
        target.fail.push({ file: rel, url: clean, kind: asset.kind, fix: asset.fix });
        break a;
      }
      if (ONLINE_OK.some((r) => r.test(clean))) {
        target.ok?.push({ file: rel, url: clean });
        break a;
      }
      target.warn?.push({ file: rel, url: clean });
    }
    // reset regex state
    for (const a of ASSET_PATTERNS) a.re.lastIndex = 0;
  }
}

walk(HERE);

function walkSource(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walkSource(p);
    else if (/\.(ts|tsx|js|jsx|css|html|mjs)$/i.test(name)) scanFile(p, ROOT, sourceResults);
  }
}

walkSource(join(ROOT, "src"));

// Manifest check
const manifest = ["manifest.webmanifest", "manifest.json"].map((f) => join(HERE, f)).find(existsSync);
const swPath = join(HERE, "sw.js");
const indexPath = join(HERE, "index.html");
const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
const hasAbsoluteBundledAssets = /\s(?:src|href)="\/assets\//.test(indexHtml);

console.log(`\n${BOLD}${BLU}تقرير الجاهزية للعمل بدون إنترنت${NC}\n`);

if (results.fail.length === 0) {
  console.log(`${GRN}${BOLD}✓ لا توجد موارد خارجية حرجة${NC}`);
} else {
  console.log(`${RED}${BOLD}✗ ${results.fail.length} مورد خارجي يجب استضافته محلياً:${NC}`);
  const byKind = {};
  for (const f of results.fail) (byKind[f.kind] ??= []).push(f);
  for (const [kind, arr] of Object.entries(byKind)) {
    console.log(`\n  ${BOLD}[${kind}] × ${arr.length}${NC}`);
    console.log(`  ${YEL}الحل:${NC} ${arr[0].fix}`);
    for (const item of arr.slice(0, 3)) console.log(`    - ${item.url}  ${BLU}(${item.file})${NC}`);
    if (arr.length > 3) console.log(`    ... و ${arr.length - 3} آخرين`);
  }
}

console.log(`\n${BOLD}الاتصالات المسموحة (تعمل مع طابور المزامنة offline):${NC}  ${results.ok.length}`);
if (results.warn.length) {
  console.log(`\n${YEL}${BOLD}⚠ ${results.warn.length} رابط غير معروف — راجع يدوياً:${NC}`);
  for (const w of results.warn.slice(0, 8)) console.log(`  - ${w.url}  ${BLU}(${w.file})${NC}`);
}

console.log(`\n${BOLD}Manifest:${NC}  ${manifest ? GRN + "✓ " + relative(HERE, manifest) : YEL + "⚠ غير موجود"}${NC}`);
console.log(`${BOLD}Service Worker:${NC}  ${existsSync(swPath) ? GRN + "✓ sw.js" : YEL + "⚠ لا يوجد SW (المزامنة أثناء فتح التطبيق فقط)"}${NC}`);
console.log(`${BOLD}Android asset paths:${NC} ${hasAbsoluteBundledAssets ? RED + "✗ /assets مطلقة — ستسبب شاشة بيضاء" : GRN + "✓ نسبية وصالحة لـ WebView"}${NC}`);

// IndexedDB usage check (source-level, from src/)
const srcHasOfflineStore = existsSync(join(ROOT, "src/lib/offline-store.ts"));
const srcHasSyncQueue = existsSync(join(ROOT, "src/lib/sync-queue.ts"));
console.log(`${BOLD}IndexedDB store:${NC}  ${srcHasOfflineStore ? GRN + "✓ offline-store.ts" : RED + "✗ مفقود"}${NC}`);
console.log(`${BOLD}Sync queue:${NC}     ${srcHasSyncQueue ? GRN + "✓ sync-queue.ts" : RED + "✗ مفقود"}${NC}`);

console.log();
if (hasAbsoluteBundledAssets) {
  console.log(`${RED}${BOLD}الفحص فشل — شغّل npm run build:android بعد ضبط base: \"./\".${NC}`);
  process.exit(1);
} else if (sourceResults.fail.length === 0 && results.fail.length > 0) {
  console.log(`${YEL}${BOLD}تنبيه: الموارد الخارجية موجودة في مخرجات قديمة فقط. شغّل npm run build:android لإعادة توليد dist-capacitor.${NC}`);
} else if (results.fail.length > 0) {
  console.log(`${RED}${BOLD}الفحص فشل — أصلح الموارد الخارجية أعلاه.${NC}`);
  process.exit(1);
} else {
  console.log(`${GRN}${BOLD}✓ التطبيق جاهز للعمل بدون إنترنت.${NC}`);
}
