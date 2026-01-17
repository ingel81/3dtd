import {
  Component,
  input,
  signal,
  OnInit,
  OnDestroy,
  AfterViewInit,
  PLATFORM_ID,
  inject,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { TD_CSS_VARS } from '../../styles/td-theme';

/**
 * Ad Banner Component with Monetag Integration and Adblocker Fallback
 *
 * Features:
 * - Monetag ad network integration (better for gaming traffic)
 * - Context-aware sizing (large during pause, small during wave)
 * - Adblocker detection with graceful fallback
 * - Fallback shows donation/support options
 * - WC3-inspired design style
 *
 * Setup:
 * 1. Create account at https://monetag.com
 * 2. Add your website and get approved
 * 3. Create a "Banner" ad unit (300x250 for large, 300x100 for compact)
 * 4. Replace MONETAG_ZONE_ID below with your zone ID
 */

// ============================================================================
// MONETAG CONFIGURATION - Replace with your actual zone IDs after signup
// ============================================================================
const MONETAG_CONFIG = {
  // Get these from your Monetag dashboard after creating ad units
  zoneIdLarge: 'XXXXXXXX',   // 300x250 Medium Rectangle
  zoneIdCompact: 'XXXXXXXX', // 300x100 Small Banner (or use same as large)
  // Set to true once you have valid zone IDs
  enabled: false,
};

@Component({
  selector: 'app-ad-banner',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="td-ad-container" [class.td-ad-compact]="compact()">
      <!-- Monetag Ad Slot (hidden if blocked or not configured) -->
      @if (!adBlocked() && monetagEnabled) {
        <div class="td-ad-slot" [class.td-ad-slot-compact]="compact()">
          <div #adContainer class="td-ad-monetag"></div>
        </div>
      }

      <!-- Fallback: Donation Panel (shown if ad blocked or Monetag not configured) -->
      @if (adBlocked() || !monetagEnabled) {
        <div class="td-fallback-panel" [class.td-fallback-compact]="compact()">
          <div class="td-fallback-header">
            <mat-icon>favorite</mat-icon>
            <span>Unterstuetzen</span>
          </div>

          @if (!compact()) {
            <div class="td-fallback-content">
              <p class="td-fallback-text">Gefaellt dir 3DTD?</p>
              <p class="td-fallback-subtext">Hilf mir, Server & API-Kosten zu decken</p>

              <div class="td-fallback-buttons">
                <a href="https://ko-fi.com/ingel81" target="_blank" rel="noopener" class="td-donate-btn td-btn-kofi">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 7.422-2.831 6.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-1.086 4.363.407 0 0 1.565-1.782 3.468-.963 1.904.82 1.832 3.011.723 4.311zm6.173.478c-.928.116-1.682.028-1.682.028V7.284h1.77s1.971.551 1.971 2.638c0 1.913-.985 2.667-2.059 3.015z"/>
                  </svg>
                  <span>Ko-fi</span>
                </a>
                <a href="https://github.com/ingel81/3dtd" target="_blank" rel="noopener" class="td-donate-btn td-btn-github">
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                  </svg>
                  <span>Star</span>
                </a>
              </div>
            </div>
          } @else {
            <!-- Compact fallback -->
            <div class="td-fallback-compact-content">
              <span class="td-fallback-compact-text">3DTD unterstuetzen?</span>
              <div class="td-fallback-compact-buttons">
                <a href="https://ko-fi.com/ingel81" target="_blank" rel="noopener" class="td-donate-btn-small" title="Ko-fi">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 7.422-2.831 6.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-1.086 4.363.407 0 0 1.565-1.782 3.468-.963 1.904.82 1.832 3.011.723 4.311zm6.173.478c-.928.116-1.682.028-1.682.028V7.284h1.77s1.971.551 1.971 2.638c0 1.913-.985 2.667-2.059 3.015z"/>
                  </svg>
                </a>
                <a href="https://github.com/ingel81/3dtd" target="_blank" rel="noopener" class="td-donate-btn-small" title="GitHub Star">
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                  </svg>
                </a>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      ${TD_CSS_VARS}
    }

    /* === Container === */
    .td-ad-container {
      margin-top: auto;
      padding: 0;
    }

    /* === Ad Slot === */
    .td-ad-slot {
      width: 300px;
      height: 250px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      transition: height 0.3s ease;
    }

    .td-ad-slot-compact {
      height: 100px;
    }

    .td-ad-monetag {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* === Fallback Panel (WC3 Style) === */
    .td-fallback-panel {
      background: var(--td-panel-main);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      overflow: hidden;
    }

    .td-fallback-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: linear-gradient(180deg,
        color-mix(in srgb, var(--td-health-red) 40%, var(--td-panel-secondary)) 0%,
        var(--td-panel-secondary) 100%);
      border-bottom: 1px solid var(--td-frame-dark);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1px;
      color: var(--td-gold);
      text-transform: uppercase;
    }

    .td-fallback-header mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--td-health-red);
    }

    .td-fallback-content {
      padding: 16px 12px;
      text-align: center;
    }

    .td-fallback-text {
      margin: 0 0 4px 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--td-text-primary);
    }

    .td-fallback-subtext {
      margin: 0 0 16px 0;
      font-size: 10px;
      color: var(--td-text-muted);
    }

    .td-fallback-buttons {
      display: flex;
      gap: 8px;
      justify-content: center;
    }

    .td-donate-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.15s;
    }

    .td-btn-kofi {
      background: linear-gradient(180deg, #ff5e5b 0%, #d94a47 100%);
      color: white;
    }

    .td-btn-kofi:hover {
      filter: brightness(1.1);
      box-shadow: 0 0 10px rgba(255, 94, 91, 0.4);
    }

    .td-btn-github {
      background: var(--td-panel-secondary);
      color: var(--td-text-primary);
    }

    .td-btn-github:hover {
      background: var(--td-frame-mid);
      border-color: var(--td-gold-dark);
    }

    /* === Compact Fallback === */
    .td-fallback-compact .td-fallback-header {
      padding: 4px 8px;
      font-size: 9px;
    }

    .td-fallback-compact-content {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      gap: 8px;
    }

    .td-fallback-compact-text {
      font-size: 10px;
      color: var(--td-text-secondary);
    }

    .td-fallback-compact-buttons {
      display: flex;
      gap: 6px;
    }

    .td-donate-btn-small {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-secondary);
      text-decoration: none;
      transition: all 0.15s;
    }

    .td-donate-btn-small:hover {
      background: var(--td-frame-mid);
      color: var(--td-gold);
      border-color: var(--td-gold-dark);
    }
  `,
})
export class AdBannerComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);

  @ViewChild('adContainer') adContainer!: ElementRef<HTMLDivElement>;

  /** Whether the ad should be compact (during active wave) */
  readonly compact = input<boolean>(false);

  /** Whether an adblocker is detected */
  readonly adBlocked = signal(false);

  /** Whether Monetag is configured and enabled */
  readonly monetagEnabled = MONETAG_CONFIG.enabled;

  /** Check interval for adblocker detection */
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  /** Track if Monetag script is loaded */
  private monetagLoaded = false;

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId) && this.monetagEnabled) {
      // Load Monetag script
      this.loadMonetag();
    }
  }

  ngAfterViewInit(): void {
    if (isPlatformBrowser(this.platformId) && this.monetagEnabled) {
      // Start adblocker detection after view init
      setTimeout(() => this.checkForAdBlocker(), 2000);
      this.checkInterval = setInterval(() => this.checkForAdBlocker(), 5000);
    }
  }

  ngOnDestroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }

  /**
   * Load Monetag ad script dynamically
   */
  private loadMonetag(): void {
    if (this.monetagLoaded) return;

    const zoneId = this.compact()
      ? MONETAG_CONFIG.zoneIdCompact
      : MONETAG_CONFIG.zoneIdLarge;

    // Monetag uses a specific script pattern
    const script = document.createElement('script');
    script.async = true;
    script.setAttribute('data-cfasync', 'false');
    script.src = `//pl${zoneId}.profitabledisplaynetwork.com/${zoneId}/invoke.js`;

    script.onerror = () => {
      console.warn('[AdBanner] Monetag script blocked or failed to load');
      this.adBlocked.set(true);
    };

    script.onload = () => {
      this.monetagLoaded = true;
      // Monetag will automatically fill the container
    };

    document.head.appendChild(script);
  }

  /**
   * Detect if an adblocker is active
   * Uses multiple detection methods for reliability
   */
  private checkForAdBlocker(): void {
    // Method 1: Check if Monetag container has content
    if (this.adContainer?.nativeElement) {
      const container = this.adContainer.nativeElement;
      const hasContent = container.children.length > 0 ||
                         container.innerHTML.trim().length > 0;

      if (!hasContent && this.monetagLoaded) {
        // Script loaded but no ad content = blocked
        this.adBlocked.set(true);
        this.stopChecking();
        return;
      }
    }

    // Method 2: Create a bait element that adblockers typically hide
    const bait = document.createElement('div');
    bait.className = 'adsbox ad-banner textads banner-ads pub_300x250';
    bait.style.cssText = 'position:absolute;left:-9999px;width:300px;height:250px;';
    document.body.appendChild(bait);

    const baitBlocked = bait.offsetHeight === 0 ||
                        bait.offsetWidth === 0 ||
                        window.getComputedStyle(bait).display === 'none';

    document.body.removeChild(bait);

    if (baitBlocked) {
      this.adBlocked.set(true);
      this.stopChecking();
    }
  }

  private stopChecking(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}
