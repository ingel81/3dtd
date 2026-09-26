// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Input } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { RunChartsComponent } from './run-charts.component';
import type { WaveSeriesPoint } from '../../run-log/wave-series';

const template = readFileSync(resolve('src/app/components/run-charts/run-charts.component.html'), 'utf8');
// The @Input annotations the JIT transform adds for input(); plain vitest runs without it
Input({ alias: 'points', required: true, isSignal: true } as Input)(RunChartsComponent.prototype, 'points');
Input({ alias: 'players', required: true, isSignal: true } as Input)(RunChartsComponent.prototype, 'players');

const point = (wave: number, ann: number, bob: number, hq: number): WaveSeriesPoint => ({
  wave,
  hqHealth: hq,
  players: {
    ann: { kills: ann, towers: 1, goldEarned: ann * 10 },
    bob: { kills: bob, towers: 2, goldEarned: bob * 10 },
  },
});

describe('RunChartsComponent (TODO E46)', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    TestBed.overrideComponent(RunChartsComponent, {
      set: { template, templateUrl: undefined, styleUrl: undefined, styles: [] },
    });
  });

  function render(points: WaveSeriesPoint[], players = [
    { id: 'ann', name: 'Ann', color: '#ef4444' },
    { id: 'bob', name: 'Bob', color: '#f97316' },
  ]) {
    const fixture = TestBed.createComponent(RunChartsComponent);
    fixture.componentRef.setInput('points', points);
    fixture.componentRef.setInput('players', players);
    fixture.detectChanges();
    return fixture;
  }

  it('draws kills, towers, gold and the HQ, one line per player, the lanes told apart by line style too', () => {
    const fixture = render([point(1, 5, 2, 500), point(2, 12, 9, 480), point(3, 20, 30, 300)]);
    const charts = fixture.componentInstance.charts();

    expect(charts.map((c) => c.title)).toEqual(['Kills', 'Towers', 'Gold earned', 'HQ health']);
    expect(charts[0].top).toBe(30);
    expect(charts[0].lines.map((l) => l.dash)).toEqual([null, '6 3']);
    expect(charts[3].lines).toHaveLength(1);
    expect(charts[0].hovers[2].label).toBe('Wave 3: Ann 20, Bob 30');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.run-chart')).toHaveLength(4);
    expect(el.querySelectorAll('.run-charts-legend li')).toHaveLength(2);
  });

  it('needs two waves to draw a line, and names no one alone', () => {
    expect((render([point(1, 1, 1, 500)]).nativeElement as HTMLElement).querySelector('.run-charts')).toBeNull();
    const alone = render([point(1, 1, 1, 500), point(2, 4, 1, 500)], [{ id: 'ann', name: 'You', color: 'gold' }]);
    expect((alone.nativeElement as HTMLElement).querySelector('.run-charts-legend')).toBeNull();
    expect(alone.componentInstance.charts()[0].hovers[1].label).toBe('Wave 2: 4');
  });
});
