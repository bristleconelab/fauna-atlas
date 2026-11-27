import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/source-serif-4/wght-italic.css'; // Latin names
import '@fontsource-variable/source-serif-4/wght.css'; // Wikipedia summaries, upright: long italic text is hard to read
import './styles.css';
import * as api from './api';
import { commonsThumbs } from './wiki';
import { fmt, h } from './dom';
import { Globe } from './map';
import { Panel } from './panel';
import { initSearch } from './search';
import { initSheet } from './sheet';
import { formatHash, parseHash, type ViewState } from './state';
import { outerRings, ringsBox } from './geo';
import { languageName, LANGS, lang, setLang, t, tn } from './i18n';
import { initTour } from './tour';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const base = import.meta.env.BASE_URL;
// Static text in index.html is English; elements marked data-t (text), data-t-placeholder and data-t-label
// (aria-label) are translated from the catalog. The About text is one block per language (data-l), English as fallback.
document.documentElement.lang = lang;
document.title = t('Fauna Atlas: which animals live here?');
document.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => { el.textContent = t(el.textContent!.trim()); });
document.querySelectorAll<HTMLInputElement>('[data-t-placeholder]').forEach((el) => { el.dataset.placeholder = el.placeholder; el.placeholder = t(el.placeholder); });
document.querySelectorAll<HTMLElement>('[data-t-label]').forEach((el) => el.setAttribute('aria-label', t(el.getAttribute('aria-label')!)));
{
  const blocks = document.querySelectorAll<HTMLElement>('#about [data-l]');
  const mine = [...blocks].some((b) => b.dataset.l === lang) ? lang : 'en';
  blocks.forEach((b) => { b.hidden = b.dataset.l !== mine; });
}

// Language: one small button with the current code; the menu lists every language the site has, each in its own name
{
  const box = $('.lang-switch'), btn = box.querySelector<HTMLButtonElement>('.lang-btn')!, menu = box.querySelector<HTMLElement>('.lang-menu')!;
  btn.querySelector('.lang-code')!.textContent = lang.toUpperCase();
  for (const code of LANGS) {
    const item = h('button', { attrs: { role: 'menuitemradio', 'aria-checked': String(code === lang), lang: code } }, h('span', { text: languageName(code) }), h('span', { class: 'lang-c', text: code.toUpperCase() }));
    item.addEventListener('click', () => { if (code !== lang) setLang(code); });
    menu.append(item);
  }
  const open = (o: boolean) => { menu.hidden = !o; btn.setAttribute('aria-expanded', String(o)); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); open(btn.getAttribute('aria-expanded') !== 'true'); });
  document.addEventListener('click', (e) => { if (!menu.hidden && !box.contains(e.target as Node)) open(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
}

const globe = new Globe($('#map'), api.readerLanguage());
const hint = $('#hint');
const wide = () => window.matchMedia('(min-width: 760px)').matches;
let looked: boolean | 'age' = false;
let lookedTotal = 0;
let tourStep: number | null = null;
/** True while the view is being rebuilt from the URL (first load, Back/Forward): the URL is already right. */
let restoring = false;

/** Every new place or species is a step in the browser history, so Back returns to the one before.
 *  Switching the records layer only rewrites the current step. */
const setHash = (s: ViewState, replace = false) => {
  const next = formatHash({ ...s, looked, tour: tourStep ?? undefined });
  const url = next || location.pathname + location.search;
  if (next === location.hash || (!next && !location.hash)) return;
  if (restoring || replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
};

const panelEl = $('#panel');
const sheet = initSheet(panelEl, $<HTMLButtonElement>('#panel .sheet-handle'), () => !wide(), () => pad());
const pad = () => {
  const open = !panelEl.hidden;
  globe.setPadding(open ? (wide() ? { right: 460 } : { bottom: sheet.height() * 0.95 }) : {});
};

const panel = new Panel(panelEl, $('#panel .panel-body'), {
  showSquare: (b) => globe.showSquare(b),
  drawArea: () => { hint.hidden = true; if (!wide()) sheet.collapse(); return globe.draw($('#draw-bar')); },
  fitBox: (b) => globe.fitBox(b),
  showOverlap: (fc) => globe.showOverlap(fc),
  showRanges: (r) => globe.showRanges(r),
  flyTo: (lon, lat, zoom) => globe.flyTo(lon, lat, zoom),
  setHash: (s) => setHash(s),
  journeys: {
    setOverlay: (src, fc) => globe.setOverlay(src, fc),
    fitTo: (p) => globe.fitTo(p),
    dimRange: (d) => globe.dimRange(d),
    showMonth: (k, m) => globe.showMonth(k, m),
    base,
  },
  focusSearch: (placeholder) => {
    const input = $<HTMLInputElement>('#search');
    input.placeholder = placeholder;
    input.value = '';
    input.focus();
  },
  opened: (open) => {
    if (open) closeDrawers(); // one thing on the right at a time
    const was = document.body.classList.contains('panel-open');
    document.body.classList.toggle('panel-open', open);
    if (open && !was) sheet.reset();
    pad();
  },
});

window.addEventListener('resize', () => { sheet.refresh(); pad(); });

globe.onClick((lon, lat) => {
  hint.hidden = true;
  panel.stopCompare(); // clicking a place ends "compare with…": the next search opens a species again
  panel.showPlace(lat, lon);
});

initSearch($('#search'), $('#hits'), $('#search-status'),
  (id) => {
    hint.hidden = true;
    const from = panel.comparingFrom;
    panel.stopCompare();
    if (from && from !== id) panel.showCompare(from, id); else panel.showSpecies(id);
  },
  (p) => {
    hint.hidden = true;
    panel.stopCompare();
    if (p.bbox) globe.fitBox(p.bbox); else globe.flyTo(p.lon, p.lat, 4);
    panel.showPlace(p.lat, p.lon);
  });

// Near me: the reader's own surroundings. The position stays in the browser; only the square's outline goes to GBIF.
const nearBtn = $<HTMLButtonElement>('#near-me');
const nearLbl = nearBtn.querySelector<HTMLElement>('.lbl')!; // the icon stays; only the label changes
if (!('geolocation' in navigator)) nearBtn.hidden = true;
nearBtn.addEventListener('click', () => {
  nearBtn.disabled = true;
  nearLbl.textContent = t('Finding you…');
  navigator.geolocation.getCurrentPosition((pos) => {
    nearBtn.disabled = false; nearLbl.textContent = t('Near me');
    const { latitude: lat, longitude: lon } = pos.coords;
    hint.hidden = true;
    globe.flyTo(lon, lat, 4);
    panel.showPlace(lat, lon);
  }, (err) => {
    nearBtn.disabled = false; nearLbl.textContent = t('Near me');
    hint.hidden = false;
    hint.textContent = err.code === err.PERMISSION_DENIED
      ? t('Location is switched off for this site. Allow it in the browser, or click the globe near you.')
      : t('Your location did not come through. Click the globe near you instead.');
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
});

// Protected areas: OpenStreetMap's parks and reserves; a click on one lists the animals recorded inside it
{
  const btn = $<HTMLButtonElement>('#parks'), lg = $('#parks-legend');
  let on = false;
  btn.addEventListener('click', () => { on = !on; btn.setAttribute('aria-pressed', String(on)); lg.hidden = !on; globe.setParks(on); });
  globe.onPark = async (name, lat, lon) => {
    hint.hidden = true;
    const g = await api.parkOutline(name, lat, lon).catch(() => null);
    const rings = outerRings(g, 6, 80);
    if (!rings.length) { hint.hidden = false; hint.textContent = t('The outline of {0} was not found; showing the square around it instead.', name); panel.showPlace(lat, lon); return; }
    const b = ringsBox(rings)!;
    globe.fitBox([b.west, b.south, b.east, b.north]);
    panel.showPlace(lat, lon, { kind: 'shape', rings }, name);
  };
}

// "Where scientists have looked"
const lookedBtn = $<HTMLButtonElement>('#looked');
const legend = $('#legend');
const setLooked = async (on: boolean | 'age') => {
  looked = on;
  lookedBtn.setAttribute('aria-pressed', String(!!on));
  legend.hidden = !on;
  legend.dataset.mode = on === 'age' ? 'age' : 'records';
  legend.querySelectorAll<HTMLButtonElement>('.mode button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.mode === 'age') === (on === 'age'))));
  try {
    await globe.setLooked(!!on, on === 'age' ? 'age' : 'records');
    if (on && !lookedTotal) {
      lookedTotal = await api.gbifCount({}).catch(() => 0);
      if (lookedTotal) $('#legend-note').textContent = t('{0} GBIF records of animals with a clean position, live from GBIF. Where you see the plain globe, nobody has recorded an animal.', fmt(lookedTotal));
    }
  } catch (e) {
    $('#legend-note').textContent = t('This layer did not load. Reload the page to try again.');
    console.warn(e);
  }
  setHash(parseHash(location.hash), true);
};
lookedBtn.addEventListener('click', () => setLooked(looked ? false : true));
legend.querySelectorAll<HTMLButtonElement>('.mode button').forEach((b) => b.addEventListener('click', () => setLooked(b.dataset.mode === 'age' ? 'age' : true)));

// Guided tour
const tour = initTour($('#tour'), {
  place: (lat, lon, zoom) => { hint.hidden = true; globe.flyTo(lon, lat, zoom); panel.showPlace(lat, lon); },
  species: (id) => { hint.hidden = true; panel.showSpecies(id); },
  layer: (mode) => { setLooked(mode === 'age' ? 'age' : mode ? true : false); },
  globe: (lon, lat, zoom) => globe.flyTo(lon, lat, zoom),
  closePanel: () => { if (panel.isOpen) panel.close(); },
  setStep: (n) => { tourStep = n; setHash(parseHash(location.hash), true); },
});
$('#tour-open').addEventListener('click', () => { hint.hidden = true; tour.start(1); });

// Migrations: the species with a MiCO network, by kind of animal, most connected first
const GROUP_NAME: Record<string, string> = Object.fromEntries(Object.entries({ seaturtle: 'Sea turtles', mammal: 'Sea mammals', bird: 'Seabirds', fish: 'Fish and sharks' }).map(([k, v]) => [k, t(v)]));
// The night sky behind the globe: a fixed field of faint stars (seeded, so it is the same on every visit).
(() => {
  const W = 1400, H = 900, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (!g) return;
  let seed = 20261127;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 520; i++) {
    const r = rnd() < 0.92 ? 0.35 + rnd() * 0.5 : 0.9 + rnd() * 0.7, a = 0.25 + rnd() * 0.6;
    g.fillStyle = `rgba(${rnd() < 0.15 ? '255,236,200' : rnd() < 0.3 ? '200,225,255' : '240,246,242'},${a.toFixed(2)})`;
    g.beginPath(); g.arc(rnd() * W, rnd() * H, r, 0, Math.PI * 2); g.fill();
  }
  document.documentElement.style.setProperty('--stars', `url(${c.toDataURL('image/png')})`);
})();

const migrations = $<HTMLDialogElement>('#migrations');
// Sea migrations and About open as drawers on the right (bottom sheets on phones), not as dialogs in the middle:
// the globe stays in sight and in reach. One thing on the right at a time: a drawer closes the panel and back.
function openDrawer(d: HTMLDialogElement) {
  if (panel.isOpen) panel.close();
  for (const o of document.querySelectorAll<HTMLDialogElement>('dialog.drawer')) if (o !== d && o.open) o.close();
  if (!d.open) d.show();
  document.body.classList.add('drawer-open');
}
function closeDrawers() { for (const o of document.querySelectorAll<HTMLDialogElement>('dialog.drawer')) if (o.open) o.close(); }
document.querySelectorAll<HTMLDialogElement>('dialog.drawer').forEach((d) => d.addEventListener('close', () => {
  if (![...document.querySelectorAll<HTMLDialogElement>('dialog.drawer')].some((o) => o.open)) document.body.classList.remove('drawer-open');
}));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawers(); });
const migFilter = $<HTMLInputElement>('#mig-filter');
$('#migrations-open').addEventListener('click', async () => {
  openDrawer(migrations);
  const list = migrations.querySelector<HTMLElement>('.mig-list')!;
  if (list.childElementCount) return;
  try {
    const idx = await api.micoIndex(base);
    const items = Object.entries(idx.species).sort((a, b) => b[1].routes - a[1].routes || b[1].sites - a[1].sites);
    for (const g of Object.keys(GROUP_NAME)) {
      const mine = items.filter(([, sp]) => sp.group === g);
      if (!mine.length) continue;
      const ul = h('ul', {});
      for (const [id, sp] of mine) {
        const b = h('button', { class: 'mig', attrs: { 'data-q': `${sp.common} ${sp.scientific}`.toLowerCase(), 'data-sci': sp.scientific.toLowerCase(), 'data-name': sp.scientific } },
          h('span', { class: 'mig-thumb', attrs: { 'aria-hidden': 'true' } }),
          h('span', { class: 'mig-name', text: sp.common }), h('span', { class: 'latin', text: sp.scientific }),
          h('span', { class: 'mig-n', text: sp.routes ? t('{0}, {1}', tn(sp.sites, '{0} place', '{0} places'), tn(sp.routes, '{0} link', '{0} links')) : tn(sp.sites, '{0} place', '{0} places') }));
        void id;
        b.addEventListener('click', async () => {
          const note = b.querySelector<HTMLElement>('.mig-n')!, was = note.textContent;
          note.textContent = t('Opening…');
          // MiCO names follow WoRMS: an exact GBIF match first, then GBIF's own search for the name
          const key = await api.gbifMatch(sp.scientific).catch(() => null)
            ?? (await api.gbifSearch(sp.scientific).catch(() => []))[0]?.key ?? null;
          if (!key) { note.textContent = t('Not found in GBIF under this name'); setTimeout(() => { note.textContent = was; }, 4000); return; }
          note.textContent = was;
          migrations.close(); hint.hidden = true;
          panel.showSpecies(key);
        });
        ul.append(h('li', {}, b));
      }
      list.append(h('section', { class: 'mig-group' }, h('h3', { text: `${GROUP_NAME[g]} (${mine.length})` }), ul));
    }
    // a photo beside each name, from the site itself: the animal pages' photos (data/photos/<key>.webp) and, for
    // MiCO animals without a page, data/mico/photos/ (scripts/fetch_mico_photos.py). Wikidata only for the rest.
    const own = await api.knownIndex(base);
    const micoPhotos: Record<string, [string, string, string, string]> = await fetch(`${base}data/mico/photos.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    const byName = new Map(Object.entries(own).filter(([, v]) => v[3]).map(([k, v]) => [v[2].toLowerCase(), k]));
    const put = (b: HTMLElement, src: string, title: string, fallback?: string) => {
      const img = h('img', { attrs: { src, alt: '', loading: 'lazy', width: 52, height: 52, title } }) as HTMLImageElement;
      img.addEventListener('load', () => img.classList.add('in'));
      if (fallback) img.addEventListener('error', () => { if (img.src !== fallback) img.src = fallback; }, { once: true });
      b.querySelector('.mig-thumb')!.append(img);
    };
    const rest: HTMLElement[] = [];
    list.querySelectorAll<HTMLElement>('.mig').forEach((b) => {
      const sci = b.dataset.sci!, key = byName.get(sci), mp = micoPhotos[sci];
      if (key) put(b, `${base}data/photos/${key}.webp`, `${t('Photo')}: ${own[key][3]}, ${own[key][4]}`);
      else if (mp) put(b, `${base}data/mico/photos/${mp[0]}`, `${t('Photo')}: ${mp[1]}, ${mp[2]}`);
      else rest.push(b);
    });
    if (rest.length) api.photosByName(rest.map((b) => b.dataset.name!)).then((photos) => { // Wikidata matches names as written
      for (const b of rest) {
        const file = photos.get(b.dataset.sci!);
        if (file) { const [src, fallback] = commonsThumbs(file, 120); put(b, src, t('Photo: Wikimedia Commons'), fallback); }
      }
    }).catch(() => {});
  } catch {
    list.append(h('p', { class: 'fine', text: t('The list did not load. Reload the page to try again.') }));
  }
});
migFilter.addEventListener('input', () => {
  const qv = migFilter.value.trim().toLowerCase();
  migrations.querySelectorAll<HTMLElement>('.mig-group').forEach((sec) => {
    let any = false;
    sec.querySelectorAll<HTMLElement>('.mig').forEach((b) => { const ok = !qv || b.dataset.q!.includes(qv); b.parentElement!.hidden = !ok; any ||= ok; });
    sec.hidden = !any;
  });
});
migrations.querySelector('.about-close')?.addEventListener('click', () => migrations.close());

// Data and map sources: a small card beside the credit, closed until asked for
{
  const btn = $<HTMLButtonElement>('#sources-open'), card = $('#sources');
  const set = (open: boolean) => { card.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); set(btn.getAttribute('aria-expanded') !== 'true'); });
  document.addEventListener('click', (e) => { if (!card.hidden && !card.contains(e.target as Node)) set(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
}

// About
const about = $<HTMLDialogElement>('#about');
$('#about-open').addEventListener('click', () => openDrawer(about));
about.querySelector('.about-close')?.addEventListener('click', () => about.close());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !about.open && !migrations.open && panel.isOpen && document.activeElement !== $('#search')) panel.close();
  if (e.key === '/' && document.activeElement !== $('#search') && !(document.activeElement instanceof HTMLInputElement)) { e.preventDefault(); $('#search').focus(); }
});

// Deep links and Back/Forward
const apply = (s: ViewState) => {
  restoring = true;
  try {
    if ((s.looked ?? false) !== looked) setLooked(s.looked ?? false);
    if (s.tour && !tour.open) tour.start(s.tour);
    if (s.sp && s.vs) { hint.hidden = true; panel.showCompare(s.sp, s.vs); }
    else if (s.sp) {
      hint.hidden = true;
      if (s.at) { panel.rememberPlace(s.at.lat, s.at.lon, s.area); globe.flyTo(s.at.lon, s.at.lat, 3.2); }
      panel.showSpecies(s.sp, !!s.at);
    } else if (s.at) {
      hint.hidden = true;
      if (s.area?.kind === 'shape') { const b = ringsBox(s.area.rings)!; globe.fitBox([b.west, b.south, b.east, b.north]); }
      else if (s.area?.kind !== 'gadm') globe.flyTo(s.at.lon, s.at.lat, 4);
      panel.showPlace(s.at.lat, s.at.lon, s.area);
    }
    else if (panel.isOpen) panel.close(false);
  } finally { restoring = false; }
};
window.addEventListener('popstate', () => apply(parseHash(location.hash)));
apply(parseHash(location.hash));

// test hook for scripts/screenshots.mjs
(window as unknown as { __atlas: unknown }).__atlas = { globe, panel };
