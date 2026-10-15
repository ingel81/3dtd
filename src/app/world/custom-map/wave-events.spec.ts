import type { MapEnvironment, MapWaveEvent } from './map-document';
import { environmentAt, eventsInOrder, hiddenObjectsAt, messagesOf, portalWaves, reachedWave } from './wave-events';

const env: MapEnvironment = { sky: 'day', sunAzimuth: 120, sunElevation: 40, fogDensity: 0.001, tint: '#ffffff', weather: 'clear' };

describe('wave events (TODO E170)', () => {
  it('counts the events of the next wave as happened between waves, of the running one during a wave', () => {
    expect(reachedWave(0, true)).toBe(1);
    expect(reachedWave(4, true)).toBe(5);
    expect(reachedWave(4, false)).toBe(4);
  });

  it('orders by wave, keeping the list order within a wave', () => {
    const events: MapWaveEvent[] = [
      { wave: 3, kind: 'message', text: 'b' },
      { wave: 1, kind: 'message', text: 'a' },
      { wave: 3, kind: 'message', text: 'c' },
    ];
    expect(eventsInOrder(events).map((e) => (e as { text: string }).text)).toEqual(['a', 'b', 'c']);
    expect(messagesOf(events, 3)).toEqual(['b', 'c']);
  });

  it('opens a portal at its earliest wave', () => {
    expect(portalWaves([{ wave: 6, kind: 'portal', spawn: 's2' }, { wave: 4, kind: 'portal', spawn: 's2' }, { wave: 9, kind: 'portal', spawn: 's3' }])).toEqual(
      new Map([['s2', 4], ['s3', 9]]),
    );
  });

  it('hides an object before the event that shows it, and after the one that takes it away', () => {
    const events: MapWaveEvent[] = [
      { wave: 3, kind: 'objects', ids: ['gate'], show: true },
      { wave: 5, kind: 'objects', ids: ['gate', 'wall'], show: false },
      { wave: 8, kind: 'objects', ids: ['wall'], show: true },
    ];
    expect([...hiddenObjectsAt(events, 1)]).toEqual(['gate']);
    expect([...hiddenObjectsAt(events, 3)]).toEqual([]);
    expect([...hiddenObjectsAt(events, 5)].sort()).toEqual(['gate', 'wall']);
    expect([...hiddenObjectsAt(events, 8)]).toEqual(['gate']);
  });

  it('changes weather and time of day as the waves go, from the map own sky', () => {
    const events: MapWaveEvent[] = [
      { wave: 4, kind: 'weather', weather: 'snow', strength: 0.3 },
      { wave: 6, kind: 'time', hour: 21.5 },
      { wave: 9, kind: 'time', hour: 10 },
    ];
    expect(environmentAt(env, events, 3)).toBe(env);
    expect(environmentAt(env, events, 4)).toMatchObject({ weather: 'snow', weatherStrength: 0.3, sky: 'day', sunElevation: 40 });
    expect(environmentAt(env, events, 6)).toMatchObject({ weather: 'snow', sky: 'night' });
    expect(environmentAt(env, events, 9)).toMatchObject({ sky: 'day' });
    // An overcast map stays overcast
    expect(environmentAt({ ...env, sky: 'overcast' }, events, 6).sky).toBe('overcast');
  });
});
