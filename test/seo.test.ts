// Search engines and link previews: the files they read exist and agree with each other, and the README shows only
// screenshots that exist.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const SITE = 'https://fauna.bristleconelab.org/';
const html = readFileSync('index.html', 'utf8');
const meta = (attr: string, name: string) => new RegExp(`<meta ${attr}="${name}" content="([^"]+)"`).exec(html)?.[1];

describe('search engines and link previews', () => {
  it('has a canonical URL, a description and a preview image that is in public/', () => {
    expect(html).toContain(`<link rel="canonical" href="${SITE}">`);
    expect(meta('name', 'description')!.length).toBeGreaterThan(80);
    const img = meta('property', 'og:image')!;
    expect(img.startsWith(SITE)).toBe(true);
    expect(existsSync(`public/${img.slice(SITE.length)}`)).toBe(true);
    expect(meta('name', 'twitter:image')).toBe(img);
  });

  it('carries valid JSON-LD for the app', () => {
    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1];
    const graph = JSON.parse(block)['@graph'] as Record<string, unknown>[];
    const app = graph.find((n) => n['@type'] === 'WebApplication')!;
    expect(app.url).toBe(SITE);
    expect(app.image).toBe(meta('property', 'og:image'));
    expect(app.codeRepository).toBe('https://github.com/bristleconelab/fauna-atlas');
  });

  it('serves robots.txt pointing at a sitemap of the home page, and a real 404', () => {
    expect(readFileSync('public/robots.txt', 'utf8')).toContain(`Sitemap: ${SITE}sitemap.xml`);
    expect(readFileSync('public/sitemap.xml', 'utf8')).toMatch(new RegExp(`<loc>${SITE}</loc>\\s*<lastmod>\\d{4}-\\d{2}-\\d{2}</lastmod>`));
    expect(readFileSync('public/404.html', 'utf8')).toContain('noindex');
  });

  it('has the IndexNow key file the script sends', () => {
    const key = /^KEY=([0-9a-f]{32})$/m.exec(readFileSync('scripts/indexnow.sh', 'utf8'))![1];
    expect(readFileSync(`public/${key}.txt`, 'utf8').trim()).toBe(key);
    expect(readFileSync('scripts/indexnow.sh', 'utf8')).toMatch(/^HOST=fauna\.bristleconelab\.org$/m);
  });
});

describe('README', () => {
  const readme = readFileSync('README.md', 'utf8');
  const used = [...readme.matchAll(/docs\/img\/([\w-]+\.jpg)/g)].map((m) => m[1]);
  it('shows only screenshots that exist, and every screenshot it has', () => {
    for (const f of used) expect(existsSync(`docs/img/${f}`), f).toBe(true);
    expect(new Set(used)).toEqual(new Set(readdirSync('docs/img')));
  });
  it('links the live site', () => {
    expect(readme).toContain('](https://fauna.bristleconelab.org)');
  });
});
