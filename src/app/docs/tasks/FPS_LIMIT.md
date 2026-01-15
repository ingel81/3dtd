# Task: Konfigurierbares FPS-Limit

## Motivation

Bei guter Hardware (90-144 FPS) wird unnötig viel GPU-Last erzeugt. Ein FPS-Limit kann:
- GPU-Wärme und Stromverbrauch reduzieren
- Mehr CPU-Budget für 3D-Tiles-Streaming freigeben
- Konsistentere Frame-Times liefern

**Hinweis:** Die Spiellogik ist bereits frame-unabhängig (via `deltaTime`). Ein FPS-Limit ändert nicht die Gameplay-Geschwindigkeit.

## Analyse

### Relevante Code-Stellen

| Datei | Zeilen | Beschreibung |
|-------|--------|--------------|
| `three-tiles-engine.ts` | 1008-1026 | `startRenderLoop()` - Haupt-Render-Loop |
| `three-tiles-engine.ts` | 1193-1208 | `updateFPS()` - FPS-Berechnung |
| `movement.component.ts` | 181 | DeltaTime-Capping bereits vorhanden |
| `tower-defense.component.ts` | 768-771 | UI-Update bereits auf 100ms gedrosselt |

### Aktueller Zustand

```typescript
// three-tiles-engine.ts:1012-1022
let lastTime = performance.now();
const animate = (currentTime: number) => {
  const deltaTime = currentTime - lastTime;
  lastTime = currentTime;
  this.update(deltaTime);
  this.render();
  this.animationFrameId = requestAnimationFrame(animate);
};
```

## Implementierungsplan

### 1. FPS-Limit Optionen definieren

In `three-tiles-engine.ts`:

```typescript
type FPSLimit = 'unlimited' | 60 | 30;

private fpsLimit: FPSLimit = 'unlimited';
private frameInterval = 0; // 0 = unlimited

setFPSLimit(limit: FPSLimit): void {
  this.fpsLimit = limit;
  this.frameInterval = limit === 'unlimited' ? 0 : 1000 / limit;
}
```

### 2. Render-Loop anpassen

```typescript
startRenderLoop(): void {
  if (this.isRunning) return;
  this.isRunning = true;

  let lastTime = performance.now();
  let lastRenderTime = 0;

  const animate = (currentTime: number) => {
    if (!this.isRunning) return;

    // FPS-Limiting
    if (this.frameInterval > 0) {
      const elapsed = currentTime - lastRenderTime;
      if (elapsed < this.frameInterval) {
        this.animationFrameId = requestAnimationFrame(animate);
        return;
      }
      lastRenderTime = currentTime - (elapsed % this.frameInterval);
    }

    const deltaTime = currentTime - lastTime;
    lastTime = currentTime;

    this.update(deltaTime);
    this.render();

    this.animationFrameId = requestAnimationFrame(animate);
  };

  this.animationFrameId = requestAnimationFrame(animate);
}
```

### 3. UI-Setting hinzufügen (optional)

In Settings-Panel eine Option:

```
FPS-Limit: [Unbegrenzt] [60] [30]
```

Speicherung via `localStorage` oder `GameUIStateService`.

## Aufwand

- Core-Implementierung: ~20 Zeilen Code
- UI-Setting (optional): ~50 Zeilen

## Offene Fragen

- [ ] Soll das Setting persistent gespeichert werden?
- [ ] Soll es ein Debug-Overlay geben das das aktuelle Limit anzeigt?
- [ ] Default: `unlimited` oder `60`?
