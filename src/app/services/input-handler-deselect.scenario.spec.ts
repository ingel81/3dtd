import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only their DI tokens are needed, as in input-handler-hover.spec.ts
vi.mock('@angular/material/dialog', () => ({ MatDialog: class MatDialog {} }));
vi.mock('./tower-placement.service', () => ({ TowerPlacementService: class TowerPlacementService {} }));
vi.mock('./world/map-placement.service', () => ({ MapPlacementService: class MapPlacementService {} }));

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { Group, Scene, Vector3 } from 'three';
import { MatDialog } from '@angular/material/dialog';
import { InputHandlerService } from './input-handler.service';
import { KeyboardPanService } from './keyboard-pan.service';
import { TowerPlacementService } from './tower-placement.service';
import { MapPlacementService } from './world/map-placement.service';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { UIStore } from '../store/ui.store';
import { ThreeTowerRenderer, type TowerRenderData } from '../three-engine/renderers/three-tower.renderer';

/**
 * Playtest 522 (docs/archive/REVIEW_FIX_2026-09-14.md) replayed: the real input
 * handler over a canvas, the real tower renderer that shows the range, the
 * selection as TowerManager.selectTower drives the renderer.
 */
describe('Deselect with the pointer left on the tower, playtest 522 replayed', () => {
  let service: InputHandlerService;
  let canvas: HTMLCanvasElement;
  let renderer: ThreeTowerRenderer;
  let tower: TowerRenderData;
  let raycastTowers: ReturnType<typeof vi.fn>;
  const selected = signal<string | null>(null);

  const down = (x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, button: 0, buttons: 1 }));
  const up = (x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true, button: 0, buttons: 0 }));
  const move = (x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
  /** Range disc and selection ring of the tower */
  const shows = () => [tower.rangeIndicator!.visible, tower.selectionRing!.visible];

  beforeEach(async () => {
    renderer = new ThreeTowerRenderer(
      new Scene(),
      { geoToLocal: (lat: number, lon: number, height: number) => new Vector3(lon, height, lat) } as never,
      { loadModel: async () => ({ animations: [] }), cloneModel: () => new Group() } as never,
    );
    tower = (await renderer.create('t1', 'archer', 0, 0, 0, 0, null))!;
    vi.useFakeTimers();

    canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    selected.set(null);
    // TowerManager.selectTower: the previous one is deselected, the new one selected
    const selectTower = vi.fn((id: string | null) => {
      const previous = selected();
      if (previous && previous !== id) renderer.deselect(previous);
      if (id) renderer.select(id);
      selected.set(id);
    });
    raycastTowers = vi.fn(() => 't1');

    const injector = Injector.create({
      providers: [
        { provide: TowerDefenseStore, useValue: { selectedTowerId: selected } },
        { provide: UIStore, useValue: { viewOnly: signal(false) } },
        { provide: MatDialog, useValue: { openDialogs: [] } },
        { provide: KeyboardPanService, useValue: {} },
        { provide: TowerPlacementService, useValue: {} },
        { provide: MapPlacementService, useValue: {} },
      ],
    });
    service = runInInjectionContext(injector, () => new InputHandlerService());
    service.initialize(
      canvas,
      { picker: { raycastTowers, raycastTerrain: () => null }, towers: renderer } as never,
      { towerManager: { selectTower } } as never,
      signal(false),
      vi.fn(),
      vi.fn(),
    );
  });

  afterEach(() => {
    service.dispose();
    canvas.remove();
    vi.useRealTimers();
  });

  it('522: a click selects, a second click deselects, and with the pointer left there the hover range is back', () => {
    move(10, 10);
    vi.advanceTimersByTime(0);
    expect(shows()).toEqual([true, true]);

    down(10, 10);
    up(10, 10);
    expect(selected()).toBe('t1');
    vi.advanceTimersByTime(100);
    expect(shows()).toEqual([true, true]);

    down(10, 10);
    up(10, 10);
    expect(selected()).toBeNull();
    // The press dropped the hover (playtest 521), the deselect hid the ring;
    // the pick after the release brings the hover range back
    expect(shows()).toEqual([false, false]);
    vi.advanceTimersByTime(100);
    expect(raycastTowers).toHaveBeenLastCalledWith(10, 10);
    expect(shows()).toEqual([true, true]);
  });
});
