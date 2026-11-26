#!/usr/bin/env python3
"""Fetch the data behind the static species and country pages (data/pages/species.json, places.json).

Species: the animal species with the most Wikipedia language editions (Wikidata sitelinks, via QLever), matched to the
GBIF backbone by GBIF id (P846), then from GBIF: taxonomy, record count, records by country and year, Red List status;
from Wikipedia: the English summary; from Commons: the photo's author and licence.
Places: every country GBIF knows, with Wikidata names and coordinates, and GBIF animal records by class and phylum.

Every HTTP answer is cached under --cache, so an interrupted run resumes for free. GBIF limits the request rate, so
requests go one at a time and a 429 waits out its Retry-After. A full run (3,000 species) takes 1-2 hours: run it on a
server, not a laptop.

usage: python3 -I scripts/fetch_pages_data.py --out data/pages --cache /tmp/fauna-pages-cache [--n 3000]
"""
import argparse
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

UA = 'fauna-atlas-pages/1.0 (+https://github.com/bristleconelab/fauna-atlas)'
GBIF = 'https://api.gbif.org/v1'
QLEVER = 'https://qlever.dev/api/wikidata'
CLEAN = {'hasCoordinate': 'true', 'hasGeospatialIssue': 'false', 'occurrenceStatus': 'PRESENT'}


class Fetcher:
    def __init__(self, cache):
        self.cache = cache
        os.makedirs(cache, exist_ok=True)
        self.last = {}

    def get(self, url, data=None, headers=None, pace=0.0):
        key = hashlib.sha1((url + '|' + (data or '')).encode()).hexdigest()
        path = os.path.join(self.cache, key + '.json')
        if os.path.exists(path):
            with open(path, encoding='utf-8') as f:
                return json.load(f)
        host = urllib.parse.urlparse(url).netloc
        for attempt in range(8):
            wait = self.last.get(host, 0) + pace - time.time()
            if wait > 0:
                time.sleep(wait)
            self.last[host] = time.time()
            req = urllib.request.Request(url, data=data.encode() if data else None, headers={'User-Agent': UA, **(headers or {})})
            try:
                with urllib.request.urlopen(req, timeout=90) as r:
                    body = json.load(r)
                break
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    body = None
                    break
                if e.code in (429, 500, 502, 503, 504):
                    ra = e.headers.get('Retry-After')
                    time.sleep(float(ra) + 1 if ra and ra.isdigit() else 5 * (attempt + 1))
                    continue
                raise
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                time.sleep(5 * (attempt + 1))
        else:
            raise RuntimeError('gave up on ' + url)
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(body, f)
        os.replace(tmp, path)
        return body

    def gbif(self, path, params=None):
        q = urllib.parse.urlencode(params or {}, doseq=True)
        return self.get(f'{GBIF}/{path}' + (f'?{q}' if q else ''), pace=0.4)

    def sparql(self, query):
        r = self.get(QLEVER, data=urllib.parse.urlencode({'query': query}),
                     headers={'Accept': 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded'}, pace=1)
        return r['results']['bindings']


PREFIXES = '''PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>
'''


def top_species(f, limit):
    q = PREFIXES + f'''SELECT ?item ?gbif ?links ?sci (SAMPLE(?img) AS ?image) (SAMPLE(?en) AS ?labelEn) (SAMPLE(?uz) AS ?labelUz)
  (SAMPLE(?art) AS ?article) WHERE {{
  ?item wdt:P105 wd:Q7432 ; wdt:P846 ?gbif ; wikibase:sitelinks ?links ; wdt:P225 ?sci .
  ?item wdt:P171* wd:Q729 .
  FILTER(?links >= 15)
  OPTIONAL {{ ?item wdt:P18 ?img }}
  OPTIONAL {{ ?item rdfs:label ?en FILTER(LANG(?en) = "en") }}
  OPTIONAL {{ ?item rdfs:label ?uz FILTER(LANG(?uz) = "uz") }}
  OPTIONAL {{ ?art schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }}
}} GROUP BY ?item ?gbif ?links ?sci ORDER BY DESC(?links) LIMIT {limit}'''
    v = lambda b, k: b[k]['value'] if k in b else None
    return [{'wikidata': v(b, 'item').rsplit('/', 1)[1], 'gbif': v(b, 'gbif'), 'links': int(v(b, 'links')), 'sci': v(b, 'sci'),
             'image': v(b, 'image'), 'labelEn': v(b, 'labelEn'), 'labelUz': v(b, 'labelUz'), 'article': v(b, 'article')}
            for b in f.sparql(q)]


def commons_file(url):
    """'http://commons.wikimedia.org/wiki/Special:FilePath/Lion%20waiting.jpg' -> 'Lion waiting.jpg'"""
    return urllib.parse.unquote(url.rsplit('/', 1)[1]) if url else None


def strip_html(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', s or ''))).strip()


def commons_credits(f, files):
    out = {}
    files = sorted(set(x for x in files if x))
    for i in range(0, len(files), 50):
        chunk = files[i:i + 50]
        q = urllib.parse.urlencode({'action': 'query', 'format': 'json', 'formatversion': 2, 'prop': 'imageinfo',
                                    'iiprop': 'extmetadata|url', 'iiurlwidth': 640, 'titles': '|'.join('File:' + x for x in chunk)})
        r = f.get('https://commons.wikimedia.org/w/api.php?' + q, pace=0.5)
        norm = {n['to']: n['from'] for n in r.get('query', {}).get('normalized', [])}
        for p in r.get('query', {}).get('pages', []):
            ii = (p.get('imageinfo') or [None])[0]
            if not ii:
                continue
            meta = ii.get('extmetadata', {})
            name = norm.get(p['title'], p['title'])[len('File:'):]
            out[name] = {'thumb': ii.get('thumburl'), 'page': ii.get('descriptionurl'),
                         'artist': strip_html(meta.get('Artist', {}).get('value'))[:120] or 'Wikimedia Commons',
                         'licence': strip_html(meta.get('LicenseShortName', {}).get('value')) or 'see Commons'}
    return out


def wiki_summary(f, article):
    if not article:
        return None
    title = article.rsplit('/wiki/', 1)[1]
    r = f.get(f'https://en.wikipedia.org/api/rest_v1/page/summary/{title}', pace=0.1)
    if not r or r.get('type') != 'standard':
        return None
    return {'title': r.get('title'), 'extract': r.get('extract'), 'url': r.get('content_urls', {}).get('desktop', {}).get('page', article)}


def species(f, n):
    cands = top_species(f, int(n * 1.4))
    print(f'{len(cands)} Wikidata candidates', flush=True)
    out, seen = [], set()
    for i, c in enumerate(cands):
        if len(out) >= n:
            break
        if not (c['gbif'] or '').isdigit():
            continue
        sp = f.gbif(f'species/{c["gbif"]}')
        if sp and sp.get('taxonomicStatus') not in ('ACCEPTED', 'DOUBTFUL') and sp.get('acceptedKey'):
            sp = f.gbif(f'species/{sp["acceptedKey"]}')
        if not sp or sp.get('kingdom') != 'Animalia' or sp.get('rank') != 'SPECIES' or sp['key'] in seen:
            continue
        occ = f.gbif('occurrence/search', {**CLEAN, 'taxonKey': sp['key'], 'limit': 0, 'facet': ['country', 'year'],
                                           'facetLimit': 400})
        if not occ or not occ.get('count'):
            continue
        seen.add(sp['key'])
        facets = {x['field']: x['counts'] for x in occ.get('facets', [])}
        years = sorted(int(y['name']) for y in facets.get('YEAR', []) if 1700 <= int(y['name']) <= 2100)
        red = f.gbif(f'species/{sp["key"]}/iucnRedListCategory') or {}
        out.append({
            'key': sp['key'], 'wikidata': c['wikidata'], 'links': c['links'],
            'sci': sp.get('canonicalName') or c['sci'], 'labelEn': c['labelEn'], 'labelUz': c['labelUz'],
            'vernacular': sp.get('vernacularName'), 'article': c['article'], 'image': commons_file(c['image']),
            'phylumKey': sp.get('phylumKey'), 'classKey': sp.get('classKey'),
            'class': sp.get('class'), 'order': sp.get('order'), 'family': sp.get('family'),
            'records': occ['count'], 'years': [years[0], years[-1]] if years else None,
            'countries': [[x['name'], x['count']] for x in facets.get('COUNTRY', [])],
            'redlist': red.get('code') if red.get('code') not in (None, 'NE') else None,
        })
        if len(out) % 100 == 0:
            print(f'{len(out)} species ({i + 1} candidates read)', flush=True)
    print('Wikipedia summaries', flush=True)
    for s in out:
        s['wiki'] = wiki_summary(f, s['article'])
    print('Commons credits', flush=True)
    credits = commons_credits(f, [s['image'] for s in out])
    for s in out:
        s['photo'] = credits.get(s['image']) if s['image'] else None
    return out


def places(f):
    gbif_countries = f.gbif('enumeration/country')
    q = PREFIXES + '''PREFIX p: <http://www.wikidata.org/prop/>
SELECT ?iso (SAMPLE(?c) AS ?item) (SAMPLE(?coord) AS ?coords) (SAMPLE(?en) AS ?labelEn) (SAMPLE(?uz) AS ?labelUz) WHERE {
  ?c wdt:P297 ?iso .
  OPTIONAL { ?c wdt:P625 ?coord }
  OPTIONAL { ?c rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?c rdfs:label ?uz FILTER(LANG(?uz) = "uz") }
} GROUP BY ?iso'''
    wd = {b['iso']['value']: b for b in f.sparql(q)}
    out = []
    for c in gbif_countries:
        iso = c['iso2']
        occ = f.gbif('occurrence/search', {**CLEAN, 'kingdomKey': 1, 'country': iso, 'limit': 0,
                                           'facet': ['classKey', 'phylumKey', 'year'], 'facetLimit': 400})
        if not occ or not occ.get('count'):
            continue
        facets = {x['field']: x['counts'] for x in occ.get('facets', [])}
        years = sorted(int(y['name']) for y in facets.get('YEAR', []) if 1700 <= int(y['name']) <= 2100)
        w = wd.get(iso, {})
        m = re.match(r'Point\(([-\d.]+) ([-\d.]+)\)', w.get('coords', {}).get('value', ''))
        out.append({'iso': iso, 'gbifTitle': c.get('title'), 'labelEn': w.get('labelEn', {}).get('value'),
                    'labelUz': w.get('labelUz', {}).get('value'),
                    'wikidata': w['item']['value'].rsplit('/', 1)[1] if 'item' in w else None,
                    'lon': float(m.group(1)) if m else None, 'lat': float(m.group(2)) if m else None,
                    'records': occ['count'], 'years': [years[0], years[-1]] if years else None,
                    'classes': {x['name']: x['count'] for x in facets.get('CLASS_KEY', [])},
                    'phyla': {x['name']: x['count'] for x in facets.get('PHYLUM_KEY', [])}})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--cache', required=True)
    ap.add_argument('--n', type=int, default=3000)
    a = ap.parse_args()
    f = Fetcher(a.cache)
    os.makedirs(a.out, exist_ok=True)
    pl = places(f)
    print(f'{len(pl)} places', flush=True)
    sp = species(f, a.n)
    stamp = time.strftime('%Y-%m-%d', time.gmtime())
    for name, rows in (('places', pl), ('species', sp)):
        with open(os.path.join(a.out, name + '.json'), 'w', encoding='utf-8') as fh:
            json.dump({'fetched': stamp, 'rows': rows}, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'done: {len(sp)} species, {len(pl)} places -> {a.out}', flush=True)


if __name__ == '__main__':
    sys.exit(main())
