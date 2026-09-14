/**
 * Playtest 321 (night 2, docs/REVIEW_SPRINT_2026-09-14.md): O (photo mode)
 * hides the ability bar with the rest of the HUD, O or Esc brings it back.
 *
 * The keys are hotkey.service.spec.ts ("O turns it on and off and takes the
 * key", "Esc leaves it before it closes a menu"): they switch
 * PhotoModeService, whose state is UIStore.photoMode. What hides the bar is
 * the component's stylesheet under `.td-photo-mode`, a class the template
 * binds to that state. This takes both as they ship: the template parsed by
 * the Angular compiler into the element tree the browser gets (control flow
 * opens no element of its own), the SCSS compiled by the sass of the build,
 * and jsdom's computed style with the class on and off. Every branch of the
 * control flow is in the tree at once, which changes no parent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BindingType, parseTemplate, TmplAstBoundAttribute, TmplAstElement } from '@angular/compiler';

// vitest runs from the project root; import.meta.url is no file URL under jsdom
const TEMPLATE = resolve(process.cwd(), 'src/app/tower-defense.component.html');
const STYLES = resolve(process.cwd(), 'src/app/tower-defense.component.scss');

/** The sass the Angular build compiles component styles with */
function compileScss(path: string): string {
  const projectRequire = createRequire(resolve(process.cwd(), 'package.json'));
  const buildRequire = createRequire(projectRequire.resolve('@angular/build/package.json'));
  const sass = buildRequire('sass') as { compile(path: string): { css: string } };
  return sass.compile(path).css;
}

/** Elements of the parsed template under `parent`, blocks (@if, @defer, ...) unwrapped */
function build(nodes: readonly unknown[], parent: Element): void {
  for (const node of nodes) {
    if (node instanceof TmplAstElement) {
      const element = document.createElement(node.name);
      for (const attribute of node.attributes) element.setAttribute(attribute.name, attribute.value);
      parent.appendChild(element);
      build(node.children, element);
      continue;
    }
    const block = node as Record<string, unknown>;
    for (const key of ['children', 'branches', 'cases', 'empty', 'placeholder', 'loading', 'error']) {
      const inner = block[key];
      if (Array.isArray(inner)) build(inner, parent);
      else if (inner && typeof inner === 'object') build([inner], parent);
    }
  }
}

describe('Photo mode hides the ability bar, playtest 321', () => {
  let host: HTMLElement;
  let style: HTMLStyleElement;
  let rootNodes: readonly unknown[];

  beforeAll(() => {
    const parsed = parseTemplate(readFileSync(TEMPLATE, 'utf8'), TEMPLATE, { preserveWhitespaces: false });
    expect(parsed.errors ?? []).toEqual([]);
    rootNodes = parsed.nodes;
    host = document.createElement('app-tower-defense');
    build(rootNodes, host);
    document.body.appendChild(host);
    style = document.createElement('style');
    style.textContent = compileScss(STYLES);
    document.head.appendChild(style);
  });

  afterAll(() => {
    host.remove();
    style.remove();
  });

  const container = () => host.querySelector('.td-container')!;
  const display = (selector: string): string => {
    const element = host.querySelector(selector);
    expect(element, selector).not.toBeNull();
    return getComputedStyle(element!).display;
  };

  it('321: the bar sits in the canvas area among the overlays', () => {
    expect(host.querySelector('app-ability-bar')!.parentElement!.classList.contains('td-canvas-area')).toBe(true);
  });

  it('321: the container carries the class while photo mode is on', () => {
    const root = rootNodes.find((n): n is TmplAstElement => n instanceof TmplAstElement)!;
    const binding = root.inputs.find((i: TmplAstBoundAttribute) => i.type === BindingType.Class && i.name === 'td-photo-mode');
    expect(root.attributes.find((a) => a.name === 'class')?.value).toBe('td-container');
    expect((binding?.value as { source?: string } | undefined)?.source?.trim()).toBe('photoMode.active()');
  });

  it('321: in photo mode the bar goes with header, sidebar and overlays; canvas, map credits and photo bar stay', () => {
    container().classList.add('td-photo-mode');
    expect(display('app-ability-bar')).toBe('none');
    expect(display('app-game-header')).toBe('none');
    expect(display('app-game-sidebar')).toBe('none');
    expect(display('app-quick-actions')).toBe('none');
    expect(display('app-info-overlay')).toBe('none');
    expect(display('canvas')).not.toBe('none');
    expect(display('.td-map-attribution')).not.toBe('none');
    expect(display('.td-photo-bar')).not.toBe('none');
  });

  it('321: once photo mode ends (O or Esc) the bar shows again', () => {
    container().classList.add('td-photo-mode');
    expect(display('app-ability-bar')).toBe('none');
    container().classList.remove('td-photo-mode');
    expect(display('app-ability-bar')).not.toBe('none');
    expect(display('app-game-header')).not.toBe('none');
  });
});
