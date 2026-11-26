// Kinds of animals a non-specialist recognises (as GBIF backbone keys), the vertical zones from the deep sea to the
// mountain tops, and small summaries. Pure (test/taxa.test.ts).
import { lang } from './i18n';

/** A species recorded somewhere: its GBIF key, records there, and the kind of animal it is. */
export interface Taxon {
  key: number;
  records: number;
  group: GroupId;
  scientificName?: string;
  category?: string; // IUCN Red List code
}

export type GroupId =
  | 'mammals' | 'birds' | 'reptiles' | 'amphibians' | 'fish' | 'sharks' | 'insects' | 'spiders' | 'crustaceans'
  | 'molluscs' | 'corals' | 'echinoderms' | 'worms' | 'other';

type Filter = Record<string, (string | number)[]>;
/** In this order on the chips and in the mixed view. `gbif` is the occurrence-search filter for the group
 *  (GBIF backbone keys, checked 2026-11-26: the backbone has no class Reptilia, so its three orders-as-classes). */
export const GROUPS: { id: GroupId; label: string; uz: string; gbif?: Filter }[] = [
  { id: 'mammals', label: 'Mammals', uz: 'Sutemizuvchilar', gbif: { classKey: [359] } },
  { id: 'birds', label: 'Birds', uz: 'Qushlar', gbif: { classKey: [212] } },
  { id: 'reptiles', label: 'Reptiles', uz: 'Sudralib yuruvchilar', gbif: { classKey: [11592253, 11418114, 11493978] } },
  { id: 'amphibians', label: 'Frogs, toads and salamanders', uz: 'Baqalar va salamandralar', gbif: { classKey: [131] } },
  { id: 'fish', label: 'Fish', uz: 'Baliqlar', gbif: { classKey: [204, 238, 119, 11881065] } },
  { id: 'sharks', label: 'Sharks and rays', uz: 'Akulalar va skatlar', gbif: { classKey: [121, 120] } },
  { id: 'insects', label: 'Insects', uz: 'Hasharotlar', gbif: { classKey: [216] } },
  { id: 'spiders', label: 'Spiders, scorpions and mites', uz: 'Oʻrgimchaklar, chayonlar va kanalar', gbif: { classKey: [367] } },
  { id: 'crustaceans', label: 'Crabs, shrimp and woodlice', uz: 'Qisqichbaqalar, krevetkalar va zaxkashlar', gbif: { classKey: [229] } },
  { id: 'molluscs', label: 'Snails, shells, squid and octopus', uz: 'Shilliqqurtlar, chigʻanoqlar, kalmarlar va sakkizoyoqlar', gbif: { phylumKey: [52] } },
  { id: 'corals', label: 'Corals and jellyfish', uz: 'Marjonlar va meduzalar', gbif: { phylumKey: [43] } },
  { id: 'echinoderms', label: 'Starfish and urchins', uz: 'Dengiz yulduzlari va tipratikanlari', gbif: { phylumKey: [50] } },
  { id: 'worms', label: 'Earthworms, leeches and sea worms', uz: 'Yomgʻir chuvalchanglari, zuluklar va dengiz chuvalchanglari', gbif: { phylumKey: [42] } },
  { id: 'other', label: 'Everything else', uz: 'Boshqalar' },
];
export const GROUP_LABEL: Record<GroupId, string> = Object.fromEntries(GROUPS.map((g) => [g.id, lang === 'uz' ? g.uz : g.label])) as Record<GroupId, string>;

/** Group of a GBIF species record from its class and phylum keys (for search hits and species pages). */
export function groupOfKeys(classKey?: number, phylumKey?: number): GroupId {
  for (const g of GROUPS) {
    if (!g.gbif) continue;
    if (classKey != null && g.gbif.classKey?.includes(classKey)) return g.id;
    if (phylumKey != null && g.gbif.phylumKey?.includes(phylumKey)) return g.id;
  }
  return 'other';
}

export const IUCN_LABEL: Record<string, string> = lang === 'uz' ? {
  EX: 'Yoʻq boʻlib ketgan', EW: 'Tabiatda yoʻq boʻlib ketgan', CR: 'Yoʻqolish arafasida', EN: 'Yoʻqolib borayotgan',
  VU: 'Zaif', NT: 'Xavf ostiga yaqin', LC: 'Xavf ostida emas', DD: 'Maʼlumot yetarli emas',
} : {
  EX: 'Extinct', EW: 'Extinct in the wild', CR: 'Critically endangered', EN: 'Endangered', VU: 'Vulnerable',
  NT: 'Near threatened', LC: 'Least concern', DD: 'Data deficient',
};
export const THREATENED = new Set(['CR', 'EN', 'VU']);

/** Most-recorded first, ties by key (stable output for the same input). */
export function rankSpecies<T extends Taxon>(list: T[]): T[] {
  return [...list].sort((a, b) => b.records - a.records || a.key - b.key);
}

export function countByGroup(list: Taxon[]): Map<GroupId, number> {
  const m = new Map<GroupId, number>();
  for (const t of list) m.set(t.group, (m.get(t.group) ?? 0) + 1);
  return m;
}

/** Groups whose members few people know by sight: they take a turn only every third round while others are left. */
const QUIET = new Set<GroupId>(['insects', 'spiders', 'worms', 'other']);

/** Round-robin across groups in the GROUPS order, each group most-recorded first, so a first screen in the Amazon
 *  is not 36 beetles nor 36 birds. */
export function interleaveGroups<T extends Taxon>(ranked: T[]): T[] {
  const by = new Map<GroupId, T[]>();
  for (const t of ranked) { if (!by.has(t.group)) by.set(t.group, []); by.get(t.group)!.push(t); }
  const queues = GROUPS.map((g) => ({ id: g.id, q: by.get(g.id) ?? [], i: 0 })).filter((x) => x.q.length);
  const out: T[] = [];
  for (let round = 0; out.length < ranked.length; round++) {
    const loud = queues.some((x) => !QUIET.has(x.id) && x.i < x.q.length);
    for (const x of queues) {
      if (x.i >= x.q.length) continue;
      if (QUIET.has(x.id) && loud && round % 3 !== 0) continue;
      out.push(x.q[x.i++]);
    }
  }
  return out;
}

/** A histogram bin of values in [from, to). */
export interface Bin { from: number; to: number; records: number }

/** Record-weighted quantile inside explicit bins, interpolated linearly. */
export function binnedQuantile(bins: Bin[], q: number): number | null {
  const s = bins.filter((b) => b.records > 0).sort((a, b) => a.from - b.from);
  const total = s.reduce((t, b) => t + b.records, 0);
  if (!total) return null;
  const target = Math.min(1, Math.max(0, q)) * total;
  let acc = 0;
  for (const b of s) {
    if (acc + b.records >= target) return b.from + ((target - acc) / b.records) * (b.to - b.from);
    acc += b.records;
  }
  return s[s.length - 1].to;
}

/** The living Earth from the deepest trench to the highest peaks, in metres above (+) or below (-) sea level.
 *  Each zone is one GBIF count: `depth` for the sea, `elevation` for land. */
export const ZONES: { from: number; to: number; en: string; uz: string; param: 'depth' | 'elevation'; range: [number, number] }[] = [
  { from: 4500, to: 9000, en: 'Above 4,500 m, high mountains', uz: '4 500 m dan yuqori, baland togʻlar', param: 'elevation', range: [4500, 9000] },
  { from: 3000, to: 4500, en: '3,000–4,500 m', uz: '3 000–4 500 m', param: 'elevation', range: [3000, 4500] },
  { from: 2000, to: 3000, en: '2,000–3,000 m', uz: '2 000–3 000 m', param: 'elevation', range: [2000, 3000] },
  { from: 1000, to: 2000, en: '1,000–2,000 m, hills and plateaus', uz: '1 000–2 000 m, adirlar va platolar', param: 'elevation', range: [1000, 2000] },
  { from: 0, to: 1000, en: '0–1,000 m, lowlands', uz: '0–1 000 m, pasttekisliklar', param: 'elevation', range: [0, 1000] },
  // from 0.5 m: many land datasets fill depth = 0, which would put elephants in the sea
  { from: -200, to: 0, en: 'Sea, 0–200 m, sunlit', uz: 'Dengiz, 0–200 m, yorugʻ qatlam', param: 'depth', range: [0.5, 200] },
  { from: -1000, to: -200, en: 'Sea, 200–1,000 m, twilight', uz: 'Dengiz, 200–1 000 m, gʻira-shira', param: 'depth', range: [200, 1000] },
  { from: -4000, to: -1000, en: 'Sea, 1–4 km, midnight', uz: 'Dengiz, 1–4 km, yarim tun', param: 'depth', range: [1000, 4000] },
  { from: -11000, to: -4000, en: 'Sea, below 4 km, abyss', uz: 'Dengiz, 4 km dan pastda, tubsizlik', param: 'depth', range: [4000, 11000] },
];

/** "Usually between 200 and 1,800 m above sea level": the middle half of records with a height or depth. */
export function verticalRange(counts: number[]): { from: number; to: number; records: number } | null {
  const bins: Bin[] = ZONES.map((z, i) => ({ from: z.from, to: z.to, records: counts[i] ?? 0 }));
  const records = bins.reduce((t, b) => t + b.records, 0);
  const lo = binnedQuantile(bins, 0.25), hi = binnedQuantile(bins, 0.75);
  if (lo == null || hi == null || records < 10) return null;
  const r = (v: number) => (Math.abs(v) < 100 ? Math.round(v / 5) * 5 : Math.abs(v) < 1000 ? Math.round(v / 10) * 10 : Math.round(v / 100) * 100);
  return { from: r(lo), to: r(hi), records };
}
