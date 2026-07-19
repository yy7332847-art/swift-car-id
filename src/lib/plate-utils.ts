// Arabic plate utilities: normalization + speech-to-plate parsing.

// Convert Arabic-Indic digits to ASCII
const AR_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

// Normalize Arabic letter variants
const LETTER_MAP: Record<string, string> = {
  "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا",
  "ى": "ي", "ئ": "ي",
  "ؤ": "و",
  "ة": "ه",
};

export function normalizePlate(input: string): string {
  if (!input) return "";
  let s = input.trim();
  // Remove diacritics/tatweel
  s = s.replace(/[\u064B-\u0652\u0670\u0640]/g, "");
  // Convert digits
  s = s.split("").map((c) => AR_DIGITS[c] ?? c).join("");
  // Normalize letters
  s = s.split("").map((c) => LETTER_MAP[c] ?? c).join("");
  // Remove spaces/dashes/punctuation
  s = s.replace(/[\s\-_.،/\\|]/g, "");
  return s;
}

export function splitPlate(normalized: string): { letters: string; digits: string } {
  const m = normalized.match(/^([\u0621-\u064A]{1,4})(\d{1,4})$/) || normalized.match(/^(\d{1,4})([\u0621-\u064A]{1,4})$/);
  if (!m) return { letters: "", digits: "" };
  const letters = /^\d/.test(m[1]) ? m[2] : m[1];
  const digits = /^\d/.test(m[1]) ? m[1] : m[2];
  return { letters, digits };
}

// -------- Speech → plates parser --------

// Word → digit map (Arabic spoken numbers, incl. common regional forms).
const DIGIT_WORDS: Record<string, string> = {
  "صفر": "0", "زيرو": "0",
  "واحد": "1", "احد": "1", "أحد": "1", "احدى": "1",
  "اثنين": "2", "إثنين": "2", "اتنين": "2", "تنين": "2", "ثنين": "2", "اثنان": "2",
  "ثلاثة": "3", "ثلاث": "3", "تلاته": "3", "تلاتة": "3", "ثلاثه": "3",
  "أربعة": "4", "اربعة": "4", "اربع": "4", "اربعه": "4",
  "خمسة": "5", "خمسه": "5", "خمس": "5",
  "ستة": "6", "سته": "6", "ست": "6",
  "سبعة": "7", "سبعه": "7", "سبع": "7",
  "ثمانية": "8", "ثمانيه": "8", "ثمان": "8", "تمانية": "8", "تمانيه": "8", "تمنية": "8",
  "تسعة": "9", "تسعه": "9", "تسع": "9",
};

const TENS: Record<string, number> = {
  "عشرة": 10, "عشره": 10, "عشر": 10,
  "عشرين": 20, "عشرون": 20,
  "ثلاثين": 30, "ثلاثون": 30, "تلاتين": 30,
  "اربعين": 40, "أربعين": 40, "اربعون": 40,
  "خمسين": 50, "خمسون": 50,
  "ستين": 60, "ستون": 60,
  "سبعين": 70, "سبعون": 70,
  "ثمانين": 80, "ثمانون": 80, "تمانين": 80,
  "تسعين": 90, "تسعون": 90,
};

const UNITS: Record<string, number> = {
  "واحد": 1, "احد": 1, "أحد": 1, "احدى": 1, "احدا": 1,
  "اثنين": 2, "إثنين": 2, "اتنين": 2, "ثنين": 2, "اثنان": 2, "اثنا": 2, "اثني": 2,
  "ثلاثة": 3, "ثلاث": 3, "تلاته": 3, "تلاتة": 3,
  "اربعة": 4, "أربعة": 4, "اربع": 4,
  "خمسة": 5, "خمسه": 5, "خمس": 5,
  "ستة": 6, "سته": 6, "ست": 6,
  "سبعة": 7, "سبعه": 7, "سبع": 7,
  "ثمانية": 8, "ثمانيه": 8, "تمانية": 8, "تمن": 8, "ثمان": 8,
  "تسعة": 9, "تسعه": 9, "تسع": 9,
};

const HUNDREDS: Record<string, number> = {
  "مئة": 100, "مائة": 100, "ميه": 100, "مية": 100,
  "مئتين": 200, "مائتين": 200, "ميتين": 200, "متين": 200,
  "ثلاثمئة": 300, "ثلاثمائة": 300, "تلتميه": 300, "تلتمية": 300,
  "اربعمئة": 400, "اربعمائة": 400, "ربعميه": 400, "ربعمية": 400,
  "خمسمئة": 500, "خمسمائة": 500, "خمسميه": 500, "خمسمية": 500,
  "ستمئة": 600, "ستمائة": 600, "ستميه": 600, "ستمية": 600,
  "سبعمئة": 700, "سبعمائة": 700, "سبعميه": 700, "سبعمية": 700,
  "ثمانمئة": 800, "ثمانمائة": 800, "تمنميه": 800, "تمنمية": 800,
  "تسعمئة": 900, "تسعمائة": 900, "تسعميه": 900, "تسعمية": 900,
};

const THOUSANDS: Record<string, number> = {
  "الف": 1000, "ألف": 1000, "الفا": 1000,
  "الفين": 2000, "ألفين": 2000,
};

// Arabic letters used on Saudi plates
const PLATE_LETTERS = new Set("ابجدهوزحطيكلمنسعصقرشتثخذضظغفةى".split(""));
// Common spoken forms → single letter
const LETTER_NAMES: Record<string, string> = {
  "الف": "ا", "ألف": "ا", "أ": "ا", "ا": "ا",
  "باء": "ب", "با": "ب", "ب": "ب",
  "تاء": "ت", "تا": "ت", "ت": "ت",
  "جيم": "ج", "ج": "ج",
  "حاء": "ح", "حا": "ح", "ح": "ح",
  "خاء": "خ", "خا": "خ", "خ": "خ",
  "دال": "د", "د": "د",
  "ذال": "ذ", "ذ": "ذ",
  "راء": "ر", "را": "ر", "ر": "ر",
  "زاي": "ز", "زين": "ز", "ز": "ز",
  "سين": "س", "س": "س",
  "شين": "ش", "ش": "ش",
  "صاد": "ص", "ص": "ص",
  "ضاد": "ض", "ض": "ض",
  "طاء": "ط", "طا": "ط", "ط": "ط",
  "ظاء": "ظ", "ظا": "ظ", "ظ": "ظ",
  "عين": "ع", "ع": "ع",
  "غين": "غ", "غ": "غ",
  "فاء": "ف", "فا": "ف", "ف": "ف",
  "قاف": "ق", "ق": "ق",
  "كاف": "ك", "ك": "ك",
  "لام": "ل", "ل": "ل",
  "ميم": "م", "م": "م",
  "نون": "ن", "ن": "ن",
  "هاء": "ه", "ها": "ه", "ه": "ه", "هي": "ه",
  "واو": "و", "و": "و",
  "ياء": "ي", "يا": "ي", "ي": "ي",
};

function tokenize(text: string): string[] {
  const t = text
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[،.,؟?!:؛;\-]/g, " ");
  // Split digits and letters attached
  return t.split(/\s+/).filter(Boolean);
}

function stripWa(w: string): { word: string; hadWa: boolean } {
  // Remove leading و (and) which chains number words: "اثنين وعشرين"
  if (w.length > 2 && w.startsWith("و") && (UNITS[w.slice(1)] !== undefined || TENS[w.slice(1)] !== undefined || HUNDREDS[w.slice(1)] !== undefined || THOUSANDS[w.slice(1)] !== undefined)) {
    return { word: w.slice(1), hadWa: true };
  }
  return { word: w, hadWa: false };
}

/**
 * Convert a run of arabic number words into a numeric string.
 * Returns "" if none. Handles: "أربعة آلاف مئتين اثنين وعشرين" = "4222",
 * "اثنين اثنين اثنين اثنين" = "2222", "٤٢٢٢" = "4222".
 */
function parseArabicNumberRun(words: string[], startIdx: number): { value: string; consumed: number } {
  let total = 0;
  let current = 0;
  let consumed = 0;
  let hasAny = false;

  for (let i = startIdx; i < words.length; i++) {
    const raw = words[i];
    // Direct digits
    if (/^\d+$/.test(raw)) {
      if (hasAny && (current > 0 || total > 0)) break; // stop mixing at digit
      return { value: raw, consumed: consumed + 1 };
    }
    // Convert Arabic-indic in-word
    const conv = raw.split("").map((c) => AR_DIGITS[c] ?? c).join("");
    if (/^\d+$/.test(conv)) {
      if (hasAny) break;
      return { value: conv, consumed: consumed + 1 };
    }

    const { word } = stripWa(raw);

    if (THOUSANDS[word] !== undefined) {
      if (current === 0) current = 1;
      total += current * (THOUSANDS[word] / 1000) * 1000;
      current = 0; hasAny = true; consumed++;
      continue;
    }
    if (word === "الاف" || word === "آلاف" || word === "الاف" || word === "ألاف") {
      if (current === 0) current = 1;
      total += current * 1000;
      current = 0; hasAny = true; consumed++;
      continue;
    }
    if (HUNDREDS[word] !== undefined) {
      total += HUNDREDS[word];
      hasAny = true; consumed++;
      continue;
    }
    if (TENS[word] !== undefined) {
      current += TENS[word];
      hasAny = true; consumed++;
      continue;
    }
    if (UNITS[word] !== undefined) {
      current += UNITS[word];
      hasAny = true; consumed++;
      continue;
    }
    // single digit word
    if (DIGIT_WORDS[word] !== undefined) {
      // sequence digit reading: "اثنين اثنين اثنين"
      let seq = DIGIT_WORDS[word];
      let j = i + 1;
      let localConsumed = 1;
      while (j < words.length && DIGIT_WORDS[stripWa(words[j]).word] !== undefined) {
        seq += DIGIT_WORDS[stripWa(words[j]).word];
        j++; localConsumed++;
      }
      if (seq.length >= 2) {
        // treat as digit sequence
        return { value: seq, consumed: consumed + localConsumed };
      }
      current += Number(seq);
      hasAny = true; consumed += localConsumed;
      i = j - 1;
      continue;
    }
    break;
  }

  if (!hasAny) return { value: "", consumed: 0 };
  total += current;
  return { value: String(total), consumed };
}

export interface DetectedPlate {
  raw: string;         // as extracted
  normalized: string;  // normalized for matching
  letters: string;
  digits: string;
  complete: boolean;   // 3 letters + 4 digits (Saudi standard)
}

/**
 * Extract plate candidates from a piece of Arabic transcript.
 * Detects plates like "ا ب ت 4222" or "أ ب ت اربعة آلاف ميتين اثنين وعشرين".
 */
export function extractPlates(text: string): DetectedPlate[] {
  if (!text) return [];
  const words = tokenize(text);
  const found: DetectedPlate[] = [];

  let i = 0;
  while (i < words.length) {
    // Try to collect up to 3-4 consecutive letters
    let letters = "";
    let j = i;
    while (j < words.length && letters.length < 4) {
      const raw = words[j];
      // Compact digit-in-arabic: e.g. "أب" (rare) — try char-by-char first
      const asChars = raw.split("");
      // If the whole word is arabic letters (no digits), map possibly full-name or char sequence
      if (/^[\u0621-\u064A]+$/.test(raw)) {
        // Full-name letter (e.g. "الف", "باء")
        if (LETTER_NAMES[raw] && letters.length < 4) {
          letters += LETTER_NAMES[raw];
          j++;
          continue;
        }
        // Char-sequence: e.g. "ابت" spoken as one word
        if (raw.length <= 4 && asChars.every((c) => PLATE_LETTERS.has(c))) {
          for (const c of asChars) {
            if (letters.length < 4) letters += (LETTER_MAP[c] ?? c);
          }
          j++;
          continue;
        }
      }
      break;
    }

    if (letters.length >= 2) {
      // Attempt to read digits next
      const { value, consumed } = parseArabicNumberRun(words, j);
      if (value && value.length >= 2 && value.length <= 5) {
        const digits = value.slice(0, 4);
        const normalized = normalizePlate(letters + digits);
        found.push({
          raw: `${letters}${digits}`,
          normalized,
          letters,
          digits,
          complete: letters.length === 3 && digits.length === 4,
        });
        i = j + consumed;
        continue;
      }
    }
    i++;
  }

  // Also handle already-formatted plates in the text like "باا7991"
  for (const w of words) {
    const norm = normalizePlate(w);
    const m = norm.match(/^([\u0621-\u064A]{2,4})(\d{2,5})$/);
    if (m) {
      const letters = m[1];
      const digits = m[2].slice(0, 4);
      const already = found.some((f) => f.normalized === normalizePlate(letters + digits));
      if (!already) {
        found.push({
          raw: `${letters}${digits}`,
          normalized: normalizePlate(letters + digits),
          letters,
          digits,
          complete: letters.length === 3 && digits.length === 4,
        });
      }
    }
  }

  return found;
}
