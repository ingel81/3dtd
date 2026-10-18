import { waveEventLines } from './map-event-banner';
import { en } from '../../i18n/messages/en';

describe('map event banner (TODO E170)', () => {
  it("says the map's messages, then the portals that opened", () => {
    expect(waveEventLines(en, ['The gate falls'], ['North'])).toEqual(['The gate falls', 'A portal opens: North. Enemies come from there from this wave on.']);
    expect(waveEventLines(en, [], [])).toEqual([]);
  });
});
