/**
 * Arrow keys in a radio group or tab list (hero ammo, room options, whose
 * research, map provider): one Tab stop on the choice, the arrows move and
 * choose, skip a disabled item, wrap, and pan no camera behind.
 */
// The directive is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Component, signal } from '@angular/core';
import { getTestBed, TestBed, type ComponentFixture } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { RovingGroupDirective } from './roving-group.directive';

@Component({
  standalone: true,
  imports: [RovingGroupDirective],
  template: `
    <div role="radiogroup" tdRovingGroup aria-label="Ammo">
      @for (choice of choices; track choice) {
        <button type="button" role="radio" [attr.aria-checked]="chosen() === choice"
                [attr.aria-disabled]="choice === 'locked' || null"
                (click)="choice === 'locked' || chosen.set(choice)">{{ choice }}</button>
      }
    </div>
  `,
})
class GroupHost {
  readonly choices = ['ball', 'fire', 'locked', 'frost'];
  readonly chosen = signal('fire');
}

describe('RovingGroupDirective', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => TestBed.resetTestingModule());

  async function open(): Promise<ComponentFixture<GroupHost>> {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(GroupHost);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    document.body.appendChild(fixture.nativeElement);
    return fixture;
  }

  const radios = (f: ComponentFixture<unknown>) =>
    Array.from((f.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  const radio = (f: ComponentFixture<unknown>, label: string) => radios(f).find((r) => r.textContent === label)!;
  const tabStops = (f: ComponentFixture<unknown>) => radios(f).filter((r) => r.tabIndex === 0).map((r) => r.textContent);
  /** Mutation observers report in a microtask */
  const settle = async (f: ComponentFixture<unknown>) => {
    await f.whenStable();
    await Promise.resolve();
  };
  /** A key on an item the keyboard focused (Tab), unless it has the focus already */
  function press(f: ComponentFixture<unknown>, label: string, key: string): KeyboardEvent {
    const item = radio(f, label);
    if (document.activeElement !== item) item.focus();
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    item.dispatchEvent(event);
    return event;
  }

  it('makes the choice the only Tab stop, and moves it with the choice', async () => {
    const fixture = await open();
    expect(tabStops(fixture)).toEqual(['fire']);
    radio(fixture, 'ball').click();
    await settle(fixture);
    expect(tabStops(fixture)).toEqual(['ball']);
  });

  it('chooses the next item with Right and Down, skips a disabled one and wraps', async () => {
    const fixture = await open();
    press(fixture, 'fire', 'ArrowRight');
    await settle(fixture);
    expect(fixture.componentInstance.chosen()).toBe('frost');
    expect(document.activeElement).toBe(radio(fixture, 'frost'));

    press(fixture, 'frost', 'ArrowDown');
    await settle(fixture);
    expect(fixture.componentInstance.chosen()).toBe('ball');
    expect(tabStops(fixture)).toEqual(['ball']);
  });

  it('goes back with Left and Up, to the ends with Home and End', async () => {
    const fixture = await open();
    press(fixture, 'fire', 'ArrowLeft');
    await settle(fixture);
    expect(fixture.componentInstance.chosen()).toBe('ball');
    press(fixture, 'ball', 'ArrowUp');
    await settle(fixture);
    expect(fixture.componentInstance.chosen()).toBe('frost');
    press(fixture, 'frost', 'Home');
    await settle(fixture);
    expect(fixture.componentInstance.chosen()).toBe('ball');
    press(fixture, 'ball', 'End');
    await settle(fixture);
    expect(fixture.componentInstance.chosen()).toBe('frost');
  });

  it('spends the arrows on the group, so no camera pans; other keys pass', async () => {
    const fixture = await open();
    const game = vi.fn();
    window.addEventListener('keydown', game);
    const arrow = press(fixture, 'fire', 'ArrowRight');
    const space = press(fixture, 'frost', ' ');
    window.removeEventListener('keydown', game);

    expect(arrow.defaultPrevented).toBe(true);
    expect(game).toHaveBeenCalledTimes(1);
    expect(game.mock.calls[0][0]).toBe(space);
    expect(space.defaultPrevented).toBe(false);
  });

  it('a radio clicked with the mouse keeps the focus but leaves the arrows to the camera', async () => {
    const fixture = await open();
    const game = vi.fn();
    window.addEventListener('keydown', game);
    const ball = radio(fixture, 'ball');
    ball.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    ball.focus();
    ball.click();
    await settle(fixture);
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    ball.dispatchEvent(arrow);
    await settle(fixture);
    window.removeEventListener('keydown', game);

    expect(fixture.componentInstance.chosen()).toBe('ball');
    expect(arrow.defaultPrevented).toBe(false);
    expect(game).toHaveBeenCalledWith(arrow);

    // Reached by Tab again, the arrows choose
    radio(fixture, 'fire').focus();
    ball.focus();
    press(fixture, 'ball', 'ArrowRight');
    await settle(fixture);
    expect(fixture.componentInstance.chosen()).toBe('fire');
  });
});
