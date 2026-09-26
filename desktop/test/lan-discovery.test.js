'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  addressRank,
  askMessage,
  broadcastAddress,
  createGameList,
  createLanAnnouncer,
  createLanScanner,
  gameMessage,
  isPrivateAddress,
  lanAdapters,
  readMessage,
  targetsFor,
} = require('../src/lan-discovery');

const room = { code: 'ABC234', host: 'Ann', players: 1, gameVersion: '0.4.0' };

describe('broadcastAddress', () => {
  it('is the subnet with all host bits set', () => {
    assert.equal(broadcastAddress('192.168.1.20', '255.255.255.0'), '192.168.1.255');
    assert.equal(broadcastAddress('10.1.2.3', '255.255.0.0'), '10.1.255.255');
    assert.equal(broadcastAddress('172.21.80.1', '255.255.240.0'), '172.21.95.255');
  });

  it('is none for a single address or junk', () => {
    assert.equal(broadcastAddress('10.0.0.1', '255.255.255.255'), null);
    assert.equal(broadcastAddress('10.0.0.1', '255.255.255.254'), null);
    assert.equal(broadcastAddress('nope', '255.255.255.0'), null);
  });
});

describe('lanAdapters', () => {
  it('keeps real IPv4 adapters and names them', () => {
    const adapters = lanAdapters({
      Ethernet: [
        { family: 'IPv4', address: '192.168.1.20', netmask: '255.255.255.0', internal: false },
        { family: 'IPv6', address: 'fe80::1', netmask: 'ffff::', internal: false },
      ],
      'Loopback Pseudo-Interface 1': [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
      WLAN: [{ family: 4, address: '169.254.3.4', netmask: '255.255.0.0', internal: false }],
      'vEthernet (WSL)': [{ family: 4, address: '172.21.80.1', netmask: '255.255.240.0', internal: false }],
    });
    assert.deepEqual(adapters, [
      { name: 'Ethernet', address: '192.168.1.20', netmask: '255.255.255.0', broadcast: '192.168.1.255' },
      { name: 'vEthernet (WSL)', address: '172.21.80.1', netmask: '255.255.240.0', broadcast: '172.21.95.255' },
    ]);
  });

  it('sends each round to the subnet, everyone and the group', () => {
    assert.deepEqual(targetsFor({ name: 'e', address: '192.168.1.20', broadcast: '192.168.1.255' }), [
      '192.168.1.255',
      '255.255.255.255',
      '239.255.77.13',
    ]);
  });
});

describe('messages', () => {
  it('read back what was written', () => {
    assert.deepEqual(readMessage(askMessage()), { type: 'ask' });
    assert.deepEqual(readMessage(gameMessage({ port: 3003, protocol: 1, rooms: [room] })), {
      type: 'game',
      port: 3003,
      protocol: 1,
      rooms: [room],
    });
  });

  it('drops what is not ours or broken', () => {
    assert.equal(readMessage(Buffer.from('hello')), null);
    assert.equal(readMessage(Buffer.from(JSON.stringify({ m: 'other', v: 1, t: 'ask' }))), null);
    assert.equal(readMessage(Buffer.from(JSON.stringify({ m: '3dtd-lan', v: 2, t: 'ask' }))), null);
    assert.equal(readMessage(Buffer.from(JSON.stringify({ m: '3dtd-lan', v: 1, t: 'game', port: 0, rooms: [] }))), null);
    assert.equal(readMessage(Buffer.alloc(4096, 32)), null);
  });

  it('cuts long names and drops odd room codes', () => {
    const message = readMessage(gameMessage({
      port: 3003,
      protocol: 1,
      rooms: [{ ...room, host: 'x'.repeat(100), players: 99 }, { ...room, code: 'no spaces' }],
    }));
    assert.equal(message.rooms.length, 1);
    assert.equal(message.rooms[0].host.length, 40);
    assert.equal(message.rooms[0].players, 0);
  });
});

describe('the announcement stays small and private (relay review N5)', () => {
  it('leaves rooms out until the packet fits what a guest reads', () => {
    const rooms = Array.from({ length: 60 }, (_, i) => ({ ...room, code: `ABC${String(i).padStart(3, '2')}`, host: 'x'.repeat(40) }));
    const packet = gameMessage({ port: 3003, protocol: 1, rooms });
    assert.ok(packet.length <= 2048);
    assert.ok(readMessage(packet).rooms.length > 5);
  });

  it('answers only this machine and private networks', () => {
    for (const address of ['192.168.1.7', '10.1.2.3', '172.20.0.1', '127.0.0.1', '169.254.3.4', '::ffff:192.168.0.2', 'fe80::1', 'fd00::5']) {
      assert.equal(isPrivateAddress(address), true, address);
    }
    for (const address of ['203.0.113.9', '8.8.8.8', '172.32.0.1', '2001:db8::1']) {
      assert.equal(isPrivateAddress(address), false, address);
    }
  });
});

describe('addressRank', () => {
  it('puts the own subnet first, then private ranges, then the rest', () => {
    const locals = [{ address: '192.168.1.20', netmask: '255.255.255.0' }];
    assert.equal(addressRank('192.168.1.7', locals), 0);
    assert.equal(addressRank('10.0.0.5', locals), 1);
    assert.equal(addressRank('203.0.113.9', locals), 2);
  });
});

describe('createGameList', () => {
  const game = { type: 'game', port: 3003, protocol: 1, rooms: [room] };

  it('lists each room with the address it came from', () => {
    const list = createGameList(5000);
    assert.equal(list.heard('192.168.1.7', game, 0), true);
    assert.equal(list.heard('192.168.1.7', game, 500), false);
    assert.deepEqual(list.games(), [{
      ...room,
      protocol: 1,
      address: '192.168.1.7',
      port: 3003,
      endpoints: [{ address: '192.168.1.7', port: 3003 }],
    }]);
  });

  it('makes one game of a host heard on several adapters, own subnet first', () => {
    const locals = () => [{ name: 'Ethernet', address: '192.168.1.20', netmask: '255.255.255.0' }];
    const list = createGameList(5000, locals);
    list.heard('203.0.113.9', game, 0);
    list.heard('172.21.80.1', game, 0);
    list.heard('192.168.1.7', game, 0);
    const games = list.games();
    assert.equal(games.length, 1);
    assert.equal(games[0].address, '192.168.1.7');
    assert.deepEqual(games[0].endpoints.map((e) => e.address), ['192.168.1.7', '172.21.80.1', '203.0.113.9']);
  });

  it('forgets a relay that went quiet', () => {
    const list = createGameList(5000);
    list.heard('192.168.1.7', game, 0);
    assert.equal(list.expire(4000), false);
    assert.equal(list.expire(6000), true);
    assert.deepEqual(list.games(), []);
  });
});

describe('announcer and scanner', () => {
  it('find each other on loopback by a direct question', async () => {
    const port = 40000 + Math.floor(Math.random() * 20000);
    const listAdapters = () => [{ name: 'loopback', address: '127.0.0.1', broadcast: null }];
    const announcer = createLanAnnouncer({
      port,
      listAdapters,
      describe: () => ({ port: 3003, protocol: 1, rooms: [room] }),
    });
    let scanner;
    try {
      const found = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('nothing found in 4 s')), 4000);
        scanner = createLanScanner({
          port,
          listAdapters,
          everyMs: 200,
          onGames: (games) => {
            if (games.length === 0) return;
            clearTimeout(timeout);
            resolve(games);
          },
        });
        scanner.probe('127.0.0.1');
      });
      assert.equal(found[0].code, 'ABC234');
      assert.equal(found[0].address, '127.0.0.1');
      assert.equal(found[0].port, 3003);
    } finally {
      scanner?.close();
      announcer.close();
    }
  });
});
