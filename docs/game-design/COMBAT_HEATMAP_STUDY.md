# Untersuchung: Kampfzonen einfärben

**Status:** Machbarkeitsstudie, kein Code.
**Stand:** 2026-09-11, Code-Stand `3338f4b`.
**Bezug:** TODO.md 3.1 „Untersuchen: Kampfzonen einfärben“.

---

## 0. Ergebnis

- **Machbar mit geringem Risiko.** Alle Bausteine existieren: Kill-Ereignisse
  mit Zellbezug, ein Zellraster entlang der Routen, instanzierte Decals mit
  Free-List, ein Aggregat-Mesh mit Zustand pro Zelle als Vorlage.
- **Empfohlen sind zwei Schichten:**
  1. **Kampfspuren** (immer an, Teil der Welt): dunkle Brand- und
     Einschlagsflecken an Explosionen und an Todesorten nicht blutender
     Gegner, über einen weiteren `DecalInstanceManager`-Pool. Aufwand S.
  2. **Kampfzonen-Heatmap** (auf Abruf, Information): pro Route-Grid-Zelle
     akkumulierte Kills als eigene Instanz-Schicht mit Farbrampe. Sichtbar in
     der Bauphase als Bild der letzten Welle, während der Welle per Taste,
     nie gleichzeitig mit den LOS-Zellen im Build-Mode. Aufwand M.
- **Datenquelle:** `enemy:died` liefert den Gegner samt Zellschlüssel. Für
  Schaden als zweite Quelle ein Zähler im `DamageApplicationService`, kein
  Event pro Treffer.
- **Budget bei 20.000 Gegnern:** unter 0,1 ms CPU pro Frame, ein Draw Call pro
  Schicht, höchstens 400 KB Puffer für die Heatmap.

---

## 1. Was im Code existiert

### 1.1 Ereignisse

| Event | Quelle | Ortsbezug | Häufigkeit | Eignung |
|---|---|---|---|---|
| `enemy:died` | sofort, `enemy.manager.ts:322` | `enemy.position`, `enemy.routeCellKey` | 1 pro Kill | Hauptquelle |
| `enemy:reached-base` | sofort, `enemy.manager.ts:415-419` | immer am HQ | 1 pro Leck | nur als Zähler, der Ort sagt nichts |
| `projectile:hit` | sofort, `projectile.manager.ts:155-161` | Ziel, `damage` | pro Projektiltreffer | unvollständig: Splash-Nebenziele, Beam, Nahkampf und Kette fehlen |
| `dot:damage` | `game-event-bus.ts:108-115` | Gegner | Gift-Ticks | nur Poison |
| `vfx:explosion` | deferred, `combat-vfx.service.ts:78-82` | lokale Position, Radius fest 30 | pro Splash-Einschlag von Cannon und Poison | Quelle für Kampfspuren |
| `vfx:chain-lightning` | deferred, `combat-effect.service.ts:354-359` | Trefferpunkte der Kette | pro Blitz | optional |

Beam (Fire) und Nahkampf (Tentacle) rufen den Schaden direkt auf, ohne Event
(`combat-effect.service.ts:304-330`, weiter nach
`damage-application.service.ts:84-109`). Der Flammenkegel trifft jeden
Gegner darin in jedem Sub-Step, also 60-mal pro Sekunde. Ein Event pro
Treffer wäre bei großen Wellen die teuerste Zeile des Features. Die einzige
Stelle, an der jeder Schaden vorbeikommt, ist `applyDamage` /
`applyBeamDamage` im `DamageApplicationService`
(`damage-application.service.ts:42-109`). Dort gehört ein optionaler Zähler
hin.

### 1.2 Route-Grid

- Zellen 2 m × 2 m (`global-route-grid.ts:374`) in einem 7-m-Korridor um die
  Routen (`:377`), gehalten in `Map<number, RouteCell>` (`:333`). Eine Zelle
  kennt Mittelpunkt, Bodenhöhe, die Gegner darin und die Sichtbarkeit pro
  Tower (`:56-88`).
- Gegner kennen ihre Zelle über `enemy.routeCellKey` (`enemy.entity.ts:56`),
  gepflegt in `updateEnemyPosition` (`global-route-grid.ts:1342`). Ein Kill
  lässt sich also ohne Koordinatenrechnung einer Zelle zuordnen.
- Größenordnung: 3 km Route ergeben 5.000 bis 6.000 Korridorzellen,
  realistisch 20.000 bis 50.000 (MULTIPLAYER_CONCEPT.md §2.2). Das
  Viz-Hardlimit liegt bei 50.000 (`global-route-grid.ts:464`).
- **Vorbehalt:** Zellschlüssel entstehen beim Anlegen mit `Math.floor`
  (`global-route-grid.ts:779-781`), beim Einsortieren der Gegner mit `| 0`
  (`:1343-1344`). Bei negativen lokalen Koordinaten landet ein Gegner in der
  Nachbarzelle (TODO.md 1.1). Die Heatmap erbt diesen Versatz von bis zu
  2 m. Nicht blockierend, der Fix sollte aber vorher kommen.
- **Aggregat-Viz als Vorlage:** ein `InstancedMesh` pro Layer, ein
  Float-Attribut pro Instanz, `depthTest: false`, `renderOrder 3`
  (`global-route-grid.ts:1816-1864`). Der Instanzindex kommt aus
  `cellIndexMap`, die bei jeder Höhen-Promotion neu aufgebaut wird und nur
  gesampelte Zellen enthält (`:1951-1982`). **Diese Indizes sind nicht
  stabil**, eine Heatmap darf sie nicht als Speicheradresse benutzen.
  `updateVisualization` läuft pro Frame über alle Zellen (`:1988-2029`),
  auch das ist für die Heatmap nicht nötig (siehe 2.3).

### 1.3 LOS-Zellen im Build-Mode

Die Per-Tower-Sichtbarkeit rendert `tower-los-layer-builder.ts`: Boden-Layer
ohne Tiefentest (`:275-276`), Luft-Layer mit Tiefentest und Polygon-Offset
(`:285-293`), `renderOrder` 3 und 4 (`:316`, `:321`). Die Palette belegt Gold
(beides), Grün (Boden), Blau (Luft) und Rot (in Reichweite, aber verdeckt)
(`los-viz.config.ts:69-74`), das globale Grid zusätzlich Grau und Lila
(`:86-93`). Jede weitere Farbschicht im Build-Mode konkurriert mit diesen
sechs Bedeutungen.

### 1.4 Decals

- `DecalInstanceManager`: ein `InstancedMesh`, Free-List, Farbe, Deckkraft
  und Variation pro Instanz, Log-Depth, `depthWrite: false`,
  `renderOrder 999` (`decal-instance.manager.ts:24-63`).
- Pools: Blut 100, Eis 150 (`visual-effects.config.ts:17-36`). Ist der Pool
  voll, wird der älteste Decal per linearer Suche entfernt
  (`particle-effects-renderer.ts:184-196`). Das Ausblenden läuft pro Frame
  über `getAllInstances()`, das jedes Mal ein Array kopiert
  (`decal-instance.manager.ts:148-150`, Schleife
  `particle-effects-renderer.ts:1138-1182`).
- `add()` legt pro Aufruf einen neuen `Vector3` an und lädt die ganze
  Instanzmatrix hoch (`decal-instance.manager.ts:103`, `:111-112`).
- Für 100 bis 250 Decals ist das unkritisch, für einen Pool, der bei jedem
  Einschlag wächst, sollten diese drei Stellen vorher glatt sein (TODO.md 1.5
  nennt „P6 Decal-Fade-Idle-Skip“ bereits).
- Der Blut-Shader ist die Vorlage für einen Brandspur-Shader
  (`decal-shaders.ts:22-119`).

### 1.5 Licht und Tiles

Die Photoreal-Tiles reagieren nicht auf dynamische Lichter (siehe Lightning-
Halos, MASTER_GAME_DESIGN §3.12). Aufhellen geht additiv, Abdunkeln mit
normalem Alpha-Blending einer dunklen Farbe. Beides ist reines Compositing
über dem gerenderten Bild und funktioniert auf den Tiles.

### 1.6 Verwandtes

Das DPS-Profil entlang des Pfades (20 Abschnitte, `dps-profile.ts:24-49`, mit
`dps-profile-visualizer.ts`) zeigt die Feuerkraft, die Heatmap zeigt, wo sie
wirkt. Beide zusammen beantworten „wo fehlt ein Tower“.

---

## 2. Empfohlener Ansatz

### 2.1 Zwei Schichten

| | Kampfspuren | Kampfzonen-Heatmap |
|---|---|---|
| Zweck | Stimmung, die Stadt wird zum Schlachtfeld | Information: wo arbeitet die Verteidigung |
| Quelle | `vfx:explosion`, `enemy:died` von Gegnern mit `canBleed: false` | `enemy:died` (optional Schaden) |
| Darstellung | dunkle, verrauschte Flecken, Alpha-Blending, Decal-Pool | weiche Scheiben pro Zelle, Farbrampe, additiv |
| Sichtbarkeit | immer | Bauphase und per Taste, nicht zusammen mit LOS-Zellen |
| Lebensdauer | Wanduhr wie Blut: 60 s stehen, 30 s ausblenden | Spielzeit mit Abklingen, siehe 2.3 |

### 2.2 Kampfspuren

- Neuer Pool `scorch` im `ParticleEffectsRenderer`, 200 Instanzen, Shader nach
  dem Muster des Blut-Shaders in Braunschwarz.
- Höhe aus dem Route-Grid (`getGroundLocalYAt`, `global-route-grid.ts:1447`),
  weil die Explosionsposition bei Bodengegnern 2 m über dem Boden liegt
  (`combat-vfx.service.ts:70-71`).
- **Pro Zelle höchstens ein Fleck.** Ein weiterer Einschlag in derselben
  Zelle erhöht die Deckkraft des vorhandenen (bis 0,8) und setzt seine
  Ausblendzeit zurück, statt einen neuen anzulegen. So entstehen dunkle
  Zonen, wo oft gekämpft wird, und der Pool läuft nicht über. Die Zuordnung
  Zelle → Decal-ID ist eine `Map<number, string>`.
- Vorher im `DecalInstanceManager`: Ältester per FIFO statt linearer Suche
  (die Einfügereihenfolge ist die Altersreihenfolge), `getAllInstances()` nicht
  pro Frame kopieren, Rotationsachse als statische Konstante,
  `addUpdateRange` statt Voll-Upload.

Mengengerüst: Eine Cannon feuert 0,5 bis 0,73 Mal pro Sekunde (Basis bis L25
im Balance-Vorschlag), zehn Cannons also bis 7 Einschläge pro Sekunde. Ohne
Zell-Dedupe wäre ein 200er-Pool nach 30 s umgewälzt, mit Dedupe bleibt er in
den Kampfzonen stehen.

### 2.3 Heatmap: Datenstruktur

Stabiler Index pro Zelle, beim Grid-Aufbau vergeben (nicht `cellIndexMap`).
Abklingen passiert im Shader, die CPU schreibt nur bei einem Ereignis.

```ts
// services/world/combat-heat.service.ts (neu)
class CombatHeatField {
  private readonly indexByKey = new Map<number, number>(); // cell.key -> Index, einmal befüllt
  readonly heat: Float32Array;   // Wert, abgeklungen bis tLast
  readonly tLast: Float32Array;  // Spielzeit (s) der letzten Änderung
  heatMax = 0;                   // für die Normierung im Shader
  dirtyMin = Number.POSITIVE_INFINITY;
  dirtyMax = -1;

  add(cellKey: number, amount: number, nowS: number): void {
    const i = this.indexByKey.get(cellKey);
    if (i === undefined) return;
    const decayed = this.heat[i] * Math.exp(-(nowS - this.tLast[i]) / TAU_S);
    this.heat[i] = decayed + amount;
    this.tLast[i] = nowS;
    if (this.heat[i] > this.heatMax) this.heatMax = this.heat[i];
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }
}
```

- **Speicher:** 50.000 Zellen × 2 Floats × 4 B = 400 KB.
- **Gewichte:** Kill = 1. Schaden als Option mit `schaden / maxHp` des
  Gegners, damit Panzer die Karte nicht dominieren.
- **Zeitbasis:** Spielzeit (`_gameTimeMs` des `GameStateManager`), damit das
  Bild bei Timescale 10 dasselbe ist, nur schneller erreicht.
- **Upload:** höchstens viermal pro Sekunde, nur der Bereich
  `dirtyMin..dirtyMax` beider Attribute (`addUpdateRange`), und nur, wenn
  die Schicht sichtbar ist. Akkumuliert wird immer.
- **Normierung:** `heatMax` ist das Maximum der laufenden Welle. Eine Welle
  mit 20 Zombies und eine mit 20.000 Ratten ergeben beide ein lesbares Bild.

**Pro Welle oder pro Spiel:**

| Option | zeigt | Problem |
|---|---|---|
| pro Welle, Reset bei `wave:started` | wo diese Welle gekämpft wurde | Bild verschwindet mit dem Start der nächsten Welle |
| pro Spiel, ohne Abklingen | Wirkung über den ganzen Run | späte Großwellen überdecken alles davor |
| Abklingen mit τ | Mischung | τ ist schwer zu erklären |

**Empfehlung „Wellenbild“:** während der Welle Abklingen mit τ = 90 s
Spielzeit, am Wellenende wird `uTime` eingefroren, die Bauphase zeigt das
Bild der letzten Welle unverändert. Beim nächsten Wellenstart wird das Feld
auf 25 % gesetzt, damit die neue Welle sichtbar darüber wächst.

### 2.4 Heatmap: Darstellung und Shader

- Eigenes `InstancedMesh`, eine flache Scheibe von 2,6 m pro Zelle. Die
  Scheiben überlappen auf dem 2-m-Raster, dadurch entstehen weiche Flächen
  statt Kacheln.
- Position aus der Zellmitte und `terrainHeight`, nicht gesampelte Zellen mit
  Skalierung 0 (sie tauchen auf, wenn ihre Höhe kommt).
- `depthTest: false` wie die Route-Grid-Viz, damit Straßen zwischen Häusern
  nicht verschwinden, `renderOrder 2`, also unter den LOS-Layern (3 und 4).
- Additives Blending, Farbrampe Braunrot → Orange → Hellgelb. Die Rampe
  vermeidet Grün, Blau, Lila und reines Rot. Gold liegt nah an Hellgelb, die
  Regel „nie zusammen mit den LOS-Zellen“ löst das.
- Logarithmische Normierung, damit ein einzelner Todesstreifen am Engpass
  nicht alles andere dunkel macht.

```glsl
// Vertex
attribute float aHeat;
attribute float aTLast;
uniform float uTime;   // Spielzeit in s, in der Bauphase eingefroren
uniform float uTau;    // 90.0
varying float vHeat;
varying vec2 vUv;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vUv = uv;
  float age = max(0.0, uTime - aTLast);
  vHeat = aHeat * exp(-age / uTau);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}

// Fragment (AdditiveBlending, depthTest false, depthWrite false)
uniform float uHeatMax;
uniform float uOpacity;
varying float vHeat;
varying vec2 vUv;
#include <logdepthbuf_pars_fragment>
vec3 ramp(float t) {
  vec3 low  = vec3(0.35, 0.05, 0.02);
  vec3 mid  = vec3(1.00, 0.45, 0.05);
  vec3 high = vec3(1.00, 0.90, 0.60);
  return t < 0.5 ? mix(low, mid, t * 2.0) : mix(mid, high, t * 2.0 - 1.0);
}
void main() {
  #include <logdepthbuf_fragment>
  float t = clamp(log(1.0 + vHeat) / log(1.0 + uHeatMax), 0.0, 1.0);
  float r = length(vUv * 2.0 - 1.0);
  float disc = 1.0 - smoothstep(0.55, 1.0, r);
  float a = t * disc * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(ramp(t) * a, 1.0);
}
```

Die Log-Depth-Chunks sind Pflicht, sonst stimmt die Verdeckung gegen die
Tiles nicht (gilt für jeden eigenen Shader im Projekt).

### 2.5 Sichtbarkeit neben den LOS-Zellen

- Im Build-Mode mit sichtbaren LOS-Zellen: Heatmap aus, Kampfspuren an. Die
  Spuren sind dunkel und ungesättigt und stören die farbigen Zellen nicht.
- Bauphase ohne Build-Mode: Heatmap an (Wellenbild).
- Während der Welle: Heatmap per Taste, Kampfspuren immer.
- Debug-Grid (global) und Heatmap schließen sich ebenfalls aus.

### 2.6 Performance-Budget

Referenz: 20.000 Gegner laufen nach dem Hot-Path-Umbau mit 48 FPS
(TODO.md 1.4, `:228-230`).

| Posten | Mengengerüst | Kosten |
|---|---|---|
| Kills | 20.000 pro Welle, Spawn-Fenster höchstens 180 s (`templates.ts:325`), also rund 100 bis 300 pro Sekunde | ein Map-Lookup, ein `exp`, drei Schreibzugriffe pro Kill, weit unter 0,01 ms pro Frame |
| Schaden (optional) | Fire-Kegel 60 Anwendungen pro Sekunde und Gegner, Gatling L25 21 Schuss pro Sekunde und Tower; grob 20.000 Anwendungen pro Sekunde | etwa 1 ms pro Sekunde Spielzeit, 0,02 ms pro Sub-Step |
| Upload | Dirty-Bereich höchstens 2 × 50.000 × 4 B = 400 KB, bei 4 Hz höchstens 1,6 MB/s | zum Vergleich: der Gegner-Instanzpuffer bei 20.000 Gegnern lädt 1,25 MB pro Frame (TODO.md 1.0) |
| Zeichnen Heatmap | 1 Draw Call, bis 50.000 Instanzen × 2 Dreiecke, Überdeckung 2 bis 4 Schichten auf der Straße | gering gegen die Tiles |
| Zeichnen Kampfspuren | 1 Draw Call, 200 Instanzen | vernachlässigbar |

Im Headless-Trainingsbetrieb (`renderingEnabled` aus,
`game-state.manager.ts:478`) bleibt der Dienst aus.

### 2.7 Gameplay-Nutzen

- **Wo arbeitet die Verteidigung:** helle Zonen sind die Killzonen. Eine
  helle Zone kurz vor dem HQ ist ein Warnsignal: Die Gegner sterben spät.
- **Wo fehlt ein Tower:** Lücken zwischen zwei Zonen, zusammen mit dem
  DPS-Profil, sind die Kandidaten für den nächsten Bau.
- **Wirkung einzelner Tower sichtbar machen:** ein Klick auf einen Tower
  könnte die Heatmap auf dessen Kills filtern (Kill-Tracking pro Tower gibt
  es, `damage-application.service.ts:114-124`). Option, nicht im ersten Schritt.
- **Stimmung:** nach 30 Wellen ist die Stadt vernarbt. Das trägt auch
  Screenshots und Trailer.
- Ein Nuklearschlag (PLAYER_AGENCY_CONCEPT.md) hinterlässt über dasselbe
  System einen großen Krater (Event `ability:used`).

### 2.8 Aufwand

| Teil | Aufwand |
|---|---|
| `DecalInstanceManager` glätten (FIFO, keine Array-Kopie, Update-Ranges) | S |
| Kampfspuren: Pool, Shader, Handler, Zell-Dedupe | S |
| Heatmap: Dienst, stabiler Zellindex, Mesh, Shader, Umschalter, Tests | M |
| Schaden als zweite Quelle | S |

Tests: Akkumulation und Abklingen im Dienst, Stabilität des Index bei
Höhen-Promotion, gleiches Bild bei Timescale 1 und 10.

### 2.9 Offene Entscheidungen

1. **Zeitmodell:** „Wellenbild“ wie in 2.3 oder rein pro Welle.
   *Empfehlung:* Wellenbild.
2. **Sichtbarkeit während der Welle:** immer oder per Taste.
   *Empfehlung:* per Taste, die Welle selbst ist schon voll mit Signalen.
3. **Quelle:** Kills oder Schaden. *Empfehlung:* Kills zuerst, Schaden nur,
   wenn Panzer-Wellen im Bild fehlen.
4. **Verdeckung:** Heatmap über Gebäuden sichtbar (`depthTest` aus) oder
   verdeckt. *Empfehlung:* sichtbar, wie das Route-Grid, sonst verschwinden
   enge Straßen.
5. **Daten für den Director:** ein Kill-Profil entlang des Pfades wäre ein
   naheliegendes Feature. *Empfehlung:* vorerst nicht, der Regel-Director
   liest keine räumlichen Daten.
