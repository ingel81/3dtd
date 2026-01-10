# Frame-Timing Fixes

## Problem

Mehrere Animationen im Spiel sind frameabhängig statt zeitabhängig. Das führt zu:
- Schnellere Animationen bei höherer FPS (144Hz Monitor)
- Langsamere Animationen bei niedrigerer FPS (30 FPS auf schwacher Hardware)
- Inkonsistentes Spielverhalten

## Gefundene Probleme

### KRITISCH

| # | Datei | Zeile | Problem | Status |
|---|-------|-------|---------|--------|
| 1 | `three-tiles-engine.ts` | 982 | Hardcoded `this.update(16)` statt echtes deltaTime | ⬜ Offen |
| 2 | `transform.component.ts` | 80 | `this.rotation += diff * rotationSmoothingFactor` ohne deltaTime | ⬜ Offen |
| 3 | `three-tower.renderer.ts` | 495 | Pulse nutzt `performance.now()` statt übergebenes deltaTime | ⬜ Offen |
| 4 | `tower-defense.component.ts` | 1474-1475 | Game Loop übergibt Timestamp statt deltaTime | ⬜ Offen |
| 5 | `tower-defense.component.ts` | 1268 | Compass-Rotation ohne Zeitfaktor | ⬜ Offen |

### MITTEL

| # | Datei | Zeile | Problem | Status |
|---|-------|-------|---------|--------|
| 6 | `three-effects.renderer.ts` | 761 | Magische Konstante `floatSpeed * 3` | ⬜ Offen |

## Lösungsansätze

### 1. three-tiles-engine.ts - Render Loop

**Vorher:**
```typescript
const animate = () => {
  if (!this.isRunning) return;
  this.update(16); // ~60fps - FALSCH!
  this.render();
  this.animationFrameId = requestAnimationFrame(animate);
};
```

**Nachher:**
```typescript
let lastTime = performance.now();
const animate = (currentTime: number) => {
  if (!this.isRunning) return;
  const deltaTime = currentTime - lastTime;
  lastTime = currentTime;
  this.update(deltaTime);
  this.render();
  this.animationFrameId = requestAnimationFrame(animate);
};
```

### 2. transform.component.ts - Rotation Smoothing

**Vorher:**
```typescript
this.rotation += diff * this.rotationSmoothingFactor;
```

**Nachher:**
```typescript
// rotationSmoothingFactor muss pro Sekunde definiert sein
const smoothingPerSecond = this.rotationSmoothingFactor * 60; // Annahme: ursprünglich für 60fps designed
this.rotation += diff * smoothingPerSecond * (deltaTime / 1000);
```

Alternative mit frame-unabhängigem Smoothing:
```typescript
const t = 1 - Math.pow(1 - this.rotationSmoothingFactor, deltaTime / 16.67);
this.rotation += diff * t;
```

### 3. three-tower.renderer.ts - Selection Ring Animation

**Vorher:**
```typescript
const time = performance.now() * 0.003;
const scale = 1 + Math.sin(time) * 0.1;
```

**Nachher:**
```typescript
// Nutze das übergebene deltaTime für konsistente Animation
// Zeit-Akkumulator als Klassenvariable
this.animationTime += deltaTime * 0.003;
const scale = 1 + Math.sin(this.animationTime) * 0.1;
```

### 4. tower-defense.component.ts - Game Loop

Die `gameState.update()` Methode sollte deltaTime erhalten, nicht den aktuellen Timestamp.

### 5. tower-defense.component.ts - Compass Rotation

Compass-Rotation muss mit deltaTime multipliziert werden für konsistente Drehgeschwindigkeit.

## Testplan

Nach den Fixes:
1. Spiel bei 60 FPS testen (normal)
2. FPS auf 30 limitieren und Animationsgeschwindigkeit vergleichen
3. FPS auf 144 erhöhen und Animationsgeschwindigkeit vergleichen
4. Alle Animationen sollten bei allen FPS-Raten gleich schnell sein

## Referenz

Korrekte zeitbasierte Animation:
```typescript
// Position über Zeit
position += velocity * (deltaTime / 1000); // deltaTime in ms, velocity in units/s

// Rotation über Zeit
rotation += rotationSpeed * (deltaTime / 1000); // rotationSpeed in rad/s

// Exponentielles Smoothing (frame-unabhängig)
const t = 1 - Math.pow(1 - smoothingFactor, deltaTime / 16.67);
value = lerp(value, target, t);
```
