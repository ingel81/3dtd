/**
 * The guard against new hard-coded texts (TODO E245, docs/I18N_PLAN.md 7.2):
 * every player-facing English text the scan finds must be in the baseline,
 * so a new one goes into the dictionary instead. Texts the baseline holds
 * that are gone only warn: `node tools/i18n/baseline.mjs` writes it anew.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { closedTexts, guardedTexts } from './scan.mjs';
import { ALLOWED } from './allowed.mjs';

const root = resolve(__dirname, '..', '..');

describe('i18n guard', () => {
  it('finds no player-facing English text outside the dictionary that the baseline does not know', () => {
    const baseline = JSON.parse(readFileSync(join(root, 'tools', 'i18n', 'baseline.json'), 'utf8')) as Record<string, string[]>;
    const now = guardedTexts(root);
    const added: string[] = [];
    let gone = 0;
    for (const [file, texts] of Object.entries(now)) {
      const known = new Set(baseline[file] ?? []);
      for (const text of texts) if (!known.has(text)) added.push(`${file}: ${text}`);
    }
    for (const [file, texts] of Object.entries(baseline)) {
      const present = new Set(now[file] ?? []);
      gone += texts.filter((t) => !present.has(t)).length;
    }
    if (gone) console.warn(`i18n guard: ${gone} texts of the baseline are gone; node tools/i18n/baseline.mjs lowers it`);
    expect(added, 'new texts belong in src/app/i18n/messages (en.ts and de.ts)').toEqual([]);
  });

  it('finds no hard-coded text at all in a closed area (menus, dialogs, coop) but the ones allowed.mjs names', () => {
    const found: string[] = [];
    for (const [file, texts] of Object.entries(closedTexts(root))) {
      const allowed = (ALLOWED as Record<string, Record<string, string>>)[file] ?? {};
      for (const text of texts) if (!Object.hasOwn(allowed, text)) found.push(`${file}: ${text}`);
    }
    expect(found, 'a closed area keeps its words in src/app/i18n/messages; a name or data goes into tools/i18n/allowed.mjs with why').toEqual([]);
  });

  it('allows only texts that are still there, each with why', () => {
    const now = closedTexts(root);
    const stale: string[] = [];
    for (const [file, texts] of Object.entries(ALLOWED as Record<string, Record<string, string>>)) {
      const present = new Set(now[file] ?? []);
      for (const [text, why] of Object.entries(texts)) {
        if (!present.has(text)) stale.push(`${file}: ${text}`);
        expect(why.trim(), `${file}: ${text}`).not.toBe('');
      }
    }
    expect(stale, 'texts allowed.mjs names that the scan no longer finds').toEqual([]);
  });
});
