import { describe, it, expect, vi, beforeEach } from 'vitest';

// A small budget, so thinning can be seen without allocating megabytes
vi.mock('../configs/replay.config', () => ({
  REPLAY_CONFIG: {
    stepsPerFrame: 6,
    maxStepsPerFrame: 24,
    sampleBudgetBytes: 260_000,
    maxEvents: 3,
    speeds: [0.25, 0.5, 1, 2, 4],
    maxAudioSpeed: 1,
  },
}));

import {
  ENEMY_END,
  ReplayRecording,
  decodeHeading,
  encodeHeading,
  heroPoseCode,
  heroPoseName,
  sampleBytes,
} from './replay-recording';
import type { RouteBodyStations } from '../utils/route-body';

/** One frame at `ms` with `enemies` enemy samples whose x is the frame number. */
function addFrame(rec: ReplayRecording, ms: number, enemies: number, marker: number): void {
  rec.beginFrame(ms);
  for (let i = 0; i < enemies; i++) {
    rec.pushEnemy(i, marker, 0, i, 0, 1, 1, 0);
  }
  rec.pushProjectile(0, marker, 1, 2);
  rec.pushTower(0, marker, 0, 0, 0, 0, 0);
  rec.endFrame();
}

describe('ReplayRecording', () => {
  let rec: ReplayRecording;

  beforeEach(() => {
    rec = new ReplayRecording();
    rec.reset(12, 5000, 100, 450, null);
  });

  describe('tables', () => {
    it('keeps one type table entry per type and the first end of an enemy', () => {
      const a = rec.addEnemy('zombie', 0);
      const b = rec.addEnemy('rat', 100);
      const c = rec.addEnemy('zombie', 200);
      expect(rec.enemyTypeIds).toEqual(['zombie', 'rat']);
      expect([rec.enemyType[a], rec.enemyType[b], rec.enemyType[c]]).toEqual([0, 1, 0]);

      rec.endEnemy(a, 900, ENEMY_END.DIED);
      rec.endEnemy(a, 950, ENEMY_END.CLEARED);
      expect(rec.enemyEnd[a]).toBe(ENEMY_END.DIED);
      expect(rec.enemyEndMs[a]).toBe(900);
      expect(rec.enemyEndMs[b]).toBe(Infinity);
    });

    it('grows the tables past their first capacity', () => {
      for (let i = 0; i < 1000; i++) rec.addEnemy(i % 2 ? 'rat' : 'zombie', i);
      expect(rec.enemyCount).toBe(1000);
      expect(rec.enemySpawnMs[999]).toBe(999);
      for (let i = 0; i < 700; i++) rec.addProjectile('arrow');
      rec.endProjectile(650, 42, 1, 2, 3);
      expect(Array.from(rec.projectileEndPos.subarray(650 * 3, 651 * 3))).toEqual([1, 2, 3]);
    });

    it('closes what is open at the finish: enemies cleared, projectiles vanished', () => {
      const died = rec.addEnemy('zombie', 0);
      const open = rec.addEnemy('zombie', 0);
      rec.endEnemy(died, 300, ENEMY_END.DIED);
      const flying = rec.addProjectile('arrow');
      rec.finish(1000, 'gameover');
      expect(rec.enemyEnd[died]).toBe(ENEMY_END.DIED);
      expect(rec.enemyEnd[open]).toBe(ENEMY_END.CLEARED);
      expect(rec.enemyEndMs[open]).toBe(1000);
      expect(rec.projectileEndMs[flying]).toBe(1000);
      expect(Number.isNaN(rec.projectileEndPos[flying * 3])).toBe(true);
      expect(rec.outcome).toBe('gameover');
    });
  });

  describe('frames', () => {
    it('finds the frame at a time and keeps the duration at the last frame', () => {
      for (let f = 0; f < 5; f++) {
        expect(rec.reserveFrame(3, 1, 1)).toBe('ok');
        addFrame(rec, f * 100, 3, f);
      }
      expect(rec.durationMs).toBe(400);
      expect(rec.frameAt(-1)).toBe(-1);
      expect(rec.frameAt(0)).toBe(0);
      expect(rec.frameAt(150)).toBe(1);
      expect(rec.frameAt(400)).toBe(4);
      expect(rec.frameAt(9999)).toBe(4);
      expect(rec.frameEnemyStart[2]).toBe(6);
      expect(rec.frameEnemyStart[5]).toBe(15);
    });

    it('quantises heading, speed and health', () => {
      rec.beginFrame(0);
      rec.pushEnemy(0, 1, 2, 3, 3 * Math.PI, 3.456, 0.5, 5);
      rec.endFrame();
      // 3π is a half turn: -π and π are the same heading
      expect(Math.abs(Math.abs(decodeHeading(rec.eHeading[0])) - Math.PI)).toBeLessThan(1e-3);
      expect(rec.eSpeed[0]).toBe(346);
      expect(rec.eHp[0]).toBe(128);
      expect(rec.eFlags[0]).toBe(5);
    });

    it('codes the hero\'s poses from 1, 0 being no hero', () => {
      for (const pose of ['idle', 'run', 'shoot', 'run-shoot'] as const) {
        expect(heroPoseCode(pose)).toBeGreaterThan(0);
        expect(heroPoseName(heroPoseCode(pose))).toBe(pose);
      }
    });

    it('forgets the bodies\' stations and the blood moon on reset', () => {
      rec.bloodMoon = true;
      rec.beginFrame(0);
      rec.pushBody(3, {} as RouteBodyStations, 0, 1);
      rec.endFrame();
      rec.reset(13, 0, 100, 0, null);
      expect(rec.bloodMoon).toBe(false);
      expect(rec.bodyStations.size).toBe(0);
      expect(rec.bodySamples).toBe(0);
    });

    it('rounds headings to within a ten-thousandth of a radian', () => {
      for (const h of [0, 0.1, -1.2, 2.9, -3.1, 7.5]) {
        const back = decodeHeading(encodeHeading(h));
        const diff = Math.atan2(Math.sin(back - h), Math.cos(back - h));
        expect(Math.abs(diff)).toBeLessThan(1e-4);
      }
    });
  });

  describe('memory budget', () => {
    it('grows the columns up to the budget, then drops every second frame and doubles the spacing', () => {
      let thinned = false;
      let frames = 0;
      for (let f = 0; f < 40 && !thinned; f++) {
        const fit = rec.reserveFrame(500, 1, 1);
        if (fit === 'thinned') thinned = true;
        addFrame(rec, f * 100, 500, f);
        frames++;
        expect(rec.sampleBytes).toBeLessThanOrEqual(260_000);
      }
      expect(thinned).toBe(true);
      expect(rec.stepsPerFrame).toBe(12);
      // The frames before the thinning kept their even half, samples intact
      const kept = rec.frameCount;
      expect(kept).toBe(Math.ceil((frames - 1) / 2) + 1);
      for (let f = 0; f < kept - 1; f++) {
        expect(rec.frameMs[f]).toBe(f * 200);
        const first = rec.frameEnemyStart[f];
        expect(rec.frameEnemyStart[f + 1] - first).toBe(500);
        expect(rec.ePos[first * 3]).toBe(f * 2);
        expect(rec.ePos[(first + 499) * 3 + 2]).toBe(499);
        expect(rec.pPos[rec.frameProjectileStart[f] * 3]).toBe(f * 2);
        expect(rec.tRot[rec.frameTowerStart[f]]).toBe(f * 2);
      }
    });

    it('stops at the coarsest spacing and marks the recording truncated', () => {
      let fit = 'ok';
      for (let f = 0; f < 400 && fit !== 'full'; f++) {
        fit = rec.reserveFrame(2000, 1, 1);
        if (fit !== 'full') addFrame(rec, f * 100, 2000, f);
      }
      expect(fit).toBe('full');
      expect(rec.truncated).toBe(true);
      expect(rec.stepsPerFrame).toBeLessThanOrEqual(24);
      expect(rec.reserveFrame(1, 0, 0)).toBe('full');
      expect(rec.sampleBytes).toBeLessThanOrEqual(260_000);
    });

    it('counts bytes per sample column', () => {
      expect(sampleBytes(1, 0, 0)).toBe(22);
      expect(sampleBytes(0, 1, 0)).toBe(16);
      expect(sampleBytes(0, 0, 1)).toBe(23);
      expect(sampleBytes(0, 0, 0, 1)).toBe(12);
    });

    it('thins the body samples and the hero with their frames', () => {
      const stations = {} as RouteBodyStations;
      for (let f = 0; f < 4; f++) {
        expect(rec.reserveFrame(0, 0, 0, 1)).toBe('ok');
        rec.beginFrame(f * 100);
        rec.pushBody(0, stations, f, f + 10);
        if (f !== 2) rec.pushHero(f + 1, f + 2, f / 10, heroPoseCode('run'));
        rec.endFrame();
      }
      rec.thin();
      expect(rec.frameCount).toBe(2);
      expect(rec.bodySamples).toBe(2);
      expect(Array.from(rec.frameBodyStart.subarray(0, 3))).toEqual([0, 1, 2]);
      expect(Array.from(rec.bTail.subarray(0, 2))).toEqual([0, 2]);
      expect(Array.from(rec.bTip.subarray(0, 2))).toEqual([10, 12]);
      // Frame 2 had no hero, and is now frame 1
      expect(Array.from(rec.heroPose.subarray(0, 2))).toEqual([heroPoseCode('run'), 0]);
      expect(Array.from(rec.heroPos.subarray(0, 2))).toEqual([1, 2]);
      expect(rec.bodyStations.get(0)).toBe(stations);
    });

    it('grows once to what the budget still holds when doubling no longer fits, not every frame', () => {
      // 4096 enemy samples fill up in 41 frames; doubling then no longer fits the budget
      let grown = 0;
      let columns = rec.eIndex;
      let fit = 'ok';
      for (let f = 0; f < 200 && fit !== 'thinned'; f++) {
        fit = rec.reserveFrame(100, 1, 1);
        if (rec.eIndex !== columns) {
          grown++;
          columns = rec.eIndex;
        }
        addFrame(rec, f * 100, 100, f);
        expect(rec.sampleBytes).toBeLessThanOrEqual(260_000);
      }
      expect(fit).toBe('thinned');
      expect(grown).toBeLessThanOrEqual(2);
    });

    it('keeps its columns for the next wave', () => {
      for (let f = 0; f < 10; f++) {
        rec.reserveFrame(500, 1, 1);
        addFrame(rec, f * 100, 500, f);
      }
      const columns = rec.eIndex;
      rec.reset(13, 0, 100, 0, null);
      expect(rec.frameCount).toBe(0);
      expect(rec.enemySamples).toBe(0);
      expect(rec.eIndex).toBe(columns);
    });
  });

  describe('events', () => {
    it('keeps events up to the cap and counts the rest', () => {
      for (let i = 0; i < 5; i++) {
        rec.pushEvent(i * 10, { type: 'audio:play', sound: 'arrow', lat: 0, lon: 0, height: 0 });
      }
      expect(rec.events.length).toBe(3);
      expect(rec.droppedEvents).toBe(2);
      expect(rec.eventAfter(-1)).toBe(0);
      expect(rec.eventAfter(10)).toBe(2);
      expect(rec.eventAfter(20)).toBe(3);
    });

    it('reads the HQ health at a time from its changes', () => {
      rec.pushHealth(100, 90);
      rec.pushHealth(300, 70);
      expect(rec.healthAt(0)).toBe(100);
      expect(rec.healthAt(150)).toBe(90);
      expect(rec.healthAt(300)).toBe(70);
    });
  });
});
