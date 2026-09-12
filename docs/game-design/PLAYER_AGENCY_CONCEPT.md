# Konzept: Spieler aktiver ins Geschehen einbinden

**Status:** Entschieden am 2026-09-12 (Abschnitt 7). MVP Nuklearschlag gebaut
am 2026-09-13 (Abschnitt 8, Dokumentation in [ABILITIES.md](../ABILITIES.md)).
**Stand:** 2026-09-11 (Abschnitte 0 bis 6, Code-Stand `3338f4b`), 2026-09-12
(Abschnitt 7), 2026-09-13 (Abschnitt 8).
**Bezug:** TODO.md, Backlog „Gameplay-Konzepte: Spieler aktiver ins Geschehen
einbinden“.

Aufwand: **S** bis ein Tag, **M** einige Tage, **L** mehr als eine Woche.

---

## 0. Kurzfassung

- **Zuerst ein Nuklearschlag als Fähigkeit mit Ladungen** (MVP, Aufwand M).
  Er braucht den kleinsten Eingriff (ein Command, ein Manager mit Timer in
  Spielzeit, Schaden über vorhandene Wege), passt in die vorhandene
  Forschungs-Infrastruktur und wird vom Leck-Regelkreis des Wave-Directors am
  wenigsten wieder weggeregelt.
- **Danach der Held**, beschränkt auf die Gegnerrouten (Aufwand L). Er bringt
  die meiste Aktivität, kostet aber am meisten und wirkt dauerhaft, was der
  Regelkreis ausgleicht.
- **Pickups** als dritte Stufe, verzahnt mit dem Nuklearschlag (Pickup lädt
  eine Ladung auf). **Drohnen-Hub** nur, wenn der Spieler den Einsatzort
  bestimmt. **Gold-Farm nicht bauen**, sie bricht die Einkommenskurve.
- Die wichtigste offene Frage steht in Abschnitt 2: Aktives Spiel senkt die
  Leck-Quote, und der Gate-Controller antwortet darauf mit größeren Wellen.

---

## 1. Was es heute gibt

**Eingaben des Spielers.** Sieben Commands über den Event-Bus: bauen,
verkaufen, upgraden, Welle starten, Neustart (`game-event-bus.ts:222-244`),
Forschung starten und abbrechen (`:145-153`). Verarbeitet werden sie im
`GameCommandsHandler` (`game-commands.handler.ts`). Bauen und Upgraden gehen
auch während der Welle, `placeTower` prüft keine Phase
(`game-state.manager.ts:838-877`). Während einer Welle gibt es also nur
Wirtschaftsentscheidungen, keine Eingriffe ins Kampfgeschehen.

**Klicks auf die Karte.** `InputHandlerService` raycastet erst Tower, dann
Terrain und reicht die Geo-Position an einen Callback weiter
(`input-handler.service.ts:223-283`). Ein Rechtsklick-Handler existiert
(`:216`). Ein Zielmodus für Fähigkeiten ließe sich wie der Build-Mode
anhängen.

**Nicht-Kampf-Gebäude.** Das Research Center ist ein Eintrag in
`TOWER_TYPES` mit `attackType: 'passive'` (`tower-types.config.ts:428-460`).
Es wird wie ein Tower platziert, nur einmal erlaubt
(`game-state.manager.ts:848-852`), ohne LOS-Registrierung (`:867-869`). Seine
Logik lebt im `ResearchManager`, der im Sub-Step in Spielzeit tickt
(`game-state.manager.ts:517`, `research.manager.ts:282-314`). Das ist die
Vorlage für jedes neue Gebäude mit Aufgabe.

**Forschung als Freischalter.** Effekte sind `unlock-tower`, `global-perk`,
`unlock-upgrade-tier`, `enable-targeting` (`research.types.ts:27-31`).
`global-perk` samt `isPerkUnlocked` existiert, wird aber von keiner Forschung
benutzt (`research.manager.ts:138-148`). Eine Fähigkeit kann dort ohne neue
Effektart andocken.

**Bewegung.** Gegner laufen mit `MovementComponent` auf vorberechneten
Geo-Pfaden, in Spielzeit (`movement.component.ts:105` `setPath`, `:350`
`move`). Die Routen liegen als Polylinien vor (`getCachedPaths`,
`game-state.manager.ts:965`). Bodenhöhe gibt es nur im 7-m-Korridor entlang
der Routen (`getGroundLocalYAt`, `global-route-grid.ts:1447`, Korridor
`:377`). Das Straßennetz hat A* (`street-network-provider.interface.ts:68-74`),
im Worker asynchron, mit synchronem Fallback (`path-route.service.ts:262-277`,
`:296`).

**Kampf.** Jeder Schaden läuft durch `DamageApplicationService`
(`damage-application.service.ts:42-109`), Kills werden über `sourceTowerId`
dem Tower gutgeschrieben. Tower-Sichtlinien kommen aus einer Cubemap pro
Tower (512² × 6 Flächen, `los-viz.config.ts:26`), für bewegte Einheiten also
ungeeignet. Der Raycast-Fallback verlangt eine Tower-ID
(`tower-combat.service.ts:107-112`). Gegner greifen nichts an außer der Basis
(`enemy:reached-base`, `enemy.manager.ts:412-421`).

**Gold.** Das Kill-Budget pro Welle ist fest und wird auf die erwartete
Gegnerzahl verteilt; der Anteil eines Gegners, der durchkommt, verfällt
(`enemy.manager.ts:268-298`). Wer mehr tötet, verdient mehr, höchstens das
Budget.

**Wave-Director.** Das Defense-Modell liest nur Tower
(`defense-analyzer.ts:57-87`), passive Gebäude zählen mit 0 DPS
(`tower-dps.util.ts:76`). Der Gate-Controller regelt die Wellengröße auf 8
bis 16 % Leck-Quote (`gate-controller.ts:52-53`, `:91-115`).

**Bots.** Aktionen `place | upgrade | sell | wait | start-wave |
research-start | research-cancel` (`tower-bot.interface.ts:19`).

**Determinismus.** Gameplay läuft in festen Sub-Steps von 16,667 ms
(`game-state.manager.ts:431-463`). Commands wirken heute sofort beim Emit,
also zwischen zwei Frames. Im Mehrspielerkonzept werden sie auf einen
Net-Tick gestempelt und dort ausgeführt (MULTIPLAYER_CONCEPT.md §4.1 bis
§4.3). Gameplay-Zufall läuft noch über ungeseedetes `Math.random` (§2.3).

---

## 2. Das Grundproblem: der Regelkreis gleicht Vorteile aus

Der Gate-Controller misst über vier Wellen, welcher Anteil die Basis
erreicht, und vergrößert den Wellen-Cap um bis zu 35 % pro Welle, solange
weniger als 8 % durchkommen (`gate-controller.ts:42`, `:56`, `:105-110`). Das
gilt schon heute für gute Tower-Platzierung und gilt für jede neue Mechanik:

- **Dauerhafte Stärke** (Held, Drohnen) senkt die Leck-Quote, nach vier bis
  acht Wellen sind die Wellen entsprechend größer. Der Spieler kämpft dann
  mehr Gegner, verliert aber pro Welle ähnlich viel HP.
- **Burst mit Ladungen** (Nuklearschlag alle drei Wellen) ist im
  Vier-Wellen-Mittel ein Ausreißer. Der Spieler setzt ihn dort ein, wo eine
  Welle kippt, und rettet HP, bevor der Regler reagiert.
- **Was aktives Spiel sicher bringt:** Gold (verhinderte Lecks zahlen ihren
  Budgetanteil aus) und HP in einzelnen Wellen. HP sind das Run-Budget, der
  Spieler heilt nie (MASTER_GAME_DESIGN §5.5).

Folgerung für jede Variante:

1. Was **dauerhaft** wirkt, muss im Fairness-Gate mitzählen. Sonst schätzt
   das Gate die Verteidigung zu niedrig ein, die ersten Wellen nach dem Kauf
   sind zu klein, und erst der Regler holt das nach vier Wellen auf.
2. Was **punktuell** wirkt, gehört nicht ins DPS-Modell. Der Leck-Regler
   sieht es ohnehin.
3. Optional (offene Entscheidung 1): Kills durch Fähigkeiten zählen für den
   Regler als Leck. Dann macht der Einsatz künftige Wellen nicht größer, der
   Spieler behält HP und Gold.

---

## 3. Varianten

### 3.1 Nuklearschlag

**Idee.** Nach einer Forschung hat der Spieler eine Ladung. Er klickt ein
Ziel, nach 1,5 s Vorwarnung (Zielmarker am Boden) schlägt es ein. Radius
25 m, Wirkung gegen Boden und Luft. Eine Ladung kommt nach je drei
abgeschlossenen Wellen zurück.

**Wirkung.** Prozentual: 60 % der Max-HP, Bosse 20 %. Das hängt nicht an der
Schadensmatrix, unterläuft die Spreizung aus dem Balance-Vorschlag also nicht
und skaliert ohne Nachjustieren über 100 Wellen. Ein 25-m-Kreis über der
Route deckt bis zu 50 m Weg ab, bei 2 m Abstand etwa 25 Gegner pro Pfad.

**Warum Ladungen pro Welle, nicht Cooldown in Spielzeit:** Zwischen den
Wellen läuft die Spielzeit weiter (Forschung tickt), und der Spieler startet
die nächste Welle selbst (`command:start-wave`). Ein Cooldown in Spielzeit
ließe sich durch Warten vor dem Wellenstart füllen.

**Vorhanden:** Radius-Abfrage `getEnemiesInRadiusGeo`
(`global-route-grid.ts:1545-1557`), Explosions-Presets
(`visual-effects.config.ts:48-55`), Screen-Shake-Service, Perk-Mechanik der
Forschung.

**Neu:** `AbilityManager` (IGameManager, tickt nach `researchManager.update`
im Sub-Step), Config `abilities.config.ts`, Command `command:use-ability`
im `GameCommandsHandler`, Event `ability:used` für VFX, Audio und die
Kampfzonen-Heatmap, ein matrixfreier Schadensweg im
`DamageApplicationService`, Flag `isBoss` in `EnemyTypeConfig`, UI-Knopf
mit Ladungsanzeige, Zielmodus mit Radius-Vorschau im `InputHandlerService`.

**Economy.** Neutral im Budget: Die getöteten Gegner zahlen ihren Anteil am
festen Kill-Budget, nicht mehr. Ein Nuklearschlag, der Lecker erwischt,
bringt deren sonst verfallenden Anteil.

**Director und Gate.** Nicht ins DPS-Modell (punktuell). Der Leck-Regler
sieht die Wirkung, siehe Abschnitt 2.

**Bots.** Ignorieren im ersten Schritt, damit Bot-Baselines vergleichbar
bleiben. Später eine Strategie „einsetzen, wenn mehr als N Gegner in den
letzten 20 % der Route stehen“ (S), mit neuer Aktion `use-ability`.

**Determinismus.** Der Command trägt Fähigkeit und Zielpunkt, der Handler
prüft Ladung und Forschung und legt einen Einschlag mit Restzeit in
Sub-Steps an. Der Einschlag wird im Sub-Step aufgelöst. Kein Zufall. Im
Mehrspielerbetrieb ist das der achte Command und läuft über dieselbe
Pipeline wie die übrigen.

**Aufwand M. Risiken:** Der Knopf wird zum Pflichtknopf (dann Wirkung oder
Ladung senken). Klicks landen auf Dächern: den Einschlag auf die nächste
Route-Zelle im Umkreis von 30 m ziehen, sonst ablehnen. Bei großen Wellen
sterben 100 bis 200 Gegner auf einmal, das belastet Blut- und Todeseffekte
kurz (Blut-Decal-Pool 100, `visual-effects.config.ts:18`).

### 3.2 Held

**Idee.** Eine eigene Einheit, die der Spieler per Klick schickt. Sie
kämpft automatisch auf kurze Distanz (15 bis 20 m) und bewegt sich mit
eigenem Tempo.

**Bewegung, Stufe 1: nur auf den Gegnerrouten.** Aus den Routen-Polylinien
entsteht ein kleiner Graph (Knoten dort zusammenführen, wo Pfade sich
treffen), der Weg wird im Command synchron berechnet (Dijkstra auf einigen
hundert Knoten). Höhen liefert das Route-Grid, die Bewegung übernimmt eine
`MovementComponent`. Keine neuen Raycasts, kein Worker.

**Bewegung, Stufe 2: ganzes Straßennetz.** Außerhalb des Korridors fehlen
Bodenhöhen (Raycast pro Schritt), und der Worker liefert Pfade asynchron. Für
Determinismus müsste der Pfad synchron (`path-route.service.ts:296`) oder im
Command mitgeschickt werden. Erst angehen, wenn Stufe 1 trägt.

**Kampf.** Kandidaten aus `getEnemiesInRadius`, Sichtlinie ignoriert (kurze
Reichweite, auf der Straße), Schaden über `DamageApplicationService` mit
Quelle `hero`. Die Schadensart wäre der stärkste Hebel: Wählt der Spieler
sie (Physical, Siege, Magic) per Knopf, wird der Held zur aktiven Antwort auf
den Rüstungsmix der laufenden Welle. Das greift direkt in die gespreizte
Matrix aus dem Balance-Vorschlag.

**Verwundbarkeit.** Gegner greifen heute nichts an. Ein Held, der sterben
kann, braucht eine Angriffslogik für alle Gegner, ein eigenes System (L).
Stufe 1: unverwundbar, Balance über DPS, Tempo und Reichweite.

**Director und Gate.** Wirkt dauerhaft, zählt also im Defense-Modell mit:
als virtueller Tower mit Präsenzfaktor 0,5 in `effectiveDPSPerArmor` und
`killThroughput`, weil er nicht überall zugleich ist. Das DPS-Profil entlang
des Pfades (`dps-profile.ts`) betrifft nur den ONNX-Pfad und kann ihn
ignorieren.

**Economy.** Kauf für einen festen Preis, Aufstieg über Kills statt Gold.
Das Gold-Budget bleibt unberührt.

**Bots.** Kaufen keinen Held. Solange er nur zählt, wenn er existiert,
ändern sich Bot-Läufe nicht.

**Neu:** Hero-Entity (Transform, Combat, Movement, Render), `HeroManager`,
Routen-Graph, Renderer (ein animiertes Modell, Auswahlring, Zielmarker),
Commands `command:hero-move` und `command:hero-stance`, UI für Auswahl und
Bewegungsbefehl.

**Aufwand L. Risiken:** vom Regelkreis ausgeglichen (Abschnitt 2),
Bedienung in 3D (Klick auf eine Straße zwischen Häusern), Routen, die der
Straße nicht folgen (TODO.md 1.1), und ein Held, der eine Tower-Reihe
ersetzt.

### 3.3 Gebäude mit Aufgaben

**Drohnen-Hub.** Passives Gebäude wie das Research Center, sendet drei
Drohnen in einen Umkreis von 40 m. Neu wären eine fliegende Einheitenart,
ihre Zielwahl und ein instanziertes Rendering (M bis L). Läuft der Hub
automatisch, ist er ein Tower mit anderem Aussehen: dauerhaft, vom Regler
ausgeglichen, keine Aktivität. Sinnvoll nur, wenn der Spieler den
Sammelpunkt der Drohnen per Klick setzt. Zählt im Defense-Modell wie ein
Tower.

**Gold-Farm.** Passt nicht zur Einkommenskurve. Das Budget pro Welle wächst
von 200 Gold (W1) auf 180.000 (W30) (`wave-curriculum.config.ts:45-74`). Ein
fester Ertrag ist ab etwa W15 bedeutungslos, ein prozentualer ist Zins: 5 %
von `goldComplete` sind in W10 23 Gold, in W20 300, in W30 3.000. Eine Farm
für 500 Gold amortisiert sich ab W20 in zwei Wellen. Das Curriculum ist mit
25 % Puffer gegen den geplanten Ausbau gerechnet (Balance-Vorschlag 2.5), die
Farm würde diesen Puffer frei verschieben. Außerdem ist sie passiv, bringt
also keine Aktivität. Empfehlung: nicht bauen. Falls doch, dann als
Umverteilung: die Farm erhöht `goldComplete` und senkt `goldKill` um
denselben Betrag, ist also eine Wette auf wenig Lecks.

**Pickups.** Getötete Gegner lassen selten ein Item fallen (geseedeter
Zufall, höchstens drei pro Welle, damit 20.000-Gegner-Wellen nicht
explodieren), das der Spieler innerhalb von 8 s anklickt. Inhalte: eine
Nuklearschlag-Ladung, ein Feuerraten-Buff für Tower im Umkreis, kurze
Zeitlupe. Kein Gold (festes Budget). Neu wären Drop-Logik an `enemy:died`,
Pickup-Objekte, ein Klick-Raycast gegen Pickups und temporäre Tower-Buffs,
die es heute nicht gibt (M). Der Pickup ist ein Command mit Pickup-ID.
Aktivität hoch, aber sie zieht den Blick vom Überblick weg.

---

## 4. Vergleich

| Variante | aktiv während der Welle | vom Regelkreis ausgeglichen | im DPS-Modell | neue Systeme | Aufwand |
|---|---|---|---|---|---|
| Nuklearschlag | ja, gezielte Entscheidung | kaum (Burst) | nein | Manager, Command, UI | M |
| Held (Routen) | ja, dauernd | ja | ja, Faktor 0,5 | Entity, Manager, Graph, Renderer, UI | L |
| Pickups | ja, hektisch | kaum | nein | Drops, Buffs, Klickziel | M |
| Drohnen-Hub | nur mit Sammelpunkt | ja | ja | Einheiten, Zielwahl, Rendering | M bis L |
| Gold-Farm | nein | nicht betroffen, bricht Economy | nein | kaum | S |

---

## 5. MVP: Nuklearschlag

| Punkt | Festlegung |
|---|---|
| Freischaltung | Forschung `orbital-strike`, Kategorie `global-perk`, 1.000 Gold, 40 s, Voraussetzung `advanced-weaponry`. Damit kommt sie nach dem ersten Boss (W10), wenn das Curriculum anzieht |
| Ladungen | 1, eine neue nach je drei abgeschlossenen Wellen, Maximum 1 |
| Wirkung | Radius 25 m, 1,5 s Vorwarnung, 60 % Max-HP, Bosse 20 %, Boden und Luft, matrixfrei |
| Ziel | Klick auf Terrain, Einschlag auf die nächste Route-Zelle im Umkreis 30 m, sonst ungültig |
| Code | `configs/abilities.config.ts`, `managers/ability.manager.ts`, Tick in `runSubStep` nach `researchManager.update` (`game-state.manager.ts:517`), Command im `GameCommandsHandler`, Event `ability:used`, Flag `isBoss` in `enemy-types.config.ts` |
| UI | Knopf mit Ladungsanzeige neben dem Next-Wave-Button, Zielmodus mit Radius-Ring |
| Nicht im MVP | weitere Fähigkeiten, Bot-Strategie, zweite Ladung, Pickups |
| Tests | Manager: Ladung, Nachladen nach Wellenende, Ablehnen ohne Forschung. Integration: Einschlag nach 90 Sub-Steps, identisches Ergebnis bei Timescale 1 und 10 |
| Playtest-Fragen | Wird die Ladung eingesetzt, wenn sie verfügbar ist? In welcher Lage? Fühlt sie sich als Rettung an oder als Pflicht? |

---

## 6. Offene Entscheidungen

1. **Sollen Fähigkeits-Kills den Regelkreis füttern?**
   (a) wie alles andere: Einsatz macht spätere Wellen größer.
   (b) Fähigkeits-Kills zählen für den Regler als Leck: Einsatz rettet HP und
   Gold ohne Folgen für die Wellengröße.
   (c) Zielband des Reglers anheben.
   *Empfehlung:* (b) für den Nuklearschlag. Beim Held nicht, sonst wäre er
   Stärke ohne Gegenwicht.
2. **Nachladen pro Welle oder in Spielzeit.** *Empfehlung:* pro Welle (siehe
   3.1).
3. **Wirkung prozentual oder als Schadensart.** *Empfehlung:* prozentual,
   damit die Matrix-Spreizung nicht an einer Stelle ausgehebelt wird.
4. **Held verwundbar?** Verlangt ein Angriffssystem für Gegner.
   *Empfehlung:* Stufe 1 unverwundbar.
5. **Bots.** *Empfehlung:* ignorieren, bis eine Baseline mit der neuen Matrix
   vorliegt, dann eine eigene Bot-Konfiguration mit Fähigkeiten, damit die
   bisherigen Vergleichsläufe gültig bleiben.
6. **Name und Setting.** Zombies, Mechs und Drachen in echten Städten:
   „Nuklearschlag“, „Orbitalschlag“ oder „Artillerieschlag“. Offen für den
   Menschen.

---

## 7. Entscheidungen (2026-09-12)

Vom Nutzer über den Entscheidungsbogen getroffen (Kurzform
`1a · 2b · 3a · 4a · 5a · 6b · 7a · 8a · 9b · 10a`):

| Frage | Entscheidung |
|---|---|
| Name | **Nuklearschlag** |
| Regelkreis | Fähigkeits-Kills zählen für den Leck-Regler **als Leck**: der Einsatz rettet HP und Gold, die Wellengröße bleibt unberührt (6.1 b) |
| Nachladen | **1 Ladung, eine neue nach je 3 abgeschlossenen Wellen** (6.2) |
| Höchstens | **1 Ladung**, kein Horten |
| Wirkung | **60 % der Max-HP, Bosse 20 %**, matrixfrei (6.3) |
| Radius | **25 m** |
| Zielen | Klick, **1,5 s Vorwarnung** mit Zielmarker, Einschlag auf die **nächste Route-Zelle im Umkreis von 30 m**, sonst abgelehnt |
| Freischaltung | Forschung: 1.000 Gold, 40 s, Voraussetzung `advanced-weaponry`, damit voraussichtlich nach dem ersten Boss (W10); keine eigene Wellensperre. Die Forschungs-ID aus Abschnitt 5 (`orbital-strike`) folgt beim Bau dem Namen |
| Bots | **Sofort eine Bot-Strategie** (abweichend von der Empfehlung in 6.5): einsetzen, wenn viele Gegner im letzten Fünftel der Route stehen, mit neuer Bot-Aktion `use-ability`. Folge: sofern die Strategie in den bisherigen Bot-Konfigurationen aktiv ist, sind die bisherigen Baselines nicht mehr direkt vergleichbar |
| Danach | **Held** (Stufe 1, nur auf den Gegnerrouten, unverwundbar) |

Damit entspricht der MVP Abschnitt 5, ergänzt um die Bot-Strategie und die
Leck-Buchung der Fähigkeits-Kills im `GateController`.

---

## 8. Umsetzung (2026-09-13)

Gebaut wie in Abschnitt 7 entschieden; Aufbau, Ablauf und Dateien in
[ABILITIES.md](../ABILITIES.md). Beim Bau festgelegt, wo Abschnitt 5 und 7
nichts sagen:

| Punkt | Umsetzung |
|---|---|
| Forschungs-ID | `nuclear-strike` (Kategorie `global-perk`, Perk `nuclear-strike`); die Forschung gibt die erste Ladung |
| Einsatz | nur während einer Welle; außerhalb lehnt der Manager mit `no-wave` ab |
| Nachladen | die Welle des Einsatzes zählt mit (Einsatz in W12, wieder bereit ab W15); solange die Ladung steht, sammeln Wellen nichts an |
| Ladung | wird mit dem Befehl verbraucht. Stirbt der Rest der Welle in den 1,5 s, trifft der Einschlag niemanden |
| Bosse | `isBoss` nur bei Herbert. Golem und Drache kommen auch in normalen Wellen vor, das Flag gilt pro Typ |
| Name im Spiel | "Nuclear Strike" (Knopf mit Symbol, Tooltip, Forschung) |
| Leck-Buchung im Training | das Backend-Gate zählt die Fähigkeits-Kills genauso (`gate_leak_share`), der Reward nicht |
| Bots | Strategie ab 10 Gegnern mit Pfadfortschritt ab 0,8. In allen Skill-Stufen eingehängt, erforscht wird die Fähigkeit nur von strategist und meta. Deren Baselines sind mit Läufen vor der Umsetzung nicht direkt vergleichbar, beginner und casual spielen unverändert |

Taste K schaltet den Zielmodus wie der Knopf. Nicht gebaut: Warnsirene, weitere Fähigkeiten, Pickups.
