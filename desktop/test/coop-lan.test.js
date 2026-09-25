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
