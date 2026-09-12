import type { Mock } from 'vitest';
import { RenderLoop } from './render-loop';

/** Steht für den Heartbeat-Worker: schreibt Nachrichten mit und tickt auf Zuruf. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }

  tick(): void {
    this.onmessage?.({ data: { type: 'tick' } });
  }
}

let hidden = false;

/** Tab-Sichtbarkeit umschalten, wie der Browser sie meldet. */
function setHidden(value: boolean): void {
  hidden = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

const loops: RenderLoop[] = [];

function setup(options: { rendering?: boolean } = {}) {
  const rendering = options.rendering ?? true;
  const hooks = {
    update: vi.fn<(deltaTime: number) => void>(),
    render: vi.fn<() => void>(),
    isRendering: vi.fn(() => rendering),
  };
  const loop = new RenderLoop(hooks);
  loops.push(loop);
  return { loop, hooks };
}

/** Die Deltas, mit denen update() lief. */
function deltas(update: Mock<(deltaTime: number) => void>): number[] {
  return update.mock.calls.map(([deltaTime]) => deltaTime);
}

/** Ob das Promise bis jetzt aufgelöst ist. */
async function isSettled(promise: Promise<void>): Promise<boolean> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await Promise.resolve();
  return settled;
}

describe('RenderLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
    });
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  });

  afterEach(() => {
    for (const loop of loops.splice(0)) {
      loop.setBackgroundLoopEnabled(false);
      loop.stop();
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (document as unknown as { hidden?: boolean }).hidden;
  });

  describe('rAF-Treiber', () => {
    it('ruft pro Frame update() mit dem Abstand zum letzten Frame und danach render()', () => {
      const { loop, hooks } = setup();
      const startedAt = performance.now();
      loop.start();
      expect(hooks.update).not.toHaveBeenCalled();

      vi.advanceTimersToNextFrame();
      const firstFrameAt = performance.now();
      vi.advanceTimersToNextFrame();

      expect(deltas(hooks.update)).toEqual([firstFrameAt - startedAt, performance.now() - firstFrameAt]);
      expect(hooks.render).toHaveBeenCalledTimes(2);
      expect(hooks.update.mock.invocationCallOrder[0]).toBeLessThan(hooks.render.mock.invocationCallOrder[0]);
      expect(hooks.render.mock.invocationCallOrder[0]).toBeLessThan(hooks.update.mock.invocationCallOrder[1]);
    });

    it('startet bei einem zweiten start() keine zweite Frame-Kette', () => {
      const once = setup();
      const twice = setup();
      once.loop.start();
      twice.loop.start();
      twice.loop.start();

      vi.advanceTimersByTime(500);
      expect(twice.hooks.update.mock.calls.length).toBe(once.hooks.update.mock.calls.length);
      expect(once.hooks.update.mock.calls.length).toBeGreaterThan(0);
    });

    it('stop() beendet die Frames', () => {
      const { loop, hooks } = setup();
      loop.start();
      vi.advanceTimersToNextFrame();
      vi.advanceTimersToNextFrame();
      loop.stop();
      vi.advanceTimersByTime(1000);

      expect(hooks.update).toHaveBeenCalledTimes(2);
      expect(hooks.render).toHaveBeenCalledTimes(2);
    });

    it('lässt mit setFpsLimit(30) etwa jeden zweiten Frame ganz aus, update() eingeschlossen', () => {
      const capped = setup();
      const free = setup();
      capped.loop.setFpsLimit(30);
      capped.loop.start();
      free.loop.start();

      vi.advanceTimersByTime(1000);
      const frames = free.hooks.update.mock.calls.length;
      const ran = capped.hooks.update.mock.calls.length;
      expect(ran).toBeGreaterThanOrEqual(29);
      expect(ran).toBeLessThanOrEqual(31);
      expect(ran).toBeLessThan(frames * 0.6);
      expect(capped.hooks.render).toHaveBeenCalledTimes(ran);

      // 0 hebt den Cap auf, dann läuft wieder jeder Frame.
      capped.loop.setFpsLimit(0);
      vi.advanceTimersByTime(1000);
      expect(capped.hooks.update.mock.calls.length - ran).toBe(free.hooks.update.mock.calls.length - frames);
    });
  });

  describe('Heartbeat im versteckten Tab', () => {
    it('startet ohne setBackgroundLoopEnabled keinen Worker', () => {
      const { loop } = setup();
      loop.start();
      setHidden(true);
      expect(FakeWorker.instances).toHaveLength(0);
    });

    it('treibt update() per Worker-Tick, ohne render()', () => {
      const { loop, hooks } = setup();
      loop.setBackgroundLoopEnabled(true);
      loop.start();
      expect(FakeWorker.instances).toHaveLength(0);

      setHidden(true);
      expect(FakeWorker.instances).toHaveLength(1);
      const worker = FakeWorker.instances[0];
      // Vite löst die Worker-URL relativ zu render-loop.ts auf.
      expect(worker.url.pathname).toBe('/src/app/workers/heartbeat.worker.ts');
      expect(worker.options).toEqual({ type: 'module' });
      expect(worker.postMessage).toHaveBeenCalledWith({ type: 'start', intervalMs: 16 });

      vi.advanceTimersByTime(12);
      worker.tick();
      expect(deltas(hooks.update)).toEqual([12]);
      expect(hooks.render).not.toHaveBeenCalled();
    });

    it('steppt nicht aus rAF-Frames, solange der Heartbeat die Uhr hat', () => {
      const { loop, hooks } = setup();
      loop.setBackgroundLoopEnabled(true);
      loop.start();
      setHidden(true);

      vi.advanceTimersByTime(200);
      expect(hooks.update).not.toHaveBeenCalled();
      expect(hooks.render).not.toHaveBeenCalled();
    });

    it('deckelt einen Tick auf 50 ms und lässt einen Tick ohne verstrichene Zeit aus', () => {
      const { loop, hooks } = setup();
      loop.setBackgroundLoopEnabled(true);
      loop.start();
      setHidden(true);
      const worker = FakeWorker.instances[0];

      vi.advanceTimersByTime(5000);
      worker.tick();
      worker.tick();
      vi.advanceTimersByTime(30);
      worker.tick();

      expect(deltas(hooks.update)).toEqual([50, 30]);
    });

    it('gibt die Uhr beim Sichtbarwerden ohne Aufhol-Delta an rAF zurück', () => {
      const { loop, hooks } = setup();
      loop.setBackgroundLoopEnabled(true);
      loop.start();
      setHidden(true);
      const worker = FakeWorker.instances[0];

      vi.advanceTimersByTime(3000);
      setHidden(false);
      expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'stop' });
      expect(worker.terminate).toHaveBeenCalledTimes(1);

      const visibleAt = performance.now();
      vi.advanceTimersToNextFrame();
      expect(deltas(hooks.update)).toEqual([performance.now() - visibleAt]);
      expect(hooks.render).toHaveBeenCalledTimes(1);

      // Ein verspäteter Tick bei sichtbarem Tab steppt nicht mit.
      worker.tick();
      expect(hooks.update).toHaveBeenCalledTimes(1);
    });

    it('startet den Worker erst mit dem Loop', () => {
      const { loop } = setup();
      loop.setBackgroundLoopEnabled(true);
      setHidden(true);
      expect(FakeWorker.instances).toHaveLength(0);

      loop.start();
      expect(FakeWorker.instances).toHaveLength(1);
    });

    it('setBackgroundLoopEnabled(false) beendet den Worker und hört nicht mehr auf die Sichtbarkeit', () => {
      const { loop } = setup();
      loop.setBackgroundLoopEnabled(true);
      loop.start();
      setHidden(true);
      const worker = FakeWorker.instances[0];

      loop.setBackgroundLoopEnabled(false);
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      setHidden(false);
      setHidden(true);
      expect(FakeWorker.instances).toHaveLength(1);
    });

    it('stop() beendet auch den Worker', () => {
      const { loop } = setup();
      loop.setBackgroundLoopEnabled(true);
      loop.start();
      setHidden(true);
      const worker = FakeWorker.instances[0];

      loop.stop();
      expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'stop' });
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('dispose() beendet den Worker und löst den Sichtbarkeits-Listener', () => {
      const add = vi.spyOn(document, 'addEventListener');
      const remove = vi.spyOn(document, 'removeEventListener');
      const { loop, hooks } = setup();
      loop.setBackgroundLoopEnabled(true);
      loop.start();
      setHidden(true);
      const worker = FakeWorker.instances[0];
      const listener = add.mock.calls.find(([type]) => type === 'visibilitychange')?.[1];
      expect(listener).toBeDefined();

      loop.dispose();
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith('visibilitychange', listener);

      setHidden(false);
      setHidden(true);
      vi.advanceTimersByTime(100);
      expect(FakeWorker.instances).toHaveLength(1);
      expect(hooks.update).not.toHaveBeenCalled();
    });

    it('stop() allein behält den Listener, ein neuer start() nimmt den Heartbeat wieder auf', () => {
      const { loop } = setup();
      loop.setBackgroundLoopEnabled(true);
      loop.start();
      setHidden(true);
      loop.stop();

      setHidden(false);
      loop.start();
      expect(FakeWorker.instances).toHaveLength(1);
      setHidden(true);
      expect(FakeWorker.instances).toHaveLength(2);
    });

    it('läuft auf rAF weiter, wenn der Worker nicht startet', () => {
      const error = new Error('no workers');
      vi.stubGlobal('Worker', class {
        constructor() {
          throw error;
        }
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { loop, hooks } = setup();
      loop.setBackgroundLoopEnabled(true);
      loop.start();
      setHidden(true);

      expect(warn).toHaveBeenCalledWith('[ThreeTilesEngine] Heartbeat worker unavailable:', error);
      vi.advanceTimersToNextFrame();
      expect(hooks.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('waitForRenderedFrame()', () => {
    it('löst sofort auf, wenn der Loop steht', async () => {
      const { loop } = setup();
      expect(await isSettled(loop.waitForRenderedFrame())).toBe(true);
    });

    it('löst sofort auf, wenn nichts gezeichnet wird (Headless-Training)', async () => {
      const { loop } = setup({ rendering: false });
      loop.start();
      expect(await isSettled(loop.waitForRenderedFrame())).toBe(true);
    });

    it('wartet auf den nächsten gezeichneten Frame und löst alle Wartenden auf einmal', async () => {
      const { loop } = setup();
      loop.start();
      const first = loop.waitForRenderedFrame();
      const second = loop.waitForRenderedFrame();
      // Frames ohne frameRendered() (der Fake-render() zeichnet nichts) lösen nichts.
      vi.advanceTimersByTime(100);
      expect(await isSettled(first)).toBe(false);

      loop.frameRendered();
      expect(await isSettled(first)).toBe(true);
      expect(await isSettled(second)).toBe(true);

      const next = loop.waitForRenderedFrame();
      expect(await isSettled(next)).toBe(false);
      loop.frameRendered();
      expect(await isSettled(next)).toBe(true);
    });

    it('gibt nach 1000 ms ohne gezeichneten Frame auf', async () => {
      const { loop } = setup();
      loop.start();
      const waiting = loop.waitForRenderedFrame();

      vi.advanceTimersByTime(999);
      expect(await isSettled(waiting)).toBe(false);
      vi.advanceTimersByTime(1);
      expect(await isSettled(waiting)).toBe(true);
    });
  });

  describe('getFPS()', () => {
    it('zählt die gezeichneten Frames der letzten vollen Sekunde', () => {
      const { loop } = setup();
      expect(loop.getFPS()).toBe(0);

      vi.advanceTimersByTime(1000);
      loop.frameRendered();
      const before = loop.getFPS();
      for (let i = 0; i < 49; i++) {
        vi.advanceTimersByTime(20);
        loop.frameRendered();
      }
      expect(loop.getFPS()).toBe(before);

      vi.advanceTimersByTime(20);
      loop.frameRendered();
      expect(loop.getFPS()).toBe(50);
    });
  });
});
