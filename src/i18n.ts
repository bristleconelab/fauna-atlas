// Interface language. The code holds English text: t('English text', ...values), where {0}, {1}… in the text stand
// for the values. Every other language is one file, src/locales/<code>.ts, mapping each English text to its
// translation; a text missing there shows in English.
//
// To add a language: copy src/locales/uz.ts to src/locales/<code>.ts (an ISO 639-1 code: ru, tr, kk…) and translate
// the right-hand side. Nothing else: the file is found at build time, the language joins the menu under its own
// name (Intl.DisplayNames), month names come from the browser, and species names and Wikipedia already follow the
// reader's language through Wikidata.
const files = import.meta.glob<{ default: Record<string, string> }>('./locales/*.ts');

/** Language codes the site has, English first. */
export const LANGS: string[] = ['en', ...Object.keys(files).map((p) => /\/([a-z]{2,3}(?:-[A-Za-z]+)?)\.ts$/.exec(p)?.[1]).filter((x): x is string => !!x).sort()];
export type Lang = string;

function pick(): Lang {
  try {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('lang') : null;
    if (saved && LANGS.includes(saved)) return saved;
  } catch { /* storage blocked: fall through */ }
  const wanted = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  for (const w of wanted) { const base = w.toLowerCase().split('-')[0]; if (LANGS.includes(base)) return base; }
  return 'en';
}

export const lang: Lang = pick();
const catalog: Record<string, string> = lang === 'en' ? {} : (await files[`./locales/${lang}.ts`]?.())?.default ?? {};

/** The text in the reader's language, with {0}, {1}… filled from `values`. */
export function t(text: string, ...values: unknown[]): string {
  const s = catalog[text] ?? text;
  return values.length ? s.replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)] ?? '')) : s;
}
/** "1 record" / "3 records" in English; one form in languages that do not mark the plural after a number. */
export const tn = (n: number, one: string, many: string) => t(n === 1 ? one : many, n.toLocaleString('en-US'));

export function setLang(l: Lang) {
  try { localStorage.setItem('lang', l); } catch { /* ignore */ }
  location.reload();
}

/** A language's name in that language ("Oʻzbekcha", "Русский"), from the browser. */
export function languageName(code: string): string {
  try {
    const n = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
    return n.charAt(0).toLocaleUpperCase(code) + n.slice(1);
  } catch { return code; }
}

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Month names in the reader's language (January = 0): from the browser, or from the catalog where the browser has
 *  none (Chrome answers "M01" for Uzbek). */
export const MONTHS: string[] = EN_MONTHS.map((en, i) => {
  const m = new Intl.DateTimeFormat(lang, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2020, i, 15)));
  if (/^M\d{2}$/.test(m) || /^\d+$/.test(m)) return t(en);
  return m.charAt(0).toLocaleUpperCase(lang) + m.slice(1);
});
