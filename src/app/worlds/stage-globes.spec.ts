import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlobeSquares } from './stage-globes';

/**
 * The globes' squares on the stage (E207 after review): at rest a frame reads
 * nothing from the layout; the hover comes from the cards' events and makes
 * the squares be read again while the scale's transition runs.
 */
describe('GlobeSquares', () => {
  let squares: GlobeSquares | null = null;
  afterEach(() => {
    squares?.dispose();
    document.body.innerHTML = '';
  });

  function stage() {
    document.body.innerHTML = `
      <div id="host">
        <canvas id="canvas"></canvas>
        <button class="ws-card" id="osm"><span data-globe="osm"></span><span class="name">OpenStreetMap</span></button>
        <button class="ws-card" id="maps"><span data-globe="maps"></span></button>
        <button id="plain">Settings</button>
      </div>`;
    const host = document.getElementById('host')!;
    const reads = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    let now = 0;
    squares = new GlobeSquares(host, document.getElementById('canvas')!, () => now);
    return { host, reads, advance: (ms: number) => (now += ms), el: (id: string) => document.getElementById(id)! };
  }

  it('reads the squares once, then not again at rest', () => {
    const { reads, advance } = stage();
    expect(squares!.read().map((q) => q.globe)).toEqual(['osm', 'maps']);
    const first = reads.mock.calls.length;
    expect(first).toBe(3);
    advance(1000);
    expect(squares!.moving).toBe(false);
    for (let k = 0; k < 10; k++) squares!.read();
    expect(reads.mock.calls.length).toBe(first);
  });

  it('knows the hovered globe from the pointer and reads the squares again while the scale moves them', () => {
    const { reads, advance, el } = stage();
    squares!.read();
    advance(1000);
    const before = reads.mock.calls.length;
    el('osm').querySelector('.name')!.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(squares!.hovered('osm')).toBe(true);
    expect(squares!.hovered('maps')).toBe(false);
    expect(squares!.moving).toBe(true);
    squares!.read();
    advance(300);
    squares!.read();
    expect(reads.mock.calls.length).toBe(before + 6);
    advance(400);
    expect(squares!.moving).toBe(false);
    // A button without a globe is no hover
    el('plain').dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(squares!.anyHovered).toBe(false);
    el('maps').dispatchEvent(new Event('pointerover', { bubbles: true }));
    el('host').dispatchEvent(new Event('pointerleave'));
    expect(squares!.anyHovered).toBe(false);
  });
});
