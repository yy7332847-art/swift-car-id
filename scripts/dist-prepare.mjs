#!/usr/bin/env node
// Unified `dist/` output: flat static SPA that works for both web hosting
// (Hostinger / Netlify / Cloudflare Pages / Vercel / Apache / nginx) AND
// Capacitor Android/iOS. Runs after `vite build`.
//
// TanStack Start's Vite build produces `dist/client` (static assets) and
// `dist/server` (nitro SSR). We keep only the client files, flatten them
// into `dist/`, generate a real `index.html` with relative asset paths,
// and add SPA fallback files for every major host.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const CLIENT = join(DIST, "client");
const SERVER = join(DIST, "server");
const TMP = "dist-tmp-client";

function fail(m) { console.error(`\n✗ ${m}\n`); process.exit(1); }

if (!existsSync(CLIENT)) fail("لم يتم العثور على dist/client. شغّل vite build أولاً.");

// 1. Stash client, wipe dist, restore client contents flat.
rmSync(TMP, { recursive: true, force: true });
cpSync(CLIENT, TMP, { recursive: true });
rmSync(CLIENT, { recursive: true, force: true });
rmSync(SERVER, { recursive: true, force: true });
// Move stashed files up into dist/ root
for (const name of readdirSync(TMP)) {
  cpSync(join(TMP, name), join(DIST, name), { recursive: true });
}
rmSync(TMP, { recursive: true, force: true });

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
    <title>تشييك اللوحات — نظام تعرّف صوتي على لوحات السيارات</title>
    <meta name="description" content="نظام موبايل احترافي لمحصّلي البنوك: رفع ملفات لوحات ثم مطابقة صوتية فورية بالعربية." />
    <link rel="icon" href="./favicon.ico" />
    <link rel="icon" type="image/png" sizes="32x32" href="./favicon-32.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="./apple-touch-icon.png" />
    <link rel="manifest" href="./manifest.webmanifest" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="تشييك" />
    <meta name="mobile-web-app-capable" content="yes" />
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

console.log(`✓ تم توحيد dist/ (SPA ثابت)`);
console.log(`  • ارفعه كما هو على Hostinger / Netlify / Cloudflare / Vercel / Apache / nginx`);
console.log(`  • Capacitor يستخدم نفس المجلد عبر webDir: "dist"`);
