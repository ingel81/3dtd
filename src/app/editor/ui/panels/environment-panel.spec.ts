import { timeOfDay } from './environment-panel.component';

describe('time of day', () => {
  it('puts the sun east at dawn, south and high at 13, west at dusk', () => {
    expect(timeOfDay(13, 'day')).toEqual({ sunAzimuth: 180, sunElevation: 60, sky: 'day' });
    expect(timeOfDay(8, 'day')).toMatchObject({ sky: 'day' });
    expect(timeOfDay(6.5, 'day')).toMatchObject({ sunAzimuth: 96, sky: 'dusk' });
    expect(timeOfDay(19, 'day')).toMatchObject({ sky: 'dusk' });
    expect(timeOfDay(20, 'day').sunAzimuth).toBe(270);
    expect(timeOfDay(21.5, 'day')).toMatchObject({ sky: 'night', sunElevation: 2 });
    expect(timeOfDay(21.5, 'overcast').sky).toBe('overcast');
  });
});
