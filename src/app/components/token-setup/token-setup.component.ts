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
  templateUrl: './token-setup.component.html',
  styleUrl: './token-setup.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class TokenSetupComponent {
  readonly config = inject(ConfigService);
  /** The coop room of an invite link this page came with (?room=), to say why a key is asked for (review R8) */
  readonly coopRoom = new URLSearchParams(window.location.search).get('room');

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
