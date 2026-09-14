import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only their DI tokens are needed, as in input-handler-hover.spec.ts
vi.mock('@angular/material/dialog', () => ({ MatDialog: class MatDialog {} }));
vi.mock('./tower-placement.service', () => ({ TowerPlacementService: class TowerPlacementService {} }));
vi.mock('./world/map-placement.service', () => ({ MapPlacementService: class MapPlacementService {} }));

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { Vector3 } from 'three';
import { MatDialog } from '@angular/material/dialog';
import { InputHandlerService } from './input-handler.service';
import { KeyboardPanService } from './keyboard-pan.service';
import { TowerPlacementService } from './tower-placement.service';
import { MapPlacementService } from './world/map-placement.service';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { UIStore } from '../store/ui.store';

/**
 * Pointer moves in build mode (the same path serves map placement, ability
 * targeting and the hero): at most one raycast per 16 ms, and a move inside
 * that window is not lost but comes through at its end, at the last pointer
 * position, so a preview ends where the pointer stopped.
 */
describe('InputHandlerService pointer move throttle', () => {
  let service: InputHandlerService;
  let canvas: HTMLCanvasElement;
  const buildMode = signal(true);
  let onMouseMove: ReturnType<typeof vi.fn>;
  let raycastTerrain: ReturnType<typeof vi.fn>;

  const move = (x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));

  beforeEach(() => {
    vi.useFakeTimers();
    canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    buildMode.set(true);
    raycastTerrain = vi.fn((x: number, y: number) => new Vector3(x, 0, y));
    const engine = {
      picker: { raycastTerrain, raycastTowers: vi.fn(() => null) },
      towers: { setHovered: vi.fn() },
      sync: { localToGeo: (p: Vector3) => ({ lat: p.x, lon: p.z }) },
    };
    onMouseMove = vi.fn();

    const injector = Injector.create({
      providers: [
        { provide: TowerDefenseStore, useValue: { selectedTowerId: () => null } },
        { provide: UIStore, useValue: { viewOnly: signal(false) } },
        { provide: MatDialog, useValue: { openDialogs: [] } },
        { provide: KeyboardPanService, useValue: {} },
        { provide: TowerPlacementService, useValue: {} },
        { provide: MapPlacementService, useValue: {} },
      ],
    });
    service = runInInjectionContext(injector, () => new InputHandlerService());
    service.initialize(canvas, engine as never, { towerManager: {} } as never, buildMode, vi.fn(), onMouseMove as never);
  });

  afterEach(() => {
    service.dispose();
    canvas.remove();
    vi.useRealTimers();
  });

  it('hands the first move on at once', () => {
    move(10, 10);
    expect(onMouseMove).toHaveBeenCalledTimes(1);
    expect(onMouseMove).toHaveBeenLastCalledWith(10, 10, expect.any(Vector3));
  });

  it('hands moves inside the window on once at its end, at the last position', () => {
    move(10, 10);
    move(20, 20);
    move(30, 30);
    expect(onMouseMove).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(16);
    expect(raycastTerrain).toHaveBeenCalledTimes(2);
    expect(onMouseMove).toHaveBeenCalledTimes(2);
    expect(onMouseMove).toHaveBeenLastCalledWith(30, 30, expect.any(Vector3));

    // Nothing more to hand on
    vi.advanceTimersByTime(100);
    expect(onMouseMove).toHaveBeenCalledTimes(2);
  });

  it('loses no move of a pointer that sends one every frame', () => {
    for (let frame = 1; frame <= 10; frame++) {
      move(frame, frame);
      vi.advanceTimersByTime(16.7);
      expect(onMouseMove).toHaveBeenLastCalledWith(frame, frame, expect.any(Vector3));
    }
  });

  it('hands nothing on once the mode that owned the pointer ended', () => {
    move(10, 10);
    move(20, 20);
    buildMode.set(false);
    vi.advanceTimersByTime(16);
    expect(onMouseMove).toHaveBeenCalledTimes(1);
  });

  it('hands nothing on after dispose', () => {
    move(10, 10);
    move(20, 20);
    service.dispose();
    vi.advanceTimersByTime(16);
    expect(onMouseMove).toHaveBeenCalledTimes(1);
  });
});
