import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { MapLanes, VacantLanes } from '../../../world/custom-map/lane-choice';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../../../components/icon/icon.component';
import { ENEMY_TYPES } from '../../../configs/enemy-types.config';
import { GAME_BALANCE } from '../../../configs/game-balance.config';
import { TOWER_TYPES } from '../../../configs/tower-types.config';
import { WAVE_TABLE, validateWaveTable, type WaveTable } from '../../../director/sources/table/wave-table';
import type { MapGameplay, MapWaveRow, MapWaveTable } from '../../../world/custom-map/map-document';
import { SnapshotCommand } from '../../model/editor-document';
import { EditorSession } from '../editor-session.service';

/**
 * The map's own rules: start credits, HQ health, the towers players may
 * build, and the waves: the game's budget source or a list of the map's
 * own. The game reads these once it plays custom maps with rules
 * (docs/LEVEL_EDITOR.md).
 */

/** The lane rules without their empty fields, undefined when none is left */
function pruned(lanes: MapLanes): MapLanes | undefined {
  const out = Object.fromEntries(Object.entries(lanes).filter(([, v]) => v !== undefined)) as MapLanes;
  return Object.keys(out).length ? out : undefined;
}
@Component({
  selector: 'app-gameplay-panel',
  standalone: true,
  imports: [TdIconComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  templateUrl: './gameplay-panel.component.html',
  styleUrl: './gameplay-panel.component.scss',
})
export class GameplayPanelComponent {
  private readonly session = inject(EditorSession);
  readonly defaults = { credits: GAME_BALANCE.player.startCredits, health: GAME_BALANCE.player.startHealth };
  readonly towers = Object.values(TOWER_TYPES).map((t) => ({ id: t.id, name: t.name }));
  readonly enemies = Object.entries(ENEMY_TYPES)
    .map(([id, e]) => ({ id, name: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  readonly open = signal<number | null>(null);

  readonly gp = computed<MapGameplay>(() => (this.session.docRev(), structuredClone(this.session.doc?.gameplay ?? {})));
  readonly table = computed<MapWaveTable | null>(() => {
    const w = this.gp().waves;
    return w?.kind === 'table' ? w.table : null;
  });
  readonly problems = computed(() => {
    const t = this.table();
    return t ? validateWaveTable(t as unknown as WaveTable) : [];
  });

  /** One undo step that changes the rules; empty rules are removed */
  private edit(label: string, fn: (g: MapGameplay) => void): void {
    const editor = this.session.editor;
    if (!editor) return;
    this.session.execute(
      SnapshotCommand.record(editor.doc, label, ['gameplay'], (d) => {
        const g: MapGameplay = d.gameplay ?? {};
        fn(g);
        for (const k of Object.keys(g) as (keyof MapGameplay)[]) if (g[k] === undefined) delete g[k];
        d.gameplay = Object.keys(g).length ? g : undefined;
      }),
    );
  }

  setNumber(key: 'startCredits' | 'hqHealth', e: Event): void {
    const raw = (e.target as HTMLInputElement).value.trim();
    const v = raw === '' ? undefined : Math.max(key === 'hqHealth' ? 1 : 0, Math.round(Number(raw)));
    if (v !== undefined && !Number.isFinite(v)) return;
    this.edit(key === 'startCredits' ? 'Start credits' : 'HQ health', (g) => (g[key] = v));
  }

  readonly vacantChoices: { id: VacantLanes; label: string; hint: string }[] = [
    { id: 'close', label: 'Close', hint: 'At the start, lanes no player holds close' },
    { id: 'host', label: 'To the host', hint: 'The host takes every lane no player holds' },
    { id: 'split', label: 'Share out', hint: 'Lanes no player holds go to the players in turn' },
  ];

  /** Fewest or most lanes open; empty: 1 and all */
  setLaneCount(key: 'min' | 'max', e: Event): void {
    const raw = (e.target as HTMLInputElement).value.trim();
    const v = raw === '' ? undefined : Math.max(1, Math.round(Number(raw)));
    if (v !== undefined && !Number.isFinite(v)) return;
    this.edit(key === 'min' ? 'Fewest lanes' : 'Most lanes', (g) => {
      const lanes = { ...g.lanes, [key]: v };
      if (lanes.min !== undefined && lanes.max !== undefined && lanes.min > lanes.max) lanes[key === 'min' ? 'max' : 'min'] = v;
      g.lanes = pruned(lanes);
    });
  }

  setDestructible(on: boolean): void {
    this.edit('Destructible', (g) => (g.destructible = on ? true : undefined));
  }

  setVacant(vacant: VacantLanes): void {
    this.edit('Coop lanes', (g) => (g.lanes = pruned({ ...g.lanes, vacant: vacant === 'close' ? undefined : vacant })));
  }

  allowed(id: string): boolean {
    const t = this.gp().towers;
    return !t || t.includes(id);
  }

  toggleTower(id: string, on: boolean): void {
    this.edit('Towers', (g) => {
      const now = new Set(g.towers ?? this.towers.map((t) => t.id));
      if (on) now.add(id);
      else now.delete(id);
      g.towers = now.size === this.towers.length ? undefined : this.towers.map((t) => t.id).filter((t) => now.has(t));
    });
  }

  allTowers(on: boolean): void {
    this.edit('Towers', (g) => (g.towers = on ? undefined : []));
  }

  setSource(kind: 'budget' | 'table'): void {
    this.edit('Wave source', (g) => {
      if (kind === 'budget') g.waves = undefined;
      else if (g.waves?.kind !== 'table') g.waves = { kind: 'table', table: { cycle: { fromWave: 1, hpGrowth: 1.5 }, waves: [] } };
    });
  }

  /** Starts the list from the game's own wave list */
  copyGameList(): void {
    this.edit('Wave list', (g) => {
      g.waves = { kind: 'table', table: structuredClone(WAVE_TABLE) as unknown as MapWaveTable };
    });
  }

  private editTable(label: string, fn: (t: MapWaveTable) => void): void {
    this.edit(label, (g) => {
      if (g.waves?.kind !== 'table') return;
      fn(g.waves.table);
      g.waves.table.waves.forEach((row, k) => (row.wave = k + 1));
    });
  }

  addRow(): void {
    this.editTable('Add wave', (t) => {
      const last = t.waves.at(-1);
      t.waves.push(last ? { ...structuredClone(last), name: `Wave ${t.waves.length + 1}`, hpMult: Math.round(last.hpMult * 1.15 * 100) / 100 } : { wave: 1, name: 'Wave 1', enemies: { [this.enemies[0].id]: 10 }, hpMult: 1, spawnDelay: 800 });
    });
    this.open.set((this.table()?.waves.length ?? 1) - 1);
  }

  removeRow(index: number): void {
    this.editTable('Remove wave', (t) => t.waves.splice(index, 1));
    this.open.set(null);
  }

  setRow(index: number, key: 'name' | 'hpMult' | 'spawnDelay', e: Event): void {
    const raw = (e.target as HTMLInputElement).value;
    this.editTable('Wave', (t) => {
      const row = t.waves[index] as MapWaveRow;
      if (key === 'name') row.name = raw.trim() || row.name;
      else {
        const v = Number(raw);
        if (Number.isFinite(v)) row[key] = v;
      }
    });
  }

  setEnemy(index: number, type: string, count: number, previous?: string): void {
    this.editTable('Wave enemies', (t) => {
      const row = t.waves[index];
      if (previous && previous !== type) delete row.enemies[previous];
      if (count > 0) row.enemies[type] = Math.round(count);
      else delete row.enemies[type];
    });
  }

  addEnemy(index: number): void {
    const row = this.table()?.waves[index];
    if (!row) return;
    const free = this.enemies.find((e) => !(e.id in row.enemies));
    if (free) this.setEnemy(index, free.id, 5);
  }

  setCycle(key: 'fromWave' | 'hpGrowth', e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    this.editTable('Repeat rule', (t) => (t.cycle[key] = key === 'fromWave' ? Math.max(1, Math.round(v)) : v));
  }

  entries(row: MapWaveRow): [string, number][] {
    return Object.entries(row.enemies);
  }

  total(row: MapWaveRow): number {
    return Object.values(row.enemies).reduce((s, n) => s + n, 0);
  }

  enemyName(id: string): string {
    return ENEMY_TYPES[id]?.name ?? id;
  }

  value(e: Event): string {
    return (e.target as HTMLSelectElement).value;
  }

  num(e: Event): number {
    return Number((e.target as HTMLInputElement).value);
  }
}
