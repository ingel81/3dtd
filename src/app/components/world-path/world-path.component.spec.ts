import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Input } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { WorldPathComponent, type PathAction } from './world-path.component';

// The @Input annotation the JIT transform adds for input()
for (const name of ['world', 'worldHere', 'mode', 'modes', 'playLabel', 'editLabel', 'playWhy', 'editWhy', 'playHint', 'editHint', 'worldsHint', 'worldHint', 'chips']) {
  Input({ alias: name, isSignal: true } as Input)(WorldPathComponent.prototype, name);
}

/** The path over game and editor (docs/WORLDS_NAVIGATION_PLAN.md, 3.4) */
describe('WorldPathComponent', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => TestBed.resetTestingModule());

  function render(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(WorldPathComponent);
    for (const [name, value] of Object.entries({ world: 'Maps', mode: 'play', ...inputs })) fixture.componentRef.setInput(name, value);
    const went: PathAction[] = [];
    fixture.componentInstance.go.subscribe((action) => went.push(action));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (test: string) => el.querySelector<HTMLButtonElement>(`[data-test="${test}"]`)!;
    return { fixture, el, button, went };
  }

  it('reads Worlds, the world, then Play and Edit; each step is a button', () => {
    const { el, button, went } = render();
    expect([...el.querySelectorAll('button, .wp-sep')].map((e) => e.textContent!.trim())).toEqual(['Worlds', '›', 'Maps', '›', 'Play', 'Edit']);
    button('path-worlds').click();
    button('path-world').click();
    button('path-edit').click();
    // Play is where the window is: nothing to go to
    button('path-play').click();
    expect(went).toEqual(['worlds', 'world', 'edit']);
    expect(button('path-play').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps a blocked way visible, marked and inert', () => {
    const { button, went } = render({ editWhy: 'Leave the coop room to edit', editLabel: 'Make map' });
    expect(button('path-edit').textContent!.trim()).toBe('Make map');
    expect(button('path-edit').getAttribute('aria-disabled')).toBe('true');
    button('path-edit').click();
    expect(went).toEqual([]);
  });

  it('on the globes ends at Worlds, or at the world with nothing picked, and offers no Play or Edit there', () => {
    const globes = render({ world: null, modes: false });
    expect([...globes.el.querySelectorAll('button')].map((e) => e.textContent!.trim())).toEqual(['Worlds']);
    expect(globes.button('path-worlds').getAttribute('aria-current')).toBe('page');
    TestBed.resetTestingModule();
    const menu = render({ world: 'Maps', worldHere: true, modes: false });
    expect([...menu.el.querySelectorAll('button, .wp-sep')].map((e) => e.textContent!.trim())).toEqual(['Worlds', '›', 'Maps']);
    expect(menu.button('path-world').getAttribute('aria-current')).toBe('page');
  });

  it('shows the chips of what waits elsewhere, a click goes there', () => {
    const { el, went } = render({ mode: 'edit', chips: [{ id: 'run', label: 'Bay | wave 4 | autosave', hint: 'Back to the run' }] });
    const chip = el.querySelector<HTMLButtonElement>('[data-chip="run"]')!;
    expect(chip.textContent!.trim()).toBe('Bay | wave 4 | autosave');
    chip.click();
    expect(went).toEqual([{ chip: 'run' }]);
  });
});
