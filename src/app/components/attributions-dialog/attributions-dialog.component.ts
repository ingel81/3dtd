import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { ATTRIBUTIONS } from '../../configs/attributions.config';

@Component({
  selector: 'app-attributions-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="attributions-dialog">
      <!-- Header -->
      <div class="dialog-header">
        <mat-icon class="header-icon">copyright</mat-icon>
        <h2>Attributions</h2>
      </div>

      <!-- Content -->
      <div class="dialog-content">
        @for (category of attributions; track category.title) {
          <div class="section">
            <div class="section-header">
              <mat-icon>{{ category.icon }}</mat-icon>
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
                        <mat-icon>open_in_new</mat-icon>
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
      background: var(--td-bg-dark);
      border-top: 1px solid var(--td-frame-light);
      border-left: 1px solid var(--td-frame-mid);
      border-right: 1px solid var(--td-frame-dark);
      border-bottom: 2px solid var(--td-frame-dark);
      color: var(--td-text-primary);
      font-family: 'JetBrains Mono', monospace;
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

    .header-icon {
      color: var(--td-gold);
      font-size: 20px;
      width: 20px;
      height: 20px;
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

    /* Sections */
    .section {
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-dark);
      border-left-color: var(--td-frame-dark);
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--td-panel-main);
      border-bottom: 1px solid var(--td-frame-dark);
    }

    .section-header mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--td-teal);
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

    .source-link mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
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
      font-family: 'JetBrains Mono', monospace;
      cursor: pointer;
      background: transparent;
      color: var(--td-text-secondary);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom: 2px solid var(--td-frame-dark);
      transition: all 0.15s ease;
    }

    .close-btn:hover {
      background: var(--td-panel-secondary);
      color: var(--td-text-primary);
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
