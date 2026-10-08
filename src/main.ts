import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app';
import { installThemeVars } from './app/styles/td-theme';

// The --td-* tokens once on :root, so overlays outside the component tree see them too
installThemeVars(document);

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
