# Welten: Lauf, Continue, Recent (Plan)

Stand 2026-10-16. Grundlage: Punkte 7 bis 12 des Users (`tmp/plan/PUNKTE_2026-10-16.md`), gebaut ist
[WORLDS_NAVIGATION_PLAN.md](WORLDS_NAVIGATION_PLAN.md) Phasen 1 bis 7. Klick-Dummy:
`tmp/plan/mockups/world-state/index.html`. Gebaut am 2026-10-16 (Abschnitt 7); Abschnitt 2 beschreibt den Stand davor.

## 1. Grundsatz

Entschieden (User, 2026-10-16):

- Jede Welt (Real places, OpenStreetMap, Built Worlds) hat ihr **eigenes Recent** und ihr **eigenes Continue**.
- Der **Editor macht aus allem eine Built World**: einen echten Ort über „Make a map of this place“, eine
  OSM-Erzeugung, sobald sie im Editor angepasst wurde.
- Die Welt „Maps“ heißt **Built Worlds**.
- Unbearbeitete OSM-Erzeugungen stehen als **Recent worlds** in der OSM-Welt; erst eine im Editor angepasste steht
  unter Built Worlds, mit dem Abzeichen „from OpenStreetMap“.
- „Back to <Ort>“ **ohne Abbau**: die Welt bleibt geladen, bis etwas anderes startet (Punkt 7).

## 2. Bestand (Inventur, 2026-10-16)

Belegt aus Code und Specs (Stand `next` ad99b222c); jede Aussage nennt die Stelle.

### 2.1 Was es heute gibt

| Ding | entsteht | zeigt sich | geht weg |
|---|---|---|---|
| **Autosave Echtwelt** (`autosave`) | nach jeder Welle, sobald die Simulation steht (`SaveGameService.autosaveWhenQuiet`); beim Öffnen des Editors zwischen den Wellen (`autosaveNow`). Nicht im Coop, nicht im Probespiel, nicht im Replay, nicht nach Game over, nicht in DevWorld | Globen: Continue oben links, Zeile unter dem Globus, Chip oben; Weltmenü: Continue-Zeile; Start am selben Ort wird „Continue“; Startort-Raten der Fassade (`guessStartPlace`); altes Startmenü im Spiel (`autosaveOffer`, Reiter Real places) | **nie von selbst und nie per Knopf**: Load-Seite zeigt beim Autosave kein Delete (`save-slots.component.html` `@if (!row.autosave)`). Nur ein späterer Autosave derselben Welt überschreibt ihn, also frühestens nach der ersten Welle eines neuen Laufs |
| **Autosave Karten** (`autosave-map`) | wie oben auf jeder Custom Map; OSM-Karten und alle anderen Karten **teilen** ihn (`autosaveSlotOf`) | wie oben; die Welt wird aus der Kartenliste geraten (`worldOfMap` über `MapSummary.osm`), das Pausemenü rät anders (`worldOfPage` über `doc.meta.source`) | wie oben; zusätzlich verdrängt ein Lauf der anderen Kartenwelt ihn nach seiner ersten Welle (OSM verdrängt Maps und umgekehrt) |
| **Manuelle Slots** `slot-1` bis `slot-5` | Save game im Pausemenü, zwischen den Wellen, allein | Load game (Globen: alle Slots; im Spiel: nach dem alten Reiter gefiltert, `loadableSlots`) | Delete auf der Load-Seite |
| **Wartender Lauf** (`AppScreen.waitingRun`) | Edit this map, Map editor, Edit im Pfad mit Lauf: Autosave jetzt, sonst der vom Anfang der Welle | nur im Editor: Chip „Demo Valley \| wave 2 \| autosave“, „Back to the run“ | jede andere Welt, die öffnet (`openHere`); Neuladen (nur im Speicher). Auf den Globen nicht zu sehen (`worlds-stage.component.html` zeigt nur `stage.autosaves()`) |
| **Editor-Entwurf** (`AppScreen.draft`) | Karte im Editor offen | nur im Spiel: Chip „Editor: Karte“ | Editor schließt die Karte. Auf den Globen kein Chip |
| **Recent places** (`td_recent_locations_v1`, 8) | sobald ein echter Ort **spielbar** steht (HQ, Spawns, Routen, `recentCandidate`), auch ohne gespielte Welle; auch als Coop-Gast | Real places › Recent; altes New game im Spiel › Recent | nur durch Verdrängen (9. Eintrag). Kein Entfernen, kein Ausschalten. Ein Ort ohne Straßen (Overpass weg) kommt nie hinein |
| **Favorites** | Stern in der Kopfzeile | Real places › Favorites | Stern wieder aus |
| **OSM-Karte** | „Make the map“ im OSM-Rahmen **speichert sofort** als eigene Karte (`osm-frame.component.ts`: `store.save(made.doc, null, made.file)`) | OpenStreetMap › „Your OpenStreetMap maps“ und zugleich Maps › „Your maps“ mit Etikett OSM (`world-osm.component.ts` `mine`, `world-maps.component.ts` Etikett OSM) | nur im Map-Browser des Editors (Papierkorb). Jede Erzeugung bleibt, auch dieselbe Stelle mehrfach |
| **Kopie einer mitgelieferten Karte** | „Edit“ / „Edit this map“ auf einer mitgelieferten Karte legt beim Öffnen sofort „Demo Valley (copy)“ an, auch ohne Änderung (`WorldChoiceService.editMap` → Editor, Hinweis „Opens as your copy“ in `world-maps.component.ts`) | Maps › Your maps | Editor, Papierkorb |
| **Zuletzt gespielte Welt** (`td_last_world_v1`) | jeder Start über die Globen (`WorldsStageService.open`); nicht beim Laden eines Slots aus dem Spiel (`WorldChoiceService.openSave`) | großer Globus (`heroWorld`), auch ohne Continue | nie |
| **Wahl je Welt** (`picks`) | Zeile im Weltmenü, Link, Verlassen des Spiels | Weltmenü, Pfad, Marke auf dem Globus | Neuladen (nicht gespeichert) |
| **Geladene Welt** | Start | Spiel | „Worlds“ / „All worlds“ baut sofort ab (`WorldSession.close`), auch ohne Lauf (`MainMenuService.leaveTo`, `tower-defense.component.ts` `onPath` ohne `underWay`): kein Weg zurück außer neu starten |

### 2.2 Je Welt

- **Real places:** eigener Autosave, eigenes Recent (Orte), Favorites, Showcase. „Make map“ im Pfad des Spiels öffnet
  das **alte New-game-Fenster** (Reiter Real places / Maps, 3D city / Map from OpenStreetMap, eigenes Recent und
  Showcase; `tower-defense.component.ts` `editFromPath` → `mainMenu.open('new-game')`), nicht den OSM-Rahmen der Globen. Ohne Lauf führt „Worlds“ zu den Globen, die Welt ist weg; die
  Wahl steht noch im Weltmenü, also ist Start dort der einzige Rückweg (mit neuem Laden).
- **OpenStreetMap:** kein eigenes Recent, kein eigener Autosave (geteilt mit Maps). Jede Erzeugung ist sofort eine
  eigene Karte und steht doppelt (OSM und Maps). Ohne Vorschaubild (siehe 2.4).
- **Maps:** kein Recent. Mitgelieferte, eigene, von Coop-Hosts. Der Pfad im Spiel nennt auch eine OSM-Karte „Maps“
  (`worldName`).

### 2.3 Die schlimmsten Ungereimtheiten

1. **Die Globen sehen frische Autosaves nicht.** `WorldsStageService.saves` liest die Slots nur beim ersten Aufbau
   und wenn die Load-Seite öffnet. Ein Lauf, der im Spiel einen Autosave schrieb, fehlt nach „All worlds“ auf den
   Globen: kein Continue, kein Chip, keine Zeile, obwohl die Slots ihn haben (`refresh` nur im Konstruktor von
   `WorldsStageService` und von `SaveSlotsComponent`; `StageSaves` ist ein eigener `SaveGame` neben dem des Spiels).
   Nach Neuladen oder nach einmal Load game ist er da. Für den Spieler tauchen Continues scheinbar zufällig auf und ab.
2. **Continue lässt sich nicht loswerden.** Kein Delete für Autosaves; Game over lässt ihn stehen (der Lauf vor der
   verlorenen Welle wird weiter angeboten); „Start anyway“ ersetzt ihn erst nach der ersten fertigen Welle, wer vorher
   geht, hat den alten wieder.
3. **Ein Autosave für zwei Welten.** OSM und Maps teilen `autosave-map`: ein OSM-Lauf löscht das Continue unter Maps
   nach seiner ersten Welle, und die Rückfrage sagt es nur halb („Maps and OpenStreetMap share one autosave“).
4. **Drei Chip-Quellen.** Globen: nur Autosaves (veraltet, siehe 1). Spiel: nur der Editor-Entwurf. Editor: nur der
   wartende Lauf (nur im Speicher, nach Neuladen weg). Derselbe Lauf heißt je Ort anders oder fehlt.
5. **Alte Menüs leben weiter.** Im Spiel stehen das Startmenü mit den Reitern „Real places / Custom maps“ samt eigenem
   Continue (`autosaveOffer`) und das New-game-Fenster mit eigenem Recent. Das Probespiel des Editors (Test map) öffnet
   mit diesem alten Startmenü, weil sein Startauftrag kein `play` trägt (`EditorSession.trial`): dort steht
   „Continue in Demo Valley | wave 2“, das Continue einer anderen Karte, mitten im Probespiel (`menu-home.component.ts`: `autosaveOffer` im Start-Layer; `automated` gilt nur für den Bot-Check).
6. **Abbau ohne Rückweg** (Punkt 7): „Worlds“ ohne Lauf baut die Welt sofort ab.
7. **Zwei Regeln für die Welt einer Karte:** Globen nach `MapSummary.osm`, Pausemenü nach `doc.meta.source`. Eine
   ältere OSM-Karte ohne `osm` in der Zusammenfassung steht auf den Globen unter Maps, ihr Pausemenü sagt
   „OpenStreetMap“; ihr Autosave landet im Continue von Maps.
8. **Recent heißt „geladen“, nicht „gespielt“**, und eine Karte hat gar keins.

### 2.4 Punkt 9: Vorschaubilder der Karten

Ursache: Das Weltmenü der Karten (`worlds/world-maps.component.ts`) zeigt nur Name und Spawns. Die Bilder sind da:
`WorldChoiceService.listMaps` liefert sie, `WorldsStageService.refreshMaps` legt sie in `StageMap.picture` (mitgelieferte über
`shippedPreviewUrl`, `public/maps/*.png`), aber kein Template nutzt das Feld. Die Kartenwahl davor
(`map-picker.component.html`, `mk-thumb`, im Spiel unter New game › Maps noch erreichbar) zeigte sie; der Entwurf
`proposal.html` hatte keine, also fielen sie beim Bau von Phase 6 weg. Der Kartenglobus zeichnet Türme, keine Bilder.
Dazu: OSM-Karten haben gar kein Bild, weil „Make the map“ ohne Vorschau speichert (`store.save(..., null, ...)`);
eins entsteht erst beim Speichern im Editor. Beim Einbauen beachten: `listMaps` gibt die Objekt-URLs der vorigen
Liste frei, ein zweiter Aufrufer (New game im Spiel) entwertet die Bilder der Globen.

## 3. Zielmodell

### 3.1 Begriffe

- **Welt:** Real places, OpenStreetMap, Built Worlds.
- **Lauf:** ein Spiel von Welle 1 bis Game over auf einem Ort oder einer Karte. Höchstens **ein Lauf je Welt** ist
  aufgehoben.
- **Continue (je Welt):** der aufgehobene Lauf dieser Welt. Er ist entweder **geladen** (die Welt steht noch im
  Speicher, Rückkehr sofort) oder **gespeichert** (Autosave, Rückkehr lädt). Der Spieler sieht in beiden Fällen
  dasselbe „Continue“, nur die Unterzeile sagt „ready“ statt einer Ladezeit.
- **Geladen ohne Lauf:** eine gestartete Welt, in der noch nichts gebaut und keine Welle lief. Sie heißt
  „**Back to <Ort>**“ und hat keinen Autosave. Höchstens **eine Welt** ist geladen, quer über alle drei.
- **Recent (je Welt):** was in dieser Welt zuletzt gespielt wurde, neueste zuerst. Real places: Orte (wie heute, 8).
  OpenStreetMap: die unbearbeiteten Erzeugungen („Recent worlds“). Built Worlds: zuletzt gespielte Karten.
- **Built World:** eine Karte, die es als Datei gibt: mitgeliefert, von einem Coop-Host, oder eigene (im Editor neu,
  Kopie, aus einem echten Ort, bearbeitete OSM-Erzeugung).
- **Entwurf:** die Karte, die im Editor offen ist. Sie gehört immer zu Built Worlds.

### 3.2 Zustände je Welt

Jede Welt hat genau einen von vier Zuständen, dazu ihr Recent:

| Zustand | heißt | wird zu |
|---|---|---|
| leer | nichts | „geladen ohne Lauf“ (Start), „Lauf geladen“ (Load) |
| geladen ohne Lauf | Back to <Ort> | leer, sobald etwas anderes startet oder die Seite neu lädt; „Lauf geladen“ mit der ersten Welle oder dem ersten Turm |
| Lauf geladen | Continue <Ort> \| wave N \| ready | „Lauf gespeichert“, sobald etwas anderes startet (Autosave wie heute); leer bei Game over oder Wegwerfen |
| Lauf gespeichert | Continue <Ort> \| wave N | „Lauf geladen“ mit Continue; leer bei Wegwerfen, Game over nach Continue, oder neuem Lauf dieser Welt (mit Rückfrage) |

Regeln:

1. Ein Lauf gehört zu der Welt, in der er begann, bis er endet (auch wenn seine OSM-Karte unterdessen im Editor
   bearbeitet wird, siehe Frage 7).
2. Ein neuer Lauf in einer Welt mit Continue fragt beim **Start**: „End <alter Lauf> and start <neu>“, „Continue
   <alt>“, „Cancel“. Mit Ja ist der alte sofort weg (nicht erst nach der ersten Welle).
3. Etwas anderes starten (andere Welt, Editor, Coop-Beitritt, Probespiel) baut die geladene Welt ab; ihr Lauf bleibt
   als gespeichertes Continue, „Back to“ ohne Lauf verfällt still.
4. Blättern beendet nichts: Globen, Weltmenüs, Overlays, Load-Liste ansehen.
5. Recent bekommt einen Eintrag, wenn ein Lauf in dieser Welt **beginnt** (erste Welle oder erster Turm), nicht schon
   beim Laden. Ausnahme OpenStreetMap: dort ist die Erzeugung selbst der Eintrag.

### 3.3 Wo was steht

Eine Quelle für alles (heute drei): die Liste der Continues und „Back to“ je Welt, der Entwurf, der Coop-Raum.

| Ort | Continue / Back to | Recent | Chips oben |
|---|---|---|---|
| Globen | Menü links oben: je Welt mit Continue ein Eintrag, neuester zuerst; Zeile unter dem Globus | nein | alle Continues und Back to, Entwurf, Coop-Raum |
| Weltmenü | erste Zeile: Continue dieser Welt mit „Discard“; Detail: Start wird Continue, wenn die Wahl der Lauf ist | ja, eigener Reiter oder Abschnitt, Zeilen mit Entfernen | wie Globen |
| Spiel | Pausemenü: „Continue“ (zurück ins Spiel), „World menu“, „All worlds“ ohne Rückfrage (es endet nichts) | nein | Continues der **anderen** Welten, Entwurf, Raum |
| Editor | „Back to the run“, wenn ein Lauf von hier aus wartet | Kartenliste (Built Worlds) | Continues aller Welten, Raum entfällt (Editor verlässt den Raum) |
| Probespiel | keins: Pausemenü „Back to the editor“, „Again from wave N“ | nein | kein Chip für das Probespiel selbst (es zählt nicht), die anderen wie im Spiel |
| Load game | Autosaves als Zeilen „Autosave · Real places“, mit Delete | nein | |

Ein Chip und ein Continue-Eintrag sind dasselbe Ding: Klick setzt fort, die Unterzeile sagt „ready“ (geladen) oder
„wave N“ (lädt). Ein gesperrter (kein Key, Coop) bleibt sichtbar mit Grund.

### 3.4 Loswerden (Punkt 8)

- **Discard** an der Continue-Zeile im Weltmenü und als Delete in Load game, mit Rückfrage: „Discard Heilbronn | wave
  12? It cannot be continued.“ Danach ist die Welt leer; ist der Lauf gerade geladen, geht die Welt mit.
- **Game over** leert das Continue (Frage 1). Restart startet einen neuen Lauf am selben Ort.
- **Neuer Lauf** in derselben Welt: Rückfrage beim Start, dann sofort weg (Regel 2).
- **Recent:** jede Zeile hat Entfernen. In OpenStreetMap löscht das die Erzeugung mit (Frage 4), außer ein Continue
  spielt noch auf ihr.
- **Back to** braucht kein Wegwerfen: es verfällt, sobald etwas anderes startet.

### 3.5 Übergänge

- **Neuladen:** alles Geladene ist weg (Back to verfällt, ein geladener Lauf ist sein Autosave). Die Seite startet auf
  den Globen mit den gespeicherten Continues; der Entwurf öffnet wie heute aus `sessionStorage`. Die Wahl je Welt
  geht verloren wie heute (Frage 9).
- **Editor:** öffnet wie heute (Entscheidung 2 der Navigation): ein Lauf geht als Autosave seiner Welt, „Back to the
  run“ lädt ihn. Neu: derselbe Lauf steht auch auf den Globen als Continue und Chip, weil es nur noch eine Quelle gibt.
  Eine mitgelieferte oder Coop-Karte wird erst bei der ersten Änderung zur eigenen Kopie (Frage 8). Eine
  OSM-Erzeugung wird mit dem ersten Speichern mit Änderung zur Built World (Frage 5) und verlässt Recent worlds.
- **Probespiel:** nie Continue, nie Recent, kein Autosave (wie heute). Es startet mit `play`, also ohne das alte
  Startmenü; der Pfad sagt „› Trial“.
- **Load game:** ein Slot ist ein Start in seiner Welt: gleiche Rückfrage wie Regel 2, danach ist er der geladene
  Lauf dieser Welt und schreibt ihr Continue mit der nächsten Welle. Aus einer Datei: die Welt der Datei.
- **Coop:** kein Autosave im Raum (wie heute). Beitritt baut die geladene Welt ab (Regel 3; mit Lauf fragt er).
  Ein Ort des Hosts kommt beim Gast in Recent (Real places), eine Karte des Hosts unter Built Worlds › From coop
  hosts. Verlassen des Raums lässt nichts zurück.
- **Game over:** Continue leer, die Welt bleibt geladen bis zum nächsten Start (Restart, Replay, Edit gehen dort).
- **Kein Key:** Real places grau; ihr Continue bleibt sichtbar, gesperrt mit „Needs a map key“ und dem Weg zum Key.

### 3.6 Built Worlds und OpenStreetMap

- Umbenennen: `WORLD_NAMES.maps` „Built Worlds“, `worldName` im Pfad, Pausemenü „World menu · Built Worlds“, Zeile
  unter dem Globus, Editor-Pfad. Die Id `maps` kann bleiben.
- OpenStreetMap: „A map of a real place“ (Suche, Ort aus Real places), darunter **Recent worlds** (unbearbeitete
  Erzeugungen, höchstens 10, Frage 3), mit Vorschaubild. Play, Edit, Entfernen.
- Built Worlds: Your built worlds (mit Abzeichen „from OpenStreetMap“ oder „copy of Demo Valley“), From coop hosts,
  Shipped; jede Zeile mit Vorschaubild (Punkt 9), Recent als eigener Abschnitt oben (Frage 6).
- „Make a map of this place“ aus Real places: Rahmen, „Make the map“ legt eine OSM-Erzeugung an (Recent worlds); „Make
  the map and edit“ öffnet den Editor, und mit dem ersten Speichern ist sie eine Built World.
- Die Welt einer Karte entscheidet eine Regel an einer Stelle: unbearbeitete OSM-Erzeugung → OpenStreetMap, sonst
  Built Worlds; gelesen aus der Kartenzusammenfassung (Feld fürs „bearbeitet“, siehe Migration).

### 3.7 Punkt 7: Back to <Ort>

„Worlds“ und „All worlds“ halten die Spielwelt an (Schleife, Sim-Worker pausiert, Canvas verborgen) statt sie
abzubauen; die Globen zeichnen weiter auf ihrem eigenen Canvas. Abgebaut wird erst beim nächsten Start, Editor,
Coop-Beitritt oder Probespiel. Kosten: zwei WebGL-Kontexte (Globen und Spiel) und der GPU-Speicher der Welt, solange
die Globen stehen; Phase 2 der Navigation hat den Abbau sauber gemacht, das Halten ist neu (Frage 10). Ohne das
Halten bleibt als Rückfall ein „Back to <Ort>“, das die Welt neu lädt.

## 4. Migration der heutigen Slots

- `autosave` → Continue Real places (Slot bleibt `autosave`, oder Umbenennen in `autosave-real`).
- `autosave-map` → Continue OpenStreetMap, wenn seine Karte eine OSM-Erzeugung ist, sonst Built Worlds; Karte nicht
  mehr da → Built Worlds (Continue zeigt den Grund, Discard geht). Neue Slots: `autosave-osm`, `autosave-built`.
- Manuelle Slots bleiben; Load game zeigt ihre Welt dazu.
- Recent places bleiben (`td_recent_locations_v1`). Ein Eintrag aus „nur geladen“ lässt sich nicht von „gespielt“
  unterscheiden; sie bleiben.
- Vorhandene OSM-Karten: ob sie bearbeitet wurden, weiß heute niemand (Frage 5 und 6). Neues Feld in der
  Kartenzusammenfassung, z. B. `generated: true` bis zum ersten Speichern mit Änderung.
- `td_last_world_v1` bleibt; der große Globus folgt künftig dem neuesten Continue, sonst der letzten Welt.

## 5. Entscheidungen

Entschieden (User, 2026-10-16): alle zwölf Empfehlungen unten übernommen.


1. **Soll ein verlorener Lauf (Game over) sein Continue verlieren?** Empfehlung: ja. Heute bietet der Globus danach
   den Stand vor der verlorenen Welle an, das liest sich wie ein Fehler; Restart und Replay bleiben im Game over.
2. **Wann verschwindet das alte Continue, wenn man in derselben Welt etwas Neues startet?** Empfehlung: gleich beim
   Start, nach der Rückfrage. Heute erst nach der ersten Welle des neuen Laufs.
3. **Wie viele unbearbeitete OSM-Karten soll „Recent worlds“ halten?** Empfehlung: 10.
4. **Was passiert mit einer OSM-Erzeugung, die aus „Recent worlds“ fällt oder entfernt wird?** Empfehlung: sie kommt
   in den Papierkorb des Editors (wie eine gelöschte Karte), außer ein Continue spielt noch auf ihr.
5. **Ab wann zählt eine OSM-Karte als bearbeitet und zieht nach Built Worlds?** Empfehlung: beim ersten Speichern im
   Editor, das etwas ändert; bloßes Öffnen zählt nicht.
6. **Wohin mit den OSM-Karten, die es heute schon gibt?** Empfehlung: nach Built Worlds mit „from OpenStreetMap“,
   weil niemand weiß, ob sie bearbeitet wurden.
7. **Ein Lauf wartet auf einer OSM-Karte, die dann im Editor bearbeitet wird: wem gehört sein Continue?** Empfehlung:
   weiter OpenStreetMap, bis der Lauf endet (ein Lauf bleibt in seiner Welt). Ob ein Spielstand nach einer
   Kartenänderung überhaupt noch lädt, ist nicht geprüft und gehört vor dem Bau getestet.
8. **Soll „Edit“ auf einer mitgelieferten Karte die eigene Kopie erst bei der ersten Änderung anlegen?** Empfehlung:
   ja. Heute legt schon das Öffnen „Demo Valley (copy)“ an.
9. **Soll die Wahl in jedem Weltmenü ein Neuladen überstehen?** Empfehlung: ja, je Welt die letzte Wahl merken; dann
   steht nach dem Neuladen derselbe Ort oder dieselbe Karte bereit.
10. **Soll „All worlds“ die Spielwelt im Speicher halten (sofort zurück) statt sie abzubauen?** Empfehlung: ja, eine
    Welt zur Zeit, abgebaut beim nächsten Start; Speicher und GPU vorher messen wie in Phase 2.
11. **Soll Built Worlds ein eigenes Recent zeigen (zuletzt gespielte Karten)?** Empfehlung: ja, als kurzer Abschnitt
    oben (5 Karten), weil die Liste mit eigenen und mitgelieferten Karten lang wird.
12. **Soll Recent places nur gespielte Orte führen (erste Welle oder erster Turm) statt jeden geladenen?**
    Empfehlung: ja, dann deckt sich Recent mit dem, was der Spieler als „gespielt“ erinnert.

## 6. Was beim Bau mitgeht

- Eine Quelle für Continues, Back to, Entwurf und Raum (root), die Globen, Spiel und Editor gleich lesen; sie liest
  die Slots nach jedem Schreiben und Löschen neu (behebt 2.3 Punkt 1).
- Das alte Startmenü mit Reitern und das New-game-Fenster im Spiel fallen weg (keine zwei Systeme); Ort- und
  Kartenwahl gehen über die Weltmenüs.
- Probespiel mit `play` im Startauftrag.
- Vorschaubilder in den Kartenlisten; „Make the map“ speichert eine Vorschau.

## 7. Gebaut (2026-10-16)

- **Ein Continue je Welt:** Slots `autosave` (Real places), `autosave-osm`, `autosave-built`
  (`AUTOSAVE_SLOTS`, `autosaveSlotOf`); jeder Slot trägt seine Welt (`StoredSlotMeta.world`, `SaveSlotInfo.world`).
  Die Welt einer Karte entscheidet `worldOfMap`: `MapMeta.generated` (gesetzt von `import-osm.ts`, auch in der
  Zusammenfassung) heißt OpenStreetMap, sonst Built Worlds; Globen, Pausemenü und Autosave lesen dieselbe Regel
  (`world/world-of-page.ts`). Ein aus einem Autosave geladener Lauf schreibt weiter in dessen Slot, bis Restart
  (`SaveGamePort.newRun`).
- **Migration:** `WatchedSlotStore` (`SAVE_SLOT_STORE`, root) verschiebt `autosave-map` vor der ersten Liste nach
  `autosave-built`. Vorhandene OSM-Karten haben kein `generated` und stehen unter Built Worlds (Frage 6).
- **Live:** Spiel und Globen teilen den Slot-Speicher; jedes Schreiben und Löschen geht an die Beobachter (`watch`),
  die Globen lesen sofort neu.
- **Loswerden:** Discard an der ersten Zeile jedes Weltmenüs (`app-stage-continue`), Delete für Autosaves auf der
  Load-Seite, Game over löscht den Autosave des Laufs (`SaveGameService.dropContinue`), Start oder Load an anderer
  Stelle der Welt fragt und beendet den alten Lauf sofort. Load game im Spiel fragt nach derselben Regel wie auf den
  Globen (`WorldsStageService.loadAsk`, „End it and load“ auf der Load-Seite), auch für einen Slot einer anderen Welt;
  Laden aus einer Datei fragt nur nach dem Lauf hier (die Welt der Datei steht erst nach dem Lesen fest).
- **Recent:** Real places nur gespielte Orte (`recentCandidate` wartet auf Welle oder Turm), Entfernen je Zeile;
  OpenStreetMap „Recent worlds“ = Karten mit `generated`, höchstens 10, ältere in den Papierkorb (`overflowWorlds`,
  `WorldChoiceService.trashMap`); Built Worlds mit Recent (5, `td_recent_maps_v1`, aufgezeichnet von
  `MainMenuService`), eigenen Karten mit Abzeichen (from OpenStreetMap, copy of …), Coop, mitgelieferten.
  Jede Kartenzeile mit Bild; „Make the map“ speichert eine Skizze (`map-sketch.ts`: Relief, Wasser, Wege).
- **Editor:** eine mitgelieferte oder Coop-Karte öffnet wie sie ist, die erste Speicherung mit Änderung legt die
  Kopie an (`MapStore.makeCopy`, Sperre zieht mit); die erste Speicherung mit Änderung nimmt `generated` weg.
- **Halten (Punkt 7):** Worlds, All worlds, World menu und Make map halten das Spiel hinter den Globen
  (`WorldSession.park`, `ParkedWorld`): Spiel verborgen, Bildschleife gestoppt, Pausemenü offen (Pause und Tasten),
  keine Rückfrage beim Verlassen. Continue „ready“ oder „Back to <Ort>“ zeigt es sofort; ein anderer Start, der
  Editor oder ein Coop-Beitritt lässt es gehen (`leaveParked`, Autosave zwischen den Wellen vorher). Das Probespiel
  wird nie gehalten. Der Ton schweigt beim Halten: der Listener der Welt blendet auf 0
  (`SpatialAudioManager.setHeld`; Einzeltöne, Schleifen, Musik, Klangkulisse der Karte laufen alle über ihn), ein noch
  spielendes Hauptthema pausiert (`BackgroundMusicService.holdMainTheme`). Back to stellt beides wieder her; geht die
  gehaltene Welt (`close`, eine andere öffnet), bleibt sie stumm, bis sie abgebaut ist.
- **Spielstand nach Kartenänderung (Frage 7, geprüft):** ein Spielstand trägt die Welt mit dem Inhalts-Hash seiner
  Karte und deren Routen, Zellen und Höhen (Weltpaket). Nach einer Änderung im Editor (eigene Karte, bearbeitete
  OSM-Erzeugung; dieselbe Id, neuer Hash) passen Routen und Höhen nicht mehr zum Boden; geladen wäre der Lauf kaputt
  (Gegner durch neue Wände, Türme in neuen Hindernissen). Darum lädt er nicht: `worldNotHere` sagt „The map … was
  changed since this run was played on it, so the run cannot go on there.“ (vorher „Open that map first“, obwohl sie
  offen war). Die Karte öffnet wie sie jetzt ist (auch „Back to the run“, dessen Auftrag keinen Hash mehr trägt;
  vorher scheiterte schon das Öffnen), die Startliste zeigt den Grund mit „Play starts a fresh run here.“ und Play;
  vorher stand „Loading …“ ohne Ende. Der Spielstand bleibt (Discard, oder der nächste Autosave der Welt ersetzt
  ihn). Eine mitgelieferte Karte wird beim Bearbeiten zur Kopie mit eigener Id; ihr Lauf lädt weiter auf dem Original.
- **Chips:** eine Quelle `WorldsStageService.pathChips` für Globen, Spiel und Editor; aus dem Spiel sichert ein Chip
  den Lauf vorher (`MainMenuService.goElsewhere`).
- **Alte Menüs:** Startliste ohne Reiter, New game nur Ortswahl der Welt (ohne Recent), auf einer Karte der Weg zu
  den Welten; die alte Kartenwahl ist entfernt. „Make map“ und die Ortswahl öffnen den OSM-Rahmen der Globen;
  Test map startet mit `play` (Ladezeile, Cancel zurück in den Editor).
- **Wahl je Welt** bleibt über Neuladen (`td_world_picks_v1`).
- **Nachschliff der Abläufe (2026-10-18):**
  - Eine gehaltene Welt, deren Lauf mitten in einer Welle steht, fragt, bevor etwas anderes startet (Start einer
    anderen Welt, Load, Map editor, Edit, New map, Coop-Beitritt; `WorldsStageService.leavingHeld`): „Go on“ behält
    den Autosave vom Wellenanfang oder beendet den Lauf ohne einen, „Back to <Ort>“, „Cancel“. Was beim Gehen
    bleibt, steht beim Halten fest (`ParkedWorld.keeps`, dieselbe Regel wie beim Editor, `runWhenEditing`); zwischen
    den Wellen bleibt der Lauf als Autosave ohne Frage. Ein Chip einer anderen Welt hält das Spiel erst hinter den
    Globen (`MainMenuService.goElsewhere`), die Frage kommt dann dort; im Coop-Raum öffnet er das Menü mit Grund.
  - Die Startliste einer sofort geöffneten Welt (Einladung, Code, Spielstand) hat World menu und All worlds; eine
    Welt, die nie steht (Relay antwortet nicht), war vorher eine Sackgasse. Sie wird dabei nicht gehalten.
  - Ohne Map-Key führt der Key-Dialog im Spiel „Back to the worlds“ (Esc) zurück zu den Globen, die Welt geht; vorher
    hielt er fest. Auf den Globen öffnet „Play the maps“ das Weltmenü von Built Worlds mit gewählter Karte, statt
    an Weltmenü und Rückfrage vorbei zu laden.
  - Ein Lauf hat überall dieselbe Wellenzahl: zwischen den Wellen die nächste (`MainMenuService.runWave`, wie Chip,
    Continue und Spielstand); vorher sagte der Kopf des Pausemenüs eine weniger.
  - Nach Game over: Kopf „Game over“, Save game gesperrt mit „The run is over“, die gehaltene Welt sagt „Still
    loaded, the run is over“ (`ParkedWorld.over`); Knöpfe „All worlds“ und „Edit this map“ wie im Pausemenü.
  - Load im Spiel eines Spielstands auf derselben Karte fragt „The run under way ends“ statt „… waits in Built
    Worlds“ (`MainMenuService.loadAsk`).
  - Ein Weltmenü zeigt sein eigenes Continue nur als erste Zeile, nicht noch als Chip; es nimmt beim Öffnen den
    Fokus auf den ersten Eintrag, Esc gibt ihn an seinen Globus zurück.
  - OSM-Rahmen auf den Globen mit einem Back (Kopf, Esc); aus dem Spiel („Make map“) führt Back zurück ins Spiel.
    Fertig heißt die Karte „one of your Recent worlds“. Load from a file auf den Globen ist gesperrt und sagt
    vorher warum (`SaveGamePort.cannotImportReason`).
  - Browser-Zurück geht eine Ebene hoch wie Esc (`world/browser-back.service.ts`): Ansichten melden ihren Schritt
    an (Globen: Esc-Kette; Spiel: Dialog, Menüseite, Menü öffnen, dann ins Weltmenü, das Spiel gehalten; Editor:
    Liste bzw. aus dem Editor), die zuletzt gezeigte zuerst; ein Verlaufseintrag steht über dem der Seite. Erst auf
    den Globen ohne offenes Menü verlässt Zurück die Seite. Im Coop-Raum bleibt es beim Menü mit Grund.
  - Begriffe: „All worlds“ ist überall der Weg zu den Globen (auch nach Game over), „World menu“ nur, wo die Seite
    eine Welt hat (nicht in Dev world); kein New game auf Karten; „Dev world“ im Pfad wie im Ortsnamen; je
    Weltmenü ein Erklärsatz (unten an der Wahl).
  - Probespiel: der Pfad sagt „Trial“ statt „Play“. Editor-Liste: „Open“ auch bei mitgelieferten Karten (die
    Kopie entsteht erst mit der ersten Änderung).
- **Specs:** `worlds/worlds-stage.scenario.spec.ts` (Continue, Discard, live, Start/Load mit Rückfrage, gehaltene
  Welt, Chips, Recent worlds, Built Worlds, Wahl nach Neuladen), `world-rules.spec.ts`, `recent-maps.spec.ts`,
  `save-slot.store.spec.ts` (Migration, Beobachter), `save-game.service.spec.ts` (Game over),
  `location-management.service.spec.ts`, `editor-session.spec.ts` (Kopie, `generated`),
  `world-session.spec.ts` (Halten), `main-menu.scenario.spec.ts`, `menu-new-game.scenario.spec.ts`.

Messung (Dev-Build, Chrome headless mit SwiftShader, Demo Valley, Globus-Stufe Low, nach GC):

| Stand | Heap | lebende WebGL-Kontexte |
|---|---|---|
| Globen | 122,9 MB | 1 |
| Spiel | 263,9 MB | 1 |
| Globen, Spiel gehalten | 273,5 MB | 2 |
| Weiter in einem anderen Lauf (Halten aufgelöst) | 265,6 MB | 1 |

Back to brauchte 447 ms bis das Spiel stand (Klick bis Globen weg). Der Dev-Build taugt für den Heap nur grob
(siehe WORLDS_NAVIGATION_PLAN Phase 2); GPU-Speicher ist nicht gemessen.
