import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only their DI tokens are needed. Material's dialog needs the JIT compiler
// under vitest, the placement services pull in the tower pipeline and the markers.
vi.mock('@angular/material/dialog', () => ({ MatDialog: class MatDialog {} }));
vi.mock('./tower-placement.service', () => ({ TowerPlacementService: class TowerPlacementService {} }));
vi.mock('./world/map-placement.service', () => ({ MapPlacementService: class MapPlacementService {} }));

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { InputHandlerService } from './input-handler.service';
import { KeyboardPanService } from './keyboard-pan.service';
import { TowerPlacementService } from './tower-placement.service';
import { MapPlacementService } from './world/map-placement.service';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { UIStore } from '../store/ui.store';

/**
 * Range ring on hover: the tower under the pointer shows its range outside
 * build, placement and photo mode, picked at most every 100 ms and not while
 * a button is down (a camera drag or a click).
 */
describe('InputHandlerService tower hover', () => {
  let service: InputHandlerService;
  let canvas: HTMLCanvasElement;
  const buildMode = signal(false);
  const photoMode = signal(false);
  let engine: {
    picker: {
      raycastTowers: ReturnType<typeof vi.fn>;
      raycastTerrain: ReturnType<typeof vi.fn>;
    };
    towers: { setHovered: ReturnType<typeof vi.fn> };
  };

  const move = (x: number, y: number, init: PointerEventInit = {}, target: EventTarget = canvas) =>
    target.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, ...init }));
  const down = (x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, button: 0, buttons: 1 }));
  const up = (x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true, button: 0, buttons: 0 }));
  let selectTower: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    buildMode.set(false);
    photoMode.set(false);
    engine = {
      picker: {
        raycastTowers: vi.fn(() => 't1'),
        raycastTerrain: vi.fn(() => null),
      },
      towers: { setHovered: vi.fn() },
    };
    selectTower = vi.fn();

    const injector = Injector.create({
      providers: [
        // A click on a tower reads the selection
        { provide: TowerDefenseStore, useValue: { selectedTowerId: () => null } },
        // Photo mode is one of the view-only modes (UIStore.viewOnly)
        { provide: UIStore, useValue: { viewOnly: photoMode } },
        { provide: MatDialog, useValue: { openDialogs: [] } },
        { provide: KeyboardPanService, useValue: {} },
        { provide: TowerPlacementService, useValue: {} },
        { provide: MapPlacementService, useValue: {} },
      ],
    });
    service = runInInjectionContext(injector, () => new InputHandlerService());
    service.initialize(canvas, engine as never, { towerManager: { selectTower }, selectableTower: (id: string | null) => id } as never, buildMode, vi.fn(), vi.fn());
  });

  afterEach(() => {
    service.dispose();
    canvas.remove();
    vi.useRealTimers();
  });

  it('shows the range of the tower under the pointer', () => {
    move(10, 10);
    vi.advanceTimersByTime(0);
    expect(engine.picker.raycastTowers).toHaveBeenCalledWith(10, 10);
    expect(engine.towers.setHovered).toHaveBeenLastCalledWith('t1');
  });

  it('picks at most every 100 ms, the last position included', () => {
    move(10, 10);
    vi.advanceTimersByTime(0);
    move(20, 20);
    move(30, 30);
    vi.advanceTimersByTime(50);
    expect(engine.picker.raycastTowers).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60);
    expect(engine.picker.raycastTowers).toHaveBeenCalledTimes(2);
    expect(engine.picker.raycastTowers).toHaveBeenLastCalledWith(30, 30);
  });

  it('does not pick during a camera drag', () => {
    move(10, 10, { buttons: 1 });
    vi.advanceTimersByTime(200);
    expect(engine.picker.raycastTowers).not.toHaveBeenCalled();
  });

  it('drops the range when a button goes down on the tower and shows none during the drag', () => {
    move(10, 10);
    vi.advanceTimersByTime(0);
    expect(engine.towers.setHovered).toHaveBeenLastCalledWith('t1');

    down(10, 10);
    expect(engine.towers.setHovered).toHaveBeenLastCalledWith(null);
    move(40, 40, { buttons: 1 });
    vi.advanceTimersByTime(200);
    expect(engine.picker.raycastTowers).toHaveBeenCalledTimes(1);
    expect(engine.towers.setHovered).toHaveBeenLastCalledWith(null);
  });

  it('drops a pick still pending for the move before the press', () => {
    move(10, 10);
    vi.advanceTimersByTime(0);
    move(20, 20);
    down(20, 20);
    vi.advanceTimersByTime(200);
    expect(engine.picker.raycastTowers).toHaveBeenCalledTimes(1);
    expect(engine.towers.setHovered).toHaveBeenLastCalledWith(null);
  });

  it('clearHover drops the ring of the tower under the pointer and a pick still pending (getting into it)', () => {
    move(10, 10);
    vi.advanceTimersByTime(0);
    expect(engine.towers.setHovered).toHaveBeenLastCalledWith('t1');
    move(20, 20);

    service.clearHover();
    vi.advanceTimersByTime(200);
    expect(engine.towers.setHovered).toHaveBeenLastCalledWith(null);
    expect(engine.picker.raycastTowers).toHaveBeenCalledTimes(1);

    // Back out, the next move over it picks again, also at the same spot
    move(10, 10);
    vi.advanceTimersByTime(200);
    expect(engine.towers.setHovered).toHaveBeenLastCalledWith('t1');
  });

  it('shows the range again where the button comes up after a drag', () => {
    move(10, 10);
    vi.advanceTimersByTime(0);
    down(10, 10);
    move(60, 60, { buttons: 1 });
    up(60, 60);
    vi.advanceTimersByTime(200);
    expect(engine.picker.raycastTowers).toHaveBeenLastCalledWith(60, 60);
    expect(engine.towers.setHovered).toHaveBeenLastCalledWith('t1');
  });

  it('picks again after a click on the spot of the last pick', () => {
    move(10, 10);
    vi.advanceTimersByTime(0);
    down(10, 10);
    up(10, 10);
    expect(selectTower).toHaveBeenCalledWith('t1');
    vi.advanceTimersByTime(200);
    expect(engine.towers.setHovered).toHaveBeenLastCalledWith('t1');
  });

  it('drops the hover when the pointer leaves the canvas', () => {
    move(10, 10);
    vi.advanceTimersByTime(0);
    move(10, 10, {}, document.body);
    expect(engine.towers.setHovered).toHaveBeenLastCalledWith(null);
  });

  it('drops the hover in photo mode and picks no tower there', () => {
    move(10, 10);
    vi.advanceTimersByTime(0);
    photoMode.set(true);
    move(40, 40);
    vi.advanceTimersByTime(200);
    expect(engine.towers.setHovered).toHaveBeenLastCalledWith(null);
    expect(engine.picker.raycastTowers).toHaveBeenCalledTimes(1);
  });

  it('drops the hover in build mode and picks no tower there', () => {
    move(10, 10);
    vi.advanceTimersByTime(0);
    buildMode.set(true);
    move(40, 40);
    vi.advanceTimersByTime(200);
    expect(engine.towers.setHovered).toHaveBeenLastCalledWith(null);
    expect(engine.picker.raycastTowers).toHaveBeenCalledTimes(1);
  });
});
