/**
 * The menu's Saves page: Save and Load as two tabs of one page, Save first
 * while the run can be saved, and the run's Restart under them, asked first
 * while a run is under way. The slots are a stand-in; their own spec is
 * save-slots.scenario.spec.
 */
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Component, Input, input, signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { SAVE_GAME } from '../../../../services/save-game/save-game.port';
import { MainMenuService } from '../../main-menu.service';
import { SaveSlotsComponent } from '../save-load/save-slots.component';
import { MenuSavesComponent } from './menu-saves.component';

@Component({ selector: 'app-save-slots', standalone: true, template: '<p class="slots-stub">{{ mode() }}</p>' })
class SlotsStub {
  readonly mode = input('load');
}
Input({ alias: 'mode', isSignal: true } as Input)(SlotsStub.prototype, 'mode');
Input({ alias: 'layer', required: true, isSignal: true } as Input)(MenuSavesComponent.prototype, 'layer');

describe('Saves page', () => {
  beforeAll(() => {
    try {
      getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
    } catch {
      // Another spec of this worker set it up
    }
  });

  afterEach(() => TestBed.resetTestingModule());

  function setup(canSave: boolean, underWay: boolean) {
    const menu = { canRestart: signal(true), underWay: signal(underWay), restart: vi.fn(), requestPlay: vi.fn(), restartLabel: signal('Restart here') };
    TestBed.configureTestingModule({
      providers: [{ provide: MainMenuService, useValue: menu }, { provide: SAVE_GAME, useValue: { canSave: signal(canSave) } }],
    });
    TestBed.overrideComponent(MenuSavesComponent, { remove: { imports: [SaveSlotsComponent] }, add: { imports: [SlotsStub] } });
    const fixture = TestBed.createComponent(MenuSavesComponent);
    fixture.componentRef.setInput('layer', 'pause');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const click = (target: Element | null | undefined) => {
      (target as HTMLElement).click();
      fixture.detectChanges();
    };
    const button = (label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
    return { el, menu, click, button };
  }

  it('opens on Save while the run can be saved, else on Load; the tabs switch the slots', () => {
    const saving = setup(true, true);
    expect(saving.el.querySelector('.slots-stub')?.textContent).toBe('save');
    saving.click(saving.el.querySelector('[data-tab="load"]'));
    expect(saving.el.querySelector('.slots-stub')?.textContent).toBe('load');
    TestBed.resetTestingModule();

    const loading = setup(false, false);
    expect(loading.el.querySelector('[data-tab="load"]')?.getAttribute('aria-selected')).toBe('true');
  });

  it('Restart of the run stands under the slots, asked first while a run is under way', () => {
    const { el, menu, click, button } = setup(true, true);
    click(el.querySelector('[data-test="restart"]'));
    expect(menu.restart).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Restart here? The run ends.');
    click(button('Restart'));
    expect(menu.restart).toHaveBeenCalledTimes(1);
  });
});
