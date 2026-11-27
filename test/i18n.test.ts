import { describe, expect, it } from 'vitest';
import { LANGS, MONTHS, languageName, t, tn } from '../src/i18n';
import uz from '../src/locales/uz';
import { readFileSync, readdirSync } from 'node:fs';

describe('interface languages', () => {
  it('finds every catalog in src/locales by itself, English first', () => {
    expect(LANGS[0]).toBe('en');
    expect(LANGS).toEqual(['en', ...readdirSync('src/locales').map((f) => f.replace(/\.ts$/, '')).sort()]);
  });
  it('fills {0}, {1} from the values and falls back to the English text', () => {
    expect(t('{0}, {1}', 'a', 'b')).toBe('a, b');
    expect(t('A text no catalog has')).toBe('A text no catalog has');
    expect(tn(1, '{0} record', '{0} records')).toBe('1 record');
    expect(tn(2400, '{0} record', '{0} records')).toBe('2,400 records');
  });
  it('names languages in their own language and months from the browser', () => {
    expect(languageName('uz').toLowerCase()).toContain('o');
    expect(MONTHS).toHaveLength(12);
  });
  it('the Uzbek catalog has a translation for every key', () => {
    for (const [en, tr] of Object.entries(uz)) expect(tr.trim().length, en).toBeGreaterThan(0);
  });
  it('every translation uses the same {0}, {1}… placeholders as its English text', () => {
    const marks = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const [en, tr] of Object.entries(uz)) expect(marks(tr), en).toBe(marks(en));
  });
  it('every t(...) call in the code passes exactly as many values as its text has placeholders', () => {
    const bad: string[] = [];
    for (const f of readdirSync('src').filter((x) => x.endsWith('.ts') && x !== 'i18n.ts')) {
      const s = readFileSync(`src/${f}`, 'utf8');
      for (const m of s.matchAll(/(?<![\w.])(?:t|tx)\('((?:[^'\\]|\\.)*)'/g)) {
        let i = m.index! + m[0].length, depth = 1, args = 0, q = '';
        for (; i < s.length && depth; i++) {
          const c = s[i];
          if (q) { if (c === '\\') i++; else if (c === q) q = ''; }
          else if (`'"\``.includes(c)) q = c;
          else if ('([{'.includes(c)) depth++;
          else if (')]}'.includes(c)) depth--;
          else if (c === ',' && depth === 1) args++;
        }
        const need = Math.max(-1, ...[...m[1].matchAll(/\{(\d+)\}/g)].map((x) => Number(x[1]))) + 1;
        if (args !== need) bad.push(`${f}: ${m[1].slice(0, 60)} (${args} values, ${need} placeholders)`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('every t(...) text in the code that has an Uzbek translation in the old pairs is still in the catalog', () => {
    const src = readdirSync('src').filter((f) => f.endsWith('.ts')).map((f) => readFileSync(`src/${f}`, 'utf8')).join('\n');
    expect(src).not.toMatch(/(?<![\w.$])L\(/); // the old L('en', 'uz') pairs are gone
    expect(Object.keys(uz).length).toBeGreaterThan(200);
  });
});
