// CommonModule pulls in partially compiled @angular/common, which needs the JIT compiler
import '@angular/compiler';
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { BotDebuggerComponent } from './bot-debugger.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { GameStateManager } from '../../managers/game-state.manager';
import { BotClientService } from '../../bots/bot-client.service';
import { WaveDirector } from '../../director/wave-director';

// TestBed rather than a bare Injector: the panel is a component, and
// TestBed.runInInjectionContext gives it the scheduler it expects.
beforeAll(() => {
  getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
});

function setup(connected = false) {
  const gameState = { setGameSpeed: vi.fn() };
  const botClient = {
    isConnected: vi.fn(() => connected),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    enableBot: vi.fn(),
    disableBot: vi.fn(),
  };
  const waveDirector = { pressure: { pressureMultiplier: 1 } };
  const botWindow = signal({ isOpen: false });
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: DebugWindowService, useValue: { botWindow } },
      { provide: GameStateManager, useValue: gameState },
      { provide: BotClientService, useValue: botClient },
      { provide: WaveDirector, useValue: waveDirector },
    ],
  });
  const panel = TestBed.runInInjectionContext(() => new BotDebuggerComponent());
  return { panel, gameState, botClient, waveDirector, botWindow };
}

describe('BotDebuggerComponent', () => {
  it('sets the training timescale from the slider and the preset buttons', () => {
    const { panel, gameState } = setup();
    panel.onTimescaleChange({ target: { value: '8' } } as unknown as Event);
    panel.setTimescale(25);
    expect(gameState.setGameSpeed.mock.calls).toEqual([[8], [25]]);
  });

  it('connects to the backend when disconnected and disconnects when connected', async () => {
    const offline = setup(false);
    await offline.panel.toggleConnection();
    expect(offline.botClient.connect).toHaveBeenCalledOnce();
    expect(offline.botClient.disconnect).not.toHaveBeenCalled();

    const online = setup(true);
    await online.panel.toggleConnection();
    expect(online.botClient.disconnect).toHaveBeenCalledOnce();
    expect(online.botClient.connect).not.toHaveBeenCalled();
  });

  it('reports each DPS-bin toggle to the parent', () => {
    const { panel } = setup();
    const toggled: boolean[] = [];
    panel.dpsBinsToggled.subscribe((visible) => toggled.push(visible));
    panel.toggleDpsBins();
    panel.toggleDpsBins();
    expect(toggled).toEqual([true, false]);
    expect(panel.showDpsBins()).toBe(false);
  });

  it('leaves the bot alone while no parent handles the bot buttons', () => {
    const { panel, botClient } = setup();
    expect(() => {
      panel.enableBot('beginner');
      panel.disableBot();
    }).not.toThrow();
    expect(botClient.enableBot).not.toHaveBeenCalled();
    expect(botClient.disableBot).not.toHaveBeenCalled();
  });

  it('hands the bot buttons to the parent as outputs', () => {
    const { panel, botClient } = setup();
    const requests: string[] = [];
    panel.botEnableRequested.subscribe((skill) => requests.push(skill));
    panel.botDisableRequested.subscribe(() => requests.push('off'));
    panel.enableBot('beginner');
    panel.enableBot('expert');
    panel.disableBot();
    expect(requests).toEqual(['beginner', 'expert', 'off']);
    expect(botClient.enableBot).not.toHaveBeenCalled();
  });
});
