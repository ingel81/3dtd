import { describe, expect, it } from 'vitest';
import { chatTime, chatView } from './chat-view';
import { pingBarCount } from './ping-bars.component';
import type { CoopChatLine } from '../../services/coop.service';

const at = new Date(2026, 8, 25, 19, 42).getTime();
const line = (id: number, from: string | null, text: string, warn = false): CoopChatLine => ({ id, from, text, warn, at });

describe('coop chat view (docs/COOP_PLAN.md, C8)', () => {
  it('puts name and time over the first line of a burst only; a system line ends the burst', () => {
    const view = chatView(
      [line(1, 'a', 'hi'), line(2, 'a', 'all good?'), line(3, 'b', 'yes'), line(4, null, 'Bob is ready', false), line(5, 'b', 'go')],
      (id) => (id === 'a' ? 'Ann' : 'Bob'),
      (id) => (id === 'a' ? '#ef4444' : '#f97316'),
    );
    expect(view.map((l) => [l.head, l.system])).toEqual([[true, false], [false, false], [true, false], [false, true], [true, false]]);
    expect(view[0]).toMatchObject({ name: 'Ann', color: '#ef4444', time: '19:42', text: 'hi' });
    expect(view[3]).toMatchObject({ name: '', text: 'Bob is ready' });
  });

  it('writes the time as hours and minutes', () => {
    expect(chatTime(new Date(2026, 0, 1, 7, 5).getTime())).toBe('7:05');
  });
});

describe('ping bars', () => {
  it('lights four bars under 40 ms, three under 90, two under 160, else one; none while unknown', () => {
    expect([12, 40, 89, 90, 159, 160, 900].map(pingBarCount)).toEqual([4, 3, 3, 2, 2, 1, 1]);
    expect(pingBarCount(null)).toBe(0);
  });
});
