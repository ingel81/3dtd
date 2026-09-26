// CommonModule and MatTooltipModule are partially compiled and need the JIT compiler
import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// No view here: the effects that flash the HQ bar and focus the name field
// have nothing to act on
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return { ...actual, effect: () => undefined, afterRenderEffect: () => undefined };
});

import { DestroyRef, ElementRef, Injector, runInInjectionContext, signal } from '@angular/core';
import { GameHeaderComponent } from './game-header.component';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { DevWorldService } from '../../devworld/devworld.service';
import { LocationManagementService } from '../../services/location/location-management.service';
import { GeocodingService } from '../../services/location/geocoding.service';
import { PathAndRouteService } from '../../services/world/path-route.service';
import { ownsKey } from '../../utils/keyboard-target';

/**
 * Playtest 538 to 540 (docs/archive/REVIEW_FIX_2026-09-14.md) replayed on the
 * header's class without a view: its methods are what the template binds
 * (pencil, arrows, (keydown.enter), (keydown.escape), document:click), the
 * name field is a real input handed in as the template's #favInput. Rename
 * and order go to the real LocationManagementService, which the coordinator
 * passes them to (location-change-coordinator.service.ts onRenameFavorite,
 * onMoveFavorite).
 */
describe('Favorites menu, playtest 538 to 540 replayed', () => {
  let header: GameHeaderComponent;
  let locations: LocationManagementService;
  let host: HTMLElement;
  let field: HTMLInputElement;
  const PARIS = { lat: 48.8584, lon: 2.2945 };

  const createLocations = () => {
    const injector = Injector.create({
      providers: [
        { provide: GeocodingService, useValue: {} },
        { provide: PathAndRouteService, useValue: { hasRoutes: signal(false) } },
      ],
    });
    return runInInjectionContext(injector, () => new LocationManagementService());
  };
  const names = () => locations.favorites().map((f) => f.name);

  beforeEach(() => {
    localStorage.clear();
    locations = createLocations();
    locations.hq.set(PARIS);
    for (const name of ['Eiffel', 'Louvre', 'Montmartre']) locations.saveFavorite(name);

    host = document.createElement('app-game-header');
    const wrapper = document.createElement('div');
    wrapper.className = 'fav-wrapper';
    field = document.createElement('input');
    field.type = 'text';
    wrapper.appendChild(field);
    host.appendChild(wrapper);
    document.body.appendChild(host);

    const injector = Injector.create({
      providers: [
        { provide: ElementRef, useValue: new ElementRef(host) },
        { provide: TowerDefenseStore, useValue: { renderingEnabled: signal(true) } },
        { provide: DevWorldService, useValue: { isActive: false } },
        { provide: DestroyRef, useValue: { onDestroy: () => () => undefined, destroyed: false } },
      ],
    });
    header = runInInjectionContext(injector, () => new GameHeaderComponent());
    // The name field the template renders (#favInput)
    Object.defineProperty(header, 'favInput', { value: () => new ElementRef(field) });
    header.renameFavoriteClick.subscribe(({ id, name }) => locations.renameFavorite(id, name));
    header.moveFavoriteClick.subscribe(({ id, offset }) => locations.moveFavorite(id, offset));
    header.toggleFavMenu();
  });

  afterEach(() => host.remove());

  const fav = (index: number) => locations.favorites()[index];

  it('538: pencil and Enter rename, pencil and Esc on another keep its name, an emptied field goes back to the address', () => {
    header.startRenameFavorite(fav(0));
    expect(header.favDraftName()).toBe('Eiffel');
    field.value = 'Tower';
    header.commitFavoriteName(); // (keydown.enter)
    expect(names()).toEqual(['Tower', 'Louvre', 'Montmartre']);
    expect(header.favEditing()).toBeNull();
    expect(header.favMenuExpanded()).toBe(true);

    header.startRenameFavorite(fav(1));
    field.value = 'Something else';
    header.cancelFavoriteName(new KeyboardEvent('keydown', { key: 'Escape' })); // (keydown.escape)
    expect(names()).toEqual(['Tower', 'Louvre', 'Montmartre']);
    expect(header.favEditing()).toBeNull();

    header.startRenameFavorite(fav(2));
    field.value = '';
    header.commitFavoriteName();
    expect(fav(2)).not.toHaveProperty('name');
    // Until the coordinator has looked the address up again (resolveFavoriteNames)
    expect(header.favoriteName(fav(2))).toBe('Loading...');
  });

  it('539: the arrows move a favorite one place, not past either end, and the order and names survive a reload', () => {
    const ids = () => locations.favorites().map((f) => f.id);
    const [first, second, third] = ids();

    header.onMoveFavorite(third, -1);
    expect(ids()).toEqual([first, third, second]);
    header.onMoveFavorite(first, 1);
    expect(ids()).toEqual([third, first, second]);
    // The top one cannot go up, the bottom one not down (the template disables both)
    header.onMoveFavorite(third, -1);
    header.onMoveFavorite(second, 1);
    expect(ids()).toEqual([third, first, second]);

    // F5: a new service reads td_favorites_v2
    expect(createLocations().favorites().map((f) => [f.id, f.name])).toEqual(
      locations.favorites().map((f) => [f.id, f.name]),
    );
  });

  it('540: W, A, S, D, Space and Esc stay in the name field, Esc closes only the field, a click outside closes the menu and drops it', () => {
    header.startRenameFavorite(fav(0));
    // InputHandlerService and HotkeyService leave every key the field owns alone
    for (const key of ['w', 'a', 's', 'd', ' ', 'Escape']) expect(ownsKey(field, key), key).toBe(true);

    // (keydown.escape) on the field: the field closes, the key goes no further
    const windowKeys = vi.fn();
    const onFieldKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') header.cancelFavoriteName(e);
    };
    field.addEventListener('keydown', onFieldKey);
    window.addEventListener('keydown', windowKeys);
    try {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } finally {
      field.removeEventListener('keydown', onFieldKey);
      window.removeEventListener('keydown', windowKeys);
    }
    expect(windowKeys).not.toHaveBeenCalled();
    expect(header.favEditing()).toBeNull();
    expect(header.favMenuExpanded()).toBe(true);

    // document:click: inside the menu it stays, outside it closes with the open field
    header.startRenameFavorite(fav(1));
    const onDocumentClick = (e: MouseEvent) => header.onDocumentClick(e);
    document.addEventListener('click', onDocumentClick);
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    try {
      field.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(header.favMenuExpanded()).toBe(true);
      expect(header.favEditing()).toBe(fav(1).id);

      outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } finally {
      document.removeEventListener('click', onDocumentClick);
      outside.remove();
    }
    expect(header.favMenuExpanded()).toBe(false);
    expect(header.favEditing()).toBeNull();
    expect(names()).toEqual(['Eiffel', 'Louvre', 'Montmartre']);
  });

  it('Esc closes the spawn menu and keeps the key from the game; with the menu shut it leaves the key alone', () => {
    header.spawnMenuOpen.set(true);
    const first = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    header.onEscape(first);
    expect(header.spawnMenuOpen()).toBe(false);
    expect(first.defaultPrevented).toBe(true);
    const second = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    header.onEscape(second);
    expect(second.defaultPrevented).toBe(false);
  });
});
