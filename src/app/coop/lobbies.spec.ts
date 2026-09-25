import { describe, expect, it } from 'vitest';
import {
  NO_STORED_LOBBIES,
  activeLobby,
  addLobby,
  allLobbies,
  builtInLobbies,
  readStoredLobbies,
  removeLobby,
  withOldRelay,
} from './lobbies';

describe('lobbies (docs/COOP_PLAN.md, D58)', () => {
  const site = builtInLobbies([{ name: '3DTD Lobby', url: 'wss://lobby.3dtd.example' }, { url: 'nope' }], null);

  it('takes the site lobbies from the config, falling back to its single relay', () => {
    expect(site).toEqual([{ url: 'wss://lobby.3dtd.example', name: '3DTD Lobby', builtIn: true }]);
    expect(builtInLobbies(undefined, 'wss://relay.example/coop')).toEqual([
      { url: 'wss://relay.example/coop', name: 'relay.example', builtIn: true },
    ]);
    expect(builtInLobbies(null, null)).toEqual([]);
  });

  it('leaves a lobby for the desktop app only out of a browser (D59)', () => {
    const config = [{ name: '3DTD Lobby', url: 'wss://lobby.example', desktopOnly: true }];
    expect(builtInLobbies(config, null, true).map((l) => l.name)).toEqual(['3DTD Lobby']);
    expect(builtInLobbies(config, null, false)).toEqual([]);
  });

  it('adds the player’s own, makes it active and keeps the site one first', () => {
    const stored = addLobby(NO_STORED_LOBBIES, 'Home', 'ws://192.168.0.5:3003')!;
    const list = allLobbies(site, stored);
    expect(list.map((l) => l.name)).toEqual(['3DTD Lobby', 'Home']);
    expect(activeLobby(list, stored)?.name).toBe('Home');
    expect(addLobby(stored, 'Bad', 'https://x.example')).toBeNull();
  });

  it('falls back to the first lobby once the active one is removed', () => {
    const stored = removeLobby(addLobby(NO_STORED_LOBBIES, 'Home', 'ws://192.168.0.5:3003')!, 'ws://192.168.0.5:3003');
    expect(activeLobby(allLobbies(site, stored), stored)?.name).toBe('3DTD Lobby');
    expect(activeLobby([], stored)).toBeNull();
  });

  it('reads what it stored and drops the rest', () => {
    const stored = addLobby(NO_STORED_LOBBIES, 'Home', 'ws://192.168.0.5:3003')!;
    expect(readStoredLobbies(JSON.stringify(stored))).toEqual(stored);
    expect(readStoredLobbies('{"custom":[{"url":"http://x"}],"active":3}')).toEqual(NO_STORED_LOBBIES);
    expect(readStoredLobbies('not json')).toEqual(NO_STORED_LOBBIES);
  });

  it('keeps a server set before the lobby list as the player’s own', () => {
    const stored = withOldRelay(NO_STORED_LOBBIES, 'ws://192.168.0.5:3003');
    expect(stored.custom).toEqual([{ url: 'ws://192.168.0.5:3003', name: '192.168.0.5:3003' }]);
    expect(stored.active).toBe('ws://192.168.0.5:3003');
    expect(withOldRelay(stored, 'ws://192.168.0.5:3003')).toBe(stored);
  });
});
