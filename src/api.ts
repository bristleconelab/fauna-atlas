// Live data clients. Every service here allows browser requests (CORS *), needs no key, and is cached per session.
//   GBIF        https://api.gbif.org           species lists per area (facets), species, counts, names, Red List, maps
//   Wikidata    https://qlever.dev, query.wikidata.org, www.wikidata.org   photo, names in the reader's language, articles,
//               size and lifespan, sounds (taxa matched by their GBIF id, P846)
//   Commons     https://commons.wikimedia.org  photo and sound authors and licences
//   Wikipedia   https://<lang>.wikipedia.org   one-paragraph summary
//   Photon      https://photon.komoot.io       places by name (OpenStreetMap; made for search-as-you-type)
//   Nominatim   https://nominatim.openstreetmap.org  the name of a clicked point on land (one request per click)
//   Marine Regions https://www.marineregions.org  the name of a clicked point at sea
import { GROUPS, planGroups, signedHeights, WILD_BASIS, zoneCounts, ZONES, type Taxon } from './taxa';
import { parseWikidata, type WikiInfo } from './wiki';

const GBIF = 'https://api.gbif.org/v1';
/** GBIF Backbone Taxonomy. */
const BACKBONE = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c';
/** Animals, wild, with coordinates GBIF found no problem with, and present (not "absent" survey rows). */
const CLEAN = { kingdomKey: 1, hasCoordinate: 'true', hasGeospatialIssue: 'false', occurrenceStatus: 'PRESENT', basisOfRecord: WILD_BASIS };

export class HttpError extends Error {
  /** Seconds the server asked us to wait (Retry-After on 429/503), when it said. */
  constructor(public status: number, url: string, public retryAfter?: number) { super(`HTTP ${status} for ${url}`); }
}

// ---------- fetch with retry, timeout, cancel and a bounded cache ----------
/** Answers kept per session. Map keeps insertion order, so the oldest entry goes first (LRU on read, see below). */
const CACHE_MAX = 250;
const cache = new Map<string, Promise<unknown>>();

export interface GetOpts {
  timeoutMs?: number; signal?: AbortSignal; noCache?: boolean; init?: RequestInit;
  /** GBIF only: background requests (tile names and photos) wait until the panel's own requests have gone out. */
  low?: boolean;
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
const isTimeout = (e: unknown) => e instanceof DOMException && e.name === 'TimeoutError';

export function getJSON<T>(url: string, o: GetOpts = {}): Promise<T> {
  const key = url + (o.init?.body ? `|${String(o.init.body)}` : '');
  const hit = o.noCache ? undefined : cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit as Promise<T>; }
  const gbif = url.startsWith('https://api.gbif.org/');
  const once = () => {
    const signals = [AbortSignal.timeout(o.timeoutMs ?? 25000)];
    if (o.signal) signals.push(o.signal);
    const go = () => fetch(url, { ...o.init, signal: AbortSignal.any(signals) }).then(async (r) => {
      if (r.status === 204) return [] as T;
      if (!r.ok) {
        const ra = Number(r.headers.get('retry-after'));
        throw new HttpError(r.status, url, Number.isFinite(ra) && ra > 0 ? ra : undefined);
      }
      return (await r.json()) as T;
    });
    return gbif ? gbifSlot(go, !!o.low, o.signal) : go();
  };
  // Busy public services sometimes answer 5xx/429 or stall: try again with a pause. A GBIF 429 or 5xx pauses every
  // GBIF request (see gbifSlot), so its first retries need no extra wait of their own.
  const p = retry(once, gbif ? [0, 0, 0, 0, 2000, 5000] : [1200, 3500], o.signal);
  if (!o.noCache) {
    cache.set(key, p);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    p.catch(() => cache.delete(key)); // do not keep failures or cancelled requests
  }
  return p;
}

/** Wait `ms`, or less if `signal` aborts (then throw its AbortError, like fetch). */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const done = () => { clearTimeout(t); signal?.removeEventListener('abort', stop); };
    const stop = () => { done(); reject(signal!.reason); };
    const t = setTimeout(() => { done(); resolve(); }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
}

/** GBIF limits the request rate per address, more or less strictly with its load (its API reference names no number;
 *  measured 2026-11-26: 429 with Retry-After: 3 even one request at a time after ~10 quick facet requests, and
 *  retrying hard keeps an address throttled for minutes). So: up to four of our requests in flight while GBIF answers,
 *  down to one after a 429, back up by one every few answers; after a 429 every GBIF request waits out the pause GBIF
 *  asked for; and the panel's own requests go before background ones (tile names and photos). */
const GBIF_MAX = 4;
let gbifLimit = GBIF_MAX;
let gbifOk = 0;
let gbifBusy = 0;
let gbifPausedUntil = 0;
const gbifQueue: { high: (() => void)[]; low: (() => void)[] } = { high: [], low: [] };
const nextGbif = () => { while (gbifBusy < gbifLimit) { const r = gbifQueue.high.shift() ?? gbifQueue.low.shift(); if (!r) return; gbifBusy++; r(); } };
async function gbifSlot<T>(fn: () => Promise<T>, low: boolean, signal?: AbortSignal): Promise<T> {
  if (gbifBusy < gbifLimit) gbifBusy++;
  else await new Promise<void>((r) => gbifQueue[low ? 'low' : 'high'].push(r)); // nextGbif counts us in
  try {
    const wait = gbifPausedUntil - Date.now();
    if (wait > 0) await sleep(wait, signal); // a reader who moved on frees the slot at once
    const out = await fn();
    if (++gbifOk >= 3 && gbifLimit < GBIF_MAX) { gbifLimit++; gbifOk = 0; }
    return out;
  } catch (e) {
    // 429 (too many requests) and 5xx (busy or down) alike: everyone waits, then one request at a time
    if (e instanceof HttpError && (e.status === 429 || e.status >= 500)) {
      gbifLimit = 1; gbifOk = 0;
      gbifPausedUntil = Math.max(gbifPausedUntil, Date.now() + 1000 * (e.retryAfter ?? (e.status === 429 ? 3 : 2)) + Math.random() * 1000);
    }
    throw e;
  } finally { gbifBusy--; nextGbif(); }
}

export function isTransient(e: unknown): boolean {
  if (isAbort(e)) return false; // the reader moved on: do not retry
  if (e instanceof HttpError) return e.status >= 500 || e.status === 429;
  return e instanceof TypeError || isTimeout(e);
}

async function retry<T>(fn: () => Promise<T>, waits: number[], signal?: AbortSignal): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (signal?.aborted || !isTransient(e) || i >= waits.length) throw e;
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
}


const q = (o: Record<string, string | number>) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

// ---------- GBIF ----------
type Facet = { field: string; counts: { name: string; count: number }[] };
type Search = { count: number; facets?: Facet[] };
type Params = Record<string, string | number | (string | number)[]>;
/** Query string that repeats a key for each value of an array (GBIF reads repeated keys as OR). */
export const qs = (o: Params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) u.append(k, String(x));
  return u.toString();
};

/** Species recorded inside a polygon, by kind of animal. One facet request per group (in parallel): the group a
 *  species belongs to is the request that returned it, so no per-species lookup is needed. "Other" is what the
 *  all-animals request returned and no group did. */
/** `cut`: kinds of animal whose species list reached the facet limit (3,000), so their rarest species are missing. */
export interface Checklist { list: Taxon[]; records: number; truncated: boolean; cut: Taxon['group'][] }
/** `onAll` gets the all-animals answer as soon as it arrives (every species as group "other"): the count, records and
 *  Chao1 need nothing more, so the panel can show them while the per-group requests are still in GBIF's queue. */
/** `where`: the area as GBIF parameters ({ geometry: WKT } or { gadmGid: 'KEN.30_1' }). */
export type Where = Params;
export async function gbifChecklist(where: Where, signal?: AbortSignal, onAll?: (c: Checklist) => void): Promise<Checklist> {
  const LIMIT = 3000;
  const ask = (filter: Params) => getJSON<Search>(`${GBIF}/occurrence/search?${qs({
    ...CLEAN, ...where, limit: 0, facet: 'speciesKey', facetLimit: LIMIT, ...filter })}`, { signal, timeoutMs: 40000 });
  // One request for all animals, with record counts per class and phylum: GBIF limits the request rate, so the
  // per-group requests go out only for the kinds of animal that are there (planGroups). Birds and mammals are on
  // record nearly everywhere, land and sea, so they go out with it rather than after it.
  const early = new Map(GROUPS.filter((g) => g.id === 'birds' || g.id === 'mammals').map((g) => [g.id, ask(g.gbif!)]));
  for (const p of early.values()) p.catch(() => {}); // awaited below; not an unhandled rejection meanwhile
  const all = await ask({ facet: ['speciesKey', 'classKey', 'orderKey', 'phylumKey'] });
  const counts = (field: string) => all.facets?.find((f) => f.field === field)?.counts ?? [];
  const ac = counts('SPECIES_KEY');
  const truncated = ac.length >= LIMIT;
  onAll?.({ list: ac.map((x) => ({ key: Number(x.name), records: x.count, group: 'other' as const })), records: all.count, truncated, cut: [] });
  const byKey = new Map(['CLASS_KEY', 'ORDER_KEY', 'PHYLUM_KEY'].flatMap((f) => counts(f).map((x) => [Number(x.name), x.count] as const)));
  const plan = planGroups(all.count, byKey, !truncated, [...early.keys()]);
  const asked = GROUPS.filter((g) => plan.ask.includes(g.id) || early.has(g.id));
  const parts = await Promise.all(asked.map((g) => early.get(g.id) ?? ask(g.gbif!)));
  const out = new Map<number, Taxon>();
  const cut: Taxon['group'][] = [];
  asked.forEach((g, i) => {
    const c = parts[i].facets?.[0]?.counts ?? [];
    if (c.length >= LIMIT) cut.push(g.id);
    for (const x of c) out.set(Number(x.name), { key: Number(x.name), records: x.count, group: g.id });
  });
  // the group left to subtraction (or "other") is only complete when the all-animals list was
  if (truncated) cut.push(plan.rest);
  for (const x of ac) if (!out.has(Number(x.name))) out.set(Number(x.name), { key: Number(x.name), records: x.count, group: plan.rest });
  return { list: [...out.values()], records: all.count, truncated: cut.length > 0, cut };
}

/** Occurrence count for any filter (animals, clean coordinates). */
export async function gbifCount(filter: Params, signal?: AbortSignal): Promise<number> {
  const r = await getJSON<Search>(`${GBIF}/occurrence/search?${qs({ ...CLEAN, limit: 0, ...filter })}`, { signal });
  return r.count;
}
/** Records per vertical zone (ZONES) for a species: one request faceting the distinct elevation and depth values,
 *  instead of one count per zone (GBIF limits the request rate). Falls back to the counts if a facet list is cut. */
export interface Vertical { zones: number[]; values: [number, number][] | null }
export async function gbifVertical(key: number, signal?: AbortSignal): Promise<Vertical> {
  const LIMIT = 5000;
  const r = await getJSON<Search>(`${GBIF}/occurrence/search?${qs({ ...CLEAN, taxonKey: key, limit: 0, facet: ['elevation', 'depth'], facetLimit: LIMIT })}`, { signal });
  const f = (field: string) => r.facets?.find((x) => x.field === field)?.counts ?? [];
  if (f('ELEVATION').length < LIMIT && f('DEPTH').length < LIMIT) return { zones: zoneCounts(f('ELEVATION'), f('DEPTH')), values: signedHeights(f('ELEVATION'), f('DEPTH')) };
  // GBIF ranges include both ends: stop each zone just below the next one's start, so no record counts twice
  const zones = await Promise.all(ZONES.map((z, i) => {
    const next = ZONES.slice(0, i).reverse().find((o) => o.param === z.param && o.range[0] === z.range[1]);
    return gbifCount({ taxonKey: key, [z.param]: `${z.range[0]},${next ? z.range[1] - 0.01 : z.range[1]}` }, signal).catch(() => 0);
  }));
  return { zones, values: null };
}
/** Threatened species (IUCN CR, EN, VU) recorded inside a polygon, with their category: three facet requests. */
export async function gbifThreatenedIn(where: Where, signal?: AbortSignal): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const cats = ['CR', 'EN', 'VU'];
  const parts = await Promise.all(cats.map((cat) => gbifFacet({ ...where, iucnRedListCategory: cat }, 'speciesKey', 3000, signal)));
  parts.forEach((f, i) => { for (const x of f) if (!out.has(Number(x.name))) out.set(Number(x.name), cats[i]); });
  return out;
}
/** Records of each species worldwide (same clean filter as the lists), for "mostly found here": one facet request per
 *  250 species (GBIF reads repeated taxonKey as OR; about 4.5 kB of URL), so a list of 2,000 needs 8. */
export async function gbifGlobalCounts(keys: number[], signal?: AbortSignal, onPart?: (done: number) => void): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (let i = 0; i < keys.length; i += 250) {
    if (signal?.aborted) break;
    const part = keys.slice(i, i + 250);
    const f = await gbifFacet({ taxonKey: part }, 'speciesKey', part.length + 10, signal);
    for (const x of f) out.set(Number(x.name), x.count);
    onPart?.(Math.min(i + 250, keys.length));
  }
  return out;
}

/** GADM regions a point lies in (country, province, district), from GBIF's own geocoder: the ids GBIF filters by. */
export interface Region { id: string; level: number; name: string }
export async function gbifRegions(lat: number, lon: number, signal?: AbortSignal): Promise<Region[]> {
  const r = await getJSON<{ type: string; id: string; title: string; distance: number }[]>(`${GBIF}/geocode/reverse?${q({ lat: lat.toFixed(4), lng: lon.toFixed(4) })}`, { signal, timeoutMs: 15000 });
  const out: Region[] = [];
  for (const level of [0, 1, 2]) {
    const x = r.find((g) => g.type === `GADM${level}` && g.distance === 0);
    if (x) out.push({ id: x.id, level, name: x.title });
  }
  return out;
}
export async function gbifRegion(id: string, signal?: AbortSignal): Promise<Region & { type?: string; higher: string[] }> {
  const r = await getJSON<{ id: string; name: string; gadmLevel: number; englishType?: string[]; higherRegions?: { name: string }[] }>(`${GBIF}/geocode/gadm/${encodeURIComponent(id)}`, { signal, timeoutMs: 15000 });
  return { id: r.id, level: r.gadmLevel, name: r.name, type: r.englishType?.[0], higher: (r.higherRegions ?? []).map((h) => h.name) };
}

/** Outline of the region around a point at a GADM level, for the map only (GBIF filters by the GADM id itself):
 *  OpenStreetMap's boundary from Nominatim, simplified. Close to GADM's, not identical. */
export async function regionOutline(lat: number, lon: number, level: number, signal?: AbortSignal): Promise<GeoJSON.Geometry | null> {
  const zoom = [3, 5, 8][level] ?? 8;
  const r = await getJSON<{ geojson?: GeoJSON.Geometry }>(`https://nominatim.openstreetmap.org/reverse?${q({ format: 'jsonv2', lat: lat.toFixed(4), lon: lon.toFixed(4), zoom, polygon_geojson: 1, polygon_threshold: level === 0 ? 0.02 : 0.005 })}`, { signal, timeoutMs: 15000 }).catch(() => null);
  return r?.geojson && (r.geojson.type === 'Polygon' || r.geojson.type === 'MultiPolygon') ? r.geojson : null;
}

/** A protected area's whole outline by its name, near where it was clicked (the map tiles hold only pieces of it). */
export async function parkOutline(name: string, lat: number, lon: number, signal?: AbortSignal): Promise<GeoJSON.Geometry | null> {
  const d = 3;
  const r = await getJSON<{ geojson?: GeoJSON.Geometry; class?: string; type?: string }[]>(`https://nominatim.openstreetmap.org/search?${q({ format: 'jsonv2', q: name, polygon_geojson: 1, polygon_threshold: 0.002, limit: 5, viewbox: `${lon - d},${lat + d},${lon + d},${lat - d}`, bounded: 1 })}`, { signal, timeoutMs: 15000 }).catch(() => []);
  const hit = r.find((x) => (x.geojson?.type === 'Polygon' || x.geojson?.type === 'MultiPolygon') && /protected_area|national_park|nature_reserve|park/.test(`${x.class} ${x.type}`))
    ?? r.find((x) => x.geojson?.type === 'Polygon' || x.geojson?.type === 'MultiPolygon');
  return hit?.geojson ?? null;
}

/** Facet counts (month, year...) for any filter. */
export async function gbifFacet(filter: Params, facet: string, limit = 400, signal?: AbortSignal): Promise<{ name: string; count: number }[]> {
  const r = await getJSON<Search>(`${GBIF}/occurrence/search?${qs({ ...CLEAN, limit: 0, facet, facetLimit: limit, ...filter })}`, { signal });
  return r.facets?.[0]?.counts ?? [];
}

export interface GbifSpecies {
  key: number; scientificName: string; canonicalName?: string; vernacularName?: string; rank?: string; taxonomicStatus?: string;
  acceptedKey?: number; kingdom?: string; phylum?: string; class?: string; order?: string; family?: string;
  phylumKey?: number; classKey?: number; orderKey?: number; nubKey?: number; genus?: string; genusKey?: number; familyKey?: number;
}
export function gbifSpecies(key: number, signal?: AbortSignal, low = false): Promise<GbifSpecies> {
  return getJSON(`${GBIF}/species/${Math.trunc(key)}`, { signal, low });
}
/** Backbone key of the accepted species for a scientific name (exact matches only). */
export async function gbifMatch(name: string): Promise<number | null> {
  const r = await getJSON<{ usageKey?: number; acceptedUsageKey?: number; matchType?: string; rank?: string }>(`${GBIF}/species/match?${qs({ name, kingdom: 'Animalia', strict: 'true' })}`);
  if (!r.usageKey || r.matchType === 'NONE') return null;
  return r.acceptedUsageKey ?? r.usageKey;
}
/** Where a species' records sit, from a sample of up to 300 of them: the centre to fly to (longitudes on the circle). */
export async function gbifCentre(key: number, signal?: AbortSignal): Promise<{ lon: number; lat: number } | null> {
  // the occupied cells of the range, each weighted by its area: the first records GBIF returns (the old method) lean
  // to wherever observers are thickest (a cosmopolitan bird centred on Europe); one zoom-0 tile instead of 300 records
  const cells = await presenceCells(key, signal, 0, 128).catch(() => []);
  const { rangeCentre } = await import('./geo');
  return rangeCentre(cells);
}
/** Scientific names of a species' synonyms (canonical, no authors). */
export async function gbifSynonymNames(key: number, signal?: AbortSignal): Promise<string[]> {
  const r = await getJSON<{ results: { canonicalName?: string }[] }>(`${GBIF}/species/${Math.trunc(key)}/synonyms?limit=20`, { signal }).catch(() => null);
  return (r?.results ?? []).map((x) => x.canonicalName).filter((x): x is string => !!x);
}
/** Keys of a species' synonyms: Wikidata often files a taxon under an older or newer name's GBIF key. */
export async function gbifSynonyms(key: number, signal?: AbortSignal): Promise<number[]> {
  const r = await getJSON<{ results: { key: number }[] }>(`${GBIF}/species/${Math.trunc(key)}/synonyms?limit=20`, { signal }).catch(() => null);
  return (r?.results ?? []).map((x) => x.key);
}
export async function gbifEnglishName(key: number): Promise<string | null> {
  const r = await getJSON<{ results: { vernacularName: string; language: string }[] }>(`${GBIF}/species/${Math.trunc(key)}/vernacularNames?limit=100`).catch(() => null);
  return r?.results.find((v) => v.language === 'eng')?.vernacularName ?? null;
}
export async function gbifRedList(key: number, signal?: AbortSignal): Promise<string | null> {
  const r = await getJSON<{ code?: string }>(`${GBIF}/species/${Math.trunc(key)}/iucnRedListCategory`, { signal }).catch(() => null);
  return r?.code && r.code !== 'NE' ? r.code : null;
}

/** Species search by common or scientific name in the backbone, animals only. */
export async function gbifSearch(text: string, signal?: AbortSignal): Promise<GbifSpecies[]> {
  const r = await getJSON<{ results: GbifSpecies[] }>(`${GBIF}/species/search?${qs({ q: text, datasetKey: BACKBONE, highertaxonKey: 1, rank: 'SPECIES', limit: 20 })}`, { signal });
  return r.results ?? [];
}
export async function gbifSuggest(text: string, signal?: AbortSignal): Promise<GbifSpecies[]> {
  const r = await getJSON<GbifSpecies[]>(`${GBIF}/species/suggest?${qs({ q: text, datasetKey: BACKBONE, limit: 10 })}`, { signal });
  return (r ?? []).filter((x) => x.kingdom === 'Animalia');
}

/** One openly licensed photo from iNaturalist research-grade records in GBIF, for species Wikidata has none for. */
const INAT = '50c9509d-22c7-4a22-a47d-8c48425ef4a7';
/** `own`: served from this site (data/photos/), credit already names the source. */
export interface Photo { url: string; credit: string; licence: string; page: string; own?: boolean }
export async function gbifPhoto(key: number, signal?: AbortSignal, low = false): Promise<Photo | null> {
  const r = await getJSON<{ results: { key: number; media?: { identifier?: string; license?: string; rightsHolder?: string }[] }[] }>(
    `${GBIF}/occurrence/search?${qs({ taxonKey: key, mediaType: 'StillImage', datasetKey: INAT, limit: 10 })}`, { signal, low }).catch(() => null);
  for (const o of r?.results ?? []) for (const m of o.media ?? []) {
    const lic = licenceShort(m.license ?? '');
    if (!m.identifier || !/^(CC0|CC BY|CC BY-SA)$/.test(lic)) continue; // open licences only, no NC or ND
    return { url: m.identifier.replace(/\/original\.(jpe?g|png)$/i, '/medium.$1'), credit: m.rightsHolder ?? 'iNaturalist observer', licence: lic, page: `https://www.gbif.org/occurrence/${o.key}` };
  }
  return null;
}

/** Several openly licensed iNaturalist photos of a species from GBIF, one per observation, for the photo strip. */
export async function gbifPhotos(key: number, n = 8, signal?: AbortSignal): Promise<Photo[]> {
  const r = await getJSON<{ results: { key: number; media?: { identifier?: string; license?: string; rightsHolder?: string }[] }[] }>(
    `${GBIF}/occurrence/search?${qs({ taxonKey: key, mediaType: 'StillImage', datasetKey: INAT, limit: 60 })}`, { signal, low: true }).catch(() => null);
  const out: Photo[] = [];
  for (const o of r?.results ?? []) {
    const m = (o.media ?? []).find((x) => x.identifier && /^(CC0|CC BY|CC BY-SA)$/.test(licenceShort(x.license ?? '')));
    if (!m) continue;
    out.push({ url: m.identifier!.replace(/\/original\.(jpe?g|png)$/i, '/medium.$1'), credit: m.rightsHolder ?? 'iNaturalist observer', licence: licenceShort(m.license ?? ''), page: `https://www.gbif.org/occurrence/${o.key}` });
    if (out.length >= n) break;
  }
  return out;
}

/** iNaturalist's best-liked research-grade photos of the animal itself (annotation "Evidence of presence: Organism",
 *  so no tracks, scat or empty camera-trap frames), open licences only (CC0, CC BY, CC BY-SA). API v2 with a field
 *  list: about 5 kB instead of 1 MB. */
export async function inatPhotos(sci: string, n = 8, signal?: AbortSignal): Promise<Photo[]> {
  const LIC: Record<string, string> = { cc0: 'CC0', 'cc-by': 'CC BY', 'cc-by-sa': 'CC BY-SA' };
  const r = await getJSON<{ results: { id: number; photos?: { url?: string; license_code?: string; attribution?: string }[] }[] }>(
    `https://api.inaturalist.org/v2/observations?${q({ taxon_name: sci, photo_license: 'cc0,cc-by,cc-by-sa', quality_grade: 'research', term_id: 22, term_value_id: 24, order_by: 'votes', per_page: n, fields: 'id,photos.url,photos.license_code,photos.attribution' })}`,
    { signal, timeoutMs: 9000 });
  const out: Photo[] = [];
  for (const o of r.results ?? []) {
    const p = (o.photos ?? []).find((x) => x.url && x.license_code && LIC[x.license_code]);
    if (p) out.push({ url: p.url!.replace('/square.', '/medium.'), credit: (p.attribution ?? '').replace(/^\(c\)\s*/, '').replace(/,\s*some rights reserved.*$|,\s*no rights reserved.*$/i, '') || 'iNaturalist observer', licence: LIC[p.license_code!], page: `https://www.inaturalist.org/observations/${o.id}` });
  }
  return out;
}

/** The most recorded relatives of a species: others in its genus, or in its family when the genus has few. */
export async function gbifRelatives(sp: GbifSpecies, n = 8, signal?: AbortSignal): Promise<{ by: 'genus' | 'family'; list: { key: number; records: number }[] }> {
  const ask = async (f: Params) => (await gbifFacet(f, 'speciesKey', n + 1, signal)).map((x) => ({ key: Number(x.name), records: x.count })).filter((x) => x.key !== sp.key).slice(0, n);
  const g = sp.genusKey ? await ask({ genusKey: sp.genusKey }) : [];
  if (g.length >= 3 || !sp.familyKey) return { by: 'genus', list: g };
  return { by: 'family', list: await ask({ familyKey: sp.familyKey }) };
}

/** Short licence name from a URL or a rights statement. Order matters: the most specific terms first. */
export function licenceShort(text: string): string {
  const t = text.replace(/\s+/g, ' ');
  if (/CC0|public domain|creativecommons\.org\/publicdomain/i.test(t)) return 'CC0';
  const url = /creativecommons\.org\/licenses\/([a-z-]+)/i.exec(t)?.[1]?.toLowerCase();
  const parts = url ? url.split('-') : null;
  const has = (k: 'nc' | 'nd' | 'sa', words: RegExp) => (parts ? parts.includes(k) : words.test(t));
  const by = parts ? parts.includes('by') : /CC[- _]?BY|Attribution/i.test(t);
  if (!by) return 'see source';
  const nc = has('nc', /\bNC\b|non-?commercial/i), nd = has('nd', /\bND\b|no ?deriv/i), sa = has('sa', /\bSA\b|share ?alike/i);
  return ['CC BY', nc && 'NC', nd ? 'ND' : sa && 'SA'].filter(Boolean).join('-');
}

/** GBIF map tiles for a filter the density tiles ignore (month: checked 2026-11-27, the density tile of a month is
 *  byte for byte the all-year one). The adhoc map runs an occurrence search per tile, so it is slower and shares the
 *  search rate limit: callers load few of them. */
export function gbifAdhocTiles(filter: Record<string, string | number>, style = 'classic-noborder.poly'): string {
  return `https://api.gbif.org/v2/map/occurrence/adhoc/{z}/{x}/{y}@1x.png?${qs({ srs: 'EPSG:3857', style, basisOfRecord: WILD_BASIS, hasGeospatialIssue: 'false', ...filter })}`;
}

/** GBIF density map tiles, for a species, a period or all animals. Square cells, not hexagons: a power-of-two square
 *  grid nests from one zoom to the next, so the globe (which mixes tile zooms across the view) shows no cut cells at
 *  tile edges. `squareSize` is in GBIF's 4096-unit tile space (64 = 8 px of the 512-px tile, 4 px on screen; near the
 *  poles the globe shows lower-zoom tiles, so cells there come out bigger). */
export function gbifTiles(filter: Record<string, string | number>, style = 'classic-noborder.poly', squareSize = 64): string {
  return `https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@1x.png?${qs({ srs: 'EPSG:3857', bin: 'square', squareSize, style, basisOfRecord: WILD_BASIS, ...filter })}`;
}

// ---------- the well-known animals: names and the site's own photos (pages/build.ts writes data/known.json) ----------
export type KnownRow = [name: string, uz: string, sci: string, credit: string, licence: string, page: string, redlist?: string];
let knownP: Promise<Record<string, KnownRow>> | null = null;
/** Loaded once, on first use; a missing file (a build without page data) is an empty index. */
export function knownIndex(base: string): Promise<Record<string, KnownRow>> {
  knownP ??= fetch(`${base}data/known.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return knownP;
}

/** Wikidata photo (Commons file name) for each scientific name, following an old name to the accepted taxon: one
 *  query per 60 names. Keys are the names lower-cased. For lists that have names but no GBIF keys (MiCO). */
export async function photosByName(names: string[], signal?: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < names.length; i += 60) {
    const chunk = names.slice(i, i + 60);
    const query = `${PREFIXES}SELECT ?name (SAMPLE(?img) AS ?image) WHERE {
  VALUES ?name { ${chunk.map(literal).join(' ')} }
  ?item0 wdt:P225 ?name . OPTIONAL { ?item0 wdt:P12765 ?acc } BIND(COALESCE(?acc, ?item0) AS ?item)
  ?item wdt:P18 ?img
} GROUP BY ?name`;
    const b = await sparql(query, signal);
    for (const r of b ?? []) {
      const file = r.image?.value ? /Special:FilePath\/(.+)$/.exec(r.image.value)?.[1] : undefined;
      if (r.name?.value && file && !/\.(svg|gif)$/i.test(file)) out.set(r.name.value.toLowerCase(), decodeURIComponent(file).replace(/_/g, ' '));
    }
  }
  return out;
}

/** Where a species has been recorded, as cells of a 256 x 256 Web Mercator grid (~156 km at the equator): read from
 *  GBIF's density map tiles at zoom 2 (16 tiles, square bins of 8 px), a cell counting when its square is coloured.
 *  Sixteen small images instead of thousands of records; the same wild-records filter as the map. */
export async function presenceCells(taxonKey: number, signal?: AbortSignal, Z = 2, squareSize = 64): Promise<import('./science').Cell[]> {
  const { mercatorCell } = await import('./science');
  const T = 2 ** Z, PER = 4096 / squareSize, N = T * PER, out: import('./science').Cell[] = [];
  await Promise.all(Array.from({ length: T * T }, async (_, i) => {
    const tx = i % T, ty = Math.floor(i / T);
    const url = `https://api.gbif.org/v2/map/occurrence/density/${Z}/${tx}/${ty}@1x.png?${qs({ srs: 'EPSG:3857', bin: 'square', squareSize, style: 'classic-noborder.poly', basisOfRecord: WILD_BASIS, taxonKey })}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new HttpError(res.status, url);
    const blob = await res.blob();
    if (!blob.size) return; // 204: no records in this tile
    const bmp = await createImageBitmap(blob);
    const W = bmp.width, step = W / PER;
    const c = new OffscreenCanvas(W, bmp.height), g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0); bmp.close();
    const px = g.getImageData(0, 0, W, W).data;
    for (let cy = 0; cy < PER; cy++) for (let cx = 0; cx < PER; cx++) {
      const x = Math.floor(cx * step + step / 2), y = Math.floor(cy * step + step / 2);
      if (px[(y * W + x) * 4 + 3] > 0) out.push({ bbox: mercatorCell(tx * PER + cx, ty * PER + cy, N), n: 1 });
    }
  }));
  return out;
}

// ---------- tag tracks (stored: scripts/fetch_tracks.py writes data/tracks/) ----------
let trackIndexP: Promise<Record<string, number>> | null = null;
/** Species (GBIF key) with stored tag tracks, and how many animals were drawn. Empty when the site has none. */
export function tagTrackIndex(base: string): Promise<Record<string, number>> {
  trackIndexP ??= fetch(`${base}data/tracks/index.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return trackIndexP;
}
export function tagTracks(base: string, key: number): Promise<import('./tracks').TagTracks> { return getJSON(`${base}data/tracks/${Math.trunc(key)}.json`); }

// ---------- MiCO (stored, see scripts/build_mico.mjs; keyed by WoRMS id, matched here by scientific name) ----------
export interface MicoMeta { common: string; scientific: string; group: string; sites: number; routes: number; tracked: number }
export interface MicoIndex { source: string; species: Record<string, MicoMeta> }
export interface MicoSpecies { common: string; scientific: string; group: string; sites: [number, number, number, string][]; routes: [number, number, number, number, number, number][] }
/** Country pages the site has: ISO 3166-1 alpha-2 -> slug (pages/build.ts writes data/places.json). */
let placePagesP: Promise<Record<string, string>> | null = null;
export function placePages(base: string): Promise<Record<string, string>> {
  placePagesP ??= fetch(`${base}data/places.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return placePagesP;
}
export function micoIndex(base: string): Promise<MicoIndex> { return getJSON(`${base}data/mico/index.json`); }
export function micoSpecies(base: string, id: number): Promise<MicoSpecies> { return getJSON(`${base}data/mico/${id}.json`); }

// ---------- Wikidata / Commons / Wikipedia ----------
/** Language for names and Wikipedia: the interface language when the reader chose one, else the browser's. */
export function readerLanguage(): string {
  try { const saved = typeof window !== 'undefined' ? window.localStorage.getItem('lang') : null; if (saved && /^[a-z]{2,3}$/.test(saved)) return saved; } catch { /* blocked */ }
  const l = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase().split('-')[0];
  return /^[a-z]{2,3}$/.test(l) ? l : 'en';
}

/** Primary endpoint: QLever (a fast public mirror of Wikidata, CORS *); fallback: the Wikidata Query Service, which
 *  is often rate-limited (seen on 2026-11-25: "1 req / min" during an outage). */
const SPARQL_ENDPOINTS = ['https://qlever.dev/api/wikidata', 'https://query.wikidata.org/sparql'];
const PREFIXES = `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>
`;
type Bindings = { results: { bindings: Record<string, { value: string }>[] } };
const safe = (lang: string) => (/^[a-z]{2,3}$/.test(lang) ? lang : 'en');
const literal = (s: string) => `"${s.replace(/[\\"]/g, '').replace(/[\r\n]/g, ' ')}"`;

/** Facts for taxa found either by GBIF id (P846; the binding is still called ?aphia) or by scientific name (P225, ?name). */
export function speciesQuery(ids: number[], lang: string, by: 'aphia' | 'name' = 'aphia', names: string[] = []): string {
  const l = safe(lang);
  const values = by === 'aphia' ? ids.filter(Number.isInteger).map((id) => `"${id}"`).join(' ') : names.map(literal).join(' ');
  // an old name's item (Sterna bergii) often has no photo; P12765 points to the accepted taxon's item, which does
  const match = `${by === 'aphia' ? '?item0 wdt:P846 ?aphia .' : '?item0 wdt:P225 ?name .'}
  OPTIONAL { ?item0 wdt:P12765 ?acc } BIND(COALESCE(?acc, ?item0) AS ?item)`;
  return `${PREFIXES}SELECT ?${by} (SAMPLE(?img) AS ?image) (SAMPLE(?cn) AS ?common) (SAMPLE(?lab) AS ?label)
  (SAMPLE(?cnEn) AS ?commonEn) (SAMPLE(?labEn) AS ?labelEn) (SAMPLE(?art) AS ?article) (SAMPLE(?artEn) AS ?articleEn) (SAMPLE(?sciName) AS ?sci) WHERE {
  VALUES ?${by} { ${values} }
  ${match}
  OPTIONAL { ?item wdt:P18 ?img FILTER(!REGEX(STR(?img), "\\\\.(svg|gif)$", "i")) } # a photo, not a drawing
  OPTIONAL { ?item wdt:P225 ?sciName }
  OPTIONAL { ?item wdt:P1843 ?cn FILTER(LANG(?cn) = "${l}") }
  OPTIONAL { ?item rdfs:label ?lab FILTER(LANG(?lab) = "${l}") }
  OPTIONAL { ?item wdt:P1843 ?cnEn FILTER(LANG(?cnEn) = "en") }
  OPTIONAL { ?item rdfs:label ?labEn FILTER(LANG(?labEn) = "en") }
  OPTIONAL { ?art schema:about ?item ; schema:isPartOf <https://${l}.wikipedia.org/> }
  OPTIONAL { ?artEn schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
} GROUP BY ?${by}`;
}

async function sparql(query: string, signal?: AbortSignal): Promise<Bindings['results']['bindings'] | null> {
  for (const ep of SPARQL_ENDPOINTS) {
    const r = await getJSON<Bindings>(`${ep}?${q({ query })}`, { init: { headers: { Accept: 'application/sparql-results+json' } }, timeoutMs: 15000, signal }).catch(() => null);
    if (r?.results?.bindings) return r.results.bindings;
    if (signal?.aborted) return null;
  }
  return null;
}

/** Wikidata facts for WoRMS ids. Items that lack a WoRMS id (common for birds) are looked up again by scientific name,
 *  which is how a little pied cormorant gets its photo. */
export async function wikidataByAphia(ids: number[], sciById?: Map<number, string>, lang = readerLanguage(), signal?: AbortSignal): Promise<Map<number, WikiInfo>> {
  const out = new Map<number, WikiInfo>();
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += 60) chunks.push(ids.slice(i, i + 60));
  await Promise.all(chunks.map(async (chunk) => {
    const b = await sparql(speciesQuery(chunk, lang), signal);
    if (b) for (const [k, v] of parseWikidata(b, sciById, lang)) out.set(k, v);
  }));
  if (!sciById) return out;
  const missing = ids.filter((id) => !out.get(id)?.image && sciById.get(id));
  if (!missing.length) return out;
  const idByName = new Map(missing.map((id) => [sciById.get(id)!, id]));
  const names = [...idByName.keys()];
  for (let i = 0; i < names.length; i += 60) {
    const b = await sparql(speciesQuery([], lang, 'name', names.slice(i, i + 60)), signal);
    if (!b) continue;
    const keyed = b.map((x) => ({ ...x, aphia: { value: String(idByName.get(x.name?.value ?? '') ?? '') } }));
    for (const [k, v] of parseWikidata(keyed, sciById, lang)) {
      const had = out.get(k) ?? {};
      out.set(k, { ...v, ...Object.fromEntries(Object.entries(had).filter(([, x]) => x != null)) });
    }
  }
  return out;
}

/** GBIF ids for a name typed in any language ("kit akula", "китовая акула"), through Wikidata's own label search. */
export async function wikidataSearchAphia(text: string, lang = readerLanguage(), signal?: AbortSignal): Promise<number[]> {
  const r = await getJSON<{ search?: { id: string }[] }>(`https://www.wikidata.org/w/api.php?${q({
    action: 'wbsearchentities', search: text, language: safe(lang), uselang: safe(lang), type: 'item', limit: 12, format: 'json', origin: '*',
  })}`, { signal, timeoutMs: 10000 }).catch(() => null);
  const qids = (r?.search ?? []).map((s) => s.id).filter((id) => /^Q\d+$/.test(id));
  if (!qids.length) return [];
  const b = await sparql(`${PREFIXES}SELECT ?item ?aphia WHERE { VALUES ?item { ${qids.map((x) => `wd:${x}`).join(' ')} } ?item wdt:P846 ?aphia . }`, signal);
  const byQ = new Map((b ?? []).map((x) => [x.item.value.split('/').pop()!, Number(x.aphia.value)]));
  return qids.map((x) => byQ.get(x)).filter((n): n is number => Number.isInteger(n));
}

/** A sound recording (P51) and body size and lifespan quantities (P2067 mass, P2043 length, P2250 life expectancy)
 *  for one taxon under any of its GBIF keys (Wikidata files the snow leopard under a synonym's key), following an old
 *  name to the accepted taxon like the photo query does. */
export async function wikidataExtras(ids: number[], signal?: AbortSignal): Promise<{ audio?: string; rows: Record<string, { value: string }>[] }> {
  const query = `${PREFIXES}PREFIX p: <http://www.wikidata.org/prop/>
PREFIX psv: <http://www.wikidata.org/prop/statement/value/>
PREFIX wikibase: <http://wikiba.se/ontology#>
SELECT ?audio ?massAmt ?massUnit ?lenAmt ?lenUnit ?lifeAmt ?lifeUnit ?spanAmt ?spanUnit ?rank WHERE {
  VALUES ?gbif { ${ids.filter(Number.isInteger).map((x) => `"${x}"`).join(' ')} }
  ?item0 wdt:P846 ?gbif . OPTIONAL { ?item0 wdt:P12765 ?acc } BIND(COALESCE(?acc, ?item0) AS ?item)
  { ?item wdt:P51 ?audio } UNION
  { ?item p:P2067 ?st . ?st wikibase:rank ?rank ; psv:P2067 [ wikibase:quantityAmount ?massAmt ; wikibase:quantityUnit ?massUnit ] } UNION
  { ?item p:P2043 ?st . ?st wikibase:rank ?rank ; psv:P2043 [ wikibase:quantityAmount ?lenAmt ; wikibase:quantityUnit ?lenUnit ] } UNION
  { ?item p:P2250 ?st . ?st wikibase:rank ?rank ; psv:P2250 [ wikibase:quantityAmount ?lifeAmt ; wikibase:quantityUnit ?lifeUnit ] } UNION
  { ?item p:P2050 ?st . ?st wikibase:rank ?rank ; psv:P2050 [ wikibase:quantityAmount ?spanAmt ; wikibase:quantityUnit ?spanUnit ] }
} LIMIT 80`;
  const b = (await sparql(query, signal)) ?? [];
  const audioUrl = b.find((x) => x.audio)?.audio?.value;
  const audio = audioUrl ? /Special:FilePath\/(.+)$/.exec(audioUrl)?.[1] : undefined;
  return { audio: audio ? decodeURIComponent(audio).replace(/_/g, ' ') : undefined, rows: b };
}

export interface Credit { artist: string; licence: string; page: string }
export async function commonsCredits(files: string[]): Promise<Map<string, Credit>> {
  const out = new Map<string, Credit>();
  const strip = (s?: string) => (s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  const chunks: string[][] = [];
  for (let i = 0; i < files.length; i += 40) chunks.push(files.slice(i, i + 40));
  await Promise.all(chunks.map(async (chunk) => {
    const titles = chunk.map((f) => `File:${f}`).join('|');
    const r = await getJSON<{ query?: { normalized?: { from: string; to: string }[]; pages: Record<string, { title: string; imageinfo?: { extmetadata?: Record<string, { value: string }>; descriptionurl?: string }[] }> } }>(
      `https://commons.wikimedia.org/w/api.php?${q({ action: 'query', titles, prop: 'imageinfo', iiprop: 'extmetadata|url', format: 'json', origin: '*' })}`,
    ).catch(() => null);
    if (!r?.query) return;
    const back = new Map((r.query.normalized ?? []).map((n) => [n.to, n.from]));
    for (const p of Object.values(r.query.pages)) {
      const ii = p.imageinfo?.[0];
      if (!ii) continue;
      const title = back.get(p.title) ?? p.title;
      out.set(title.replace(/^File:/, ''), {
        artist: strip(ii.extmetadata?.Artist?.value) || 'Unknown author',
        licence: strip(ii.extmetadata?.LicenseShortName?.value) || 'see file page',
        page: ii.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
      });
    }
  }));
  return out;
}

export async function wikipediaSummary(title: string, lang = 'en'): Promise<{ extract: string; url: string; lang: string } | null> {
  const l = safe(lang);
  const r = await getJSON<{ extract?: string; content_urls?: { desktop?: { page?: string } }; type?: string }>(
    `https://${l}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
  ).catch(() => null);
  if (!r?.extract || r.type === 'disambiguation') return null;
  return { extract: r.extract, url: r.content_urls?.desktop?.page ?? `https://${l}.wikipedia.org/wiki/${encodeURIComponent(title)}`, lang: l };
}

// ---------- Marine Regions ----------
type Gaz = { preferredGazetteerName: string; placeType: string; latitude?: number; longitude?: number; MRGID?: number;
  minLatitude?: number | null; maxLatitude?: number | null; minLongitude?: number | null; maxLongitude?: number | null };
const LOCAL = ['Reef', 'Bay', 'Gulf', 'Strait', 'Sound', 'Lagoon', 'Fjord', 'Estuary', 'Sea', 'Lake'];
const WATER = new Set(['IHO Sea Area', 'EEZ', 'Territorial Sea', 'Internal waters', 'High Seas', 'Ocean', 'Sea']);

export interface PlaceName { name: string; land: boolean }

export async function seaName(lat: number, lon: number, signal?: AbortSignal): Promise<PlaceName | null> {
  const r = await getJSON<Gaz[]>(
    `https://www.marineregions.org/rest/getGazetteerRecordsByLatLong.json/${lat.toFixed(3)}/${lon.toFixed(3)}/`, { timeoutMs: 12000, signal },
  ).catch(() => []);
  return pickSeaName(r);
}

/** Most specific water body plus its sea ("Great Barrier Reef, Coral Sea"); a country name when the point is on land. */
export function pickSeaName(r: Gaz[]): PlaceName | null {
  if (!r.length) return null;
  if (!r.some((x) => WATER.has(x.placeType) || x.placeType === 'Lake')) {
    const nation = r.find((x) => x.placeType === 'Nation') ?? r.find((x) => x.placeType === 'Continent');
    return nation ? { name: nation.preferredGazetteerName, land: true } : null;
  }
  const iho = r.filter((x) => x.placeType === 'IHO Sea Area').map((x) => x.preferredGazetteerName);
  // a named sea ("Coral Sea") is more useful than the ocean around it ("South Pacific Ocean")
  const sea = iho.find((n) => !/Ocean/.test(n)) ?? iho[0] ?? r.find((x) => x.placeType === 'Ocean')?.preferredGazetteerName;
  const local = LOCAL.map((t) => r.find((x) => x.placeType === t)).find(Boolean)?.preferredGazetteerName;
  if (local && sea && local !== sea) return { name: `${local}, ${sea}`, land: false };
  const name = local ?? sea;
  return name ? { name, land: false } : null;
}


// ---------- places on land and at sea ----------
export interface Place { name: string; type: string; lat: number; lon: number; bbox?: [number, number, number, number] }
type PhotonF = { geometry: { coordinates: [number, number] }; properties: { name?: string; osm_value?: string; country?: string; state?: string; extent?: [number, number, number, number] } };
/** OpenStreetMap kinds of place worth flying to; not shops, artworks or single houses. */
const PLACE_KINDS = new Set(['country', 'state', 'region', 'province', 'county', 'district', 'city', 'town', 'village', 'hamlet', 'municipality',
  'island', 'islet', 'archipelago', 'lake', 'reservoir', 'sea', 'bay', 'strait', 'ocean', 'river', 'water', 'wetland', 'glacier', 'peak',
  'mountain_range', 'ridge', 'volcano', 'valley', 'plateau', 'desert', 'forest', 'wood', 'national_park', 'nature_reserve', 'protected_area',
  'park', 'reef', 'cape', 'peninsula', 'beach', 'locality', 'administrative', 'continent']);
const MAJOR_PLACES = new Set(['country', 'state', 'city', 'capital', 'sea', 'ocean', 'lake', 'island', 'national_park', 'continent', 'bay', 'strait']);
/** Places by name from Photon (OpenStreetMap): countries, regions, cities, parks, lakes, seas, islands, mountains. */
export async function searchPlaces(text: string, lang: string, signal?: AbortSignal): Promise<Place[]> {
  const r = await getJSON<{ features: PhotonF[] }>(`https://photon.komoot.io/api/?${q({ q: text, limit: 6, lang: lang === 'en' ? 'en' : 'default' })}`, { signal, timeoutMs: 10000 }).catch(() => null);
  const seen = new Set<string>();
  const out: Place[] = [];
  const ql = text.trim().toLowerCase();
  for (const [i, f] of (r?.features ?? []).entries()) {
    const p = f.properties;
    if (!p.name || !PLACE_KINDS.has(p.osm_value ?? '')) continue;
    // Photon matches loosely ("qor qoploni" finds a "Qoʻrgʻoni"): keep names that contain the query or start with its first word
    const nl = p.name.toLowerCase();
    // but keep Photon's top answer when it is a major place: "Toshkent" comes back as "Tashkent"
    const major = i === 0 && MAJOR_PLACES.has(p.osm_value ?? '');
    if (!major && !nl.includes(ql) && !nl.startsWith(ql.split(/\s+/)[0])) continue;
    const where = [p.state, p.country].filter((x) => x && x !== p.name).join(', ');
    const key = `${p.name}|${where}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const e = p.extent; // Photon: [west, north, east, south]
    out.push({ name: p.name, type: [p.osm_value?.replace(/_/g, ' '), where].filter(Boolean).join(', '), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      bbox: e ? [e[0], e[3], e[2], e[1]] : undefined });
    if (out.length >= 4) break;
  }
  return out;
}

/** Name of a clicked point: the sea from Marine Regions, else district, region and country from Nominatim. */
export async function placeName(lat: number, lon: number, lang: string, signal?: AbortSignal): Promise<{ name: string; sea: boolean; cc?: string } | null> {
  // land first: Marine Regions also returns lakes whose outline box reaches far inland (the Serengeti came back as
  // "Victoria, Lake"); Nominatim has no address at open sea, and then the sea name is the answer
  const r = await getJSON<{ address?: Record<string, string> }>(`https://nominatim.openstreetmap.org/reverse?${q({ format: 'jsonv2', lat: lat.toFixed(4), lon: lon.toFixed(4), zoom: 8, 'accept-language': lang === 'en' ? 'en' : `${lang},en` })}`,
    { signal, timeoutMs: 10000 }).catch(() => null);
  const a = r?.address;
  if (!a || !a.country) {
    const sea = await seaName(lat, lon, signal);
    return sea ? { name: sea.name, sea: !sea.land } : null;
  }
  const parts = [a.county ?? a.city ?? a.town ?? a.state_district, a.state, a.country].filter(Boolean);
  return { name: [...new Set(parts)].join(', '), sea: false, cc: a.country_code?.toUpperCase() };
}
