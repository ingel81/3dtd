/**
 * The HUD of a manned tower (docs/TOWER_CONTROL.md) shows what the
 * TowerControlService says: the keys before and after the mouse is
 * captured, gold on a target, a white or red marker, the reload ring, and a
 * kick that starts again with every shot.
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { TowerControlHudComponent } from './tower-control-hud.component';
import { TowerControlService, type TowerControlMarker } from '../../services/tower-control.service';

function setup() {
  const control = {
    towerName: signal('Gatling'),
    aiming: signal(false),
    onTarget: signal(false),
    reload: signal(1),
    marker: signal<TowerControlMarker>(null),
    shots: signal(0),
  };
  TestBed.configureTestingModule({ providers: [{ provide: TowerControlService, useValue: control }] });
  const fixture = TestBed.createComponent(TowerControlHudComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const render = () => fixture.detectChanges();
  return { control, el, render };
}

describe('TowerControlHudComponent', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => TestBed.resetTestingModule());

  it('names the tower and the keys, asking for a click until the mouse is captured', () => {
    const { control, el, render } = setup();
    const bar = () => el.querySelector('.tc-bar')!.textContent!.replace(/\s+/g, ' ');
    expect(el.querySelector('.tc-name')!.textContent).toBe('Gatling');
    expect(bar()).toContain('Click the map to aim');
    expect(bar()).not.toContain('fire');
    control.aiming.set(true);
    render();
    expect(bar()).toContain('LMB fire');
    expect(bar()).toContain('RMB zoom');
    expect(bar()).toContain('C / Esc get out');
    expect(bar()).not.toContain('Click the map');
  });

  it('turns the crosshair gold on a target and shows a hit or a kill', () => {
    const { control, el, render } = setup();
    const crosshair = el.querySelector('.tc-crosshair')!;
    expect(crosshair.classList).not.toContain('tc-on-target');
    expect(el.querySelector('.tc-marker')).toBeNull();
    control.onTarget.set(true);
    control.marker.set('hit');
    render();
    expect(crosshair.classList).toContain('tc-on-target');
    expect(el.querySelector('.tc-marker')!.classList).not.toContain('tc-kill');
    control.marker.set('kill');
    render();
    expect(el.querySelector('.tc-marker')!.classList).toContain('tc-kill');
  });

  it('fills the reload ring and hides it once ready', () => {
    const { control, el, render } = setup();
    const ring = el.querySelector<HTMLElement>('.tc-reload')!;
    expect(ring.classList).toContain('tc-ready');
    control.reload.set(0.25);
    render();
    expect(ring.classList).not.toContain('tc-ready');
    expect(ring.style.getPropertyValue('--tc-reload')).toBe('0.25');
  });

  it('starts the kick again with every shot by taking turns between two classes', () => {
    const { control, el, render } = setup();
    const ticks = el.querySelector('.tc-ticks')!;
    const kicks = () => ['tc-kick-a', 'tc-kick-b'].filter((c) => ticks.classList.contains(c));
    expect(kicks()).toEqual([]);
    const seen: string[][] = [];
    for (let shot = 1; shot <= 3; shot++) {
      control.shots.set(shot);
      render();
      seen.push(kicks());
    }
    expect(seen).toEqual([['tc-kick-a'], ['tc-kick-b'], ['tc-kick-a']]);
  });
});
