// Builds the files of the 3DTD design system in Claude Design (project/…) from the repository:
// tokens from td-theme.ts, the built global CSS as bundle.css, a card per td-* component, fonts,
// brand book and cover. See README.md beside this file. Run after `npm run build`:
//   node tools/design-system/build.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const OUT = join(REPO, 'tmp/design-system');
const P = (p) => join(OUT, 'project', p);
rmSync(OUT, { recursive: true, force: true });
const write = (p, text) => { mkdirSync(dirname(P(p)), { recursive: true }); writeFileSync(P(p), text); };

// Logos and textures are uploads of the design system; the CSS and the previews point at them.
// Their addresses live outside the repository, in tmp/design-system.config.json (see README.md).
const CONFIG = JSON.parse(readFileSync(join(REPO, 'tmp/design-system.config.json'), 'utf8'));
const BLOB = CONFIG.blobs;

// ---------------------------------------------------------------- tokens from td-theme.ts
const theme = await import(pathToFileURL(join(REPO, 'src/app/styles/td-theme.ts')).href);
const vars = [...theme.TD_CSS_VARS.matchAll(/^\s*(--td-[a-z0-9-]+):\s*(.+);\s*$/gm)].map((m) => ({ name: m[1].slice(2), value: m[2].trim() }));

// Usage notes: the token tables of docs/DESIGN_SYSTEM.md, then the notes below
const doc = readFileSync(`${REPO}/docs/DESIGN_SYSTEM.md`, 'utf8');
const desc = {};
for (const row of doc.split('\n').filter((l) => l.startsWith('|') && l.includes('--td-'))) {
  const cells = row.split('|');
  const names = [...cells[1].matchAll(/--td-[a-z0-9-]+/g)].map((m) => m[0].slice(2));
  const shorts = [...cells[1].matchAll(/`(-[a-z0-9-]+)`/g)].map((m) => m[1]).filter((s) => !s.startsWith('--'));
  const all = [...names];
  if (names[0]) for (const s of shorts) all.push(names[0].replace(/-[a-z0-9]+$/, '') + s);
  const text = cells.slice(2, -1).join('|').replace(/`/g, '').trim();
  for (const n of all) desc[n] ??= text;
}
const NOTES = {
  'td-knob-light': 'Light edge of the slider handle (td-slider).',
  'td-knob-dark': 'Dark edge of the slider handle (td-slider).',
  'td-teal-light': 'Teal text on dark grounds: a wave running, values that are confirmed.',
  'td-teal-dark': 'Deep teal for fills behind teal-light text.',
  'td-green-dark': 'Darker positive green, for fills and bars.',
  'td-tree-line': 'Strands between nodes of the research tree.',
  'td-tree-well': 'The sunken board the research tree lies in.',
  'td-node-locked': 'Research node that is locked: face.',
  'td-node-locked-edge': 'Research node that is locked: edge.',
  'td-node-locked-title': 'Research node that is locked: its title.',
  'td-node-locked-foot': 'Research node that is locked: its price line.',
  'td-node-open': 'Research node that can be researched: face.',
  'td-node-poor-edge': 'Research node the player cannot afford: edge.',
  'td-node-poor-mark': 'Research node the player cannot afford: price mark.',
  'td-node-poor-hover': 'Research node the player cannot afford: under the pointer.',
  'td-node-poor-glyph': 'Research node the player cannot afford: its glyph.',
  'td-node-active': 'Research node being researched now: face.',
  'td-node-queued': 'Research node in the queue: face.',
  'td-node-done': 'Research node researched: face.',
  'td-node-done-edge': 'Research node researched: edge.',
  'td-branch-biology': 'Strand colour of the biology branch (--td-mark on [data-branch=biology]).',
  'td-branch-engineering': 'Strand colour of the engineering branch (--td-mark on [data-branch=engineering]).',
  'td-tex-size': 'Tile size of the plaster and basalt textures under every surface.',
  'td-overlay-opacity': 'How much of the plaster a strip over the map keeps (td-overlay).',
  'td-over-image': 'Text shadow for text over a picture (the menu globe): a dark halo keeps it legible.',
  'td-gameover-word': 'Text shadow of GAME OVER: dark drop and a red glow.',
  'td-sp-2': 'Spacing step 2 (8px): gaps inside rows and stats.',
  'td-sp-3': 'Spacing step 3 (12px): gaps between groups in a panel.',
  'td-sp-4': 'Spacing step 4 (16px): gaps between sections of a dialog body.',
  'td-h-button-sm': 'Height of a small button (td-btn-sm, td-seg.is-sm).',
  'td-dense-text': 'Running text in dense panels (td-dense: debug windows).',
  'td-dense-button': 'Button text in dense panels.',
  'td-dense-lead': 'Lead figures in dense panels.',
  'td-dense-title': 'Titles in dense panels.',
  'td-dense-h-button': 'Button height in dense panels.',
  'td-dense-h-button-sm': 'Small button height in dense panels.',
  'td-dense-h-field': 'Field height in dense panels.',
  'td-dense-h-row': 'Row height in dense panels.',
  'td-dense-tool': 'Tool size in dense panels.',
  'td-sidebar-width': 'Width of the game sidebar.',
  'td-sidebar-gutter': 'Side gutter inside the sidebar; the top bar values end on it.',
  'td-dock-gutter': 'Side gutter of the coop dock blocks.',
  'td-z-marks': 'Stacking: marks on the map (ping arrows).',
  'td-z-hud': 'Stacking: HUD strips over the map (ability bar, squad box).',
  'td-z-dock': 'Stacking: the coop dock, above the HUD strips.',
  'td-event-vfx': 'Debug only: the VFX event category in the event log.',
  'td-event-audio': 'Debug only: the audio event category in the event log.',
  'td-perf-critical': 'Debug only: a frame-time value that is critical.',
  'td-perf-warning': 'Debug only: a frame-time value worth a look.',
};
const usage = (n) => NOTES[n] ?? desc[n] ?? '';

const isColor = (v) => /^#[0-9a-fA-F]{3,8}$/.test(v) || /^(rgba?|hsla?)\([\d.,\s%]+\)$/.test(v);
const isShadow = (v) => /px/.test(v) && /(rgba?\(|#)/.test(v) && !/var\(|gradient|url\(|drop-shadow\(/.test(v);
const isLength = (v) => /^-?\d*\.?\d+(px|rem|em|%)?$/.test(v);

const color = [], shadow = [], spacing = [], radius = [], size = [], opacity = [], zIndex = [], keep = [];
for (const { name, value } of vars) {
  const entry = { name, value, usage: usage(name) };
  if (/^td-(fs-|dense-(text|button|lead|title)$)/.test(name) || name === 'td-font' || name === 'td-font-mono') keep.push({ name, value }); // type: shown as styles, kept as variables for the CSS
  else if (/^td-z-/.test(name)) zIndex.push(entry);
  else if (/opacity/.test(name)) opacity.push(entry);
  else if (isColor(value)) color.push({ name, value: { dark: value.toLowerCase().replace(/\s+/g, '') }, usage: entry.usage });
  else if (/^td-sp-/.test(name) && isLength(value)) spacing.push(entry);
  else if (/radius/.test(name) && isLength(value)) radius.push(entry);
  else if (isShadow(value)) shadow.push({ name, value, usage: entry.usage });
  else if (isLength(value)) size.push(entry);
  else keep.push({ name, value });
}

const TYPE = theme.TD_TYPE;
const tokens = {
  name: '3DTD',
  version: 1,
  meta: {
    source: 'github',
    repo: 'ingel81/3dtd',
    ref: process.env.DS_REF ?? 'next',
    paths: {
      tokens: ['src/app/styles/td-theme.ts'],
      fonts: ['@fontsource/barlow-semi-condensed', '@fontsource/jetbrains-mono'],
      assets: ['public/assets/images/logo', 'public/assets/ui'],
      docs: ['docs/DESIGN_SYSTEM.md', 'src/app/styles/ui'],
    },
    synced: new Date().toISOString().slice(0, 10),
  },
  color: {
    note: 'One theme: the game is dark. Values exactly as in td-theme.ts; surfaces built from textures stay in bundle.css.',
    themes: [{ id: 'dark', name: 'Dark' }],
    tokens: color,
  },
  type: {
    fonts: [
      { family: 'Barlow Semi Condensed', file: 'fonts/BarlowSemiCondensed-500.woff2', weight: '500', style: 'normal' },
      { family: 'Barlow Semi Condensed', file: 'fonts/BarlowSemiCondensed-500-italic.woff2', weight: '500', style: 'italic' },
      { family: 'Barlow Semi Condensed', file: 'fonts/BarlowSemiCondensed-600.woff2', weight: '600', style: 'normal' },
      { family: 'Barlow Semi Condensed', file: 'fonts/BarlowSemiCondensed-700.woff2', weight: '700', style: 'normal' },
      { family: 'JetBrains Mono', file: 'fonts/JetBrainsMono-400.woff2', weight: '400', style: 'normal' },
      { family: 'JetBrains Mono', file: 'fonts/JetBrainsMono-600.woff2', weight: '600', style: 'normal' },
    ],
    families: {
      ui: "'Barlow Semi Condensed', 'Arial Narrow', system-ui, sans-serif",
      mono: "'JetBrains Mono', ui-monospace, monospace",
    },
    groups: [
      {
        name: 'Display', family: 'ui', styles: [
          { name: 'gameover', fontSize: TYPE.gameover, lineHeight: 0.95, fontWeight: 700, letterSpacing: '0.1em', sample: 'GAME OVER', usage: 'GAME OVER over the map, in caps, danger-text with the gameover-word shadow.' },
          { name: 'hero', fontSize: TYPE.hero, lineHeight: 1.05, fontWeight: 700, sample: 'Skarnax', usage: "The boss's name in the boss intro." },
          { name: 'hud', fontSize: TYPE.hud, lineHeight: 1, fontWeight: 700, sample: '1157', usage: 'Numbers in the top bar (td-value), tabular.' },
        ],
      },
      {
        name: 'Text', family: 'ui', styles: [
          { name: 'menu', fontSize: TYPE.menu, lineHeight: 1.2, fontWeight: 600, sample: 'Continue', usage: 'Main menu entries (td-menu-item).' },
          { name: 'title', fontSize: TYPE.title, lineHeight: 1.2, fontWeight: 700, sample: 'Settings', usage: 'Dialog titles (td-dlg-title).' },
          { name: 'lead', fontSize: TYPE.lead, lineHeight: 1.3, fontWeight: 600, sample: '41:08', usage: 'Small figures in tiles and counts; a research title.' },
          { name: 'text', fontSize: TYPE.text, lineHeight: 1.4, fontWeight: 500, sample: 'The run at York ends; towers, research and credits start over.', usage: 'Running text in dialogs, fields and rows.' },
          { name: 'button', fontSize: TYPE.button, lineHeight: 1, fontWeight: 600, sample: 'Restart here', usage: 'Button labels.' },
          { name: 'body', fontSize: TYPE.body, lineHeight: 1.35, fontWeight: 500, sample: '62 enemies | Unarmored', usage: 'Text in the sidebar and tooltips.' },
          { name: 'small', fontSize: TYPE.small, lineHeight: 1.35, fontWeight: 500, sample: 'M mutes everything in the game.', usage: 'Side information, table heads, notes (td-note).' },
          { name: 'micro', fontSize: TYPE.micro, lineHeight: 1.2, fontWeight: 600, letterSpacing: '0.1em', sample: 'CREDITS', usage: 'Caps labels in the HUD (td-caps). Nothing smaller.' },
        ],
      },
      {
        name: 'Code', family: 'mono', styles: [
          { name: 'code', fontSize: TYPE.small, lineHeight: 1.35, fontWeight: 400, sample: 'K7Q2PX', usage: 'Room codes, keys and logs only.' },
        ],
      },
    ],
  },
  spacing: { tokens: spacing },
  radius: { tokens: radius },
  shadow: { note: 'Box and text shadows of the plaster look; text shadows are noted as such.', tokens: shadow },
  size: { note: 'Heights, widths and sizes of controls and layout.', tokens: size },
  opacity: { tokens: opacity },
  zIndex: { tokens: zIndex },
};
write('tokens.json', JSON.stringify(tokens, null, 2) + '\n');

// ---------------------------------------------------------------- tokens.css, the first one
const styleCss = tokens.type.groups.flatMap((g) => g.styles.map((s) => {
  const fam = `var(--font-${s.family ?? g.family})`;
  return `.${s.name} { font-family: ${fam}; font-size: ${s.fontSize}; line-height: ${s.lineHeight}; font-weight: ${s.fontWeight};${s.letterSpacing ? ` letter-spacing: ${s.letterSpacing};` : ''} }`;
}));
const tokensCss = [
  '/* 3DTD — generated from tokens.json */',
  `:root, [data-theme="dark"] {`,
  ...color.map((t) => `  --${t.name}: ${t.value.dark};`),
  ...shadow.map((t) => `  --${t.name}: ${t.value};`),
  '}',
  ':root {',
  ...spacing.map((t) => `  --${t.name}: ${t.value};`),
  ...radius.map((t) => `  --${t.name}: ${t.value};`),
  ...size.map((t) => `  --${t.name}: ${t.value};`),
  ...opacity.map((t) => `  --${t.name}: ${t.value};`),
  ...zIndex.map((t) => `  --${t.name}: ${t.value};`),
  ...Object.entries(tokens.type.families).map(([k, v]) => `  --font-${k}: ${v};`),
  '}',
  ...styleCss,
  ...tokens.type.fonts.map((f) => `@font-face { font-family: '${f.family}'; src: url('${f.file}') format('woff2'); font-weight: ${f.weight}; font-style: ${f.style}; font-display: swap; }`),
  '',
].join('\n');
write('tokens.css', tokensCss);

// ---------------------------------------------------------------- fonts
const MEDIA = `${REPO}/dist/3DTD/browser/media`;
const fontSrc = {
  'BarlowSemiCondensed-500.woff2': /barlow-semi-condensed-latin-500-normal.*\.woff2$/,
  'BarlowSemiCondensed-500-italic.woff2': /barlow-semi-condensed-latin-500-italic.*\.woff2$/,
  'BarlowSemiCondensed-600.woff2': /barlow-semi-condensed-latin-600-normal.*\.woff2$/,
  'BarlowSemiCondensed-700.woff2': /barlow-semi-condensed-latin-700-normal.*\.woff2$/,
  'JetBrainsMono-400.woff2': /jetbrains-mono-latin-400-normal.*\.woff2$/,
  'JetBrainsMono-600.woff2': /jetbrains-mono-latin-600-normal.*\.woff2$/,
};
const media = readdirSync(MEDIA);
mkdirSync(P('fonts'), { recursive: true });
for (const [out, re] of Object.entries(fontSrc)) copyFileSync(join(MEDIA, media.find((f) => re.test(f))), P(`fonts/${out}`));

// ---------------------------------------------------------------- bundle.css: the global td-* classes as built
const cssFile = readdirSync(`${REPO}/dist/3DTD/browser`).find((f) => /^styles-.*\.css$/.test(f));
let globalCss = readFileSync(`${REPO}/dist/3DTD/browser/${cssFile}`, 'utf8');
globalCss = globalCss.replace(/@font-face\{[^}]*\}/g, '').replace(/^html\{[^}]*\}/, '');
const keepCss = keep.map(({ name, value }) => `  --${name}: ${value.replace("url('assets/ui/plaster.jpg')", `url('${BLOB.plaster}')`).replace("url('assets/ui/basalt.jpg')", `url('${BLOB.basalt}')`)};`);
const bundleCss = `/* 3DTD components: the global td-* classes of the game (src/app/styles/ui), as built.
   tokens.css declares every token; this :root holds what tokens.json cannot carry:
   surfaces built from textures, gradients, filters, font stacks, durations and easing. */
:root {
${keepCss.join('\n')}
}
${globalCss}
/* Previews: a page ground like the game's */
body { margin: 0; padding: 16px; background: var(--td-bg-dark); color: var(--td-text-primary); font-family: var(--td-font); font-size: var(--td-fs-body); }
.pv-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.pv-col { display: flex; flex-direction: column; gap: 10px; }
.pv-map { padding: 20px; border-radius: var(--td-radius); background: linear-gradient(rgba(0,0,0,.25), rgba(0,0,0,.25)), url('${BLOB.basalt}') 0 0 / 256px; }
.pv-label { min-width: 90px; color: var(--td-text-muted); font-size: var(--td-fs-small); }
`;
write('components/bundle.css', bundleCss);

// ---------------------------------------------------------------- icons
const iconSrc = readFileSync(`${REPO}/src/app/components/icon/icon.component.ts`, 'utf8');
const start = iconSrc.indexOf('const ICONS');
const open = iconSrc.indexOf('{', iconSrc.indexOf('=', start));
let depth = 0, end = open;
for (let i = open; i < iconSrc.length; i++) {
  if (iconSrc[i] === '{') depth++;
  else if (iconSrc[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
}
const ICONS = new Function(`return ${iconSrc.slice(open, end + 1)}`)();
const ic = (name, s = 18) => {
  const d = ICONS[name] ?? { body: '<circle cx="12" cy="12" r="6"/>' };
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${d.fill ?? 'none'}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d.body}</svg>`;
};

// ---------------------------------------------------------------- components
const C = [];
const comp = (name, group, height, summary, readme, html) => C.push({ name, group, height, summary, readme, html });

comp('Button', 'Actions', 120, 'Stone buttons with engraved text: primary (brass text), secondary, danger, ghost and small.', `
## When to use
- \`td-btn-primary\`: the one action a dialog or panel leads with ("Restart here", "Wave 4"). One per group.
- \`td-btn-secondary\`: every other action ("Main menu", "Save the run log").
- \`td-btn-danger\`: an action that ends or deletes something; secondary stone with red text.
- \`td-btn-ghost\`: quiet text actions in footers (the sidebar foot: Menu, Tips, version).
- \`td-btn-sm\`: the small size of any of them (\`--td-h-button-sm\`).

## The consumer provides
A \`<button type="button">\` with a verb label, sentence case. An icon only on the primary button, as text colour.
\`disabled\` or \`aria-disabled="true"\` gives the shared disabled look; \`is-busy\` marks one that waits; \`is-on\`/\`aria-pressed\` sinks a toggle into a deep well with brass.

## Don't
No outline ring on focus (none on any control). No colours or shadows of your own; no second primary in a row.`,
`<div class="pv-col">
  <div class="pv-row"><button class="td-btn-primary" type="button">${ic('refresh', 16)}Restart here</button><button class="td-btn-secondary" type="button">Main menu</button><button class="td-btn-danger" type="button">Delete</button><button class="td-btn-ghost" type="button">Tips</button></div>
  <div class="pv-row"><button class="td-btn-primary td-btn-sm" type="button">Upgrade 180</button><button class="td-btn-secondary td-btn-sm" type="button">Sell 112</button><button class="td-btn-secondary" type="button" disabled>Disabled</button><button class="td-btn-secondary is-on" type="button" aria-pressed="true">2x</button></div>
</div>`);

comp('IconButton', 'Actions', 80, 'Square stone button with an icon (td-icon-btn); the close button; is-over-map for a stone alone on the map.', `
## When to use
- \`td-icon-btn\` (32px, \`is-sm\` 26px): quick actions, game speed, layer toggles. On with \`aria-pressed\`, \`aria-expanded\` or \`is-on\`.
- \`td-icon-btn is-over-map\`: a stone standing alone on the map with its own shadow (\`--td-raised-over-map\`), like the ability buttons (48px there).
- \`td-close\`: the drawn cross in a dialog head (\`--td-close-size\`).

## The consumer provides
An \`aria-label\` (the icon is decoration), the icon at 18–22px as currentColor.`,
`<div class="pv-row">
  <button class="td-icon-btn" type="button" aria-label="Pause">${ic('pause')}</button>
  <button class="td-icon-btn is-on" type="button" aria-pressed="true" aria-label="Layers">${ic('layers')}</button>
  <button class="td-icon-btn is-sm" type="button" aria-label="Camera">${ic('camera', 16)}</button>
  <span class="pv-map pv-row"><button class="td-icon-btn is-over-map" type="button" style="width:48px;height:48px;color:var(--td-brass-light)" aria-label="Frost bomb">${ic('snowflake', 20)}</button><button class="td-icon-btn is-over-map" type="button" style="width:48px;height:48px" aria-label="Hero">${ic('user', 22)}</button></span>
  <button class="td-close" type="button" aria-label="Close">${ic('close', 12)}</button>
</div>`);

comp('Tool', 'Actions', 64, 'An icon cut into the surface without a plate: the tools of the top bar and strips.', `
## When to use
\`td-tool\` for tools in the top bar (copy link, favourites, random city, move HQ); \`td-tool-gap\` parts groups with an engraved line. On (\`is-on\`, \`aria-pressed\`, an open menu) in brass; \`is-armed\` red for a first click on delete or kick.

## The consumer provides
\`aria-label\` and a 20px icon.`,
`<div class="td-topbar" style="width:max-content"><div class="pv-row" style="gap:4px">
  <button class="td-tool" type="button" aria-label="Copy link">${ic('link', 20)}</button>
  <button class="td-tool is-on" type="button" aria-label="Favorites">${ic('bookmark', 20)}</button>
  <button class="td-tool" type="button" aria-label="Random city">${ic('random', 20)}</button>
  <span class="td-tool-gap"></span>
  <button class="td-tool" type="button" aria-label="Move HQ">${ic('home', 20)}</button>
</div></div>`);

comp('StoneChip', 'Actions', 64, 'A small raised stone over the map that opens something: the closed frame rate.', `
## When to use
\`td-stone-chip\` for a control that sits quietly on the map and opens a panel (the FPS readout, closed). At rest at \`--td-chip-rest-opacity\` (.6), full under the pointer. Open, the content moves onto a \`td-overlay\` strip.

## The consumer provides
The figure and a caret (down closed, up open), \`role="button"\`, \`aria-expanded\`.`,
`<div class="pv-map pv-row"><span class="td-stone-chip" role="button" aria-expanded="false" style="color:var(--td-text-title)">144 <span style="color:var(--td-text-muted);display:inline-flex">${ic('caret', 10)}</span></span><span class="td-stone-chip" style="opacity:1;color:var(--td-brass-light)">144 <span style="display:inline-flex">${ic('caret', 10)}</span></span></div>`);

comp('Input', 'Inputs', 150, 'Sunken text field with its label above; the code field in mono; the error line.', `
## When to use
\`td-field\` holds \`td-label\` over a \`td-input\` (40px, \`--td-h-field\`). \`is-code\` for room codes (mono, caps, wide tracking), \`is-sm\` small. Focus shows a 2px brass edge inside (the only focus mark in the system). An error: \`td-error\` under the field with a warning glyph, text in \`--td-error-text\`.

## The consumer provides
A visible label (or \`aria-label\`), placeholder at 40% (\`td-placeholder\`).`,
`<div class="pv-row" style="align-items:flex-start;gap:24px">
  <label class="td-field" style="width:260px"><span class="td-label">Your name</span><input class="td-input" value="Ann"></label>
  <label class="td-field" style="width:170px"><span class="td-label">Room code</span><input class="td-input is-code" value="K7Q2"></label>
  <div class="td-field" style="width:260px"><span class="td-label">Search</span><input class="td-input" placeholder="City, street or address"><p class="td-error">No room with this code. Check it and try again.</p></div>
</div>`);

comp('Select', 'Inputs', 90, 'A native select in the sunken field look, brass angle.', `
## When to use
\`td-select\` on a \`<select>\` for one of many options (colour grading, lobby). \`is-auto\` sizes it to its content. Fewer than five options: prefer Segmented.`,
`<div class="pv-row"><label class="td-field" style="width:220px"><span class="td-label">Color grading</span><select class="td-select"><option>None</option><option>Warm dusk</option><option>Cold steel</option></select></label></div>`);

comp('Segmented', 'Inputs', 120, 'Choices in one shared well; the chosen one a raised stone plate with brass text.', `
## When to use
\`td-seg\` for two to five exclusive choices: quality steps, frame limit, targeting, tabs. The buttons sit in a shared well; the chosen one (\`is-on\`, \`aria-checked\`, \`aria-pressed\`, \`aria-selected\`) is a raised plate (\`--td-stone-plate\`, \`--td-raised-plate\`) like a slider in its groove. \`is-compact\`, \`is-sm\` (30px) and \`is-stacked\` (a name over a detail) vary it.

## The consumer provides
\`role="radiogroup"\` with \`role="radio"\` buttons, or tabs with \`role="tab"\`.`,
`<div class="pv-col" style="max-width:520px">
  <div class="td-seg" role="radiogroup"><button type="button">Low</button><button type="button">Medium</button><button type="button" class="is-on">High</button></div>
  <div class="pv-row"><span class="pv-label">Frame limit</span><div class="td-seg is-compact"><button type="button" class="is-on">Off</button><button type="button">60</button><button type="button">30</button></div><div class="td-seg is-sm is-compact"><button type="button">First</button><button type="button" class="is-on">Strong</button><button type="button">Close</button></div></div>
</div>`);

comp('Switch', 'Inputs', 64, 'A sunken slot whose knob slides right and turns brass.', `
## When to use
\`td-switch\` on an \`<input type="checkbox">\` for settings that apply at once. In a toggle button, a \`<span class="td-switch">\` shows the button's state with \`is-on\`.`,
`<div class="pv-row" style="gap:28px"><label class="pv-row">Muzzle flash <input class="td-switch" type="checkbox" checked></label><label class="pv-row">Bloom <input class="td-switch" type="checkbox"></label></div>`);

comp('Check', 'Inputs', 64, 'A sunken box with a brass mark for multiple choice.', `
## When to use
\`td-check\` on a checkbox in lists of options (room options, filters). A setting that applies at once uses Switch.`,
`<div class="pv-row" style="gap:28px"><label class="pv-row"><input class="td-check" type="checkbox" checked> Cheats</label><label class="pv-row"><input class="td-check" type="checkbox"> Public room</label></div>`);

comp('Slider', 'Inputs', 72, 'A groove with a scale, brass fill and a stone handle.', `
## When to use
\`td-slider\` on \`<input type="range">\` for volumes and amounts; the value beside it in \`td-value\` brass. Arrow keys move it; the game leaves them to a focused slider.`,
`<div class="pv-row" style="max-width:520px"><span class="pv-label">Music</span><input class="td-slider" type="range" value="40" style="flex:1;--td-fill:40%"><span style="color:var(--td-brass);font-weight:700">40</span></div>`);

comp('Panel', 'Surfaces', 170, 'The plaster panel: tinted plaster, sunken fill, strong drop shadow.', `
## When to use
\`td-panel\` for any standing surface (menu list, loading plate). Dialogs, the sidebar and the research tree are the same surface. Inside: \`td-section\` heads in brass, \`td-head\` for a caps head, \`td-rule\`/\`td-line-*\` engraved lines (\`--td-line-dark\` 50%, \`--td-line-light\` 15%, 2px, 1px apart).

## Don't
No borders, corner ornaments or bands; no second accent colour.`,
`<div class="td-panel" style="width:420px;padding:16px"><div class="td-stack"><h3 class="td-section" style="margin:0">Audio</h3><p class="td-text" style="margin:0">M mutes everything in the game.</p><div class="td-rule"></div><h3 class="td-section" style="margin:0">Graphics</h3><p class="td-note" style="margin:0">Changes apply at once.</p></div></div>`);

comp('Overlay', 'Surfaces', 120, 'A strip over the map: the same plaster, slightly see-through.', `
## When to use
\`td-overlay\` for everything on the canvas that is a strip: replay bar, open info overlay, hint box, boss bar, squad, chat, compass. The plaster sits on a ::before at \`--td-overlay-opacity\` (.86) with 6px blur behind. \`is-error\` adds a dark red edge.

## Don't
Not for a single control on the map: that is a stone (StoneChip, IconButton is-over-map).`,
`<div class="pv-map"><div class="td-overlay" style="padding:10px 14px;width:max-content"><span style="color:var(--td-text-title)">Pan</span> <span class="td-kbd">WASD</span> <span>Move</span> <span class="td-kbd">H</span> <span>Shortcuts</span></div><div class="td-overlay is-error" style="padding:10px 14px;width:max-content;margin-top:10px">The connection to the coop server is lost.</div></div>`);

comp('Dialog', 'Surfaces', 230, 'td-dlg with head (title, close), scrolling body and a foot of buttons.', `
## When to use
Every dialog and menu page: \`td-dlg\` > \`td-dlg-head\` (\`td-dlg-title\`, \`td-close\`; an engraved line under it that runs out before the cross) > \`td-dlg-body\` (scrolls) > \`td-dlg-foot\` (\`td-actions\`, \`is-split\` puts secondary actions left). Dialogs stand under the top bar.

## The consumer provides
\`role="dialog"\`, \`aria-modal\`, \`aria-labelledby\` on the title; focus trapped inside, given back quietly on close.`,
`<section class="td-dlg" role="dialog" aria-labelledby="t" style="width:520px"><header class="td-dlg-head"><h2 class="td-dlg-title" id="t">Restart here?</h2><button class="td-close" type="button" aria-label="Close">${ic('close', 12)}</button></header><div class="td-dlg-body"><p class="td-text" style="margin:0">The run at York ends. Towers, research and credits start over at wave 1.</p></div><footer class="td-dlg-foot td-actions"><button class="td-btn-secondary" type="button">Cancel</button><button class="td-btn-primary" type="button">Restart</button></footer></section>`);

comp('Popup', 'Surfaces', 110, 'A popup over a panel: tooltip, open select, context menu.', `
## When to use
\`td-popup\` with \`--td-popup-drop\` for anything that floats over a panel. \`td-reveal\` animates it in (\`is-fade\` without the lift).`,
`<div class="td-popup" style="padding:10px 12px;width:280px"><b style="color:var(--td-text-title)">Cannon Tower</b><p class="td-note" style="margin:4px 0 0">Splash damage on the ground. Slow, strong against packs.</p></div>`);

comp('Banner', 'Surfaces', 120, 'A line of notice in a panel: warning or problem with an action.', `
## When to use
\`td-banner\` (\`is-warn\`) for a notice inside a panel or dialog (a load that went wrong, a confirmation question); actions in a \`td-actions is-start\` row under the text.`,
`<div class="td-banner is-warn td-stack" style="width:460px"><p style="margin:0">The streets of York did not load.</p><div class="td-actions is-start"><button class="td-btn-primary td-btn-sm" type="button">Retry</button><button class="td-btn-secondary td-btn-sm" type="button">Other place</button></div></div>`);

comp('Well', 'Surfaces', 110, 'Sunken areas: well, deep well and card.', `
## When to use
\`td-well\` (\`--td-well\`, \`--td-well-shadow\`) for sunken groups; \`is-deep\` for a chosen or pressed state; \`td-card\` for a sunken card (the next-wave card).`,
`<div class="pv-row" style="align-items:stretch"><div class="td-well" style="padding:12px;width:180px">Well</div><div class="td-well is-deep" style="padding:12px;width:180px">Deep well</div><div class="td-card" style="padding:10px 12px;width:220px"><b style="color:var(--td-text-title)">Rat Tide</b><div class="td-note">62 enemies | Unarmored</div></div></div>`);

comp('Menu', 'Navigation', 330, 'The main menu: entries 48px, the focus and open page as a raised stone plate with brass text.', `
## When to use
\`td-menu\` in a \`td-panel\` (320px, \`--td-menu-width\`): \`td-menu-item\` buttons (22px/600, brass icon), \`td-menu-rule\` before the lower group. Focus and the open page (\`aria-current="page"\`) are a raised plate; with the focus elsewhere the open page's plate lies flat. Arrow keys move, Enter chooses. The pause list opens with a head: PAUSED left, place and wave right.`,
`<nav class="td-panel" style="width:320px;padding:14px"><div class="td-menu" role="menu">
  <button class="td-menu-item" type="button" role="menuitem" aria-current="page" style="background:var(--td-stone-plate);box-shadow:var(--td-raised-plate);color:var(--td-brass-light)">${ic('play')}<span>Continue</span></button>
  <button class="td-menu-item" type="button" role="menuitem">${ic('download')}<span>Save game</span></button>
  <button class="td-menu-item" type="button" role="menuitem">${ic('cog')}<span>Settings</span></button>
  <div class="td-menu-rule" role="separator"></div>
  <button class="td-menu-item" type="button" role="menuitem">${ic('flag')}<span>New game</span></button>
</div></nav>`);

comp('Topbar', 'Navigation', 80, 'The top bar in basalt: place field, tools, values parted by deep grooves.', `
## When to use
\`td-topbar\` (48px, \`--td-surface-topbar\`, plate edge at the bottom). \`td-sunk\` place field with \`td-loc-label\` ("DEFEND", caps) and \`td-loc-name\`. Values as \`td-stat\`: icon 20px, \`td-caps\` label, \`td-value\` (29px/700); between two values a groove of 2px \`--td-sep-dark\` with \`--td-sep-light\`. \`td-meter\` segments under HQ, \`td-progress is-teal\` under the wave.`,
`<header class="td-topbar" style="width:100%"><img src="${BLOB.logo}" alt="3DTD" style="height:30px"><span class="td-sunk" style="display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 12px"><span style="color:var(--td-brass);display:inline-flex">${ic('pin', 16)}</span><span class="td-loc-label">Defend</span><span class="td-loc-name">York</span></span><span style="margin-left:auto;display:flex;gap:var(--td-sp-2)"><span class="td-stat"><span style="color:var(--td-danger-text);display:inline-flex">${ic('home', 20)}</span><span class="td-caps">HQ</span><span class="td-value" style="color:var(--td-danger-text)">500</span></span><span class="td-stat"><span style="color:var(--td-brass);display:inline-flex">${ic('coin', 20)}</span><span class="td-caps">Credits</span><span class="td-value">1157</span></span><span class="td-stat"><span style="color:var(--td-teal);display:inline-flex">${ic('wave', 20)}</span><span class="td-caps">Wave</span><span class="td-value">3</span></span></span></header>`);

comp('Sidebar', 'Navigation', 300, 'The game sidebar: plaster like the dialogs, sections parted by engraved lines, a groove against the map.', `
## When to use
\`td-side\` (300px, \`--td-sidebar-width\`), its sections \`td-side-section\` (the last \`is-fill\` scrolls), heads \`td-side-head\` with \`td-side-name\` (\`is-armed\` red for "Click again to sell"), scrolling body \`td-side-body\`. Down its edge against the map runs a groove (\`--td-edge-dark\`, \`--td-edge-light\`). Build tiles are \`td-tile\`.`,
`<aside class="td-side" style="width:300px;height:270px"><section class="td-side-section"><button class="td-btn-primary" type="button" style="width:100%;justify-content:flex-start">${ic('play', 16)}Wave 4<span class="td-kbd" style="margin-left:auto">Space</span></button><h2 class="td-side-head"><span class="td-side-name">Next</span></h2><div class="td-card" style="padding:8px 10px"><b style="color:var(--td-text-title)">Rat Tide</b><div class="td-note">62 enemies | Unarmored</div></div></section><section class="td-side-section is-fill"><h2 class="td-side-head"><span class="td-side-name">Build</span></h2><div class="td-tiles" style="grid-template-columns:1fr 1fr"><div class="td-tile">Archer Tower</div><div class="td-tile">Locked</div></div></section></aside>`);

comp('Tiles', 'Data', 100, 'Figures in sunken tiles, the label under or over the value.', `
## When to use
\`td-tiles\` grid of \`td-tile\` for key figures (game over balance, tower stats). \`is-label-under\` puts the caps label under the value.`,
`<dl class="td-tiles" style="grid-template-columns:repeat(5,1fr);max-width:620px;margin:0"><div class="td-tile is-label-under"><dt class="td-caps">Wave</dt><dd class="td-value">23</dd></div><div class="td-tile is-label-under"><dt class="td-caps">Kills</dt><dd class="td-value">1.9k</dd></div><div class="td-tile is-label-under"><dt class="td-caps">Time</dt><dd class="td-value">41:08</dd></div><div class="td-tile is-label-under"><dt class="td-caps">Earned</dt><dd class="td-value">18.4k</dd></div><div class="td-tile is-label-under"><dt class="td-caps">Spent</dt><dd class="td-value">17.9k</dd></div></dl>`);

comp('Table', 'Data', 150, 'Tables with plain heads, rows on lines, the chosen row raised in brass.', `
## When to use
\`td-table\` for lists with columns (save slots, rooms, players). Numbers in \`num\` cells, right-aligned, tabular. \`is-own\` (your row) and a chosen row are raised with brass text.`,
`<table class="td-table" style="width:560px"><thead><tr><th>Player</th><th class="num">Kills</th><th class="num">Leaks</th><th class="num">Towers</th></tr></thead><tbody><tr class="is-own"><td>Ann (you)</td><td class="num">812</td><td class="num">3</td><td class="num">14</td></tr><tr><td>Ben</td><td class="num">640</td><td class="num">7</td><td class="num">11</td></tr></tbody></table>`);

comp('Rows', 'Data', 140, 'A list of raised rows with a name and a line under it.', `
## When to use
\`td-rows\` of \`td-row\` (40px, \`--td-h-row\`): a \`td-row-main\` button with \`td-name\` and \`td-sub\`, tools after it. Lists of favourites, steps, menu pages.`,
`<ul class="td-rows" style="width:420px;margin:0;padding:0;list-style:none"><li class="td-row"><button class="td-row-main" type="button"><span class="td-name">Kiliansplatz</span><span class="td-sub td-num">49.1420, 9.2190</span></button></li><li class="td-row"><button class="td-row-main" type="button"><span class="td-name">Paris, Louvre</span><span class="td-sub td-num">48.8606, 2.3376</span></button></li></ul>`);

comp('Meter', 'Data', 90, 'Segment meter and progress bar in a groove.', `
## When to use
\`td-meter\` (segments, \`i.is-on\`) for health in tenths and loading steps; \`td-progress\` for a fill in a groove: \`is-edge\` 2px at the foot of a button, \`is-tick\` following a seconds counter, \`is-teal\` for a running wave.`,
`<div class="pv-col" style="max-width:360px"><span class="td-meter"><i class="is-on"></i><i class="is-on"></i><i class="is-on"></i><i class="is-on"></i><i class="is-on"></i><i class="is-on"></i><i class="is-on"></i><i></i><i></i><i></i></span><span class="td-progress"><span style="width:62%"></span></span><span class="td-progress is-teal"><span style="width:40%"></span></span></div>`);

comp('Text', 'Data', 120, 'Text roles: caps label, value, note, key cap, tag, link.', `
## When to use
\`td-caps\` (11px caps, 600, tracked) for labels; \`td-value\` for figures; \`td-note\` (13px, muted; \`is-warn\`, \`is-ok\`) for side information; \`td-kbd\` for key caps; \`td-tag\` (\`is-warn\`) for a word of state; \`td-link\` for links; \`td-num\` for tabular digits. Separator in running text: " | ", never a middle dot.`,
`<div class="pv-col"><div class="pv-row"><span class="td-caps">Credits</span><span class="td-value">1157</span><span class="td-note">York | wave 3</span><span class="td-note is-ok">No leaks</span><span class="td-note is-warn">Need 600 credits</span></div><div class="pv-row"><span class="td-kbd">Space</span><span class="td-kbd">Esc</span><span class="td-tag">Coop</span><span class="td-tag is-warn">Cheats on</span><a class="td-link" href="#">Full changelog</a></div></div>`);

comp('GameOver', 'Game', 300, 'GAME OVER over the greyed map under a red vignette, the line under it, the plate rising after it.', `
## When to use
Only for the end of a run. \`td-gameover-veil\` covers the play area: \`--td-gameover-veil\` red vignette, the map behind at \`--td-gameover-map\` (grey .65, darker). \`td-gameover-word\` "Game over" in caps at 118px (\`gameover\` style), \`--td-danger-text\` with the \`--td-gameover-word\` glow. \`td-gameover-sub\`: "HQ lost | place | wave n", the wave in brass. Under it a \`td-dlg\` without head, \`td-gameover-rise\`.

## Motion
Once on open: the veil fades in, the word slams in from 1.9x, the view shakes once (450ms), the plate rises after it. Still under reduced motion.`,
`<div class="td-gameover-veil" style="position:relative;display:flex;flex-direction:column;align-items:center;gap:14px;padding:28px;background:var(--td-gameover-veil),url('${BLOB.basalt}') 0 0/256px;animation:none"><h1 class="td-gameover-word" style="font-size:64px;animation:none">Game over</h1><p class="td-gameover-sub">HQ lost | York | wave <b>23</b></p><div class="td-dlg" style="width:460px"><div class="td-dlg-body"><dl class="td-tiles" style="grid-template-columns:repeat(3,1fr);margin:0"><div class="td-tile is-label-under"><dt class="td-caps">Wave</dt><dd class="td-value">23</dd></div><div class="td-tile is-label-under"><dt class="td-caps">Kills</dt><dd class="td-value">1.9k</dd></div><div class="td-tile is-label-under"><dt class="td-caps">Time</dt><dd class="td-value">41:08</dd></div></dl></div></div></div>`);

comp('Marker', 'Game', 80, 'Arrow plates at the map edge and the place marks of the menu globe.', `
## When to use
\`td-marker\` (in a \`td-marker-btn\`): a round plate with ring and symbol in \`--td-mark\` (text \`--td-mark-text\`), \`is-sm\` 24px; arrows for spawns, enemies and pings at the edge of the map. \`td-globe-mark\` dots and names on the menu globe (records and favourites brass, the loading place teal with a ring).`,
`<div class="pv-map pv-row" style="gap:20px"><button class="td-marker-btn" type="button" style="position:relative;transform:none" aria-label="Spawn"><span class="td-marker" style="--td-mark:var(--td-danger-edge)">${ic('caretR', 14)}</span></button><button class="td-marker-btn" type="button" style="position:relative;transform:none" aria-label="Ping"><span class="td-marker" style="--td-mark:var(--td-teal)">${ic('pin', 14)}</span></button><button class="td-marker-btn" type="button" style="position:relative;transform:none" aria-label="HQ"><span class="td-marker is-sm">${ic('home', 12)}</span></button></div>`);

for (const c of C) {
  write(`components/${c.name}/README.md`, `# ${c.name}\n\n${c.summary}\n${c.readme}\n`);
  write(`components/${c.name}/preview.html`, `<!-- @dsCard group="${c.group}" height=${c.height} -->\n<!doctype html>\n<html>\n<head><meta charset="utf-8"><title>${c.name}</title></head>\n<body>\n${c.html}\n</body>\n</html>\n`);
}

// ---------------------------------------------------------------- assets READMEs
write('assets/Logos/README.md', `# Logos

- \`logo.svg\`: the 3DTD mark (tower in a map pin) with the wordmark, brass on dark. Main menu 180px wide centred over the list, pause menu 135px, top bar 30px high. Always on a dark ground (\`td-bg-dark\`, plaster or basalt); never recoloured, never on light.
- \`logo_square.png\`: the square mark for app icons and avatars.
`);
write('assets/Textures/README.md', `# Textures

The two materials every surface is made of. Both CC0 from Poly Haven, recoloured to the palette; tiled at \`--td-tex-size\`.

- \`plaster.jpg\` (grey_plaster_02): panels, dialogs, the sidebar, strips over the map, stone buttons; under a tint (\`--td-tint\`).
- \`basalt.jpg\` (dark_rock): the top bar and the tab on it; the game over band.
`);

// ---------------------------------------------------------------- README, the brand book
write('README.md', readFileSync(join(HERE, 'brand-book.md'), 'utf8'));

// ---------------------------------------------------------------- cover
write('components/Cover/preview.html', readFileSync(join(HERE, 'cover.html'), 'utf8'));

// ---------------------------------------------------------------- index
const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const index = {
  v: 3,
  layout: 'files',
  createdOnFiles: { v: 1, at: now },
  title: '3DTD',
  namespace: 'TD',
  libraries: [],
  sections: {},
  groups: ['Logos', 'Textures'],
  assetGroups: {
    Logos: { name: 'Logos', tile: 'l', order: ['logo.svg', 'logo_square.png'], files: {
      'logo.svg': { name: 'logo.svg', blob: BLOB.logo.split('/').pop(), size: 41251, type: 'image/svg+xml' },
      'logo_square.png': { name: 'logo_square.png', blob: BLOB.logoSquare.split('/').pop(), size: 38945, type: 'image/png' },
    } },
    Textures: { name: 'Textures', tile: 'm', order: ['plaster.jpg', 'basalt.jpg'], files: {
      'plaster.jpg': { name: 'plaster.jpg', blob: BLOB.plaster.split('/').pop(), size: 48291, type: 'image/jpeg' },
      'basalt.jpg': { name: 'basalt.jpg', blob: BLOB.basalt.split('/').pop(), size: 38727, type: 'image/jpeg' },
    } },
  },
  blobs: {},
  docs: { readme: 'project/README.md', sections: [] },
  lastChange: { by: process.env.DS_BY ?? 'ingel81', at: now, via: `Claude Code · ingel81/3dtd@${process.env.DS_REF ?? 'next'}`, note: process.env.DS_NOTE ?? 'Rebuilt from the repository: tokens, classes, fonts, logos, textures.' },
};
write('design-system.json', JSON.stringify(index, null, 2) + '\n');

const counts = { color: color.length, shadow: shadow.length, spacing: spacing.length, radius: radius.length, size: size.length, opacity: opacity.length, zIndex: zIndex.length, kept: keep.length, components: C.length };
console.log(JSON.stringify(counts));
console.log('kept:', keep.map((k) => k.name).join(' '));
