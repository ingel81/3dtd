/**
 * The map picker of the menu's New game page: own and shipped maps with
 * picture, name and facts, Play and Edit, the map played now, the own
 * tilesets of the config, an empty own list, the warning for a run under
 * way. Real template read from disk; icons are a stub, the worlds a fake
 * (WorldChoiceService has its own spec).
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, Input, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { getTestBed, TestBed, type ComponentFixture } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { GameStore } from '../../../../store/game.store';
import type { MapSummary } from '../../../../world/custom-map/map-store';
import { parseOwnTilesets } from '../../../../world/tileset/own-tileset';
import { WorldChoiceService, type MapChoices } from '../../../../world/world-choice.service';
import type { WorldRef } from '../../../../world/world-ref';
import { MapPickerComponent } from './map-picker.component';

const template = readFileSync(resolve('src/app/components/main-menu/pages/new-game/map-picker.component.html'), 'utf8');

@Component({ selector: 'td-icon', standalone: true, template: '' })
class IconStub {
  readonly name = input('');
  readonly size = input(16);
}
for (const name of ['name', 'size']) Input({ alias: name, isSignal: true } as Input)(IconStub.prototype, name);

const summary = (s: Partial<MapSummary> & { id: string; name: string }): MapSummary => ({
  author: '', description: '', width: 0, depth: 0, updatedAt: '', origin: 'own', contentHash: '', objects: 0, spawns: 0, ...s,
});
const OWN = summary({ id: 'bay', name: 'My bay', author: 'Ann', width: 1024, depth: 512, spawns: 3, biome: 'desert' });
const SHIPPED = summary({ id: 'demo-valley', name: 'Demo Valley', author: '3DTD', width: 512, depth: 512, spawns: 2, biome: 'temperate', origin: 'shipped' });
const TILESET = parseOwnTilesets([{ id: 'synth', name: 'Test ground', attribution: 'City survey', url: 'http://t/tileset.json', center: { lat: 48, lon: 9 }, radiusM: 1400 }])[0];

describe('Map picker of New game', () => {
  let worlds: {
    listMaps: ReturnType<typeof vi.fn>;
    playMap: ReturnType<typeof vi.fn>;
    playTileset: ReturnType<typeof vi.fn>;
    isCurrent: (ref: WorldRef) => boolean;
    editUrl: (id: string) => string;
    editorUrl: () => string;
    tilesets: ReturnType<typeof signal<readonly unknown[]>>;
  };

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => TestBed.resetTestingModule());

  async function open(setup: { maps?: MapChoices; current?: string; tilesets?: boolean; underWay?: boolean } = {}) {
    worlds = {
      listMaps: vi.fn(async () => setup.maps ?? {
        own: [{ summary: OWN, picture: 'blob:bay' }],
        shared: [{ summary: { ...OWN, id: 'hosted', name: 'Ann\'s map', origin: 'shared' }, picture: null }],
        shipped: [{ summary: SHIPPED, picture: 'maps/demo-valley.png' }],
      }),
      playMap: vi.fn(),
      playTileset: vi.fn(),
      isCurrent: (ref) => ref.kind === 'custom-map' && ref.mapId === setup.current,
      editUrl: (id) => `http://x/editor?map=${id}`,
      editorUrl: () => 'http://x/editor',
      tilesets: signal(setup.tilesets ? [TILESET] : []),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: WorldChoiceService, useValue: worlds },
        { provide: GameStore, useValue: { gameStarted: signal(!!setup.underWay), towerCount: signal(0) } },
      ],
    });
    TestBed.overrideComponent(MapPickerComponent, {
      set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [NgTemplateOutlet, IconStub] },
    });
    const fixture = TestBed.createComponent(MapPickerComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const el = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;
  const row = (f: ComponentFixture<unknown>, attr: string) => el(f).querySelector<HTMLElement>(`[${attr}]`)!;
  const line = (r: HTMLElement) => r.textContent!.replace(/\s+/g, ' ').trim();
  /** Name, facts and the actions of a row, each on its own */
  const parts = (r: HTMLElement) =>
    [r.querySelector('.td-name'), r.querySelector('.td-sub'), ...Array.from(r.querySelectorAll('.mk-actions > *'))].map((e) => e!.textContent!.trim());

  it('lists own and shipped maps with picture, name, author, size, spawns and biome', async () => {
    const f = await open();
    const rows = Array.from(el(f).querySelectorAll<HTMLElement>('[data-map]'));
    // Own, then those coop hosts sent, then the shipped
    expect(rows.map((r) => r.dataset['map'])).toEqual(['bay', 'hosted', 'demo-valley']);
    expect(line(el(f))).toContain('From coop hosts');
    expect(parts(rows[0])).toEqual(['My bay', 'by Ann | 1024 x 512 m | 3 spawns | Desert', 'Edit', 'Play']);
    expect(rows[0].querySelector('img')!.getAttribute('src')).toBe('blob:bay');
    expect(parts(rows[2])).toEqual(['Demo Valley', 'by 3DTD | 512 x 512 m | 2 spawns | Temperate', 'Edit', 'Play']);
    expect(rows[2].querySelector('a')!.getAttribute('href')).toBe('http://x/editor?map=demo-valley');
  });

  it('plays a map on Play, and the one played now says so', async () => {
    const f = await open({ current: 'demo-valley' });
    (row(f, 'data-map="bay"').querySelector('button') as HTMLButtonElement).click();
    expect(worlds.playMap).toHaveBeenCalledWith('bay');
    const playing = row(f, 'data-map="demo-valley"');
    expect(playing.querySelector('button')).toBeNull();
    expect(line(playing)).toContain('Playing');
  });

  it('points to the editor without own maps, and shows the own tilesets when there are', async () => {
    const f = await open({ maps: { own: [], shared: [], shipped: [] }, tilesets: true });
    expect(line(el(f))).toContain('Maps you make in the map editor show up here.');
    const set = row(f, 'data-tileset');
    expect(parts(set)).toEqual(['Test ground', 'City survey | 1.4 km around its middle', 'Play']);
    set.querySelector('button')!.click();
    expect(worlds.playTileset).toHaveBeenCalledWith(TILESET);
  });

  it('warns that a run under way ends', async () => {
    expect(line(el(await open({ underWay: true })))).toContain('The run under way ends when another map loads.');
    TestBed.resetTestingModule();
    expect(line(el(await open()))).not.toContain('ends when');
  });
});
