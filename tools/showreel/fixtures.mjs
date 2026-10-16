// The takes' generated start states (script.mjs FIXTURES): map states made by the editor's own MapKit commands
// and game saves in the app's own format, headless, nothing recorded. A story that builds a map across scenes gets
// one map file per scene: each made from the one before (`from`) and the commands of the scene before, so any
// scene of it can be taken alone and still looks as if it came from the one before. See README.md, "Takes".
//
//   node tools/showreel/fixtures.mjs --url http://localhost:4307          the missing ones
//   node tools/showreel/fixtures.mjs --url ... --force [--only <file>]    made again (all, or one)
//
// A map fixture: { file: 'fixtures/x.3dtdmap', from: '<shipped id>' | 'fixtures/y.3dtdmap', script: '<map script>',
//   seed } (the script runs as the editor's agent's run_script, docs/AGENT_MCP.md: JavaScript against `map`)
// A save fixture: { file: 'fixtures/x.3dtdsave', game: '<shipped id>', steps: [director steps], credits } (the steps
//   play in the game as a scene would, e.g. towers built through the sidebar; then the credits are set to a
//   normal sum and the run is saved between waves and exported as the menu's Save to file does)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HERE, launch, logConsole, pageUrl } from './browser.mjs';
import { fixturePath } from './take.mjs';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
};

const hook = (page) => page.waitForFunction(() => !!window.__showreel, null, { timeout: 60_000 });

async function mapFixture(page, base, fx) {
  const from = fixturePath(fx.from);
  if (!existsSync(from)) throw new Error(`${fx.file}: no ${from}`);
  await page.goto(pageUrl(base, '/editor'));
  await hook(page);
  await page.evaluate(() => window.__showreel.ready(120));
  const id = await page.evaluate((b64) => window.__showreel.take.importMap(b64), readFileSync(from).toString('base64'));
  await page.goto(pageUrl(base, `/editor?map=${encodeURIComponent(id)}`));
  await hook(page);
  await page.evaluate(() => window.__showreel.ready(120));
  await page.evaluate(() => window.__showreel.run({ name: 'fixture', steps: [{ do: 'act', name: 'viewReady', timeout: 120 }] }));
  if (fx.script) {
    const answer = await page.evaluate(
      ([source, seed]) => window.__showreel.take.agent('run_script', { source, seed, animate: false, label: 'fixture' }),
      [fx.script, fx.seed ?? 1],
    );
    if (answer.isError) throw new Error(`${fx.file}: the script failed: ${answer.text.slice(0, 500)}`);
    const result = JSON.parse(answer.text);
    console.log(`  script: ${result.commands} commands${result.changed ? '' : ', nothing changed'}`);
    await page.evaluate(() => window.__showreel.run({ name: 'fixture', steps: [{ do: 'act', name: 'idle', timeout: 60 }] }));
  }
  const file = await page.evaluate(() => window.__showreel.take.mapFile());
  return Buffer.from(file.base64, 'base64');
}

async function saveFixture(page, base, fx) {
  await page.goto(pageUrl(base, `/?world=map:${fx.game}`, '', false, true));
  await hook(page);
  await page.evaluate(() => window.__showreel.ready(180));
  await page.waitForTimeout(1500);
  if (fx.steps?.length) await page.evaluate((s) => window.__showreel.run(s), { name: 'fixture', steps: fx.steps });
  if (fx.credits !== undefined) await page.evaluate((v) => window.__showreel.take.setCredits(v), fx.credits);
  // Saving waits for a quiet moment between waves (a tower still measuring its line of sight says no)
  for (let attempt = 0; ; attempt++) {
    const [download, saved] = await Promise.all([
      page.waitForEvent('download', { timeout: 10_000 }).catch(() => null),
      page.evaluate((name) => window.__showreel.take.exportSave(name), `showreel ${fx.file}`),
    ]);
    if (saved.ok && download) {
      const path = await download.path();
      return readFileSync(path);
    }
    if (attempt >= 20) throw new Error(`${fx.file}: the run did not save: ${saved.reason ?? 'no download'}`);
    await page.waitForTimeout(1000);
  }
}

async function main() {
  const base = option('url', 'http://localhost:4200');
  const only = option('only', '');
  const force = argv.includes('--force');
  const scriptAt = option('script', join(HERE, 'script.mjs'));
  const { FIXTURES = [] } = await import(pathToFileURL(scriptAt).href);
  const todo = FIXTURES.filter((fx) => (only ? fx.file === only : force || !existsSync(fixturePath(fx.file))));
  if (!todo.length) {
    console.log('all fixtures there (--force makes them again)');
    return;
  }
  let failed = false;
  for (const fx of todo) {
    // A fresh browser each: nothing of the one before in its storage
    const browser = await launch({ size: [1600, 900], quality: 'high', seed: fx.seed ?? 1 });
    const problems = [];
    logConsole(browser.page, problems);
    try {
      console.log(`fixture ${fx.file}`);
      const bytes = fx.game ? await saveFixture(browser.page, base, fx) : await mapFixture(browser.page, base, fx);
      const out = fixturePath(fx.file);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, bytes);
      console.log(`  ${out}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}`);
    } catch (e) {
      failed = true;
      console.error(`  failed: ${e.message}`);
    } finally {
      await browser.close();
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
