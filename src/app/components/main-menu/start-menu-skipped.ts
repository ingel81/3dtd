/**
 * The start menu stays away for automated runs (docs/MAIN_MENU_UI_PLAN.md,
 * Menü 10): a bot (`?bot=`, except `bot=manual`, where a person plays), the
 * benchmark (`&benchmark`) and `&menu=skip`. The game then starts as soon as
 * its place stands, as before the menu.
 */
export function startMenuSkipped(search: string): boolean {
  const params = new URLSearchParams(search);
  const bot = params.get('bot');
  return (bot !== null && bot !== 'manual') || params.has('benchmark') || params.get('menu') === 'skip';
}
