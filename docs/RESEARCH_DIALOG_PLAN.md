# Forschung als Dialog mit echtem Graphen (TODO G3)

**Stand 2026-09-21, geplant, noch nichts gebaut.** Entscheidungen des Users sind unten in Abschnitt 8
festgehalten, offene Fragen in Abschnitt 9.

Auslöser ist nicht die Optik. Am 2026-09-21 hing `aa-retrofit` (breite Flugabwehr, 450) hinter
`rocketry` (Spezialist, 600), obwohl der Spezialist gegen die Luftgegner der Wellen 7 und 8 zehnmal
schlechter ist je Gold. Das stand seit Monaten so im Baum und fiel niemandem auf, weil die UI den Baum
nie als Baum zeigt: Das heutige Panel listet alle 20 Knoten flach in Objektreihenfolge. Ein Graph macht
solche Fehler sichtbar, ohne dass jemand die Config liest.

## 1. Was heute da ist

| Teil | Ort | Zustand |
|---|---|---|
| Datenmodell | `configs/research/research.types.ts` | id, name, description, category, icon, cost, duration, prerequisites, effects. **Keine Tiefenangabe**, "Tier 0-3" steht nur als Kommentar in der Config |
| Graph | `configs/research/research-tree.config.ts` | 20 Knoten, 19 Kanten, 4 Wurzeln. Ein DAG, kein Baum: `chaos-rift` und `advanced-weaponry` haben je zwei Vorbedingungen, beide an derselben Kreuzung Gatling gegen Eis |
| Logik | `managers/research.manager.ts` (485 Z.) | Start, Abbruch (50 % zurück), Slots, **Warteschlange komplett**: `queueResearch`, `unqueueResearch`, `startQueued` |
| Zustand | `store/research.store.ts` (117 Z.) | Reiner Spiegel, keine Aktionen. Alle Signale vorhanden, auch `queuedResearches` und `availableSlots` |
| Befehle | UI → `tower-defense.component.ts` → `facade.emitCommand` → Bus → `game-commands.handler.ts:77-100` | start, cancel, queue, unqueue |
| Rückweg | `game-state-sync.service.ts:199-218` | `research:state-changed` ist der vollständige Snapshot nach jeder Mutation, `research:progress` füllt nur den Balken |
| UI | `components/game-sidebar/research-panel/` | Eine Komponente, 152 Z. TS, 130 Z. HTML. Flache Liste, keine Kategorien, keine Kanten. Reine Statuslogik liegt schon getrennt in `research-status.ts` (52 Z.) |

**Die Warteschlange ist vorhanden und bedienbar**, entgegen dem Wortlaut von TODO G3. Es fehlt genau
eine Fähigkeit: Umsortieren. Im Manager gibt es `push`, `splice`, `shift`, `filter`, aber kein Move.

## 2. Schnitt in drei Schichten

Der Tech Tree des Helden (TODO G2) kommt. Damit das dort keine zweite Implementierung wird, trennt
dieser Umbau Mathematik, Darstellung und Fachlichkeit:

```
Schicht 1  utils/dag-layout.ts          rein, ohne Angular, ohne SVG, ohne Fachwissen
              Knoten + Kanten  ->  Ebenen, Koordinaten, Kantenpfade

Schicht 2  components/tech-tree/         darstellend, kennt nur Zustände als Aufzählung
              Layout + Knotenzustand  ->  SVG, Klick als Ausgabe

Schicht 3  components/research-dialog/   kennt Forschung: Config, Store, Befehle, Credits, Slots
```

Für den Helden bleibt später nur Schicht 3 neu.

**Schicht 2 wird bewusst dumm gehalten.** Sie kennt einen Knoten als Rechteck mit Symbol, Titel und
zwei Zahlen sowie einen Zustand aus einer festen Aufzählung. Alles Forschungsspezifische (Credits,
Slots, Erstattung, Vorbedingungsnamen) bleibt in Schicht 3. Die Verlockung, Schicht 2 "allgemein
nützlich" zu machen, ist der Weg zu einer Abstraktion, die zwei Fälle bedient und bei keinem passt.

## 3. Schicht 1: das Layout

Reine Funktion, keine Klasse:

```ts
layoutDag(nodes: DagNode[], edges: DagEdge[], opts: DagLayoutOptions): DagLayout
```

Regeln, in dieser Reihenfolge:

1. **Ebene = längster Weg von einer Wurzel.** Nicht "Tiefe des ersten Elternteils". Bei
   `advanced-weaponry` (Vorbedingungen `siege-engineering` auf Ebene 2 und `arcane-studies` auf
   Ebene 2) sind beide gleich tief, aber die Regel muss stehen, bevor jemand einen Knoten einfügt,
   bei dem sie es nicht sind.
2. **Reihenfolge innerhalb einer Ebene** nach der mittleren Position der Vorgänger, damit Kanten
   sich selten kreuzen. Ein einziger Durchlauf reicht bei 20 Knoten; ein iteratives Verfahren wäre
   Aufwand ohne sichtbaren Gewinn.
3. **Kanten, die Ebenen überspringen**, bekommen einen Bogen statt einer geraden Linie, damit sie
   nicht durch fremde Knoten laufen.
4. **Zyklus ist ein Fehler**, kein stiller Rückfall. Die Funktion wirft, und ein Test in der Config
   stellt sicher, dass der echte Baum keinen hat.
5. **Unverbundene Wurzeln** (heute `tentacle-biology`, ohne Kinder) stehen gleichberechtigt auf
   Ebene 0, nicht als Sonderfall unten.

Getestet wird diese Schicht allein und hart, weil sie die einzige Stelle mit Mathematik ist:
Mehrfach-Vorbedingungen, ebenenüberspringende Kanten, isolierte Knoten, leere Eingabe, Zyklus,
Stabilität (gleiche Eingabe gibt gleiche Ausgabe, damit Knoten nicht bei jedem Öffnen springen).

## 4. Schicht 2: die Darstellung

Inline-SVG, kein Canvas, keine neue Abhängigkeit. Begründung: 20 Knoten sind wenige, SVG-Elemente
sind ohne Zusatzarbeit fokussierbar und beschriftbar (`aria-label`, Tab-Reihenfolge), und der Stil
kommt aus den vorhandenen Theme-Tokens statt aus Zeichenbefehlen. Für Zoom und Verschieben ist
`world-globe.component.ts` das Vorbild im Projekt, dort liegt die Interaktion schon als reine
Funktion neben der Komponente (`globe-projection.ts`).

Zustände je Knoten, als Aufzählung: `completed`, `active`, `queued`, `available`, `locked`. Genau die
fünf, die `research-status.ts:7` heute schon liefert. Die Funktion wandert mit, sie ist bereits rein
und getestet.

Ein laufender Knoten trägt seinen Fortschritt am Knoten selbst, nicht in einer Liste daneben.

## 5. Schicht 3: der Dialog

Muster wie im Projekt üblich: `MatDialog` über `utils/lazy-dialog.ts`, `standalone`, `OnPush`,
`panelClass: 'td-dialog-panel'`, `TD_CSS_VARS` auf `:host`, weil das Overlay außerhalb des App-Baums
liegt. Vorbild ist `damage-matrix-dialog`, das ebenfalls den `ResearchStore` direkt injiziert. Die
560-px-Deckelung der Pane wird über `width` in der Dialog-Config überschrieben, wie es
`open-damage-matrix-dialog.ts:11-14` vormacht.

Befehle gehen den vorhandenen Weg über den Bus, der Dialog spricht **nicht** direkt mit dem Manager.
Neu ist nur ein Befehl: Warteschlange umsortieren.

Die Sidebar behält Status und Knopf: laufende Forschung mit Balken, Anzahl in der Warteschlange,
Slots, Gebäude-Upgrades und Verkauf. Die Knotenliste verschwindet dort **im selben Commit**, in dem
der Dialog sie ersetzt. Kein Nebeneinander.

## 6. Umsortieren der Warteschlange

Der einzige Eingriff in die Spiellogik. Neu:

- `ResearchManager.moveQueued(id, toIndex)`, bewegt innerhalb der Warteschlange, ändert nichts an
  laufenden Forschungen und bucht nichts ab (bezahlt wird weiterhin erst beim Start).
- Ein Befehl im `game-commands.handler.ts` neben `queue` und `unqueue`.
- Der Snapshot `research:state-changed` trägt die Reihenfolge bereits, der Rückweg bleibt unberührt.

Bedienung im Dialog: Ziehen innerhalb der Warteschlangenliste, nicht am Graphen. Der Graph zeigt
Struktur, die Liste zeigt Reihenfolge.

## 7. Arbeitspakete

Schneidbar für parallele Bearbeitung, Reihenfolge der Abhängigkeit:

| Paket | Inhalt | Hängt an |
|---|---|---|
| **A** | `utils/dag-layout.ts` plus Tests | nichts |
| **B** | `ResearchManager.moveQueued` plus Befehl plus Tests | nichts |
| **C** | Schicht 2, darstellende Baum-Komponente | A |
| **D** | Schicht 3, Dialog, Sidebar auf Status eingekürzt, alter Listenpfad entfernt | B, C |
| **E** | Doku: `DESIGN_SYSTEM.md` (Dialogmuster), dieser Plan auf "gebaut", TODO G3 nach DONE | D |

A und B sind unabhängig und können gleichzeitig laufen.

## 8. Entschieden (User, 2026-09-21)

- **Das Sidebar-Panel wird ersetzt**, nicht ergänzt. Sidebar zeigt nur noch Status und öffnet den
  Dialog. Verworfen: Panel und Dialog nebeneinander, und ein rein lesender Dialog.
- **Inline-SVG mit eigenem Layout**, keine Graph-Bibliothek, kein CSS-Grid mit Kanten-Overlay.
- **Keine Wellen- oder Rüstungsangaben am Knoten.** Begründung des Users: Erforscht werden
  Technologien, nicht Türme. Der Strukturfehler, der diesen Umbau ausgelöst hat, ist im Graphen
  ohnehin sichtbar.
- **Erweiterbarkeit ist Teil der Aufgabe**, nicht ein späteres Aufräumen: ein neuer Knoten in
  `research-tree.config.ts` darf keine UI-Änderung erfordern, und der Heldenbaum (G2) soll Schicht 1
  und 2 unverändert benutzen.

## 9. Offen

- **Ebenen waagerecht oder senkrecht?** Waagerecht (Wurzeln links) passt zu einem breiten Dialog und
  liest sich wie ein Fortschritt. Senkrecht passt besser zu schmalen Fenstern. Entscheidet, wie die
  560-px-Deckelung überschrieben wird.
- **Was passiert bei einem Knoten ohne freien Slot und ohne Credits?** Heute entscheidet der Klick
  selbst (`onResearchClick`): starten wenn möglich, sonst vormerken. Im Dialog wäre auch denkbar,
  beides als getrennte Aktionen anzubieten. Betrifft nur die Bedienung, nicht die Logik.
- **Zoom und Verschieben von Anfang an?** Bei 20 Knoten passt der Graph vermutlich ohne Zoom in einen
  breiten Dialog. Erst messen, wie breit er wirklich wird, dann entscheiden.
