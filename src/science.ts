// Small pieces of science the panel shows: how complete a species list is likely to be, body size and lifespan from
// Wikidata, whether a range has moved, and how two ranges overlap. Pure (test/science.test.ts).
import { cellAreaKm2, type BBox } from './geo';
import { tn } from './i18n';

export interface Chao1 {
  observed: number; n: number; f1: number; f2: number;
  /** bias-corrected Chao1: a lower bound for the number of species, not a total */
  estimate: number; lower: number; upper: number;
  /** observed / estimate */
  completeness: number;
  /** Chao & Jost (2012) sample coverage: share of the records' "individuals" that belong to species already found */
  coverage: number;
}

/** Bias-corrected Chao1 from records per species (Chao 1987; Chao 2005; Chao & Jost 2012), with
 *    estimate = S_obs + ((n-1)/n) f1 (f1-1) / (2 (f2+1)),
 *    its variance (Chao 2005, bias-corrected form) and the log-normal 95 % interval
 *    [S_obs + T/K, S_obs + T K], T = estimate - S_obs, K = exp(1.96 sqrt(ln(1 + var/T^2))),
 *    sample coverage C = 1 - (f1/n) ((n-1) f1 / ((n-1) f1 + 2 f2))   (f2 = 0: f1-1 and 2 in place of f1 and 2 f2).
 *  f1 = species recorded once, f2 = twice, n = records. Records stand in for individuals (records of one sighting
 *  cluster), so read it as an index of how well a place is known. Only meaningful within one kind of animal: mixing
 *  well-watched birds with barely-watched insects lets the birds hide the insects' gap. Pure (test/science.test.ts). */
export function chao1(records: number[], minSpecies = 10): Chao1 | null {
  const counts = records.filter((x) => x > 0);
  const observed = counts.length;
  if (observed < minSpecies) return null;
  let f1 = 0, f2 = 0, n = 0;
  for (const x of counts) { n += x; if (x === 1) f1++; else if (x === 2) f2++; }
  const A = (n - 1) / n;
  const T = (A * f1 * (f1 - 1)) / (2 * (f2 + 1));
  const estimate = observed + T;
  const v = A * f1 * (f1 - 1) / (2 * (f2 + 1)) + (A * A * f1 * (2 * f1 - 1) ** 2) / (4 * (f2 + 1) ** 2) + (A * A * f1 * f1 * f2 * (f1 - 1) ** 2) / (4 * (f2 + 1) ** 4);
  let lower = observed, upper = observed;
  if (T > 0) {
    const K = Math.exp(1.96 * Math.sqrt(Math.log(1 + v / (T * T))));
    lower = observed + T / K; upper = observed + T * K;
  }
  const coverage = f1 === 0 ? 1 : f2 > 0
    ? 1 - (f1 / n) * (((n - 1) * f1) / ((n - 1) * f1 + 2 * f2))
    : 1 - (f1 / n) * (((n - 1) * (f1 - 1)) / ((n - 1) * (f1 - 1) + 2));
  return { observed, n, f1, f2, estimate, lower, upper, completeness: observed / estimate, coverage };
}

/** "8 months" / "3 years" / "1 year": short lives in months, so a mayfly does not live "0 years". Callers that run
 *  without the interface (tests) get English. */
export function formatLife(years: number): string {
  if (years < 1) { const m = Math.max(1, Math.round(years * 12)); return tn(m, '{0} month', '{0} months'); }
  const y = Math.round(years);
  return tn(y, '{0} year', '{0} years');
}

// ---------- body size and lifespan from Wikidata quantities ----------
const Q = (id: string) => `http://www.wikidata.org/entity/${id}`;
const MASS_KG: Record<string, number> = { [Q('Q11570')]: 1, [Q('Q191118')]: 1000, [Q('Q41803')]: 0.001, [Q('Q100995')]: 0.45359237 };
const LENGTH_M: Record<string, number> = { [Q('Q11573')]: 1, [Q('Q174728')]: 0.01, [Q('Q174789')]: 0.001, [Q('Q3710')]: 0.3048, [Q('Q218593')]: 0.0254, [Q('Q828224')]: 1000 };
const TIME_YEARS: Record<string, number> = { [Q('Q577')]: 1, [Q('Q573')]: 1 / 365.25, [Q('Q5151')]: 1 / 12, [Q('Q23387')]: 7 / 365.25 };

export interface Traits { massKg?: number; lengthM?: number; lifeYears?: number }

/** Largest value of each quantity, in SI units. Wikidata often holds several values (adult, record, average); the
 *  largest is what "up to" means, and unknown units are skipped rather than guessed. */
export function parseTraits(rows: Record<string, { value: string } | undefined>[]): Traits {
  const best = (amt: string, unit: string, table: Record<string, number>) =>
    rows.reduce<number | undefined>((m, r) => {
      const a = Number(r[amt]?.value), f = table[r[unit]?.value ?? ''];
      if (!Number.isFinite(a) || !Number.isFinite(f) || a <= 0) return m;
      const v = a * f;
      return m == null || v > m ? v : m;
    }, undefined);
  const out: Traits = {};
  const m = best('massAmt', 'massUnit', MASS_KG), l = best('lenAmt', 'lenUnit', LENGTH_M), y = best('lifeAmt', 'lifeUnit', TIME_YEARS);
  if (m != null) out.massKg = m;
  if (l != null) out.lengthM = l;
  if (y != null) out.lifeYears = y;
  return out;
}

const round2 = (v: number) => (v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100);
export function formatMass(kg: number): string {
  if (kg >= 1000) return `${round2(kg / 1000).toLocaleString('en-US')} t`;
  if (kg >= 1) return `${round2(kg).toLocaleString('en-US')} kg`;
  return `${round2(kg * 1000).toLocaleString('en-US')} g`;
}
export function formatLength(m: number): string {
  if (m >= 1) return `${round2(m).toLocaleString('en-US')} m`;
  if (m >= 0.01) return `${round2(m * 100).toLocaleString('en-US')} cm`;
  return `${round2(m * 1000).toLocaleString('en-US')} mm`;
}

// ---------- range then and now ----------
export interface Cell { bbox: BBox; n: number }

/** Average distance from the equator of the squares where a species was recorded in two periods. Squares, not
 *  records, so a period with more surveys does not pull the answer towards where the surveys were. */
export function rangeShift(then: Cell[], now: Cell[], minCells = 15): { thenLat: number; nowLat: number; shiftKm: number; thenCells: number; nowCells: number } | null {
  if (then.length < minCells || now.length < minCells) return null;
  const meanAbsLat = (cs: Cell[]) => cs.reduce((s, c) => s + Math.abs((c.bbox.south + c.bbox.north) / 2), 0) / cs.length;
  const t = meanAbsLat(then), n = meanAbsLat(now);
  return { thenLat: t, nowLat: n, shiftKm: Math.round((n - t) * 111.2), thenCells: then.length, nowCells: now.length };
}

// ---------- two ranges ----------
const key = (b: BBox) => `${b.west.toFixed(3)},${b.south.toFixed(3)}`;

/** Squares and area shared by two ranges on the same grid. */
export function overlap(a: Cell[], b: Cell[]): { shared: number; onlyA: number; onlyB: number; sharedKm2: number; sharedKeys: Set<string> } {
  const kb = new Map(b.map((c) => [key(c.bbox), c]));
  const sharedKeys = new Set<string>();
  let sharedKm2 = 0;
  for (const c of a) { const k = key(c.bbox); if (kb.has(k)) { sharedKeys.add(k); sharedKm2 += cellAreaKm2(c.bbox); } }
  return { shared: sharedKeys.size, onlyA: a.length - sharedKeys.size, onlyB: b.length - sharedKeys.size, sharedKm2: Math.round(sharedKm2), sharedKeys };
}
export const cellKey = key;

/** Cells from an OBIS/GBIF grid answer. */
export function cellsOf(fc: GeoJSON.FeatureCollection<GeoJSON.Polygon, { n: number }>): Cell[] {
  return fc.features.map((f) => {
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (const [x, y] of f.geometry.coordinates[0]) { west = Math.min(west, x); east = Math.max(east, x); south = Math.min(south, y); north = Math.max(north, y); }
    return { bbox: { west, east, south, north }, n: f.properties.n };
  });
}

// ---------- export ----------
/** RFC 4180 CSV: quote fields with commas, quotes or line breaks. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const f = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(f).join(',')).join('\r\n') + '\r\n';
}

/** The bounds of cell (gx, gy) of an n x n Web Mercator grid over the world (gy = 0 at the north edge, 85.05 deg). */
export function mercatorCell(gx: number, gy: number, n: number): BBox {
  const lat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { west: (gx / n) * 360 - 180, east: ((gx + 1) / n) * 360 - 180, north: lat(gy), south: lat(gy + 1) };
}

/** Areas of two ranges given as sets of grid cells, and how much of them they share (Jaccard: shared / either). */
export function rangeOverlap(a: Cell[], b: Cell[]): { aKm2: number; bKm2: number; sharedKm2: number; jaccard: number; shared: number } {
  const km2 = (cs: Cell[]) => Math.round(cs.reduce((t, c) => t + cellAreaKm2(c.bbox), 0));
  const o = overlap(a, b);
  const aKm2 = km2(a), bKm2 = km2(b);
  const either = aKm2 + bKm2 - o.sharedKm2;
  return { aKm2, bKm2, sharedKm2: o.sharedKm2, jaccard: either ? o.sharedKm2 / either : 0, shared: o.shared };
}
