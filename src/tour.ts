// Guided tour: each stop opens a real view of the atlas, uses the feature it is about (switches the area, presses
// "Mostly found here", plays the journeys…) and rings the control it used, so the reader sees where it lives. The
// steps are a sequence, so they are numbered.
import { h } from './dom';
import { t } from './i18n';
import type { AreaRef } from './state';

export interface TourHost {
  place(lat: number, lon: number, zoom: number, area?: AreaRef, label?: string): void;
  species(id: number): void;
  compare(a: number, b: number): void;
  layer(mode: false | 'records' | 'age'): void;
  parks(on: boolean): void;
  globe(lon: number, lat: number, zoom: number): void;
  closePanel(): void;
  setStep(step: number | null): void;
}

interface Stop {
  title: string;
  text: string;
  go: (h: TourHost) => void;
  /** The control this stop is about: ringed once it appears (and scrolled into view in the panel). */
  spot?: string;
  /** Use it: click the spotted control (or run this on it) once it appears. */
  act?: 'click' | ((el: HTMLElement) => void);
}

/** Serengeti National Park, simplified from OpenStreetMap (as the protected-areas layer would give it). */
const SERENGETI: [number, number][] = [[33.865, -2.202], [34.017, -2.255], [34.17, -2.372], [34.351, -2.48], [34.394, -2.604], [34.547, -2.797], [34.655, -2.98], [34.775, -3.324], [34.887, -3.186], [34.882, -2.907], [35.139, -2.909], [35.222, -2.505], [35.161, -2.394], [35.267, -2.303], [35.211, -2.069], [35.257, -1.687], [34.781, -1.419], [34.641, -1.592], [34.831, -1.831], [34.862, -2.075], [34.801, -2.198], [34.545, -2.209], [34.373, -2.139], [34.109, -2.102], [33.977, -2.086]];
/** The Okavango Delta, drawn by hand as a reader would. */
const OKAVANGO: [number, number][] = [[21.9, -18.3], [22.6, -18.1], [23.6, -18.6], [23.9, -19.5], [23.2, -20.0], [22.3, -19.6]];

export const STOPS: Stop[] = [
  { title: t('Where people have looked for animals'),
    text: t('Every coloured square holds GBIF records of animals; the brighter, the more. Europe and North America glow because millions of people record birds there; much of Africa, Central Asia and the Amazon stays dark. A short list usually means few people looked, not that few animals live there.'),
    go: (x) => { x.closePanel(); x.parks(false); x.layer('records'); x.globe(20, 25, 1.4); }, spot: '#looked' },
  { title: t('Click anywhere: who lives here'),
    text: t('A click lists the animals recorded around the point, here a 150 km square in the Serengeti, with how well each kind of animal is known. The row under the name changes the area: a smaller square, the district, the province or the whole country.'),
    go: (x) => { x.layer(false); x.place(-2.33, 34.83, 5); }, spot: '.area-row' },
  { title: t('A whole province: the Galápagos'),
    text: t('The same list for the Galápagos Islands, inside the province border GBIF uses. Chips filter by kind of animal; "Threatened only" keeps the species on the IUCN Red List.'),
    go: (x) => { x.layer(false); x.place(-0.7, -90.4, 6, { kind: 'gadm', id: 'ECU.9_1' }); }, spot: '.chip.area[aria-pressed="true"]' },
  { title: t('Mostly found here'),
    text: t('Pressed for you: the species with at least half of all their records worldwide from these islands. Giant tortoises, marine iguanas and Darwin\'s finches live nowhere else. The first time it counts each species\' records worldwide; after that the counts are kept in your browser.'),
    go: (x) => { x.layer(false); x.place(-0.7, -90.4, 6, { kind: 'gadm', id: 'ECU.9_1' }); }, spot: '.chip.here', act: 'click' },
  { title: t('Protected areas'),
    text: t('Switched on for you: national parks and reserves from OpenStreetMap, in green. Clicking one lists the animals recorded inside its border, like Serengeti National Park here.'),
    go: (x) => { x.layer(false); x.parks(true); x.place(-2.33, 34.83, 6.5, { kind: 'shape', rings: [SERENGETI] }, 'Serengeti National Park'); }, spot: '#parks' },
  { title: t('Draw your own area'),
    text: t('"Draw an area" lets you click the corners of any shape on the globe, here the Okavango Delta. Double-click to finish; the link keeps the shape, so you can share it.'),
    go: (x) => { x.parks(false); x.layer(false); x.place(-19.1, 22.9, 6, { kind: 'shape', rings: [OKAVANGO] }); }, spot: '.chip.area.draw' },
  { title: t('Any animal: the Atlantic puffin'),
    text: t('Search any animal by its everyday name in your language. Its page shows where it has been recorded, photos of the animal itself (click one to see it full screen), its Red List status, size and voice. ☆ Save keeps it in this browser; Copy link shares the page.'),
    go: (x) => { x.parks(false); x.layer(false); x.species(2481353); }, spot: '.photo-strip' },
  { title: t('Records by year: polar bears'),
    text: t('Moved for you: the globe shows only records since 2015. Drag the two sliders to any years, and ask what changed: the bears, or where people went looking.'),
    go: (x) => { x.layer(false); x.species(2433451); }, spot: '.year-range',
    act: (el) => { const a = el.querySelector<HTMLInputElement>('input'); if (a) { a.value = '2015'; a.dispatchEvent(new Event('input')); } } },
  { title: t('The Alpine ibex lives up high'),
    text: t('"From the deep sea to the mountains": most of its records with a height lie between 2,000 and 3,000 metres, above the tree line of the Alps.'),
    go: (x) => { x.layer(false); x.species(2441055); }, spot: '.column.vertical' },
  { title: t('Monarch butterflies: a migration by insects'),
    text: t('Playing for you: month by month, the butterflies spread north over the summer and gather in Mexico for the winter.'),
    go: (x) => { x.layer(false); x.species(5133088); }, spot: '.year-globe .btn', act: 'click' },
  { title: t('Real journeys of tagged animals'),
    text: t('Playing for you: nine Arctic terns carrying tags, each flying about 100,000 km between Greenland and Antarctica in a year. 113 species have such tracks, from storks to white sharks.'),
    go: (x) => { x.layer(false); x.species(5229230); }, spot: '.tags .play-row .btn', act: 'click' },
  { title: t('Two species side by side'),
    text: t('"Compare with another species" puts two animals together: lion in yellow, leopard in blue, and in white the ground where both have been recorded.'),
    go: (x) => { x.layer(false); x.compare(5219404, 5219436); }, spot: '.overlap-box' },
  { title: t('Ground nobody has looked at for ten years'),
    text: t('Green squares have animal records from the last ten years; grey ones only older records. Grey ground is where the next naturalist will find the most news.'),
    go: (x) => { x.closePanel(); x.layer('age'); x.globe(60, 30, 1.4); }, spot: '#legend' },
];

/** Wait for an element (views draw in stages); null after `ms`. */
function waitFor(sel: string, ms: number, alive: () => boolean): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (!alive()) return resolve(null);
      const el = document.querySelector<HTMLElement>(sel);
      if (el && el.offsetParent !== null) return resolve(el);
      if (Date.now() - t0 > ms) return resolve(null);
      setTimeout(tick, 250);
    };
    tick();
  });
}

export function initTour(card: HTMLElement, host: TourHost) {
  let step = 0, run = 0;
  const title = h('h2', { class: 'tour-title' });
  const text = h('p', { class: 'tour-text' });
  const count = h('span', { class: 'tour-count' });
  const prev = h('button', { class: 'btn small quiet' });
  const next = h('button', { class: 'btn small' });
  const close = h('button', { class: 'about-close', attrs: { 'aria-label': t('End the tour') }, text: '×' });
  card.append(close, count, title, text, h('div', { class: 'btn-row' }, prev, next));
  const unspot = () => document.querySelectorAll('.tour-spot').forEach((e) => e.classList.remove('tour-spot'));

  const show = async (i: number, move = true) => {
    step = Math.max(0, Math.min(STOPS.length - 1, i));
    const s = STOPS[step], my = ++run;
    unspot();
    card.hidden = false;
    count.textContent = t('Stop {0} of {1}', step + 1, STOPS.length);
    title.textContent = s.title;
    text.textContent = s.text;
    prev.textContent = t('Back');
    prev.hidden = step === 0;
    next.textContent = step === STOPS.length - 1 ? t('Finish') : t('Next');
    host.setStep(step + 1);
    if (!move) return;
    s.go(host);
    if (!s.spot) return;
    const el = await waitFor(s.spot, 45000, () => my === run && !card.hidden);
    if (!el || my !== run) return;
    if (el.closest('#panel')) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('tour-spot');
    if (s.act === 'click') { if (el.getAttribute('aria-pressed') !== 'true') el.click(); }
    else s.act?.(el);
  };
  const end = () => { run++; unspot(); card.hidden = true; host.setStep(null); };
  prev.addEventListener('click', () => show(step - 1));
  next.addEventListener('click', () => (step === STOPS.length - 1 ? end() : show(step + 1)));
  close.addEventListener('click', end);
  return { start: (i = 1) => show(i - 1), end, get open() { return !card.hidden; } };
}
