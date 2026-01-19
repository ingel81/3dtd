import { Injectable, signal } from '@angular/core';
import { SoundPoolStats, SoundDebugEvent } from '../managers/spatial-audio.manager';

const MAX_EVENTS = 30;

/** Event types that are interesting enough to show in the log */
const VISIBLE_EVENT_TYPES: SoundDebugEvent['type'][] = ['play', 'budget_exceeded', 'distance_culled'];

/**
 * Service für Sound-Debug-Informationen.
 * Empfängt Stats und Events vom SpatialAudioManager und stellt sie als Signals bereit.
 */
@Injectable({ providedIn: 'root' })
export class SoundDebugService {
  // Sound pool statistics
  readonly stats = signal<SoundPoolStats | null>(null);

  // Event log (last MAX_EVENTS events)
  readonly events = signal<SoundDebugEvent[]>([]);

  // Connection state
  readonly connected = signal(false);

  /**
   * Handle incoming debug events from SpatialAudioManager
   * Only stores "interesting" events (play, warnings, errors) - stops are filtered out
   */
  onDebugEvent(event: SoundDebugEvent): void {
    // Filter out uninteresting events (like 'stop')
    if (!VISIBLE_EVENT_TYPES.includes(event.type)) {
      return;
    }

    this.events.update(events => {
      const updated = [event, ...events];
      if (updated.length > MAX_EVENTS) {
        updated.length = MAX_EVENTS;
      }
      return updated;
    });
  }

  /**
   * Update stats from SpatialAudioManager
   */
  updateStats(stats: SoundPoolStats): void {
    this.stats.set(stats);
  }

  /**
   * Mark as connected to SpatialAudioManager
   */
  setConnected(connected: boolean): void {
    this.connected.set(connected);
  }

  /**
   * Clear all events
   */
  clearEvents(): void {
    this.events.set([]);
  }

  /**
   * Get event type color class
   */
  getEventTypeClass(type: SoundDebugEvent['type']): string {
    switch (type) {
      case 'play': return 'event-play';
      case 'budget_exceeded': return 'event-warning';
      case 'distance_culled': return 'event-muted';
      default: return '';
    }
  }
}
