/**
 * The rich tooltip (tower and enemy cards) opens 200 ms after the pointer or
 * the focus came, closes 80 ms after it left, stays when it comes back in
 * between, never opens without data or while disabled, and goes on a click
 * outside its host, not on one inside.
 */
// CDK pulls in partially compiled Angular code, which needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElementRef, Injector, runInInjectionContext, signal } from '@angular/core';
import { Overlay, OverlayPositionBuilder, ScrollStrategyOptions } from '@angular/cdk/overlay';
import { TdRichTooltipDirective } from './td-rich-tooltip.directive';
import { TdTooltipContentComponent } from './td-tooltip-content.component';
import type { TdTooltipData } from './tooltip-data.types';

const DATA = { title: 'Gatling' } as unknown as TdTooltipData;

describe('TdRichTooltipDirective', () => {
  let host: HTMLElement;
  let opened: { attached: unknown; data: unknown; disposed: boolean }[];

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('button');
    document.body.appendChild(host);
    opened = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    host.remove();
  });

  /** The directive on `host`, built by hand: its signal inputs need the AOT compiler */
  function tooltip(data: TdTooltipData | null = DATA, disabled = false) {
    const strategy = { withPositions: () => strategy, withFlexibleDimensions: () => strategy, withPush: () => strategy };
    const overlay = {
      create: () => {
        const entry = { attached: null as unknown, data: null as unknown, disposed: false };
        opened.push(entry);
        return {
          attach: (portal: { component: unknown }) => {
            entry.attached = portal.component;
            return { setInput: (_: string, value: unknown) => (entry.data = value) };
          },
          dispose: () => (entry.disposed = true),
        };
      },
    };
    const injector = Injector.create({
      providers: [
        { provide: Overlay, useValue: overlay },
        { provide: OverlayPositionBuilder, useValue: { flexibleConnectedTo: () => strategy } },
        { provide: ScrollStrategyOptions, useValue: { reposition: () => ({}) } },
        { provide: ElementRef, useValue: new ElementRef(host) },
      ],
    });
    const directive = runInInjectionContext(injector, () => new TdRichTooltipDirective());
    const inputs = directive as unknown as Record<string, unknown>;
    inputs['tdRichTooltip'] = signal(data);
    inputs['tdRichTooltipPosition'] = signal('left');
    inputs['tdRichTooltipDisabled'] = signal(disabled);
    return directive;
  }

  it('opens the card with its data 200 ms after the pointer came, and closes it 80 ms after it left', () => {
    const tip = tooltip();
    tip.onShow();
    vi.advanceTimersByTime(199);
    expect(opened).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(opened).toEqual([{ attached: TdTooltipContentComponent, data: DATA, disposed: false }]);
    tip.onHide();
    vi.advanceTimersByTime(79);
    expect(opened[0].disposed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(opened[0].disposed).toBe(true);
  });

  it('opens nothing when the pointer leaves before the delay, and keeps the card when it comes back in time', () => {
    const tip = tooltip();
    tip.onShow();
    vi.advanceTimersByTime(100);
    tip.onHide();
    vi.advanceTimersByTime(500);
    expect(opened).toHaveLength(0);

    tip.onShow();
    vi.advanceTimersByTime(200);
    tip.onHide();
    vi.advanceTimersByTime(40);
    tip.onShow();
    vi.advanceTimersByTime(500);
    expect(opened).toHaveLength(1);
    expect(opened[0].disposed).toBe(false);
  });

  it('opens nothing without data or while disabled', () => {
    for (const tip of [tooltip(null), tooltip(DATA, true)]) {
      tip.onShow();
      vi.advanceTimersByTime(500);
    }
    expect(opened).toHaveLength(0);
  });

  it('closes on a click outside its host, not on one inside, and on destroy', () => {
    const tip = tooltip();
    tip.onShow();
    vi.advanceTimersByTime(200);
    const inside = new MouseEvent('click');
    Object.defineProperty(inside, 'target', { value: host });
    tip.onHide(inside);
    vi.advanceTimersByTime(200);
    expect(opened[0].disposed).toBe(false);
    const outside = new MouseEvent('click');
    Object.defineProperty(outside, 'target', { value: document.body });
    tip.onHide(outside);
    vi.advanceTimersByTime(80);
    expect(opened[0].disposed).toBe(true);

    const again = tooltip();
    again.onShow();
    vi.advanceTimersByTime(200);
    again.ngOnDestroy();
    expect(opened[1].disposed).toBe(true);
  });
});
