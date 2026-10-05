/**
 * The rich tooltip: opens on hover after the show delay, follows its data
 * while open, closes on Escape and keeps that Escape from the game. The card
 * draws banners and list sections (the NEXT card of the WAVE panel). Real
 * template read from disk, icons are stubs.
 */
// The components are partially compiled and need the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, Input, input, signal } from '@angular/core';
import { getTestBed, TestBed, type ComponentFixture } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { TdRichTooltipDirective } from './td-rich-tooltip.directive';
import { TdTooltipContentComponent } from './td-tooltip-content.component';
import type { TdTooltipData } from './tooltip-data.types';

const template = readFileSync(resolve('src/app/components/tooltip/td-tooltip-content.component.html'), 'utf8');

@Component({ selector: 'td-icon', standalone: true, template: '' })
class IconStub {
  readonly name = input('');
  readonly size = input(16);
}
for (const name of ['name', 'size']) Input({ alias: name, isSignal: true } as Input)(IconStub.prototype, name);
Input({ alias: 'data', isSignal: true, required: true } as Input)(TdTooltipContentComponent.prototype, 'data');
for (const name of ['tdRichTooltip', 'tdRichTooltipPosition', 'tdRichTooltipDisabled']) {
  Input({ alias: name, isSignal: true } as Input)(TdRichTooltipDirective.prototype, name);
}

@Component({
  standalone: true,
  imports: [TdRichTooltipDirective],
  template: `<button type="button" [tdRichTooltip]="data()" [tdRichTooltipDisabled]="disabled()">Host</button>`,
})
class HostComponent {
  readonly data = signal<TdTooltipData | null>({ title: 'Ready' });
  readonly disabled = signal(false);
}

describe('Rich tooltip', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    document.body.querySelectorAll('.cdk-overlay-container').forEach((c) => c.remove());
  });

  function open(): ComponentFixture<HostComponent> {
    TestBed.configureTestingModule({});
    TestBed.overrideComponent(TdTooltipContentComponent, {
      set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [IconStub] },
    });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    host(fixture).dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(250);
    fixture.detectChanges();
    return fixture;
  }

  const host = (f: ComponentFixture<unknown>) => (f.nativeElement as HTMLElement).querySelector('button')!;
  const card = () => document.querySelector('.cdk-overlay-container .td-tooltip');
  const title = () => card()?.querySelector('.td-tooltip__title')?.textContent?.trim() ?? null;

  it('opens after the show delay', () => {
    const fixture = open();
    expect(title()).toBe('Ready');
    host(fixture).dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(100);
    expect(card()).toBeNull();
  });

  it('follows its data while open: new data redraws, null closes', () => {
    const fixture = open();
    fixture.componentInstance.data.set({ title: 'Recharges in 2 waves' });
    fixture.detectChanges();
    expect(title()).toBe('Recharges in 2 waves');

    fixture.componentInstance.data.set(null);
    fixture.detectChanges();
    expect(card()).toBeNull();
  });

  it('closes when its host disables it', () => {
    const fixture = open();
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    expect(card()).toBeNull();
  });

  it('closes on Escape and keeps that Escape from the game', () => {
    open();
    const game = vi.fn();
    window.addEventListener('keydown', game);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(escape);
    window.removeEventListener('keydown', game);

    expect(card()).toBeNull();
    expect(escape.defaultPrevented).toBe(true);
    expect(game).not.toHaveBeenCalled();

    // Closed, the next Escape is the game's again
    const again = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(again);
    expect(again.defaultPrevented).toBe(false);
  });

  it('draws banners and list sections with dots, values, chips and notes', () => {
    const fixture = open();
    fixture.componentInstance.data.set({
      title: 'Mammoth Siege',
      category: 'Wave 14',
      banners: [{ icon: 'bolt', text: 'Swift: Enemies move faster.', tone: 'danger' }],
      sections: [
        {
          title: 'Enemies',
          aside: 'HQ each',
          rows: [{ label: '6× Mammoth', detail: 'Fortified', color: '#5A6258', value: '−6.8', note: 'Regenerates' }],
        },
        {
          title: 'Weak to',
          rows: [{ label: 'Fortified', color: '#5A6258', chips: [{ icon: 'burst', label: 'Siege', color: '#fff' }] }],
        },
      ],
    });
    fixture.detectChanges();

    const banner = card()!.querySelector('.td-tooltip__banner')!;
    expect(banner.classList).toContain('td-tooltip__banner--danger');
    expect(banner.textContent).toContain('Swift: Enemies move faster.');

    const sections = Array.from(card()!.querySelectorAll('.td-tooltip__section'));
    expect(sections.map((s) => s.querySelector('h4 span')!.textContent)).toEqual(['Enemies', 'Weak to']);
    expect(sections[0].querySelector('h4 .aside')!.textContent).toBe('HQ each');
    const enemy = sections[0].querySelector('.td-tooltip__row')!;
    expect(enemy.querySelector('.dot')).not.toBeNull();
    expect(enemy.querySelector('.row-label')!.textContent).toBe('6× Mammoth');
    expect(enemy.querySelector('.row-detail')!.textContent).toBe('Fortified');
    expect(enemy.querySelector('.row-value')!.textContent).toBe('−6.8');
    expect(enemy.querySelector('.row-note')!.textContent).toBe('Regenerates');
    expect(sections[1].querySelector('.chip')!.textContent!.trim()).toBe('Siege');
  });
});
