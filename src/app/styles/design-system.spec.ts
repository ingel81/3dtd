/**
 * Guards of the design system (docs/DESIGN_SYSTEM.md). Values live in
 * td-theme.ts, recipes and the td-* classes in styles/ui/; a component only
 * lays out. Every stylesheet, inline style and template under src/app is read
 * from disk:
 * - outside styles/ no colour, gradient, shadow, font family, font size or
 *   radius of its own; those come from a td-* class or a token,
 * - every var(--td-*) is a token (or a custom property a stylesheet sets),
 * - every token is used.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { TD_CSS_VARS } from './td-theme';

const APP = resolve('src/app');
const GLOBAL = resolve('src/styles.scss');
const OWN = join(APP, 'styles') + sep;

function files(dir: string, ext: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path, ext);
    return ext.some((e) => entry.name.endsWith(e)) ? [path] : [];
  });
}

const stylesheets = files(APP, ['.scss']);
const sources = files(APP, ['.ts']).filter((f) => !f.endsWith('.spec.ts'));
const templates = files(APP, ['.html']);

/** The CSS a component brings: its stylesheet, or the styles of its decorator (array or string) */
function componentCss(): { file: string; css: string }[] {
  const own = stylesheets.filter((f) => !f.startsWith(OWN)).map((file) => ({ file, css: readFileSync(file, 'utf8') }));
  const inline = sources.flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    const block =
      /styles:\s*\[([\s\S]*?)\]\s*,?\s*\n\s*(?:changeDetection|host|providers|imports|template|selector|standalone|\})/.exec(text) ??
      /styles:\s*`([\s\S]*?)`/.exec(text);
    return block ? [{ file, css: block[1] }] : [];
  });
  return [...own, ...inline];
}

const stripComments = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');

const TOKENS = String.raw`var\(--td-[a-z0-9-]+\)\s*(?:,\s*var\(--td-[a-z0-9-]+\)\s*)*[;}]`;
const RULES: [string, RegExp][] = [
  ['colour literal', /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|:\s*(?:white|black)\b/],
  ['gradient', /\b(?:linear|radial|conic|repeating-linear|repeating-radial)-gradient\(/],
  ['shadow of its own', new RegExp(String.raw`\b(?:box|text)-shadow\s*:(?!\s*(?:none\b|inherit\b|${TOKENS}))`)],
  ['font family', /\bfont-family\s*:(?!\s*inherit\b)/],
  ['font size of its own', /\bfont-size\s*:(?!\s*(?:var\(--td-fs-|inherit\b))/],
  ['font shorthand', /(?:^|[\s;{])font\s*:(?!\s*inherit\b)/],
  ['radius of its own', /\bborder-radius\s*:(?!\s*(?:0\s*[;}]|50%|var\(--td-radius\)|inherit\b))/],
  ['drop shadow filter', /\bdrop-shadow\(/],
  ['backdrop filter', /\bbackdrop-filter\s*:/],
  // Durations come from --td-dur-*; 0s only times a visibility switch
  ['duration of its own', /\btransition(?:-duration)?\s*:[^;]*?(?<![\w.-])(?!0s\b)\d*\.?\d+m?s\b/],
  // A surface or relief of a recipe, rebuilt by hand: use the td-* class
  [
    'recipe rebuilt',
    /\b(?:background|box-shadow)\s*:\s*var\(--td-(?:well|well-soft|well-shadow|well-soft-shadow|well-deep|surface|surface-overlay|stone-[a-z]+|raised[a-z-]*|pressed|panel-recess)\)/,
  ],
];

// Places that may break a rule, each with its reason
const ALLOWED: [file: string, rule: string, why: string][] = [
  ['boss-intro.component.ts', 'duration of its own', 'a choreography timed with BOSS_INTRO_TIMING'],
  ['damage-matrix-dialog.component.scss', 'recipe rebuilt', 'the sticky head needs the plaster under it'],
  ['wave-timeline.component.scss', 'recipe rebuilt', 'the diamond covers the line with the plaster'],
  ['tech-tree.component.scss', 'recipe rebuilt', 'a tree node is a stone plate with a state frame'],
];
const allowed = (file: string, rule: string) => ALLOWED.some(([f, r]) => file.endsWith(f) && r === rule);

describe('design system', () => {
  it('finds the stylesheets and templates', () => {
    expect(stylesheets.length).toBeGreaterThan(50);
    expect(templates.length).toBeGreaterThan(50);
  });

  it('components take colours, surfaces and type only from the system', () => {
    const found: string[] = [];
    for (const { file, css } of componentCss()) {
      stripComments(css).split('\n').forEach((line, i) => {
        for (const [name, re] of RULES) if (re.test(line) && !allowed(file, name)) found.push(`${relative(APP, file)}:${i + 1} ${name}: ${line.trim()}`);
      });
    }
    expect(found).toEqual([]);
  });

  it('text parts a line with " | ", never with a middle dot', () => {
    const found: string[] = [];
    for (const file of [...sources, ...templates]) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        // Comments may use the dot for a product (`S · strength · R`)
        if (line.includes(' · ') && !/^\s*(\/\/|\*|\/\*|<!--)/.test(line)) found.push(`${relative(APP, file)}:${i + 1}`);
      });
    }
    expect(found).toEqual([]);
  });

  it('templates set no colours in inline styles', () => {
    const found: string[] = [];
    for (const file of templates) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bstyle="([^"]*)"/g)) {
        if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|gradient\(|font-size|shadow/.test(m[1])) found.push(`${relative(APP, file)}: ${m[0]}`);
      }
    }
    expect(found).toEqual([]);
  });

  const defined = new Set([...TD_CSS_VARS.matchAll(/(--td-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const everything = [GLOBAL, ...stylesheets, ...sources, ...templates].map((f) => readFileSync(f, 'utf8')).join('\n');
  // A component's own sizes: set in a stylesheet, by a style binding or setProperty
  const setLocally = new Set(
    [...stylesheets, ...sources, ...templates].flatMap((f) =>
      [...stripComments(readFileSync(f, 'utf8')).matchAll(/(--td-[a-z0-9-]+)\s*:|style\.(--td-[a-z0-9-]+)|setProperty\(\s*'(--td-[a-z0-9-]+)'/g)]
        .map((m) => m[1] ?? m[2] ?? m[3])
        .filter((n) => !defined.has(n)),
    ),
  );
  const used = new Set([...(everything + TD_CSS_VARS).matchAll(/var\((--td-[a-z0-9-]+)/g)].map((m) => m[1]));

  it('reads only tokens that exist', () => {
    const missing = [...used].filter((name) => !defined.has(name) && !setLocally.has(name));
    expect(missing).toEqual([]);
  });

  it('has no unused tokens', () => {
    const unused = [...defined].filter((name) => !used.has(name));
    expect(unused).toEqual([]);
  });
});
