/**
 * The coop keys (docs/COOP_UI_REWORK_PLAN.md, U5): Tab opens and closes the
 * room dock, Enter the chat, X arms the ping, but a control the player
 * reached by keyboard keeps Tab and Enter, and inside the dock Tab walks its
 * controls. CoopChatComponent with its real template and a stand-in CoopService. A focus
 * right after a pointer press counts as the mouse's (FocusOrigin), any other as the keyboard's.
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
import { UIStore } from '../../store/ui.store';

const template = readFileSync(resolve('src/app/components/coop-chat/coop-chat.component.html'), 'utf8');

function setup(inGame: boolean) {
  const coop = {
    inGame: signal(inGame),
    room: signal({ code: 'ABC123' }),
    chat: signal([]),
    pingArmed: signal(false),
    nameOf: () => 'Ann',
    laneColorOf: () => '#c0a060',
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
  return { coop, ui: TestBed.inject(UIStore), chat: fixture.componentInstance };
}

/** A key pressed with the focus on `target` */
function press(key: string, target: Element = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

/** Focus `el` as a click does: a pointer press first */
function clickFocus(el: HTMLElement): void {
  el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  el.focus();
}

/** Focus `el` as Tab does: no pointer press */
function keyboardFocus(el: HTMLElement): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
  el.focus();
}

function button(parent: Element = document.body): HTMLButtonElement {
  const el = document.createElement('button');
  parent.appendChild(el);
  return el;
}

describe('Coop keys', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('Tab on the map opens and closes the dock', () => {
    const { ui } = setup(false);
    const event = press('Tab');
    expect(ui.coopDockOpen()).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    press('Tab');
    expect(ui.coopDockOpen()).toBe(false);
  });

  it('Tab inside the dock walks its controls, even after a mouse click', () => {
    const { ui } = setup(false);
    ui.coopDockOpen.set(true);
    const dock = document.createElement('app-coop-dock');
    document.body.appendChild(dock);
    const el = button(dock);
    clickFocus(el);
    const event = press('Tab', el);
    expect(ui.coopDockOpen()).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it('Tab on a sidebar button reached by keyboard moves the focus on', () => {
    const { ui } = setup(false);
    const el = button();
    keyboardFocus(el);
    const event = press('Tab', el);
    expect(ui.coopDockOpen()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('Enter presses a button reached by keyboard, it opens no chat', () => {
    const { chat } = setup(true);
    const el = button();
    keyboardFocus(el);
    const event = press('Enter', el);
    expect(chat.writing()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('Enter after a mouse click on a button opens the chat, X arms the ping', () => {
    const { chat, coop } = setup(true);
    const el = button();
    clickFocus(el);
    const event = press('Enter', el);
    expect(chat.writing()).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    chat.close();
    press('x', el);
    expect(coop.armPing).toHaveBeenCalledTimes(1);
  });

  it('Esc takes back an armed ping and keeps the key from the Esc chain', () => {
    const { coop } = setup(true);
    coop.pingArmed.set(true);
    const event = press('Escape');
    expect(coop.cancelPing).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });
});
