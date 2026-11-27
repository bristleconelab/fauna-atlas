import { describe, expect, it } from 'vitest';
import { binnedQuantile, countByGroup, groupOfKeys, interleaveGroups, planGroups, rankSpecies, zoneCounts, verticalRange, ZONES, type Taxon } from '../src/taxa';
import { mergeGbif, rankHits } from '../src/search';
import { monthsFromFacet, peakSeason, activityKind } from '../src/journeys';
import { decadeCounts } from '../src/tracks';
import { licenceShort } from '../src/api';

const t = (key: number, group: Taxon['group'], records = 10): Taxon => ({ key, group, records });

describe('groups (GBIF backbone keys, checked 2026-11-26)', () => {
  it('places classes and phyla', () => {
    expect(groupOfKeys(359, 44)).toBe('mammals');
    expect(groupOfKeys(212, 44)).toBe('birds');
    expect(groupOfKeys(11592253, 44)).toBe('reptiles'); // Squamata is a class in the backbone
    expect(groupOfKeys(131, 44)).toBe('amphibians');
    expect(groupOfKeys(216, 54)).toBe('insects');
    expect(groupOfKeys(121, 44)).toBe('sharks');
    expect(groupOfKeys(undefined, 52)).toBe('molluscs');
    expect(groupOfKeys(9999, 9999)).toBe('other');
    expect(groupOfKeys(undefined, 44, 1153)).toBe('fish'); // carp: Chordata > Cypriniformes, no class in the backbone
    expect(groupOfKeys(null, 44, 587)).toBe('fish'); // Perciformes
    expect(groupOfKeys(undefined, 44, undefined)).toBe('other');
  });
  it('ranks by records and counts by group', () => {
    expect(rankSpecies([t(2, 'birds', 5), t(1, 'birds', 5), t(3, 'mammals', 9)]).map((x) => x.key)).toEqual([3, 1, 2]);
    expect(countByGroup([t(1, 'birds'), t(2, 'birds'), t(3, 'insects')]).get('birds')).toBe(2);
  });
  it('lets insects take a turn only every third round while vertebrates are left', () => {
    const list = [t(1, 'insects'), t(2, 'insects'), t(3, 'insects'), t(10, 'birds'), t(11, 'birds'), t(12, 'birds'), t(13, 'birds')];
    expect(interleaveGroups(list).map((x) => x.key)).toEqual([10, 1, 11, 12, 13, 2, 3]);
  });
});

describe('vertical profile', () => {
  it('interpolates inside explicit bins', () => {
    expect(binnedQuantile([{ from: 0, to: 1000, records: 10 }], 0.5)).toBeCloseTo(500);
    expect(binnedQuantile([], 0.5)).toBeNull();
  });
  it('spans land and sea on one signed scale', () => {
    const counts = ZONES.map(() => 0);
    counts[ZONES.findIndex((z) => z.from === 0)] = 50;        // lowlands
    counts[ZONES.findIndex((z) => z.from === -200)] = 50;     // sunlit sea
    const r = verticalRange(counts)!;
    expect(r.from).toBeLessThan(0); expect(r.to).toBeGreaterThan(0); expect(r.records).toBe(100);
  });
  it('places a mountain animal high', () => {
    const counts = ZONES.map((z) => (z.from === 3000 ? 80 : z.from === 2000 ? 20 : 0));
    const r = verticalRange(counts)!;
    expect(r.from).toBeGreaterThanOrEqual(2000); expect(r.to).toBeLessThanOrEqual(4500);
  });
});

describe('search', () => {
  // real GBIF species/search answer for "snow leopard", trimmed (2026-11-26)
  const res = [
    { key: 2435238, nubKey: 2435238, scientificName: 'Uncia uncia (Schreber, 1775)', canonicalName: 'Uncia uncia', taxonomicStatus: 'ACCEPTED', rank: 'SPECIES', classKey: 359, phylumKey: 44, vernacularNames: [{ vernacularName: 'Snow leopard' }] },
    { key: 5787213, nubKey: 5787213, scientificName: 'Panthera uncia (Schreber, 1775)', canonicalName: 'Panthera uncia', taxonomicStatus: 'SYNONYM', acceptedKey: 2435238, rank: 'SPECIES', classKey: 359, phylumKey: 44, vernacularNames: [{ vernacularName: 'Snow Leopard' }] },
    { key: 1878656, nubKey: 1878656, scientificName: 'Obtusipalpis pardalis Hampson, 1895', canonicalName: 'Obtusipalpis pardalis', taxonomicStatus: 'ACCEPTED', rank: 'SPECIES', classKey: 216, phylumKey: 54, vernacularNames: [{ vernacularName: 'Snow Leopard' }] },
  ];
  it('folds synonyms into the accepted species and marks exact common names', () => {
    const hits = mergeGbif(res as never, 'snow leopard');
    expect(hits.map((x) => x.id)).toEqual([2435238, 1878656]);
    expect(hits[0].group).toBe('mammals');
    expect(hits.every((x) => x.exact)).toBe(true);
  });
  it('puts the animal people record most first among exact matches', () => {
    const hits = mergeGbif(res as never, 'snow leopard');
    expect(rankHits(hits, new Map([[2435238, 9000], [1878656, 40]]))[0].id).toBe(2435238);
  });
});

describe('time', () => {
  it('reads GBIF month facets and finds a season', () => {
    const m = monthsFromFacet([{ name: '6', count: 50 }, { name: '7', count: 60 }, { name: '8', count: 40 }, { name: '1', count: 5 }, { name: '13', count: 9 }]);
    expect(m[5]).toBe(50); expect(m.reduce((a, b) => a + b)).toBe(155);
    expect(peakSeason(m)).toMatchObject({ from: 5, to: 7 });
  });
  it('fills empty decades from the first decade with records, not from 1900', () => {
    expect(decadeCounts([{ year: 1928, records: 7 }, { year: 1958, records: 1 }]).map((d) => d.decade)).toEqual([1920, 1930, 1940, 1950]);
    expect(decadeCounts([{ year: 2012, records: 3 }, { year: 2024, records: 9 }]).map((d) => d.decade)).toEqual([2010, 2020]);
  });
  it('classifies MiCO activities', () => {
    expect(activityKind('Spawning')).toBe('breeding');
    expect(activityKind('Wintering')).toBe('season');
  });
});

describe('photo licences', () => {
  it('keeps NC and ND apart so only open photos are used', () => {
    expect(licenceShort('http://creativecommons.org/licenses/by-nc/4.0/')).toBe('CC BY-NC');
    expect(licenceShort('http://creativecommons.org/licenses/by/4.0/')).toBe('CC BY');
    expect(licenceShort('http://creativecommons.org/publicdomain/zero/1.0/')).toBe('CC0');
  });
});

describe('planGroups', () => {
  const m = (o: Record<number, number>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
  it('asks only the groups recorded there and leaves the biggest to subtraction when the counts add up', () => {
    // mammals 100, birds 500, insects 300 (classes), molluscs 20 (phylum): total 920
    const p = planGroups(920, m({ 359: 100, 212: 500, 216: 300, 44: 900, 52: 20 }), true);
    expect(p.rest).toBe('birds');
    expect(p.ask.sort()).toEqual(['insects', 'mammals', 'molluscs']);
  });
  it('adds the three reptile classes and the fish classes into one group each', () => {
    const p = planGroups(60, m({ 11592253: 10, 11418114: 5, 1153: 40, 238: 5 }), true); // carp: an order, no class
    expect(p).toEqual({ ask: ['reptiles'], rest: 'fish' });
  });
  it('asks every present group when some records fall outside them (sponges, a record known only to phylum)', () => {
    const p = planGroups(1000, m({ 359: 100, 212: 500, 105: 400 }), true);
    expect(p).toEqual({ ask: ['mammals', 'birds'], rest: 'other' });
  });
  it('asks every present group when the all-animals list was cut at the facet limit', () => {
    expect(planGroups(600, m({ 359: 100, 212: 500 }), false)).toEqual({ ask: ['mammals', 'birds'], rest: 'other' });
  });
  it('never leaves a group already requested (birds go out early) to subtraction', () => {
    const p = planGroups(920, m({ 359: 100, 212: 500, 216: 300, 52: 20 }), true, ['birds', 'mammals']);
    expect(p.rest).toBe('insects');
    expect(p.ask.sort()).toEqual(['birds', 'mammals', 'molluscs']);
  });
  it('asks nothing for an empty square', () => {
    expect(planGroups(0, m({}), true)).toEqual({ ask: [], rest: 'other' });
  });
});

describe('zoneCounts', () => {
  it('bins facet values into the vertical zones, edges counted once, land below sea level as lowland, depth 0 and out-of-range values left out', () => {
    const z = zoneCounts(
      [{ name: '2000.0', count: 747 }, { name: '2400.0', count: 3 }, { name: '150.0', count: 10 }, { name: '-5.0', count: 2 }, { name: '9500.0', count: 1 }],
      [{ name: '0.0', count: 400 }, { name: '999.0', count: 6 }, { name: '12.0', count: 4 }],
    );
    expect(z).toEqual([0, 0, 750, 0, 12, 4, 6, 0, 0]); // -5 m elevation is lowland
  });
});

describe('vertical range from exact values', () => {
  it('takes the middle half of the records straight from the values, no interpolation inside wide zones', async () => {
    const { verticalRange, signedHeights, weightedQuantile } = await import('../src/taxa');
    // a shore bird: records at 2, 5 and 15 m. Interpolating inside the 0-1,000 m zone used to say "250-750 m".
    const shore = signedHeights([{ name: '2.0', count: 40 }, { name: '5.0', count: 40 }, { name: '15.0', count: 20 }], []);
    expect(verticalRange([], shore)).toEqual({ from: 0, to: 5, records: 100 });
    // the Dead Sea and the Caspian shore count as lowland; depth 0 (filled by land datasets) does not count as sea
    expect(signedHeights([{ name: '-430', count: 3 }, { name: '0.0', count: 26 }], [{ name: '0.0', count: 9 }, { name: '4300', count: 2 }])).toEqual([[-430, 3], [-4300, 2]]);
    expect(weightedQuantile([[10, 1], [20, 1], [30, 2]], 0.5)).toBe(20);
  });
});

describe('trackAtHours', () => {
  it('follows a journey piece by piece and interpolates the moving dot', async () => {
    const { trackAtHours } = await import('../src/tracks');
    const tr = { s: 0, a: 'Zuri', km: 100, d: 0, t0: 0, t1: 0, p: [[[0, 0, 0], [10, 0, 10]], [[20, 0, 40], [30, 0, 50]]] as [number, number, number][][] };
    expect(trackAtHours(tr, 5)).toEqual({ upto: [[[0, 0], [5, 0]]], head: [5, 0] });
    expect(trackAtHours(tr, 20).upto).toEqual([[[0, 0], [10, 0]]]); // in the silence between pieces: no line drawn across it
    expect(trackAtHours(tr, 45).head).toEqual([25, 0]);
    expect(trackAtHours(tr, 60).head).toBeNull();
  });
});
