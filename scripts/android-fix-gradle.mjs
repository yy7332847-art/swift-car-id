#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const NC = "\x1b[0m";

const ANDROID_DIR = "android";
const TARGETS = {
  agp: "8.13.0",
  gradle: "8.14.3",
  minSdk: "24",
  compileSdk: "36",
  targetSdk: "36",
  kotlin: "2.2.20",
  coroutines: "1.10.2",
  playServicesLocation: "21.3.0",
};

const desiredVariables = `ext {
    minSdkVersion = ${TARGETS.minSdk}
    compileSdkVersion = ${TARGETS.compileSdk}
    targetSdkVersion = ${TARGETS.targetSdk}
    androidxActivityVersion = '1.11.0'
    androidxAppCompatVersion = '1.7.1'
    androidxCoordinatorLayoutVersion = '1.3.0'
    androidxCoreVersion = '1.17.0'
    androidxFragmentVersion = '1.8.9'
    coreSplashScreenVersion = '1.2.0'
    androidxWebkitVersion = '1.14.0'
    androidxLocalbroadcastmanagerVersion = '1.1.0'
    junitVersion = '4.13.2'
    androidxJunitVersion = '1.3.0'
    androidxEspressoCoreVersion = '3.7.0'
    cordovaAndroidVersion = '14.0.1'
    kotlin_version = '${TARGETS.kotlin}'
    kotlinxCoroutinesVersion = '${TARGETS.coroutines}'
    playServicesLocationVersion = '${TARGETS.playServicesLocation}'
}
`;

function read(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function replaceOrAppend(content, regexp, replacement, appendLine) {
  if (regexp.test(content)) return content.replace(regexp, replacement);
  return `${content.replace(/\s*$/, "")}\n${appendLine ?? replacement}\n`;
}

function patchBuildGradle(path) {
  let content = read(path);
  if (!content) return false;
  if (/ext\.kotlin_version\s*=/.test(content)) {
    content = content.replace(/ext\.kotlin_version\s*=\s*['"][^'"]+['"]/, `ext.kotlin_version = '${TARGETS.kotlin}'`);
  } else {
    content = content.replace(
      /(buildscript\s*\{\s*)/,
      `$1\n    ext.kotlin_version = '${TARGETS.kotlin}'\n`,
    );
  }
  content = replaceOrAppend(
    content,
    /classpath ['"]com\.android\.tools\.build:gradle:[^'"]+['"]/,
    `classpath 'com.android.tools.build:gradle:${TARGETS.agp}'`,
  );
  if (!/org\.jetbrains\.kotlin:kotlin-gradle-plugin/.test(content)) {
    content = content.replace(
      /(classpath ['"]com\.android\.tools\.build:gradle:[^'"]+['"])/,
      `$1\n        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:${TARGETS.kotlin}"`,
    );
  } else {
    content = content.replace(
      /classpath ['"]org\.jetbrains\.kotlin:kotlin-gradle-plugin:[^'"]+['"]/,
      `classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:${TARGETS.kotlin}"`,
    );
  }
  write(path, content);
  return true;
}

function patchGradleProperties(path) {
  let content = read(path) || `# Project-wide Gradle settings.\n`;
  const settings = {
    "org.gradle.jvmargs": "-Xmx4096m -Dfile.encoding=UTF-8",
    "android.useAndroidX": "true",
    "android.enableJetifier": "true",
    // Compatibility mode avoids known R8 full-mode crashes with mixed Kotlin metadata.
    "android.enableR8.fullMode": "false",
    "android.javaCompile.suppressSourceTargetDeprecationWarning": "true",
    "kotlin.jvm.target.validation.mode": "warning",
  };
  for (const [key, value] of Object.entries(settings)) {
    content = replaceOrAppend(content, new RegExp(`^${key.replace(/[.]/g, "\\.")}=.*$`, "m"), `${key}=${value}`);
  }
  write(path, content);
}

function patchWrapper(path) {
  let content = read(path);
  if (!content) return false;
  content = replaceOrAppend(
    content,
    /^distributionUrl=.*$/m,
    `distributionUrl=https\\://services.gradle.org/distributions/gradle-${TARGETS.gradle}-all.zip`,
  );
  write(path, content);
  return true;
}

function patchAppBuild(path) {
  let content = read(path);
  if (!content) return false;
  content = content.replace(/minifyEnabled\s+true/g, "minifyEnabled false");
  if (!/compileOptions\s*\{/.test(content)) {
    content = content.replace(
      /(android\s*\{\s*)/,
      `$1\n    compileOptions {\n        sourceCompatibility JavaVersion.VERSION_21\n        targetCompatibility JavaVersion.VERSION_21\n    }\n`,
    );
  } else {
    content = content
      .replace(/sourceCompatibility\s+JavaVersion\.VERSION_\d+/g, "sourceCompatibility JavaVersion.VERSION_21")
      .replace(/targetCompatibility\s+JavaVersion\.VERSION_\d+/g, "targetCompatibility JavaVersion.VERSION_21");
  }
  write(path, content);
  return true;
}

if (!existsSync(ANDROID_DIR)) {
  console.log(`${YELLOW}${BOLD}⚠ مجلد android غير موجود.${NC}`);
  console.log(`شغّل أول مرة: ${BOLD}npm run build:android && npx cap add android && npm run android:sync${NC}`);
  process.exit(0);
}

write(join(ANDROID_DIR, "variables.gradle"), desiredVariables);
const buildPatched = patchBuildGradle(join(ANDROID_DIR, "build.gradle"));
patchGradleProperties(join(ANDROID_DIR, "gradle.properties"));
const wrapperPatched = patchWrapper(join(ANDROID_DIR, "gradle", "wrapper", "gradle-wrapper.properties"));
patchAppBuild(join(ANDROID_DIR, "app", "build.gradle"));

const missing = [];
if (!buildPatched) missing.push("android/build.gradle");
if (!wrapperPatched) missing.push("android/gradle/wrapper/gradle-wrapper.properties");

if (missing.length) {
  console.log(`${RED}${BOLD}✗ لم أجد ملفات Android التالية:${NC} ${missing.join(", ")}`);
  console.log(`أعد إنشاء Android: ${BOLD}npx cap add android${NC} ثم شغّل ${BOLD}npm run android:sync${NC}`);
  process.exit(1);
}

console.log(`${GREEN}${BOLD}✓ تم تثبيت إعدادات Gradle/AGP/Kotlin المتوافقة مع Android:${NC}`);
console.log(`  AGP ${TARGETS.agp}, Gradle ${TARGETS.gradle}, SDK ${TARGETS.compileSdk}, Kotlin ${TARGETS.kotlin}, R8 full mode off`);