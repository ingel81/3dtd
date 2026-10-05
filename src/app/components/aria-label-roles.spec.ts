/**
 * An aria-label on a span, div or p without a role names nothing: ARIA does
 * not allow a name on a generic element, and screen readers skip it (review
 * E92, the build bar's badges). Every template under src/app is read from
 * disk; such an element needs a role (img for a badge, group for a block).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve('src/app');

function templates(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return templates(path);
    return entry.name.endsWith('.html') ? [path] : [];
  });
}

/** Opening tags of generic elements with a label and no role, as "file:line <tag" */
function unnamedLabels(): string[] {
  const found: string[] = [];
  for (const file of templates(ROOT)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/<(span|div|p)\b[^>]*>/g)) {
      const tag = match[0];
      if (!/(\[attr\.)?aria-label\]?=/.test(tag) || /\brole=/.test(tag)) continue;
      const line = text.slice(0, match.index).split('\n').length;
      found.push(`${relative(ROOT, file)}:${line} <${match[1]}`);
    }
  }
  return found;
}

describe('aria-label on generic elements', () => {
  it('finds the templates', () => {
    expect(templates(ROOT).length).toBeGreaterThan(50);
  });

  it('no span, div or p carries an aria-label without a role', () => {
    expect(unnamedLabels()).toEqual([]);
  });
});
