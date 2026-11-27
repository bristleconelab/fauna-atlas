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
  // file names change with each redesign: GitHub caches README images by URL
  { file: 'kenya-area.jpg', hash: '#at=-1.29,36.82&area=g:KEN', size: [1440, 900], wait: '.tile img.in' },
  { file: 'serengeti-park.jpg', hash: '#at=-2.33,34.83&name=Serengeti%20National%20Park&area=p:33.865,-2.202;34.017,-2.255;34.17,-2.372;34.351,-2.48;34.394,-2.604;34.547,-2.797;34.655,-2.98;34.775,-3.324;34.887,-3.186;34.882,-2.907;35.139,-2.909;35.222,-2.505;35.161,-2.394;35.267,-2.303;35.211,-2.069;35.257,-1.687;34.781,-1.419;34.641,-1.592;34.831,-1.831;34.862,-2.075;34.801,-2.198;34.545,-2.209;34.373,-2.139;34.109,-2.102;33.977,-2.086', size: [1440, 900], wait: '.tile img.in' },
  { file: 'species-page.jpg', hash: '#sp=2481353', size: [1440, 900], wait: '.photo-strip img.in' },
  { file: 'looked-layer.jpg', hash: '#layer=looked', size: [1440, 900], wait: null },
  // the static pages: path instead of a hash
  { file: 'country-page-v2.jpg', path: 'places/kenya/', size: [1280, 860], wait: '.cards img', scroll: '#mammals' },
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
