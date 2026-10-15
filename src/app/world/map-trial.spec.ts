import { GameEventBus } from '../game-engine/game-event-bus';
import { MAP_TRIAL_STALL_MS, MAP_TRIAL_TONE, MAP_TRIAL_WAVES, MAX_MAP_TRIAL_WAVES, MAP_EDITOR_WINDOW, MAP_TEST_WINDOW, MapTrial, returnToEditor, mapTrialSummary, mapTrialWaves, type MapTrialResult } from './map-trial';

describe('map trial', () => {
  let bus: GameEventBus;
  let results: MapTrialResult[];
  const game = { hqHealth: () => 420, towers: () => 7, gameTimeMs: () => 123_456.7 };
  const trial = (waves: number) => new MapTrial(waves, 500, game, bus, (r) => results.push(r));
  const waveDone = (wave: number, hpLost: number) =>
    bus.emit({ type: 'wave:completed', wave, credits: 0, perfect: hpLost === 0, closeCall: false, hpLost });

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new GameEventBus();
    results = [];
  });
  afterEach(() => vi.useRealTimers());

  it('reads its waves from the link', () => {
    expect(mapTrialWaves('?world=map:x')).toBeNull();
    expect(mapTrialWaves('?bot=auto')).toBeNull();
    expect(mapTrialWaves('?world=map:x&bot=trial')).toBe(MAP_TRIAL_WAVES);
    expect(mapTrialWaves('?bot=trial&trialWaves=3')).toBe(3);
    expect(mapTrialWaves('?bot=trial&trialWaves=999')).toBe(MAX_MAP_TRIAL_WAVES);
    expect(mapTrialWaves('?bot=trial&trialWaves=-2')).toBe(MAP_TRIAL_WAVES);
    // ?waves= names the wave source, not the trial's length
    expect(mapTrialWaves('?bot=trial&waves=table')).toBe(MAP_TRIAL_WAVES);
  });

  it('passes once its waves are held, and only once', () => {
    trial(3);
    waveDone(1, 0);
    waveDone(2, 30.04000001);
    expect(results).toEqual([]);
    waveDone(3, 50);
    waveDone(4, 0);
    expect(results).toEqual([{
      outcome: 'passed', waves: 3, wavesHeld: 3, hqStart: 500, hqEnd: 420,
      hpLostByWave: [0, 30, 50], towers: 7, gameTimeMs: 123_457,
    }]);
    expect(mapTrialSummary(results[0])).toBe('Map check passed: 3 of 3 waves held (HQ 420/500, 7 towers)');
    expect(MAP_TRIAL_TONE[results[0].outcome]).toBe('ok');
  });

  it('fails where the HQ falls', () => {
    trial(10);
    waveDone(1, 100);
    bus.emit({ type: 'game:over', reason: 'base-destroyed' });
    expect(results[0]).toMatchObject({ outcome: 'lost', wavesHeld: 1, hqEnd: 0 });
    expect(mapTrialSummary(results[0])).toContain('fell in wave 2 of 10');
  });

  it('is stuck when no wave finishes for too long', () => {
    trial(10);
    vi.advanceTimersByTime(MAP_TRIAL_STALL_MS - 1);
    waveDone(1, 0);
    vi.advanceTimersByTime(MAP_TRIAL_STALL_MS - 1);
    expect(results).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(results[0]).toMatchObject({ outcome: 'stuck', wavesHeld: 1 });
    // Over: a later wave or game over changes nothing
    waveDone(2, 0);
    bus.emit({ type: 'game:over', reason: 'base-destroyed' });
    expect(results).toHaveLength(1);
  });
});

describe('returnToEditor', () => {
  const editorOn = (href: string) => ({ name: MAP_EDITOR_WINDOW, closed: false, location: { href }, focus: vi.fn() });
  const testTab = (opener: unknown, name = MAP_TEST_WINDOW) => ({ name, opener, close: vi.fn(), open: vi.fn() }) as unknown as Window;

  it('brings the editor that still shows the map to the front and closes the test tab', () => {
    const editor = editorOn('http://localhost/play/editor?map=m1');
    const tab = testTab(editor);
    expect(returnToEditor('m1', tab)).toBe(true);
    expect(editor.focus).toHaveBeenCalled();
    // By its name: the browser brings that tab to the front, focus() alone does not
    expect(tab.open).toHaveBeenCalledWith('', MAP_EDITOR_WINDOW);
    expect(tab.close).toHaveBeenCalled();
  });

  it('leaves it to the caller outside the test tab, without an editor, or with the editor on another map', () => {
    expect(returnToEditor('m1', testTab(editorOn('http://localhost/editor?map=m1'), 'other'))).toBe(false);
    expect(returnToEditor('m1', testTab(null))).toBe(false);
    expect(returnToEditor('m1', testTab({ ...editorOn('http://localhost/editor?map=m1'), closed: true }))).toBe(false);
    expect(returnToEditor('m1', testTab(editorOn('http://localhost/editor?map=m2')))).toBe(false);
    expect(returnToEditor('m1', testTab(editorOn('http://localhost/?world=map:m1')))).toBe(false);
  });
});
