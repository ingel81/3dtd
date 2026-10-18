// A map fixture seen from straight above, the whole map in one picture (the editor's top-down render), to read
// coordinates for a scene's camera off it; prints size, HQ, spawns and the number of objects.
//
//   node tools/showreel/topdown.mjs <dev server> fixtures/<x>.3dtdmap <out>.png
import { readFileSync, writeFileSync } from 'node:fs';
import { launch, pageUrl } from './browser.mjs';
import { fixturePath } from './take.mjs';
const [base, spec, out] = process.argv.slice(2);
const hook = (page) => page.waitForFunction(() => !!window.__showreel, null, { timeout: 60_000 });
const browser = await launch({ size: [1600, 900], quality: 'high', seed: 1 });
const { page } = browser;
try {
  await page.goto(pageUrl(base, '/editor')); await hook(page); await page.evaluate(() => window.__showreel.ready(120));
  const id = await page.evaluate((b64) => window.__showreel.take.importMap(b64), readFileSync(fixturePath(spec)).toString('base64'));
  await page.goto(pageUrl(base, `/editor?map=${encodeURIComponent(id)}`)); await hook(page);
  await page.evaluate(() => window.__showreel.ready(120));
  await page.evaluate(() => window.__showreel.run({ name: 'x', steps: [{ do: 'act', name: 'viewReady', timeout: 120 }, { do: 'act', name: 'idle' }] }));
  await page.waitForTimeout(3000);
  const r = await page.evaluate(async () => {
    const el = document.querySelector('app-editor-page');
    const s = window.ng.getComponent(el).session;
    const c = await s.view.renderTopDown(2048, 2048, false);
    const t = s.doc.terrain;
    return { url: c.toDataURL('image/png'), w: t.width, d: t.depth, hq: s.doc.hq, spawns: s.doc.spawns.map((p) => [Math.round(p.x), Math.round(p.y)]), objects: s.doc.objects.length };
  });
  writeFileSync(out, Buffer.from(r.url.split(',')[1], 'base64'));
  console.log(JSON.stringify({ w: r.w, d: r.d, hq: r.hq, spawns: r.spawns, objects: r.objects }));
} finally { await browser.close(); }
