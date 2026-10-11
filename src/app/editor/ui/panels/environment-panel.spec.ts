import { timeOfDay } from './environment-panel.component';

describe('time of day', () => {
  it('puts the sun east at dawn, south and high at noon, west at dusk', () => {
    expect(timeOfDay(12, 'day')).toEqual({ sunAzimuth: 180, sunElevation: 60, sky: 'day' });
    expect(timeOfDay(7, 'day')).toMatchObject({ sky: 'day' });
    expect(timeOfDay(6.5, 'day')).toMatchObject({ sunAzimuth: 98, sky: 'dusk' });
    expect(timeOfDay(18, 'day').sunAzimuth).toBe(270);
    expect(timeOfDay(21, 'day')).toMatchObject({ sky: 'night', sunElevation: 2 });
    expect(timeOfDay(21, 'overcast').sky).toBe('overcast');
  });
});
