"""Borders and names for the globe from Natural Earth (public domain), small enough to ship with the site.

OpenFreeMap's planet tiles carry every layer (buildings, roads, land use): the globe used them only for borders and
names and still downloaded 12.5 MB in 34 tiles for one species page (measured 2026-11-28). These two files replace them
below zoom 6:

  public/data/basemap/borders.json  land borders between countries (ne_50m_admin_0_boundary_lines_land)
  public/data/basemap/labels.json   country, city, ocean, sea and lake names as points, with name:<lang> for every
                                    interface language (src/locales/*.ts) from Wikidata labels

usage: python3 -I scripts/build_basemap.py [--src DIR]   (downloads the Natural Earth GeoJSON into DIR if missing)
"""
import argparse
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'data', 'basemap')
NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/{}.geojson'
FILES = ['ne_50m_admin_0_boundary_lines_land', 'ne_50m_admin_0_countries', 'ne_10m_populated_places_simple',
         'ne_50m_geography_marine_polys', 'ne_50m_lakes']
UA = 'fauna-atlas-basemap/1.0 (+https://github.com/bristleconelab/fauna-atlas)'


def langs():
    """Interface languages other than English: one catalog file each."""
    d = os.path.join(ROOT, 'src', 'locales')
    return sorted(f[:-3] for f in os.listdir(d) if re.fullmatch(r'[a-z]{2,3}(-[A-Za-z]+)?\.ts', f))


def load(src, name):
    path = os.path.join(src, f'{name}.geojson')
    if not os.path.exists(path):
        req = urllib.request.Request(NE.format(name), headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=120) as r, open(path + '.tmp', 'wb') as fh:
            fh.write(r.read())
        os.replace(path + '.tmp', path)
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def r2(x):
    return round(x, 2)  # about 1 km: finer than the globe shows below zoom 6


def thin_line(coords, tol=0.02):
    """Drop points closer than tol degrees to the last kept one; keeps the ends."""
    out = [coords[0]]
    for p in coords[1:-1]:
        if abs(p[0] - out[-1][0]) + abs(p[1] - out[-1][1]) >= tol:
            out.append(p)
    out.append(coords[-1])
    return [[r2(x), r2(y)] for x, y in out]


def label_point(geom):
    """A point inside the largest ring (area-weighted centroid of its triangles), for polygons without a label point."""
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    best, area = None, -1.0
    for poly in polys:
        ring = poly[0]
        a = sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1] for i in range(len(ring) - 1)) / 2
        if abs(a) > area:
            area, best = abs(a), (ring, a)
    ring, a = best
    if a == 0:
        return ring[0]
    cx = sum((ring[i][0] + ring[i + 1][0]) * (ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]) for i in range(len(ring) - 1)) / (6 * a)
    cy = sum((ring[i][1] + ring[i + 1][1]) * (ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]) for i in range(len(ring) - 1)) / (6 * a)
    return [cx, cy]


def wikidata_labels(qids, codes):
    """Labels in the given languages for Wikidata items, through QLever (batches of 300)."""
    out = {}
    qids = sorted({q for q in qids if re.fullmatch(r'Q\d+', q or '')})
    for i in range(0, len(qids), 300):
        part = qids[i:i + 300]
        query = ('PREFIX wd: <http://www.wikidata.org/entity/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> '
                 'SELECT ?item ?lang ?label WHERE { VALUES ?item { ' + ' '.join(f'wd:{q}' for q in part) + ' } '
                 '?item rdfs:label ?label . BIND(LANG(?label) AS ?lang) FILTER(?lang IN (' + ','.join(f'"{c}"' for c in codes) + ')) }')
        url = 'https://qlever.dev/api/wikidata?' + urllib.parse.urlencode({'query': query})
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/sparql-results+json'})
        with urllib.request.urlopen(req, timeout=120) as r:
            for b in json.load(r)['results']['bindings']:
                out.setdefault(b['item']['value'].rsplit('/', 1)[1], {})[b['lang']['value']] = b['label']['value']
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=os.path.join(ROOT, '.cache', 'naturalearth'))
    a = ap.parse_args()
    os.makedirs(a.src, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    codes = langs()

    b = load(a.src, 'ne_50m_admin_0_boundary_lines_land')
    lines = []
    for f in b['features']:
        g = f['geometry']
        parts = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
        for p in parts:
            if len(p) >= 2:
                lines.append(thin_line(p))
    borders = {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {}, 'geometry': {'type': 'MultiLineString', 'coordinates': lines}}]}

    labels = []  # (kind, rank, lon, lat, english name, wikidata id)
    for f in load(a.src, 'ne_50m_admin_0_countries')['features']:
        p = f['properties']
        if p.get('LABEL_X') is not None:
            labels.append(('country', p.get('LABELRANK') or 5, p['LABEL_X'], p['LABEL_Y'], p.get('NAME_EN') or p['NAME'], p.get('WIKIDATAID')))
    for f in load(a.src, 'ne_10m_populated_places_simple')['features']:
        p = f['properties']
        # capitals and the largest cities only: the globe names a city from zoom 4.5 (as the OpenFreeMap layer did)
        if (p.get('scalerank') or 10) <= 2 or (p.get('adm0cap') and (p.get('scalerank') or 10) <= 4):
            x, y = f['geometry']['coordinates']
            labels.append(('city', p.get('scalerank') or 5, x, y, p.get('name_en') or p['name'], p.get('wikidataid')))
    for f in load(a.src, 'ne_50m_geography_marine_polys')['features']:
        p = f['properties']
        kind = {'ocean': 'ocean', 'sea': 'sea', 'bay': 'bay', 'gulf': 'bay', 'strait': 'strait', 'channel': 'strait', 'sound': 'bay'}.get((p.get('featurecla') or '').lower())
        if kind and p.get('name'):
            x, y = label_point(f['geometry'])
            labels.append((kind, p.get('scalerank') or 5, x, y, p.get('name_en') or p['name'], p.get('wikidataid')))
    for f in load(a.src, 'ne_50m_lakes')['features']:
        p = f['properties']
        if p.get('name') and (p.get('scalerank') or 10) <= 2:
            x, y = label_point(f['geometry'])
            labels.append(('lake', p.get('scalerank') or 5, x, y, p.get('name_en') or p['name'], p.get('wikidataid')))

    names = wikidata_labels([w for *_, w in labels], codes) if codes else {}
    feats = []
    for kind, rank, x, y, en, wd in labels:
        props = {'class': kind, 'rank': rank, 'name:en': en}
        for c in codes:
            if names.get(wd, {}).get(c):
                props[f'name:{c}'] = names[wd][c]
        feats.append({'type': 'Feature', 'properties': props, 'geometry': {'type': 'Point', 'coordinates': [r2(x), r2(y)]}})
    with open(os.path.join(OUT, 'borders.json'), 'w', encoding='utf-8') as fh:
        json.dump(borders, fh, separators=(',', ':'))
    with open(os.path.join(OUT, 'labels.json'), 'w', encoding='utf-8') as fh:
        json.dump({'type': 'FeatureCollection', 'features': feats}, fh, ensure_ascii=False, separators=(',', ':'))
    by = {}
    for kind, *_ in labels:
        by[kind] = by.get(kind, 0) + 1
    named = {c: sum(1 for f in feats if f'name:{c}' in f['properties']) for c in codes}
    print(f'borders: {len(lines)} lines; labels: {by}; translated: {named}')
    for n in ('borders.json', 'labels.json'):
        print(n, os.path.getsize(os.path.join(OUT, n)), 'bytes')


if __name__ == '__main__':
    sys.exit(main())
