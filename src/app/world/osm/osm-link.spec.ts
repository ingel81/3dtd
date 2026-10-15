import { osmLinkPlace } from './osm-link';

describe('OSM world link', () => {
  it('reads the place of ?osm=<lat>,<lon> and nothing else', () => {
    expect(osmLinkPlace('?osm=49.7036,9.2647')).toEqual({ lat: 49.7036, lon: 9.2647 });
    expect(osmLinkPlace('?menu=skip&osm=-33.86, 151.21')).toEqual({ lat: -33.86, lon: 151.21 });
    expect(osmLinkPlace('?osm=Miltenberg')).toBeNull();
    expect(osmLinkPlace('?osm=91,10')).toBeNull();
    expect(osmLinkPlace('?world=map:demo-valley')).toBeNull();
  });
});
