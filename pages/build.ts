// Static pages for search engines and links: one per well-known animal species (/animals/<slug>/), one per country
// (/places/<slug>/), two index pages and the sitemap. The globe lives at / and keeps places and species in the URL
// hash, which search engines do not index; these pages give each species and country a real URL with real content,
// and link into the globe. Input: data/pages/{species,places}.json from scripts/fetch_pages_data.py. Run by the
// Vite plugin in vite.config.ts after the app build; pure helpers are tested in test/pages.test.ts.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GROUPS, groupKeys, groupOfKeys, type GroupId } from '../src/taxa.ts';
import { commonsThumbs } from '../src/wiki.ts';

export const SITE = 'https://fauna.bristleconelab.org';

// ---------- input ----------
export interface SpeciesRow {
  key: number; wikidata: string; links: number; sci: string; labelEn: string | null; labelUz: string | null;
  vernacular: string | null; article: string | null; image: string | null;
  phylumKey: number | null; classKey: number | null; orderKey?: number | null; class: string | null; order: string | null; family: string | null;
  records: number; years: [number, number] | null; countries: [string, number][]; redlist: string | null;
  wiki: { title: string; extract: string; url: string } | null;
  photo: { thumb: string | null; page: string | null; artist: string; licence: string } | null;
}
export interface PlaceRow {
  iso: string; gbifTitle: string | null; labelEn: string | null; labelUz: string | null; wikidata: string | null;
  lat: number | null; lon: number | null; records: number; years: [number, number] | null;
  classes: Record<string, number>; orders?: Record<string, number>; phyla: Record<string, number>;
}

// ---------- pure helpers ----------
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Text and attribute values for HTML. */
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
/** JSON for a <script type="application/ld+json"> block: no "</script>" can close it early. */
export const jsonLd = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c');
const fmt = (n: number) => n.toLocaleString('en-US');
const REGION = new Intl.DisplayNames(['en'], { type: 'region' });
/** English name of an ISO 3166 code, for countries without a page of their own. */
export const regionName = (iso: string) => { try { return REGION.of(iso) ?? iso; } catch { return iso; } };

/** URL slug: ASCII, lowercase, words joined by hyphens ("Grey wolf" -> "grey-wolf", "Côte d'Ivoire" -> "cote-d-ivoire"). */
export function slugify(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’ʻ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Everyday English name, first letter capital: Wikidata's label, unless it only repeats the scientific name or carries
 *  a bracketed note (Branta bernicla's label was "ensis (bird)"); then the Wikipedia title without its "(goose)"
 *  part; then GBIF's vernacular name, which is often a list ("Common wasp, Common yellow jacket"): the entry the
 *  Wikipedia summary uses, else the first; else the scientific name. */
export function speciesName(r: Pick<SpeciesRow, 'labelEn' | 'sci' | 'wiki' | 'vernacular'>): string {
  const sci = r.sci.toLowerCase();
  const ok = (x: string | null | undefined): x is string => !!x && x.toLowerCase() !== sci && !/^\d/.test(x);
  const clean = (x: string) => x.replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ').trim();
  const fromList = (v: string | null) => {
    const parts = (v ?? '').split(/\s*,\s*/).map(clean).filter(ok);
    const text = (r.wiki?.extract ?? '').toLowerCase();
    return parts.find((p) => text.includes(p.toLowerCase())) ?? parts[0];
  };
  const label = r.labelEn && !/[([]/.test(r.labelEn) ? r.labelEn : null;
  const title = r.wiki?.title ? clean(r.wiki.title) : null;
  const pick = [label, title, fromList(r.vernacular)].find(ok) ?? r.sci;
  return pick.charAt(0).toUpperCase() + pick.slice(1);
}

/** Unique slugs: the name's slug, or name + scientific name where two species share a name. */
export function assignSlugs<T>(rows: T[], name: (r: T) => string, fallback: (r: T) => string): Map<T, string> {
  const count = new Map<string, number>();
  for (const r of rows) count.set(slugify(name(r)), (count.get(slugify(name(r))) ?? 0) + 1);
  const out = new Map<T, string>();
  const used = new Set<string>();
  for (const r of rows) {
    let s = slugify(name(r));
    if (!s || count.get(s)! > 1 || used.has(s)) s = [s, slugify(fallback(r))].filter(Boolean).join('-');
    let t = s, i = 2;
    while (used.has(t)) t = `${s}-${i++}`;
    used.add(t);
    out.set(r, t);
  }
  return out;
}

/** A country page lists a species only where that country gives at least 1 % of its records (and 3): a lion recorded
 *  in a German zoo should not make it an animal of Germany. */
export function recordedIn(r: Pick<SpeciesRow, 'countries' | 'records'>, iso: string): number {
  const n = r.countries.find(([c]) => c === iso)?.[1] ?? 0;
  return n >= 3 && n >= 0.01 * r.records ? n : 0;
}

/** Animal records per kind from a country's class and phylum counts. */
export function recordsByGroup(p: Pick<PlaceRow, 'classes' | 'orders' | 'phyla'>): { id: GroupId; records: number }[] {
  const all: Record<string, number> = { ...p.classes, ...(p.orders ?? {}), ...p.phyla }; // keys are unique across ranks
  return GROUPS.filter((g) => g.gbif).map((g) => ({ id: g.id, records: groupKeys(g).reduce((a, k) => a + (all[String(k)] ?? 0), 0) }))
    .filter((g) => g.records > 0).sort((a, b) => b.records - a.records);
}

export const IUCN: Record<string, string> = {
  EX: 'Extinct', EW: 'Extinct in the wild', CR: 'Critically endangered', EN: 'Endangered', VU: 'Vulnerable',
  NT: 'Near threatened', LC: 'Least concern', DD: 'Data deficient',
};
const THREAT = new Set(['CR', 'EN', 'VU']);
const LABEL = Object.fromEntries(GROUPS.map((g) => [g.id, g.label])) as Record<GroupId, string>;

// ---------- the model the templates use ----------
export interface Species extends SpeciesRow { name: string; slug: string; group: GroupId }
export interface Place extends PlaceRow { name: string; slug: string; species: { sp: Species; n: number }[] }

export function model(speciesRows: SpeciesRow[], placeRows: PlaceRow[]) {
  const all = speciesRows.map((r) => ({ ...r, name: speciesName(r), group: groupOfKeys(r.classKey, r.phylumKey, r.orderKey), slug: '' }));
  // two backbone keys under one everyday name (Torgos tracheliotos / tracheliotus): one page, the better recorded
  const best = new Map<string, (typeof all)[number]>();
  for (const r of all) { const k = r.name.toLowerCase(); if (!best.has(k) || best.get(k)!.records < r.records) best.set(k, r); }
  const named = all.filter((r) => best.get(r.name.toLowerCase()) === r);
  const ss = assignSlugs(named, (r) => r.name, (r) => r.sci);
  const species: Species[] = named.map((r) => ({ ...r, slug: ss.get(r)! }));
  const pnamed = placeRows.map((p) => ({ ...p, name: p.labelEn ?? p.gbifTitle ?? p.iso, slug: '', species: [] as { sp: Species; n: number }[] }));
  const ps = assignSlugs(pnamed, (p) => p.name, (p) => p.iso);
  const places: Place[] = pnamed.map((p) => ({ ...p, slug: ps.get(p)! }));
  const byIso = new Map(places.map((p) => [p.iso, p]));
  for (const sp of species) for (const [iso] of sp.countries) {
    const n = recordedIn(sp, iso);
    if (n) byIso.get(iso)?.species.push({ sp, n });
  }
  for (const p of places) p.species.sort((a, b) => b.n - a.n || b.sp.links - a.sp.links);
  return { species, places, byIso };
}
type Model = ReturnType<typeof model>;

// ---------- templates ----------
const photoOf = (sp: Species, width: number) => (sp.image ? commonsThumbs(sp.image, width)[0] : null);

function layout(o: { title: string; description: string; path: string; image?: string | null; ld: unknown[]; crumbs: [string, string][]; body: string }) {
  const url = SITE + o.path;
  const crumbLd = { '@type': 'BreadcrumbList', itemListElement: o.crumbs.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + path })) };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(url)}">
<meta name="theme-color" content="#14261c">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Fauna Atlas">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(o.image ?? SITE + '/og-image.png')}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/static/pages.css">
<script type="application/ld+json">${jsonLd({ '@context': 'https://schema.org', '@graph': [...o.ld, crumbLd] })}</script>
</head>
<body>
<header class="bar"><a class="brand" href="/"><img src="/brand/fauna-atlas-logo-dark.svg" alt="Fauna Atlas" width="115" height="32"></a><nav><a href="/animals/">Animals</a><a href="/places/">Countries</a><a class="cta" href="/">Open the globe</a></nav></header>
<main>
<nav class="crumbs" aria-label="Breadcrumb">${o.crumbs.map(([name, path], i) => (i === o.crumbs.length - 1 ? `<span aria-current="page">${esc(name)}</span>` : `<a href="${esc(path)}">${esc(name)}</a>`)).join(' <span aria-hidden="true">›</span> ')}</nav>
${o.body}
</main>
<footer><a class="powered" href="https://github.com/bristleconelab"><img src="/brand/bristleconelab-mark-dark-128.png" alt="" width="24" height="24">powered by <b>bristlecone lab</b></a><p>Fauna Atlas is an open atlas of animal life built on <a href="https://www.gbif.org">GBIF</a> and <a href="https://www.wikidata.org">Wikidata</a>. Records show where people found an animal, not a census. Code: <a href="https://github.com/bristleconelab/fauna-atlas">github.com/bristleconelab/fauna-atlas</a> (MIT). Part of <a href="https://github.com/bristleconelab">bristlecone lab</a>.</p></footer>
</body>
</html>
`;
}

function card(sp: Species, note?: string) {
  const img = photoOf(sp, 330);
  return `<li><a class="card" href="/animals/${sp.slug}/"><span class="ph g-${sp.group}">${img ? `<img src="${esc(img)}" alt="" loading="lazy" width="330" height="220">` : ''}</span><span class="nm">${esc(sp.name)}</span><span class="sci">${esc(sp.sci)}</span>${note ? `<span class="nt">${esc(note)}</span>` : ''}</a></li>`;
}

/** Records on a world map: NASA Blue Marble with GBIF's density squares on top, both as 2 x 2 zoom-1 tiles (GBIF
 *  answers 204, an empty image, where there are no records: hidden instead of a broken-image icon); the CSS
 *  crops the map at 60° S (71 % of the Mercator square), where Antarctica would fill a third of it. */
function rangeMap(taxonKey: number, alt: string) {
  const tiles = (src: (x: number, y: number) => string, cls: string) =>
    `<span class="${cls}">${[[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => `<img src="${esc(src(x, y))}" alt="" loading="lazy" width="256" height="256" onerror="this.style.visibility='hidden'">`).join('')}</span>`;
  const gibs = (x: number, y: number) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/1/${y}/${x}.jpeg`;
  const gbif = (x: number, y: number) => `https://api.gbif.org/v2/map/occurrence/density/1/${x}/${y}@1x.png?srs=EPSG:3857&bin=square&squareSize=32&style=classic-noborder.poly&taxonKey=${taxonKey}`;
  return `<figure class="map" role="img" aria-label="${esc(alt)}">${tiles(gibs, 'base')}${tiles(gbif, 'dots')}</figure>`;
}

export function speciesPage(sp: Species, m: Model): string {
  const red = sp.redlist && IUCN[sp.redlist];
  const nCountries = sp.countries.length;
  const top = sp.countries.slice(0, 12).map(([iso, n]) => ({ p: m.byIso.get(iso), iso, n }));
  const topNames = top.slice(0, 3).map((t) => t.p?.name ?? regionName(t.iso));
  const related = m.species.filter((o) => o !== sp && o.family && o.family === sp.family).slice(0, 8);
  const more = related.length < 8 ? m.species.filter((o) => o !== sp && !related.includes(o) && o.order && o.order === sp.order).slice(0, 8 - related.length) : [];
  const kin = [...related, ...more];
  const lineage = [LABEL[sp.group], sp.family && `family ${sp.family}`, sp.order && `order ${sp.order}`].filter(Boolean).join(' · ');
  const description = `Where the ${sp.name.toLowerCase() === sp.sci.toLowerCase() ? sp.sci : `${sp.name} (${sp.sci})`} has been recorded: ${fmt(sp.records)} records from ${nCountries} ${nCountries === 1 ? 'country' : 'countries'}${topNames.length ? `, most from ${topNames.join(', ')}` : ''}.${red ? ` IUCN Red List: ${red}.` : ''} Map, photo and facts.`;
  const hero = sp.photo?.thumb ?? photoOf(sp, 640);
  const ld = [
    {
      '@type': 'WebPage', '@id': `${SITE}/animals/${sp.slug}/`, url: `${SITE}/animals/${sp.slug}/`, name: `${sp.name} (${sp.sci})`,
      description, isPartOf: { '@type': 'WebSite', name: 'Fauna Atlas', url: `${SITE}/` },
      about: {
        '@type': 'Taxon', name: sp.sci, alternateName: [sp.name, sp.labelUz].filter((x) => x && x !== sp.sci), taxonRank: 'species',
        parentTaxon: sp.family ? { '@type': 'Taxon', name: sp.family, taxonRank: 'family' } : undefined,
        sameAs: [`https://www.gbif.org/species/${sp.key}`, `https://www.wikidata.org/wiki/${sp.wikidata}`, sp.wiki?.url].filter(Boolean),
      },
      primaryImageOfPage: hero && sp.photo ? { '@type': 'ImageObject', contentUrl: hero, creditText: sp.photo.artist, license: sp.photo.page ?? undefined, acquireLicensePage: sp.photo.page ?? undefined } : undefined,
    },
  ];
  const body = `<article class="species">
<header class="hero">
${hero ? `<figure class="photo g-${sp.group}"><img src="${esc(hero)}" alt="${esc(`${sp.name}, ${sp.sci}`)}" width="640" height="427"><figcaption>Photo: ${sp.photo?.page ? `<a href="${esc(sp.photo.page)}">${esc(sp.photo.artist)}, ${esc(sp.photo.licence)}</a>` : 'Wikimedia Commons'}</figcaption></figure>` : ''}
<div class="head">
<h1>${esc(sp.name)}</h1>
${sp.name !== sp.sci ? `<p class="latin">${esc(sp.sci)}</p>` : ''}
<p class="lineage">${esc(lineage)}</p>
${red ? `<p><span class="iucn iucn-${esc(sp.redlist)}">${esc(red)}</span> on the IUCN Red List</p>` : ''}
${sp.labelUz ? `<p class="uz" lang="uz">Oʻzbekcha: ${esc(sp.labelUz)}</p>` : ''}
<p><a class="btn" href="/#sp=${sp.key}">See where it lives on the globe</a></p>
</div>
</header>
${sp.wiki?.extract ? `<section><h2>About</h2><p class="extract">${esc(sp.wiki.extract)}</p><p class="fine">From <a href="${esc(sp.wiki.url)}">Wikipedia</a>, CC BY-SA 4.0.</p></section>` : ''}
<section>
<h2>Where it has been recorded</h2>
${rangeMap(sp.key, `World map of ${sp.name} records`)}
<dl class="facts"><div><dt>Records</dt><dd>${fmt(sp.records)}</dd></div><div><dt>Countries</dt><dd>${fmt(nCountries)}</dd></div>${sp.years ? `<div><dt>Recorded</dt><dd>${sp.years[0]}–${sp.years[1]}</dd></div>` : ''}</dl>
${top.length ? `<h3>Most records come from</h3><ol class="countries">${top.map((t) => `<li>${t.p ? `<a href="/places/${t.p.slug}/">${esc(t.p.name)}</a>` : esc(regionName(t.iso))} <span>${fmt(t.n)}</span></li>`).join('')}</ol>` : ''}
<p class="fine">Records are places where people found and reported the animal, from <a href="https://www.gbif.org/species/${sp.key}">GBIF</a>; some come from zoos, museums and tracking studies, and well-studied countries have far more. Squares on the map: brighter means more records.</p>
</section>
${kin.length ? `<section><h2>Related animals</h2><ul class="cards">${kin.map((o) => card(o)).join('')}</ul></section>` : ''}
</article>`;
  return layout({
    title: `${sp.name}${sp.name !== sp.sci ? ` (${sp.sci})` : ''}: where it lives, map and facts | Fauna Atlas`, description,
    path: `/animals/${sp.slug}/`, image: hero, ld, body,
    crumbs: [['Fauna Atlas', '/'], ['Animals', '/animals/'], [LABEL[sp.group], `/animals/#${sp.group}`], [sp.name, `/animals/${sp.slug}/`]],
  });
}

export function placePage(p: Place): string {
  const groups = recordsByGroup(p);
  const max = Math.max(1, ...groups.map((g) => g.records));
  const byGroup = new Map<GroupId, { sp: Species; n: number }[]>();
  for (const x of p.species) byGroup.set(x.sp.group, [...(byGroup.get(x.sp.group) ?? []), x]);
  const threatened = p.species.filter((x) => x.sp.redlist && THREAT.has(x.sp.redlist));
  const famous = p.species.slice(0, 4).map((x) => x.sp.name.toLowerCase());
  const description = `Animals recorded in ${p.name}: ${fmt(p.records)} GBIF records${p.species.length ? `, including ${p.species.length} well-known species such as the ${famous.join(', ')}` : ''}. Photos, maps and where nobody has looked yet.`;
  const at = p.lat != null && p.lon != null ? `/#at=${p.lat.toFixed(2)},${p.lon.toFixed(2)}` : '/';
  const ld = [{
    '@type': 'WebPage', '@id': `${SITE}/places/${p.slug}/`, url: `${SITE}/places/${p.slug}/`, name: `Animals of ${p.name}`, description,
    isPartOf: { '@type': 'WebSite', name: 'Fauna Atlas', url: `${SITE}/` },
    about: { '@type': 'Country', name: p.name, identifier: p.iso, sameAs: p.wikidata ? `https://www.wikidata.org/wiki/${p.wikidata}` : undefined },
  }];
  const sections = GROUPS.filter((g) => byGroup.get(g.id)?.length).map((g) => {
    const list = byGroup.get(g.id)!;
    const shown = list.slice(0, 12);
    const rest = list.slice(12);
    return `<section id="${g.id}"><h2>${esc(g.label)} <span class="n">${list.length}</span></h2><ul class="cards">${shown.map((x) => card(x.sp, `${fmt(x.n)} records here`)).join('')}</ul>${rest.length ? `<p class="also">Also: ${rest.map((x) => `<a href="/animals/${x.sp.slug}/">${esc(x.sp.name)}</a>`).join(', ')}.</p>` : ''}</section>`;
  }).join('\n');
  const body = `<article class="place">
<header class="phead">
<h1>Animals of ${esc(p.name)}</h1>
${p.labelUz ? `<p class="uz" lang="uz">Oʻzbekcha: ${esc(p.labelUz)} hayvonlari</p>` : ''}
<p class="lede">${fmt(p.records)} records of animals in ${esc(p.name)} on GBIF${p.years ? `, from ${p.years[0]} to ${p.years[1]}` : ''}. ${p.species.length ? `Below are the ${p.species.length} best-known animals recorded here.` : ''}</p>
<p><a class="btn" href="${esc(at)}">Explore ${esc(p.name)} on the globe</a></p>
</header>
${groups.length ? `<section><h2>Records by kind of animal</h2><ul class="bars">${groups.map((g) => `<li><span class="lb">${esc(LABEL[g.id])}</span><span class="br"><span class="g-${g.id}" style="width:${Math.max(0.5, (100 * g.records) / max).toFixed(1)}%"></span></span><span class="v">${fmt(g.records)}</span></li>`).join('')}</ul><p class="fine">Record counts show where people looked and what they looked for, not only what is common: birds are recorded far more than insects.</p></section>` : ''}
${threatened.length ? `<section><h2>Threatened animals recorded here</h2><p>${threatened.map((x) => `<a href="/animals/${x.sp.slug}/">${esc(x.sp.name)}</a> <span class="iucn iucn-${esc(x.sp.redlist)}">${esc(IUCN[x.sp.redlist!])}</span>`).join(' · ')}</p></section>` : ''}
${sections}
<p class="fine">A species is listed when ${esc(p.name)} holds at least 1 % of its GBIF records, so a lion recorded in a zoo abroad does not count. For every animal ever recorded in a spot, open the globe and click it.</p>
</article>`;
  return layout({
    title: `Animals of ${p.name}: species, photos and maps | Fauna Atlas`, description, path: `/places/${p.slug}/`, ld, body,
    crumbs: [['Fauna Atlas', '/'], ['Countries', '/places/'], [p.name, `/places/${p.slug}/`]],
  });
}

export function animalsIndex(m: Model): string {
  const sections = GROUPS.map((g) => {
    const list = m.species.filter((s) => s.group === g.id).sort((a, b) => a.name.localeCompare(b.name));
    return list.length ? `<section id="${g.id}"><h2>${esc(g.label)} <span class="n">${list.length}</span></h2><ul class="names">${list.map((s) => `<li><a href="/animals/${s.slug}/">${esc(s.name)}</a></li>`).join('')}</ul></section>` : '';
  }).join('\n');
  const body = `<h1>Animals</h1><p class="lede">${fmt(m.species.length)} of the world's best-known animal species, each with where it has been recorded, a photo and facts. For any other animal, search on <a href="/">the globe</a>.</p>
<p class="jump">${GROUPS.filter((g) => m.species.some((s) => s.group === g.id)).map((g) => `<a href="#${g.id}">${esc(g.label)}</a>`).join(' · ')}</p>
${sections}`;
  return layout({
    title: 'Animals: where the best-known species live | Fauna Atlas',
    description: `Where ${fmt(m.species.length)} well-known animals live, from lions to puffins: maps of their records, photos, Red List status and the countries they are recorded in.`,
    path: '/animals/', ld: [{ '@type': 'CollectionPage', url: `${SITE}/animals/`, name: 'Animals' }], body,
    crumbs: [['Fauna Atlas', '/'], ['Animals', '/animals/']],
  });
}

export function placesIndex(m: Model): string {
  const list = [...m.places].sort((a, b) => a.name.localeCompare(b.name));
  const body = `<h1>Animals by country</h1><p class="lede">Which animals have been recorded in each of ${list.length} countries and territories, from GBIF.</p>
<ul class="names">${list.map((p) => `<li><a href="/places/${p.slug}/">${esc(p.name)}</a> <span>${fmt(p.records)}</span></li>`).join('')}</ul>`;
  return layout({
    title: 'Animals by country: which animals live where | Fauna Atlas',
    description: `Animals recorded in each of ${list.length} countries and territories: well-known species with photos, threatened animals, and records by kind of animal.`,
    path: '/places/', ld: [{ '@type': 'CollectionPage', url: `${SITE}/places/`, name: 'Animals by country' }], body,
    crumbs: [['Fauna Atlas', '/'], ['Countries', '/places/']],
  });
}

export function sitemap(m: Model, lastmod: string): string {
  const urls = ['/', '/animals/', '/places/', ...m.species.map((s) => `/animals/${s.slug}/`), ...m.places.map((p) => `/places/${p.slug}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(SITE + u)}</loc><lastmod>${esc(lastmod)}</lastmod></url>`).join('\n')}
</urlset>
`;
}

// ---------- writing ----------
const FONTS = [
  ['node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2', 'bricolage.woff2'],
  ['node_modules/@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-italic.woff2', 'serif-italic.woff2'],
];

/** Write every page into `out` (the build's dist/). Returns how many pages were written, 0 if there is no data. */
export function writePages(root: string, out: string): number {
  const sp = join(root, 'data/pages/species.json'), pl = join(root, 'data/pages/places.json');
  if (!existsSync(sp) || !existsSync(pl)) return 0;
  const S = JSON.parse(readFileSync(sp, 'utf8')) as { fetched: string; rows: SpeciesRow[] };
  const P = JSON.parse(readFileSync(pl, 'utf8')) as { fetched: string; rows: PlaceRow[] };
  const m = model(S.rows, P.rows);
  const put = (path: string, text: string) => { const f = join(out, path); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };
  for (const s of m.species) put(`animals/${s.slug}/index.html`, speciesPage(s, m));
  for (const p of m.places) put(`places/${p.slug}/index.html`, placePage(p));
  put('animals/index.html', animalsIndex(m));
  put('places/index.html', placesIndex(m));
  put('sitemap.xml', sitemap(m, S.fetched));
  mkdirSync(join(out, 'static'), { recursive: true });
  copyFileSync(join(root, 'pages/pages.css'), join(out, 'static/pages.css'));
  for (const [from, to] of FONTS) copyFileSync(join(root, from), join(out, 'static', to));
  return m.species.length + m.places.length + 2;
}
