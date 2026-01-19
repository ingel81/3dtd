# Game Engine - Event System

**Status:** Phase 10 Complete ✅ (2026-01-19)

Framework-agnostische Game Engine mit Event-basierter Kommunikation.
Kann mit React, Vue oder Vanilla JavaScript verwendet werden.

---

## Dokumentation

Die vollstaendige Dokumentation befindet sich in `src/app/docs/`:

- **[EVENT_SYSTEM.md](../docs/EVENT_SYSTEM.md)** - Event-Typen, Event Flow, Best Practices
- **[ARCHITECTURE.md](../docs/ARCHITECTURE.md)** - Gesamt-Architektur

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
├── game-event-bus.ts    # Event Bus Core (~530 LOC)
├── vfx.service.ts       # VFX Event Handler (~85 LOC)
├── audio.service.ts     # Audio Event Handler (~56 LOC)
├── index.ts             # Barrel exports
└── README.md            # Diese Datei
```

---

## Komponenten-Status

| Komponente | Status | Events |
|------------|--------|--------|
| GameEventBus | ✅ | Core System (20 Event-Typen) |
| VFXService | ✅ | Subscriber: `vfx:projectile-impact` |
| AudioService | ✅ | Subscriber: `audio:play` |
| ProjectileManager | ✅ | Producer: `projectile:hit`, `vfx:*`, `audio:play` |
| EnemyManager | ✅ | Producer: `enemy:died`, `enemy:reached-base` |
| WaveManager | ✅ | Producer: `wave:started`, `wave:completed` |
| TowerManager | ✅ | Producer: `tower:placed`, `tower:sold` |
| CombatEffectService | ✅ | Subscriber: `projectile:hit` |
| HQDamageService | ✅ | Subscriber: `health:changed` |
| GameStateManager | ✅ | Adapter/Orchestrator |

---

## Performance

- Event Emission: ~50-100ns pro Event
- Typische Last: ~50 Events/Frame @ 60 FPS
- Overhead: ~5μs/Frame (0.03% des 16ms Budgets)

**Vernachlaessigbarer Performance Impact!**
