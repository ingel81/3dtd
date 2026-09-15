// CommonModule pulls in partially compiled @angular/common, which needs the JIT compiler
import '@angular/compiler';
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { TrainingDebuggerComponent } from './training-debugger.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { GameStateManager } from '../../managers/game-state.manager';
import { TrainingClientService } from '../../ai/training/training-client.service';
import { WaveDirectorService } from '../../ai/core/wave-director.service';
import type { ModelFit } from '../../ai/core/onnx-policy';

// TestBed rather than a bare Injector: the panel's effect needs the
// change-detection scheduler, and TestBed.tick() is what runs it.
beforeAll(() => {
  getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
});

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
    modelFit: signal<ModelFit | null>(null),
    checkModel: vi.fn(async (): Promise<ModelFit> => 'wrong-input-size'),
  };
  const trainingWindow = signal({ isOpen: false });
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: DebugWindowService, useValue: { trainingWindow } },
      { provide: GameStateManager, useValue: gameState },
      { provide: TrainingClientService, useValue: trainingClient },
      { provide: WaveDirectorService, useValue: waveDirector },
    ],
  });
  const panel = TestBed.runInInjectionContext(() => new TrainingDebuggerComponent());
  return { panel, gameState, trainingClient, waveDirector, trainingWindow, finishLoad: () => resolveLoad() };
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

  it('offers the ONNX opt-in only while the checked-in model fits the encoder', () => {
    const { panel, waveDirector } = setup();
    expect(panel.canLoadModel()).toBe(false);            // not asked yet
    waveDirector.modelFit.set('wrong-input-size');       // the 156-input model from schema v2
    expect(panel.canLoadModel()).toBe(false);
    waveDirector.modelFit.set('no-model');
    expect(panel.canLoadModel()).toBe(false);
    waveDirector.modelFit.set('fits');
    expect(panel.canLoadModel()).toBe(true);
  });

  it('asks whether the model fits each time the window opens, not while it is closed', () => {
    const { waveDirector, trainingWindow } = setup();
    TestBed.tick();
    expect(waveDirector.checkModel).not.toHaveBeenCalled();

    trainingWindow.set({ isOpen: true });
    TestBed.tick();
    expect(waveDirector.checkModel).toHaveBeenCalledTimes(1);

    trainingWindow.set({ isOpen: false });
    TestBed.tick();
    trainingWindow.set({ isOpen: true });
    TestBed.tick();
    expect(waveDirector.checkModel).toHaveBeenCalledTimes(2);
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
