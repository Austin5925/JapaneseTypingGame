import { LONG_VOWEL_MARK, vowelOfPrev, VOWEL_TO_HIRAGANA, VOWEL_TO_KATAKANA } from './charTables';

export interface KanaNormalizeOptions {
  /**
   * Convert any katakana into hiragana before comparing. Default true; turn off when comparing
   * loan-word kana where script identity matters (e.g. `ビール` vs `びーる` are not the same
   * pack-time canonical even if they're phonologically equal).
   */
  katakanaToHiragana?: boolean;
  /**
   * Expand katakana long-vowel marks (ー) into the matching vowel of the preceding kana, then
   * (when katakanaToHiragana=true) convert the expanded form to hiragana. Without expansion,
   * `ビール` and `びいる` look unequal because `wanakana.toHiragana` keeps `ー` as-is.
   */
  expandLongVowel?: boolean;
  /** Convert half-width kana (ｱｲｳ etc.) to full-width before any other step. */
  normalizeHalfWidth?: boolean;
  /** Strip all whitespace (ASCII + ideographic). Off by default — comparison may want to keep it. */
  stripSpaces?: boolean;
  /**
   * Replace common JP punctuation that affects comparison: ideographic comma → ASCII, full-width
   * period → ASCII, etc. Default true; turn off when round-tripping pack content verbatim.
   */
  normalizePunctuation?: boolean;
}

const DEFAULT_OPTIONS: Required<KanaNormalizeOptions> = {
  katakanaToHiragana: true,
  expandLongVowel: false,
  normalizeHalfWidth: true,
  stripSpaces: false,
  normalizePunctuation: true,
};

/**
 * Normalise raw input from a user before any other processing. Trims, collapses whitespace
 * (configurable), maps full-width ASCII digits/letters to half-width. Runs even when the
 * downstream task is romaji input (digits in `123 hello` should not stay full-width).
 */
export function normalizeRawInput(input: string): string {
  if (!input) return '';
  let s = input.trim();
  // Full-width ASCII (０-９ A-Z a-z) → half-width.
  s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  // Ideographic space (U+3000) → ASCII space.
  s = s.replace(new RegExp('　', 'g'), ' ');
  return s;
}

/**
 * Normalise a kana string for comparison. See {@link KanaNormalizeOptions} for the knobs.
 *
 * NB: this is not a generic "make these strings equal" function — it deliberately preserves
 * the language-meaningful distinctions (long vowel, sokuon, dakuten, handakuten, youon).
 * Those differences are surfaced as ErrorTag values by the classifier, not silently erased.
 */
export function normalizeKana(input: string, options: KanaNormalizeOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (!input) return '';
  let s = input;

  if (opts.normalizeHalfWidth) {
    // Half-width katakana → full-width katakana via wanakana's full-width helpers, then plain
    // map for digits/letters in `normalizeRawInput`. wanakana doesn't ship a half-width-kana
    // expander, so we also handle the basic mapping below.
    s = halfWidthKanaToFullWidth(s);
  }

  if (opts.normalizePunctuation) {
    s = s.replace(/[、，]/g, '、').replace(/[。．]/g, '。');
  }

  if (opts.stripSpaces) {
    s = s.replace(/\s+/gu, '');
  }

  if (opts.expandLongVowel) {
    s = expandLongVowelMark(s);
  }

  if (opts.katakanaToHiragana) {
    // Inline conversion preserves ー and any other punctuation. We do NOT use
    // `wanakana.toHiragana` here because that helper also expands long-vowel marks
    // (`ビール` → `びいる`), which destroys the language-meaningful distinction the
    // classifier relies on. Use `expandLongVowel` explicitly when you want that.
    s = katakanaToHiraganaCharByChar(s);
  }

  return s;
}

// Katakana block U+30A1..U+30F6 maps to Hiragana U+3041..U+3096 (offset 0x60). Other
// characters (ー, the iteration marks, ASCII, kanji) pass through unchanged.
function katakanaToHiraganaCharByChar(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= 0x30a1 && code <= 0x30f6) {
      out += String.fromCharCode(code - 0x60);
    } else {
      out += ch;
    }
  }
  return out;
}

// Replace each `ー` with the corresponding vowel of the preceding kana, using the source's own
// script: `ビール` → `ビイル`, `びーる` → `びいる`. If the preceding char has no vowel
// (sokuon, ん, non-kana), drop the mark.
export function expandLongVowelMark(s: string): string {
  if (!s.includes(LONG_VOWEL_MARK)) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch !== LONG_VOWEL_MARK) {
      out += ch;
      continue;
    }
    const v = vowelOfPrev(s, i);
    if (!v) continue;
    const prev = s[i - 1]!;
    // Match the script of the preceding kana so `びーる` produces `びいる`, not `びイる`.
    const isKatakana = prev >= '゠' && prev <= 'ヿ';
    out += isKatakana ? VOWEL_TO_KATAKANA[v] : VOWEL_TO_HIRAGANA[v];
  }
  return out;
}

const HALF_KANA_TO_FULL: Readonly<Record<string, string>> = {
  ｱ: 'ア',
  ｲ: 'イ',
  ｳ: 'ウ',
  ｴ: 'エ',
  ｵ: 'オ',
  ｶ: 'カ',
  ｷ: 'キ',
  ｸ: 'ク',
  ｹ: 'ケ',
  ｺ: 'コ',
  ｻ: 'サ',
  ｼ: 'シ',
  ｽ: 'ス',
  ｾ: 'セ',
  ｿ: 'ソ',
  ﾀ: 'タ',
  ﾁ: 'チ',
  ﾂ: 'ツ',
  ﾃ: 'テ',
  ﾄ: 'ト',
  ﾅ: 'ナ',
  ﾆ: 'ニ',
  ﾇ: 'ヌ',
  ﾈ: 'ネ',
  ﾉ: 'ノ',
  ﾊ: 'ハ',
  ﾋ: 'ヒ',
  ﾌ: 'フ',
  ﾍ: 'ヘ',
  ﾎ: 'ホ',
  ﾏ: 'マ',
  ﾐ: 'ミ',
  ﾑ: 'ム',
  ﾒ: 'メ',
  ﾓ: 'モ',
  ﾔ: 'ヤ',
  ﾕ: 'ユ',
  ﾖ: 'ヨ',
  ﾗ: 'ラ',
  ﾘ: 'リ',
  ﾙ: 'ル',
  ﾚ: 'レ',
  ﾛ: 'ロ',
  ﾜ: 'ワ',
  ｦ: 'ヲ',
  ﾝ: 'ン',
  ｯ: 'ッ',
  ｬ: 'ャ',
  ｭ: 'ュ',
  ｮ: 'ョ',
  ｰ: 'ー',
};

function halfWidthKanaToFullWidth(s: string): string {
  if (!/[｡-ﾟ]/.test(s)) return s;
  return s.replace(/[｡-ﾟ]/g, (ch) => HALF_KANA_TO_FULL[ch] ?? ch);
}
