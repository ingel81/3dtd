/**
 * The field tip under the boot panel: its parts as text, an accent as a
 * coloured <b>, without a space the template adds (tipstyle, the accents
 * lost to the HTML sanitizer). LoadingScreenComponent with its real
 * template, read from disk (the vitest build has no templateUrl loader).
 * Not covered: the colours themselves (styles).
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { LoadingScreenComponent } from './loading-screen.component';
import { FIELD_TIPS } from './field-tips';

const template = readFileSync(resolve('src/app/components/loading-screen/loading-screen.component.html'), 'utf8');

describe('Field tip on the loading screen', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('shows the tip word for word, its accents in gold and teal', () => {
    const last = FIELD_TIPS.length - 1;
    // The screen starts on a random tip: the last one, the selling tip
    vi.spyOn(Math, 'random').mockReturnValue(last / FIELD_TIPS.length);
    TestBed.configureTestingModule({});
    TestBed.overrideComponent(LoadingScreenComponent, {
      set: { template, templateUrl: undefined, styleUrl: undefined, styles: [] },
    });
    const fixture = TestBed.createComponent(LoadingScreenComponent);
    fixture.detectChanges();

    const accent = (fixture.nativeElement as HTMLElement).querySelector('.td-loading__tip-body b')!;
    const text = accent.parentElement!;
    expect(text.textContent).toBe(FIELD_TIPS[last].parts.map((part) => part.text).join(''));
    expect([accent.className, accent.textContent]).toEqual(['tip-gold', '75%']);
    fixture.destroy();
  });
});
