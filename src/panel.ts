// The side panel: "Who lives here" for a clicked square, a species page and two species side by side. Data arrives
// in stages, so each view renders a skeleton first and fills in names, photos and credits as they come back. Each view
// owns an AbortController: opening another view cancels the requests of the one before.
import * as api from './api';
import { h, fmt, loadPhoto, plural, download } from './dom';
import { bboxToWkt, formatLatLon, geohash, geohashBounds, type BBox } from './geo';
import {
  countByGroup, interleaveGroups, GROUPS, GROUP_LABEL, groupOfKeys, IUCN_LABEL, rankSpecies, THREATENED, verticalRange, ZONES,
  type GroupId, type Taxon,
} from './taxa';
import { articleTitle, commonsAudio, commonsThumbs, type WikiInfo } from './wiki';
import { renderJourneys, type JourneyHost } from './journeys';
import { silhouette } from './silhouettes';
import { chao1, formatLength, formatMass, parseTraits, toCsv, type Traits } from './science';
import { L, count, lang } from './i18n';

const PAGE = 36;
/** Species whose photos are looked up before the first screen is drawn, so it can lead with ones that have a photo. */
const PREFETCH = 72;
export const FEW_RECORDS = 1000;
const ext = { target: '_blank', rel: 'noopener' };
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type RangeMode = { key: number; mode: 'all' | 'then' | 'now' | 'a' | 'b' };
export interface PanelHost {
  showSquare(b: BBox | null): void;
  /** Species ranges as GBIF map tiles; several at once for then/now and side by side. */
  showRanges(r: RangeMode[]): void;
  flyTo(lon: number, lat: number, zoom?: number): void;
  setHash(s: { at?: { lat: number; lon: number }; sp?: number; vs?: number }): void;
  opened(open: boolean): void;
  focusSearch(placeholder: string): void;
  journeys: JourneyHost;
}

/** What a tile or a page needs about a species, from Wikidata, GBIF and iNaturalist. */
interface Known { name?: string; sci?: string; image?: string; photo?: api.Photo; article?: string; articleLang?: string }

export class Panel {
  private token = 0;
  private place: { lat: number; lon: number } | null = null;
  private species: { id: number; name: string } | null = null;
  private cleanups: (() => void)[] = [];
  private ctl = new AbortController();
  private lang = api.readerLanguage();
  private known = new Map<number, Known>();
  comparingFrom: number | null = null;

  private runCleanups() { for (const c of this.cleanups.splice(0)) c(); }

  constructor(private root: HTMLElement, private body: HTMLElement, private host: PanelHost) {
    root.querySelector('.panel-close')?.addEventListener('click', () => this.close());
  }

  get isOpen() { return !this.root.hidden; }
  rememberPlace(lat: number, lon: number) { this.place = { lat, lon }; }

  close(writeHash = true) {
    this.token++;
    this.ctl.abort();
    this.runCleanups();
    this.place = null;
    this.species = null;
    this.root.hidden = true;
    this.host.showSquare(null);
    this.host.showRanges([]);
    if (writeHash) this.host.setHash({});
    this.host.opened(false);
  }

  private open(): { t: number; signal: AbortSignal } {
    this.ctl.abort();
    this.ctl = new AbortController();
    this.runCleanups();
    this.root.hidden = false;
    this.host.opened(true);
    this.body.replaceChildren();
    this.body.scrollTop = 0;
    return { t: ++this.token, signal: this.ctl.signal };
  }

  // ---------------- Who lives here ----------------
  async showPlace(lat: number, lon: number) {
    const from = this.species;
    const { t, signal } = this.open();
    this.species = null;
    this.place = { lat, lon };
    this.host.showRanges([]);
    this.host.setHash({ at: { lat, lon } });
    const box = geohashBounds(geohash(lon, lat, 3));
    this.host.showSquare(box);
    const wkt = bboxToWkt(box);

    const nav = from ? h('button', { class: 'back', text: L(`Back to ${from.name}`, `${from.name} sahifasiga qaytish`), on: { click: () => this.showSpecies(from.id) } }) : null;
    const title = h('h2', { class: 'place-title', text: formatLatLon(lat, lon) });
    const kmNS = Math.round((box.north - box.south) * 111.3);
    const kmEW = Math.round((box.east - box.west) * 111.3 * Math.cos((lat * Math.PI) / 180));
    const sub = h('p', { class: 'place-sub', text: formatLatLon(lat, lon) });
    const area = L(`the outlined square, about ${kmEW} by ${kmNS} km`, `belgilangan taxminan ${kmEW} × ${kmNS} km kvadrat`);
    const summary = h('p', { class: 'summary', text: L('Finding animals recorded here…', 'Bu yerda qayd etilgan hayvonlar qidirilmoqda…') });
    this.body.append(...[nav, h('header', { class: 'place-head' }, title, sub), summary].filter((x): x is HTMLElement => !!x));
    sub.hidden = true;
    api.placeName(lat, lon, this.lang, signal).then((n) => {
      if (!n || t !== this.token) return;
      title.textContent = n.name;
      sub.hidden = false;
    });

    const tell = (n: number, rec: number) => {
      summary.textContent = L(`${plural(n, 'species', 'species')} of animals recorded in ${area}, from ${fmt(rec)} records.`,
        `${area} ichida ${fmt(rec)} ta yozuvdan ${fmt(n)} ta hayvon turi qayd etilgan.`);
    };
    // The all-animals answer comes first: count, records and completeness show while the kinds are still sorting.
    let survey: HTMLElement | null = null;
    const sorting = h('div', { class: 'sorting' },
      h('p', { class: 'fine', text: L('Sorting them by kind of animal…', 'Hayvon turkumlari boʻyicha saralanmoqda…') }),
      h('ul', { class: 'mosaic' }, ...Array.from({ length: 6 }, () => h('li', { class: 'tile-skeleton', attrs: { 'aria-hidden': 'true' } }))));
    const early = (c: api.Checklist) => {
      if (t !== this.token || !c.list.length) return;
      tell(c.list.length, c.records);
      survey = this.surveyBox(c.list, !c.truncated, wkt, signal, t);
      this.body.append(survey, sorting);
    };

    let list: Taxon[], records: number, truncated: boolean;
    try {
      const r = await api.gbifChecklist(wkt, signal, early);
      list = rankSpecies(r.list); records = r.records; truncated = r.truncated;
    } catch (e) {
      if (t !== this.token) return;
      sorting.remove();
      summary.textContent = L('The species list did not load. GBIF may be busy; try the same spot again in a moment.', 'Turlar roʻyxati yuklanmadi. GBIF band boʻlishi mumkin; birozdan keyin shu joyni qayta bosing.');
      summary.classList.add('error');
      this.body.append(h('button', { class: 'btn', text: L('Try again', 'Qayta urinish'), on: { click: () => this.showPlace(lat, lon) } }));
      console.warn(e);
      return;
    }
    if (t !== this.token) return;
    if (!list.length) {
      summary.textContent = L('Nobody has recorded an animal in this square yet. Switch on "Where people have looked" to find well-studied ground.', 'Bu kvadratda hali hech kim hayvon qayd etmagan. Yaxshi oʻrganilgan joylarni topish uchun "Odamlar qayerni oʻrgangan" qatlamini yoqing.');
      return;
    }
    sorting.remove();
    tell(list.length, records);
    survey ??= this.body.appendChild(this.surveyBox(list, !truncated, wkt, signal, t));
    if (truncated) survey.before(h('p', { class: 'fine', text: L('One kind of animal here has more than 3,000 species on record; the list shows its 3,000 most recorded.', 'Bu yerdagi bir turkumda 3 000 dan ortiq tur bor; roʻyxatda uning eng koʻp qayd etilgan 3 000 tasi.') }));
    if (records < FEW_RECORDS) this.body.append(h('p', { class: 'callout', text: L('Few people have looked here. Most of the animals in this square have never been recorded, so this list is only a start.', 'Bu yerni kam odam oʻrgangan. Bu kvadratdagi hayvonlarning katta qismi hech qachon qayd etilmagan, shuning uchun roʻyxat faqat boshlanishi.') }));

    const counts = countByGroup(list);
    let mixed = interleaveGroups(list);
    let active: GroupId | 'all' = 'all';
    const chips = h('div', { class: 'chips', attrs: { role: 'group', 'aria-label': L('Filter by kind of animal', 'Hayvon turkumi boʻyicha saralash') } });
    const grid = h('ul', { class: 'mosaic' });
    const more = h('button', { class: 'btn more', text: L('Show more', 'Yana koʻrsatish') });
    const render = () => {
      const shown = active === 'all' ? mixed : list.filter((x) => x.group === active);
      grid.replaceChildren();
      let n = 0;
      const page = () => {
        const slice = shown.slice(n, n + PAGE);
        n += slice.length;
        this.fillTiles(t, grid, slice, signal);
        more.hidden = n >= shown.length;
        more.textContent = L(`Show more (${fmt(shown.length - n)} left)`, `Yana koʻrsatish (${fmt(shown.length - n)} ta qoldi)`);
      };
      more.onclick = page;
      page();
    };
    const chip = (id: GroupId | 'all', label: string, n: number) => {
      const b = h('button', { class: 'chip', text: `${label} ${fmt(n)}`, attrs: { 'aria-pressed': String(id === active) } });
      b.addEventListener('click', () => {
        active = id;
        chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        render();
      });
      return b;
    };
    chips.append(chip('all', L('All', 'Hammasi'), list.length));
    for (const g of GROUPS) if (counts.get(g.id)) chips.append(chip(g.id, GROUP_LABEL[g.id], counts.get(g.id)!));
    for (let i = 0; i < 6; i++) grid.append(h('li', { class: 'tile-skeleton', attrs: { 'aria-hidden': 'true' } }));
    const csv = h('button', { class: 'btn small quiet', text: L('Download the list (CSV)', 'Roʻyxatni yuklab olish (CSV)') });
    csv.addEventListener('click', async () => {
      csv.disabled = true;
      await this.lookup(list.slice(0, 400), signal).catch(() => {});
      csv.disabled = false;
      const rows = [['gbif_key', 'scientific_name', 'common_name', 'group', 'records_in_square', 'gbif_url'],
        ...list.map((x) => [x.key, this.known.get(x.key)?.sci ?? '', this.known.get(x.key)?.name ?? '', GROUPS.find((g) => g.id === x.group)!.label, x.records, `https://www.gbif.org/species/${x.key}`])];
      download(`fauna-${lat.toFixed(2)}_${lon.toFixed(2)}.csv`, toCsv(rows), 'text/csv');
    });
    this.body.append(chips, grid, more,
      h('p', { class: 'fine', text: L('The mixed view takes each kind in turn and leads with species that have a photo; insects, spiders and worms take a turn less often, because they would fill the screen. Record counts reflect where people looked and what they looked for, not only what is common.', 'Aralash koʻrinish turkumlarni navbatma-navbat oladi va rasmi bor turlardan boshlaydi; hasharotlar, oʻrgimchaklar va chuvalchanglar ekranni toʻldirib yubormasligi uchun kamroq navbat oladi. Yozuvlar soni nima keng tarqalganini emas, odamlar qayerda va nimani qidirganini ham koʻrsatadi.') }),
      h('div', { class: 'btn-row export' }, csv),
      h('p', { class: 'fine cite', text: L('Cite: ', 'Iqtibos: ') + `GBIF.org (${new Date().toISOString().slice(0, 10)}) GBIF Occurrence Search, Animalia, ${wkt}, https://www.gbif.org` }));
    more.hidden = true;

    const head = mixed.slice(0, PREFETCH);
    await Promise.race([this.lookup(head, signal), new Promise((r) => setTimeout(r, 4000))]);
    if (t !== this.token) return;
    const hasPhoto = (x: Taxon) => !!this.known.get(x.key)?.image;
    mixed = [...head.filter(hasPhoto), ...head.filter((x) => !hasPhoto(x)), ...mixed.slice(PREFETCH)];
    render();
  }

  /** Inventory completeness and record years for a square. */
  private surveyBox(list: Taxon[], complete: boolean, wkt: string, signal: AbortSignal, t: number): HTMLElement {
    const box = h('div', { class: 'survey' });
    const ch = complete ? chao1(list.map((x) => x.records)) : null;
    if (ch) {
      const pct = Math.round(ch.completeness * 100);
      box.append(
        h('div', { class: 'meter', attrs: { role: 'img', 'aria-label': L(`About ${pct} % of the likely species recorded`, `Ehtimoliy turlarning taxminan ${pct} % qayd etilgan`) } }, h('span', { attrs: { style: `--w:${pct}%` } })),
        h('p', { text: L(`Recorded so far: about ${pct} % of the ${fmt(Math.round(ch.estimate))} species that more looking would probably find here.`, `Hozircha qayd etilgan: koʻproq izlansa bu yerda topilishi mumkin boʻlgan ${fmt(Math.round(ch.estimate))} ta turning taxminan ${pct} %.`) }),
        h('p', { class: 'fine', text: L(`Chao1 estimate from ${plural(ch.observed, 'species', 'species')}, ${fmt(ch.f1)} of them recorded only once and ${fmt(ch.f2)} twice. Records stand in for individuals, so read it as a guide to how well this ground is known, not a count.`,
          `Chao1 bahosi: ${fmt(ch.observed)} ta tur, ulardan ${fmt(ch.f1)} tasi faqat bir marta va ${fmt(ch.f2)} tasi ikki marta qayd etilgan. Yozuvlar individlar oʻrnida, shuning uchun buni sanoq emas, joy qanchalik yaxshi oʻrganilgani haqidagi yoʻl-yoʻriq deb oʻqing.`) }));
    }
    api.gbifFacet({ geometry: wkt }, 'year', 400, signal).then((ys) => {
      if (t !== this.token) return;
      const years = ys.map((y) => Number(y.name)).filter((y) => y >= 1700 && y <= 2100);
      if (!years.length) return;
      const first = Math.min(...years), last = Math.max(...years), age = new Date().getUTCFullYear() - last;
      box.append(h('p', { class: 'fine', text: age > 10 ? L(`Records from ${first} to ${last}: nobody has recorded an animal here for ${age} years.`, `Yozuvlar ${first}–${last} yillar: bu yerda ${age} yildan beri hech kim hayvon qayd etmagan.`)
        : L(`Records from ${first} to ${last}.`, `Yozuvlar ${first}–${last} yillar.`) }));
    }).catch(() => {});
    return box;
  }

  /** Names, scientific names and photos for species not looked up yet: Wikidata by GBIF id first, then GBIF itself,
   *  then an openly licensed iNaturalist photo. */
  private async lookup(taxa: Taxon[], signal: AbortSignal) {
    const need = taxa.filter((x) => !this.known.has(x.key));
    if (!need.length) return;
    const info = await api.wikidataByAphia(need.map((s) => s.key), undefined, this.lang, signal).catch(() => new Map<number, WikiInfo>());
    if (signal.aborted) return;
    for (const s of need) this.known.set(s.key, { ...(info.get(s.key) ?? {}) });
  }

  /** Scientific and English names from GBIF for tiles Wikidata did not know, six at a time. */
  private async fillFromGbif(keys: number[], t: number, apply: (k: number) => void) {
    for (let i = 0; i < keys.length && t === this.token; i += 6) {
      await Promise.all(keys.slice(i, i + 6).map(async (k) => {
        const sp = await api.gbifSpecies(k, undefined, true).catch(() => null);
        if (!sp || t !== this.token) return;
        const kn = this.known.get(k) ?? {};
        kn.sci ??= sp.canonicalName ?? sp.scientificName;
        if (!kn.name && sp.vernacularName && lang !== 'uz') kn.name = capital(sp.vernacularName);
        if (!kn.image && !kn.photo) kn.photo = (await api.gbifPhoto(k, undefined, true).catch(() => null)) ?? undefined;
        this.known.set(k, kn);
        apply(k);
      }));
    }
  }

  private fillTiles(t: number, grid: HTMLElement, slice: Taxon[], signal: AbortSignal) {
    const tiles = new Map<number, HTMLElement>();
    for (const sp of slice) {
      const name = h('span', { class: 'tile-name', text: '' });
      const latin = h('span', { class: 'latin', text: '' });
      const photo = h('div', { class: `tile-photo g-${sp.group}`, attrs: { 'data-photo': 'loading' } },
        silhouette(sp.group), h('span', { class: 'tile-group', text: GROUP_LABEL[sp.group] }));
      const btn = h('button', { class: 'tile', attrs: { 'aria-label': GROUP_LABEL[sp.group] } }, photo, name, latin,
        h('span', { class: 'tile-n', text: count(sp.records, 'record', 'records', 'yozuv') }));
      btn.addEventListener('click', () => this.showSpecies(sp.key, true));
      const li = h('li', {}, btn);
      tiles.set(sp.key, li);
      grid.append(li);
    }
    const apply = (k: number) => {
      const li = tiles.get(k), w = this.known.get(k);
      if (!li || !w) return;
      if (w.name) li.querySelector('.tile-name')!.textContent = w.name;
      if (w.sci) li.querySelector('.latin')!.textContent = w.sci;
      li.querySelector('.tile')!.setAttribute('aria-label', [w.name, w.sci].filter(Boolean).join(', '));
      const frame = li.querySelector<HTMLElement>('.tile-photo')!;
      if (frame.querySelector('img')) return;
      if (w.image) loadPhoto(frame, commonsThumbs(w.image, 330), '', false).dataset.file = w.image;
      else if (w.photo) { const img = loadPhoto(frame, [w.photo.url], '', false); img.title = `${L('Photo', 'Surat')}: ${w.photo.credit}, ${w.photo.licence}, iNaturalist`; }
    };
    this.lookup(slice, signal).then(() => {
      if (t !== this.token) return;
      for (const k of tiles.keys()) apply(k);
      const files = slice.map((s) => this.known.get(s.key)?.image).filter((x): x is string => !!x);
      api.commonsCredits(files).then((credits) => {
        if (t !== this.token) return;
        grid.querySelectorAll<HTMLImageElement>('img[data-file]').forEach((img) => {
          const c = credits.get(img.dataset.file!);
          if (c) img.title = `${L('Photo', 'Surat')}: ${c.artist}, ${c.licence}, Wikimedia Commons`;
        });
      });
      const missing = slice.map((s) => s.key).filter((k) => { const w = this.known.get(k); return !w?.sci || !w?.image; });
      this.fillFromGbif(missing, t, apply).then(() => {
        for (const li of tiles.values()) {
          const f = li.querySelector<HTMLElement>('.tile-photo')!;
          if (f.dataset.photo === 'loading' && !f.querySelector('img')) f.dataset.photo = 'none';
        }
      });
    });
  }

  // ---------------- Species page ----------------
  async showSpecies(id: number, fromPlace = false) {
    const back = fromPlace && this.place ? { ...this.place } : null;
    const { t, signal } = this.open();
    this.species = { id, name: L('this species', 'bu tur') };
    this.host.setHash({ at: back ?? undefined, sp: id });
    if (!back) { this.place = null; this.host.showSquare(null); }
    else this.host.showSquare(geohashBounds(geohash(back.lon, back.lat, 3)));
    this.host.showRanges([{ key: id, mode: 'all' }]);
    // from a place the camera stays there; otherwise fly to where the records are
    if (!back) api.gbifCentre(id, signal).then((c) => { if (c && t === this.token) this.host.flyTo(c.lon, c.lat, 3); });

    const nav = back ? h('button', { class: 'back', text: L('Back to this place', 'Shu joyga qaytish'), on: { click: () => this.showPlace(back.lat, back.lon) } }) : null;
    const figure = h('figure', { class: 'hero' });
    const name = h('h2', { class: 'sp-name', text: '' });
    const latin = h('p', { class: 'latin big', text: '' });
    const lineage = h('p', { class: 'lineage', text: '' });
    const status = h('p', { class: 'status', hidden: true } as never);
    const about = h('div', { class: 'about-sp' });
    const facts = h('dl', { class: 'facts' });
    const bodyBox = h('section', { class: 'body-box', attrs: { hidden: true } });
    const vertical = h('section', { class: 'depth' });
    const tools = h('section', { class: 'tools' });
    const journeys = h('div', { class: 'journeys-mount' });
    const links = h('p', { class: 'links' });
    const rangeNote = h('p', { class: 'fine', text: L('Coloured squares on the globe: where it has been recorded (GBIF).', 'Globusdagi rangli kvadratchalar: u qayd etilgan joylar (GBIF).') });
    status.hidden = true;
    this.body.append(...[nav, figure, name, latin, lineage, status, about, rangeNote, facts, bodyBox, vertical, tools, journeys, links].filter((x): x is HTMLElement => !!x));

    const [sp, total, red, info] = await Promise.all([
      api.gbifSpecies(id, signal).catch(() => null),
      api.gbifCount({ taxonKey: id }, signal).catch(() => null),
      api.gbifRedList(id),
      api.wikidataByAphia([id], undefined, this.lang, signal).then((m) => m.get(id) ?? null).catch(() => null),
    ]);
    if (t !== this.token) return;
    if (!sp) {
      name.textContent = L('This species did not load', 'Bu tur yuklanmadi');
      rangeNote.textContent = L('GBIF did not answer. Check the connection and open the species again.', 'GBIF javob bermadi. Internetni tekshirib, turni qayta oching.');
      return;
    }
    const sci = sp.canonicalName ?? sp.scientificName;
    let wiki: WikiInfo = { ...(info ?? {}) };
    if (!wiki.image) {
      const byName = await api.wikidataByAphia([id], new Map([[id, sci]]), this.lang, signal).then((m) => m.get(id)).catch(() => undefined);
      if (t !== this.token) return;
      if (byName) wiki = { ...byName, ...Object.fromEntries(Object.entries(wiki).filter(([, v]) => v != null)) };
    }
    if (!wiki.image) {
      // Wikidata may know it under a synonym's GBIF key (the snow leopard sits under Panthera uncia, GBIF has Uncia uncia)
      const syn = await api.gbifSynonyms(id, signal);
      if (syn.length) {
        const m = await api.wikidataByAphia(syn, undefined, this.lang, signal).catch(() => new Map<number, WikiInfo>());
        const hit = syn.map((k) => m.get(k)).find((w) => w?.image) ?? syn.map((k) => m.get(k)).find((w) => w?.name);
        if (hit) wiki = { ...hit, ...Object.fromEntries(Object.entries(wiki).filter(([, v]) => v != null)) };
      }
      if (t !== this.token) return;
    }
    if (wiki.name && wiki.name.toLowerCase() === sci.toLowerCase()) delete wiki.name;
    const common = wiki.name ?? (lang !== 'uz' && sp.vernacularName ? capital(sp.vernacularName) : undefined);
    name.textContent = common ?? sci;
    latin.textContent = sci;
    if (!common) { latin.hidden = true; name.classList.add('latin'); }
    this.species = { id, name: common ?? sci };
    const group = groupOfKeys(sp.classKey, sp.phylumKey);
    lineage.textContent = [GROUP_LABEL[group], sp.family && L(`family ${sp.family}`, `${sp.family} oilasi`), sp.order && L(`order ${sp.order}`, `${sp.order} turkumi`)].filter(Boolean).join(', ');
    if (red && IUCN_LABEL[red]) { status.hidden = false; status.append(h('span', { class: `iucn iucn-${red}`, text: IUCN_LABEL[red] }), L(' on the IUCN Red List', ' — IUCN Qizil roʻyxatida')); }

    const frame = h('div', { class: 'hero-frame' });
    const cap = h('figcaption', { text: '' });
    if (wiki.image) {
      figure.append(frame, cap);
      cap.textContent = L('Photo: Wikimedia Commons', 'Surat: Wikimedia Commons');
      loadPhoto(frame, commonsThumbs(wiki.image, 960), L(`Photo of ${name.textContent}`, `${name.textContent} surati`), true);
      api.commonsCredits([wiki.image]).then((c) => {
        const cr = c.get(wiki.image!);
        if (cr && t === this.token) cap.replaceChildren(L('Photo: ', 'Surat: '), h('a', { text: `${cr.artist}, ${cr.licence}`, attrs: { href: cr.page, ...ext } }));
      });
    } else {
      const p = await api.gbifPhoto(id, signal).catch(() => null);
      if (t !== this.token) return;
      if (p) {
        figure.append(frame, cap);
        loadPhoto(frame, [p.url.replace('/medium.', '/large.'), p.url], L(`Photo of ${name.textContent}`, `${name.textContent} surati`), true);
        cap.replaceChildren(L('Photo: ', 'Surat: '), h('a', { text: `${p.credit}, ${p.licence}, iNaturalist`, attrs: { href: p.page, ...ext } }));
      } else figure.hidden = true;
    }

    const title = wiki.article ? articleTitle(wiki.article) : null;
    if (title) {
      api.wikipediaSummary(title, wiki.articleLang ?? 'en').then((s) => {
        if (!s || t !== this.token) return;
        const text = h('p', { class: 'extract clamped', text: s.extract, attrs: { lang: s.lang } });
        const toggle = h('button', { class: 'link-btn', text: L('Read more', 'Batafsil') });
        toggle.addEventListener('click', () => { const c = text.classList.toggle('clamped'); toggle.textContent = c ? L('Read more', 'Batafsil') : L('Show less', 'Qisqaroq'); });
        about.append(text, h('p', { class: 'fine' }, toggle, L(' From ', ' Manba: '), h('a', { text: s.lang === 'en' ? 'Wikipedia' : `Wikipedia (${s.lang})`, attrs: { href: s.url, ...ext } }), ', CC BY-SA 4.0'));
        requestAnimationFrame(() => { if (text.scrollHeight <= text.clientHeight + 2) toggle.remove(); });
      });
    }

    const row = (k: string, v: string) => facts.append(h('dt', { text: k }), h('dd', { text: v }));
    if (total != null) row(L('Records', 'Yozuvlar'), fmt(total));
    api.gbifFacet({ taxonKey: id }, 'year', 400, signal).then((ys) => {
      if (t !== this.token) return;
      const years = ys.map((y) => Number(y.name)).filter((y) => y >= 1700 && y <= 2100);
      if (years.length) row(L('Recorded', 'Qayd etilgan'), `${Math.min(...years)}–${Math.max(...years)}`);
    }).catch(() => {});

    api.wikidataExtras(id, signal).then((x) => { if (t === this.token) this.renderBody(bodyBox, parseTraits(x.rows), x.audio, name.textContent ?? ''); }).catch(() => {});
    this.renderVertical(vertical, id, signal, t);
    this.renderTools(tools, id, sci, this.species.name, signal, t);
    this.cleanups.push(renderJourneys({ id, commonName: this.species.name, sci, signal }, journeys, this.host.journeys, () => t === this.token));

    links.append(
      h('a', { text: 'GBIF', attrs: { href: `https://www.gbif.org/species/${id}`, ...ext } }), ' ',
      h('a', { text: 'iNaturalist', attrs: { href: `https://www.inaturalist.org/taxa/search?q=${encodeURIComponent(sci)}`, ...ext } }),
    );
  }

  /** From the deep sea to the mountain tops: where along the vertical its records lie. */
  private async renderVertical(box: HTMLElement, id: number, signal: AbortSignal, t: number) {
    const counts = await api.gbifVertical(id, signal).catch(() => ZONES.map(() => 0));
    if (t !== this.token) return;
    const r = verticalRange(counts);
    if (!r) return;
    const max = Math.max(...counts, 1);
    const where = (v: number) => (v >= 0 ? L(`${fmt(v)} m above sea level`, `dengiz sathidan ${fmt(v)} m yuqori`) : L(`${fmt(-v)} m below the sea surface`, `dengiz sathidan ${fmt(-v)} m pastda`));
    box.append(h('h3', { text: L('From the deep sea to the mountains', 'Dengiz tubidan togʻ choʻqqisigacha') }),
      h('p', { text: L(`Usually between ${where(r.from)} and ${where(r.to)}: the middle half of ${plural(r.records, 'record')} with a height or a depth.`,
        `Odatda ${where(r.from)} va ${where(r.to)} oraligʻida: balandligi yoki chuqurligi yozilgan ${fmt(r.records)} ta yozuvning oʻrta yarmi.`) }));
    const col = h('ol', { class: 'column vertical', attrs: { 'aria-label': L('Records by height and depth', 'Balandlik va chuqurlik boʻyicha yozuvlar') } });
    ZONES.forEach((z, i) => {
      const usual = r.from < z.to && r.to > z.from;
      col.append(h('li', { class: `${usual ? 'usual ' : ''}${z.param === 'depth' ? 'sea' : 'land'}` },
        h('span', { class: 'band', text: L(z.en, z.uz) }),
        h('span', { class: 'bar', attrs: { style: `--w:${(counts[i] / max) * 100}%` } }),
        h('span', { class: 'band-n', text: fmt(counts[i]) })));
    });
    box.append(col, h('p', { class: 'fine', text: L('Only some records give a height or a depth, and a height is often the ground under a bird in flight.', 'Faqat baʼzi yozuvlarda balandlik yoki chuqurlik bor, balandlik esa koʻpincha uchayotgan qush ostidagi yer balandligi.') }));
  }

  /** Body size, lifespan and a sound, from Wikidata. */
  private renderBody(box: HTMLElement, tr: Traits, audio: string | undefined, who: string) {
    const parts: string[] = [];
    if (tr.lengthM) parts.push(L(`up to ${formatLength(tr.lengthM)} long`, `uzunligi ${formatLength(tr.lengthM)} gacha`));
    if (tr.massKg) parts.push(L(`up to ${formatMass(tr.massKg)}`, `vazni ${formatMass(tr.massKg)} gacha`));
    if (tr.lifeYears) parts.push(L(`lives up to ${fmt(Math.round(tr.lifeYears))} years`, `${fmt(Math.round(tr.lifeYears))} yilgacha yashaydi`));
    if (!parts.length && !audio) return;
    box.hidden = false;
    box.append(h('h3', { text: L('Size and voice', 'Oʻlchami va ovozi') }));
    if (parts.length) box.append(h('p', { text: `${capital(parts.join(', '))}.` }));
    if (tr.lengthM && tr.lengthM >= 0.02 && tr.lengthM <= 40) {
      const human = 1.7, max = Math.max(human, tr.lengthM);
      box.append(h('div', { class: 'scale', attrs: { 'aria-hidden': 'true' } },
        h('div', { class: 'scale-row' }, h('span', { class: 'scale-bar animal', attrs: { style: `--w:${(tr.lengthM / max) * 100}%` } }), h('span', { class: 'scale-label', text: who })),
        h('div', { class: 'scale-row' }, h('span', { class: 'scale-bar human', attrs: { style: `--w:${(human / max) * 100}%` } }), h('span', { class: 'scale-label', text: L('a person, 1.7 m', 'odam, 1,7 m') }))));
    }
    if (audio) {
      const el = h('audio', { attrs: { controls: true, preload: 'none' } });
      for (const s of commonsAudio(audio)) el.append(h('source', { attrs: { src: s.src, type: s.type } }));
      const cap = h('p', { class: 'fine', text: L('Recording: Wikimedia Commons', 'Yozuv: Wikimedia Commons') });
      box.append(h('div', { class: 'listen' }, el), cap);
      api.commonsCredits([audio]).then((c) => {
        const cr = c.get(audio);
        if (cr) cap.replaceChildren(L('Recording: ', 'Yozuv: '), h('a', { text: `${cr.artist}, ${cr.licence}`, attrs: { href: cr.page, ...ext } }));
      });
    }
    box.append(h('p', { class: 'fine', text: L('Size and lifespan: the largest values on Wikidata, which may be records rather than typical adults.', 'Oʻlcham va umr: Wikidata dagi eng katta qiymatlar; ular odatiy katta yoshli emas, rekord boʻlishi mumkin.') }));
  }

  /** Then and now, compare and cite. */
  private renderTools(box: HTMLElement, id: number, sci: string, who: string, signal: AbortSignal, t: number) {
    const shiftBtn = h('button', { class: 'btn small quiet', text: L('Then and now', 'Oldin va hozir'), attrs: { 'aria-pressed': 'false' } });
    const cmpBtn = h('button', { class: 'btn small quiet', text: L('Compare with another species', 'Boshqa tur bilan solishtirish') });
    const out = h('div', { class: 'shift-out' });
    box.append(h('div', { class: 'btn-row' }, shiftBtn, cmpBtn), out,
      h('p', { class: 'fine cite', text: L('Cite: ', 'Iqtibos: ') + `GBIF.org (${new Date().toISOString().slice(0, 10)}) ${sci}, GBIF Backbone Taxonomy key ${id}, occurrences via https://www.gbif.org/species/${id}` }));
    cmpBtn.addEventListener('click', () => { this.comparingFrom = id; this.host.focusSearch(L(`Compare ${who} with…`, `${who} ni qaysi tur bilan solishtirish…`)); });
    let on = false;
    shiftBtn.addEventListener('click', async () => {
      on = !on;
      shiftBtn.setAttribute('aria-pressed', String(on));
      if (!on) { this.host.showRanges([{ key: id, mode: 'all' }]); out.replaceChildren(); return; }
      this.host.showRanges([{ key: id, mode: 'then' }, { key: id, mode: 'now' }]);
      out.replaceChildren(
        h('ul', { class: 'legend-dots' }, h('li', {}, h('span', { class: 'dot', attrs: { style: 'background:#b39ddb' } }), L('before 1990', '1990 gacha')),
          h('li', {}, h('span', { class: 'dot', attrs: { style: 'background:#f2c94c' } }), L('since 2010', '2010 dan keyin'))),
        h('p', { class: 'fine', text: L('Loading the counts…', 'Sanoqlar yuklanmoqda…') }));
      const [a, b] = await Promise.all([api.gbifCount({ taxonKey: id, year: '1700,1989' }, signal).catch(() => 0), api.gbifCount({ taxonKey: id, year: '2010,2100' }, signal).catch(() => 0)]);
      if (t !== this.token || !on) return;
      out.lastElementChild!.replaceWith(h('p', { text: L(`${fmt(a)} records before 1990, ${fmt(b)} since 2010.`, `1990 gacha ${fmt(a)} ta, 2010 dan keyin ${fmt(b)} ta yozuv.`) }),
        h('p', { class: 'fine', text: L('Where people looked changed even more than where animals live: phone apps such as iNaturalist and eBird made records since 2010 far more common and far more urban. A place that appears only recently was usually first looked at recently.', 'Odamlar qayerga qaragani hayvonlar yashash joyidan ham koʻproq oʻzgargan: iNaturalist va eBird kabi ilovalar 2010 dan keyingi yozuvlarni ancha koʻpaytirdi va shaharlarga yaqinlashtirdi. Faqat yaqinda paydo boʻlgan joyga odatda yaqinda birinchi marta qaralgan.') }));
    });
  }

  /** Two species side by side. */
  async showCompare(a: number, b: number) {
    this.comparingFrom = null;
    const { t, signal } = this.open();
    this.species = null;
    this.place = null;
    this.host.setHash({ sp: a, vs: b });
    this.host.showSquare(null);
    this.host.showRanges([{ key: a, mode: 'a' }, { key: b, mode: 'b' }]);
    const table = h('div', { class: 'compare' }, h('p', { class: 'fine', text: L('Loading both species…', 'Ikkala tur yuklanmoqda…') }));
    this.body.append(h('button', { class: 'back', text: L('Back to the first species', 'Birinchi turga qaytish'), on: { click: () => this.showSpecies(a) } }),
      h('h2', { class: 'place-title', text: L('Side by side', 'Yonma-yon') }), table);
    const load = async (id: number) => {
      const [sp, total, red, info, zones] = await Promise.all([
        api.gbifSpecies(id, signal).catch(() => null), api.gbifCount({ taxonKey: id }, signal).catch(() => 0), api.gbifRedList(id),
        api.wikidataByAphia([id], undefined, this.lang, signal).then((m) => m.get(id) ?? {}).catch(() => ({} as WikiInfo)),
        api.gbifVertical(id, signal).catch(() => ZONES.map(() => 0)),
      ]);
      return { id, sp, total, red, info, zones };
    };
    const [A, B] = await Promise.all([load(a), load(b)]);
    if (t !== this.token) return;
    if (!A.sp || !B.sp) { table.replaceChildren(h('p', { class: 'fine', text: L('One of the species did not load. Try again in a moment.', 'Turlardan biri yuklanmadi. Birozdan keyin qayta urinib koʻring.') })); return; }
    const sciOf = (x: typeof A) => x.sp!.canonicalName ?? x.sp!.scientificName;
    const nm = (x: typeof A) => x.info.name ?? (lang !== 'uz' && x.sp!.vernacularName ? capital(x.sp!.vernacularName) : sciOf(x));
    const vr = (x: typeof A) => { const r = verticalRange(x.zones); return r ? `${fmt(r.from)} … ${fmt(r.to)} m` : '—'; };
    const photo = (x: typeof A) => {
      const g = groupOfKeys(x.sp!.classKey, x.sp!.phylumKey);
      const f = h('div', { class: `tile-photo g-${g}` }, silhouette(g));
      if (x.info.image) loadPhoto(f, commonsThumbs(x.info.image, 330), '', true);
      return f;
    };
    const row = (k: string, va: string, vb: string) => [h('div', { class: 'ck', text: k }), h('div', { text: va }), h('div', { text: vb })];
    table.replaceChildren(
      h('div', { class: 'ck' }), h('button', { class: 'cmp-head a', on: { click: () => this.showSpecies(a) } }, photo(A), h('strong', { text: nm(A) }), h('span', { class: 'latin', text: sciOf(A) })),
      h('button', { class: 'cmp-head b', on: { click: () => this.showSpecies(b) } }, photo(B), h('strong', { text: nm(B) }), h('span', { class: 'latin', text: sciOf(B) })),
      ...row(L('Kind', 'Turkum'), GROUP_LABEL[groupOfKeys(A.sp.classKey, A.sp.phylumKey)], GROUP_LABEL[groupOfKeys(B.sp.classKey, B.sp.phylumKey)]),
      ...row(L('Red List', 'Qizil kitob'), A.red ? IUCN_LABEL[A.red] ?? '—' : '—', B.red ? IUCN_LABEL[B.red] ?? '—' : '—'),
      ...row(L('Records', 'Yozuvlar'), fmt(A.total), fmt(B.total)),
      ...row(L('Usually at', 'Odatda'), vr(A), vr(B)));
    this.body.append(h('ul', { class: 'legend-dots' }, h('li', {}, h('span', { class: 'dot', attrs: { style: 'background:#f2c94c' } }), nm(A)),
      h('li', {}, h('span', { class: 'dot', attrs: { style: 'background:#8ecbff' } }), nm(B))),
      h('p', { class: 'fine', text: L('Heights are above sea level, depths below it (negative). Where the two colours overlap on the globe, both have been recorded.', 'Balandlik dengiz sathidan yuqori, chuqurlik undan past (manfiy). Globusda ikki rang ustma-ust tushgan joyda ikkalasi ham qayd etilgan.') }));
  }
}

export { THREATENED };
