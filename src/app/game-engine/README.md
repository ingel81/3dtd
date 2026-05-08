# Game Engine - Event System

**Stand:** 2026-05-08

Framework-agnostische Game Engine mit Event-basierter Kommunikation.
Kann mit React, Vue oder Vanilla JavaScript verwendet werden.

---

## Dokumentation

Die vollstaendige Dokumentation befindet sich in `docs/`:

- **[EVENT_SYSTEM.md](../../../docs/EVENT_SYSTEM.md)** - Event-Typen, Event Flow, Best Practices
- **[ARCHITECTURE.md](../../../docs/ARCHITECTURE.md)** - Gesamt-Architektur
- **[SPATIAL_AUDIO.md](../../../docs/SPATIAL_AUDIO.md)** - 3D Audio + Hintergrundmusik

---

## Quick Start

```typescript
import { GameEventBus } from './game-engine';

const eventBus = new GameEventBus();

// Subscribe
eventBus.on('enemy:died', (event) => {
  console.log(`Enemy ${event.enemy.id} died, reward: ${event.credits}`);
});

// Emit
eventBus.emit({
  type: 'enemy:died',
  enemy: myEnemy,
  credits: 100,
  position: new Vector3(10, 0, 5),
});
```

---

## Dateien

```
src/app/game-engine/
├── game-event-bus.ts          # Event Bus Core (~671 LOC)
├── vfx.service.ts             # VFX Event Handler (~153 LOC)
├── audio.service.ts           # Audio Event Handler (~61 LOC)
├── background-music.service.ts # Phasen-basierte Musik (Two-Channel A/B Crossfade)
├── screen-shake.service.ts    # Screen-Shake-Effekte
├── index.ts                   # Barrel exports
└── README.md                  # Diese Datei
```

---

## Komponenten-Status

| Komponente | Rolle |
|------------|------|
| GameEventBus | Core System (~40 Event-Typen) |
| VFXService | Subscriber: `vfx:*`, `projectile:hit` |
| AudioService | Subscriber: `audio:play` |
| BackgroundMusicService | Phasen-getriggerter Track-Wechsel mit Crossfade |
| ScreenShakeService | Subscriber: VFX-Impact-Events |
| ProjectileManager | Producer: `projectile:hit`, `vfx:*`, `audio:play` |
| EnemyManager | Producer: `enemy:died`, `enemy:reached-base`, `dot:damage` |
| WaveManager | Producer: `wave:started`, `wave:completed` |
| TowerManager | Producer: `tower:placed`, `tower:sold` |
| ResearchManager | Producer: `research:started`, `research:completed`, `research:cancelled` |
| CombatEffectService | Subscriber: `projectile:hit` |
| DamageApplicationService | Schadens-Pipeline (Damage-Matrix) |
| StatusEffectService | Slow / Burn / Poison (Game-Time) |
| HQDamageService | Subscriber: `enemy:reached-base` |
| GameStateManager | Adapter / Orchestrator |

---

## Performance

- Event Emission: ~50–100ns pro Event
- Typische Last: ~50–100 Events/Frame @ 60 FPS
- Overhead: ~5μs/Frame (0.03% des 16ms Budgets)

**Vernachlaessigbarer Performance Impact.**
