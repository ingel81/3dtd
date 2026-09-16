/**
 * Logic of playtest 160 of night 1 (docs/archive/REVIEW_SPRINT_2026-09-13.md)
 * replayed: "Damage vs armor" opens the matrix, Esc closes it and the focus
 * goes back to the button; from the tower panel the tower's row is marked;
 * a double click opens one dialog (8b82e2e3, the reference dialogs as one
 * lazy chunk).
 *
 * The real MatDialog in a TestBed with animations off, the real opener
 * openDamageMatrixDialog and its lazy import of reference-dialogs, the real
 * DamageMatrixDialogComponent with its template read from disk. H and
 * Attributions open theirs through the same lazyDialog (hotkey.service.spec.ts
 * "H opens the shortcut overview", lazy-dialog.spec.ts). Not covered: the
 * transitions and fonts (visible only), and a double click on a later open,
 * when the chunk is cached and the second click may land on the backdrop.
 */
// Material's dialog is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, Input, input } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { ResearchStore } from '../../store/research.store';
import { DamageMatrixDialogComponent } from './damage-matrix-dialog.component';
import { openDamageMatrixDialog } from './open-damage-matrix-dialog';
import { buildDamageMatrixRows } from './damage-matrix-table';

const template = readFileSync(resolve('src/app/components/damage-matrix-dialog/damage-matrix-dialog.component.html'), 'utf8');

@Component({ selector: 'td-icon', standalone: true, template: '' })
class IconStub {
  readonly name = input('');
  readonly size = input(16);
}
// The @Input annotation the JIT transform adds for input() (see world-map.scenario.spec.ts)
for (const name of ['name', 'size']) {
  Input({ alias: name, isSignal: true } as Input)(IconStub.prototype, name);
}

describe('Damage vs armor, logic of playtest 160 (night 1) replayed', () => {
  let dialog: MatDialog;
  let trigger: HTMLButtonElement;

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ResearchStore, useValue: { isTowerUnlocked: () => true } },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    TestBed.overrideComponent(DamageMatrixDialogComponent, {
      set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [MatDialogModule, IconStub] },
    });
    dialog = TestBed.inject(MatDialog);
    // The button the player clicked, focused as a click leaves it
    trigger = document.createElement('button');
    trigger.textContent = 'Damage vs armor';
    document.body.appendChild(trigger);
    trigger.focus();
  });

  afterEach(() => {
    dialog.closeAll();
    trigger.remove();
    TestBed.resetTestingModule();
  });

  const overlay = () => document.querySelector('.cdk-overlay-container') as HTMLElement;
  /** Let the lazy import, the open and change detection run */
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((done) => setTimeout(done, 0));
      TestBed.tick();
    }
  };
  const pressEscape = () => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    // The CDK overlay reads the legacy keyCode
    Object.defineProperty(event, 'keyCode', { get: () => 27 });
    document.body.dispatchEvent(event);
  };

  it('from the tower panel: one dialog for a double click, the tower\'s row marked, Esc closes and gives the focus back', async () => {
    // The second click comes while the chunk still loads
    const first = openDamageMatrixDialog(dialog, 'archer');
    const second = openDamageMatrixDialog(dialog, 'archer');
    expect(await second).toBe(await first);
    await settle();
    expect(dialog.openDialogs).toHaveLength(1);

    const marked = overlay().querySelectorAll('tr.current');
    expect(marked).toHaveLength(1);
    expect(marked[0].getAttribute('aria-current')).toBe('true');
    const archer = buildDamageMatrixRows(() => true).find((row) => row.towerId === 'archer')!;
    expect(marked[0].querySelector('.tower-name')!.textContent!.trim()).toBe(archer.name);
    // The dialog took the focus
    expect(overlay().contains(document.activeElement)).toBe(true);

    pressEscape();
    await settle();
    expect(dialog.openDialogs).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);
  });

  it('from the build panel: no row is marked', async () => {
    await openDamageMatrixDialog(dialog);
    await settle();
    expect(dialog.openDialogs).toHaveLength(1);
    expect(overlay().querySelectorAll('tr.tower-row').length).toBeGreaterThan(0);
    expect(overlay().querySelectorAll('tr.current')).toHaveLength(0);
  });
});
