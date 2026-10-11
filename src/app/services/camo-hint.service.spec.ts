import { describe, expect, it, vi } from 'vitest';

// Only their DI tokens are needed; the real modules pull in the engine
vi.mock('../sim/client/sim-client.service', () => ({ SimClient: class SimClient {} }));
vi.mock('../bots/bot-client.service', () => ({ BotClientService: class BotClientService {} }));
vi.mock('./camera-control.service', () => ({ CameraControlService: class CameraControlService {} }));
vi.mock('./tower-control.service', () => ({ TowerControlService: class TowerControlService {} }));
vi.mock('./boss-intro.service', () => ({ BossIntroService: class BossIntroService {} }));
vi.mock('../store/ui.store', () => ({ UIStore: class UIStore {} }));

import { DestroyRef, Injector, runInInjectionContext, signal } from '@angular/core';
import { CAMO_HINT, CamoHintService, camoLookAllowed } from './camo-hint.service';
import { SimClient } from '../sim/client/sim-client.service';
import { BotClientService } from '../bots/bot-client.service';
import { CameraControlService } from './camera-control.service';
import { TowerControlService } from './tower-control.service';
import { BossIntroService } from './boss-intro.service';
import { UIStore } from '../store/ui.store';
import { GameEventBus } from '../game-engine/game-event-bus';
import type { UiNotice } from '../store/ui.store';
import type { EnemyView } from '../sim/client/views';

function setup(opts: { bot?: boolean; manned?: boolean } = {}) {
  const bus = new GameEventBus();
  const notice = signal<UiNotice | null>(null);
  const camera = { focusGeo: vi.fn(() => true) };
  const destroy: (() => void)[] = [];
  const injector = Injector.create({
    providers: [
      { provide: SimClient, useValue: { bus } },
      { provide: UIStore, useValue: { notice, viewOnly: () => false, mainMenuOpen: () => false } },
      { provide: BotClientService, useValue: { botEnabled: () => opts.bot === true } },
      { provide: CameraControlService, useValue: camera },
      { provide: TowerControlService, useValue: { active: () => opts.manned === true } },
      { provide: BossIntroService, useValue: { active: () => false } },
      { provide: DestroyRef, useValue: { onDestroy: (fn: () => void) => destroy.push(fn) } },
    ],
  });
  runInInjectionContext(injector, () => new CamoHintService());
  const spawn = (camo: boolean, viaPortal = true, lat = 48.1) =>
    bus.emit({ type: 'enemy:spawned', enemy: { camo, position: { lat, lon: 9.2 } } as unknown as EnemyView as never, viaPortal });
  return { bus, notice, camera, spawn };
}

describe('CamoHintService (TODO E145)', () => {
  it('says the first camouflaged enemy of a run once and looks at it', () => {
    const { notice, camera, spawn } = setup();
    spawn(false);
    expect(notice()).toBeNull();
    spawn(true, true, 48.1);
    expect(notice()).toEqual({ text: CAMO_HINT, tone: 'warn' });
    expect(camera.focusGeo).toHaveBeenCalledWith(48.1, 9.2);
    notice.set(null);
    spawn(true, true, 48.2);
    expect(notice()).toBeNull();
    expect(camera.focusGeo).toHaveBeenCalledTimes(1);
  });

  it('says it again in the next run, never for a split child, and leaves the camera to a bot or a manned tower', () => {
    const { bus, notice, camera, spawn } = setup({ manned: true });
    spawn(true, false);
    expect(notice()).toBeNull();
    spawn(true);
    expect(notice()?.text).toBe(CAMO_HINT);
    expect(camera.focusGeo).not.toHaveBeenCalled();
    notice.set(null);
    bus.emit({ type: 'game:reset' } as never);
    spawn(true);
    expect(notice()?.text).toBe(CAMO_HINT);
  });

  it('turns the camera only while nobody else holds it', () => {
    const free = { botEnabled: false, viewOnly: false, menuOpen: false, towerManned: false, bossIntro: false };
    expect(camoLookAllowed(free)).toBe(true);
    for (const key of Object.keys(free) as (keyof typeof free)[]) {
      expect(camoLookAllowed({ ...free, [key]: true })).toBe(false);
    }
  });
});
