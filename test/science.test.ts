import { describe, expect, it } from 'vitest';
import { chao1, formatLength, formatMass, overlap, parseTraits, rangeShift, toCsv } from '../src/science';
import { geohashBounds } from '../src/geo';

const W = (id: string) => ({ value: `http://www.wikidata.org/entity/${id}` });
const V = (v: number) => ({ value: String(v) });

describe('Chao1', () => {
  // 20 species: 6 recorded once, 4 twice, 10 fifty times; n = 514. Worked by hand (Chao 2005 variance, log-normal CI,
  // Chao & Jost 2012 coverage): estimate 22.994, 95 % 20.50-37.92, coverage 0.9884.
  const r = chao1([...Array(6).fill(1), ...Array(4).fill(2), ...Array(10).fill(50)])!;
  it('matches the bias-corrected estimate, its interval and the sample coverage', () => {
    expect(r.estimate).toBeCloseTo(22.994, 3);
    expect(r.lower).toBeCloseTo(20.50, 2);
    expect(r.upper).toBeCloseTo(37.92, 1);
    expect(r.coverage).toBeCloseTo(0.9884, 4);
    expect(r.completeness).toBeCloseTo(20 / 22.994, 3);
    expect([r.f1, r.f2, r.n]).toEqual([6, 4, 514]);
  });
  it('says nothing about tiny lists, and is exact when no species is a singleton', () => {
    expect(chao1([1, 1, 2])).toBeNull();
    const full = chao1(Array(12).fill(5))!;
    expect([full.estimate, full.lower, full.upper, full.coverage]).toEqual([12, 12, 12, 1]);
  });
  it('stays finite with singletons and no doubletons', () => {
    const x = chao1(Array(25).fill(1))!;
    expect(Number.isFinite(x.estimate) && Number.isFinite(x.upper)).toBe(true);
    expect(x.estimate).toBeCloseTo(25 + (24 / 25) * (25 * 24) / 2);
    expect(x.coverage).toBeLessThan(0.1);
  });
});

describe('traits', () => {
  it('converts units and keeps the largest value (real humpback rows from Wikidata, 2026-11-26)', () => {
    const t = parseTraits([
      { massAmt: V(45), massUnit: W('Q191118'), lenAmt: V(16), lenUnit: W('Q11573'), lifeAmt: V(47.5), lifeUnit: W('Q577') },
      { massAmt: V(1.5), massUnit: W('Q191118'), lenAmt: V(4.5), lenUnit: W('Q11573') },
    ]);
    expect(t).toEqual({ massKg: 45000, lengthM: 16, lifeYears: 47.5 });
    expect(parseTraits([{ lenAmt: V(46), lenUnit: W('Q3710') }]).lengthM).toBeCloseTo(14.02, 2); // whale shark, feet
    expect(parseTraits([{ massAmt: V(3), massUnit: W('Q999999') }])).toEqual({}); // unknown unit: skipped
  });
  it('formats sizes readably', () => {
    expect(formatMass(45000)).toBe('45 t'); expect(formatMass(0.35)).toBe('350 g'); expect(formatMass(12.34)).toBe('12.3 kg');
    expect(formatLength(16)).toBe('16 m'); expect(formatLength(0.42)).toBe('42 cm'); expect(formatLength(0.004)).toBe('4 mm');
  });
});

describe('ranges', () => {
  const cell = (gh: string) => ({ bbox: geohashBounds(gh), n: 1 });
  const ring = (lat0: number) => Array.from({ length: 20 }, (_, i) => ({ bbox: { west: i * 2, east: i * 2 + 1.4, south: lat0, north: lat0 + 1.4 }, n: 3 }));
  it('measures a move away from the equator by squares, not records', () => {
    const r = rangeShift(ring(30), ring(33))!;
    expect(r.shiftKm).toBeGreaterThan(320); expect(r.shiftKm).toBeLessThan(345);
    expect(rangeShift(ring(30).slice(0, 5), ring(33))).toBeNull();
  });
  it('finds shared squares and their area', () => {
    const o = overlap([cell('s00'), cell('s01')], [cell('s01'), cell('s02')]);
    expect(o.shared).toBe(1); expect(o.onlyA).toBe(1); expect(o.onlyB).toBe(1);
    expect(o.sharedKm2).toBeGreaterThan(24000);
  });
});

describe('csv', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(toCsv([['a', 'b,c', 'say "hi"', null, 3]])).toBe('a,"b,c","say ""hi""",,3\r\n');
  });
});

describe('formatLife', () => {
  it('gives short lives in months, never "0 years"', async () => {
    const { formatLife } = await import('../src/science');
    expect(formatLife(0.25, 'en')).toBe('3 months');
    expect(formatLife(0.02, 'en')).toBe('1 month');
    expect(formatLife(1.2, 'en')).toBe('1 year');
    expect(formatLife(47.5, 'en')).toBe('48 years');
    expect(formatLife(0.5, 'uz')).toBe('6 oy');
  });
});
