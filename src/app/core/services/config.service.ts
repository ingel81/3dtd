import { Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ConfigService {
  readonly googleMapsApiKey = signal(environment.googleMapsApiKey);
  readonly loaded = signal(true);
  readonly isBrowserPlayback = signal(true);
}
