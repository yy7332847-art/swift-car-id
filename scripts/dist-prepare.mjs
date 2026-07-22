#!/usr/bin/env node
// Unified `dist/` output: flat static SPA that works for both web hosting
// (Hostinger / Netlify / Cloudflare Pages / Vercel / Apache / nginx) AND
// Capacitor Android/iOS. Runs after `vite build`.
//
// TanStack Start's Vite build produces `dist/client` (static assets) and
// `dist/server` (nitro SSR). We keep only the client files, flatten them
// into `dist/`, generate a real `index.html` with relative asset paths,
// and add SPA fallback files for every major host.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DIST = "dist";
const CLIENT = join(DIST, "client");
const SERVER = join(DIST, "server");
const OUTPUT_PUBLIC = join(".output", "public");
const TMP = ".dist-static-tmp";
const NITRO_ROOT_FILES = ["nitro.json", "package.json", "package-lock.json"];

function fail(m) { console.error(`\n✗ ${m}\n`); process.exit(1); }
function hasAssets(dir) { return existsSync(join(dir, "assets")); }
function copyDirContents(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    cpSync(join(from, name), join(to, name), { recursive: true });
  }
}

const source = [CLIENT, OUTPUT_PUBLIC, DIST].find((dir) => existsSync(dir) && hasAssets(dir));
if (!source) {
  fail("لم يتم العثور على ملفات الواجهة داخل dist/client أو .output/public أو dist/assets. شغّل npm run build من جديد.");
}

// 1. Build a clean, single static dist/ folder from the real client output.
rmSync(TMP, { recursive: true, force: true });
copyDirContents(source, TMP);

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
copyDirContents(TMP, DIST);
rmSync(TMP, { recursive: true, force: true });

// Remove server-only artifacts: the exported folder is a normal static web app.
rmSync(SERVER, { recursive: true, force: true });
rmSync(CLIENT, { recursive: true, force: true });
for (const file of NITRO_ROOT_FILES) {
  rmSync(join(DIST, file), { force: true });
}

// 2. Locate the largest entry chunk + all CSS in dist/assets
const assetsDir = join(DIST, "assets");
if (!existsSync(assetsDir)) fail("dist/assets مفقود بعد النقل.");
const files = readdirSync(assetsDir);
const entry = files
  .filter((n) => /^index-[\w-]+\.js$/.test(n))
  .map((n) => ({ n, size: readFileSync(join(assetsDir, n)).length }))
  .sort((a, b) => b.size - a.size)[0]?.n;
if (!entry) fail("تعذر تحديد ملف تشغيل الواجهة داخل assets/index-*.js.");

const cssLinks = files
  .filter((n) => n.endsWith(".css"))
  .map((n) => `    <link rel="stylesheet" href="./assets/${n}" />`)
  .join("\n");

// 3. Generate a single static index.html (relative paths — works on any
//    subdirectory, any host, and inside Capacitor WebView).
const html = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
    <meta name="theme-color" content="#0f172a" />
    <title>مجدي للتشييك — نظام تعرّف صوتي على لوحات السيارات</title>
    <meta name="description" content="نظام موبايل احترافي لمحصّلي البنوك: رفع ملفات لوحات ثم مطابقة صوتية فورية بالعربية." />
    <link rel="icon" href="./favicon.ico" />
    <link rel="icon" type="image/png" sizes="32x32" href="./favicon-32.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="./apple-touch-icon.png" />
    <link rel="manifest" href="./manifest.webmanifest" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="مجدي" />
    <meta name="mobile-web-app-capable" content="yes" />
    <script>(function(){if(window.__plateInstallPromptCaptureReady)return;window.__plateInstallPromptCaptureReady=true;window.__plateInstallPrompt=null;window.__platePwaInstalled=window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches;window.addEventListener('beforeinstallprompt',function(event){event.preventDefault();window.__plateInstallPrompt=event;window.dispatchEvent(new CustomEvent('platecheck-beforeinstallprompt'));});window.addEventListener('appinstalled',function(){window.__plateInstallPrompt=null;window.__platePwaInstalled=true;window.dispatchEvent(new CustomEvent('platecheck-appinstalled'));});})();</script>
${cssLinks}
  </head>
  <body>
    <noscript>يجب تفعيل JavaScript لتشغيل التطبيق.</noscript>
    <script type="module" src="./assets/${entry}"></script>
  </body>
</html>
`;

writeFileSync(join(DIST, "index.html"), html, "utf8");

// SPA fallback so deep-links (/sessions, /admin/users, ...) resolve on any host
copyFileSync(join(DIST, "index.html"), join(DIST, "404.html"));

// Netlify + Cloudflare Pages
writeFileSync(join(DIST, "_redirects"), "/*    /index.html   200\n", "utf8");
writeFileSync(
  join(DIST, "_headers"),
  `/*
  X-Content-Type-Options: nosniff

/sw.js
  Cache-Control: no-cache
  Service-Worker-Allowed: /

/manifest.webmanifest
  Content-Type: application/manifest+json; charset=utf-8
  Cache-Control: no-cache

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
  "utf8",
);

// Apache / Hostinger
writeFileSync(
  join(DIST, ".htaccess"),
  `Options -MultiViews
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [QSA,L]

<IfModule mod_mime.c>
  AddType application/javascript .js
  AddType text/css .css
</IfModule>
`,
  "utf8",
);

// Vercel
writeFileSync(
  join(DIST, "vercel.json"),
  JSON.stringify({ rewrites: [{ source: "/(.*)", destination: "/index.html" }] }, null, 2),
  "utf8",
);

// nginx snippet (documentation only — not consumed at runtime)
writeFileSync(
  join(DIST, "nginx.conf.example"),
  `# nginx server block snippet
location / {
  try_files $uri $uri/ /index.html;
}
`,
  "utf8",
);

// Sanity: no absolute /assets paths (would break Capacitor + subdirectory hosting)
const out = readFileSync(join(DIST, "index.html"), "utf8");
if (/\s(?:src|href)="\/assets\//.test(out)) fail("index.html يحتوي على /assets مطلقة.");
if (!out.includes(`./assets/${entry}`)) fail("index.html لا يشير إلى ملف التشغيل.");
if (!existsSync(join(DIST, "manifest.webmanifest"))) fail("manifest.webmanifest غير موجود داخل dist.");
if (!existsSync(join(DIST, "sw.js"))) fail("sw.js غير موجود داخل dist — إعدادات PWA لم تخرج في مسار الواجهة.");
if (!existsSync(join(DIST, "assets", entry)) || !statSync(join(DIST, "assets", entry)).isFile()) {
  fail("ملف تشغيل الواجهة غير موجود داخل dist/assets.");
}
if (resolve(source) === resolve(DIST) && readdirSync(DIST).length <= 3) {
  fail("dist يحتوي على ملفات قليلة فقط؛ هذا ليس تصديراً صالحاً.");
}

console.log(`✓ تم توحيد dist/ (SPA ثابت)`);
console.log(`  • ارفعه كما هو على Hostinger / Netlify / Cloudflare / Vercel / Apache / nginx`);
console.log(`  • Capacitor يستخدم نفس المجلد عبر webDir: "dist"`);
