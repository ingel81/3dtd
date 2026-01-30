import {
  Component,
  inject,
  signal,
  computed,
  OnDestroy,
  ChangeDetectionStrategy,
  input,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug-window.service';
import { GameEventBus, GameEvent, EventSubscription } from '../../game-engine/game-event-bus';
import { TD_CSS_VARS, TD_SCROLLBAR_STYLES, TD_SCROLLBAR_WEBKIT } from '../../styles/td-theme';

interface EventLogEntry {
  id: number;
  timestamp: number;
  event: GameEvent;
}

type EventCategory = 'all' | 'enemy' | 'tower' | 'wave' | 'game' | 'vfx' | 'audio';

const CATEGORY_PREFIXES: Record<Exclude<EventCategory, 'all'>, string[]> = {
  enemy: ['enemy:'],
  tower: ['tower:'],
  wave: ['wave:'],
  game: ['game:', 'health:', 'credits:'],
  vfx: ['vfx:', 'projectile:'],
  audio: ['audio:'],
};

const MAX_LOG_ENTRIES = 100;

@Component({
  selector: 'app-event-debugger',
  standalone: true,
  imports: [CommonModule, MatIconModule, DraggableDebugPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (windowService.eventsWindow().isOpen) {
      <app-draggable-debug-panel
        windowId="events"
        title="Event Bus"
        icon="cell_tower"
        [resizable]="true"
        [size]="windowService.eventsWindow().size ?? { width: 450, height: 400 }"
        [position]="windowService.eventsWindow().position"
        [zIndex]="windowService.eventsWindow().zIndex"
        (closed)="windowService.close('events')"
        (positionChange)="windowService.updatePosition('events', $event)"
        (sizeChange)="windowService.updateSize('events', $event)"
        (focused)="windowService.bringToFront('events')"
      >
        <div class="event-debug-content">
          <!-- Filter Buttons -->
          <div class="filter-row">
            @for (cat of categories; track cat) {
              <button
                class="filter-btn"
                [class.active]="selectedCategory() === cat"
                (click)="selectCategory(cat)"
              >
                {{ cat | uppercase }}
              </button>
            }
          </div>

          <!-- Stats Row -->
          <div class="stats-row">
            <span class="stat">
              <span class="label">Total:</span>
              <span class="value">{{ totalEvents() }}</span>
            </span>
            <span class="stat">
              <span class="label">Shown:</span>
              <span class="value">{{ filteredEvents().length }}</span>
            </span>
            <button class="clear-btn" (click)="clearLog()" title="Clear log">
              <mat-icon>delete_outline</mat-icon>
            </button>
            <button
              class="pause-btn"
              [class.active]="isPaused()"
              (click)="togglePause()"
              [title]="isPaused() ? 'Resume' : 'Pause'"
            >
              <mat-icon>{{ isPaused() ? 'play_arrow' : 'pause' }}</mat-icon>
            </button>
          </div>

          <!-- Event Log -->
          <div class="event-log">
            @for (entry of filteredEvents(); track entry.id) {
              <div class="event-entry" [class]="getEventClass(entry.event.type)">
                <span class="time">{{ formatTime(entry.timestamp) }}</span>
                <span class="type">{{ entry.event.type }}</span>
                <span class="details">{{ getEventDetails(entry.event) }}</span>
              </div>
            } @empty {
              <div class="empty-state">
                @if (eventLog().length === 0) {
                  Waiting for events...
                } @else {
                  No events for filter "{{ selectedCategory() }}"
                }
              </div>
            }
          </div>
        </div>
      </app-draggable-debug-panel>
    }
  `,
  styles: `
    :host {
      ${TD_CSS_VARS}
    }

    .event-debug-content {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    .filter-row {
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }

    .filter-btn {
      padding: 3px 8px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-secondary);
      font-family: inherit;
      font-size: 9px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .filter-btn:hover {
      background: var(--td-frame-mid);
    }

    .filter-btn.active {
      background: var(--td-teal);
      color: var(--td-bg-dark);
    }

    .stats-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--td-frame-dark);
      margin-bottom: 8px;
    }

    .stat {
      display: flex;
      gap: 4px;
    }

    .stat .label {
      color: var(--td-text-muted);
    }

    .stat .value {
      color: var(--td-teal);
      font-weight: 600;
    }

    .clear-btn,
    .pause-btn {
      margin-left: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .clear-btn mat-icon,
    .pause-btn mat-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
    }

    .clear-btn:hover {
      background: var(--td-health-red);
      color: var(--td-text-primary);
    }

    .pause-btn {
      margin-left: 4px;
    }

    .pause-btn:hover {
      background: var(--td-frame-mid);
    }

    .pause-btn.active {
      background: var(--td-gold);
      color: var(--td-bg-dark);
    }

    .event-log {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 2px;
      ${TD_SCROLLBAR_STYLES}
    }

    .event-log::-webkit-scrollbar {
      ${TD_SCROLLBAR_WEBKIT.scrollbar}
    }

    .event-log::-webkit-scrollbar-track {
      ${TD_SCROLLBAR_WEBKIT.track}
    }

    .event-log::-webkit-scrollbar-thumb {
      ${TD_SCROLLBAR_WEBKIT.thumb}
    }

    .event-log::-webkit-scrollbar-thumb:hover {
      ${TD_SCROLLBAR_WEBKIT.thumbHover}
    }

    .event-entry {
      display: flex;
      gap: 8px;
      padding: 3px 6px;
      background: var(--td-panel-shadow);
      border-left: 2px solid var(--td-frame-mid);
      font-size: 9px;
    }

    .event-entry.enemy {
      border-left-color: var(--td-health-red);
    }

    .event-entry.tower {
      border-left-color: var(--td-teal);
    }

    .event-entry.wave {
      border-left-color: var(--td-gold);
    }

    .event-entry.game {
      border-left-color: var(--td-green);
    }

    .event-entry.vfx {
      border-left-color: #a855f7;
    }

    .event-entry.audio {
      border-left-color: #3b82f6;
    }

    .event-entry .time {
      color: var(--td-text-muted);
      min-width: 50px;
      flex-shrink: 0;
    }

    .event-entry .type {
      color: var(--td-text-primary);
      font-weight: 600;
      min-width: 120px;
      flex-shrink: 0;
    }

    .event-entry .details {
      color: var(--td-text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .empty-state {
      padding: 20px;
      text-align: center;
      color: var(--td-text-muted);
      font-style: italic;
    }
  `,
})
export class EventDebuggerComponent implements OnDestroy {
  readonly windowService = inject(DebugWindowService);

  /** EventBus injected from parent */
  readonly eventBus = input<GameEventBus | null>(null);

  /** Event log (newest first) */
  readonly eventLog = signal<EventLogEntry[]>([]);

  /** Selected filter category */
  readonly selectedCategory = signal<EventCategory>('all');

  /** Pause state */
  readonly isPaused = signal(false);

  /** Total events received */
  readonly totalEvents = signal(0);

  /** Available categories */
  readonly categories: EventCategory[] = ['all', 'enemy', 'tower', 'wave', 'game', 'vfx', 'audio'];

  /** Filtered events based on selected category */
  readonly filteredEvents = computed(() => {
    const category = this.selectedCategory();
    const log = this.eventLog();

    if (category === 'all') {
      return log;
    }

    const prefixes = CATEGORY_PREFIXES[category];
    return log.filter((entry) => prefixes.some((prefix) => entry.event.type.startsWith(prefix)));
  });

  private subscription: EventSubscription | null = null;
  private entryIdCounter = 0;
  private startTime = Date.now();

  constructor() {
    // Watch eventBus input and subscribe when it changes
    effect(() => {
      const bus = this.eventBus();
      if (bus) {
        this.subscribeToEventBus(bus);
      }
    });
  }

  ngOnDestroy(): void {
    this.subscription?.dispose();
  }

  /**
   * Subscribe to all events from the event bus
   */
  private subscribeToEventBus(eventBus: GameEventBus): void {
    // Dispose previous subscription
    this.subscription?.dispose();

    // Subscribe to all events
    this.subscription = eventBus.onAny((event) => {
      if (this.isPaused()) return;

      this.totalEvents.update((n) => n + 1);

      const entry: EventLogEntry = {
        id: this.entryIdCounter++,
        timestamp: Date.now() - this.startTime,
        event,
      };

      this.eventLog.update((log) => {
        const newLog = [entry, ...log];
        // Limit log size
        if (newLog.length > MAX_LOG_ENTRIES) {
          newLog.pop();
        }
        return newLog;
      });
    });
  }

  selectCategory(category: EventCategory): void {
    this.selectedCategory.set(category);
  }

  clearLog(): void {
    this.eventLog.set([]);
    this.totalEvents.set(0);
    this.startTime = Date.now();
  }

  togglePause(): void {
    this.isPaused.update((p) => !p);
  }

  formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const millis = ms % 1000;
    return `${seconds}.${millis.toString().padStart(3, '0')}`;
  }

  getEventClass(type: string): string {
    if (type.startsWith('enemy:')) return 'enemy';
    if (type.startsWith('tower:')) return 'tower';
    if (type.startsWith('wave:')) return 'wave';
    if (type.startsWith('game:') || type.startsWith('health:') || type.startsWith('credits:'))
      return 'game';
    if (type.startsWith('vfx:') || type.startsWith('projectile:')) return 'vfx';
    if (type.startsWith('audio:')) return 'audio';
    return '';
  }

  getEventDetails(event: GameEvent): string {
    switch (event.type) {
      case 'enemy:died':
        return `+${event.credits} credits`;
      case 'enemy:reached-base':
        return `-${event.damage} HP`;
      case 'tower:placed':
        return `-${event.cost} credits`;
      case 'tower:sold':
        return `+${event.refund} credits`;
      case 'wave:started':
        return `Wave ${event.wave}, ${event.enemyCount} enemies`;
      case 'wave:completed':
        return `Wave ${event.wave}, +${event.credits} credits`;
      case 'health:changed':
        return `${event.health} HP (${event.delta >= 0 ? '+' : ''}${event.delta})`;
      case 'credits:changed':
        return `${event.credits} (${event.delta >= 0 ? '+' : ''}${event.delta})`;
      case 'game:over':
        return event.reason;
      case 'projectile:hit':
        return `${event.damage} damage`;
      case 'vfx:projectile-impact':
        return event.targetLost ? 'ground' : 'enemy';
      case 'audio:play':
        return event.sound;
      default:
        return '';
    }
  }
}
