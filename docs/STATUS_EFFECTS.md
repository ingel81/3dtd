# Status Effects System

**Stand:** 2026-05-12

Dokumentation des Status-Effekt-Systems für Debuffs und Buffs auf Enemies.

---

## Übersicht

Das Status-Effekt-System ermöglicht es Towern, temporäre Effekte auf Enemies anzuwenden (Verlangsamung, DoT, etc.). Effekte werden auf der `MovementComponent` jedes Enemies gespeichert und vom `StatusEffectService` (Angular `@Injectable`, in `services/combat/status-effect.service.ts`) angewendet.

**Aktuell implementiert:**
- **Slow** (Verlangsamung) — Ice Tower, Splash
- **Poison** (DoT) — Poison Tower, Splash

**Reserviert (im `StatusEffectType` definiert, aber aktuell nicht aktiv genutzt):**
- Freeze
- Burn

> **Wichtig — Game-Time statt Wall-Clock:** Seit dem Sub-Step-Refactor laufen Status-Effekt-Timer **in Game-Time-Millisekunden** (deterministisch, unabhängig vom Speed-Multiplier). `effect.startTime` wird über einen `gameClockProvider` aus dem `GameStateManager` bezogen — kein `performance.now()` mehr.

---

## Architektur

### Status Effect Interface

```typescript
// models/status-effects.ts

export type StatusEffectType = 'slow' | 'freeze' | 'burn' | 'poison';

export interface StatusEffect {
  type: StatusEffectType;
  value: number;        // Effekt-Stärke (z.B. 0.5 = 50% slow, oder 5 = 5 DPS bei poison)
  duration: number;     // Dauer in Game-Time ms
  /** GameStateManager.gameTimeMs zum Zeitpunkt des Anwendens. */
  startTime: number;
  sourceId?: string;    // Tower ID für Refresh-Logik
}
```

### StatusEffectService

```typescript
// services/combat/status-effect.service.ts

@Injectable({ providedIn: 'root' })
export class StatusEffectService {
  setGameClockProvider(provider: () => number): void;
  applySlow(enemy: Enemy, slowAmount: number, duration: number, sourceId: string): void;
  applyPoison(enemy: Enemy, dotDps: number, duration: number, sourceId: string): void;
  applyEffect(enemy: Enemy, type: StatusEffectType, value: number, duration: number, sourceId: string): void;
  removeExpired(enemy: Enemy): void;
  hasActiveEffect(enemy: Enemy, type: StatusEffectType): boolean;
}
```

`setGameClockProvider()` wird einmal beim `GameStateManager.initialize()` aufgerufen. Vermeidet zirkuläre DI (CombatEffectService → StatusEffectService → GameStateManager → CombatEffectService).

### Component-Integration

Status-Effekte werden im `MovementComponent` gespeichert:

```typescript
// game-components/movement.component.ts

export class MovementComponent extends Component {
  statusEffects: StatusEffect[] = [];

  applyStatusEffect(effect: StatusEffect): void;
  /** Single-Pass Update: entfernt abgelaufene Effekte + gibt aktive Flags zurück. */
  updateStatusEffects(gameTimeMs: number): { isSlowed: boolean; isPoisoned: boolean; slowMultiplier: number };
  removeExpiredEffects(gameTimeMs: number): void;
  getSlowMultiplier(gameTimeMs: number): number;
  getEffectiveSpeed(gameTimeMs: number): number;
  isSlowed(gameTimeMs: number): boolean;
  isPoisoned(gameTimeMs: number): boolean;
}
```

---

## Slow Effect (Verlangsamung)

### Funktionsweise

Slow-Effekte reduzieren die Bewegungsgeschwindigkeit von Enemies:

```typescript
effectiveSpeed = baseSpeed × speedMultiplier × slowMultiplier
```

**Beispiel:**
- Base Speed: 5 m/s
- Speed Multiplier: 1.0 (Walk) oder 2.5 (Run)
- Slow Multiplier: 0.5 (50% Verlangsamung)
- **Effective Speed:** 5 × 1.0 × 0.5 = 2.5 m/s

### Slow Multiplier Berechnung

```typescript
getSlowMultiplier(gameTimeMs: number): number {
  for (const effect of this.statusEffects) {
    if (effect.type === 'slow' && gameTimeMs - effect.startTime < effect.duration) {
      return 1 - effect.value;
    }
  }
  return 1.0; // Not slowed
}
```

**Wichtig:** `effect.duration` ist Game-Time ms. Da Movement und Effekt-Timer beide in Game-Time laufen, ist keine `timescale`-Kompensation mehr nötig.

### Kein Stacking

Slow-Effekte **stacken nicht** - es kann nur ein Slow gleichzeitig aktiv sein. Jeder neue Slow ersetzt den vorherigen (unabhängig von Source):

| Situation | Ergebnis |
|-----------|----------|
| Ice Tower A trifft → 50% slow | 50% langsamer |
| Ice Tower B trifft danach → 50% slow | Ersetzt vorherigen, weiterhin 50% langsamer (Timer reset) |

**Warum kein Stacking?**
- Einfachere Balance
- Verhindert dass Enemy komplett stoppt
- Ein Slow-Effekt pro Enemy reicht für klare Spielmechanik

### Anwendung

Slow wird via `StatusEffectService` angewendet. `CombatEffectService` reagiert auf `projectile:hit` Events und delegiert an `StatusEffectService`:

```typescript
// In StatusEffectService (services/combat/status-effect.service.ts)
applySlow(enemy: Enemy, slowAmount: number, duration: number, sourceId: string): void {
  enemy.movement.applyStatusEffect({
    type: 'slow',
    value: slowAmount,           // aus GAME_BALANCE.effects.ice.slowAmount (0.5)
    duration,                    // aus GAME_BALANCE.effects.ice.duration (3000ms)
    startTime: this.gameClockProvider(),
    sourceId,
  });
}

// Aufruf aus CombatEffectService:
// this.statusEffectService.applySlow(enemy, slowAmount, duration, tower.id);
```

### Refresh-Logik

`slow` und `poison` werden **immer ersetzt** — es gibt kein Stacking. Jeder neue Effekt dieses Typs ersetzt den vorherigen, unabhängig von der Source.
Andere Effekttypen werden pro `(type, sourceId)` deduplikiert (gleiche Quelle = Refresh, andere Quelle = neuer Eintrag).

```typescript
applyStatusEffect(effect: StatusEffect): void {
  // Slow: nur einer aktiv (kein Stacking)
  if (effect.type === 'slow') {
    const idx = this.statusEffects.findIndex((e) => e.type === 'slow');
    if (idx >= 0) this.statusEffects[idx] = effect;
    else this.statusEffects.push(effect);
    return;
  }

  // Poison: nur einer aktiv (kein Stacking)
  if (effect.type === 'poison') {
    const idx = this.statusEffects.findIndex((e) => e.type === 'poison');
    if (idx >= 0) this.statusEffects[idx] = effect;
    else this.statusEffects.push(effect);
    return;
  }

  // Andere Effekte: gleicher Typ + gleiche Source = Refresh
  const idx = this.statusEffects.findIndex(
    (e) => e.type === effect.type && e.sourceId === effect.sourceId,
  );
  if (idx >= 0) this.statusEffects[idx] = effect;
  else this.statusEffects.push(effect);
}
```

**Beispiel:**
- Ice Tower A trifft Enemy → 50% slow, 3s
- Nach 1s: Ice Tower A trifft erneut → Timer wird auf 3s zurückgesetzt
- Nach 2s: Ice Tower B trifft Enemy → Ersetzt Slow von Tower A (weiterhin 50%, Timer reset)

### Cleanup

Abgelaufene Effekte werden im Single-Pass `updateStatusEffects(gameTimeMs)` entfernt (in-place Compact, keine Array-Allokation). Game-Time skaliert automatisch mit dem Timescale-Multiplier — bei 2× Speed läuft die Game-Clock doppelt so schnell, also auch die Effekt-Timer:

```typescript
// In EnemyManager (Sub-Step Loop)
const status = enemy.movement.updateStatusEffects(gameTimeMs);
// status.isSlowed, status.isPoisoned, status.slowMultiplier können direkt
// für Movement und DoT-Tick weiterverwendet werden.

// In MovementComponent
removeExpiredEffects(gameTimeMs: number): void {
  let writeIdx = 0;
  for (let i = 0; i < this.statusEffects.length; i++) {
    const e = this.statusEffects[i];
    if (gameTimeMs - e.startTime < e.duration) {
      this.statusEffects[writeIdx++] = e;
    }
  }
  this.statusEffects.length = writeIdx; // In-place, no allocation
}
```

---

## Poison Effect (DoT)

**Status:** Aktiv — vom Poison Tower und dessen Splash angewendet.

### Funktionsweise

```typescript
{
  type: 'poison',
  value: 5,                          // 5 Schaden pro Sekunde
  duration: 4000,                    // 4 Sekunden Game-Time
  startTime: gameClockProvider(),
  sourceId: tower.id,
}
```

**Implementierung:**
- DoT-Tick im Enemy-Sub-Step-Loop (Damage = `value × deltaSeconds`).
- Kein Stacking — neuer Poison ersetzt den vorherigen (Timer-Refresh).
- `updateStatusEffects()` setzt `isPoisoned: true` als aktiver Flag.

### Anwendung (StatusEffectService)

```typescript
applyPoison(enemy: Enemy, dotDps: number, duration: number, sourceId: string): void {
  enemy.movement.applyStatusEffect({
    type: 'poison',
    value: dotDps,
    duration,
    startTime: this.gameClockProvider(),
    sourceId,
  });
}
```

---

## Freeze / Burn (Reserviert)

`freeze` und `burn` sind als `StatusEffectType` definiert; im Update-Pfad behandelt `updateStatusEffects()` `freeze` zwar als `isSlowed = true`, aber es gibt aktuell keinen Tower, der sie ausspielt. Designs werden in [TODO.md](../TODO.md) und [MASTER_GAME_DESIGN.md](game-design/MASTER_GAME_DESIGN.md) verfolgt.

---

## Ice Tower Integration (Slow Example)

Der Ice Tower wendet Slow auf alle Enemies in Splash-Radius an. Die Logik liegt im `CombatEffectService`, der event-driven auf `projectile:hit` Events reagiert:

```typescript
// In CombatEffectService.handleProjectileHit() (via projectile:hit Event)
const isIceShard = projectile.typeConfig.id === 'ice-shard';

// Schaden auf Hauptziel
this.applyDamageToEnemy(enemy, projectile.damage, projectile.sourceTowerId, false, isIceShard);

// Slow auf Hauptziel
if (isIceShard) {
  this.applySlowEffect(
    enemy,
    GAME_BALANCE.effects.ice.slowAmount,  // 0.5
    GAME_BALANCE.effects.ice.duration,    // 3000ms
    projectile.sourceTowerId
  );
}

// Splash: Slow + Damage auf nahe Enemies
if (hasSplash) {
  const nearbyEnemies = this.globalRouteGrid.getEnemiesInRadiusGeo(
    enemy.position,
    splashRadius,
    enemy.id
  );

  for (const nearbyEnemy of nearbyEnemies) {
    // Splash-Schaden mit Distance-Falloff
    // ...
    if (isIceShard) {
      this.applySlowEffect(
        nearbyEnemy,
        GAME_BALANCE.effects.ice.slowAmount,
        GAME_BALANCE.effects.ice.duration,
        projectile.sourceTowerId
      );
    }
  }
}
```

**Konfiguration** (aus `configs/game-balance.config.ts`):
```typescript
effects: {
  ice: {
    slowAmount: 0.5,   // 50% Verlangsamung
    duration: 3000,     // 3 Sekunden
  },
}
```

---

## Visuelle Effekte

### Slow Effect (Ice Tower)

**Aktuell implementiert:**
- Eis-Explosion (Partikel) am Einschlagort (`spawnIceExplosionAtGeo`)
- Eis-Decals auf dem Boden (nur bei Ground Units, `spawnIceDecal`)
- Zusätzliche kleinere Decals im Umkreis
- Langsamere Bewegung des Enemies

**Geplant:**
- Blauer Glow um Enemy
- Icon über Health Bar

### Freeze Effect

**Geplant:**
- Eis-Overlay auf Model (Material-Ersatz)
- Blauer Glow (emissive)
- Einfrieren-Partikel

### Burn Effect

**Geplant:**
- Feuer-Partikel (ähnlich wie HQ Fire)
- Orange/roter Glow
- Rauch-Partikel

---

## Performance-Überlegungen

### Status Effect Array

- Pro Enemy: 0-5 Effekte (typisch 0-2)
- Filter-Operation jedes Frame: O(n) mit n = Anzahl Effekte
- Kein Problem bei <1000 Enemies

### Optimization Möglichkeiten

1. **Fixed Array statt Filter:**
   ```typescript
   // Statt filter (Array-Allocation)
   removeExpiredEffects(): void {
     let writeIndex = 0;
     for (let i = 0; i < this.statusEffects.length; i++) {
       if (!this.isExpired(this.statusEffects[i])) {
         this.statusEffects[writeIndex++] = this.statusEffects[i];
       }
     }
     this.statusEffects.length = writeIndex;
   }
   ```

2. **Max Effects Limit:**
   ```typescript
   const MAX_EFFECTS = 5;
   if (this.statusEffects.length >= MAX_EFFECTS) {
     this.statusEffects.shift(); // Remove oldest
   }
   this.statusEffects.push(effect);
   ```

3. **Batch Cleanup:**
   ```typescript
   // Nur alle 100ms cleanen statt jedes Frame
   if (now - this.lastCleanup > 100) {
     this.removeExpiredEffects();
     this.lastCleanup = now;
   }
   ```

---

## Erweiterung: Neue Status-Effekte

### 1. Effekt-Typ definieren

```typescript
// models/status-effects.ts
export type StatusEffectType = 'slow' | 'freeze' | 'burn' | 'NEW_EFFECT';
```

### 2. Anwendungs-Logik

```typescript
// In Tower oder Projectile
enemy.movement.applyStatusEffect({
  type: 'NEW_EFFECT',
  value: 1.0,
  duration: 5000,
  startTime: performance.now(),
  sourceId: tower.id,
});
```

### 3. Effekt-Handling

**Option A: In MovementComponent (für Movement-Effekte)**

```typescript
// movement.component.ts
getNewEffectMultiplier(): number {
  // Ähnlich wie getSlowMultiplier()
}
```

**Option B: In EnemyManager (für Damage-Effekte)**

```typescript
// enemy.manager.ts
private updateBurnDamage(enemy: Enemy, deltaTime: number): void {
  for (const effect of enemy.movement.statusEffects) {
    if (effect.type === 'burn') {
      const dps = effect.value;
      const damage = dps * (deltaTime / 1000);
      enemy.health.takeDamage(damage);
    }
  }
}
```

### 4. Visuals (optional)

```typescript
// In ThreeEnemyRenderer
if (enemy.movement.isSlowed(timescale)) {
  this.applySlowGlow(enemy.id);
}
```

---

## Testing

### Manual Testing

`startTime` muss aus dem Game-Clock kommen (nicht `performance.now()`), sonst läuft der Timer asynchron zur Spiellogik:

```typescript
// In Wave Debug Component
constructor(private statusEffectService: StatusEffectService, ...) {}

testSlowEffect(): void {
  const enemies = this.enemyManager.getAlive();
  for (const enemy of enemies) {
    this.statusEffectService.applyEffect(enemy, 'slow', 0.7, 10000, 'debug');
  }
}
```

### Console Commands

```typescript
// Im Browser Console (ohne Game-Clock-Zugriff): nur grobe Tests, da
// performance.now() vom Game-Clock abweicht. Besser: über DebugFacade einen
// passenden Helper aufrufen.
```

---

## Siehe auch

- [ENEMY_CREATION.md](ENEMY_CREATION.md) - Enemy-Typen erstellen
- [TOWER_CREATION.md](TOWER_CREATION.md) - Tower-Typen erstellen
- [PROJECTILES.md](PROJECTILES.md) - Projektil-System
- [ARCHITECTURE.md](ARCHITECTURE.md) - System-Übersicht
