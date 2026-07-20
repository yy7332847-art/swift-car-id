// Arabic plate utilities: normalization + speech-to-plate parsing.

const AR_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

const LETTER_MAP: Record<string, string> = { "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ئ": "ي", "ؤ": "و", "ة": "ه" };

function normalizeArabic(input: string): string {
  return input.trim().replace(/[\u064B-\u0652\u0670\u0640]/g, "").split("").map((c) => AR_DIGITS[c] ?? LETTER_MAP[c] ?? c).join("");
}

export function normalizePlate(input: string): string {
  if (!input) return "";
  return normalizeArabic(input).replace(/[\s\-_.،,/\\|:؛;]/g, "");
}

export function splitPlate(normalized: string): { letters: string; digits: string } {
  const m = normalized.match(/^([\u0621-\u064A]{1,4})(\d{1,6})$/) || normalized.match(/^(\d{1,6})([\u0621-\u064A]{1,4})$/);
  if (!m) return { letters: "", digits: "" };
  return /^\d/.test(m[1]) ? { letters: m[2], digits: m[1] } : { letters: m[1], digits: m[2] };
}

export function formatPlateParts(letters: string, digits: string): string {
  return `${letters.split("").join(" ")} ${digits}`.trim();
}

const DIGIT_WORDS: Record<string, string> = {
  "صفر": "0", "زيرو": "0", "سفر": "0", "واحد": "1", "احد": "1", "احدى": "1", "احدا": "1",
  "اثنين": "2", "اتنين": "2", "تنين": "2", "ثنين": "2", "اثنان": "2", "اثنا": "2", "اثني": "2",
  "ثلاثه": "3", "ثلاثة": "3", "ثلاث": "3", "تلاته": "3", "تلاتة": "3", "تلات": "3",
  "اربعه": "4", "اربعة": "4", "اربع": "4", "خمسه": "5", "خمسة": "5", "خمس": "5",
  "سته": "6", "ستة": "6", "ست": "6", "سبعه": "7", "سبعة": "7", "سبع": "7",
  "ثمانيه": "8", "ثمانية": "8", "ثمان": "8", "تمانيه": "8", "تمانية": "8", "تمنيه": "8", "تمنية": "8", "تمن": "8",
  "تسعه": "9", "تسعة": "9", "تسع": "9",
};

const UNITS: Record<string, number> = Object.fromEntries(Object.entries(DIGIT_WORDS).map(([k, v]) => [k, Number(v)]));
const TEENS: Record<string, number> = { "عشره": 10, "عشرة": 10, "عشر": 10, "حداشر": 11, "احداشر": 11, "احد عشر": 11, "اتناشر": 12, "اثناشر": 12, "اثني عشر": 12, "اثنا عشر": 12, "تلتاشر": 13, "ثلاثتاشر": 13, "ثلاثة عشر": 13, "اربعتاشر": 14, "اربعة عشر": 14, "اربع عشر": 14, "خمستاشر": 15, "خمسة عشر": 15, "ستاشر": 16, "ستة عشر": 16, "سبعتاشر": 17, "سبعة عشر": 17, "تمانتاشر": 18, "ثمانتاشر": 18, "ثمانية عشر": 18, "تسعتاشر": 19, "تسعة عشر": 19 };
const TENS: Record<string, number> = { "عشرين": 20, "عشرون": 20, "ثلاثين": 30, "ثلاثون": 30, "تلاتين": 30, "اربعين": 40, "اربعون": 40, "خمسين": 50, "خمسون": 50, "ستين": 60, "ستون": 60, "سبعين": 70, "سبعون": 70, "ثمانين": 80, "ثمانون": 80, "تمانين": 80, "تسعين": 90, "تسعون": 90 };
const HUNDREDS: Record<string, number> = { "مئه": 100, "مئة": 100, "مائه": 100, "مائة": 100, "ميه": 100, "مية": 100, "مئتين": 200, "مائتين": 200, "ميتين": 200, "متين": 200, "ثلاثمئه": 300, "ثلاثمئة": 300, "ثلاثمائه": 300, "ثلاثمائة": 300, "تلتميه": 300, "تلتمية": 300, "اربعمئه": 400, "اربعمئة": 400, "اربعمائه": 400, "اربعمائة": 400, "ربعميه": 400, "ربعمية": 400, "خمسمئه": 500, "خمسمئة": 500, "خمسمائه": 500, "خمسمائة": 500, "خمسميه": 500, "خمسمية": 500, "ستمئه": 600, "ستمئة": 600, "ستمائه": 600, "ستمائة": 600, "ستميه": 600, "ستمية": 600, "سبعمئه": 700, "سبعمئة": 700, "سبعمائه": 700, "سبعمائة": 700, "سبعميه": 700, "سبعمية": 700, "ثمانمئه": 800, "ثمانمئة": 800, "ثمانمائه": 800, "ثمانمائة": 800, "تمنميه": 800, "تمنمية": 800, "تسعمئه": 900, "تسعمئة": 900, "تسعمائه": 900, "تسعمائة": 900, "تسعميه": 900, "تسعمية": 900 };
const THOUSANDS = new Set(["الف", "الفا", "الاف", "الفين"]);
const PLATE_LETTERS = new Set("ابجدهوزحطيكلمنسعصقرشتثخذضظغف".split(""));
const LETTER_NAMES: Record<string, string> = { "الف": "ا", "ا": "ا", "باء": "ب", "با": "ب", "ب": "ب", "تاء": "ت", "تا": "ت", "ت": "ت", "جيم": "ج", "ج": "ج", "حاء": "ح", "حا": "ح", "ح": "ح", "خاء": "خ", "خا": "خ", "خ": "خ", "دال": "د", "د": "د", "ذال": "ذ", "ذ": "ذ", "راء": "ر", "را": "ر", "ر": "ر", "زاي": "ز", "زين": "ز", "ز": "ز", "سين": "س", "س": "س", "شين": "ش", "ش": "ش", "صاد": "ص", "ص": "ص", "ضاد": "ض", "ض": "ض", "طاء": "ط", "طا": "ط", "ط": "ط", "ظاء": "ظ", "ظا": "ظ", "ظ": "ظ", "عين": "ع", "ع": "ع", "غين": "غ", "غ": "غ", "فاء": "ف", "فا": "ف", "ف": "ف", "قاف": "ق", "ق": "ق", "كاف": "ك", "ك": "ك", "لام": "ل", "ل": "ل", "ميم": "م", "م": "م", "نون": "ن", "ن": "ن", "هاء": "ه", "ها": "ه", "ه": "ه", "واو": "و", "و": "و", "ياء": "ي", "يا": "ي", "ي": "ي" };

function tokenize(text: string): string[] { return normalizeArabic(text).replace(/[،.,؟?!:؛;\-_/\\|()[\]{}]/g, " ").split(/\s+/).filter(Boolean); }
function isNumberWord(word: string): boolean { return DIGIT_WORDS[word] !== undefined || TEENS[word] !== undefined || TENS[word] !== undefined || HUNDREDS[word] !== undefined || THOUSANDS.has(word); }
function stripWa(raw: string): string { const w = normalizeArabic(raw); return w.length > 2 && w.startsWith("و") && isNumberWord(w.slice(1)) ? w.slice(1) : w; }
function directDigits(raw: string): string | null { const s = normalizeArabic(raw); return /^\d{1,6}$/.test(s) ? s : null; }

function parseTwoDigitGroup(words: string[], start: number): { value: number; consumed: number } | null {
  const w0 = stripWa(words[start] ?? "");
  const joined2 = `${w0} ${stripWa(words[start + 1] ?? "")}`;
  if (TEENS[joined2] !== undefined) return { value: TEENS[joined2], consumed: 2 };
  if (TEENS[w0] !== undefined) return { value: TEENS[w0], consumed: 1 };
  if (TENS[w0] !== undefined) return { value: TENS[w0], consumed: 1 };
  if (UNITS[w0] !== undefined) {
    const w1 = stripWa(words[start + 1] ?? "");
    if (TENS[w1] !== undefined) return { value: TENS[w1] + UNITS[w0], consumed: 2 };
    return { value: UNITS[w0], consumed: 1 };
  }
  return null;
}

function parseNaturalNumber(words: string[], start: number): { value: string; consumed: number } {
  let total = 0, current = 0, consumed = 0, hasAny = false;
  for (let i = start; i < words.length; i++) {
    const w = stripWa(words[i]);
    const d = directDigits(w);
    if (d) { if (hasAny) break; return { value: d, consumed: 1 }; }
    const joined2 = `${w} ${stripWa(words[i + 1] ?? "")}`;
    if (TEENS[joined2] !== undefined) { current += TEENS[joined2]; i++; consumed += 2; hasAny = true; continue; }
    if (TEENS[w] !== undefined) { current += TEENS[w]; consumed++; hasAny = true; continue; }
    if (THOUSANDS.has(w)) { total += w === "الفين" ? 2000 : (current || 1) * 1000; current = 0; consumed++; hasAny = true; continue; }
    if (HUNDREDS[w] !== undefined) { current += HUNDREDS[w]; consumed++; hasAny = true; continue; }
    if (TENS[w] !== undefined) { current += TENS[w]; consumed++; hasAny = true; continue; }
    if (UNITS[w] !== undefined) { current += UNITS[w]; consumed++; hasAny = true; continue; }
    break;
  }
  return hasAny ? { value: String(total + current), consumed } : { value: "", consumed: 0 };
}

function parseArabicNumberRun(words: string[], startIdx: number): { value: string; consumed: number; suspectPart?: string; correctionNote?: string } {
  const d = directDigits(words[startIdx] ?? "");
  if (d) return { value: d.slice(0, 4), consumed: 1 };

  type Cand = { value: string; consumed: number; suspectPart?: string; correctionNote?: string };
  const candidates: Cand[] = [];

  // Strategy A: pure sequence of single-digit words ("اربعة اثنين اربعة اثنين")
  let seq = "", seqConsumed = 0;
  for (let i = startIdx; i < words.length && seq.length < 4; i++) {
    const w = stripWa(words[i]);
    if (DIGIT_WORDS[w] === undefined) break;
    seq += DIGIT_WORDS[w]; seqConsumed++;
  }
  if (seq.length >= 2) candidates.push({ value: seq, consumed: seqConsumed });

  // Strategy B: two two-digit groups ("اثنين واربعين اتنين وعشرين")
  const groups: string[] = [];
  let groupConsumed = 0;
  for (let i = startIdx; i < words.length && groups.length < 2;) {
    const g = parseTwoDigitGroup(words, i);
    if (!g) break;
    groups.push(g.value.toString().padStart(groups.length ? 2 : 1, "0"));
    i += g.consumed; groupConsumed += g.consumed;
  }
  if (groups.length >= 2) candidates.push({ value: groups.join("").slice(0, 4), consumed: groupConsumed });

  // Strategy C: natural number ("اربعة الاف ومئتين واثنين")
  const nat = parseNaturalNumber(words, startIdx);
  if (nat.value) candidates.push({ value: nat.value.padStart(nat.value.length >= 4 ? nat.value.length : 4, "0").slice(-4), consumed: nat.consumed });

  // Special: two consecutive hundreds words (e.g. "ميتين ميتين" = 2200)
  const h1 = HUNDREDS[stripWa(words[startIdx] ?? "")], h2 = HUNDREDS[stripWa(words[startIdx + 1] ?? "")];
  if (h1 && h2) candidates.push({
    value: `${Math.floor(h1 / 100)}${Math.floor(h2 / 100)}00`,
    consumed: 2,
    suspectPart: words.slice(startIdx, startIdx + 2).join(" "),
    correctionNote: "تم تفسير نطق المئات المتكرر كأربعة أرقام",
  });

  if (candidates.length === 0) return { value: "", consumed: 0 };
  // Prefer the longest digit value (up to 4), then the one that consumed the most words.
  candidates.sort((a, b) => Math.min(4, b.value.length) - Math.min(4, a.value.length) || b.consumed - a.consumed);
  const best = candidates[0];
  return { ...best, value: best.value.slice(0, 4) };
}


export interface DetectedPlate { raw: string; normalized: string; letters: string; digits: string; complete: boolean; confidence: number; suspectPart?: string; correctionNote?: string; }

// Reverse maps for hallucination guard (each plate char must actually appear in the transcript).
const LETTER_TO_NAMES: Record<string, string[]> = {};
for (const [name, ch] of Object.entries(LETTER_NAMES)) { (LETTER_TO_NAMES[ch] ||= []).push(name); }
const DIGIT_TO_WORDS: Record<string, string[]> = {};
for (const [w, d] of Object.entries(DIGIT_WORDS)) { (DIGIT_TO_WORDS[d] ||= []).push(w); }

/** True if every letter and every digit of the plate has some spoken evidence in the transcript. */
export function plateAppearsInText(letters: string, digits: string, text: string): boolean {
  const norm = " " + normalizeArabic(text) + " ";
  for (const ch of letters) {
    const names = LETTER_TO_NAMES[ch] ?? [];
    const found = names.some((n) => norm.includes(` ${n} `) || norm.includes(` ${n}`) || norm.includes(`${n} `));
    if (!found) return false;
  }
  for (const d of digits) {
    if (norm.includes(d)) continue;
    const words = DIGIT_TO_WORDS[d] ?? [];
    if (words.some((w) => norm.includes(w))) continue;
    // Digit may come from tens/hundreds combos — accept if any number-word appears.
    if (/[0-9]/.test(norm) || /عش|مي|مئ|الف/.test(norm)) continue;
    return false;
  }
  return true;
}

function pushFound(found: DetectedPlate[], plate: Omit<DetectedPlate, "raw" | "normalized" | "complete" | "confidence"> & { confidence?: number }) {
  const letters = plate.letters.slice(0, 3), digits = plate.digits.slice(0, 4);
  if (letters.length < 2 || digits.length < 2) return;
  const normalized = normalizePlate(letters + digits);
  if (found.some((f) => f.normalized === normalized)) return;
  const complete = letters.length === 3 && digits.length === 4;
  found.push({ raw: formatPlateParts(letters, digits), normalized, letters, digits, complete, confidence: plate.confidence ?? (complete ? 0.92 : 0.62), suspectPart: plate.suspectPart, correctionNote: plate.correctionNote });
}

export function extractPlates(text: string): DetectedPlate[] {
  if (!text) return [];
  const words = tokenize(text);
  const found: DetectedPlate[] = [];
  for (let i = 0; i < words.length; i++) {
    let letters = "", j = i;
    while (j < words.length && letters.length < 3) {
      const raw = stripWa(words[j]);
      if (/^[\u0621-\u064A]+$/.test(raw)) {
        if (LETTER_NAMES[raw]) { letters += LETTER_NAMES[raw]; j++; continue; }
        const chars = raw.split("").map((c) => LETTER_MAP[c] ?? c);
        if (raw.length <= 3 && chars.every((c) => PLATE_LETTERS.has(c))) { letters += chars.join("").slice(0, 3 - letters.length); j++; continue; }
      }
      break;
    }
    if (letters.length >= 2) {
      const parsed = parseArabicNumberRun(words, j);
      if (parsed.value && parsed.value.length >= 2) {
        const short = letters.length !== 3 || parsed.value.length < 4;
        pushFound(found, { letters, digits: parsed.value, confidence: short ? 0.62 : 0.92, suspectPart: parsed.suspectPart ?? (short ? formatPlateParts(letters, parsed.value.slice(0, 4)) : undefined), correctionNote: parsed.correctionNote });
        i = Math.max(i, j + parsed.consumed - 1);
      }
    }
  }
  for (const w of words) {
    const m = normalizePlate(w).match(/^([\u0621-\u064A]{2,4})(\d{2,6})$/);
    if (m) pushFound(found, { letters: m[1], digits: m[2], confidence: 0.9 });
  }
  return found;
}
