import { describe, it, expect } from 'vitest';
import { relayCandidates, relayForLink, relayLabel, validRelayUrl } from './relay-address';

const page = (protocol: string, hostname: string) => ({ protocol, hostname });
const none = { fromLink: null, fromSetting: null, fromConfig: null };

describe('relay address (COOP_PLAN R6, R7)', () => {
  it('takes only ws and wss addresses with a host and no credentials', () => {
    expect(validRelayUrl('wss://relay.example.com/coop')).toBe('wss://relay.example.com/coop');
    expect(validRelayUrl(' ws://192.168.1.5:3003 ')).toBe('ws://192.168.1.5:3003');
    expect(validRelayUrl('https://relay.example.com')).toBeNull();
    expect(validRelayUrl('javascript:alert(1)')).toBeNull();
    expect(validRelayUrl('wss://user:pw@relay.example.com')).toBeNull();
    expect(validRelayUrl('nonsense')).toBeNull();
    expect(validRelayUrl('')).toBeNull();
  });

  it('asks the link, then the setting, then the site config; each alone', () => {
    const all = { fromLink: 'wss://a.example', fromSetting: 'wss://b.example', fromConfig: 'wss://c.example' };
    expect(relayCandidates({ ...all, page: page('https:', 'x.example') })).toEqual({ source: 'link', urls: ['wss://a.example'] });
    expect(relayCandidates({ ...all, fromLink: 'bad', page: page('https:', 'x.example') }))
      .toEqual({ source: 'setting', urls: ['wss://b.example'] });
    expect(relayCandidates({ ...all, fromLink: null, fromSetting: null, page: page('https:', 'x.example') }))
      .toEqual({ source: 'config', urls: ['wss://c.example'] });
  });

  it('finds one by itself: the site behind https, the LAN host, then this machine', () => {
    expect(relayCandidates({ ...none, page: page('https:', '3dtd.example') }).urls)
      .toEqual(['wss://3dtd.example/coop', 'ws://localhost:3003']);
    expect(relayCandidates({ ...none, page: page('http:', '192.168.1.5') }).urls)
      .toEqual(['ws://192.168.1.5:3003', 'ws://localhost:3003']);
    expect(relayCandidates({ ...none, page: page('http:', 'localhost') })).toEqual({ source: 'auto', urls: ['ws://localhost:3003'] });
  });

  it('leaves this machine out of an invite link, labels a relay by its host', () => {
    expect(relayForLink('ws://localhost:3003')).toBeNull();
    expect(relayForLink('ws://192.168.1.5:3003')).toBe('ws://192.168.1.5:3003');
    expect(relayLabel('wss://relay.example.com/coop')).toBe('relay.example.com');
  });
});
