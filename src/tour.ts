// Guided tour: a few stops that each open a real view of the atlas (a place, a species, a layer) with two or three
// sentences on what to notice. The steps are a sequence, so they are numbered.
import { h } from './dom';
import { t } from './i18n';

export interface TourHost {
  place(lat: number, lon: number, zoom: number): void;
  species(id: number): void;
  layer(mode: false | 'records' | 'age'): void;
  globe(lon: number, lat: number, zoom: number): void;
  closePanel(): void;
  setStep(step: number | null): void;
}

interface Stop { title: string; text: string; go: (h: TourHost) => void }

export const STOPS: Stop[] = [
  { title: t('Where people have looked for animals'),
    text: t('Every coloured square holds GBIF records of animals; the brighter, the more. Europe and North America glow because millions of people record birds there; much of Africa, Central Asia and the Amazon stays dark. A short list usually means few people looked, not that few animals live there.'),
    go: (x) => { x.closePanel(); x.layer('records'); x.globe(20, 25, 1.4); } },
  { title: t('The Serengeti'),
    text: t('Wildebeest, zebras, lions and more than five hundred kinds of birds. Use the chips to see one kind of animal at a time.'),
    go: (x) => { x.layer(false); x.place(-2.33, 34.83, 5); } },
  { title: t('The Amazon near Manaus'),
    text: t('One of the richest places on Earth, and one of the least surveyed: look at the completeness estimate and the share of species recorded only once.'),
    go: (x) => { x.layer(false); x.place(-3.1, -60.0, 5); } },
  { title: t('The Alpine ibex lives up high'),
    text: t('Open "From the deep sea to the mountains": most of its records with a height lie between 2,000 and 3,000 metres, above the tree line of the Alps.'),
    go: (x) => { x.layer(false); x.species(2441055); } },
  { title: t('Monarch butterflies: a migration by insects'),
    text: t('Under "When it is recorded", press "Play the year": the butterflies spread north over the summer and gather in Mexico for the winter.'),
    go: (x) => { x.layer(false); x.species(5133088); } },
  { title: t('Polar bears: then and now'),
    text: t('Press "Then and now" to see records before 2000 in purple and since 2000 in yellow. Ask what changed: the bears, or where people went looking.'),
    go: (x) => { x.layer(false); x.species(2433451); } },
  { title: t('Ground nobody has looked at for ten years'),
    text: t('Green squares have animal records from the last ten years; grey ones only older records. Grey ground is where the next naturalist will find the most news.'),
    go: (x) => { x.closePanel(); x.layer('age'); x.globe(60, 30, 1.4); } },
];

export function initTour(card: HTMLElement, host: TourHost) {
  let step = 0;
  const title = h('h2', { class: 'tour-title' });
  const text = h('p', { class: 'tour-text' });
  const count = h('span', { class: 'tour-count' });
  const prev = h('button', { class: 'btn small quiet' });
  const next = h('button', { class: 'btn small' });
  const close = h('button', { class: 'about-close', attrs: { 'aria-label': t('End the tour') }, text: '×' });
  card.append(close, count, title, text, h('div', { class: 'btn-row' }, prev, next));

  const show = (i: number, move = true) => {
    step = Math.max(0, Math.min(STOPS.length - 1, i));
    const s = STOPS[step];
    card.hidden = false;
    count.textContent = t('Stop {0} of {1}', step + 1, STOPS.length);
    title.textContent = s.title;
    text.textContent = s.text;
    prev.textContent = t('Back');
    prev.hidden = step === 0;
    next.textContent = step === STOPS.length - 1 ? t('Finish') : t('Next');
    if (move) s.go(host);
    host.setStep(step + 1);
  };
  const end = () => { card.hidden = true; host.setStep(null); };
  prev.addEventListener('click', () => show(step - 1));
  next.addEventListener('click', () => (step === STOPS.length - 1 ? end() : show(step + 1)));
  close.addEventListener('click', end);
  return { start: (i = 1) => show(i - 1), end, get open() { return !card.hidden; } };
}
