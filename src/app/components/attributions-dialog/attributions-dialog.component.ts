import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { ATTRIBUTIONS } from '../../configs/attributions.config';
import { TdIconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-attributions-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    TdIconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="attributions-dialog">
      <!-- Header -->
      <div class="dialog-header">
        <td-icon class="header-icon" name="copyright" [size]="20"></td-icon>
        <h2>Attributions</h2>
      </div>

      <!-- Content -->
      <div class="dialog-content">
        @for (category of attributions; track category.title) {
          <div class="section">
            <div class="section-header">
              <td-icon [name]="$any(category.icon)" [size]="14"></td-icon>
              <span class="section-title">{{ category.title }}</span>
              <span class="section-count">{{ category.items.length }}</span>
            </div>
            <div class="section-body">
              @for (item of category.items; track item.name) {
                <div class="attribution-item">
                  <div class="item-info">
                    <span class="item-name">{{ item.name }}</span>
                    <span class="item-author">by {{ item.author }}</span>
                  </div>
                  <div class="item-actions">
                    @if (item.licenseUrl) {
                      <a
                        [href]="item.licenseUrl"
                        target="_blank"
                        rel="noopener"
                        class="license-badge"
                        [title]="item.license"
                      >{{ item.license }}</a>
                    } @else {
                      <span class="license-badge plain">{{ item.license }}</span>
                    }
                    @if (item.sourceUrl) {
                      <a
                        [href]="item.sourceUrl"
                        target="_blank"
                        rel="noopener"
                        class="source-link"
                        title="View source"
                      >
                        <td-icon name="externalLink" [size]="14"></td-icon>
                      </a>
                    }
                  </div>
                </div>
              }
            </div>
          </div>
        }
      </div>

      <!-- Footer -->
      <div class="dialog-actions">
        <button class="close-btn" (click)="close()">Close</button>
      </div>
    </div>
  `,
  styles: `
    :host {
      ${TD_CSS_VARS}
    }

    .attributions-dialog {
      width: 450px;
      max-width: 90vw;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      background: var(--td-panel-main);
      border: 1px solid var(--td-frame-dark);
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.2),
        inset 0 -1px 0 var(--td-panel-shadow),
        0 1px 0 var(--td-panel-shadow);
      color: var(--td-text-primary);
      font-family: var(--td-font-body);
    }

    .dialog-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      background: var(--td-panel-main);
      border-bottom: 1px solid var(--td-frame-dark);
      flex-shrink: 0;
    }


    h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--td-gold);
    }

    .dialog-content {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
    }

    /* Scrollbar */
    .dialog-content::-webkit-scrollbar {
      width: 6px;
    }
    .dialog-content::-webkit-scrollbar-track {
      background: var(--td-panel-shadow);
    }
    .dialog-content::-webkit-scrollbar-thumb {
      background: var(--td-frame-mid);
    }
    .dialog-content::-webkit-scrollbar-thumb:hover {
      background: var(--td-frame-light);
    }

    /* Sections — refined inset bevel */
    .section {
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-dark);
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.13),
        inset 0 -1px 0 var(--td-panel-shadow);
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--td-panel-main);
      border-bottom: 1px solid var(--td-frame-dark);
    }

    .section-header td-icon {
      color: var(--td-teal);
    }
    .header-icon {
      color: var(--td-gold);
    }

    .section-title {
      font-size: 11px;
      font-weight: 600;
      color: var(--td-text-primary);
    }

    .section-count {
      margin-left: auto;
      font-size: 9px;
      color: var(--td-text-muted);
      background: var(--td-panel-shadow);
      padding: 1px 6px;
      border: 1px solid var(--td-frame-dark);
    }

    .section-body {
      display: flex;
      flex-direction: column;
    }

    /* Attribution items */
    .attribution-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--td-panel-shadow);
    }

    .attribution-item:last-child {
      border-bottom: none;
    }

    .item-info {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }

    .item-name {
      font-size: 10px;
      font-weight: 500;
      color: var(--td-text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .item-author {
      font-size: 9px;
      color: var(--td-text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .item-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .license-badge {
      font-size: 8px;
      font-weight: 500;
      padding: 2px 6px;
      background: var(--td-panel-shadow);
      border: 1px solid var(--td-frame-dark);
      color: var(--td-teal);
      text-decoration: none;
      white-space: nowrap;
      transition: border-color 0.15s ease;
    }

    .license-badge:hover:not(.plain) {
      border-color: var(--td-teal);
    }

    .license-badge.plain {
      color: var(--td-text-muted);
    }

    .source-link {
      display: flex;
      align-items: center;
      color: var(--td-text-muted);
      transition: color 0.15s ease;
    }

    .source-link:hover {
      color: var(--td-text-primary);
    }


    /* Footer */
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      padding: 10px 16px;
      background: var(--td-panel-main);
      border-top: 1px solid var(--td-frame-mid);
      flex-shrink: 0;
    }

    .close-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      font-size: 11px;
      font-weight: 500;
      font-family: var(--td-font-mono);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
      background: var(--td-panel-main);
      color: var(--td-text-secondary);
      border: 1px solid var(--td-frame-dark);
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.2),
        var(--td-shadow-key);
      transition: box-shadow 0.18s ease, color 0.15s ease;
    }

    .close-btn:hover {
      color: var(--td-text-primary);
      box-shadow:
        inset 0 1px 0 rgba(122, 133, 128, 0.2),
        0 0 0 1px var(--td-frame-mid),
        var(--td-shadow-key);
    }
  `,
})
export class AttributionsDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<AttributionsDialogComponent>);
  readonly attributions = ATTRIBUTIONS;

  close(): void {
    this.dialogRef.close();
  }
}
