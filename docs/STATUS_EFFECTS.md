# Status Effects System

**Stand:** 2026-01-17

Dokumentation des Status-Effekt-Systems für Debuffs und Buffs auf Enemies.

---

## Übersicht

Das Status-Effekt-System ermöglicht es Towern, temporäre Effekte auf Enemies anzuwenden (z.B. Verlangsamung, Einfrieren, Brennen).

**Aktuell implementiert:**
- Slow (Verlangsamung)

**Geplant:**
- Freeze (Einfrieren)
- Burn (Brennen / Damage over Time)

---

## Architektur

### Status Effect Interface

```typescript
// models/status-effects.ts

export type StatusEffectType = 'slow' | 'freeze' | 'burn';

export interface StatusEffect {
  type: StatusEffectType;
  value: number;        // Effekt-Stärke (z.B. 0.5 = 50% slow)
  duration: number;     // Dauer in Millisekunden
  startTime: number;    // performance.now() bei Anwendung
  sourceId?: string;    // Tower ID für Refresh-Logik
}
```

### Component-Integration

Status-Effekte werden im `MovementComponent` gespeichert:

```typescript
// game-components/movement.component.ts

export class MovementComponent extends Component {
  statusEffects: StatusEffect[] = [];

  applyStatusEffect(effect: StatusEffect): void;
  removeExpiredEffects(timescale?: number): void;
  getSlowMultiplier(timescale?: number): number;
  getEffectiveSpeed(timescale?: number): number;
  isSlowed(timescale?: number): boolean;
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
getSlowMultiplier(timescale = 1.0): number {
  const now = performance.now();

  for (const effect of this.statusEffects) {
    const effectiveDuration = effect.duration / timescale;
    if (effect.type === 'slow' && now - effect.startTime < effectiveDuration) {
      // Slow effect active - return reduced speed multiplier
      return 1 - effect.value;
    }
  }

  return 1.0; // Not slowed
}
```

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

Slow wird via `CombatEffectService` angewendet, der auf `projectile:hit` Events reagiert:

```typescript
// In CombatEffectService (event-driven via projectile:hit)
private applySlowEffect(enemy: Enemy, slowAmount: number, duration: number, sourceId: string): void {
  const effect: StatusEffect = {
    type: 'slow',
    value: slowAmount,       // aus GAME_BALANCE.effects.ice.slowAmount (0.5)
    duration,                // aus GAME_BALANCE.effects.ice.duration (3000ms)
    startTime: performance.now(),
    sourceId,
  };
  enemy.movement.applyStatusEffect(effect);
}
```

### Refresh-Logik

Slow-Effekte werden **immer ersetzt** - es gibt kein Stacking. Jeder neue Slow ersetzt den vorherigen, unabhängig von der Source:

```typescript
applyStatusEffect(effect: StatusEffect): void {
  // Slow: Nur ein Slow gleichzeitig (kein Stacking)
  if (effect.type === 'slow') {
    const existingSlowIndex = this.statusEffects.findIndex((e) => e.type === 'slow');
    if (existingSlowIndex >= 0) {
      // Replace existing slow (refresh duration)
      this.statusEffects[existingSlowIndex] = effect;
    } else {
      this.statusEffects.push(effect);
    }
    return;
  }

  // Andere Effekte: Gleicher Typ + gleiche Source = Refresh
  const existingIndex = this.statusEffects.findIndex(
    (e) => e.type === effect.type && e.sourceId === effect.sourceId
  );

  if (existingIndex >= 0) {
    this.statusEffects[existingIndex] = effect;
  } else {
    this.statusEffects.push(effect);
  }
}
```

**Beispiel:**
- Ice Tower A trifft Enemy → 50% slow, 3s
- Nach 1s: Ice Tower A trifft erneut → Timer wird auf 3s zurückgesetzt
- Nach 2s: Ice Tower B trifft Enemy → Ersetzt Slow von Tower A (weiterhin 50%, Timer reset)

### Cleanup

Abgelaufene Effekte werden jedes Frame entfernt. Die `timescale` beeinflusst die effektive Dauer (bei 2x Speed laufen Effekte doppelt so schnell ab):

```typescript
// In EnemyManager.update(deltaTime, timescale)
enemy.movement.removeExpiredEffects(timescale);

// In MovementComponent
removeExpiredEffects(timescale = 1.0): void {
  const now = performance.now();
  this.statusEffects = this.statusEffects.filter(
    (effect) => {
      const effectiveDuration = effect.duration / timescale;
      return now - effect.startTime < effectiveDuration;
    }
  );
}
```

---

## Freeze Effect (Geplant)

**Status:** Noch nicht implementiert

### Geplante Funktionsweise

```typescript
{
  type: 'freeze',
  value: 1.0,           // 100% = komplett eingefroren
  duration: 2000,       // 2 Sekunden
  startTime: performance.now(),
  sourceId: tower.id,
}
```

**Implementierung:**
- `value: 1.0` → `slowMultiplier = 0` → Enemy stoppt komplett
- Visual: Eis-Overlay auf Enemy-Model
- Sound: Einfrieren-Sound beim Auftragen

**Unterschied zu Slow:**
- Freeze = 100% Verlangsamung (Enemy steht still)
- Kürzere Duration als Slow (zu stark)
- Evtl. kein Stacking (max. 1 Freeze gleichzeitig)

---

## Burn Effect (Geplant)

**Status:** Noch nicht implementiert

### Geplante Funktionsweise

Damage over Time (DoT) - schadet Enemy kontinuierlich:

```typescript
{
  type: 'burn',
  value: 10,            // 10 Schaden pro Sekunde
  duration: 5000,       // 5 Sekunden = 50 total damage
  startTime: performance.now(),
  sourceId: tower.id,
}
```

**Implementierung:**
- Eigene Update-Logik in EnemyManager
- `damage = value × (deltaTime / 1000)` pro Frame
- Visual: Feuer-Partikel auf Enemy
- Sound: Brennen-Loop

**Stacking:**
- Burn-Effekte addieren sich (10 DPS + 10 DPS = 20 DPS)
- Alternative: Refresh wie Slow (nur stärkster/längster gilt)

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

```typescript
// In Wave Debug Component
testSlowEffect(): void {
  const enemies = this.enemyManager.getAlive();
  for (const enemy of enemies) {
    enemy.movement.applyStatusEffect({
      type: 'slow',
      value: 0.7, // 70% slow
      duration: 10000, // 10s
      startTime: performance.now(),
    });
  }
}
```

### Console Commands

```typescript
// Im Browser Console
const enemy = gameState.enemyManager.getAlive()[0];
enemy.movement.applyStatusEffect({
  type: 'slow',
  value: 0.9,
  duration: 5000,
  startTime: performance.now()
});
```

---

## Siehe auch

- [ENEMY_CREATION.md](ENEMY_CREATION.md) - Enemy-Typen erstellen
- [TOWER_CREATION.md](TOWER_CREATION.md) - Tower-Typen erstellen
- [PROJECTILES.md](PROJECTILES.md) - Projektil-System
- [ARCHITECTURE.md](ARCHITECTURE.md) - System-Übersicht
