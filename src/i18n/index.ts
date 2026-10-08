import en from './en.json';
import zh from './zh.json';
import zhTW from './zh-TW.json';
import es from './es.json';
import fr from './fr.json';
import de from './de.json';
import ja from './ja.json';
import ko from './ko.json';
import pt from './pt.json';
import ru from './ru.json';
import ar from './ar.json';
import hi from './hi.json';
import it from './it.json';
import nl from './nl.json';
import pl from './pl.json';
import tr from './tr.json';
import vi from './vi.json';
import th from './th.json';
import id from './id.json';
import ms from './ms.json';
import sv from './sv.json';
import da from './da.json';
import no from './no.json';
import fi from './fi.json';
import el from './el.json';
import cs from './cs.json';
import ro from './ro.json';
import hu from './hu.json';
import uk from './uk.json';
import bg from './bg.json';
import hr from './hr.json';
import sk from './sk.json';
import sl from './sl.json';
import sr from './sr.json';
import lt from './lt.json';
import lv from './lv.json';
import et from './et.json';
import he from './he.json';
import fa from './fa.json';
import bn from './bn.json';
import fil from './fil.json';

export const LOCALES = [
  'en', 'zh', 'zh-TW', 'es', 'fr', 'de', 'ja', 'ko', 'pt', 'ru', 'ar',
  'hi', 'it', 'nl', 'pl', 'tr', 'vi', 'th', 'id', 'ms', 'sv',
  'da', 'no', 'fi', 'el', 'cs', 'ro', 'hu', 'uk', 'bg', 'hr',
  'sk', 'sl', 'sr', 'lt', 'lv', 'et', 'he', 'fa', 'bn', 'fil',
] as const;

export type Locale = typeof LOCALES[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const RTL_LOCALES = new Set<Locale>(['ar', 'he', 'fa']);

/** English name for each locale — used when an LLM needs an unambiguous language label. */
export const LOCALE_ENGLISH_NAMES: Record<Locale, string> = {
  en: 'English',
  zh: 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
  ko: 'Korean',
  pt: 'Portuguese',
  ru: 'Russian',
  ar: 'Arabic',
  hi: 'Hindi',
  it: 'Italian',
  nl: 'Dutch',
  pl: 'Polish',
  tr: 'Turkish',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian',
  ms: 'Malay',
  sv: 'Swedish',
  da: 'Danish',
  no: 'Norwegian',
  fi: 'Finnish',
  el: 'Greek',
  cs: 'Czech',
  ro: 'Romanian',
  hu: 'Hungarian',
  uk: 'Ukrainian',
  bg: 'Bulgarian',
  hr: 'Croatian',
  sk: 'Slovak',
  sl: 'Slovenian',
  sr: 'Serbian',
  lt: 'Lithuanian',
  lv: 'Latvian',
  et: 'Estonian',
  he: 'Hebrew',
  fa: 'Persian',
  bn: 'Bengali',
  fil: 'Filipino',
};

/** Native name for each locale — what to show in the language switcher. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  zh: '简体中文',
  'zh-TW': '繁體中文',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  ja: '日本語',
  ko: '한국어',
  pt: 'Português',
  ru: 'Русский',
  ar: 'العربية',
  hi: 'हिन्दी',
  it: 'Italiano',
  nl: 'Nederlands',
  pl: 'Polski',
  tr: 'Türkçe',
  vi: 'Tiếng Việt',
  th: 'ไทย',
  id: 'Bahasa Indonesia',
  ms: 'Bahasa Melayu',
  sv: 'Svenska',
  da: 'Dansk',
  no: 'Norsk',
  fi: 'Suomi',
  el: 'Ελληνικά',
  cs: 'Čeština',
  ro: 'Română',
  hu: 'Magyar',
  uk: 'Українська',
  bg: 'Български',
  hr: 'Hrvatski',
  sk: 'Slovenčina',
  sl: 'Slovenščina',
  sr: 'Српски',
  lt: 'Lietuvių',
  lv: 'Latviešu',
  et: 'Eesti',
  he: 'עברית',
  fa: 'فارسی',
  bn: 'বাংলা',
  fil: 'Filipino',
};

const messages: Record<Locale, unknown> = {
  en, zh, 'zh-TW': zhTW, es, fr, de, ja, ko, pt, ru, ar,
  hi, it, nl, pl, tr, vi, th, id, ms, sv,
  da, no, fi, el, cs, ro, hu, uk, bg, hr,
  sk, sl, sr, lt, lv, et, he, fa, bn, fil,
};

function lookup(dict: unknown, key: string): string | undefined {
  const parts = key.split('.');
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Returns a `t(key)` function that looks up dotted paths in the locale's JSON.
 * Falls back to the default locale (English), then to the key itself.
 */
export function useTranslations(locale: string | undefined) {
  const safe = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const dict = messages[safe];
  const fallback = messages[DEFAULT_LOCALE];
  return function t(key: string): string {
    return lookup(dict, key) ?? lookup(fallback, key) ?? key;
  };
}

const LOCALE_STORAGE_KEY = 'ebook-translator:locale';

/** Map a BCP-47 tag from the browser (e.g. zh-Hant-TW, pt-BR) onto one of our locales. */
function matchBrowserLocale(tag: string): Locale | undefined {
  const lower = tag.toLowerCase();
  if (lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo' || lower.includes('hant')) return 'zh-TW';
  if (lower.startsWith('zh')) return 'zh';
  if (lower === 'nb' || lower === 'nn' || lower.startsWith('nb-') || lower.startsWith('nn-')) return 'no';
  if (lower === 'tl' || lower.startsWith('tl-')) return 'fil';
  const base = lower.split('-')[0];
  return (LOCALES as readonly string[]).includes(base) ? (base as Locale) : undefined;
}

/**
 * Resolve the UI locale: `?lang=` query, then saved preference, then browser languages, then English.
 */
export function detectLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  const fromQuery = new URLSearchParams(window.location.search).get('lang');
  if (isLocale(fromQuery)) return fromQuery;
  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch { /* storage unavailable */ }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const m = matchBrowserLocale(tag);
    if (m) return m;
  }
  return DEFAULT_LOCALE;
}

export function persistLocale(locale: Locale): void {
  try { window.localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* ignore */ }
}
