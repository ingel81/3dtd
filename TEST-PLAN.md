# Test Setup Plan — 3DTD

## Übersicht

Vitest als Test-Runner, 3 parallele Agents für schnelle Umsetzung.

---

## Agent 1: Vitest Infrastruktur + GameEventBus Tests

**Scope:** Setup + wichtigste Datei testen (572 LOC, Kern der Engine)

### Setup
- `vitest.config.ts` erstellen (jsdom environment, paths, globals)
- `angular.json` → `test` Architect-Target hinzufügen
- `package.json` → Scripts: `test`, `test:watch`, `test:coverage`
- Mocks für Three.js Objekte (Vector3 etc.) — minimal, nur was gebraucht wird

### Tests: `src/app/game-engine/game-event-bus.spec.ts`
- **on/off:** Subscribe + Unsubscribe, Handler wird aufgerufen/nicht mehr aufgerufen
- **emit:** Immediate dispatch, mehrere Listener, korrekte Event-Payload
- **emitDeferred + processQueue:** Events werden gequeued, erst bei processQueue dispatched
- **subscribe/unsubscribeAll (Owner):** WeakMap-based cleanup funktioniert
- **SubscriptionBag:** add, disposeAll, size
- **EventSubscription:** dispose entfernt Handler
- **onAny:** Debug-Listener bekommt alle Events
- **clear:** Alle Listener + Queue werden gelöscht
- **Metrics:** enableMetrics, getMetrics, resetMetrics zählen korrekt
- **getListenerCount / hasListeners:** Korrekte Counts
- **Edge Cases:** Doppel-Subscribe, Emit ohne Listener, leere Queue

---

## Agent 2: Entity Tests (GameObject, Component, Tower, Enemy, Projectile)

**Scope:** Core ECS-System testen (~1060 LOC)

### Tests: `src/app/core/game-object.spec.ts`
- **ID-Generation:** Unique IDs, Format `type-NNN`
- **Component-System:** addComponent, getComponent, hasComponent, removeComponent
- **Lifecycle:** active state, destroy() ruft onDestroy auf Components
- **Edge Cases:** Doppelter Component-Typ, getComponent für nicht-existierenden Typ

### Tests: `src/app/core/component.spec.ts`
- **Base Component:** onUpdate, onDestroy lifecycle

### Tests: `src/app/game-components/health.component.spec.ts`
- **HP Management:** takeDamage, heal, isDead, percentage
- **Edge Cases:** Overkill (damage > hp), Heal über max

### Tests: `src/app/game-components/transform.component.spec.ts`
- **Position:** setPosition, getPosition, lat/lon/height

### Tests: `src/app/game-components/movement.component.spec.ts`
- **Path-Following:** setPath, update bewegt entlang Pfad
- **Speed:** speedMps korrekt, hasReachedEnd

### Tests: `src/app/entities/tower.entity.spec.ts`
- **Creation:** Korrekte Components (Transform, Combat, Render)
- **Config:** typeConfig wird korrekt geladen
- **Combat:** range, damage, fireRate aus Config

### Tests: `src/app/entities/enemy.entity.spec.ts`
- **Creation:** Korrekte Components (Transform, Health, Render, Movement, Audio)
- **Config:** typeConfig, HP, Speed aus Config oder Override
- **Status Effects:** applySlow, applyBurn, clearEffects

---

## Agent 3: EntityManager + Configs Tests

**Scope:** Manager-Basis + Config-Validierung (~370 LOC)

### Tests: `src/app/managers/entity-manager.spec.ts`
- **CRUD:** add, remove, getById, getAll, getAllActive
- **Active-Set:** Remove entfernt aus activeEntities
- **clear():** Alles weg, destroy auf allen Entities aufgerufen
- **update():** Ruft update(dt) auf allen aktiven Entities

### Tests: `src/app/configs/tower-types.config.spec.ts`
- **Alle 7 Tower-Typen validieren:** Pflichtfelder vorhanden
- **getTowerType():** Gibt korrekten Typ zurück
- **getAllTowerTypes():** 7 Tower
- **getUpgradeCost():** Berechnung korrekt (base * scaling^level)
- **Kosten-Konsistenz:** sellValue < cost, alle Preise > 0
- **Beam Tower:** fire hat attackType 'beam', damagePerSecond > 0

### Tests: `src/app/models/enemy-types.spec.ts` (falls Config-Datei existiert)
- **Alle Enemy-Typen validieren:** HP, Speed, Model-URL vorhanden
- **getEnemyType():** Gibt korrekten Typ

---

## Shared Mocks: `src/test/mocks/`
- `three.mock.ts` — Minimale Three.js Mocks (Vector3, Object3D)
- `tiles-engine.mock.ts` — ThreeTilesEngine Stub
