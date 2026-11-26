import { defineConfig, type Plugin } from 'vitest/config';
import { writePages } from './pages/build.ts';

/** After the app build: the static species and country pages, their index pages and the full sitemap (pages/build.ts).
 *  Without data/pages/*.json (scripts/fetch_pages_data.py) the build has only the globe and public/sitemap.xml. */
function staticPages(): Plugin {
  let outDir = 'dist';
  return {
    name: 'fauna-static-pages',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const n = writePages(process.cwd(), outDir);
      this.info?.(n ? `static pages: ${n}` : 'static pages: no data/pages/*.json, skipped');
    },
  };
}

// Served from the site root (https://fauna.bristleconelab.org). Set BASE=/some/path/ to host under a sub-path.
export default defineConfig({
  base: process.env.BASE ?? '/',
  plugins: [staticPages()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
