/**
 * Playtest 161 of night 1 (docs/archive/REVIEW_SPRINT_2026-09-13.md) replayed:
 * "Map Key" opens the token screen, Esc closes it; with the key deleted and
 * the page reloaded, the token screen is back and Esc does not leave it.
 *
 * The real ConfigService with a production build's environment (no
 * credentials, mocked below) and jsdom's localStorage; the real
 * TokenSetupComponent template (read from disk) with its document Esc
 * listener. The sidebar's "Map Key" is GameSidebarComponent.openTokenSetup,
 * which only sets config.setupRequested; the game shows the screen while
 * `awaitingCredentials() || credentialsRejected() || setupRequested()`
 * (tower-defense.component.html:50), and sets awaitingCredentials on start
 * when needsCredentials() (TowerDefenseComponent.ngAfterViewInit). Both are
 * one-liners read here, not rendered. Not covered: that the screen's chunk
 * loads (48618172, a @defer), and how it looks.
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, Input, input } from '@angular/core';
import { getTestBed, TestBed, type ComponentFixture } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

// A production build: no credentials in the bundle
vi.mock('../../../environments/environment', () => ({
  environment: { production: true, googleMapsApiKey: '', cesiumIonToken: '', cesiumAssetId: '2275207', tileProvider: 'cesium' },
}));

import { ConfigService } from '../../core/services/config.service';
import { TokenSetupComponent } from './token-setup.component';

const template = readFileSync(resolve('src/app/components/token-setup/token-setup.component.html'), 'utf8');
const STORAGE_KEY = '3dtd-tile-credentials';

@Component({ selector: 'td-icon', standalone: true, template: '' })
class IconStub {
  readonly name = input('');
  readonly size = input(16);
}
// The @Input annotation the JIT transform adds for input() (see world-map.scenario.spec.ts)
for (const name of ['name', 'size']) {
  Input({ alias: name, isSignal: true } as Input)(IconStub.prototype, name);
}

/** What the game shows the token screen for (tower-defense.component.html:50) */
const screenShown = (config: ConfigService, awaitingCredentials: boolean) =>
  awaitingCredentials || config.credentialsRejected() || config.setupRequested();

describe('Map Key and the token screen, playtest 161 (night 1) replayed', () => {
  let config: ConfigService;
  let fixture: ComponentFixture<TokenSetupComponent>;

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(async () => {
    localStorage.clear();
    // No runtime-config.json next to the page
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    TestBed.configureTestingModule({});
    TestBed.overrideComponent(TokenSetupComponent, {
      set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [IconStub] },
    });
    config = TestBed.inject(ConfigService);
    await config.load();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const render = () => {
    fixture = TestBed.createComponent(TokenSetupComponent);
    fixture.detectChanges();
  };
  const pressEsc = () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
  };
  const backButton = () => (fixture.nativeElement as HTMLElement).querySelector('.token-back');

  it('Map Key in a running game opens the screen, Esc goes back to the game', () => {
    // A key stored earlier, the game runs
    config.setCredentials('cesium', 'stored-token');
    expect(config.needsCredentials()).toBe(false);
    expect(screenShown(config, false)).toBe(false);

    // "Map Key" in the sidebar footer
    config.setupRequested.set(true);
    expect(screenShown(config, false)).toBe(true);
    render();
    expect(backButton()?.textContent).toContain('ESC');

    pressEsc();
    expect(config.setupRequested()).toBe(false);
    expect(screenShown(config, false)).toBe(false);
    // The key is untouched
    expect(config.cesiumIonToken()).toBe('stored-token');
  });

  it('with the key deleted and the page reloaded the screen is back, and Esc does not leave it', async () => {
    config.setCredentials('cesium', 'stored-token');
    config.setupRequested.set(true);
    render();

    // Delete the key: the screen's clear(), as clearing the site data would
    fixture.componentInstance.clear();
    fixture.detectChanges();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    // Nothing to go back to any more: no way out, Esc included
    expect(backButton()).toBeNull();
    pressEsc();
    expect(config.setupRequested()).toBe(true);

    // Reload: a fresh ConfigService finds no key in the build, the file or the browser
    const reloaded = new ConfigService();
    await reloaded.load();
    expect(reloaded.needsCredentials()).toBe(true);
    expect(reloaded.hasStoredToken()).toBe(false);
    // So the game waits for credentials on start and shows the screen
    const awaitingCredentials = reloaded.needsCredentials();
    expect(screenShown(reloaded, awaitingCredentials)).toBe(true);
  });

  it('a first start without any key shows the screen, and Esc does not leave it', () => {
    expect(config.needsCredentials()).toBe(true);
    expect(screenShown(config, config.needsCredentials())).toBe(true);
    render();
    expect(backButton()).toBeNull();
    pressEsc();
    expect(config.needsCredentials()).toBe(true);
    expect(fixture.componentInstance.dismissible()).toBe(false);
  });
});
