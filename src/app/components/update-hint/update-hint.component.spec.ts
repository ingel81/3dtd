/**
 * The update hint of the desktop app sits in the CDK overlay above every
 * dialog: the modal location dialog of the first start swallowed the click on
 * "Restart now" while the hint lived in the game's own layer (0.5.0-beta.2
 * offering 0.5.0).
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import { UpdateHintComponent } from './update-hint.component';
import type { DesktopUpdate } from '../../core/desktop-bridge';

const template = readFileSync(resolve('src/app/components/update-hint/update-hint.component.html'), 'utf8');

function setup() {
  let listener: ((update: DesktopUpdate) => void) | null = null;
  const bridge = {
    version: '0.5.0-beta.2',
    onUpdateReady: (l: (update: DesktopUpdate) => void) => {
      listener = l;
      return () => (listener = null);
    },
    installUpdateNow: vi.fn(),
    saveRun: vi.fn(),
  };
  (window as unknown as { desktop?: unknown }).desktop = bridge;
  TestBed.overrideComponent(UpdateHintComponent, {
    // The icon's signal inputs need the AOT compiler; the icon is no part of this test
    set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [], schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(UpdateHintComponent);
  fixture.detectChanges();
  const container = TestBed.inject(OverlayContainer).getContainerElement();
  const offer = async () => {
    listener?.({ version: '0.5.0', notes: '### New\n- Co-op' } as DesktopUpdate);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { fixture, bridge, container, offer };
}

describe('UpdateHintComponent', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    delete (window as unknown as { desktop?: unknown }).desktop;
  });

  it('shows nothing until an update is ready', () => {
    const { container } = setup();
    expect(container.querySelector('.uh')).toBeNull();
  });

  it('puts the chip into the overlay, in the layer above the dialogs', async () => {
    const { fixture, container, offer } = setup();
    await offer();
    const chip = container.querySelector('.uh');
    expect(chip).not.toBeNull();
    // Not in the game's layer, where a modal backdrop covers it
    expect(fixture.nativeElement.querySelector('.uh')).toBeNull();
    expect(chip!.closest('.td-update-hint-host')).not.toBeNull();
  });

  it('restarts from the overlay and takes the chip away on Later', async () => {
    const { fixture, bridge, container, offer } = setup();
    await offer();
    (container.querySelector('.uh-restart') as HTMLButtonElement).click();
    expect(bridge.installUpdateNow).toHaveBeenCalledTimes(1);

    const later = [...container.querySelectorAll<HTMLButtonElement>('.uh-action')].find((b) => b.textContent === 'Later');
    later!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(container.querySelector('.uh')).toBeNull();
  });
});
