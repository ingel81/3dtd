# Event Flow Examples - Wer erzeugt was und warum?

**Erstellt:** 2026-01-19
**Zweck:** Detaillierte Beispiele für jeden Event-Typ - Producer, Consumers, Effects

---

## 📖 Lesehinweis

Für jeden Event-Typ dokumentieren wir:
- **Producer:** Wer emittiert das Event?
- **Consumers:** Wer subscribt darauf?
- **Effect:** Was passiert als Resultat?
- **Code Example:** Konkretes Beispiel (Aktuell vs. Mit Events)

---

## 1. Enemy Events

### 1.1 `enemy:died`

**Producer:** `EnemyManager` oder `Enemy.die()`

**Consumers:**
- `GameEngine` → Credits updaten
- `CombatEffectService` → Blood Effect spawnen
- `SpatialAudioService` → Death Sound abspielen
- `TowerManager` → Towers stoppen Targeting dieses Enemy
- `WaveManager` → Enemy Count reduzieren, Wave Complete prüfen
- `UIService` → Kill Counter updaten

**Effect:**
- Credits erhöhen sich
- Blood Particles werden gespawnt
- Death Sound wird abgespielt
- Tower suchen neues Target
- UI zeigt neue Kill-Statistik

**Aktuell (mit Callbacks):**
```typescript
// enemy.entity.ts
die() {
  this.alive = false;
  // Callback in GameStateManager
  this.onDiedCallback?.(this);
}

// game-state.manager.ts - alles an einem Ort
enemyManager.initialize(engine, (enemy) => {
  // Credits
  this.credits.update(c => c + enemy.rewardCredits);
  // VFX
  this.combatEffect.playBloodEffect(enemy.position);
  // Audio
  this.spatialAudio.playAtGeo('enemy_death', enemy.position);
  // Tower cleanup
  this.towerManager.clearTargetIfMatches(enemy);
  // Wave progress
  this.waveManager.onEnemyDied();
});
```

**Mit Events:**
```typescript
// enemy.entity.ts
die() {
  this.alive = false;

  // Emit immediate event (kritisch für game state)
  this.eventBus.emit({
    type: 'enemy:died',
    enemy: this,
    credits: this.rewardCredits,
    position: this.position
  });
}

// game-engine.ts - Credits Management
eventBus.on('enemy:died', (event) => {
  this.credits += event.credits;

  // Emit credits changed für UI
  this.eventBus.emit({
    type: 'credits:changed',
    credits: this.credits,
    delta: event.credits
  });
});

// combat-effect.service.ts - VFX
eventBus.on('enemy:died', (event) => {
  this.spawnBloodEffect(event.position);
});

// spatial-audio.service.ts - Audio
eventBus.on('enemy:died', (event) => {
  this.playAtGeo('enemy_death', event.position);
});

// tower-manager.ts - Target Cleanup
eventBus.on('enemy:died', (event) => {
  for (const tower of this.towers) {
    if (tower.targetEnemy === event.enemy) {
      tower.clearTarget();
    }
  }
});

// wave-manager.ts - Wave Progress
eventBus.on('enemy:died', (event) => {
  this.enemiesKilled++;

  if (this.enemiesKilled >= this.currentWave.totalEnemies) {
    this.eventBus.emit({
      type: 'wave:completed',
      wave: this.waveNumber,
      credits: this.calculateWaveBonus()
    });
  }
});
```

**Warum besser mit Events?**
- ✅ Decoupling: Enemy kennt GameEngine nicht mehr
- ✅ Testbar: Jeder Consumer kann separat getestet werden
- ✅ Erweiterbar: Neues Achievement-System? Einfach subscriben!
- ✅ Maintainable: Logik ist dort wo sie hingehört

---

### 1.2 `enemy:reached-base`

**Producer:** `EnemyManager.update()`

**Consumers:**
- `GameEngine` → Base Health reduzieren
- `HQDamageService` → Fire Intensity erhöhen
- `SpatialAudioService` → Alarm Sound
- `CameraService` → Shake Effect

**Effect:**
- Base Health sinkt
- HQ brennt stärker
- Alarm Sound wird abgespielt
- Kamera wackelt
- Game Over Check

**Aktuell:**
```typescript
// enemy.manager.ts
update(deltaTime: number) {
  for (const enemy of this.enemies) {
    if (enemy.hasReachedEnd()) {
      // Callback
      this.onEnemyReachedBase?.(enemy);
      this.removeEnemy(enemy);
    }
  }
}

// game-state.manager.ts
enemyManager.initialize(engine, (enemy) => {
  // Base damage
  this.baseHealth.update(h => h - 10);
  // Fire effect
  this.hqDamage.increaseFireIntensity(0.1);
  // Alarm sound
  this.spatialAudio.play('alarm');
  // Game over check
  if (this.baseHealth() <= 0) {
    this.onGameOverCallback?.();
  }
});
```

**Mit Events:**
```typescript
// enemy.manager.ts
update(deltaTime: number) {
  for (const enemy of this.enemies) {
    if (enemy.hasReachedEnd()) {
      // Emit immediate event (kritisch!)
      this.eventBus.emit({
        type: 'enemy:reached-base',
        enemy,
        damage: 10
      });

      this.removeEnemy(enemy);
    }
  }
}

// game-engine.ts
eventBus.on('enemy:reached-base', (event) => {
  this.baseHealth -= event.damage;

  // Emit health changed
  this.eventBus.emit({
    type: 'health:changed',
    health: this.baseHealth,
    delta: -event.damage
  });

  // Game over check
  if (this.baseHealth <= 0) {
    this.eventBus.emit({
      type: 'game:over',
      reason: 'base-destroyed'
    });
  }
});

// hq-damage.service.ts
eventBus.on('enemy:reached-base', (event) => {
  this.increaseFireIntensity(0.1);
});

// spatial-audio.service.ts
eventBus.on('enemy:reached-base', (event) => {
  this.play('alarm');
});

// camera.service.ts
eventBus.on('enemy:reached-base', (event) => {
  this.shake(0.3, 500); // intensity, duration
});
```

---

## 2. Tower Events

### 2.1 `tower:placed`

**Producer:** `TowerManager.placeTower()`

**Consumers:**
- `GameEngine` → Credits abziehen
- `GlobalRouteGrid` → Tower registrieren (LOS berechnen)
- `SpatialAudioService` → Build Sound
- `UIService` → Tutorial Hint schließen

**Effect:**
- Credits werden abgezogen
- Tower wird im Spatial Grid registriert
- Build Sound wird abgespielt
- UI Tutorial verschwindet

**Aktuell:**
```typescript
// tower-manager.ts
placeTower(position: Vector3, type: TowerTypeId) {
  const tower = new Tower(type, position, ...);
  this.towers.push(tower);

  // Direkte Aufrufe
  this.credits.update(c => c - tower.cost);
  this.grid.registerTower(tower.id, tower.x, tower.z, ...);
  this.spatialAudio.play('build');

  return tower;
}
```

**Mit Events:**
```typescript
// tower-manager.ts
placeTower(position: Vector3, type: TowerTypeId) {
  const tower = new Tower(type, position, this.eventBus, this.grid);
  this.towers.push(tower);

  // Emit immediate event
  this.eventBus.emit({
    type: 'tower:placed',
    tower,
    position,
    cost: tower.cost
  });

  return tower;
}

// game-engine.ts
eventBus.on('tower:placed', (event) => {
  this.credits -= event.cost;

  this.eventBus.emit({
    type: 'credits:changed',
    credits: this.credits,
    delta: -event.cost
  });
});

// global-route-grid.ts (könnte direkt im Tower Constructor sein)
eventBus.on('tower:placed', (event) => {
  // Tower registriert sich selbst im Grid
  // ODER Grid subscribt und registriert Tower
  event.tower.visibleCells = this.registerTower(
    event.tower.id,
    event.position.x,
    event.position.z,
    event.tower.getTipY(),
    event.tower.range,
    losRaycaster
  );
});

// spatial-audio.service.ts
eventBus.on('tower:placed', (event) => {
  this.playAtPosition('build', event.position);
});

// ui.service.ts
eventBus.on('tower:placed', (event) => {
  // Erstes Mal Tower gebaut? Tutorial schließen
  if (this.isFirstTower) {
    this.closeTutorialHint('place-tower');
    this.isFirstTower = false;
  }
});
```

---

### 2.2 `tower:upgraded`

**Producer:** `Tower.upgrade()`

**Consumers:**
- `GameEngine` → Credits abziehen
- `GlobalRouteGrid` → LOS neu berechnen (falls Range geändert)
- `SpatialAudioService` → Upgrade Sound
- `VFXService` → Upgrade Particles

**Effect:**
- Credits reduzieren
- Tower Range/Damage erhöht
- LOS wird neu berechnet
- Upgrade Sound + VFX

**Mit Events:**
```typescript
// tower.entity.ts
upgrade(upgradeId: UpgradeId) {
  const upgrade = this.availableUpgrades[upgradeId];

  // Apply upgrade
  this.applyUpgrade(upgrade);
  this.level++;

  // Emit immediate event
  this.eventBus.emit({
    type: 'tower:upgraded',
    tower: this,
    level: this.level,
    cost: upgrade.cost
  });
}

// game-engine.ts
eventBus.on('tower:upgraded', (event) => {
  this.credits -= event.cost;

  this.eventBus.emit({
    type: 'credits:changed',
    credits: this.credits,
    delta: -event.cost
  });
});

// global-route-grid.ts
eventBus.on('tower:upgraded', (event) => {
  // Falls Range sich geändert hat, LOS neu berechnen
  if (event.tower.rangeChanged) {
    this.unregisterTower(event.tower.id);
    event.tower.visibleCells = this.registerTower(
      event.tower.id,
      event.tower.position.x,
      event.tower.position.z,
      event.tower.getTipY(),
      event.tower.range,
      losRaycaster
    );
  }
});

// spatial-audio.service.ts
eventBus.on('tower:upgraded', (event) => {
  this.playAtPosition('upgrade', event.tower.position);
});

// vfx.service.ts (deferred!)
eventBus.on('tower:upgraded', (event) => {
  this.spawnUpgradeParticles(event.tower.position);
});
```

---

### 2.3 `tower:sold`

**Producer:** `TowerManager.sellTower()`

**Consumers:**
- `GameEngine` → Credits zurückgeben
- `GlobalRouteGrid` → Tower unregistrieren
- `SpatialAudioService` → Sell Sound

**Effect:**
- Credits erhöhen (Refund)
- Tower wird aus Grid entfernt
- Sell Sound

**Mit Events:**
```typescript
// tower-manager.ts
sellTower(tower: Tower) {
  const refund = Math.floor(tower.totalCost * 0.75);

  // Remove from scene
  this.tilesEngine.towers.remove(tower.id);
  this.towers = this.towers.filter(t => t !== tower);

  // Emit event
  this.eventBus.emit({
    type: 'tower:sold',
    tower,
    refund
  });

  // Cleanup
  tower.destroy();
}

// game-engine.ts
eventBus.on('tower:sold', (event) => {
  this.credits += event.refund;

  this.eventBus.emit({
    type: 'credits:changed',
    credits: this.credits,
    delta: event.refund
  });
});

// global-route-grid.ts
eventBus.on('tower:sold', (event) => {
  this.unregisterTower(event.tower.id);
});

// spatial-audio.service.ts
eventBus.on('tower:sold', (event) => {
  this.playAtPosition('sell', event.tower.position);
});
```

---

## 3. Projectile Events 🎯 **WICHTIG!**

### 3.1 `projectile:hit`

**Producer:** `ProjectileManager.update()`

**Wann:** Projektil hat Ziel erreicht (Distance < threshold)

**Consumers:**
- `CombatSystem` → Damage anwenden
- `CombatEffectService` → Blood Effect spawnen
- `SpatialAudioService` → Impact Sound
- `TowerCombatService` → AOE Damage (falls explosive)
- `StatusEffectSystem` → Slow/Burn Effect anwenden (falls vorhanden)

**Effect:**
- Enemy nimmt Damage
- Blood Particles werden gespawnt
- Impact Sound wird abgespielt
- Falls explosive: AOE Damage auf nahe Enemies
- Falls Special: Status Effect (Slow, Burn, etc.)
- Falls Enemy stirbt: `enemy:died` Event wird emittiert

**Aktuell (mit Callback):**
```typescript
// projectile.manager.ts
override update(deltaTime: number): void {
  for (const projectile of this.getAllActive()) {
    const hit = projectile.updateTowardsTarget(deltaTime);

    if (hit) {
      // Callback zu GameStateManager
      if (!projectile.targetLost) {
        this.onProjectileHit?.(projectile, projectile.targetEnemy);
      }

      // Explosion VFX (direkt hier)
      if (projectile.isHoming) {
        this.tilesEngine?.effects.spawnExplosionAtGeo(...);
      }

      toRemove.push(projectile);
    }
  }
}

// game-state.manager.ts - alles an einem Ort
projectileManager.initialize(engine, (projectile, enemy) => {
  // Damage
  enemy.takeDamage(projectile.damage);

  // Blood effect
  this.combatEffect.playBloodEffect(enemy.position);

  // Impact sound
  this.spatialAudio.playAtGeo('impact', enemy.position);

  // Check death
  if (enemy.health <= 0) {
    // ... enemy death logic
  }
});
```

**Mit Events (sauber getrennt!):**
```typescript
// projectile.manager.ts
override update(deltaTime: number): void {
  for (const projectile of this.getAllActive()) {
    const hit = projectile.updateTowardsTarget(deltaTime);

    if (hit && !projectile.targetLost) {
      // Emit immediate event (kritisch für Damage!)
      this.eventBus.emit({
        type: 'projectile:hit',
        projectile,
        target: projectile.targetEnemy,
        damage: projectile.damage
      });

      toRemove.push(projectile);
    }
  }
}

// combat.system.ts - Damage Logic
eventBus.on('projectile:hit', (event) => {
  const { target, damage, projectile } = event;

  // Apply damage
  target.takeDamage(damage);

  // Emit damage event (für Stats, Achievements, etc.)
  this.eventBus.emit({
    type: 'damage:dealt',
    source: projectile.sourceTower,
    target,
    amount: damage
  });

  // Check death
  if (target.health <= 0) {
    target.die(); // Dies emittiert 'enemy:died' Event
  }
});

// combat-effect.service.ts - Blood VFX
eventBus.on('projectile:hit', (event) => {
  this.spawnBloodEffect(event.target.position);
});

// spatial-audio.service.ts - Impact Sound
eventBus.on('projectile:hit', (event) => {
  this.playAtGeo('impact', event.target.position);
});

// tower-combat.service.ts - AOE Damage (falls explosive)
eventBus.on('projectile:hit', (event) => {
  if (event.projectile.isExplosive) {
    // Get enemies in AOE radius via Spatial Grid (NICHT via Event!)
    const enemiesInRadius = this.grid.getEnemiesInRadius(
      event.target.position.x,
      event.target.position.z,
      event.projectile.aoeRadius,
      event.target.id // exclude primary target
    );

    for (const enemy of enemiesInRadius) {
      enemy.takeDamage(event.damage * 0.5); // 50% AOE damage
    }

    // Deferred explosion VFX
    this.eventBus.emitDeferred({
      type: 'vfx:explosion',
      position: event.target.position,
      radius: event.projectile.aoeRadius
    });
  }
});

// status-effect.system.ts - Status Effects (Slow, Burn, etc.)
eventBus.on('projectile:hit', (event) => {
  const statusEffect = event.projectile.statusEffect;

  if (statusEffect === 'slow') {
    event.target.applySlow(0.5, 3000); // 50% slow for 3 seconds
  } else if (statusEffect === 'burn') {
    event.target.applyBurn(5, 5000); // 5 damage/sec for 5 seconds
  }
});
```

**Warum ist das besser?**
- ✅ **Separation of Concerns:** Damage Logic ≠ VFX Logic ≠ Audio Logic
- ✅ **Testbar:** Jedes System kann isoliert getestet werden
- ✅ **Erweiterbar:** Neuer Tower mit Ice Effect? Einfach neuer Subscriber!
- ✅ **Performance:** Conditional Logic nur in relevanten Systemen
- ✅ **Maintainable:** Bug in Blood Effect? Nur CombatEffectService anfassen

---

### 3.2 `projectile:missed` (Optional)

**Producer:** `ProjectileManager.update()`

**Wann:** Projektil hat Target verloren (Enemy tot) und Boden getroffen

**Consumers:**
- `VFXService` → Ground Impact Effect
- `SpatialAudioService` → Ground Impact Sound

**Effect:**
- Ground Impact Particles
- Dull Impact Sound

**Mit Events:**
```typescript
// projectile.manager.ts
if (hit && projectile.targetLost) {
  // Target died before hit - ground impact
  this.eventBus.emitDeferred({
    type: 'projectile:missed',
    projectile
  });
}

// vfx.service.ts
eventBus.on('projectile:missed', (event) => {
  this.spawnGroundImpact(event.projectile.position);
});

// spatial-audio.service.ts
eventBus.on('projectile:missed', (event) => {
  this.playAtGeo('ground_impact', event.projectile.position, 0.3);
});
```

---

## 4. Wave Events

### 4.1 `wave:started`

**Producer:** `WaveManager.startWave()`

**Consumers:**
- `UIService` → Wave Banner anzeigen
- `SpatialAudioService` → Wave Start Sound
- `EnemyManager` → Spawning starten

**Effect:**
- "Wave 5 - 20 Enemies" Banner
- Epic Sound Effect
- Enemies beginnen zu spawnen

**Mit Events:**
```typescript
// wave.manager.ts
startWave() {
  this.waveNumber++;
  this.phase.set('active');

  this.eventBus.emit({
    type: 'wave:started',
    wave: this.waveNumber,
    enemyCount: this.currentWave.totalEnemies
  });

  this.startSpawning();
}

// ui.service.ts
eventBus.on('wave:started', (event) => {
  this.showWaveBanner(`Wave ${event.wave}`, `${event.enemyCount} Enemies`);
});

// spatial-audio.service.ts
eventBus.on('wave:started', (event) => {
  this.play('wave_start');
});

// enemy.manager.ts
eventBus.on('wave:started', (event) => {
  this.prepareSpawning(event.enemyCount);
});
```

---

### 4.2 `wave:completed`

**Producer:** `WaveManager` (wenn alle Enemies tot)

**Consumers:**
- `GameEngine` → Credits Bonus geben
- `UIService` → Wave Complete Banner
- `SpatialAudioService` → Victory Sound
- `WaveManager` → Nächste Wave vorbereiten

**Effect:**
- Bonus Credits
- "Wave Complete! +500 Credits" Banner
- Victory Jingle
- Build Phase startet

**Mit Events:**
```typescript
// wave.manager.ts
eventBus.on('enemy:died', (event) => {
  this.enemiesKilled++;

  if (this.enemiesKilled >= this.currentWave.totalEnemies) {
    const bonus = this.calculateWaveBonus();

    this.eventBus.emit({
      type: 'wave:completed',
      wave: this.waveNumber,
      credits: bonus
    });

    this.phase.set('build');
  }
});

// game-engine.ts
eventBus.on('wave:completed', (event) => {
  this.credits += event.credits;

  this.eventBus.emit({
    type: 'credits:changed',
    credits: this.credits,
    delta: event.credits
  });
});

// ui.service.ts
eventBus.on('wave:completed', (event) => {
  this.showWaveBanner(
    `Wave ${event.wave} Complete!`,
    `+${event.credits} Credits`
  );
});

// spatial-audio.service.ts
eventBus.on('wave:completed', (event) => {
  this.play('wave_complete');
});
```

---

## 5. Game State Events

### 5.1 `game:started`

**Producer:** `GameEngine.start()`

**Consumers:**
- `UIService` → Game UI einblenden
- `CameraService` → Start Position
- `WaveManager` → Erste Wave vorbereiten

**Mit Events:**
```typescript
// game-engine.ts
start() {
  this.running = true;

  this.eventBus.emit({
    type: 'game:started'
  });

  this.gameLoop();
}

// ui.service.ts
eventBus.on('game:started', () => {
  this.showGameUI();
  this.hideMainMenu();
});

// camera.service.ts
eventBus.on('game:started', () => {
  this.flyToStartPosition();
});

// wave.manager.ts
eventBus.on('game:started', () => {
  this.prepareFirstWave();
});
```

---

### 5.2 `game:paused`

**Producer:** User Input (Pause Button)

**Consumers:**
- `GameEngine` → Game Loop pausieren
- `UIService` → Pause Menu zeigen
- `SpatialAudioService` → Alle Sounds pausieren

**Mit Events:**
```typescript
// game-ui.component.ts
onPauseButtonClick() {
  this.eventBus.emit({
    type: 'game:paused'
  });
}

// game-engine.ts
eventBus.on('game:paused', () => {
  this.paused = true;
});

// ui.service.ts
eventBus.on('game:paused', () => {
  this.showPauseMenu();
});

// spatial-audio.service.ts
eventBus.on('game:paused', () => {
  this.pauseAll();
});
```

---

### 5.3 `game:over`

**Producer:** `GameEngine` (Base Health <= 0)

**Consumers:**
- `UIService` → Game Over Screen
- `SpatialAudioService` → Game Over Sound
- `WaveManager` → Spawning stoppen
- `EnemyManager` → Alle Enemies stoppen
- `TowerManager` → Towers deaktivieren

**Effect:**
- Game Loop stoppt
- Game Over Screen wird angezeigt
- Dramatic Sound
- Alle Entities frieren ein

**Mit Events:**
```typescript
// game-engine.ts
eventBus.on('enemy:reached-base', (event) => {
  this.baseHealth -= event.damage;

  if (this.baseHealth <= 0) {
    this.eventBus.emit({
      type: 'game:over',
      reason: 'base-destroyed'
    });
  }
});

// game-engine.ts
eventBus.on('game:over', (event) => {
  this.running = false;
  console.log(`Game Over: ${event.reason}`);
});

// ui.service.ts
eventBus.on('game:over', (event) => {
  this.showGameOverScreen(event.reason);
});

// spatial-audio.service.ts
eventBus.on('game:over', (event) => {
  this.stopAll();
  this.play('game_over');
});

// wave.manager.ts
eventBus.on('game:over', () => {
  this.stopSpawning();
});

// enemy.manager.ts
eventBus.on('game:over', () => {
  for (const enemy of this.enemies) {
    enemy.freeze();
  }
});
```

---

### 5.4 `credits:changed`

**Producer:** `GameEngine` (bei jeder Credits-Änderung)

**Consumers:**
- `UIService` → Credits Anzeige updaten
- `TowerPlacementService` → Affordable Towers neu berechnen

**Effect:**
- UI zeigt neue Credits
- Placement Hints werden aktualisiert

**Mit Events:**
```typescript
// game-engine.ts
eventBus.on('enemy:died', (event) => {
  this.credits += event.credits;

  // Emit secondary event
  this.eventBus.emit({
    type: 'credits:changed',
    credits: this.credits,
    delta: event.credits
  });
});

// ui.service.ts
eventBus.on('credits:changed', (event) => {
  this.updateCreditsDisplay(event.credits);

  if (event.delta > 0) {
    this.showFloatingText(`+${event.delta}`, 'green');
  }
});

// tower-placement.service.ts
eventBus.on('credits:changed', (event) => {
  this.affordableTowers = this.calculateAffordableTowers(event.credits);
});
```

---

### 5.5 `health:changed`

**Producer:** `GameEngine` (bei Base Damage)

**Consumers:**
- `UIService` → Health Bar updaten
- `HQDamageService` → Fire Intensity erhöhen
- `CameraService` → Shake Effect

**Mit Events:**
```typescript
// game-engine.ts
eventBus.on('enemy:reached-base', (event) => {
  this.baseHealth -= event.damage;

  this.eventBus.emit({
    type: 'health:changed',
    health: this.baseHealth,
    delta: -event.damage
  });
});

// ui.service.ts
eventBus.on('health:changed', (event) => {
  this.updateHealthBar(event.health);

  if (event.delta < 0) {
    this.flashHealthBar('red');
  }
});

// hq-damage.service.ts
eventBus.on('health:changed', (event) => {
  // Fire intensity based on health percentage
  const healthPercent = event.health / 100;
  const fireIntensity = 1 - healthPercent;
  this.setFireIntensity(fireIntensity);
});
```

---

## 6. Effect Events (Deferred)

### 6.1 `audio:play`

**Producer:** Verschiedene Systeme (Tower, Enemy, Combat, etc.)

**Consumers:**
- `SpatialAudioService` → Sound abspielen

**Effect:**
- 3D Sound wird an Position abgespielt

**Mit Events:**
```typescript
// tower.entity.ts
shoot(target: Enemy) {
  // ... shooting logic ...

  // Deferred audio event (kann 1 Frame warten)
  this.eventBus.emitDeferred({
    type: 'audio:play',
    sound: 'tower_shoot',
    position: this.position,
    volume: 0.5
  });
}

// spatial-audio.service.ts
eventBus.on('audio:play', (event) => {
  if (event.position) {
    this.playAtPosition(event.sound, event.position, event.volume);
  } else {
    this.play(event.sound, event.volume);
  }
});
```

---

### 6.2 `vfx:blood`

**Producer:** `CombatEffectService`

**Consumers:**
- `ParticleSystem` → Blood Particles spawnen

**Effect:**
- Blood Splatter an Enemy Position

**Mit Events:**
```typescript
// combat-effect.service.ts
eventBus.on('enemy:died', (event) => {
  // Deferred VFX event
  this.eventBus.emitDeferred({
    type: 'vfx:blood',
    position: event.position,
    intensity: 1.0
  });
});

// particle-system.ts
eventBus.on('vfx:blood', (event) => {
  this.spawnBloodEffect(event.position, event.intensity);
});
```

---

### 6.3 `vfx:explosion`

**Producer:** `ProjectileManager` oder `CombatSystem`

**Consumers:**
- `ParticleSystem` → Explosion Particles
- `SpatialAudioService` → Explosion Sound

**Effect:**
- Fire/Smoke Particles
- Explosion Sound
- Camera Shake

**Mit Events:**
```typescript
// combat.system.ts
eventBus.on('projectile:hit', (event) => {
  if (event.projectile.isExplosive) {
    // ... AOE damage logic ...

    // Deferred explosion VFX
    this.eventBus.emitDeferred({
      type: 'vfx:explosion',
      position: event.target.position,
      radius: event.projectile.aoeRadius
    });
  }
});

// particle-system.ts
eventBus.on('vfx:explosion', (event) => {
  this.spawnExplosion(event.position, event.radius);
});

// spatial-audio.service.ts
eventBus.on('vfx:explosion', (event) => {
  this.playAtPosition('explosion', event.position);
});

// camera.service.ts
eventBus.on('vfx:explosion', (event) => {
  const intensity = event.radius / 10; // Scale shake by radius
  this.shake(intensity, 300);
});
```

---

### 6.4 `ui:notification`

**Producer:** Verschiedene Systeme

**Consumers:**
- `UIService` → Notification Popup

**Effect:**
- Toast/Snackbar Nachricht

**Mit Events:**
```typescript
// tower-placement.service.ts
placeTower(position: Vector3, type: TowerTypeId) {
  if (this.credits < TOWER_TYPES[type].cost) {
    // Deferred notification
    this.eventBus.emitDeferred({
      type: 'ui:notification',
      message: 'Not enough credits!',
      type: 'warning'
    });
    return;
  }

  // ... place tower ...
}

// ui.service.ts
eventBus.on('ui:notification', (event) => {
  this.showNotification(event.message, event.type);
});
```

---

## 7. Special Event: `damage:dealt`

**Producer:** `CombatSystem`

**Consumers:**
- `AchievementSystem` → Damage Stats tracken
- `UIService` → Floating Damage Numbers
- `TowerManager` → Tower Stats updaten

**Effect:**
- Achievement Progress
- "-50 HP" floating text
- Tower DPS Stats

**Mit Events:**
```typescript
// combat.system.ts
applyDamage(target: Enemy, damage: number, source: Tower) {
  target.takeDamage(damage);

  // Emit damage event für Stats
  this.eventBus.emit({
    type: 'damage:dealt',
    source,
    target,
    amount: damage
  });
}

// achievement.system.ts
eventBus.on('damage:dealt', (event) => {
  this.totalDamageDealt += event.amount;

  if (this.totalDamageDealt >= 10000) {
    this.unlockAchievement('damage_dealer');
  }
});

// ui.service.ts
eventBus.on('damage:dealt', (event) => {
  this.showFloatingText(`-${event.amount}`, event.target.position);
});

// tower-manager.ts
eventBus.on('damage:dealt', (event) => {
  event.source.stats.totalDamage += event.amount;
  event.source.stats.updateDPS();
});
```

---

## 8. Event Chain Examples

### Example 1: Projectile Hit → Enemy Death → Wave Complete

```
1. ProjectileManager detects hit
   ↓
2. Emit 'projectile:hit'
   ↓
3. CombatSystem applies damage
   ↓
4. Enemy health <= 0 → Enemy.die()
   ↓
5. Emit 'enemy:died'
   ↓
6. Multiple Consumers:
   - GameEngine: +credits
   - CombatEffect: Blood VFX
   - SpatialAudio: Death sound
   - TowerManager: Clear target
   - WaveManager: enemiesKilled++
   ↓
7. WaveManager: All enemies dead?
   ↓
8. Emit 'wave:completed'
   ↓
9. Multiple Consumers:
   - GameEngine: +bonus credits
   - UI: Wave complete banner
   - SpatialAudio: Victory sound
   - WaveManager: Start build phase
```

### Example 2: Enemy Reaches Base → Game Over

```
1. EnemyManager detects enemy.hasReachedEnd()
   ↓
2. Emit 'enemy:reached-base'
   ↓
3. Multiple Consumers:
   - GameEngine: baseHealth -= 10
   - HQDamage: Fire intensity++
   - SpatialAudio: Alarm sound
   - Camera: Shake effect
   ↓
4. GameEngine: baseHealth <= 0?
   ↓
5. Emit 'game:over'
   ↓
6. Multiple Consumers:
   - GameEngine: running = false
   - UI: Game over screen
   - SpatialAudio: Game over music
   - WaveManager: Stop spawning
   - EnemyManager: Freeze all enemies
   - TowerManager: Disable towers
```

### Example 3: Tower Placement → LOS Calculation

```
1. User clicks placement position
   ↓
2. TowerManager.placeTower()
   ↓
3. Emit 'tower:placed'
   ↓
4. Multiple Consumers:
   - GameEngine: credits -= cost
   - GlobalRouteGrid: Register tower (LOS berechnen)
   - SpatialAudio: Build sound
   - UI: Close tutorial hint
   ↓
5. Tower Constructor:
   - Registers with Grid
   - Gets visibleCells array
   - Ready to target enemies
```

---

## 9. Performance Considerations

### Immediate vs Deferred Events

**Immediate Events (emit):**
- Game-kritisch (Credits, Health, Damage)
- State muss sofort konsistent sein
- Werden direkt verarbeitet (blocking)

```typescript
// Immediate: Game State
this.eventBus.emit({
  type: 'enemy:died',
  enemy, credits, position
});
```

**Deferred Events (emitDeferred):**
- Nicht game-kritisch (Audio, VFX, UI)
- Können 1 Frame warten (16ms @ 60 FPS)
- Werden in processQueue() verarbeitet

```typescript
// Deferred: Audio/VFX
this.eventBus.emitDeferred({
  type: 'audio:play',
  sound: 'explosion'
});
```

### Event Budget pro Frame

```
Szenario: 10 Tower, 50 Enemies, 60 FPS

Immediate Events (kritisch):
- projectile:hit × 10/frame      = 10 events
- enemy:died × 2/frame           = 2 events
- damage:dealt × 10/frame        = 10 events
Total Immediate: ~22 events/frame

Deferred Events (queued):
- audio:play × 15/frame          = 15 events
- vfx:* × 8/frame                = 8 events
- ui:notification × 1/frame      = 1 event
Total Deferred: ~24 events/frame

Total: ~46 events/frame @ 60 FPS = 2760 events/sec
Performance: 46 × 100ns = 4.6μs/frame (0.03% of 16ms budget)
```

---

## 10. Anti-Patterns zu vermeiden

### ❌ Nicht: Events für Spatial Queries

```typescript
// FALSCH - Performance Killer!
eventBus.on('enemy:spawned', (event) => {
  // 10 Tower × 50 Enemies = 500 Checks!
  if (this.isInRange(event.enemy)) {
    this.targetEnemy = event.enemy;
  }
});
```

### ✅ Richtig: Spatial Grid Query

```typescript
// RICHTIG - O(visible_cells)
update() {
  const enemies = this.grid.getEnemiesForTower(this.visibleCells);
  if (enemies.length > 0) {
    this.targetEnemy = this.selectBestTarget(enemies);
  }
}
```

### ❌ Nicht: Events in Hot Loops

```typescript
// FALSCH - 3000 events/sec!
for (const enemy of enemies) {
  eventBus.emit({ type: 'enemy:updated', enemy });
}
```

### ✅ Richtig: Batch Event (falls nötig)

```typescript
// RICHTIG - 1 event/frame
eventBus.emitDeferred({
  type: 'enemies:batch-updated',
  count: enemies.length
});
```

---

## 11. Testing Examples

### Unit Test: Projectile Hit Event

```typescript
describe('ProjectileManager', () => {
  it('should emit projectile:hit event on collision', () => {
    const eventBus = new GameEventBus();
    const manager = new ProjectileManager(eventBus, entityPool);

    const spy = jest.fn();
    eventBus.on('projectile:hit', spy);

    // Spawn projectile close to target
    const tower = createMockTower();
    const enemy = createMockEnemy();
    const projectile = manager.spawn(tower, enemy);

    // Update until hit
    for (let i = 0; i < 100; i++) {
      manager.update(0.016);
      if (spy.mock.calls.length > 0) break;
    }

    expect(spy).toHaveBeenCalledWith({
      type: 'projectile:hit',
      projectile,
      target: enemy,
      damage: projectile.damage
    });
  });
});
```

### Integration Test: Event Chain

```typescript
describe('Event Chain: Projectile → Death → Wave Complete', () => {
  it('should complete wave after last enemy dies', () => {
    const eventBus = new GameEventBus();
    const engine = new GameEngine(config, eventBus);

    const waveCompleteSpy = jest.fn();
    eventBus.on('wave:completed', waveCompleteSpy);

    // Start wave with 1 enemy
    engine.waveManager.startWave({ totalEnemies: 1 });

    // Spawn and kill enemy
    const enemy = engine.enemyManager.spawn();
    enemy.die();

    expect(waveCompleteSpy).toHaveBeenCalledWith({
      type: 'wave:completed',
      wave: 1,
      credits: expect.any(Number)
    });
  });
});
```

---

## Zusammenfassung

### Event Categories

1. **Lifecycle Events:** enemy:died, tower:placed, game:over
2. **Combat Events:** projectile:hit, damage:dealt
3. **Progress Events:** wave:started, wave:completed
4. **State Events:** credits:changed, health:changed
5. **Effect Events (Deferred):** audio:play, vfx:*, ui:notification

### Key Principles

- **Events = Broadcast** (1:N, temporal, "was ist passiert?")
- **Spatial Grid = Queries** (Pull, spatial, "wo ist was?")
- **Immediate = Kritisch** (Game State, Damage)
- **Deferred = Unkritisch** (Audio, VFX, UI)

### Benefits

- ✅ **Decoupling:** Systeme kennen sich nicht mehr
- ✅ **Testability:** Jedes System isoliert testbar
- ✅ **Extensibility:** Neue Features = neue Subscribers
- ✅ **Maintainability:** Bug Fixes isoliert
- ✅ **Performance:** < 5μs/frame overhead

---

**Nächster Schritt:** Implementation starten! 🚀
