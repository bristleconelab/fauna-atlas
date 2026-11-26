// Guided tour: a few stops that each open a real view of the atlas (a place, a species, a layer) with two or three
// sentences on what to notice. The steps are a sequence, so they are numbered.
import { h } from './dom';
import { L } from './i18n';

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
  { title: L('Where people have looked for animals', 'Odamlar hayvonlarni qayerda izlagan'),
    text: L('Every coloured square holds GBIF records of animals; the brighter, the more. Europe and North America glow because millions of people record birds there; much of Africa, Central Asia and the Amazon stays dark. A short list usually means few people looked, not that few animals live there.',
      'Har bir rangli kvadratchada hayvonlarning GBIF yozuvlari bor; qanchalik yorqin boʻlsa, shunchalik koʻp. Yevropa va Shimoliy Amerika millionlab odam qush qayd etgani uchun porlaydi; Afrika, Markaziy Osiyo va Amazonkaning katta qismi qorongʻi. Qisqa roʻyxat odatda kam hayvonni emas, kam odam qaraganini bildiradi.'),
    go: (x) => { x.closePanel(); x.layer('records'); x.globe(20, 25, 1.4); } },
  { title: L('The Serengeti', 'Serengeti'),
    text: L('Wildebeest, zebras, lions and more than five hundred kinds of birds. Use the chips to see one kind of animal at a time.',
      'Gnu antilopalari, zebralar, sherlar va besh yuzdan ortiq qush turi. Bir turkumni koʻrish uchun tugmachalardan foydalaning.'),
    go: (x) => { x.layer(false); x.place(-2.33, 34.83, 5); } },
  { title: L('The Amazon near Manaus', 'Manaus yaqinidagi Amazonka'),
    text: L('One of the richest places on Earth, and one of the least surveyed: look at the completeness estimate and the share of species recorded only once.',
      'Yer yuzidagi eng boy joylardan biri va eng kam oʻrganilganlaridan biri: toʻliqlik bahosiga va faqat bir marta qayd etilgan turlar ulushiga qarang.'),
    go: (x) => { x.layer(false); x.place(-3.1, -60.0, 5); } },
  { title: L('The Alpine ibex lives up high', 'Alp togʻ echkisi baland joyda yashaydi'),
    text: L('Open "From the deep sea to the mountains": most of its records with a height lie between 2,000 and 3,000 metres, above the tree line of the Alps.',
      '"Dengiz tubidan togʻ choʻqqisigacha" boʻlimini oching: balandligi yozilgan yozuvlarining aksariyati 2 000–3 000 metrda, Alp togʻlaridagi daraxtlar chegarasidan yuqorida.'),
    go: (x) => { x.layer(false); x.species(2441055); } },
  { title: L('Monarch butterflies: a migration by insects', 'Monarx kapalaklari: hasharotlar migratsiyasi'),
    text: L('Open "When it is recorded": in North America the months follow the butterflies north in summer and south to Mexico in winter.',
      '"Qachon qayd etilgan" boʻlimini oching: Shimoliy Amerikada oylar kapalaklarning yozda shimolga va qishda Meksikaga janubga uchishini koʻrsatadi.'),
    go: (x) => { x.layer(false); x.species(5133088); } },
  { title: L('Polar bears: then and now', 'Oq ayiqlar: oldin va hozir'),
    text: L('Press "Then and now" to see records before 1990 in purple and since 2010 in yellow. Ask what changed: the bears, or where people went looking.',
      '1990 gacha boʻlgan yozuvlarni binafsha va 2010 dan keyingilarini sariq rangda koʻrish uchun "Oldin va hozir"ni bosing. Nima oʻzgarganini oʻylang: ayiqlarmi yoki odamlar izlagan joylarmi.'),
    go: (x) => { x.layer(false); x.species(2433451); } },
  { title: L('Ground nobody has looked at for ten years', 'Oʻn yildan beri hech kim qaramagan joylar'),
    text: L('Green squares have animal records from the last ten years; grey ones only older records. Grey ground is where the next naturalist will find the most news.',
      'Yashil kvadratchalarda oxirgi oʻn yildagi hayvon yozuvlari bor; kulranglarida faqat eski yozuvlar. Kulrang joylar keyingi tabiatshunos eng koʻp yangilik topadigan joy.'),
    go: (x) => { x.closePanel(); x.layer('age'); x.globe(60, 30, 1.4); } },
];

export function initTour(card: HTMLElement, host: TourHost) {
  let step = 0;
  const title = h('h2', { class: 'tour-title' });
  const text = h('p', { class: 'tour-text' });
  const count = h('span', { class: 'tour-count' });
  const prev = h('button', { class: 'btn small quiet' });
  const next = h('button', { class: 'btn small' });
  const close = h('button', { class: 'about-close', attrs: { 'aria-label': L('End the tour', 'Sayohatni tugatish') }, text: '×' });
  card.append(close, count, title, text, h('div', { class: 'btn-row' }, prev, next));

  const show = (i: number, move = true) => {
    step = Math.max(0, Math.min(STOPS.length - 1, i));
    const s = STOPS[step];
    card.hidden = false;
    count.textContent = L(`Stop ${step + 1} of ${STOPS.length}`, `${STOPS.length} tadan ${step + 1}-bekat`);
    title.textContent = s.title;
    text.textContent = s.text;
    prev.textContent = L('Back', 'Orqaga');
    prev.hidden = step === 0;
    next.textContent = step === STOPS.length - 1 ? L('Finish', 'Tugatish') : L('Next', 'Keyingisi');
    if (move) s.go(host);
    host.setStep(step + 1);
  };
  const end = () => { card.hidden = true; host.setStep(null); };
  prev.addEventListener('click', () => show(step - 1));
  next.addEventListener('click', () => (step === STOPS.length - 1 ? end() : show(step + 1)));
  close.addEventListener('click', end);
  return { start: (i = 1) => show(i - 1), end, get open() { return !card.hidden; } };
}
