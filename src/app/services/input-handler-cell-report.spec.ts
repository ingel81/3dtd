import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

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
import type { ScreenRect } from './debug/cell-report';

/**
 * While the cell report is on, a left click on the map toggles a grid cell
 * instead of selecting a tower, and Shift + left drag draws a box instead of
 * turning the camera. A plain drag still pans; Escape ends the report.
 */
describe('InputHandlerService with the cell report', () => {
  let service: InputHandlerService;
  let canvas: HTMLCanvasElement;
  let active: boolean;
  let report: {
    active: () => boolean;
    click: Mock<(hitPoint: Vector3) => void>;
    drag: Mock<(rect: ScreenRect | null) => void>;
    select: Mock<(rect: ScreenRect) => void>;
    end: Mock<() => void>;
  };
  let selectTower: Mock<(id: string | null) => void>;
  let raycastTowers: Mock<() => string | null>;
  /** Stands in for the camera controls, which listen on the canvas. */
  let controlsDown: Mock<(event: PointerEvent) => void>;

  const pointer = (type: string, x: number, y: number, init: PointerEventInit = {}, target: EventTarget = canvas) =>
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, ...init }));
  const key = (name: string) => {
    const event = new KeyboardEvent('keydown', { key: name, cancelable: true });
    Object.defineProperty(event, 'target', { value: document.body });
    return event;
  };

  beforeEach(() => {
    canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    active = true;
    report = {
      active: () => active,
      click: vi.fn<(hitPoint: Vector3) => void>(),
      drag: vi.fn<(rect: ScreenRect | null) => void>(),
      select: vi.fn<(rect: ScreenRect) => void>(),
      end: vi.fn<() => void>(),
    };
    selectTower = vi.fn<(id: string | null) => void>();
    raycastTowers = vi.fn<() => string | null>(() => 't1');
    const engine = {
      picker: { raycastTerrain: vi.fn((x: number, y: number) => new Vector3(x, 0, y)), raycastTowers },
      towers: { setHovered: vi.fn() },
      sync: { localToGeo: (p: Vector3) => ({ lat: p.x, lon: p.z, height: 0 }) },
    };

    const injector = Injector.create({
      providers: [
        { provide: TowerDefenseStore, useValue: { selectedTowerId: () => null } },
        { provide: UIStore, useValue: { viewOnly: signal(false) } },
        { provide: MatDialog, useValue: { openDialogs: [] } },
        { provide: KeyboardPanService, useValue: { onKeyDown: () => false, onKeyUp: vi.fn(), clearKeys: vi.fn() } },
        { provide: TowerPlacementService, useValue: { buildMode: () => false, stopRotating: vi.fn() } },
        { provide: MapPlacementService, useValue: { startRotating: () => false, stopRotating: vi.fn() } },
      ],
    });
    service = runInInjectionContext(injector, () => new InputHandlerService());
    service.initialize(canvas, engine as never, { towerManager: { selectTower } } as never, signal(false), vi.fn(), vi.fn());
    service.setCellReportCallbacks(report);
    controlsDown = vi.fn<(event: PointerEvent) => void>();
    canvas.addEventListener('pointerdown', controlsDown);
  });

  afterEach(() => {
    service.dispose();
    canvas.remove();
  });

  it('hands a left click on the ground to the report; no tower gets selected', () => {
    pointer('pointerdown', 10, 20);
    pointer('pointerup', 10, 20);

    expect(report.click).toHaveBeenCalledWith(new Vector3(10, 0, 20));
    expect(raycastTowers).not.toHaveBeenCalled();
    expect(selectTower).not.toHaveBeenCalled();
    expect(controlsDown).toHaveBeenCalledTimes(1);
  });

  it('leaves a pan to the camera', () => {
    pointer('pointerdown', 10, 20);
    pointer('pointerup', 60, 70);
    expect(report.click).not.toHaveBeenCalled();
  });

  it('draws the box of a Shift drag, anywhere on the page, and selects in it; the camera never sees it', () => {
    pointer('pointerdown', 10, 20, { shiftKey: true });
    expect(controlsDown).not.toHaveBeenCalled();
    expect(report.drag).toHaveBeenLastCalledWith({ left: 10, top: 20, right: 10, bottom: 20 });

    // Over a panel beside the canvas by now
    pointer('pointermove', 40, 5, { shiftKey: true }, document.body);
    expect(report.drag).toHaveBeenLastCalledWith({ left: 10, top: 5, right: 40, bottom: 20 });

    pointer('pointerup', 40, 5, { shiftKey: true }, document.body);
    expect(report.select).toHaveBeenCalledWith({ left: 10, top: 5, right: 40, bottom: 20 });
    expect(report.drag).toHaveBeenLastCalledWith(null);
    expect(report.click).not.toHaveBeenCalled();
  });

  it('takes a Shift drag shorter than a pan for a click', () => {
    pointer('pointerdown', 10, 20, { shiftKey: true });
    pointer('pointerup', 12, 21, { shiftKey: true });

    expect(report.select).not.toHaveBeenCalled();
    expect(report.click).toHaveBeenCalledWith(new Vector3(12, 0, 21));
  });

  it('leaves clicks and Shift + drag to the game and the camera while the report is off', () => {
    active = false;
    pointer('pointerdown', 10, 20, { shiftKey: true });
    pointer('pointerup', 10, 20, { shiftKey: true });

    expect(controlsDown).toHaveBeenCalledTimes(1);
    expect(report.drag).not.toHaveBeenCalled();
    expect(report.click).not.toHaveBeenCalled();
    expect(selectTower).toHaveBeenCalledWith('t1');
  });

  it('ends the report on Escape, and leaves Escape alone while it is off', () => {
    const escape = key('Escape');
    service.handleKeyDown(escape);
    expect(report.end).toHaveBeenCalledTimes(1);
    expect(escape.defaultPrevented).toBe(true);

    active = false;
    const other = key('Escape');
    service.handleKeyDown(other);
    expect(report.end).toHaveBeenCalledTimes(1);
    expect(other.defaultPrevented).toBe(false);
  });

  it('drops a box under way when the window loses the focus', () => {
    pointer('pointerdown', 10, 20, { shiftKey: true });
    service.handleWindowBlur();
    expect(report.drag).toHaveBeenLastCalledWith(null);

    pointer('pointerup', 40, 5, { shiftKey: true });
    expect(report.select).not.toHaveBeenCalled();
  });
});
