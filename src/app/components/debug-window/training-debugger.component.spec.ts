// CommonModule pulls in partially compiled @angular/common, which needs the JIT compiler
import '@angular/compiler';
import { describe, it, expect, vi } from 'vitest';
import { DestroyRef, Injector, runInInjectionContext } from '@angular/core';
import { TrainingDebuggerComponent } from './training-debugger.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { GameStateManager } from '../../managers/game-state.manager';
import { TrainingClientService } from '../../ai/training/training-client.service';
import { WaveDirectorService } from '../../ai/core/wave-director.service';

function setup(connected = false) {
  const gameState = { setTrainingTimescale: vi.fn() };
  const trainingClient = {
    isConnected: vi.fn(() => connected),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    enableBot: vi.fn(),
    disableBot: vi.fn(),
  };
  let resolveLoad: () => void = () => undefined;
  const waveDirector = {
    aiMode: vi.fn(() => 'rules'),
    statusText: vi.fn(() => 'Rule director'),
    loadModel: vi.fn(() => new Promise<void>((resolve) => (resolveLoad = resolve))),
    forceRuleMode: vi.fn(),
  };
  const injector = Injector.create({
    providers: [
      { provide: DebugWindowService, useValue: {} },
      { provide: GameStateManager, useValue: gameState },
      { provide: TrainingClientService, useValue: trainingClient },
      { provide: WaveDirectorService, useValue: waveDirector },
      { provide: DestroyRef, useValue: { onDestroy: () => () => undefined, destroyed: false } },
    ],
  });
  const panel = runInInjectionContext(injector, () => new TrainingDebuggerComponent());
  return { panel, gameState, trainingClient, waveDirector, finishLoad: () => resolveLoad() };
}

describe('TrainingDebuggerComponent', () => {
  it('sets the training timescale from the slider and the preset buttons', () => {
    const { panel, gameState } = setup();
    panel.onTimescaleChange({ target: { value: '8' } } as unknown as Event);
    panel.setTimescale(25);
    expect(gameState.setTrainingTimescale.mock.calls).toEqual([[8], [25]]);
  });

  it('connects to the backend when disconnected and disconnects when connected', async () => {
    const offline = setup(false);
    await offline.panel.toggleConnection();
    expect(offline.trainingClient.connect).toHaveBeenCalledOnce();
    expect(offline.trainingClient.disconnect).not.toHaveBeenCalled();

    const online = setup(true);
    await online.panel.toggleConnection();
    expect(online.trainingClient.disconnect).toHaveBeenCalledOnce();
    expect(online.trainingClient.connect).not.toHaveBeenCalled();
  });

  it('reports training mode while the backend is connected, the director otherwise', () => {
    const offline = setup(false);
    expect(offline.panel.getAIMode()).toBe('rules');
    expect(offline.panel.getModelStatus()).toBe('Rule director');
    const online = setup(true);
    expect(online.panel.getAIMode()).toBe('training');
    expect(online.panel.getModelStatus()).toBe('Backend Training Model');
  });

  it('loads the ONNX model on request and shows it loading until done', async () => {
    const { panel, waveDirector, finishLoad } = setup();
    expect(panel.loadingModel()).toBe(false);
    const loading = panel.loadOnnxModel();
    expect(panel.loadingModel()).toBe(true);
    finishLoad();
    await loading;
    expect(panel.loadingModel()).toBe(false);
    expect(waveDirector.loadModel).toHaveBeenCalledOnce();
  });

  it('drops back to the rule director', () => {
    const { panel, waveDirector } = setup();
    panel.useRules();
    expect(waveDirector.forceRuleMode).toHaveBeenCalledOnce();
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
    const { panel, trainingClient } = setup();
    expect(() => {
      panel.enableBot('casual');
      panel.disableBot();
    }).not.toThrow();
    expect(trainingClient.enableBot).not.toHaveBeenCalled();
    expect(trainingClient.disableBot).not.toHaveBeenCalled();
  });

  it('hands the bot buttons to the parent as outputs', () => {
    const { panel, trainingClient } = setup();
    const requests: string[] = [];
    panel.botEnableRequested.subscribe((skill) => requests.push(skill));
    panel.botDisableRequested.subscribe(() => requests.push('off'));
    panel.enableBot('casual');
    panel.enableBot('meta');
    panel.disableBot();
    expect(requests).toEqual(['casual', 'meta', 'off']);
    expect(trainingClient.enableBot).not.toHaveBeenCalled();
  });
});
