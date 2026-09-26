/**
 * The chat under the squad box over time (docs/COOP_UI_REWORK_PLAN.md, T14,
 * U8): a line dims after 15 s and goes after 60 s; the clock ticks only
 * while a line is shown, none shown, no timer; the key line goes once the
 * player sent a message. Real template, a stand-in CoopService, fake timers.
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { MatDialog } from '@angular/material/dialog';
import { CoopChatComponent } from './coop-chat.component';
import { CoopService } from '../../services/coop.service';

const template = readFileSync(resolve('src/app/components/coop-chat/coop-chat.component.html'), 'utf8');

describe('Coop chat lines over time', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  function setup() {
    vi.useFakeTimers();
    const coop = {
      inGame: signal(true),
      room: signal({ code: 'ABC123' }),
      chat: signal<{ id: number; from: string | null; text: string; warn: boolean; at: number }[]>([]),
      pingArmed: signal(false),
      nameOf: () => 'Ann',
      laneColorOf: () => '#ef4444',
      armPing: vi.fn(),
      cancelPing: vi.fn(),
      sendChat: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: CoopService, useValue: coop },
        { provide: MatDialog, useValue: { openDialogs: [] } },
      ],
    });
    TestBed.overrideComponent(CoopChatComponent, {
      set: { template, templateUrl: undefined, styleUrl: undefined, styles: [] },
    });
    const fixture = TestBed.createComponent(CoopChatComponent);
    fixture.detectChanges();
    const lines = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.line'));
    // In steps of the chat's clock: each tick's effect plans the next one
    const step = (ms: number) => {
      for (let left = ms; left >= 0; left -= 5000) {
        vi.advanceTimersByTime(Math.min(left, 5000));
        TestBed.tick();
        fixture.detectChanges();
        if (left === 0) break;
      }
    };
    return { coop, fixture, chat: fixture.componentInstance, lines, step };
  }

  it('dims a line after 15 s, drops it after 60 s, and then keeps no timer', () => {
    const { coop, lines, step } = setup();
    coop.chat.set([{ id: 1, from: 'p1', text: 'rockets on the corner', warn: false, at: Date.now() }]);
    step(0);
    expect(lines()).toHaveLength(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    step(20_000);
    expect(lines()[0].classList.contains('is-old')).toBe(true);

    step(45_000);
    expect(lines()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows the key line until the player sent a message', () => {
    const { chat, fixture } = setup();
    const hint = () => (fixture.nativeElement as HTMLElement).querySelector('.hint');
    expect(hint()).not.toBeNull();
    chat.send('   ');
    fixture.detectChanges();
    expect(hint()).not.toBeNull();
    chat.send('hello');
    fixture.detectChanges();
    expect(hint()).toBeNull();
  });
});
