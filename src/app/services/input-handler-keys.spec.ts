import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only their DI tokens are needed. Material's dialog needs the JIT compiler
// under vitest, the placement service pulls in the whole tower pipeline.
vi.mock('@angular/material/dialog', () => ({ MatDialog: class MatDialog {} }));
vi.mock('./tower-placement.service', () => ({ TowerPlacementService: class TowerPlacementService {} }));

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { InputHandlerService } from './input-handler.service';
import { KeyboardPanService } from './keyboard-pan.service';
import { TowerPlacementService } from './tower-placement.service';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { UIStore } from '../store/ui.store';

function keyOn(type: 'keydown' | 'keyup', key: string, target: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent(type, { key, cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

/**
 * Camera keys against a focused slider: the arrows belong to the slider
 * (the enemy debugger and the audio sliders), WASD still pans.
 */
describe('InputHandlerService keys on a focused slider', () => {
  let service: InputHandlerService;
  let slider: HTMLInputElement;
  let pan: { onKeyDown: ReturnType<typeof vi.fn>; onKeyUp: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    slider = document.createElement('input');
    slider.type = 'range';
    pan = { onKeyDown: vi.fn(() => true), onKeyUp: vi.fn(() => true) };

    const injector = Injector.create({
      providers: [
        { provide: TowerDefenseStore, useValue: {} },
        { provide: UIStore, useValue: { photoMode: signal(false) } },
        { provide: MatDialog, useValue: { openDialogs: [] } },
        { provide: KeyboardPanService, useValue: pan },
        { provide: TowerPlacementService, useValue: {} },
      ],
    });
    service = runInInjectionContext(injector, () => new InputHandlerService());
  });

  it('leaves the arrow keys to the slider, the camera does not pan', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      const down = keyOn('keydown', key, slider);
      service.handleKeyDown(down);
      expect(down.defaultPrevented, key).toBe(false);
      service.handleKeyUp(keyOn('keyup', key, slider));
    }
    expect(pan.onKeyDown).not.toHaveBeenCalled();
    expect(pan.onKeyUp).not.toHaveBeenCalled();
  });

  it('still pans with WASD', () => {
    const down = keyOn('keydown', 'w', slider);
    service.handleKeyDown(down);
    expect(pan.onKeyDown).toHaveBeenCalledWith(down);
    expect(down.defaultPrevented).toBe(true);

    const up = keyOn('keyup', 'w', slider);
    service.handleKeyUp(up);
    expect(pan.onKeyUp).toHaveBeenCalledWith(up);
  });

  it('pans with the arrows when no slider has the focus', () => {
    const down = keyOn('keydown', 'ArrowLeft', document.createElement('canvas'));
    service.handleKeyDown(down);
    expect(pan.onKeyDown).toHaveBeenCalledWith(down);
    expect(down.defaultPrevented).toBe(true);
  });
});
