// Interface language: English or Uzbek (Latin). Each text sits where it is used as a pair, L('English', 'Oʻzbekcha'),
// so the two never drift apart. The choice is kept in localStorage; the first visit follows the browser.

export type Lang = 'en' | 'uz';

function pick(): Lang {
  try {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('lang') : null;
    if (saved === 'en' || saved === 'uz') return saved;
  } catch { /* storage blocked: fall through */ }
  const nav = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'en';
  return nav.startsWith('uz') ? 'uz' : 'en';
}

export const lang: Lang = pick();
export const L = (en: string, uz: string): string => (lang === 'uz' ? uz : en);

export function setLang(l: Lang) {
  try { localStorage.setItem('lang', l); } catch { /* ignore */ }
  location.reload();
}

const fmtN = (n: number) => n.toLocaleString('en-US');
/** "3 species" / "3 ta tur": Uzbek nouns stay singular after a number. */
export const count = (n: number, en: string, enMany: string, uz: string) => L(`${fmtN(n)} ${n === 1 ? en : enMany}`, `${fmtN(n)} ta ${uz}`);

export const IUCN_UZ: Record<string, string> = {
  EX: 'Yoʻq boʻlib ketgan', EW: 'Tabiatda yoʻq boʻlib ketgan', CR: 'Yoʻqolish arafasida', EN: 'Yoʻqolib borayotgan',
  VU: 'Zaif', NT: 'Xavf ostiga yaqin', LC: 'Xavf ostida emas', DD: 'Maʼlumot yetarli emas',
};

export const MONTHS_UZ = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
