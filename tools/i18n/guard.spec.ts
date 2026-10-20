/**
 * The guard against hard-coded texts (TODO E245, docs/I18N_PLAN.md 7.2):
 * every player-facing English text the scan finds outside the dictionary,
 * in every area but the developer and agent ones, must be named in
 * tools/i18n/allowed.mjs with why (a name, a key cap, a licensor's credit
 * line, data, a diagnostic). Any other text belongs in the dictionary.
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { guardedTexts } from './scan.mjs';
import { ALLOWED } from './allowed.mjs';

const root = resolve(__dirname, '..', '..');

describe('i18n guard', () => {
  const now = guardedTexts(root);

  it('finds no hard-coded text outside the dictionary but the ones allowed.mjs names', () => {
    const found: string[] = [];
    for (const [file, texts] of Object.entries(now)) {
      const allowed = (ALLOWED as Record<string, Record<string, string>>)[file] ?? {};
      for (const text of texts) if (!Object.hasOwn(allowed, text)) found.push(`${file}: ${text}`);
    }
    expect(found, 'texts belong in src/app/i18n/messages; a name or data goes into tools/i18n/allowed.mjs with why').toEqual([]);
  });

  it('allows only texts that are still there, each with why', () => {
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
