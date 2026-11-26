// Kinds of animals a non-specialist recognises (as GBIF backbone keys), the vertical zones from the deep sea to the
// mountain tops, and small summaries. Pure (test/taxa.test.ts).
import { lang } from './i18n.ts';

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
/** Ray-finned fish orders that sit straight under phylum Chordata in the GBIF backbone: it has a class Actinopterygii
 *  (key 204) but no record points to it (checked 2026-11-26: 0 records with classKey 204; carp is Chordata >
 *  Cypriniformes). These 46 orders hold ~143 million records; without them most fish fell into "Everything else". */
export const FISH_ORDERS = [
  587, 549, 590, 1153, 538, 588, 1313, 495, 708, 772, 1103, 537, 499, 1068, 547, 1067, 550, 773, 496, 1306, 497, 548, 498,
  1162, 1305, 1308, 774, 1106, 1167, 888, 1163, 1165, 1069, 1307, 1310, 890, 1104, 889, 494, 1166, 1164, 1312, 1311, 589,
  1107, 1105,
];
/** In this order on the chips and in the mixed view. `gbif` is the occurrence-search filter for the group
 *  (GBIF backbone keys, checked 2026-11-26: the backbone has no class Reptilia, so its three orders-as-classes; fish
 *  are a `taxonKey` list, which GBIF ORs across ranks, because most of them have an order but no class). */
export const GROUPS: { id: GroupId; label: string; uz: string; gbif?: Filter }[] = [
  { id: 'mammals', label: 'Mammals', uz: 'Sutemizuvchilar', gbif: { classKey: [359] } },
  { id: 'birds', label: 'Birds', uz: 'Qushlar', gbif: { classKey: [212] } },
  { id: 'reptiles', label: 'Reptiles', uz: 'Sudralib yuruvchilar', gbif: { classKey: [11592253, 11418114, 11493978] } },
  { id: 'amphibians', label: 'Frogs, toads and salamanders', uz: 'Baqalar va salamandralar', gbif: { classKey: [131] } },
  { id: 'fish', label: 'Fish', uz: 'Baliqlar', gbif: { taxonKey: [204, 238, 119, 11881065, ...FISH_ORDERS] } },
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
/** Every backbone key that defines a group, whatever its rank (class, order or phylum): keys are unique across ranks. */
export const groupKeys = (g: (typeof GROUPS)[number]): number[] => Object.values(g.gbif ?? {}).flat().map(Number);

/** Which per-group species requests a square needs, from the all-animals request's record counts per class, order
 *  and phylum key (one map: keys are unique across ranks). Groups with no records there are not asked. When every
 *  record falls in some group (nothing for "other") and the all-animals species list is complete, the biggest group
 *  is not asked either: its species are the ones no other group returned (`rest`). Groups are disjoint, so "record
 *  counts add up to the total" means every species belongs to one of them. Pure (test/taxa.test.ts). */
export function planGroups(total: number, counts: Map<number, number>, complete: boolean): { ask: GroupId[]; rest: GroupId } {
  const present = GROUPS.filter((g) => g.gbif).map((g) => ({ id: g.id, n: groupKeys(g).reduce((a, k) => a + (counts.get(k) ?? 0), 0) }))
    .filter((g) => g.n > 0);
  const inGroups = present.reduce((a, g) => a + g.n, 0);
  if (!complete || !present.length || inGroups !== total) return { ask: present.map((g) => g.id), rest: 'other' };
  const biggest = present.reduce((a, b) => (b.n > a.n ? b : a));
  return { ask: present.filter((g) => g !== biggest).map((g) => g.id), rest: biggest.id };
}

export const GROUP_LABEL: Record<GroupId, string> = Object.fromEntries(GROUPS.map((g) => [g.id, lang === 'uz' ? g.uz : g.label])) as Record<GroupId, string>;

/** Group of a GBIF species record from its class, phylum and order keys (for search hits and species pages). */
export function groupOfKeys(classKey?: number | null, phylumKey?: number | null, orderKey?: number | null): GroupId {
  for (const k of [classKey, orderKey]) {
    if (k == null) continue;
    const g = GROUPS.find((x) => x.gbif && (x.gbif.classKey ?? x.gbif.taxonKey)?.map(Number).includes(k));
    if (g) return g.id;
  }
  if (phylumKey != null) return GROUPS.find((x) => x.gbif?.phylumKey?.map(Number).includes(phylumKey))?.id ?? 'other';
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

/** Records per zone (ZONES order) from GBIF facet counts of distinct elevation and depth values. A value on a zone
 *  edge goes to the first zone that holds it, so it is counted once. */
export function zoneCounts(elevation: { name: string; count: number }[], depth: { name: string; count: number }[]): number[] {
  const out = ZONES.map(() => 0);
  for (const [param, list] of [['elevation', elevation], ['depth', depth]] as const) {
    for (const x of list) {
      const v = Number(x.name);
      const i = ZONES.findIndex((z) => z.param === param && v >= z.range[0] && v <= z.range[1]);
      if (i >= 0) out[i] += x.count;
    }
  }
  return out;
}

/** "Usually between 200 and 1,800 m above sea level": the middle half of records with a height or depth. */
export function verticalRange(counts: number[]): { from: number; to: number; records: number } | null {
  const bins: Bin[] = ZONES.map((z, i) => ({ from: z.from, to: z.to, records: counts[i] ?? 0 }));
  const records = bins.reduce((t, b) => t + b.records, 0);
  const lo = binnedQuantile(bins, 0.25), hi = binnedQuantile(bins, 0.75);
  if (lo == null || hi == null || records < 10) return null;
  const r = (v: number) => (Math.abs(v) < 100 ? Math.round(v / 5) * 5 : Math.abs(v) < 1000 ? Math.round(v / 10) * 10 : Math.round(v / 100) * 100);
  return { from: r(lo), to: r(hi), records };
}
