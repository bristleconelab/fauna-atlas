import { describe, expect, it } from 'vitest';
import {
  assignSlugs, esc, jsonLd, model, placePage, recordedIn, recordsByGroup, sitemap, slugify, speciesName, speciesPage,
  type PlaceRow, type SpeciesRow,
} from '../pages/build';

const sp = (o: Partial<SpeciesRow>): SpeciesRow => ({
  key: 1, wikidata: 'Q1', links: 10, sci: 'Panthera leo', labelEn: 'lion', labelUz: 'Arslon', vernacular: 'lion',
  article: 'https://en.wikipedia.org/wiki/Lion', image: 'PZ lion pride.jpg', phylumKey: 44, classKey: 359,
  class: 'Mammalia', order: 'Carnivora', family: 'Felidae', records: 17606, years: [1893, 2026],
  countries: [['ZA', 5188], ['KE', 3490], ['DE', 147]], redlist: 'VU',
  wiki: { title: 'Lion', extract: 'The lion is a large cat.', url: 'https://en.wikipedia.org/wiki/Lion' },
  photo: { thumb: 'https://upload.wikimedia.org/x/640px-PZ.jpg', page: 'https://commons.wikimedia.org/wiki/File:PZ.jpg', artist: 'A. Person', licence: 'CC BY-SA 4.0' },
  ...o,
});
const place = (o: Partial<PlaceRow>): PlaceRow => ({
  iso: 'KE', gbifTitle: 'Kenya', labelEn: 'Kenya', labelUz: 'Keniya', wikidata: 'Q114', lat: 0.5, lon: 37.9,
  records: 1_000_000, years: [1850, 2026], classes: { 212: 800000, 359: 50000 }, phyla: { 44: 860000, 52: 2000 }, ...o,
});

describe('static pages: helpers', () => {
  it('makes ASCII slugs', () => {
    expect(slugify('Grey wolf')).toBe('grey-wolf');
    expect(slugify("Côte d'Ivoire")).toBe('cote-divoire');
    expect(slugify('Oʻzbekiston')).toBe('ozbekiston');
  });
  it('picks an everyday name and never repeats the scientific one', () => {
    expect(speciesName(sp({}))).toBe('Lion');
    expect(speciesName(sp({ sci: 'Sus scrofa', labelEn: 'Sus scrofa', wiki: { title: 'Wild boar', extract: '', url: '' } }))).toBe('Wild boar');
    expect(speciesName(sp({ sci: 'Panthera onca', labelEn: 'Panthera onca', wiki: { title: 'Jaguar (animal)', extract: '', url: '' } }))).toBe('Jaguar');
    expect(speciesName(sp({ sci: 'Xus yus', labelEn: null, wiki: null, vernacular: null }))).toBe('Xus yus');
    expect(speciesName(sp({ sci: 'Branta bernicla', labelEn: 'ensis (bird)', wiki: { title: 'Brant (goose)', extract: '', url: '' } }))).toBe('Brant');
    expect(speciesName(sp({ sci: 'Arctocephalus forsteri', labelEn: 'Arctocephalus forsteri', vernacular: 'South american fur seal, New Zealand fur seal',
      wiki: { title: 'Arctocephalus forsteri', extract: 'The New Zealand fur seal is a species of fur seal.', url: '' } }))).toBe('New Zealand fur seal');
    expect(speciesName(sp({ sci: 'Squatina squatina', labelEn: 'Squatina squatina', vernacular: 'Angelshark, Monkfish [shark]', wiki: null }))).toBe('Angelshark');
  });
  it('makes one page for two keys under one name, the better recorded', () => {
    const m = model([sp({ key: 1, sci: 'Torgos tracheliotos', labelEn: 'Lappet-faced vulture', records: 50 }), sp({ key: 2, sci: 'Torgos tracheliotus', labelEn: 'Lappet-faced vulture', records: 900 })], []);
    expect(m.species.map((s) => [s.key, s.slug])).toEqual([[2, 'lappet-faced-vulture']]);
  });
  it('keeps slugs unique: a shared name gets the scientific name too', () => {
    const rows = [{ n: 'Common eider', s: 'Somateria mollissima' }, { n: 'Puffin', s: 'Fratercula arctica' }, { n: 'Puffin', s: 'Fratercula corniculata' }];
    const m = assignSlugs(rows, (r) => r.n, (r) => r.s);
    expect(rows.map((r) => m.get(r))).toEqual(['common-eider', 'puffin-fratercula-arctica', 'puffin-fratercula-corniculata']);
  });
  it('leaves zoo records out of a country: at least 1 % of the species and 3 records', () => {
    expect(recordedIn(sp({}), 'KE')).toBe(3490);
    expect(recordedIn(sp({}), 'DE')).toBe(0); // 147 of 17,606 = 0.8 %
    expect(recordedIn(sp({ records: 100, countries: [['UZ', 2]] }), 'UZ')).toBe(0);
  });
  it('sums a country\'s class, order and phylum counts into kinds of animal', () => {
    expect(recordsByGroup(place({}))).toEqual([{ id: 'birds', records: 800000 }, { id: 'mammals', records: 50000 }, { id: 'molluscs', records: 2000 }]);
    expect(recordsByGroup(place({ orders: { 1153: 700, 587: 300 } })).find((g) => g.id === 'fish')).toEqual({ id: 'fish', records: 1000 });
  });
  it('escapes HTML and cannot close a JSON-LD script early', () => {
    expect(esc('<b>"Tom" & Jerry\'s</b>')).toBe('&lt;b&gt;&quot;Tom&quot; &amp; Jerry&#39;s&lt;/b&gt;');
    expect(jsonLd({ a: '</script><script>x' })).not.toContain('</script>');
  });
});

describe('static pages: output', () => {
  const m = model([sp({}), sp({ key: 2, sci: 'Acinonyx jubatus', labelEn: 'cheetah', wikidata: 'Q2', countries: [['KE', 900]], records: 1000, redlist: 'VU' })], [place({}), place({ iso: 'DE', labelEn: 'Germany', labelUz: null })]);
  const lion = m.species[0];
  const html = speciesPage(lion, m);
  it('a species page has its name, canonical URL, escaped data, links to countries and the globe', () => {
    expect(html).toContain('<h1>Lion</h1>');
    expect(html).toContain('<link rel="canonical" href="https://fauna.bristleconelab.org/animals/lion/">');
    expect(html).toContain('href="/places/kenya/"');
    expect(html).toContain('href="/#sp=1"');
    expect(html).toContain('Vulnerable');
    expect(html).toContain('href="/animals/cheetah/"'); // related: same family
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]);
    expect(ld['@graph'][0].about.name).toBe('Panthera leo');
  });
  it('a country page lists its animals but not zoo animals', () => {
    const ke = placePage(m.places[0]);
    expect(ke).toContain('<h1>Animals of Kenya</h1>');
    expect(ke).toContain('href="/animals/lion/"');
    expect(ke).toContain('href="/#at=0.50,37.90"');
    expect(placePage(m.places[1])).not.toContain('href="/animals/lion/"');
  });
  it('the sitemap lists the home page, both indexes and every page once', () => {
    const xml = sitemap(m, '2026-11-26');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]);
    expect(locs).toContain('https://fauna.bristleconelab.org/');
    expect(locs).toContain('https://fauna.bristleconelab.org/animals/lion/');
    expect(locs).toContain('https://fauna.bristleconelab.org/places/germany/');
    expect(new Set(locs).size).toBe(locs.length);
    expect(locs.length).toBe(3 + m.species.length + m.places.length);
  });
});

describe('static pages: country names', () => {
  it('names a country without a page from its ISO code', async () => {
    const { regionName } = await import('../pages/build');
    expect(regionName('BW')).toBe('Botswana');
    expect(regionName('XX')).toBe('XX');
  });
});

describe('static pages: README numbers match the data', () => {
  it('names as many animal and country pages as data/pages holds', async () => {
    const { existsSync, readFileSync } = await import('node:fs');
    if (!existsSync('data/pages/species.json')) return; // a checkout without page data builds the globe only
    const rows = (f: string) => (JSON.parse(readFileSync(f, 'utf8')) as { rows: never[] }).rows;
    const m = model(rows('data/pages/species.json'), rows('data/pages/places.json'));
    const readme = readFileSync('README.md', 'utf8');
    expect(readme).toContain(`${m.species.length.toLocaleString('en-US')} animals`);
    expect(readme).toContain(`${m.places.length.toLocaleString('en-US')} countries and territories`);
  });
});
