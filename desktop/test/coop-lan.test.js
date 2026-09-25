'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { gameFromStatus, hostAddresses } = require('../src/coop-lan');

describe('gameFromStatus', () => {
  const status = {
    protocol: 1,
    rooms: [
      { code: 'ABC234', hostId: 'p1', gameVersion: '0.4.0', started: false, locked: false, players: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bob' }] },
      { code: 'RUN234', hostId: 'p3', gameVersion: '0.4.0', started: true, locked: false, players: [{ id: 'p3', name: 'Cid' }] },
      { code: 'LCK234', hostId: 'p4', gameVersion: '0.4.0', started: false, locked: true, players: [{ id: 'p4', name: 'Dee' }] },
    ],
  };

  it('lists the open lobbies of a relay as a LAN announcement would', () => {
    assert.deepEqual(gameFromStatus(status, 3003), {
      type: 'game',
      port: 3003,
      protocol: 1,
      rooms: [{ code: 'ABC234', host: 'Ann', players: 2, gameVersion: '0.4.0' }],
    });
  });

  it('is nothing for an answer that is no relay status', () => {
    assert.equal(gameFromStatus({ hello: 1 }, 3003), null);
    assert.equal(gameFromStatus(null, 3003), null);
  });
});

describe('hostAddresses', () => {
  it('names each address by its adapter', () => {
    assert.deepEqual(
      hostAddresses({ Ethernet: [{ family: 'IPv4', address: '192.168.1.20', netmask: '255.255.255.0', internal: false }] }),
      [{ name: 'Ethernet', address: '192.168.1.20' }]
    );
  });

  it('puts the real network first, VPN and WSL last', () => {
    const v4 = (address, netmask = '255.255.255.0') => [{ family: 'IPv4', address, netmask, internal: false }];
    const names = hostAddresses({
      'Some VPN': v4('203.0.113.9', '255.0.0.0'),
      Ethernet: v4('192.168.1.20'),
      'vEthernet (WSL (Hyper-V firewall))': v4('172.21.80.1', '255.255.240.0'),
    }).map((a) => a.name);
    assert.deepEqual(names, ['Ethernet', 'Some VPN', 'vEthernet (WSL (Hyper-V firewall))']);
  });
});

describe('setUpCoopLan', () => {
  const { setUpCoopLan } = require('../src/coop-lan');

  function fakeIpc() {
    const handlers = new Map();
    return {
      handle: (name, fn) => handlers.set(name, fn),
      on: (name, fn) => handlers.set(name, fn),
      call: (name, ...args) => handlers.get(name)(...args),
    };
  }
  const sender = () => {
    const sent = [];
    return { sent, isDestroyed: () => false, send: (ch, data) => sent.push([ch, data]), once: () => undefined };
  };
  const status = {
    protocol: 1,
    rooms: [{ code: 'ABC234', hostId: 'p1', gameVersion: 'v', started: false, locked: false, players: [{ id: 'p1', name: 'Ann' }] }],
  };

  it('answers the host IP field with no scan running, and lists what it found', async () => {
    const ipc = fakeIpc();
    const lan = setUpCoopLan({
      ipcMain: ipc,
      utilityProcess: null,
      relayPath: '',
      log: { info: () => undefined, warn: () => undefined },
      isAppSender: () => true,
      fetchImpl: async (url) => ({ json: async () => (url.includes(':3003/') ? status : {}) }),
    });
    try {
      const page = sender();
      const found = await ipc.call('desktop:lan-probe', { sender: page }, '192.168.1.30');
      assert.equal(found, true);
      const lists = page.sent.filter(([ch]) => ch === 'desktop:lan-games').map(([, games]) => games);
      assert.equal(lists.at(-1)[0].code, 'ABC234');
      assert.equal(lists.at(-1)[0].address, '192.168.1.30');
      // A second listener joining the running scan hears the list at once
      const other = sender();
      ipc.call('desktop:lan-games-again', { sender: other });
      assert.equal(other.sent[0][1][0].code, 'ABC234');
    } finally {
      lan.close();
    }
  });
});
