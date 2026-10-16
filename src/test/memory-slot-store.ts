import type { SaveSlotStore, StoredSlotMeta } from '../app/services/save-game/save-slot.store';

/** Save slots in memory for the specs, watched as the shared store is (WatchedSlotStore) */
export class MemorySlotStore implements SaveSlotStore {
  private readonly listeners = new Set<() => void>();
  readonly texts = new Map<string, string>();

  constructor(private slots: StoredSlotMeta[] = []) {}

  async list(): Promise<StoredSlotMeta[]> {
    return [...this.slots];
  }
  async read(id: string): Promise<string | null> {
    return this.texts.get(id) ?? null;
  }
  async write(meta: StoredSlotMeta, text: string): Promise<boolean> {
    this.slots = [...this.slots.filter((m) => m.id !== meta.id), meta];
    this.texts.set(meta.id, text);
    this.changed();
    return true;
  }
  async remove(id: string): Promise<void> {
    this.slots = this.slots.filter((m) => m.id !== id);
    this.texts.delete(id);
    this.changed();
  }
  watch(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }
  ids(): string[] {
    return this.slots.map((m) => m.id);
  }
}
