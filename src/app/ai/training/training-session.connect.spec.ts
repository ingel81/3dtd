import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TrainingSession } from './training-session';
import { TrainingClientService, type TrainingDeps } from './training-client.service';
import { AIDataCollectorService } from '../core/ai-data-collector.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { BUILD_VERSION } from '../../configs/build-info.config';

/**
 * Playtest 565 (fix session 2026-09-14), client side: the connect message
 * names the build, which the backend writes as `client_session` with
 * `game_version`. The WebSocket is a fake that opens when the test says so.
 */
class FakeSocket {
  static readonly OPEN = 1;
  static last: FakeSocket | null = null;
  readonly readyState = FakeSocket.OPEN;
  readonly sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }

  send(text: string): void {
    this.sent.push(JSON.parse(text));
  }

  close(): void {
    // The session takes it down itself (cleanup)
  }
}

describe('TrainingSession connect (playtest 565)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sends the build version the sidebar shows, v0.2.0 today', async () => {
    const injector = Injector.create({
      providers: [
        { provide: AIDataCollectorService, useValue: {} },
        { provide: TowerDefenseStore, useValue: { phase: signal('setup') } },
      ],
    });
    const client = runInInjectionContext(injector, () => new TrainingClientService());
    const session = runInInjectionContext(injector, () => new TrainingSession(client, {} as TrainingDeps));

    const connected = session.connect('ws://localhost:3001');
    const socket = FakeSocket.last!;
    socket.onopen!();
    await expect(connected).resolves.toBe(true);

    expect(socket.sent[0]).toMatchObject({ type: 'connect', gameVersion: BUILD_VERSION });
    expect(BUILD_VERSION).toBe('v0.2.0');
    session.disconnect();
  });
});
