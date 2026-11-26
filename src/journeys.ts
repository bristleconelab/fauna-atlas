// Species-page sections about movement and time:
//   "How it travels"      MiCO migration network for sea animals (stored; matched by scientific name or a GBIF synonym)
//   "When it is recorded"  records by month north and south of the equator, and by decade (GBIF facets)
import * as api from './api';
import { h, fmt, plural } from './dom';
import { greatCircle } from './geo';
import { ACTIVITY_COLORS, type ActivityKind } from './map';
import { decadeCounts } from './tracks';
import { L, lang, MONTHS_UZ } from './i18n';

export type Overlay = 'micoRoutes' | 'micoSites';
export interface JourneyHost {
  setOverlay(source: Overlay, fc: GeoJSON.FeatureCollection | null): void;
  fitTo(points: [number, number][]): void;
  base: string;
}

const FULL_MONTHS = lang === 'uz' ? MONTHS_UZ : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS = FULL_MONTHS.map((m) => m.slice(0, 3));
const ext = { target: '_blank', rel: 'noopener' };
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });

/** MiCO activity words ("Breeding;Feeding", "Staging Site", "Wintering") to the few kinds the map colours. */
export function activityKind(act: string): ActivityKind {
  if (/breed|nest|calv|pup|spawn|nurser|hatch|fledg|rear/i.test(act)) return 'breeding';
  if (/feed|forag/i.test(act)) return 'feeding';
  if (/migrat|stopover|staging|homing/i.test(act)) return 'migrating';
  if (/winter|summer|hibernat/i.test(act)) return 'season';
  return 'observed';
}
export const ACTIVITY_LABEL: Record<ActivityKind, string> = lang === 'uz'
  ? { breeding: 'koʻpayish, uya yoki bolalash', feeding: 'oziqlanish', migrating: 'yoʻldagi toʻxtash', season: 'mavsumni oʻtkazadi', observed: 'koʻrilgan' }
  : { breeding: 'breeding, nesting or nursery', feeding: 'feeding', migrating: 'stopover on the move', season: 'spends a season', observed: 'seen' };

/** The busiest run of three consecutive months (wrapping Dec to Jan), or null when records are spread evenly. */
export function peakSeason(m: number[]): { from: number; to: number; share: number } | null {
  const total = m.reduce((a, b) => a + b, 0);
  if (total < 30) return null;
  let best = 0, at = 0;
  for (let i = 0; i < 12; i++) {
    const s = m[i] + m[(i + 1) % 12] + m[(i + 2) % 12];
    if (s > best) { best = s; at = i; }
  }
  const share = best / total;
  return share >= 0.4 ? { from: at, to: (at + 2) % 12, share } : null;
}

/** Month counts (index 0 = January) from a GBIF month facet. */
export function monthsFromFacet(f: { name: string; count: number }[]): number[] {
  const m = new Array(12).fill(0);
  for (const x of f) { const k = Number(x.name); if (k >= 1 && k <= 12) m[k - 1] += x.count; }
  return m;
}

/** `names`: other scientific names of the species (GBIF synonyms): MiCO follows WoRMS, which may file it under one. */
export interface JourneyOpts { id: number; commonName: string; sci: string; names?: string[]; signal: AbortSignal }

export function renderJourneys(o: JourneyOpts, mount: HTMLElement, host: JourneyHost, alive: () => boolean): () => void {
  let stopped = false;
  const cleanup = () => { stopped = true; host.setOverlay('micoSites', null); host.setOverlay('micoRoutes', null); };
  const ok = () => alive() && !stopped;
  const travel = h('section', { class: 'journeys', attrs: { hidden: true } }, h('h3', { text: L('How it travels', 'Qanday sayohat qiladi') }));
  const when = h('section', { class: 'seasons' }, h('h3', { text: L('When it is recorded', 'Qachon qayd etilgan') }), h('p', { class: 'fine', text: L('Loading…', 'Yuklanmoqda…') }));
  mount.append(travel, when);

  // ---- MiCO, for the 109 sea animals it covers ----
  api.micoIndex(host.base).then(async (idx) => {
    const names = new Set([o.sci, ...(o.names ?? [])].map((x) => x.toLowerCase()));
    const hit = Object.entries(idx.species).find(([, m]) => names.has(m.scientific.toLowerCase()));
    if (!hit || !ok()) return;
    const [wormsId] = hit;
    const d = await api.micoSpecies(host.base, Number(wormsId));
    if (!ok()) return;
    travel.hidden = false;
    const sites = fc(d.sites.map(([lon, lat, n, act]) => ({ type: 'Feature', properties: { n, kind: activityKind(act), act, species: o.commonName }, geometry: { type: 'Point', coordinates: [lon, lat] } })));
    const routes = fc(d.routes.map(([x1, y1, x2, y2, tracked, both]) => ({ type: 'Feature', properties: { tracked, both, species: o.commonName }, geometry: { type: 'LineString', coordinates: greatCircle([x1, y1], [x2, y2], 24) } })));
    const points = d.sites.map(([lon, lat]) => [lon, lat] as [number, number]);
    host.setOverlay('micoSites', sites);
    host.setOverlay('micoRoutes', routes);
    const kinds = [...new Set(sites.features.map((f) => f.properties!.kind as ActivityKind))];
    const tracked = d.routes.filter((r) => r[4]).length, inferred = d.routes.length - tracked;
    const frame = h('button', { class: 'btn small quiet', text: L('Show on the globe', 'Globusda koʻrsatish'), on: { click: () => host.fitTo(points) } });
    travel.append(
      h('p', { text: L(`Migration network: ${plural(d.sites.length, 'place')} where this species gathers${d.routes.length ? ` and ${plural(d.routes.length, 'link')} between them` : ''}, from published tracking and tagging studies.`,
        `Migratsiya tarmogʻi: bu tur toʻplanadigan ${fmt(d.sites.length)} ta joy${d.routes.length ? ` va ular orasidagi ${fmt(d.routes.length)} ta bogʻlanish` : ''}; eʼlon qilingan kuzatuv va belgilash tadqiqotlaridan.`) }),
      h('ul', { class: 'legend-dots' }, ...kinds.map((k) => h('li', {}, h('span', { class: 'dot', attrs: { style: `background:${ACTIVITY_COLORS[k]}` } }), ACTIVITY_LABEL[k])),
        tracked ? h('li', {}, h('span', { class: 'line' }), L(`followed by tagged animals (${fmt(tracked)})`, `belgilangan hayvonlar bosib oʻtgan (${fmt(tracked)})`)) : null,
        inferred ? h('li', {}, h('span', { class: 'line dashed' }), L(`linked by other studies (${fmt(inferred)})`, `boshqa tadqiqotlar bogʻlagan (${fmt(inferred)})`)) : null),
      h('div', { class: 'btn-row' }, frame,
        h('a', { class: 'btn small quiet', text: L('Tag tracks in Ocean Life Atlas', 'Ocean Life Atlas da belgi yoʻllari'), attrs: { href: `https://oceanlife.bristleconelab.org/#sp=${wormsId}`, ...ext } })),
      h('p', { class: 'fine' }, L('Lines join two places the animals use, not the path swum. ', 'Chiziqlar suzilgan yoʻlni emas, hayvonlar foydalanadigan ikki joyni bogʻlaydi. '), 'MiCO, ',
        h('a', { text: 'Bentley et al. 2025', attrs: { href: 'https://doi.org/10.1038/s41467-025-59271-7', ...ext } }), ', CC0.'));
  }).catch(() => {});

  // ---- seasons and decades ----
  Promise.all([
    api.gbifFacet({ taxonKey: o.id, decimalLatitude: '0,90' }, 'month', 12, o.signal).catch(() => []),
    // the equator (0) counts once, as north
    api.gbifFacet({ taxonKey: o.id, decimalLatitude: '-90,-0.000001' }, 'month', 12, o.signal).catch(() => []),
    api.gbifFacet({ taxonKey: o.id }, 'year', 400, o.signal).catch(() => []),
  ]).then(([n, s, y]) => {
    if (!ok()) return;
    renderSeasons(when, monthsFromFacet(n), monthsFromFacet(s), decadeCounts(y.map((x) => ({ year: Number(x.name), records: x.count }))));
  });
  return cleanup;
}

function monthChart(m: number[], label: string): HTMLElement {
  const max = Math.max(...m, 1);
  return h('ol', { class: 'months', attrs: { 'aria-label': label } }, ...m.map((v, i) => h('li', { attrs: { title: `${FULL_MONTHS[i]}: ${fmt(v)}` } },
    h('span', { class: 'mbar', attrs: { style: `--h:${(v / max) * 100}%` } }), h('span', { class: 'mlabel', text: MONTHS[i][0] }))));
}
function seasonLine(m: number[], where: string): string {
  const p = peakSeason(m);
  return p ? L(`${where}: most records from ${FULL_MONTHS[p.from]} to ${FULL_MONTHS[p.to]} (${Math.round(p.share * 100)} %).`, `${where}: koʻp yozuvlar ${FULL_MONTHS[p.from]}dan ${FULL_MONTHS[p.to]}gacha (${Math.round(p.share * 100)} %).`)
    : L(`${where}: recorded all year round, without a clear season.`, `${where}: yil boʻyi qayd etilgan, aniq mavsumsiz.`);
}

function renderSeasons(section: HTMLElement, north: number[], south: number[], dec: { decade: number; records: number }[]) {
  const nN = north.reduce((a, b) => a + b, 0), nS = south.reduce((a, b) => a + b, 0), n = nN + nS;
  section.replaceChildren(h('h3', { text: L('When it is recorded', 'Qachon qayd etilgan') }));
  if (n >= 30) {
    const both = nN >= 30 && nS >= 30 && Math.min(nN, nS) / n >= 0.1;
    if (both) section.append(
      h('p', { text: seasonLine(north, L('North of the equator', 'Ekvatordan shimolda')) }), monthChart(north, L('Records by month, north of the equator', 'Oylar boʻyicha yozuvlar, ekvatordan shimolda')),
      h('p', { text: seasonLine(south, L('South of the equator', 'Ekvatordan janubda')) }), monthChart(south, L('Records by month, south of the equator', 'Oylar boʻyicha yozuvlar, ekvatordan janubda')));
    else {
      const m = nN >= nS ? north : south;
      section.append(h('p', { text: seasonLine(m, nN >= nS ? L('Mostly north of the equator', 'Asosan ekvatordan shimolda') : L('Mostly south of the equator', 'Asosan ekvatordan janubda')) }), monthChart(m, L('Records by month', 'Oylar boʻyicha yozuvlar')));
    }
    section.append(h('p', { class: 'fine', text: L(`From all ${fmt(n)} dated GBIF records. North and south of the equator the seasons are opposite, so they are kept apart. Months also show when people go out looking (spring birding, summer holidays).`,
      `Sanasi bor barcha ${fmt(n)} ta GBIF yozuvi asosida. Ekvatorning shimoli va janubida fasllar teskari, shuning uchun alohida. Oylar odamlar qachon izlashga chiqishini ham koʻrsatadi (bahorgi qush kuzatish, yozgi taʼtil).`) }));
  }
  if (dec.length > 1) {
    const max = Math.max(...dec.map((d) => d.records));
    const tick = (d: number, i: number) => (i === 0 || i === dec.length - 1 || (d % 50 === 0 && i > 2 && dec.length - 1 - i > 2) ? String(d) : '');
    section.append(
      h('ol', { class: 'decades', attrs: { 'aria-label': L('Records by decade', 'Oʻn yilliklar boʻyicha yozuvlar') } }, ...dec.map((d) => h('li', { attrs: { title: `${d.decade}s: ${fmt(d.records)}` } },
        h('span', { class: 'mbar', attrs: { style: `--h:${Math.max(d.records ? 4 : 0, Math.sqrt(d.records / max) * 100)}%` } })))),
      h('ol', { class: 'decade-axis', attrs: { 'aria-hidden': 'true' } }, ...dec.map((d, i) => h('li', { text: tick(d.decade, i) }))),
      h('p', { class: 'fine', text: L('Records per decade; bar height grows with the square root, so small decades stay visible.', 'Oʻn yilliklar boʻyicha yozuvlar; ustun balandligi kvadrat ildiz boʻyicha oʻsadi, shuning uchun kichik oʻn yilliklar ham koʻrinadi.') }));
  }
  if (n < 30 && dec.length <= 1) section.append(h('p', { class: 'fine', text: L('Too few dated records to show a pattern.', 'Qonuniyat koʻrsatish uchun sanali yozuvlar juda kam.') }));
}
