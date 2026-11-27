#!/usr/bin/env python3
"""Own photos for the MiCO sea animals that have no animal page (and so no photo in public/data/photos/<key>.webp):
public/data/mico/photos/<name>.webp at 160 px, and public/data/mico/photos.json {scientific name: [file, credit,
licence, page]}. The migrations list then shows a photo for every animal without asking Wikidata or Wikimedia at
view time. Needs Pillow: uv run --with pillow python -I scripts/fetch_mico_photos.py --known dist/data/known.json
"""
import argparse
import io
import json
import os
import re
import sys
import urllib.parse

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_pages_data import Fetcher, PREFIXES, commons_credits, commons_file  # noqa: E402
from fetch_photos import fetch  # noqa: E402

WIDTH = 160


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--known', required=True)
    ap.add_argument('--mico', default='public/data/mico/index.json')
    ap.add_argument('--out', default='public/data/mico')
    ap.add_argument('--cache', default='/tmp/fauna-mico-cache')
    a = ap.parse_args()
    known = {v[2].lower() for v in json.load(open(a.known)).values() if v[3]}
    names = sorted({s['scientific'] for s in json.load(open(a.mico))['species'].values()} - set())
    need = [n for n in names if n.lower() not in known]
    f = Fetcher(a.cache)
    q = PREFIXES + 'SELECT ?name (GROUP_CONCAT(DISTINCT STR(?img); separator="|") AS ?images) WHERE { VALUES ?name { ' + \
        ' '.join(json.dumps(n) for n in need) + ' } ?item0 wdt:P225 ?name . OPTIONAL { ?item0 wdt:P12765 ?acc } ' + \
        'BIND(COALESCE(?acc, ?item0) AS ?item) ?item wdt:P18 ?img } GROUP BY ?name'
    images = {}
    for b in f.sparql(q):
        files = [commons_file(x) for x in b['images']['value'].split('|')]
        photo = next((x for x in files if x and re.search(r'\.(jpe?g|png|webp)$', x, re.I)), None)
        if photo:
            images[b['name']['value']] = photo
    credits = commons_credits(f, list(images.values()))
    os.makedirs(os.path.join(a.out, 'photos'), exist_ok=True)
    index = {}
    for name, file in images.items():
        c = credits.get(file)
        if not c or not c.get('thumb'):
            continue
        body = fetch(c['thumb'])
        if not body:
            continue
        im = Image.open(io.BytesIO(body)).convert('RGB')
        if im.width > WIDTH:
            im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
        slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
        im.save(os.path.join(a.out, 'photos', f'{slug}.webp'), 'WEBP', quality=72, method=6)
        index[name.lower()] = [f'{slug}.webp', c['artist'], c['licence'], c['page']]
    json.dump(index, open(os.path.join(a.out, 'photos.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print(f'{len(need)} MiCO animals without a page; {len(index)} photos written -> {a.out}/photos', flush=True)


if __name__ == '__main__':
    sys.exit(main())
