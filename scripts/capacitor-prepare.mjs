#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CLIENT_DIR = "dist/client";
const OUT_DIR = "dist-capacitor";

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!existsSync(CLIENT_DIR)) {
  fail("لم يتم العثور على dist/client. شغّل npm run build أولاً.");
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
cpSync(CLIENT_DIR, OUT_DIR, { recursive: true });

const assetsDir = join(OUT_DIR, "assets");
const files = readdirSync(assetsDir);
const entry = files
  .filter((name) => /^index-[\w-]+\.js$/.test(name))
  .map((name) => ({ name, size: readFileSync(join(assetsDir, name)).length }))
  .sort((a, b) => b.size - a.size)[0]?.name;

if (!entry) fail("تعذر تحديد ملف تشغيل الواجهة داخل assets/index-*.js.");

const cssLinks = files
  .filter((name) => name.endsWith(".css"))
  .map((name) => `    <link rel="stylesheet" href="./assets/${name}" />`)
  .join("\n");

const html = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
    <meta name="theme-color" content="#0f172a" />
    <title>تشييك اللوحات</title>
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

const output = readFileSync(join(OUT_DIR, "index.html"), "utf8");
if (!output.includes(`./assets/${entry}`)) fail("فشل إنشاء index.html صالح للتطبيق.");
if (/\s(?:src|href)="\/assets\//.test(output)) {
  fail("index.html يحتوي على مسارات /assets مطلقة تسبب شاشة بيضاء داخل Android WebView.");
}

console.log(`✓ تم تجهيز ${OUT_DIR}/index.html لتطبيق Android`);