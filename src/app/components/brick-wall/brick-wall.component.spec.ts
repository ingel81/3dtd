/**
 * The loading wall: running bond in three courses, a brick per piece of
 * progress laid bottom left to top right, the last one marked, and a
 * progressbar for screen readers.
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Input } from '@angular/core';
import { getTestBed, TestBed, type ComponentFixture } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { BrickWallComponent, WALL_BRICKS, WALL_COURSES, bricksLaid } from './brick-wall.component';

for (const name of ['value', 'label', 'size']) {
  Input({ alias: name, required: name !== 'size', isSignal: true } as Input)(BrickWallComponent.prototype, name);
}

describe('bricksLaid', () => {
  it('lays a brick per piece of the way, all of them at 100', () => {
    expect(WALL_BRICKS).toBe(31);
    expect(bricksLaid(0)).toBe(0);
    expect(bricksLaid(50)).toBe(15);
    expect(bricksLaid(99)).toBe(30);
    expect(bricksLaid(100)).toBe(31);
  });

  it('keeps out-of-range shares on the wall', () => {
    expect(bricksLaid(-5)).toBe(0);
    expect(bricksLaid(140)).toBe(31);
  });
});

describe('the wall in running bond', () => {
  it('has three courses, the middle one a brick longer for its two halves', () => {
    expect(WALL_COURSES.map((course) => course.length)).toEqual([10, 11, 10]);
  });

  it('numbers the bricks bottom left to top right', () => {
    expect(WALL_COURSES.flat().map((brick) => brick.index)).toEqual(Array.from({ length: 31 }, (_, i) => i));
  });

  it('varies the tone of neighbours, so no course reads as a ruled grid', () => {
    for (const course of WALL_COURSES) {
      const tones = new Set(course.map((brick) => brick.tone));
      expect(tones.size).toBe(3);
    }
  });
});

describe('BrickWallComponent', () => {
  let fixture: ComponentFixture<BrickWallComponent>;

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(BrickWallComponent);
    set({ value: 0, label: 'Loading the place' });
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  function set(values: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(values)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  }
  const el = () => fixture.nativeElement as HTMLElement;
  const bricks = () => [...el().querySelectorAll('i')];

  it('is a named progressbar', () => {
    set({ value: 42.4 });
    expect(el().classList).toContain('td-wall');
    expect(el().getAttribute('role')).toBe('progressbar');
    expect(el().getAttribute('aria-label')).toBe('Loading the place');
    expect(el().getAttribute('aria-valuemin')).toBe('0');
    expect(el().getAttribute('aria-valuemax')).toBe('100');
    expect(el().getAttribute('aria-valuenow')).toBe('42');
  });

  it('lays the bricks in order and marks the one laid last', () => {
    expect(bricks()).toHaveLength(31);
    expect(el().querySelectorAll('.is-on')).toHaveLength(0);
    expect(el().querySelector('.is-last')).toBeNull();

    set({ value: 50 });
    const on = bricks().map((b) => b.classList.contains('is-on'));
    expect(on.indexOf(false)).toBe(15);
    expect(on.slice(15).every((x) => !x)).toBe(true);
    expect(el().querySelectorAll('.is-last')).toHaveLength(1);
    expect(bricks()[14].classList).toContain('is-last');

    set({ value: 100 });
    expect(el().querySelectorAll('.is-on')).toHaveLength(31);
    expect(bricks()[30].classList).toContain('is-last');
  });

  it('keeps a brick tone beside its state', () => {
    set({ value: 100 });
    expect(bricks()[1].className.split(' ').sort()).toEqual(['is-light', 'is-on']);
  });

  it('sets the low wall with size sm', () => {
    expect(el().classList).not.toContain('is-sm');
    set({ size: 'sm' });
    expect(el().classList).toContain('is-sm');
  });
});
