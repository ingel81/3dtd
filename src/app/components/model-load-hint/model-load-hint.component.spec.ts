// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ModelLoadHintComponent, modelLabel } from './model-load-hint.component';
import { AssetManagerService } from '../../services/infrastructure/asset-manager.service';
import { TOWER_TYPES } from '../../configs/tower-types.config';

const template = readFileSync(resolve('src/app/components/model-load-hint/model-load-hint.component.html'), 'utf8');

function setup() {
  TestBed.overrideComponent(ModelLoadHintComponent, {
    // The icon's signal inputs need the AOT compiler; the icon is no part of this test
    set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [], schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(ModelLoadHintComponent);
  const assets = TestBed.inject(AssetManagerService);
  const fail = (url: string) => {
    assets.failedModels.update((urls) => [...urls, url]);
    fixture.detectChanges();
  };
  fixture.detectChanges();
  return { fixture, fail, el: fixture.nativeElement as HTMLElement };
}

describe('ModelLoadHintComponent', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });
  afterEach(() => TestBed.resetTestingModule());

  it('names a tower by its name and another model by its file', () => {
    const archer = TOWER_TYPES.archer;
    expect(modelLabel(archer.modelUrl)).toBe(archer.name);
    expect(modelLabel('assets/models/portal-frame.glb')).toBe('portal-frame');
  });

  it('shows nothing while every model loaded', () => {
    const { el } = setup();
    expect(el.querySelector('.mh')).toBeNull();
  });

  it('names the failed models, and comes back for one that fails after hiding', () => {
    const { el, fail, fixture } = setup();
    fail(TOWER_TYPES.archer.modelUrl);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(TOWER_TYPES.archer.name);
    (el.querySelector('.mh-action:not(.mh-reload)') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.mh')).toBeNull();
    fail('assets/models/portal-frame.glb');
    expect(el.querySelector('.mh-line')?.textContent).toContain('portal-frame');
  });
});
