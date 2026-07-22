#!/usr/bin/env bash
# Android build preflight — catches common Gradle/JDK/SDK/AGP mismatches
# BEFORE running `npx cap open android` so you don't waste time in Studio.
# Usage: bash scripts/android-preflight.sh
set -u

RED=$'\e[31m'; YELLOW=$'\e[33m'; GREEN=$'\e[32m'; BLUE=$'\e[34m'; BOLD=$'\e[1m'; NC=$'\e[0m'
FAIL=0; WARN=0

hdr() { echo -e "\n${BOLD}${BLUE}▶ $1${NC}"; }
ok()  { echo -e "  ${GREEN}✓${NC} $1"; }
warn(){ echo -e "  ${YELLOW}⚠${NC} $1"; WARN=$((WARN+1)); }
err() { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL+1)); }
fix() { echo -e "    ${BOLD}الحل:${NC} $1"; }

hdr "1) JDK Version (يجب أن يكون 21 مع Capacitor 8)"
if command -v java >/dev/null 2>&1; then
  JV=$(java -version 2>&1 | head -1 | grep -oE '"[0-9]+' | tr -d '"' | head -1)
  if [ "$JV" = "21" ]; then ok "JDK $JV مثبت"
  else
    err "JDK $JV مثبت — Capacitor 8 وقوالب Android الحديثة تحتاج JDK 21"
    fix "ثبّت JDK 21 من Android Studio أو Temurin ثم اضبط Gradle JDK على 21"
  fi
else err "java غير موجود"; fix "ثبّت Temurin JDK 21"; fi

hdr "2) Android SDK"
if [ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME" ]; then
  ok "ANDROID_HOME=$ANDROID_HOME"
  [ -d "$ANDROID_HOME/platforms/android-36" ] && ok "SDK Platform 36 موجود" || warn "SDK Platform 36 مفقود — افتح SDK Manager وثبّته"
  [ -d "$ANDROID_HOME/build-tools" ] && ok "Build-Tools موجودة" || warn "Build-Tools مفقودة — ثبّت أحدث Build Tools من SDK Manager"
else
    err "ANDROID_HOME غير معرّف"
  fix "ثبّت Android Studio ثم export ANDROID_HOME=\$HOME/Library/Android/sdk (macOS) أو \$HOME/Android/Sdk (Linux)"
fi

hdr "3) npm & Node"
if command -v npm >/dev/null 2>&1; then ok "npm $(npm -v)"; else err "npm غير موجود"; fix "ثبّت Node.js 20+ لأنه يحتوي npm"; fi
if command -v node >/dev/null 2>&1; then
  NV=$(node -v | tr -d 'v' | cut -d. -f1)
  [ "$NV" -ge 20 ] && ok "node v$(node -v | tr -d 'v')" || warn "node v$(node -v) — الأفضل 20+"
fi

hdr "4) ملفات المشروع"
[ -d "android" ] && ok "مجلد android موجود" || { warn "مجلد android غير موجود"; fix "شغّل: npx cap add android"; }
[ -f "dist-capacitor/index.html" ] && ok "dist-capacitor/index.html موجود" || { warn "مخرج Android الثابت غير جاهز"; fix "شغّل: npm run build:android"; }
[ -f "capacitor.config.ts" ] && ok "capacitor.config.ts موجود" || err "capacitor.config.ts مفقود"

hdr "5) توافق إصدارات Gradle/AGP/SDK"
VARS="android/variables.gradle"
BUILD="android/build.gradle"
WRAP="android/gradle/wrapper/gradle-wrapper.properties"

if [ -f "$VARS" ]; then
  CSDK=$(grep -oE 'compileSdkVersion\s*=\s*[0-9]+' "$VARS" | grep -oE '[0-9]+' | head -1)
  TSDK=$(grep -oE 'targetSdkVersion\s*=\s*[0-9]+' "$VARS" | grep -oE '[0-9]+' | head -1)
  [ "${CSDK:-0}" -ge 36 ] && ok "compileSdk=$CSDK" || { err "compileSdk=$CSDK منخفض"; fix "شغّل: npm run android:fix أو عدّل $VARS: compileSdkVersion = 36"; }
  [ "${TSDK:-0}" -ge 36 ] && ok "targetSdk=$TSDK" || { err "targetSdk=$TSDK منخفض"; fix "شغّل: npm run android:fix أو عدّل $VARS: targetSdkVersion = 36"; }
else warn "$VARS مفقود"; fi

if [ -f "$BUILD" ]; then
  AGP=$(grep -oE "com.android.tools.build:gradle:[0-9.]+" "$BUILD" | head -1 | cut -d: -f3)
  if [ -n "$AGP" ]; then
    AGP_MAJ=$(echo "$AGP" | cut -d. -f1)
    AGP_MIN=$(echo "$AGP" | cut -d. -f2)
    if [ "$AGP_MAJ" -gt 8 ] || { [ "$AGP_MAJ" -eq 8 ] && [ "${AGP_MIN:-0}" -ge 13 ]; }; then ok "AGP $AGP"; else err "AGP $AGP قديم وقد يسبب Kotlin Metadata / D8"; fix "شغّل: npm run android:fix أو عدّل $BUILD: classpath 'com.android.tools.build:gradle:8.13.0'"; fi
  fi
fi

if [ -f "$WRAP" ]; then
  GRADLE=$(grep -oE "gradle-[0-9.]+-" "$WRAP" | head -1 | grep -oE "[0-9.]+" | head -1)
  if [ -n "$GRADLE" ]; then
    GMAJ=$(echo "$GRADLE" | cut -d. -f1)
    GMIN=$(echo "$GRADLE" | cut -d. -f2)
    if [ "$GMAJ" -gt 8 ] || { [ "$GMAJ" -eq 8 ] && [ "${GMIN:-0}" -ge 14 ]; }; then ok "Gradle $GRADLE"; else err "Gradle $GRADLE قديم"; fix "شغّل: npm run android:fix أو عدّل $WRAP: gradle-8.14.3-all.zip"; fi
  fi
fi

hdr "6) الأذونات في AndroidManifest"
MAN="android/app/src/main/AndroidManifest.xml"
if [ -f "$MAN" ]; then
  for P in INTERNET ACCESS_FINE_LOCATION RECORD_AUDIO FOREGROUND_SERVICE; do
    grep -q "android.permission.$P" "$MAN" && ok "$P" || warn "$P مفقود — راجع ANDROID.md"
  done
else warn "AndroidManifest.xml غير موجود — شغّل npx cap add android"; fi

hdr "7) capacitor.config.ts — منع الشاشة البيضاء"
if [ -f "capacitor.config.ts" ]; then
  if grep -qE '"url"\s*:' capacitor.config.ts; then
    err "server.url موجود — سيحاول التطبيق تحميل من الإنترنت (شاشة بيضاء)"
    fix "احذف server.url من capacitor.config.ts أو اجعله فقط في التطوير"
  else ok "server.url غير مضبوط (جيد للإنتاج)"; fi
  grep -q 'androidScheme.*https' capacitor.config.ts && ok "androidScheme=https" || warn "androidScheme غير https — قد يمنع بعض APIs offline"
  grep -q 'webDir: "dist-capacitor"' capacitor.config.ts && ok "webDir=dist-capacitor" || { err "webDir لا يشير إلى dist-capacitor"; fix "اضبط capacitor.config.ts على webDir: \"dist-capacitor\""; }
fi

hdr "8) فحص index.html ومسارات Android WebView"
if [ -f "dist-capacitor/index.html" ]; then
  if grep -qE ' (src|href)="/assets/' dist-capacitor/index.html; then
    err "index.html يستخدم /assets مساراً مطلقاً — سبب مباشر للشاشة البيضاء"
    fix "شغّل: npm run build:android وتأكد من vite.base='./'"
  else ok "مسارات assets نسبية داخل dist-capacitor/index.html"; fi
  grep -qE 'src="\./assets/index-.*\.js"' dist-capacitor/index.html && ok "ملف تشغيل JavaScript موجود بمسار نسبي" || warn "لم يتم العثور على script ./assets/index-*.js"
else
  err "dist-capacitor/index.html غير موجود"
  fix "شغّل: npm run build:android"
fi

hdr "9) مساحة القرص و Gradle cache"
if [ -d "$HOME/.gradle/caches" ]; then
  SZ=$(du -sh "$HOME/.gradle/caches" 2>/dev/null | cut -f1)
  ok "Gradle cache: $SZ"
fi
AVAIL=$(df -h . | awk 'NR==2 {print $4}')
ok "مساحة القرص المتاحة: $AVAIL"

echo
if [ $FAIL -gt 0 ]; then
  echo -e "${RED}${BOLD}✗ فشل: $FAIL مشاكل حرجة، $WARN تحذيرات${NC}"
  echo -e "أصلح الأخطاء أعلاه قبل تشغيل ${BOLD}npx cap open android${NC}"
  exit 1
elif [ $WARN -gt 0 ]; then
  echo -e "${YELLOW}${BOLD}⚠ $WARN تحذيرات — البناء قد يعمل لكن راجع الملاحظات${NC}"
  exit 0
else
  echo -e "${GREEN}${BOLD}✓ كل الفحوصات نجحت — جاهز للبناء${NC}"
  echo -e "التالي: ${BOLD}npm run android:open${NC}"
fi
