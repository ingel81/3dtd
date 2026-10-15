import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app';
import { installThemeVars, TD_FONTS } from './app/styles/td-theme';

declare const ngDevMode: unknown;

// The --td-* tokens once on :root, so overlays outside the component tree see them too
installThemeVars(document);

// Canvas text (damage numbers, the globe, the screenshot stamp) draws with the
// UI font and caches it: load its weights now, long before the first frame
for (const weight of [500, 600, 700]) {
  void document.fonts?.load(`${weight} 16px ${TD_FONTS.ui}`).catch(() => undefined);
}

// The showreel hook (tools/showreel): development builds only, where `?showreel` asks for it. A production
// build defines ngDevMode as false, so the branch and its chunk drop out of the bundle.
const showreel =
  (typeof ngDevMode === 'undefined' || !!ngDevMode) && new URLSearchParams(location.search).has('showreel')
    ? import('./app/showreel/showreel').then((m) => {
        m.installShowreelEarly();
        return m;
      })
    : Promise.resolve(null);

showreel
  .then((hook) =>
    bootstrapApplication(AppComponent, hook ? { ...appConfig, providers: [...appConfig.providers, ...hook.SHOWREEL_PROVIDERS] } : appConfig).then((app) =>
      hook?.startShowreel(app.injector),
    ),
  )
  .catch((err) => console.error(err));
