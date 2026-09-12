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
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { GameEventBus, GameEvent, EventSubscription } from '../../game-engine/game-event-bus';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';

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
  imports: [CommonModule, DraggableDebugPanelComponent, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './event-debugger.component.html',
  styleUrl: './event-debugger.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
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
