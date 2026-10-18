/**
 * The main menu's pages (docs/MAIN_MENU_UI_PLAN.md): the list, and what an
 * entry of it opens beside it. A file of its own without imports, so the
 * UIStore can name the types without pulling in the menu.
 */
export type MenuPage = 'home' | 'new-game' | 'coop' | 'saves' | 'settings' | 'extras';

/**
 * The menu's two layers: `start` stands in front of the scene that loads
 * behind it, before a run is played; `pause` is Esc in the game, over a
 * darkened map. Same list, same pages.
 */
export type MenuLayer = 'start' | 'pause';

/** The menu as the UIStore holds it */
export interface MainMenuState {
  open: boolean;
  layer: MenuLayer;
  page: MenuPage;
}

/** A page's title: its heading, and the dialog's name while it shows */
export const MENU_PAGE_TITLES: Readonly<Record<MenuPage, string>> = {
  home: 'Menu',
  'new-game': 'New game',
  coop: 'Coop',
  saves: 'Saves',
  settings: 'Settings',
  extras: 'Extras',
};
