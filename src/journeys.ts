// Species-page sections about movement and time:
//   "How it travels"      the real journeys of tagged animals (stored GPS and satellite-tag tracks from GBIF studies,
//                         scripts/fetch_tracks.py), and for 109 sea animals the MiCO network of the places they use
//                         (matched by scientific name or a GBIF synonym; its links join places, they are not routes)
//   "When it is recorded"  records by month north and south of the equator, and by decade (GBIF facets)
import * as api from './api';
import { h, fmt, plural } from './dom';
import { greatCircle } from './geo';
import { ACTIVITY_COLORS, TRACK_COLORS, type ActivityKind } from './map';
import { decadeCounts, trackAtHours, type TagTrack, type TagTracks } from './tracks';
import { L, lang, MONTHS_UZ } from './i18n';

export type Overlay = 'micoRoutes' | 'micoSites' | 'tracks' | 'heads';
export interface JourneyHost {
  setOverlay(source: Overlay, fc: GeoJSON.FeatureCollection | null): void;
  fitTo(points: [number, number][]): void;
  dimRange(dim: boolean): void;
  /** One month of a species' records on the globe; null brings the all-year range back. */
  showMonth(key: number | null, month: number | null): void;
  base: string;
}

const FULL_MONTHS = lang === 'uz' ? MONTHS_UZ : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS = FULL_MONTHS.map((m) => m.slice(0, 3));
const ext = { target: '_blank', rel: 'noopener' };
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const PLAY_MS = 16000;
const MAX_LISTED = 8;

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
  let raf = 0;
  let monthTimer = 0;
  const cleanup = () => { stopped = true; cancelAnimationFrame(raf); for (const x of ['micoSites', 'micoRoutes', 'tracks', 'heads'] as const) host.setOverlay(x, null); host.dimRange(false); clearInterval(monthTimer); host.showMonth(null, null); };
  const ok = () => alive() && !stopped;
  const travel = h('section', { class: 'journeys', attrs: { hidden: true } }, h('h3', { text: L('How it travels', 'Qanday sayohat qiladi') }));
  const when = h('section', { class: 'seasons' }, h('h3', { text: L('When it is recorded', 'Qachon qayd etilgan') }), h('p', { class: 'fine', text: L('Loading…', 'Yuklanmoqda…') }));
  mount.append(travel, when);

  const tagBox = h('div', { class: 'tags' });
  const micoBox = h('div', { class: 'mico' });
  travel.append(tagBox, micoBox);

  // ---- real journeys of tagged animals ----
  api.tagTrackIndex(host.base).then(async (idx) => {
    if (!idx[o.id] || !ok()) return;
    const data = await api.tagTracks(host.base, o.id).catch(() => null);
    if (!data?.tracks.length || !ok()) return;
    travel.hidden = false;
    renderTracks(data);
  });

  const renderTracks = (data: TagTracks) => {
    const drawn = data.tracks;
    let only: number | null = null;
    const years = (tr: TagTrack) => { const a = new Date(tr.t0 * 1000).getUTCFullYear(), b = new Date(tr.t1 * 1000).getUTCFullYear(); return a === b ? String(a) : `${a}–${b}`; };
    const props = (tr: TagTrack, i: number) => ({ c: i, name: tr.a, km: tr.km, years: years(tr), species: o.commonName });
    const mine = () => drawn.map((tr, i) => [tr, i] as const).filter(([, i]) => only == null || i === only);
    const full = () => fc(mine().flatMap(([tr, i]) => tr.p.map((seg) => ({ type: 'Feature' as const, properties: props(tr, i), geometry: { type: 'LineString' as const, coordinates: seg.map(([x, y]) => [x, y]) } }))));
    const heads = (hours: number | null) => fc(mine().flatMap(([tr, i]) => {
      const p = hours == null ? (tr.p.at(-1)?.at(-1)?.slice(0, 2) as [number, number] | undefined) ?? null : trackAtHours(tr, hours).head;
      return p ? [{ type: 'Feature' as const, properties: props(tr, i), geometry: { type: 'Point' as const, coordinates: p } }] : [];
    }));
    const draw = () => { host.setOverlay('tracks', full()); host.setOverlay('heads', heads(null)); };
    const frameAll = () => host.fitTo(mine().flatMap(([tr]) => tr.p.flat().map(([x, y]) => [x, y] as [number, number])));
    draw();
    host.dimRange(true);
    frameAll();

    const play = h('button', { class: 'btn small', text: L('Play journeys', 'Yoʻllarni ijro etish') });
    const clock = h('span', { class: 'clock', attrs: { 'aria-live': 'off' } });
    play.addEventListener('click', () => {
      cancelAnimationFrame(raf);
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const span = Math.max(...mine().map(([tr]) => tr.p.at(-1)?.at(-1)?.[2] ?? 0), 1);
      const t0 = performance.now();
      let last = 0;
      const frame = (now: number) => {
        if (!ok()) return;
        const f = reduce ? 1 : Math.min(1, (now - t0) / PLAY_MS);
        if (now - last > 40 || f === 1) { // ~25 frames a second keeps the globe smooth
          last = now;
          const hours = f * span;
          host.setOverlay('tracks', fc(mine().flatMap(([tr, i]) => trackAtHours(tr, hours).upto.map((part) => ({ type: 'Feature' as const, properties: props(tr, i), geometry: { type: 'LineString' as const, coordinates: part } })))));
          host.setOverlay('heads', heads(hours));
          const moving = mine().filter(([tr]) => (tr.p.at(-1)?.at(-1)?.[2] ?? 0) >= hours).length;
          clock.textContent = L(`Day ${fmt(Math.round(hours / 24))} after tagging, ${plural(moving, 'animal')} still sending`, `Belgilangandan keyin ${fmt(Math.round(hours / 24))}-kun, ${fmt(moving)} ta hayvon hali signal beryapti`);
        }
        if (f < 1) raf = requestAnimationFrame(frame);
        else { clock.textContent = L('Every journey, from tagging to the last signal', 'Har bir yoʻl, belgilashdan oxirgi signalgacha'); draw(); }
      };
      raf = requestAnimationFrame(frame);
    });

    const showAll = h('button', { class: 'link-btn', text: L('Show every animal', 'Hamma hayvonlarni koʻrsatish'), attrs: { hidden: true } });
    const list = h('ol', { class: 'track-list' }, ...drawn.slice(0, MAX_LISTED).map((tr, i) => {
      const b = h('button', { class: 'track-item', attrs: { 'aria-pressed': 'false' } },
        h('span', { class: 'dot', attrs: { style: `background:${TRACK_COLORS[i % TRACK_COLORS.length]}` } }), `${tr.a}: ${fmt(tr.km)} km, ${years(tr)}`);
      b.addEventListener('click', () => {
        cancelAnimationFrame(raf);
        only = only === i ? null : i;
        list.querySelectorAll('.track-item').forEach((x, k) => x.setAttribute('aria-pressed', String(k === only)));
        showAll.hidden = only == null;
        draw();
        frameAll();
      });
      return h('li', {}, b);
    }));
    showAll.addEventListener('click', () => list.querySelector<HTMLButtonElement>('.track-item[aria-pressed="true"]')?.click());
    const dropped = drawn.reduce((a, t) => a + t.d, 0);
    tagBox.replaceChildren(
      h('p', { text: L(`The real journeys of ${plural(data.animals, 'tagged animal')}, from GPS and satellite tags${data.animals > drawn.length ? ` (the ${drawn.length} longest are drawn)` : ''}. The longest: ${fmt(drawn[0].km)} km. Each colour is one animal; pick one to see it alone.`,
        `${fmt(data.animals)} ta belgilangan hayvonning GPS va sunʼiy yoʻldosh belgilaridagi haqiqiy yoʻllari${data.animals > drawn.length ? ` (eng uzun ${drawn.length} tasi chizilgan)` : ''}. Eng uzuni: ${fmt(drawn[0].km)} km. Har bir rang bitta hayvon; alohida koʻrish uchun bittasini tanlang.`) }),
      h('div', { class: 'play-row' }, play, clock), list, showAll,
      h('p', { class: 'fine' }, L('Tracks from ', 'Yoʻllar manbasi: '), ...data.studies.flatMap((st, i) => [i ? ', ' : '', h('a', { text: st.title, attrs: { href: st.url, ...ext } }), ` (${st.licence})`]), L(', through GBIF.', ', GBIF orqali.')),
      h('p', { class: 'fine', text: L(`Lines follow the fixes the tags sent. Gaps of more than 20 days are left open. Fixes that would need more than ${fmt(data.cap)} km a day are dropped as location errors${dropped ? ` (${fmt(dropped)} here)` : ''}; moves under 5 km do not add to the distance.`,
        `Chiziqlar belgilar yuborgan nuqtalar boʻylab. 20 kundan uzun uzilishlar ochiq qoldiriladi. Kuniga ${fmt(data.cap)} km dan tez harakatni talab qiladigan nuqtalar joylashuv xatosi sifatida tashlangan${dropped ? ` (bu yerda ${fmt(dropped)} ta)` : ''}; 5 km dan kichik siljishlar masofaga qoʻshilmaydi.`) }));
  };

  // ---- MiCO, for the 109 sea animals it covers: the places they use; links between them are shown on request ----
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
    const kinds = [...new Set(sites.features.map((f) => f.properties!.kind as ActivityKind))];
    // A link says "animals that use this place also use that one"; drawn as a line it reads as the way they went,
    // which it is not. So the places show, and the links only when asked for, dashed and labelled.
    let linksOn = false;
    const links = h('button', { class: 'btn small quiet', attrs: { 'aria-pressed': 'false' }, text: L('Show which places are linked', 'Qaysi joylar bogʻliqligini koʻrsatish') });
    links.addEventListener('click', () => {
      linksOn = !linksOn;
      links.setAttribute('aria-pressed', String(linksOn));
      links.textContent = linksOn ? L('Hide the links', 'Bogʻlanishlarni yashirish') : L('Show which places are linked', 'Qaysi joylar bogʻliqligini koʻrsatish');
      host.setOverlay('micoRoutes', linksOn ? routes : null);
    });
    const frame = h('button', { class: 'btn small quiet', text: L('Show on the globe', 'Globusda koʻrsatish'), on: { click: () => host.fitTo(points) } });
    micoBox.append(
      h('p', { text: L(`Places this species uses on its migrations: ${plural(d.sites.length, 'place')}${d.routes.length ? `, ${plural(d.routes.length, 'link')} between them` : ''}, from published tracking and tagging studies.`,
        `Bu tur migratsiyada foydalanadigan joylar: ${fmt(d.sites.length)} ta joy${d.routes.length ? `, ular orasida ${fmt(d.routes.length)} ta bogʻlanish` : ''}; eʼlon qilingan kuzatuv va belgilash tadqiqotlaridan.`) }),
      h('ul', { class: 'legend-dots' }, ...kinds.map((k) => h('li', {}, h('span', { class: 'dot', attrs: { style: `background:${ACTIVITY_COLORS[k]}` } }), ACTIVITY_LABEL[k]))),
      h('div', { class: 'btn-row' }, frame, d.routes.length ? links : null,
        h('a', { class: 'btn small quiet', text: L('Tag tracks in Ocean Life Atlas', 'Ocean Life Atlas da belgi yoʻllari'), attrs: { href: `https://oceanlife.bristleconelab.org/#sp=${wormsId}`, ...ext } })),
      h('p', { class: 'fine' }, L('A link means animals seen at one place were also seen at the other; it is not the way they went (dashed, straight across the globe). ', 'Bogʻlanish bir joyda koʻrilgan hayvonlar boshqasida ham koʻrilganini bildiradi; bu ular bosib oʻtgan yoʻl emas (uzuq chiziq, globus boʻylab toʻgʻri). '), 'MiCO, ',
        h('a', { text: 'Bentley et al. 2025', attrs: { href: 'https://doi.org/10.1038/s41467-025-59271-7', ...ext } }), ', CC0.'));
  }).catch(() => {});

  // ---- the year on the globe: where it is recorded month by month (monarchs north in summer, Mexico in winter) ----
  const yearOnGlobe = () => {
    let month = 0, playing = false;
    const label = h('span', { class: 'month-now', attrs: { 'aria-live': 'polite' } });
    const slider = h('input', { attrs: { type: 'range', min: '1', max: '12', step: '1', value: '1', 'aria-label': L('Month shown on the globe', 'Globusda koʻrsatilgan oy') } }) as HTMLInputElement;
    const play = h('button', { class: 'btn small', text: L('Play the year', 'Yilni ijro etish') });
    const stop = h('button', { class: 'link-btn', text: L('Back to all year', 'Butun yilga qaytish'), attrs: { hidden: true } });
    const go = (m: number) => { month = m; slider.value = String(m); label.textContent = FULL_MONTHS[m - 1]; host.showMonth(o.id, m); stop.hidden = false; };
    const pause = () => { playing = false; clearInterval(monthTimer); play.textContent = L('Play the year', 'Yilni ijro etish'); };
    play.addEventListener('click', () => {
      if (playing) { pause(); return; }
      playing = true; play.textContent = L('Pause', 'Toʻxtatish');
      go(month ? (month % 12) + 1 : 1);
      monthTimer = window.setInterval(() => { if (!ok()) { pause(); return; } go((month % 12) + 1); }, 2200); // adhoc tiles take ~1 s each
    });
    slider.addEventListener('input', () => { pause(); go(Number(slider.value)); });
    stop.addEventListener('click', () => { pause(); month = 0; label.textContent = ''; stop.hidden = true; host.showMonth(null, null); });
    // the month bars above are buttons into the same view
    queueMicrotask(() => when.querySelectorAll<HTMLElement>('.months li').forEach((li, i) => {
      li.classList.add('pick');
      li.addEventListener('click', () => { pause(); go((i % 12) + 1); });
    }));
    return h('div', { class: 'year-globe' },
      h('p', { class: 'yg-title', text: L('The year on the globe', 'Yil globusda') }),
      h('div', { class: 'yg-row' }, play, slider, label), stop,
      h('p', { class: 'fine', text: L('Each month shows the records made in that month, in any year (dots, from a live GBIF search, so a month can take a moment). Where they move with the seasons, you see it: monarch butterflies north in summer and in Mexico in winter.', 'Har oy oʻsha oyda, istalgan yilda qilingan yozuvlarni koʻrsatadi. Fasllar bilan koʻchsa, koʻrinadi: monarx kapalaklari yozda shimolda, qishda Meksikada.') }));
  };

  // ---- seasons and decades ----
  Promise.all([
    api.gbifFacet({ taxonKey: o.id, decimalLatitude: '0,90' }, 'month', 12, o.signal).catch(() => []),
    // the equator (0) counts once, as north
    api.gbifFacet({ taxonKey: o.id, decimalLatitude: '-90,-0.000001' }, 'month', 12, o.signal).catch(() => []),
    api.gbifFacet({ taxonKey: o.id }, 'year', 400, o.signal).catch(() => []),
  ]).then(([n, s, y]) => {
    if (!ok()) return;
    renderSeasons(when, monthsFromFacet(n), monthsFromFacet(s), decadeCounts(y.map((x) => ({ year: Number(x.name), records: x.count }))));
    if (monthsFromFacet(n).reduce((a, b) => a + b, 0) + monthsFromFacet(s).reduce((a, b) => a + b, 0) >= 30) when.append(yearOnGlobe());
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
