import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { ConfigService } from '../../core/services/config.service';
import { TdIconComponent } from '../icon/icon.component';
import { TD_CSS_VARS } from '../../styles/td-theme';

/**
 * First-run screen that asks the player for their own tile credentials.
 *
 * The game streams Google's Photorealistic 3D Tiles, which are billed per
 * request, shipping a build with the maintainer's token would mean handing
 * every player a share of that bill. So the build ships without credentials and
 * the player brings their own; they stay in this browser's `localStorage` and
 * are sent only to the tile provider.
 *
 * Both routes to the same tiles stay open: Cesium Ion (an ion token, works
 * anywhere) or Google's Map Tiles API directly (an API key, restricted by HTTP
 * referrer and not available in every region).
 *
 * Shown before the engine starts (no credentials at all) and after a rejected
 * one, which is why the copy has to work for both cases.
 */
@Component({
  selector: 'td-token-setup',
  standalone: true,
  imports: [TdIconComponent],
  host: { '(document:keydown.escape)': 'dismiss()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="token-setup">
      <td-icon class="token-icon" [name]="rejected() ? 'warn' : 'lock'" [size]="40"></td-icon>

      @if (rejected()) {
        <h2>Key rejected</h2>
        <p class="token-lead">The tile server refused it. Check you pasted the whole thing.</p>
      } @else {
        <h2>Bring your own map key</h2>
        <p class="token-lead">
          The 3D tiles are billed per request, so this build ships without a key.
          A free account covers playing.
        </p>
      }

      <div class="token-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="token-tab"
          [class.active]="provider() === 'cesium'"
          [attr.aria-selected]="provider() === 'cesium'"
          (click)="selectProvider('cesium')">Cesium Ion</button>
        <button
          type="button"
          role="tab"
          class="token-tab"
          [class.active]="provider() === 'google'"
          [attr.aria-selected]="provider() === 'google'"
          (click)="selectProvider('google')">Google Maps</button>
      </div>

      @if (provider() === 'cesium') {
        <ol class="token-steps">
          <li>Sign up at <a href="https://ion.cesium.com/signup" target="_blank" rel="noopener">ion.cesium.com</a></li>
          <li>Copy your default token under <strong>Access Tokens</strong></li>
          <li>Paste it here</li>
        </ol>
      } @else {
        <ol class="token-steps">
          <li>Create a project in the <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a></li>
          <li>Enable the <strong>Map Tiles API</strong>, create a key</li>
          <li>Paste it here</li>
        </ol>
        <p class="token-warning">
          Referrer-restricted and not offered in every region. Use Cesium Ion if the map stays empty.
        </p>
      }

      <form class="token-form" (submit)="submit($event)">
        <input
          class="token-input"
          type="text"
          [name]="provider() === 'cesium' ? 'cesium-ion-token' : 'google-maps-api-key'"
          [placeholder]="provider() === 'cesium' ? 'eyJhbGciOiJIUzI1NiIsInR5cCI6...' : 'AIza...'"
          spellcheck="false"
          autocomplete="off"
          [value]="value()"
          (input)="onInput($event)"
          [attr.aria-label]="provider() === 'cesium' ? 'Cesium Ion access token' : 'Google Maps API key'" />
        <button
          class="token-btn ghost"
          type="button"
          [disabled]="!value().trim() || testing()"
          (click)="test()">{{ testing() ? 'Checking' : 'Test' }}</button>
        <button class="token-btn" type="submit" [disabled]="!value().trim()">Start</button>
      </form>

      @if (testResult(); as result) {
        <p class="token-result" [class.bad]="!result.ok">
          {{ result.ok ? '✓ ' : '✗ ' }}{{ result.message }}
        </p>
      }

      @if (dismissible()) {
        <button class="token-back" type="button" (click)="dismiss()">
          Back to the game
          <span class="token-key-hint">ESC</span>
        </button>
      }

      <p class="token-note">
        Stays in this browser, goes only to the tile provider.
        @if (config.hasStoredToken()) {
          <button class="token-link" type="button" (click)="clear()">Forget stored key</button>
        }
      </p>
    </div>
  `,
  styles: [`
    :host {
      ${TD_CSS_VARS}
      /* Covers header and sidebar too: a half-visible HUD behind a screen that
         blocks play reads as a broken game rather than a prompt. */
      position: fixed;
      inset: 0;
      z-index: 2000;
      display: block;
      background: var(--td-bg-dark);
      overflow-y: auto;
    }

    .token-setup {
      box-sizing: border-box;
      min-height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 24px;
      text-align: center;
      font-family: var(--td-font-body);
    }

    .token-icon {
      color: var(--td-gold);
    }

    h2 {
      margin: 0;
      font-family: var(--td-font-display);
      font-size: 19px;
      color: var(--td-text-primary);
    }

    .token-lead {
      margin: 0;
      max-width: 420px;
      color: var(--td-text-secondary);
      font-size: 13px;
      line-height: 1.55;
    }

    .token-tabs {
      display: flex;
      gap: 4px;
      margin-top: 4px;
    }

    .token-tab {
      padding: 7px 18px;
      cursor: pointer;
      background: var(--td-panel-dark);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-secondary);
      font-family: var(--td-font-body);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      transition: color 120ms ease, border-color 120ms ease;
    }

    .token-tab.active {
      border-color: var(--td-gold);
      color: var(--td-gold);
    }

    .token-steps {
      margin: 0;
      padding: 12px 18px 12px 34px;
      max-width: 420px;
      text-align: left;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-secondary);
      font-size: 12px;
      line-height: 1.75;
    }

    .token-steps strong { color: var(--td-text-primary); }

    .token-warning {
      margin: 0;
      max-width: 480px;
      color: var(--td-warn-orange);
      font-size: 12px;
      line-height: 1.5;
    }

    a {
      color: var(--td-gold);
    }

    .token-form {
      display: flex;
      gap: 8px;
      width: 100%;
      max-width: 480px;
    }

    .token-input {
      flex: 1;
      min-width: 0;
      padding: 10px 12px;
      background: var(--td-panel-dark);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-primary);
      font-family: var(--td-font-mono);
      font-size: 12px;
    }

    .token-input:focus {
      outline: none;
      border-color: var(--td-gold);
    }

    .token-btn {
      padding: 10px 22px;
      cursor: pointer;
      background: var(--td-glass-tint);
      border: 1px solid var(--td-gold);
      color: var(--td-gold);
      font-family: var(--td-font-body);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      transition: background 120ms ease;
    }

    .token-btn:hover:not(:disabled) { background: var(--td-panel-secondary); }

    .token-btn.ghost {
      border-color: var(--td-frame-mid);
      color: var(--td-text-secondary);
    }

    .token-result {
      margin: 0;
      max-width: 420px;
      color: var(--td-green);
      font-size: 12px;
      line-height: 1.5;
    }

    .token-result.bad { color: var(--td-warn-orange); }
    .token-btn:disabled { opacity: 0.4; cursor: default; }

    .token-back {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-top: 6px;
      padding: 11px 26px;
      cursor: pointer;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-light);
      color: var(--td-text-primary);
      font-family: var(--td-font-body);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      transition: border-color 120ms ease, color 120ms ease;
    }

    .token-back:hover {
      border-color: var(--td-gold);
      color: var(--td-gold);
    }

    .token-key-hint {
      padding: 1px 5px;
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-muted);
      font-size: 9px;
      font-weight: 400;
      letter-spacing: 0.04em;
    }

    .token-link {
      margin-left: 6px;
      padding: 0;
      background: none;
      border: none;
      color: var(--td-text-secondary);
      font-family: var(--td-font-body);
      font-size: 11px;
      text-decoration: underline;
      cursor: pointer;
    }

    .token-note {
      margin: 2px 0 0;
      max-width: 420px;
      color: var(--td-text-muted);
      font-size: 11px;
      line-height: 1.6;
      opacity: 0.75;
    }
  `],
})
export class TokenSetupComponent {
  readonly config = inject(ConfigService);

  /** Emitted once credentials are stored, so the caller can start the engine. */
  readonly tokenSaved = output<void>();

  readonly provider = signal<'cesium' | 'google'>(this.config.tileProvider());
  readonly value = signal('');
  readonly rejected = this.config.credentialsRejected;

  /** A voluntary visit can be left again; a missing key cannot. */
  readonly dismissible = computed(
    () => this.config.setupRequested() && !this.config.needsCredentials()
  );

  readonly testing = signal(false);
  readonly testResult = signal<{ ok: boolean; message: string } | null>(null);

  selectProvider(provider: 'cesium' | 'google'): void {
    this.provider.set(provider);
    this.value.set('');
    this.testResult.set(null);
  }

  onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
    this.testResult.set(null);
  }

  /**
   * Check the credentials against the provider before committing to them, so a
   * typo shows up here instead of as a map that never appears.
   */
  async test(): Promise<void> {
    this.testing.set(true);
    this.testResult.set(null);
    try {
      this.testResult.set(await this.config.validateCredentials(this.provider(), this.value()));
    } finally {
      this.testing.set(false);
    }
  }

  submit(event: Event): void {
    event.preventDefault();
    const value = this.value().trim();
    if (!value) return;

    this.config.setCredentials(this.provider(), value);
    this.config.setupRequested.set(false);
    this.tokenSaved.emit();
  }

  dismiss(): void {
    // Ignored while credentials are missing, there is no game to go back to.
    if (!this.dismissible()) return;
    this.config.setupRequested.set(false);
  }

  clear(): void {
    this.config.clearStoredCredentials();
    this.value.set('');
    this.testResult.set(null);
  }
}
