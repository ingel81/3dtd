import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app';
import { installThemeVars, TD_FONTS } from './app/styles/td-theme';

// The --td-* tokens once on :root, so overlays outside the component tree see them too
installThemeVars(document);

// Canvas text (damage numbers, the globe, the screenshot stamp) draws with the
// UI font and caches it: load its weights now, long before the first frame
for (const weight of [500, 600, 700]) {
  void document.fonts?.load(`${weight} 16px ${TD_FONTS.ui}`).catch(() => undefined);
}

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
