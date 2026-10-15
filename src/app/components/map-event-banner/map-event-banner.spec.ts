import { waveEventLines } from './map-event-banner';

describe('map event banner (TODO E170)', () => {
  it("says the map's messages, then the portals that opened", () => {
    expect(waveEventLines(['The gate falls'], ['North'])).toEqual(['The gate falls', 'A portal opens: North. Enemies come from there from this wave on.']);
    expect(waveEventLines([], [])).toEqual([]);
  });
});
