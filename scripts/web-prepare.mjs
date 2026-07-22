#!/usr/bin/env node
// Produces `dist-web/` — a fully static SPA build that can be uploaded to any
// static host (Hostinger, Netlify, Cloudflare Pages, GitHub Pages, Apache,
// nginx). Uses the same relative-asset index.html as the Capacitor build, and
// adds SPA fallback files for every major host.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const CLIENT_DIR = "dist/client";
const OUT_DIR = "dist-web";

function fail(m) { console.error(`\n✗ ${m}\n`); process.exit(1); }

if (!existsSync(CLIENT_DIR)) fail("لم يتم العثور على dist/client. شغّل npm run build أولاً.");

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
cpSync(CLIENT_DIR, OUT_DIR, { recursive: true });

const assetsDir = join(OUT_DIR, "assets");
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

const html = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
    <meta name="theme-color" content="#0f172a" />
    <title>تشييك اللوحات</title>
    <meta name="description" content="نظام تحصيل ذكي بمطابقة صوتية للوحات السيارات." />
    <link rel="icon" href="./favicon.ico" />
${cssLinks}
  </head>
  <body>
    <noscript>يجب تفعيل JavaScript لتشغيل التطبيق.</noscript>
    <script type="module" src="./assets/${entry}"></script>
  </body>
</html>
`;

writeFileSync(join(OUT_DIR, "index.html"), html, "utf8");
// GitHub Pages / Cloudflare Pages SPA fallback
copyFileSync(join(OUT_DIR, "index.html"), join(OUT_DIR, "404.html"));

// Netlify / Cloudflare Pages
writeFileSync(join(OUT_DIR, "_redirects"), "/*    /index.html   200\n", "utf8");

// Apache / Hostinger (.htaccess)
writeFileSync(
  join(OUT_DIR, ".htaccess"),
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

// Vercel (in case anyone uploads there)
writeFileSync(
  join(OUT_DIR, "vercel.json"),
  JSON.stringify({ rewrites: [{ source: "/(.*)", destination: "/index.html" }] }, null, 2),
  "utf8",
);

// nginx snippet (documentation)
writeFileSync(
  join(OUT_DIR, "nginx.conf.example"),
  `# Example nginx server block — copy into your site config
location / {
  try_files $uri $uri/ /index.html;
}
`,
  "utf8",
);

const out = readFileSync(join(OUT_DIR, "index.html"), "utf8");
if (/\s(?:src|href)="\/assets\//.test(out)) fail("index.html يحتوي على /assets مطلقة.");

console.log(`✓ تم تجهيز ${OUT_DIR}/ (SPA static) — ارفعه على أي استضافة.`);
console.log(`  يحتوي على: index.html, 404.html, _redirects, .htaccess, vercel.json`);
