// The globe: NASA Blue Marble imagery with borders and place names on top, plus overlays: GBIF record density for all
// animals, the clicked square, species ranges as GBIF square-grid tiles, and the MiCO migration network of sea animals.
import * as maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, GeoJSONSource, LayerSpecification, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { bboxRing, frameOf, type BBox } from './geo';
import { gbifAdhocTiles, gbifTiles } from './api';
import { capped, fadePolarOverlays, registerPoleCaps } from './polecap';
import { h, fmt, plural } from './dom';
import { L } from './i18n';

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
/** OpenStreetMap vector tiles (OpenMapTiles schema) for borders and names only; the imagery stays NASA's. */
const OMT = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
/** Sentinel-2 cloudless 2016 by EOX (CC BY 4.0; later years are non-commercial), for close-up views where the
 *  Blue Marble (zoom 8, ~600 m a pixel) turns to mush. */
const S2 = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
/** "Last surveyed" classes: newest records within 10, 10-20, 20-50 years, or older/undated only. */
export const AGE_COLORS = ['#5fc0b0', '#f2c94c', '#e07a5f', '#8e4fa0'];
/** Range squares by period (then and now) or by species (side by side). */
export const RANGE_COLORS = { then: '#b39ddb', now: '#f2c94c', both: '#f4f8f7', a: '#f2c94c', b: '#8ecbff' };
/** GBIF map styles matching those colours (checked 2026-11-26: yellow-red squares, purple squares). Species b uses the
 *  yellow-red squares turned blue with raster-hue-rotate: GBIF has no blue square style (blue.marker draws dots). */
const RANGE_STYLE = { all: 'classic-noborder.poly', then: 'purpleWhite.poly', now: 'classic-noborder.poly', a: 'classic-noborder.poly', b: 'classic-noborder.poly' };
/** Map zoom from which range and survey cells are drawn at full size (see showRanges). */
const RANGE_NEAR = 4;
function COLORS_LOOKED() { return ['#2a1d5c', '#2f6f99', '#5fc0b0', '#c8ef9c', '#fff7c2']; }

export const COLORS = { abyss: '#14261c', plankton: '#f2c94c', foam: '#f4f8f7', looked: COLORS_LOOKED() };
/** One colour per tagged animal, cycled; all readable on dark water. The range squares are dimmed while tracks show. */
export const TRACK_COLORS = ['#7fe3c8', '#ff9e7a', '#8ecbff', '#ffd166', '#c39bff', '#ff7aa2', '#b8f27c', '#ffffff'];
/** MiCO site colours by what the animals do there. */
export const ACTIVITY_COLORS = { breeding: '#ff7aa2', feeding: '#7fe3c8', migrating: '#8ecbff', season: '#c39bff', observed: '#f4f8f7' };
export type ActivityKind = keyof typeof ACTIVITY_COLORS;
/** Records per 10,000 km²: geohash squares shrink towards the poles, so raw counts would make polar seas look empty. */
export const DENSITY_AREA_KM2 = 10000;

const name = (lang: string): ExpressionSpecification => ['coalesce', ['get', `name:${lang}`], ['get', 'name:en'], ['get', 'name']];

function labelLayers(lang: string): LayerSpecification[] {
  const halo = { 'text-halo-color': 'rgba(11,34,51,0.85)', 'text-halo-width': 1.2, 'text-halo-blur': 0.4 };
  return [
    {
      id: 'borders', type: 'line', source: 'omt', 'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1], ['!=', ['get', 'disputed'], 1]],
      paint: { 'line-color': '#f4f8f7', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.22, 5, 0.4], 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.4, 6, 1] },
    },
    {
      id: 'water-names', type: 'symbol', source: 'omt', 'source-layer': 'water_name',
      filter: ['in', ['get', 'class'], ['literal', ['ocean', 'sea', 'bay', 'lake', 'strait']]],
      layout: {
        'text-field': name(lang), 'text-font': ['Noto Sans Italic'], 'text-letter-spacing': 0.08, 'text-max-width': 8,
        'text-size': ['match', ['get', 'class'], 'ocean', 14, 'sea', 12, 11],
      },
      paint: { 'text-color': '#bfe3ee', ...halo },
    },
    {
      id: 'place-names', type: 'symbol', source: 'omt', 'source-layer': 'place',
      // no continent points: OSM has "Eurasia" and "Afro-Eurasia" ones that only add noise to a globe
      filter: ['any',
        ['all', ['==', ['get', 'class'], 'country'], ['>=', ['zoom'], 2.2]],
        ['all', ['in', ['get', 'class'], ['literal', ['island', 'archipelago']]], ['>=', ['zoom'], 4]],
        ['all', ['==', ['get', 'class'], 'city'], ['<=', ['coalesce', ['get', 'rank'], 99], 4], ['>=', ['zoom'], 4.5]]],
      layout: {
        'text-field': name(lang), 'text-font': ['Noto Sans Regular'], 'text-max-width': 7,
        'text-size': ['match', ['get', 'class'], 'country', 11.5, 11],
      },
      paint: { 'text-color': '#f4f8f7', 'text-opacity': 0.82, ...halo },
    },
  ];
}

function style(lang: string): StyleSpecification {
  return {
    version: 8,
    projection: { type: 'globe' },
    glyphs: GLYPHS,
    sky: {
      'sky-color': 'rgba(0, 0, 0, 0)', // space is the page's night sky (#map background), not a flat colour
      'horizon-color': '#2b6274',
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 5, 0.6, 7, 0],
    },
    sources: {
      earth: {
        type: 'raster', tiles: [capped(GIBS)], tileSize: 256, maxzoom: 8,
        attribution: 'Imagery: NASA Blue Marble via <a href="https://earthdata.nasa.gov/gibs">GIBS</a>',
      },
      s2: {
        type: 'raster', tiles: [S2], tileSize: 256, minzoom: 6, maxzoom: 14,
        attribution: '<a href="https://s2maps.eu">Sentinel-2 cloudless 2016</a> by EOX, CC BY 4.0 (contains modified Copernicus Sentinel data 2016)',
      },
      omt: { type: 'vector', url: OMT, attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
      square: { type: 'geojson', data: EMPTY },
      overlap: { type: 'geojson', data: EMPTY },
      micoRoutes: { type: 'geojson', data: EMPTY },
      micoSites: { type: 'geojson', data: EMPTY },
      tracks: { type: 'geojson', data: EMPTY },
      heads: { type: 'geojson', data: EMPTY },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': COLORS.abyss } },
      { id: 'earth', type: 'raster', source: 'earth', paint: { 'raster-saturation': -0.15, 'raster-contrast': 0.05 } },
      { id: 's2', type: 'raster', source: 's2', minzoom: 6, paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 7.5, 1], 'raster-saturation': -0.1 } },
      ...labelLayers(lang),
      {
        id: 'mico-routes', type: 'line', source: 'micoRoutes', layout: { 'line-cap': 'round' }, filter: ['==', ['get', 'tracked'], 1],
        // dashed too: a MiCO link joins two places, it is not the way the animals went
        paint: { 'line-color': '#ffb3c7', 'line-width': 1.2, 'line-opacity': 0.55, 'line-dasharray': [2, 3] },
      },
      {
        id: 'mico-links', type: 'line', source: 'micoRoutes', filter: ['==', ['get', 'tracked'], 0],
        paint: { 'line-color': '#ffb3c7', 'line-width': 1.3, 'line-opacity': 0.6, 'line-dasharray': [2, 2] },
      },
      {
        id: 'mico-sites', type: 'circle', source: 'micoSites',
        paint: {
          'circle-color': ['match', ['get', 'kind'], 'breeding', ACTIVITY_COLORS.breeding, 'feeding', ACTIVITY_COLORS.feeding,
            'migrating', ACTIVITY_COLORS.migrating, 'season', ACTIVITY_COLORS.season, ACTIVITY_COLORS.observed],
          // small when the whole globe shows (places a few hundred km apart must not merge), larger closer in
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            1.5, ['interpolate', ['linear'], ['sqrt', ['max', 1, ['get', 'n']]], 1, 2, 30, 5],
            5, ['interpolate', ['linear'], ['sqrt', ['max', 1, ['get', 'n']]], 1, 4, 30, 11]],
          'circle-stroke-color': COLORS.abyss, 'circle-stroke-width': 1.2, 'circle-opacity': 0.92,
        },
      },
      {
        id: 'tracks', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['to-color', ['at', ['%', ['get', 'c'], TRACK_COLORS.length], ['literal', TRACK_COLORS]]], 'line-width': 1.8, 'line-opacity': 0.9 },
      },
      {
        id: 'heads', type: 'circle', source: 'heads',
        paint: {
          'circle-color': ['to-color', ['at', ['%', ['get', 'c'], TRACK_COLORS.length], ['literal', TRACK_COLORS]]],
          'circle-radius': 4.5, 'circle-stroke-color': COLORS.abyss, 'circle-stroke-width': 1.5,
        },
      },
      // where two compared species are both recorded
      { id: 'overlap-fill', type: 'fill', source: 'overlap', paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.55 } },
      { id: 'square', type: 'line', source: 'square', paint: { 'line-color': COLORS.foam, 'line-width': 2.5 } },
    ],
  };
}

maplibregl.setWorkerUrl(workerUrl);
registerPoleCaps();

/** Layers a click asks about before it falls through to "life here". */
const PICKABLE = ['heads', 'tracks', 'mico-sites', 'mico-routes', 'mico-links'];

function popupContent(layer: string, p: Record<string, unknown>): HTMLElement | null {
  const s = (k: string) => (p[k] == null ? '' : String(p[k]));
  if (layer === 'heads' || layer === 'tracks') {
    return h('div', { class: 'pop' }, h('strong', { text: s('name') }), h('span', { text: `${s('species')}, ${fmt(Number(p.km) || 0)} km, ${s('years')}` }));
  }
  if (layer === 'mico-sites') {
    const n = Number(p.n) || 0;
    return h('div', { class: 'pop' }, h('strong', { text: s('act').replace(/;/g, ', ') || L('Seen here', 'Shu yerda koʻrilgan') }),
      h('span', { text: `${s('species')}${n ? L(`, ${plural(n, 'animal')} in the studies behind this place`, `, bu joy ortidagi tadqiqotlarda ${fmt(n)} ta hayvon`) : ''}` }));
  }
  if (layer === 'mico-routes' || layer === 'mico-links') {
    return h('div', { class: 'pop' }, h('strong', { text: Number(p.tracked) ? L('Places linked by tagged animals', 'Belgilangan hayvonlar bogʻlagan joylar') : L('Places linked by other studies', 'Boshqa tadqiqotlar bogʻlagan joylar') }),
      h('span', { text: `${s('species')}${Number(p.both) ? L(', both ways', ', ikki tomonga') : ''}. ${L('The line joins the two places, not the path taken.', 'Chiziq yoʻlni emas, ikki joyni bogʻlaydi.')}` }));
  }
  return null;
}

export class Globe {
  map: maplibregl.Map;
  private ready: Promise<void>;
  private popup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px', className: 'atlas-pop' });
  private hoverPop = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '240px', className: 'atlas-pop hover' });

  constructor(container: HTMLElement, lang = 'en') {
    this.map = new maplibregl.Map({
      container, style: style(lang), center: [60, 8], zoom: 2.1, minZoom: 0.8, maxZoom: 12,
      // credits: our own closed-by-default sources card beside the bristlecone credit (index.html .credits)
      attributionControl: false, renderWorldCopies: false,
      transformRequest: (url, kind) => fadePolarOverlays(url, kind),
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    this.ready = new Promise((res) => this.map.once('load', () => res()));
    this.map.on('mousemove', (e) => this.hover(e));
    this.map.on('mouseout', () => this.hoverPop.remove());
  }

  /** A click on a journey (a track, a tagged animal, a MiCO place or link) opens a note about it; anywhere else
   *  calls fn, which opens "life here". */
  onClick(fn: (lon: number, lat: number) => void) {
    this.map.on('click', (e: MapMouseEvent) => {
      const f = this.pick(e);
      if (f) {
        const el = popupContent(f.layer.id, f.properties ?? {});
        if (el) { this.popup.setLngLat(e.lngLat).setDOMContent(el).addTo(this.map); return; }
      }
      fn(e.lngLat.lng, e.lngLat.lat);
    });
  }

  private pick(e: MapMouseEvent) {
    const layers = PICKABLE.filter((id) => this.map.getLayer(id));
    const r = 6;
    const hits = this.map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers });
    return hits[0] ?? null;
  }

  private hover(e: MapMouseEvent) {
    const f = this.pick(e);
    this.map.getCanvas().style.cursor = f ? 'pointer' : '';
    this.hoverPop.remove();
  }

  async showSquare(b: BBox | null) {
    await this.ready;
    const data: GeoJSON.FeatureCollection = b
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: bboxRing(b) } }] }
      : EMPTY;
    (this.map.getSource('square') as GeoJSONSource).setData(data);
  }

  /** Species ranges as GBIF square-grid tiles: one entry each (all years, before 2000, since 2000, or species a/b).
   *  GBIF cells are a fixed size within a tile, and zoomed out the globe shows lower-zoom tiles (lower still towards
   *  the poles), so the same cells would cover more and more ground. Below RANGE_NEAR the cells are half the size;
   *  the square grids nest, so the switch cuts no cell. */
  async showRanges(list: { key: number; mode: 'all' | 'then' | 'now' | 'a' | 'b' }[]) {
    await this.ready;
    for (const id of this.rangeLayers.splice(0)) { this.map.removeLayer(id); this.map.removeSource(id); }
    const YEAR = new Date().getUTCFullYear();
    list.forEach((r, i) => {
      const filter: Record<string, string | number> = { taxonKey: r.key };
      if (r.mode === 'then') filter.year = '1758,1999';
      if (r.mode === 'now') filter.year = `2000,${YEAR}`;
      const opacity = r.mode === 'then' || r.mode === 'b' ? 0.75 : 0.8;
      for (const [part, squareSize, zooms] of [['far', 32, { maxzoom: RANGE_NEAR }], ['near', 64, { minzoom: RANGE_NEAR }]] as const) {
        const id = `rng-${i}-${part}`;
        this.map.addSource(id, { type: 'raster', tiles: [gbifTiles(filter, RANGE_STYLE[r.mode], squareSize)], tileSize: 256, maxzoom: 10, attribution: 'Records: <a href="https://www.gbif.org">GBIF.org</a>' });
        this.map.addLayer({ id, type: 'raster', source: id, ...zooms, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 150, ...(r.mode === 'b' ? { 'raster-hue-rotate': 180 } : {}) } }, 'borders');
        this.rangeLayers.push(id);
        this.rangeOpacity.set(id, opacity);
      }
    });
  }
  private rangeLayers: string[] = [];
  private rangeOpacity = new Map<string, number>();
  /** While tag tracks show, the range squares step back so the paths read; null restores them. */
  async dimRange(dim: boolean) {
    await this.ready;
    for (const id of this.rangeLayers) if (this.map.getLayer(id)) this.map.setPaintProperty(id, 'raster-opacity', dim ? 0.25 : this.rangeOpacity.get(id) ?? 0.8);
  }

  /** The year on the globe: a GBIF adhoc layer per month for a species (records of that month in any year; the density
   *  tiles ignore a month filter). The month shown and the next one are loaded, the next invisibly, so playing on is
   *  smooth without asking GBIF for all twelve at once. null removes them and brings the all-year range back. */
  async showMonth(key: number | null, month: number | null) {
    await this.ready;
    const drop = () => { for (const id of this.monthLayers.splice(0)) { this.map.removeLayer(id); this.map.removeSource(id); } };
    if (key == null || month == null) {
      drop();
      this.monthKey = null;
      for (const id of this.rangeLayers) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', 'visible');
      return;
    }
    if (this.monthKey !== key) { drop(); this.monthKey = key; }
    const ensure = (m: number) => {
      const id = `mon-${m}`;
      if (this.map.getLayer(id)) return;
      this.map.addSource(id, { type: 'raster', tiles: [gbifAdhocTiles({ taxonKey: key, month: m })], tileSize: 256, maxzoom: 4 });
      this.map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0, 'raster-fade-duration': 0, 'raster-opacity-transition': { duration: 250 } } }, 'borders');
      this.monthLayers.push(id);
    };
    ensure(month);
    ensure((month % 12) + 1);
    for (const id of this.rangeLayers) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', 'none');
    for (const id of this.monthLayers) this.map.setPaintProperty(id, 'raster-opacity', id === `mon-${month}` ? 0.95 : 0);
  }
  private monthLayers: string[] = [];
  private monthKey: number | null = null;

  /** Cells where both compared species are recorded; null clears them. */
  async showOverlap(fc: GeoJSON.FeatureCollection | null) {
    await this.ready;
    (this.map.getSource('overlap') as GeoJSONSource).setData(fc ?? EMPTY);
  }

  /** Set one of the journey overlays (micoRoutes, micoSites, tracks, heads); null clears it. */
  async setOverlay(source: 'micoRoutes' | 'micoSites' | 'tracks' | 'heads', fc: GeoJSON.FeatureCollection | null) {
    await this.ready;
    (this.map.getSource(source) as GeoJSONSource).setData(fc ?? EMPTY);
    if (!fc) this.popup.remove();
  }

  /** Frame a set of points. Wide sets (an ocean basin or more) get a centred globe view: fitBounds on a globe would
   *  zoom into the middle of the box instead. Loops, not Math.min(...xs): tracks can hold 40,000 points. */
  async fitTo(points: [number, number][]) {
    await this.ready;
    const b = frameOf(points);
    if (!b) return;
    if (b.wide) { this.flyTo(b.lon, b.lat, 1.7); return; }
    this.map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 60, maxZoom: 5, duration: 1400 });
  }

  /** Where people have looked: GBIF record density of all animals. "age" greys the all-time layer and lays the last
   *  ten years on top in green, so grey ground is ground nobody has recorded an animal on for ten years. */
  async setLooked(on: boolean, mode: 'records' | 'age' = 'records') {
    await this.ready;
    const YEAR = new Date().getUTCFullYear();
    // like the ranges (showRanges): half-size cells below RANGE_NEAR, so zoomed out the cells do not grow into blocks
    const parts = [['far', 32, { maxzoom: RANGE_NEAR }], ['near', 64, { minzoom: RANGE_NEAR }]] as const;
    if (!this.map.getSource('looked-all-near')) {
      for (const [part, squareSize, zooms] of parts) {
        this.map.addSource(`looked-all-${part}`, { type: 'raster', tiles: [gbifTiles({ taxonKey: 1 }, 'purpleYellow-noborder.poly', squareSize)], tileSize: 256, maxzoom: 10, attribution: 'Records: <a href="https://www.gbif.org">GBIF.org</a>' });
        this.map.addSource(`looked-recent-${part}`, { type: 'raster', tiles: [gbifTiles({ taxonKey: 1, year: `${YEAR - 10},${YEAR}` }, 'green-noborder.poly', squareSize)], tileSize: 256, maxzoom: 10 });
        this.map.addLayer({ id: `looked-all-${part}`, type: 'raster', source: `looked-all-${part}`, ...zooms, layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.8 } }, 'borders');
        this.map.addLayer({ id: `looked-recent-${part}`, type: 'raster', source: `looked-recent-${part}`, ...zooms, layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.9 } }, 'borders');
      }
    }
    for (const [part] of parts) {
      this.map.setLayoutProperty(`looked-all-${part}`, 'visibility', on ? 'visible' : 'none');
      this.map.setLayoutProperty(`looked-recent-${part}`, 'visibility', on && mode === 'age' ? 'visible' : 'none');
      this.map.setPaintProperty(`looked-all-${part}`, 'raster-saturation', mode === 'age' ? -1 : 0);
      this.map.setPaintProperty(`looked-all-${part}`, 'raster-opacity', mode === 'age' ? 0.35 : 0.8);
    }
  }

  async flyTo(lon: number, lat: number, zoom?: number) {
    await this.ready;
    this.map.flyTo({ center: [lon, lat], zoom: zoom ?? Math.max(this.map.getZoom(), 3), duration: 1400, essential: false });
  }

  async fitBox(b: [number, number, number, number]) {
    await this.ready;
    const [w, s, e, n] = b;
    if (e - w > 100 || n - s > 70) { this.flyTo((w + e) / 2, (s + n) / 2, 1.8); return; }
    this.map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 6, duration: 1400 });
  }

  /** Keep the clicked square visible beside the panel (panel on the right on wide screens, at the bottom on phones). */
  setPadding(p: { right?: number; bottom?: number }) {
    this.map.setPadding({ top: 0, left: 0, right: p.right ?? 0, bottom: p.bottom ?? 0 });
  }
}
