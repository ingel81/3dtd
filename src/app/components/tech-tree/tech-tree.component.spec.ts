// Material's tooltip is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { beforeAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, Input, input } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TechTreeComponent } from './tech-tree.component';
import type { TechTreeNode } from './tech-tree-view';
import type { DagEdge } from '../../utils/dag-layout';

// templateUrl is not resolved under the JIT compiler, so the template comes
// from disk and the icon is a stub (reference-dialogs.scenario.spec.ts).
const template = readFileSync(resolve('src/app/components/tech-tree/tech-tree.component.html'), 'utf8');

@Component({ selector: 'td-icon', standalone: true, template: '' })
class IconStub {
  readonly name = input('');
  readonly size = input(16);
}
// The @Input annotation the JIT transform adds for input(). Needed on the
// component under test too: overrideComponent recompiles it from the metadata
// below, and a signal input without the annotation never receives setInput().
for (const name of ['name', 'size']) {
  Input({ alias: name, isSignal: true } as Input)(IconStub.prototype, name);
}
for (const name of ['nodes', 'edges', 'orientation', 'label']) {
  Input({ alias: name, isSignal: true } as Input)(TechTreeComponent.prototype, name);
}

beforeAll(() => {
  getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
});

const NODES: TechTreeNode[] = [
  { id: 'root', title: 'Gatling Technology', subtitle: '400 · 15s', state: 'completed' },
  { id: 'running', title: 'Siege Engineering', state: 'active', progress: 0.5 },
  { id: 'waiting', title: 'Rocketry', state: 'queued', badge: '1' },
  { id: 'shut', title: 'Chaos Rift', state: 'locked', hint: 'Requires: Storm Mastery' },
];
const EDGES: DagEdge[] = [
  { from: 'root', to: 'running' },
  { from: 'running', to: 'waiting' },
  { from: 'running', to: 'shut' },
];

function render(nodes = NODES, edges = EDGES) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  TestBed.overrideComponent(TechTreeComponent, {
    set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [IconStub, MatTooltipModule] },
  });
  const fixture = TestBed.createComponent(TechTreeComponent);
  fixture.componentRef.setInput('nodes', nodes);
  fixture.componentRef.setInput('edges', edges);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  return { fixture, host, buttons: [...host.querySelectorAll('button.td-tech-node')] as HTMLButtonElement[] };
}

describe('TechTreeComponent', () => {
  it('draws one button per node and one path per edge', () => {
    const { host, buttons } = render();
    expect(buttons).toHaveLength(NODES.length);
    expect(host.querySelectorAll('path.td-tech-edge')).toHaveLength(EDGES.length);
  });

  it('positions every node from the layout, never from the markup order', () => {
    const { buttons } = render();
    // Top down: the root sits on the first level, everything else below it.
    const top = (b: HTMLButtonElement) => Number.parseFloat(b.style.top);
    expect(top(buttons[0])).toBe(0);
    expect(top(buttons[1])).toBeGreaterThan(top(buttons[0]));
    expect(buttons.every((b) => b.style.width && b.style.height)).toBe(true);
  });

  it('carries the state in the class and in the spoken label', () => {
    const { buttons } = render();
    expect(buttons[0].className).toContain('td-state-completed');
    expect(buttons[0].getAttribute('aria-label')).toBe('Gatling Technology, researched');
    expect(buttons[1].getAttribute('aria-label')).toBe('Siege Engineering, in progress, 50 percent');
    expect(buttons[2].getAttribute('aria-label')).toBe('Rocketry, queued, position 1');
    expect(buttons[3].getAttribute('aria-label')).toBe('Chaos Rift, locked, Requires: Storm Mastery');
  });

  it('reports every click and leaves the decision to whoever listens', () => {
    // No node is disabled: the caller decides what a click means, and a
    // locked one still has to be able to say why it is locked.
    const { fixture, buttons } = render();
    const seen: string[] = [];
    fixture.componentInstance.nodeActivated.subscribe((id) => seen.push(id));
    for (const button of buttons) button.click();
    expect(buttons.every((b) => !b.disabled)).toBe(true);
    expect(seen).toEqual(['root', 'running', 'waiting', 'shut']);
  });

  it('tells the listener which node the pointer reached, and when it left', () => {
    const { fixture, host, buttons } = render();
    const seen: (string | null)[] = [];
    fixture.componentInstance.nodeFocused.subscribe((id) => seen.push(id));
    buttons[1].dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
    host.querySelector('.td-tech-tree')!.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }));
    expect(seen).toEqual(['running', null]);
  });

  it('emits the id of the node that was activated', () => {
    const { fixture, buttons } = render();
    const seen: string[] = [];
    fixture.componentInstance.nodeActivated.subscribe((id) => seen.push(id));
    buttons.find((b) => b.getAttribute('aria-label')!.startsWith('Rocketry'))!.click();
    expect(seen).toEqual(['waiting']);
  });

  it('draws the progress bar only while a node is active', () => {
    const { host } = render();
    const bars = [...host.querySelectorAll('.td-tech-node-bar i')] as HTMLElement[];
    expect(bars).toHaveLength(1);
    expect(bars[0].style.width).toBe('50%');
  });

  it('renders nothing but the empty frame for an empty tree', () => {
    const { host, buttons } = render([], []);
    expect(buttons).toHaveLength(0);
    expect(host.querySelectorAll('path.td-tech-edge')).toHaveLength(0);
  });
});
