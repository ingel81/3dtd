/**
 * Finds the player-facing English texts in the game's sources (TODO E245):
 * string literals in TypeScript, text and attributes in Angular templates
 * (files and inline `template:`), the shipped maps' index and the run plan.
 * A text counts when it reads as prose: words with spaces, or one
 * capitalised word where the game shows words (a `label:`, a `title=`).
 * Logs, imports, ids, CSS, shader code, comparisons and the like do not.
 *
 * It is a heuristic, made to size the work and later to guard against new
 * hard-coded texts (a ratchet per area); it is not the dictionary's source.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { parseTemplate } from '@angular/compiler';

/** Areas in the order their rules are tried; the first match wins */
export const AREAS = [
  { id: 'dev', label: 'Entwickler (Debug, Benchmark, Bots, Showreel)', test: (p) => /^(benchmark|bots|showreel|devworld\/(?!.*menu))|services\/debug|components\/(debug-window|engine-test|info-overlay)|^tools\/|^world\/custom-map\/(preview\/|demo-map|perf-map)/.test(p) },
  { id: 'agent', label: 'Agenten-API (Werkzeugbeschreibungen für KI-Agenten)', test: (p) => /^editor\/agent\/|agent-mcp/.test(p) },
  { id: 'onboarding', label: 'Tutorial und Onboarding', test: (p) => /services\/onboarding|components\/(context-hint|intro-skip)|editor\/ui\/shell\/(tour|level-guide)|upgrade-hint|camo-hint/.test(p) },
  { id: 'editor', label: 'Editor', test: (p) => /^editor\//.test(p) },
  { id: 'mapops', label: 'Kartenprüfung und Import (map-ops, world/osm, w3x)', test: (p) => /^map-ops\/|^world\/(osm|w3x|custom-map)\//.test(p) },
  { id: 'coop', label: 'Coop', test: (p) => /^coop\/|services\/coop|components\/coop-/.test(p) },
  { id: 'changelog', label: 'Changelog (Was ist neu)', test: (p) => /configs\/changelog|whats-new/.test(p) },
  { id: 'errors', label: 'Fehlermeldungen und Ablehnungen', test: (p) => /refusal|why-not|-refusal|services\/infrastructure/.test(p) },
  { id: 'configs', label: 'Configs (Tower, Gegner, Forschung, Fähigkeiten, Held, Wellen)', test: (p) => /^configs\/|run-plan\.json$/.test(p) },
  { id: 'maps', label: 'Mitgelieferte Karten (Name, Beschreibung)', test: (p) => /^public\/maps\//.test(p) },
  { id: 'sim', label: 'Simulation (Worker: Manager, Director, Entities)', test: (p) => /^(managers|sim|director|entities|game-components|simulator)\//.test(p) },
  { id: 'menus', label: 'Menüs, Welten, Globus, Laden', test: (p) => /components\/(main-menu|world-globe|globe-backdrop|token-setup|update-hint|osm-frame|world-path)|^(worlds|globe|world)\/|services\/location|app-shell|game-host/.test(p) },
  { id: 'dialogs', label: 'Dialoge (Forschung, Läufe, Hotkeys, Quellen …)', test: (p) => /-dialog|reference-dialogs|tech-tree|run-summary|run-charts|^run-log\/|^replay\//.test(p) },
  { id: 'desktop', label: 'Desktop-App (Electron-Hauptprozess)', test: (p) => /^desktop\//.test(p) },
  { id: 'hud', label: 'HUD und Spiel (Header, Sidebar, Tower-Panel, Banner …)', test: () => true },
];

/** Property names under which a single capitalised word is shown to the player */
const UI_PROP = /^(label|title|name|text|description|desc|hint|tooltip|tip|placeholder|aria\w*|heading|head|caption|button|summary|note|message|reason|short|long|verb|unit|line|body|detail|subtitle|lead|empty|action|confirm|cancel|ok|yes|no|tag|badge|plural|singular|status|word|what|why|how)$/i;
/** Template attributes that carry visible text */
const UI_ATTR = /^(title|aria-label|aria-description|placeholder|alt|label|tdTooltip|matTooltip|tooltip|data-tip|heading|caption|hint|text|name|confirm)$/i;
/** Calls whose string arguments never reach the player */
const SKIP_CALL = /^(console\.\w+|appendDebugLog|\w*[lL]og(ger)?\.\w+|log|warn|debug|trace|require|import|querySelector(All)?|getElementById|addEventListener|removeEventListener|dispatchEvent|setAttribute|getAttribute|removeAttribute|hasAttribute|classList\.\w+|matchMedia|fetch|readText|writeText|readJson|writeJson|removeKey|getItem|setItem|removeItem|includes|startsWith|endsWith|indexOf|lastIndexOf|split|join|replace|replaceAll|match|test|has|get|delete|getObjectByName|getExtension|getContext|getParameter|postMessage|performance\.\w+|mark|measure|describe|it|test|expect|createElement|createElementNS|Symbol|InjectionToken|RegExp|toHaveBeenCalledWith|define|defineProperty|on|off|once|emit|send|invoke|handle|ipcRenderer\.\w+|ipcMain\.\w+)$/;
const COMPARE = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword]);

/** Does `text` read as words for the player? `single` allows one capitalised word. */
export function isProse(raw, single) {
  const text = raw.replace(/\{\}/g, ' ').trim();
  if (text.length < 2 || !/[A-Za-z]{2,}/.test(text)) return false;
  if (/^(https?:|data:|blob:|\.{0,2}\/|#[0-9a-f]{3,8}$|[\w./-]+\.(ts|js|mjs|json|glb|gltf|png|jpe?g|webp|ktx2|svg|mp3|ogg|wav|html|css|scss|md|3dtdmap|bin|f32|zip)$)/i.test(text)) return false;
  if (/^\s*<|<\/?[a-z][a-z0-9-]*[ >]/i.test(text)) return false;
  if (/(gl_|vec[234]\b|mat[234]\b|uniform |varying |#include|#define|#ifdef|void main|\bfloat\s+\w+\s*[=(;]|diffuseColor)/.test(text)) return false;
  // A canvas font: "700 48px 'Barlow Semi Condensed'"
  if (/^(\d{3}|bold|normal|italic)\s+\d+px\s/.test(text)) return false;
  // An Overpass query
  if (/\[out:json\]/.test(text)) return false;
  if (/(^|[;{]\s*)[a-z-]+\s*:\s*[^ ]+;|var\(--|rgba?\(|\b\d+(px|rem|em|vh|vw|ms|deg)\b.*\b\d+(px|rem|em|vh|vw|ms|deg)\b/.test(text)) return false;
  if (/^[A-Z0-9_]+$/.test(text) || /^[a-z0-9_$.:\-/[\]]+$/i.test(text) && !/\s/.test(text) && !single) return false;
  if (/\s/.test(text) && /[A-Za-z]{2,}\s+[A-Za-z0-9]/.test(text)) {
    // Words with spaces; not a class list, a selector or a key path
    if (/^[a-z0-9-]+(\s+[a-z0-9-]+)*$/.test(text) && /-/.test(text)) return false;
    if (/^[a-z][a-zA-Z0-9]*(\s+[a-z][a-zA-Z0-9]*)*$/.test(text) && text.split(/\s+/).every((w) => /[A-Z]/.test(w.slice(1)))) return false;
    return true;
  }
  return single && /^[A-Z][a-z]+[a-z!?.…]*$/.test(text);
}

function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    const left = ts.isIdentifier(expr.expression) ? expr.expression.text + '.' : ts.isPropertyAccessExpression(expr.expression) ? expr.expression.name.text + '.' : '';
    return SKIP_CALL.test(left + expr.name.text) ? left + expr.name.text : expr.name.text;
  }
  return '';
}

function propName(node) {
  const name = node.name;
  if (!name) return '';
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
  return '';
}

/** Where a TS literal sits: null when it never reaches the player, else whether one word counts */
function tsContext(node) {
  let child = node;
  let parent = node.parent;
  // A literal inside a template string, a ternary, parentheses or `as`: look at what holds the whole
  while (parent && (ts.isTemplateSpan(parent) || ts.isTemplateExpression(parent) || ts.isConditionalExpression(parent) || ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) || ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken || ts.isBinaryExpression(parent) && (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || parent.operatorToken.kind === ts.SyntaxKind.BarBarToken))) {
    if (ts.isConditionalExpression(parent) && parent.condition === child) return null;
    child = parent;
    parent = parent.parent;
  }
  if (!parent) return null;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent) || ts.isLiteralTypeNode(parent) || ts.isImportTypeNode(parent)) return null;
  if (ts.isElementAccessExpression(parent) || ts.isCaseClause(parent) || ts.isEnumMember(parent) && parent.name === child) return null;
  if (ts.isBinaryExpression(parent) && COMPARE.has(parent.operatorToken.kind)) return null;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === child) return null;
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    const name = calleeName(parent.expression);
    if (SKIP_CALL.test(name)) return null;
    if (ts.isNewExpression(parent) && /Error$/.test(name)) return { single: false, error: true };
    return { single: /^(notify|notice|say|tell|toast|alert|confirm|prompt|set|show|announce|label|plural|hint)$/i.test(name) };
  }
  if (ts.isThrowStatement(parent)) return { single: false, error: true };
  if (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isVariableDeclaration(parent) || ts.isShorthandPropertyAssignment(parent)) {
    const name = propName(parent);
    if (/^(selector|styles?|styleUrls?|templateUrl|host|providers|imports|id|key|kind|type|t|cls|class|className|icon|sound|clip|model|url|src|href|path|file|event|topic|channel|role|tag|format|mode|ease|font|color|colour|fontFamily)$/i.test(name)) return null;
    return { single: UI_PROP.test(name) };
  }
  if (ts.isReturnStatement(parent) || ts.isArrowFunction(parent)) return { single: true };
  if (ts.isArrayLiteralExpression(parent)) {
    const holder = parent.parent && (ts.isPropertyAssignment(parent.parent) || ts.isVariableDeclaration(parent.parent)) ? propName(parent.parent) : '';
    if (/^(styles?|imports|providers|keys|ids)$/i.test(holder)) return null;
    return { single: UI_PROP.test(holder) || /s$/.test(holder) && UI_PROP.test(holder.slice(0, -1)) };
  }
  return { single: false };
}

/** The text of a TS literal; a template string's holes become `{}` */
function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return node.head.text + node.templateSpans.map((s) => '{}' + s.literal.text).join('');
}

/** Visible texts in an Angular template */
export function templateTexts(source, url) {
  const out = [];
  let parsed;
  try {
    parsed = parseTemplate(source, url, { preserveWhitespaces: false });
  } catch {
    return out;
  }
  const exprLiterals = (src, single) => {
    for (const m of src.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
      const text = (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, '{}');
      if (isProse(text, single)) out.push(text);
    }
  };
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const kind = node.constructor?.name ?? '';
    if (kind.endsWith('Text') && typeof node.value === 'string') {
      const text = node.value.replace(/\s+/g, ' ').trim();
      if (isProse(text, true)) out.push(text);
    } else if (kind.endsWith('BoundText')) {
      const src = node.value?.source ?? '';
      const statics = src.replace(/\{\{[\s\S]*?\}\}/g, '{}').replace(/\s+/g, ' ').trim();
      if (isProse(statics.replace(/^(\{\}\s*)+|(\s*\{\})+$/g, ''), true)) out.push(statics);
      for (const m of src.matchAll(/\{\{([\s\S]*?)\}\}/g)) exprLiterals(m[1], true);
    } else if (kind.endsWith('TextAttribute')) {
      if (UI_ATTR.test(node.name) && isProse(node.value, true)) out.push(node.value);
    } else if (kind.endsWith('BoundAttribute')) {
      const src = node.value?.source ?? '';
      const ui = UI_ATTR.test(node.name) || /^(attr\.)?(aria-label|title|placeholder)$/.test(node.name);
      if (!/^(class|style)\b|^ngClass$/.test(node.name)) exprLiterals(src, ui);
    } else if (kind.endsWith('BoundEvent')) {
      exprLiterals(node.handler?.source ?? '', false);
    }
    for (const key of ['children', 'branches', 'cases', 'groups', 'empty', 'placeholder', 'loading', 'error', 'attributes', 'inputs', 'outputs', 'templateAttrs']) {
      const v = node[key];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  parsed.nodes.forEach(walk);
  return out;
}

/** Texts and error texts of one TS file */
export function tsTexts(source, file) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const texts = [];
  const errors = [];
  const visit = (node) => {
    // An inline template is parsed as a template, its styles skipped
    if (ts.isPropertyAssignment(node) && ['template', 'styles'].includes(propName(node)) && ts.isCallExpression(node.parent?.parent) && calleeName(node.parent.parent.expression) === 'Component') {
      if (propName(node) === 'template' && (ts.isNoSubstitutionTemplateLiteral(node.initializer) || ts.isStringLiteral(node.initializer))) texts.push(...templateTexts(node.initializer.text, file));
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const ctx = tsContext(node);
      const text = literalText(node);
      if (ctx && isProse(text, ctx.single)) (ctx.error ? errors : texts).push(text);
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    if (ts.isDecorator(node) || ts.isTypeNode(node) && !ts.isTypeLiteralNode(node)) {
      if (!ts.isDecorator(node)) return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { texts, errors };
}

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!/^(node_modules|test|testing|__snapshots__)$/.test(name)) walkFiles(full, out);
    } else out.push(full);
  }
  return out;
}

const SKIP_FILE = /^i18n\/|(\.spec|\.perf|\.bench|\.scenario|\.stub|\.d|\.test)\.ts$|(^|\/)(test-|fixtures?\/)|\.worker-bundle|environment/;

/** Every text found, by file, relative to `root` (the repository) */
export function scanSources(root) {
  const files = [];
  const app = join(root, 'src', 'app');
  for (const full of walkFiles(app)) {
    const rel = relative(app, full).split(sep).join('/');
    if (SKIP_FILE.test(rel)) continue;
    if (rel.endsWith('.ts')) {
      const { texts, errors } = tsTexts(readFileSync(full, 'utf8'), rel);
      if (texts.length || errors.length) files.push({ file: rel, texts, errors });
    } else if (rel.endsWith('.html')) {
      const texts = templateTexts(readFileSync(full, 'utf8'), rel);
      if (texts.length) files.push({ file: rel, texts, errors: [] });
    } else if (rel.endsWith('run-plan.json')) {
      const rows = JSON.parse(readFileSync(full, 'utf8'));
      files.push({ file: rel, texts: rows.map((r) => r.name).filter(Boolean), errors: [], notes: rows.map((r) => r.note).filter(Boolean) });
    }
  }
  const index = JSON.parse(readFileSync(join(root, 'public', 'maps', 'index.json'), 'utf8'));
  files.push({ file: 'public/maps/index.json', texts: index.maps.flatMap((m) => [m.name, m.description].filter(Boolean)), errors: [] });
  const desktop = join(root, 'desktop', 'src');
  for (const full of walkFiles(desktop)) {
    if (!full.endsWith('.js')) continue;
    const rel = 'desktop/src/' + relative(desktop, full).split(sep).join('/');
    const { texts, errors } = tsTexts(readFileSync(full, 'utf8'), rel);
    if (texts.length) files.push({ file: rel, texts, errors });
  }
  return files;
}

/** The area a file falls in */
export function areaOf(file) {
  const p = file.replace(/^src\/app\//, '');
  return AREAS.find((a) => a.test(p));
}

const words = (text) => text.replace(/\{\}/g, ' ').split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;

/** Count per area: texts, unique texts, words, error texts */
export function inventory(files) {
  const byArea = new Map(AREAS.map((a) => [a.id, { area: a, texts: 0, unique: new Set(), words: 0, errors: 0, files: [] }]));
  for (const f of files) {
    const row = byArea.get(areaOf(f.file).id);
    row.texts += f.texts.length;
    f.texts.forEach((t) => { row.unique.add(t); row.words += words(t); });
    row.errors += f.errors.length;
    row.files.push(f);
  }
  return [...byArea.values()];
}

/** Areas the guard leaves out: developer tools and the agents' API speak English for good */
const UNGUARDED = new Set(['dev', 'agent']);

/**
 * Areas done (docs/I18N_PLAN.md 6): no baseline holds texts for them, every
 * text the scan finds there fails the guard unless tools/i18n/allowed.mjs
 * names it with why. An area joins once its texts are in the dictionary.
 */
export const CLOSED_AREAS = new Set(['menus', 'dialogs', 'coop', 'mapops', 'editor']);

/** Texts by file, sorted and unique, of the areas `keep` lets through */
function textsBy(root, keep) {
  const out = {};
  for (const f of scanSources(root)) {
    if (!keep(areaOf(f.file).id) || !f.texts.length) continue;
    out[f.file] = [...new Set(f.texts)].sort();
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** The texts the guard holds against its baseline: without the developer and agent areas and the closed ones */
export function guardedTexts(root) {
  return textsBy(root, (area) => !UNGUARDED.has(area) && !CLOSED_AREAS.has(area));
}

/** The texts the scan finds in the closed areas, by file */
export function closedTexts(root) {
  return textsBy(root, (area) => CLOSED_AREAS.has(area));
}
