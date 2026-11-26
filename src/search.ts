// One search box for animals (a common name in any language Wikidata knows, or a scientific name) and for places
// ("Tashkent", "Serengeti", "Aral Sea"). Keyboard friendly (arrows, Enter, Escape).
import * as api from './api';
import { h, loadPhoto } from './dom';
import { GROUP_LABEL, groupOfKeys, type GroupId } from './taxa';
import { commonsThumbs } from './wiki';
import { silhouette } from './silhouettes';
import { L } from './i18n';

export interface Hit { id: number; scientificName: string; group: GroupId; exact: boolean; common?: string }
type Item = { kind: 'taxon'; hit: Hit } | { kind: 'place'; place: api.Place };

const DENSE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
export const minQueryLength = (q: string) => (DENSE.test(q) ? 1 : 2);
const PIN = 'M32 6c-10 0-18 8-18 18 0 13 18 34 18 34s18-21 18-34c0-10-8-18-18-18zm0 11a7 7 0 1 1 0 14 7 7 0 0 1 0-14z';

/** Accepted species from GBIF search results: synonyms point to their accepted key, duplicates collapse, and a hit
 *  is exact when the query is one of its common names or its scientific name. */
export function mergeGbif(results: api.GbifSpecies[], query: string, wdKeys: number[] = []): Hit[] {
  const ql = query.trim().toLowerCase();
  const out = new Map<number, Hit>();
  for (const r of results as (api.GbifSpecies & { vernacularNames?: { vernacularName: string }[] })[]) {
    if (r.rank && r.rank !== 'SPECIES') continue;
    const id = r.taxonomicStatus && r.taxonomicStatus !== 'ACCEPTED' && r.acceptedKey ? r.acceptedKey : r.nubKey ?? r.key;
    const names = (r.vernacularNames ?? []).map((v) => v.vernacularName.toLowerCase());
    const exact = names.includes(ql) || (r.canonicalName ?? '').toLowerCase() === ql;
    const prev = out.get(id);
    if (prev) { prev.exact ||= exact; prev.common ??= r.vernacularName; continue; }
    out.set(id, { id, scientificName: r.canonicalName ?? r.scientificName, group: groupOfKeys(r.classKey, r.phylumKey, r.orderKey), exact, common: r.vernacularName });
  }
  for (const k of wdKeys) { const x = out.get(k); if (x) x.exact = true; }
  return [...out.values()];
}

/** Exact names first, then the animals people record most (a good proxy for "the one people mean"). */
export function rankHits(hits: Hit[], records: Map<number, number>, limit = 8): Hit[] {
  return [...hits].sort((a, b) => Number(b.exact) - Number(a.exact) || (records.get(b.id) ?? 0) - (records.get(a.id) ?? 0) || a.scientificName.localeCompare(b.scientificName)).slice(0, limit);
}

export function initSearch(input: HTMLInputElement, list: HTMLUListElement, status: HTMLElement,
  pick: (id: number) => void, pickPlace: (p: api.Place) => void) {
  let timer = 0, seq = 0, items: Item[] = [], itemsFor = '', cursor = -1, ctl: AbortController | null = null;
  const lang = api.readerLanguage();

  const close = () => { list.hidden = true; cursor = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  const choose = (i: number) => {
    const it = items[i];
    if (!it) return;
    close();
    input.blur();
    if (it.kind === 'taxon') pick(it.hit.id); else pickPlace(it.place);
  };
  const highlight = (i: number) => {
    cursor = i;
    list.querySelectorAll('li[role=option]').forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
    if (i >= 0) input.setAttribute('aria-activedescendant', `hit-${i}`);
  };

  const run = async (q: string) => {
    const my = ++seq;
    ctl?.abort();
    ctl = new AbortController();
    const signal = ctl.signal;
    status.textContent = L('Searching…', 'Qidirilmoqda…');
    const val = <T,>(r: PromiseSettledResult<T[]>) => (r.status === 'fulfilled' ? r.value : []);
    // Latin script, Uzbek ʻ (U+02BB) and apostrophes included: "oʻrdak" still goes to GBIF
    const latin = !/[^\u0000-\u024F\u02BB\u02BC\u2018\u2019]/.test(q);
    const none = Promise.resolve([] as never[]);
    const [s1, s2, wd, places] = await Promise.allSettled([
      latin ? api.gbifSearch(q, signal) : none,
      latin ? api.gbifSuggest(q, signal) : none,
      api.wikidataSearchAphia(q, lang, signal),
      q.length >= 3 ? api.searchPlaces(q, lang, signal) : none,
    ]);
    if (my !== seq) return;
    const wdKeys = val(wd);
    const wdSpecies = (await Promise.all(wdKeys.slice(0, 6).map((k) => api.gbifSpecies(k, signal).catch(() => null)))).filter((x): x is api.GbifSpecies => !!x && x.kingdom === 'Animalia');
    const all = mergeGbif([...wdSpecies, ...val(s1), ...val(s2)], q, wdKeys);
    const recs = new Map<number, number>();
    if (all.length) {
      const f = await api.gbifFacet({ taxonKey: all.slice(0, 30).map((x) => x.id) }, 'speciesKey', 30, signal).catch(() => []);
      for (const x of f) recs.set(Number(x.name), x.count);
    }
    if (my !== seq) return;
    const hits = rankHits(all, recs);
    const pl = val(places).slice(0, hits.length ? 3 : 5);
    const placesFirst = pl.length > 0 && pl[0].name.toLowerCase().startsWith(q.toLowerCase()) && !hits.some((x) => x.exact);
    const taxa = hits.map((hit) => ({ kind: 'taxon' as const, hit })), spots = pl.map((place) => ({ kind: 'place' as const, place }));
    items = placesFirst ? [...spots, ...taxa] : [...taxa, ...spots];
    itemsFor = q;
    list.replaceChildren();
    cursor = -1;
    if (!items.length) {
      status.textContent = [s1, wd, places].every((r) => r.status === 'rejected')
        ? L('Search is not answering right now. Check the connection and try again.', 'Qidiruv hozir javob bermayapti. Internetni tekshirib, qayta urinib koʻring.')
        : L(`No animal or place called "${q}". Try another name, or the scientific name.`, `"${q}" nomli hayvon yoki joy topilmadi. Boshqa nom yoki ilmiy nomni sinab koʻring.`);
      list.append(h('li', { class: 'empty', text: status.textContent }));
    } else status.textContent = L(`${items.length} results`, `${items.length} ta natija`);
    items.forEach((it, i) => {
      if (it.kind === 'place' && (i === 0 || items[i - 1].kind !== 'place')) list.append(h('li', { class: 'hits-head', text: L('Places', 'Joylar'), attrs: { role: 'presentation' } }));
      if (it.kind === 'taxon' && pl.length && (i === 0 || items[i - 1].kind !== 'taxon')) list.append(h('li', { class: 'hits-head', text: L('Animals', 'Hayvonlar'), attrs: { role: 'presentation' } }));
      const li = it.kind === 'taxon' ? taxonRow(it.hit) : placeRow(it.place);
      if (it.kind === 'taxon') li.dataset.taxon = String(it.hit.id);
      li.id = `hit-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
      list.append(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (!hits.length) return;
    const info = (await api.wikidataByAphia(hits.map((x) => x.id), undefined, lang, signal).catch(() => null)) ?? new Map();
    if (my !== seq) return;
    hits.forEach((hit) => {
      const w = info.get(hit.id), li = list.querySelector<HTMLElement>(`li[data-taxon="${hit.id}"]`);
      if (!li) return;
      const name = w?.name ?? (lang !== 'uz' ? hit.common : undefined);
      if (name) { li.querySelector('.hit-name')!.textContent = name.charAt(0).toUpperCase() + name.slice(1); li.querySelector('.latin')!.textContent = hit.scientificName; }
      if (w?.image) loadPhoto(li.querySelector('.hit-thumb')!, commonsThumbs(w.image, 120), '', true);
    });
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < minQueryLength(q)) { seq++; ctl?.abort(); close(); status.textContent = ''; return; }
    timer = window.setTimeout(() => run(q), 300);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); highlight(Math.min(cursor + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); highlight(Math.max(cursor - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (itemsFor === input.value.trim()) choose(cursor >= 0 ? cursor : 0); }
    else if (e.key === 'Escape') { close(); input.blur(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('focus', () => { if (items.length && input.value.trim().length >= minQueryLength(input.value.trim())) { list.hidden = false; input.setAttribute('aria-expanded', 'true'); } });
}

function taxonRow(hit: Hit): HTMLLIElement {
  return h('li', {}, h('span', { class: `hit-thumb g-${hit.group}` }, silhouette(hit.group)),
    h('span', { class: 'hit-text' }, h('span', { class: 'hit-name', text: hit.scientificName }), h('span', { class: 'latin', text: '' }),
      h('span', { class: 'hit-group', text: GROUP_LABEL[hit.group] })));
}

function placeRow(p: api.Place): HTMLLIElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('silhouette');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', PIN);
  path.setAttribute('fill-rule', 'evenodd');
  svg.append(path);
  return h('li', { class: 'place-hit' }, h('span', { class: 'hit-thumb place' }, svg),
    h('span', { class: 'hit-text' }, h('span', { class: 'hit-name', text: p.name }), h('span', { class: 'hit-group', text: p.type })));
}
