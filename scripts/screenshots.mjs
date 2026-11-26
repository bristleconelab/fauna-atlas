// Regenerate the README screenshots from a running site (default: the Vite dev server).
// usage: npm run dev   (in another terminal)   then   node scripts/screenshots.mjs [baseUrl]
// Needs Google Chrome installed (playwright-core drives it, nothing is downloaded).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5299/';
const out = 'docs/img';
mkdirSync(out, { recursive: true });

const only = process.argv[3]?.split(",");
const shots = [
  { file: 'life-here.jpg', hash: '#at=-2.33,34.83', size: [1440, 900], wait: '.tile img.in' },
  { file: 'species.jpg', hash: '#sp=2481353', size: [1440, 900], wait: '.column.vertical' },
  { file: 'looked.jpg', hash: '#layer=looked', size: [1440, 900], wait: null },
  // the static pages: path instead of a hash
  { file: 'animal-page.jpg', path: 'animals/snow-leopard/', size: [1280, 860], wait: '.map img' },
  { file: 'country-page.jpg', path: 'places/kenya/', size: [1280, 860], wait: '.cards img', scroll: '#mammals' },
]

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const s of shots.filter((x) => !only || only.includes(x.file))) {
  const ctx = await browser.newContext({ viewport: { width: s.size[0], height: s.size[1] }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: !!s.mobile, hasTouch: !!s.mobile });
  const page = await ctx.newPage();
  await page.goto(base + (s.path ?? s.hash), { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  if (s.scroll) await page.$eval(s.scroll, (el) => { el.style.scrollMarginTop = '76px'; el.scrollIntoView({ block: 'start' }); }).catch(() => {});
  if (s.search) {
    await page.fill('#search', s.search);
    await page.waitForSelector('#hits .hit-thumb img', { timeout: 40000 }).catch(() => console.warn(`${s.file}: no thumbnails`));
  }
  if (s.click) {
    await page.waitForSelector(s.click, { timeout: 45000 }).catch(() => {});
    await page.click(s.click).catch((e) => console.warn(`${s.file}: click failed: ${e.message}`));
  }
  if (s.wait) await page.waitForSelector(s.wait, { timeout: 90000 }).catch(() => console.warn(`${s.file}: ${s.wait} did not appear`));
  await page.waitForTimeout(4000); // tiles, photos and the fly-to settle
  await page.screenshot({ path: `${out}/${s.file}`, type: 'jpeg', quality: 82 });
  console.log(`${out}/${s.file}`);
  await ctx.close();
}
await browser.close();
