import { timeOfDay } from '../../../world/custom-map/time-of-day';
import { skyPreset } from './environment-panel.component';

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

describe('sky buttons', () => {
  it('Day after an evening on the slider brings the sun back up, a day sun stays', () => {
    expect(skyPreset('day', { sunElevation: 4 })).toEqual(timeOfDay(10, 'day'));
    expect(skyPreset('day', { sunElevation: 4 })).toMatchObject({ sky: 'day' });
    expect(skyPreset('day', { sunElevation: 45 })).toEqual({ sky: 'day' });
  });

  it('Dusk under a high sun goes to the evening, Night and Overcast keep the sun', () => {
    expect(skyPreset('dusk', { sunElevation: 60 })).toEqual({ ...timeOfDay(19, 'day'), sky: 'dusk' });
    expect(skyPreset('dusk', { sunElevation: 8 })).toEqual({ sky: 'dusk' });
    expect(skyPreset('night', { sunElevation: 60 })).toEqual({ sky: 'night' });
    expect(skyPreset('overcast', { sunElevation: 4 })).toEqual({ sky: 'overcast' });
  });
});
