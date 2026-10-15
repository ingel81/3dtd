import { describe, expect, it } from 'vitest';
import { createMapDocument } from './map-create';
import type { MapIntro, MapIntroView } from './map-document';
import { contentHash, packMapFile, unpackMapFile, validateMapDocument } from './map-file';
import { emptyPose, introPoseAt, introProblems } from './map-intro';

const view = (x: number, y: number, h: number): MapIntroView => ({ x, y, h, lookX: 0, lookY: 0, lookH: 0 });
const hq = { x: 10, y: -20, h: 5 };

function sample() {
  return createMapDocument({ id: 'intro-map', name: 'Intro map', width: 64, depth: 64, ground: 'flat', seed: 1, now: new Date('2026-10-16T00:00:00Z') });
}

describe('map intro flight', () => {
  it('a path passes through its views at even times', () => {
    const intro: MapIntro = { kind: 'path', seconds: 10, views: [view(0, 0, 50), view(100, 0, 60), view(100, 100, 40)] };
    const pose = emptyPose();
    expect(introPoseAt(intro, hq, 0, pose)).toMatchObject({ x: 0, y: 0, h: 50 });
    introPoseAt(intro, hq, 5, pose);
    expect([pose.x, pose.y, pose.h]).toEqual([100, 0, 60]);
    introPoseAt(intro, hq, 10, pose);
    expect([pose.x, pose.y, pose.h]).toEqual([100, 100, 40]);
    // Past its end it holds the last view
    introPoseAt(intro, hq, 99, pose);
    expect(pose.y).toBe(100);
  });

  it('one view holds still', () => {
    const pose = introPoseAt({ kind: 'path', seconds: 5, views: [view(3, 4, 5)] }, hq, 2, emptyPose());
    expect([pose.x, pose.y, pose.h]).toEqual([3, 4, 5]);
  });

  it('an orbit circles the HQ from its bearing, looking at it', () => {
    const intro: MapIntro = { kind: 'orbit', seconds: 8, radius: 100, height: 40, angle: 0, sweep: 180 };
    const pose = introPoseAt(intro, hq, 0, emptyPose());
    expect(pose).toMatchObject({ x: 110, y: -20, h: 45, lookX: 10, lookY: -20, lookH: 5 });
    introPoseAt(intro, hq, 4, pose);
    expect(pose.x).toBeCloseTo(10, 6);
    expect(pose.y).toBeCloseTo(80, 6);
    introPoseAt(intro, hq, 8, pose);
    expect(pose.x).toBeCloseTo(-90, 6);
  });

  it('names what is wrong', () => {
    expect(introProblems(undefined)).toEqual([]);
    expect(introProblems({ kind: 'orbit', seconds: 10, radius: 100, height: 30, angle: 1 })).toEqual([]);
    expect(introProblems({ kind: 'spin', seconds: 10 })).toEqual(['intro.kind must be path or orbit']);
    expect(introProblems({ kind: 'path', seconds: 1, views: [] })).toHaveLength(2);
    expect(introProblems({ kind: 'path', seconds: 10, views: [{ x: 1 }] })).toEqual(['every intro view needs x, y, h, lookX, lookY and lookH']);
    expect(introProblems({ kind: 'orbit', seconds: 10, radius: 1, height: 30, angle: 0, sweep: 5 })).toHaveLength(2);
  });

  it('travels in the map file; a map without it keeps its file and hash', async () => {
    const doc = sample();
    const before = await contentHash(doc);
    const plain = unpackMapFile(packMapFile(doc)).doc;
    expect('intro' in plain).toBe(false);
    expect(await contentHash(plain)).toBe(before);

    doc.intro = { kind: 'orbit', seconds: 12, radius: 200, height: 60, angle: 0.5 };
    expect(validateMapDocument(doc)).toEqual([]);
    const back = unpackMapFile(packMapFile(doc)).doc;
    expect(back.intro).toEqual(doc.intro);
    expect(await contentHash(back)).not.toBe(before);

    doc.intro = { kind: 'orbit', seconds: 0, radius: 200, height: 60, angle: 0.5 };
    expect(validateMapDocument(doc)).toContain('intro.seconds must be 3 to 60');
  });
});
