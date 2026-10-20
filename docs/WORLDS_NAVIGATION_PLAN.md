# Welten und Navigation aus einem Guss (Plan)

Status: Phase 1 bis 7 gebaut (Abschnitt 7). Entscheidungen des Users in Abschnitt 6.
Grundlagen: TODO E195, Klick-Dummy `tmp/plan/mockups/world-globes/index.html` (Datenmodell, Regeln, Navigationskarte,
Abgleichsliste „heute vorhanden → im Dummy“), die gewählte Darstellung aus dem Dummy.

Die Welt „Maps“ heißt seit 2026-10-16 **Built Worlds** (Id `maps` bleibt); Lauf, Continue und Recent je Welt regelt
[WORLDS_STATE_PLAN.md](WORLDS_STATE_PLAN.md). Die Abschnitte unten nennen sie noch Maps.

## 1. Ziel und Grundsätze

Hauptmenü, Spiel und Editor sind heute zwei Anwendungen (`/` und `/editor`), verbunden über Seitenwechsel. Ziel ist
eine Anwendung mit drei Welten, in der jeder Wechsel über die Oberfläche geht.

- **Ein Fenster, kein Neuladen, keine URL-Änderung.** Die Desktop-App hat keine Adresszeile; jeder Weg muss eine
  Schaltfläche haben. Links sind nur Einstiege (Abschnitt 3.8).
- **Drei Welten:** Real places (Photorealistic 3D Tiles, braucht einen Map-Key), OpenStreetMap (Karten aus echten
  Straßen, ohne Key), Maps (mitgelieferte, eigene, von Coop-Hosts). Mechanisch dasselbe Spiel; die Welt zeigt sich am
  Globus und am Hintergrund.
- **Start auf den Globen, nichts lädt.** Neuladen und App-Start landen auf den drei Globen statt sofort in der Echtwelt.
  Geladen wird erst mit Start/Play im Weltmenü.
- **Immer sichtbar, wo man ist und was nicht geht.** Kopfzeile mit Pfad (Worlds › Welt › Karte › Play | Edit) und
  Chips für offene Läufe, Editor-Entwurf und Coop-Raum. Ein gesperrter Weg bleibt sichtbar, mit Grund und, wo es einen
  gibt, mit dem Weg zur Abhilfe (etwa „Enter map key“).
- **Viele Wege von überall:** aus dem Spiel in den Editor und zurück in denselben Lauf, aus dem Editor ins Probespiel
  und zurück am selben Stand, aus einem echten Ort eine Karte, Laden quer über die Welten.
- **Esc geht immer eine Ebene zurück** und bricht Laden ab, ohne etwas zu ändern.

Gewählte Darstellung (Dummy-Leiste „Darstellung“): Einstieg Globen, Menü links (Start, Weltmenü, Pause), Startreihe
„letzte Welt groß“, Globus mittel, Hintergrund je Welt, Kopfzeile oben, Dichte großzügig, Weltumschalter als
Mini-Globen, Nachtseite an. Ein feiner Optik-Vorschlag dazu (`proposal.html`) entsteht getrennt; dieser Plan legt
Abläufe und Technik fest, nicht Pixel.

## 2. Bestand

### 2.1 Wege und ihr Verhalten

„Neu laden“ heißt: `window.location.assign/href/reload`, die ganze App startet neu (Engine, Worker, Tiles, Stores).

| Weg heute | Code | Verhalten |
|---|---|---|
| App-Start ohne Link | `tower-defense.component.ts` `startGameSequence` (Menü öffnen, dann `facade.startGame`) | Startmenü vor dem geratenen Ort, Tiles laden sofort (Bruch zum Ziel „nichts lädt“) |
| Startliste Reiter Real places / Custom maps | `main-menu.service.ts` `tab`, `tabsShown`; Continue/Load des anderen Reiters über `needsOtherWorld` | Reiter wechselt ohne Laden; Continue/Load der anderen Welt lädt neu |
| New game › Ort (Suche, Würfel, Recent, Favorites, Showcase, Weltkarte, Lat/Lon) | `place-picker.component.ts`, `location-change-coordinator.service.ts` `moveTo` | **ohne Neuladen**, im selben Engine (auch im Coop-Raum) |
| New game › „A map of a real place“ (OSM-Rahmen), dann Play oder Edit | `menu-new-game.component.ts` `madeMap` → `WorldChoiceService.playMap/editMap` | lädt neu (`?world=map:…` bzw. `/editor?map=…`) |
| New game › Maps (Your maps, From coop hosts, Shipped) | `map-picker.component.ts` → `playMap` | lädt neu |
| New game › Own tilesets | `map-picker.component.ts` → `playTileset` | lädt neu (`?world=tileset:…&l=…`) |
| „Play on real places“ auf einer Karte | `menu-new-game.component.ts` → `playRealPlaces` | lädt neu; Ortsliste fehlt auf Karten ganz |
| Pausemenü › Edit this map | `main-menu.service.ts` `editThisMap` | lädt neu auf `/editor?map=…`, „The run ends“ (`menu-home.component.ts` `confirmText`) |
| Startliste › Map editor | `menu-home.component.ts` `openMapEditor` | lädt neu auf `/editor` |
| Load game, Spielstand einer anderen Welt | `main-menu.service.ts` `loadSlot` → `WorldChoiceService.openSave` | lädt neu mit `?resume=` |
| Map-Key eingegeben, Engine lief schon | `tower-defense.component.ts` `onCredentialsSaved` | lädt neu („the honest way to rebuild the whole tile pipeline“) |
| Token-Dialog „Play the maps“ | `token-setup.component.ts` `playMaps` → `playMap(FIRST_MAP_ID)` | lädt neu |
| Editor › Back to the game | `map-browser.component.ts` `backToGame` | lädt neu auf `/` |
| Editor › Test map, Bot check | `editor-session.service.ts` `testPlay`, `botCheck` | **eigener Tab** `3dtd-map-test` (`map-trial.ts` `MAP_TEST_WINDOW`), dort Neustart der App |
| Test-Tab › Back to editor | `map-trial.ts` `returnToEditor` | holt den Editor-Tab nach vorn, schließt den Test-Tab; sonst lädt neu auf `/editor` |
| Editor-Ansicht verloren | `editor-session.service.ts` `reloadPage` | speichert, lädt neu |
| Extras › Benchmark, Graphics benchmark | `benchmark.service.ts` `start`/`dismiss`, `render-benchmark.service.ts` | lädt neu in DevWorld und zurück |
| Extras › Replay „Go to … and play“ | `replay.service.ts` `playThere` (`WorldPackageLoader.moveTo`) | ohne Neuladen, aber nur auf echten Orten (Ortswechsel) |
| Coop-Beitritt, Host auf echtem Ort | `coop.service.ts` `moveToWorld`; Rückfall `reloadAt` | meist ohne Neuladen; Rückfall lädt neu |
| Coop-Beitritt, Host auf eigener Karte | `coop.service.ts` `openHostMap` → `reloadAtMap` | lädt neu, sobald die Welt nicht passt |
| Desktop: Karte per Doppelklick | `world-choice.service.ts` `playOpenedMaps` → `playMap` | lädt neu |
| Laden fehlgeschlagen | `menu-loading.component.ts` | Retry, sonst Neuladen |
| Links `?l=`, `?world=`, `?room=`, `?resume=`, `?devworld`, `?benchmark`, `?bot=trial`, `?fromWave=` | `url-location.service.ts`, `world-ref.ts`, `world-context.service.ts` `refFromUrl`, `coop.service.ts`, `main-menu.service.ts` `resumeFromLink` | gelesen beim Start; Ortswechsel schreibt `?l=` per `replaceState` (`url-location.service.ts`) |
| Pausemenü (Continue, Save, Load, Settings, Extras, New game, Coop, Restart, Quit) | `menu-home.component.ts` | ohne Neuladen |
| Game over (Restart here, Main menu; Coop: Continue alone, Start over alone) | `tower-defense.component.ts` | ohne Neuladen |

Die Abgleichsliste im Dummy (`CHECK`) führt dieselben Wege mit Ziel im neuen Modell. Gemeinsam: **innerhalb einer
Welt** geht vieles ohne Neuladen (Ortswechsel, Restart, Laden in derselben Welt, Coop auf echten Orten); **jeder
Wechsel der Welt oder zwischen Spiel und Editor lädt neu** oder öffnet einen Tab.

### 2.2 Warum heute neu geladen wird

1. **Die Welt steht ab dem Start fest.** `WorldContext.chosen` wird einmal aus der URL gesetzt (`refFromUrl`) und
   danach nur von `refreshRef` mit derselben Art überschrieben (`world-context.service.ts`). `WorldChoiceService`
   sagt es im Kommentar: „the world is made at the start, not swapped under a running engine“; die Entscheidung steht
   in `docs/WORLD_PROVIDER_PLAN.md` („Welt wechseln heißt neu laden“).
2. **Die URL ist Startkonfiguration.** Rund 25 Dateien lesen `location.search` oder `location.href`, viele beim
   Erzeugen eines Dienstes oder Starts: `main-menu.service.ts` (`automated`, `linkedPlace`, `fromEditor`),
   `benchmark.service.ts` (`requested`), `world-provider-registry.ts` (`?fromWave=`, Spawn-Grenze beim Erzeugen der
   Kartenwelt), `custom-map-world.ts` (Wellenquelle), `tower-defense-facade.service.ts` (Bot, Kartenprobe,
   Startort-Raten), `globe-director.service.ts`, `config.service.ts` (`?nokey`). Ein Weltwechsel ohne Neuladen muss
   diese Werte aus einem Startauftrag lesen statt aus der Adresse.
3. **Abbau ist da, Wiederaufbau im selben Fenster ist ungeprüft.** `TowerDefenseFacadeService.dispose` baut Engine
   (samt Welt), Sim-Worker (`sim.stop()`), Spiegel, Präsentation, LOS und Abos ab und ruft `worldContext.close()`. Es
   läuft heute nur in `ngOnDestroy` der Spielkomponente, ein zweites `startGame` danach gibt es nicht. Die sechs Stores
   sind `providedIn: 'root'` (`store/*.store.ts`) und überleben einen Abbau; zurückgesetzt wird nur, was der
   Ortswechsel und Restart ohnehin zurücksetzen.
4. **Kontextgebundene Einstellungen.** Das MSAA des Spiel-Canvas wird beim Anlegen des WebGL-Kontexts festgelegt und
   hängt von der Welt ab (`engine-initialization.service.ts`: `canvasMsaa(qualityWorldOf(world.ref))`). Ein
   Weltwechsel mit anderer Stufe braucht einen neuen Canvas.
5. **Editor ist eine eigene Route mit eigenem Renderer.** `/editor` lädt `EditorPageComponent` (`app.routes.ts`),
   `EditorSession` ist komponentennah (`@Injectable()` ohne Root), `editor-viewport.ts` legt einen eigenen
   `WebGLRenderer` an. Spiel-Dienste hängen an den Providern der Spielkomponente (`tower-defense.component.ts`
   `providers`, darunter `MainMenuService`, `CoopService`, `SaveGameService`); der Editor sieht sie nicht.
6. **Probespiel braucht eine zweite Spielinstanz.** Der Editor bleibt mit seinem Stand offen, also startet das Spiel
   in einem zweiten Fenster (`openTestWindow`), das die Desktop-App als einzigen eigenen Fensternamen zulässt
   (`desktop/src/security.js` `APP_WINDOW_NAMES`).
7. **Tile-Pipeline nach neuem Key.** `onCredentialsSaved` baut sie per Neuladen neu, statt Engine und Tiles-Renderer
   abzubauen und neu anzulegen.

## 3. Zielmodell

### 3.1 Zustände

Aus dem Dummy (`S.view`, `NODES`):

| Zustand | Inhalt | lädt etwas? |
|---|---|---|
| Globes | drei Globen nebeneinander, darunter Continue, Coop, Load, Map editor, Settings, Extras | nein |
| World menu (je Welt) | Globus groß, Menü links, Weltumschalter (Mini-Globen der zwei anderen); Real places: Reiter Recent, Favorites, Showcase, Search, World map, Own tilesets; OSM: Suche oder Ort aus Real places; Maps: alle Karten mit Herkunft | nein (Tiles-Welt: Globus dreht zum Ort) |
| OSM frame | Rahmen mit HQ und Spawns, dann Play oder Edit; Ergebnis steht auch unter Maps | Overpass beim Erzeugen |
| Loading | Schritte je Welt, Esc bricht ab, Globus taucht am Ende ab | ja |
| Game | Lauf, Kopfzeile oben | |
| Pause menu | Pausemenü wie heute plus Weltmenü, All worlds, Edit this map bzw. Make a map of this place | |
| Game over | Restart, Edit, Weltmenü, Globen, Replay | |
| Editor | im selben Fenster; Kopf mit Kartenliste, Speichern, Probewelle, Test map, Back to the run | Kartendatei |
| Editor: maps | Kartenliste quer über die Welten, New map, aus echtem Ort | nein |
| Trial run | Probespiel der Editor-Karte, ab Welle N | ja |
| Overlays | Settings, Extras, Coop, Load game, Save game, Map key: von überall | |

Im Weltmenü klappt die gewählte Zeile auf: Beschreibung oder Spawns, Start/Play und die übrigen Wege stehen direkt
unter ihr, kein Feld am Ende der Liste (`PickRowsDirective`: Pfeile wechseln Zeile und Wahl, Enter und Doppelklick
spielen, die aufgeklappte Zeile wird ganz ins Bild gescrollt). Eine Wahl, die die Liste gerade nicht zeigt (Suche,
Würfel, anderer Reiter), klappt für sich oben bzw. unter der Suche auf.

Übergänge (Dummy `EDGES`): Globes → World menu (Globus anklicken); World menu → Loading → Game (Start/Play);
Real places → OSM frame („Make a map of this place“, Rahmen vorbelegt); OSM frame → Loading (Play) oder Editor (Edit);
Maps → Editor (Edit); Game → Pause (Esc) → Editor, OSM frame, Globes; Game → Game over → Game (Restart) oder Editor;
Editor ↔ Trial (Test map, Back); Editor → Game (Back to the run), World menu; Editor: maps → OSM frame, Editor.

### 3.2 Gesperrte Wege mit Grund

Zwei Regeln aus dem Dummy, im Code als reine Funktionen (testbar ohne UI):

- `worldLock(w)`: ganze Welt gesperrt: Real places ohne Key „No map key“, OSM und Maps vor der Freigabe „Coming soon“
  (heute `CUSTOM_MAPS_OPEN` in `custom-maps-open.ts`). Der gesperrte Globus ist grau, **bleibt anklickbar** und zeigt
  im Weltmenü Liste und Weltkarte, Start gesperrt mit Grund und Knopf zum Key.
- `whyNot(action, key)` für `play`, `edit`, `save`, `load`, `restart`, `replay`: liefert den Satz, der neben dem
  gesperrten Knopf steht, oder null. Gründe im Dummy: Coop-Gast („In a coop room the host picks the map“, „Leave the
  coop room to edit“, „In coop the host saves“), Probespiel wird nicht gespeichert, kein Lauf zum Speichern, Replay
  erst nach der ersten Welle, fehlender Key, Freigabe.

Ein gesperrter Weg wird nie ausgeblendet. Die Liste der Gründe ersetzt die verstreuten Prüfungen heute
(`canChangePlace`, `canRestart`, `editableMapId`, `tabsShown` in `main-menu.service.ts`).

### 3.3 Esc-Kette

Dummy `goBack`, in dieser Reihenfolge: offene Rückfrage schließen; oberstes Overlay schließen; Laden abbrechen
(„nothing changed“); Popover im Weltmenü schließen; dann je Zustand: Spiel ↔ Pausemenü (Game over: kein Esc, die Wege
stehen unten); Editor: Kartenliste schließen, sonst Editor-Menü; OSM-Rahmen zurück dorthin, woher er kam (Editor, Spiel,
Real places); Weltmenü → Globes; auf Globes passiert nichts. Heute gibt es die Kette nur im Menü (`MainMenuService.back`).

### 3.4 Kopfzeile, Pfad und Chips

Oben, in jedem Zustand außer den Globen: `Worlds › Welt › Karte › [Play | Edit]`, im Probespiel `› Trial`. Jedes
Glied ist ein Knopf. Play/Edit ist ein Umschalter; gesperrt mit Grund als Hinweis. Bei echten Orten heißt Edit „Make
map“ (es gibt nichts zu editieren, es entsteht eine OSM-Karte).
Rechts Chips: jeder offene Lauf („Heilbronn | wave 12 | paused“ oder „| autosave“), der Editor-Entwurf („Editor: Demo
Valley | unsaved“), der Coop-Raum. Ein Chip springt dorthin. Dazu Settings und Menu (Esc).

### 3.5 Lauf beim Weltwechsel (offen)

Zwei Varianten, beide im Dummy umschaltbar (`F.variant`). In beiden gilt: **Blättern beendet nichts**, erst Start,
Laden oder Coop-Beitritt fragt nach („Save and go on“, „End the run“, „Cancel“). Der Editor beendet nie einen Lauf.

| | „Lauf endet“ | „Lauf bleibt pausiert“ |
|---|---|---|
| Regel | ein Lauf zur Zeit; Neues starten beendet ihn | je Welt ein Lauf; nur ein zweiter Lauf derselben Welt beendet den alten |
| Für | einfach zu erklären und zu bauen; ein Autosave-Begriff; nichts Unsichtbares läuft mit | Hin und Her zwischen Welten ohne Verlust; passt zu den zwei Autosaves heute (`AUTOSAVE_SLOT`, `AUTOSAVE_MAP_SLOT` in `save-game.port.ts`) |
| Wider | wer mal kurz eine Karte ansehen will, muss speichern | mehrere Chips; OSM und Maps teilen heute einen Autosave; nur der zuletzt gespielte Lauf liegt im Speicher, die anderen kommen aus dem Autosave (mit Ladezeit, Stand der letzten Welle) |

Technisch ist in beiden Varianten **höchstens ein Lauf im Speicher** (Abschnitt 4.5). „Pausiert“ heißt für jeden
anderen Lauf: Autosave, und Fortsetzen lädt ihn neu in seine Welt. Das muss die Oberfläche sagen (Chip „autosave“
statt „paused“), sonst verspricht sie mehr, als sie hält.

### 3.6 Editor neben pausiertem Lauf

„Edit this map“ im Pausemenü öffnet den Editor im selben Fenster, der Lauf wartet; „Back to the run“ (Kopf, Chip)
kehrt zur selben Welle zurück. Zwei Bauweisen (Entscheidung in Abschnitt 6):

- **Lauf bleibt im Speicher:** Engine-Schleife angehalten, Spiel-Canvas verborgen, Sim-Worker pausiert, Editor mit
  eigenem Renderer daneben. Rückkehr sofort. Kosten: zwei Szenen und zwei WebGL-Kontexte gleichzeitig (Abschnitt 4.6).
- **Lauf geht in den Autosave:** Spielstand schreiben, Spielwelt abbauen, Editor öffnen; zurück lädt den Stand neu.
  Rückkehr mit Ladezeit, Stand am Wellenanfang (gespeichert wird heute zwischen den Wellen, `SaveGameService`).

Empfehlung: zuerst Autosave (nutzt vorhandene Teile, keine doppelte GPU-Last), das Halten im Speicher später, wenn
es sich als nötig zeigt. Auf echten Orten heißt der Weg „Make a map of this place“ und führt in den OSM-Rahmen; der
Lauf wartet ebenso.

### 3.7 Probespiel im selben Fenster

„Test map“ startet ein Probespiel der Editor-Karte ab Welle N (heute `?fromWave=`, `START_WAVE_PARAM`) im selben
Fenster; „Back to the editor“ kehrt **am selben Stand** zurück, ungespeichert eingeschlossen. Das Probespiel wird nie
gespeichert und ist kein Lauf (kein Chip, kein Autosave). Die Bot-Probe (`botCheck`, `?bot=trial`) läuft ebenso im
Fenster; ihr Ergebnis geht direkt an die Editor-Sitzung statt per `postMessage`. Dafür muss der Editor-Stand das
Probespiel überleben: das Kartendokument bleibt im Speicher (`EditorSession` speichert ohnehin vor dem Test), der
Editor-Renderer darf abgebaut und neu angelegt werden (`onContextLost` zeigt, dass der Editor seine Ansicht neu baut).
Der Test-Tab und `returnToEditor` entfallen danach, ebenso der Fenstername in `desktop/src/security.js`.

### 3.8 Links in Browser und Desktop

- **Browser:** Links bleiben Einstiege: `?l=` (Ort), `?world=map:…`, `?world=tileset:…`, `?room=`, `?resume=`.
  Beim Start werden sie einmal zu einem Startauftrag gelesen, danach aus der Adresse entfernt (wie heute `?resume=` in
  `resumeFromLink`). Danach ändert keine Navigation die URL. Offen: ob ein Ortswechsel weiter `?l=` schreibt
  (`UrlLocationService.updateUrl`), damit „Link kopieren“ geht; im Ziel wäre ein Knopf „Copy link“ ehrlicher.
- **Entwicklung:** `?devworld`, `?benchmark`, `?bot=…`, `?tokensetup`, `?nokey` bleiben Startparameter, nicht im
  Menü (Bot-Läufe, E2E). Benchmark aus Extras wechselt im Fenster in DevWorld und zurück an den Ausgangspunkt.
- **Desktop:** keine Adresszeile, also keine Links von außen außer Datei-Doppelklick (`playOpenedMaps`) und
  Einladungen. Beides wird zum Startauftrag im laufenden Fenster (mit der Rückfrage aus 3.5), nicht zum Neuladen.
  Ctrl+R ist abgeschaltet (`desktop/src/shortcuts.js`); Neustart heißt App-Neustart und landet auf den Globen.
- **Neuladen im Browser** landet immer auf den Globen; Continue zeigt den Autosave. Ob der Start direkt in den
  Autosave springt, ist offen (Abschnitt 6).

## 4. Technik

### 4.1 Welt zur Laufzeit wechseln

Ein Dienst `WorldSession` (Name offen) besitzt den Lebenslauf „keine Welt → Welt lädt → Welt steht → Welt baut ab“
und ist der einzige Weg, eine Welt zu öffnen. Nötig:

1. **`WorldContext` wählbar:** `chosen` wird von `WorldSession` gesetzt statt nur aus der URL; `capabilities`, `logos`,
   `coverage`, `runRules` folgen als `computed` schon heute.
2. **Startauftrag statt URL:** ein Objekt `WorldStart` (Welt, Ort, Spawns, Startwelle, Spielstand, Raum, Bot-/
   Benchmark-Flags), beim Boot einmal aus der Adresse gelesen, danach von der Oberfläche erzeugt. Die Stellen aus
   2.2 Punkt 2 lesen ihn. Das ist mechanische, aber breite Arbeit; Specs, die heute `location.search` setzen,
   wandern mit.
3. **Abbau und Wiederaufbau:** `facade.dispose()` und ein zweites `facade.startGame()` auf frischem Canvas
   (Punkt 2.2.4: MSAA) in derselben Seite. Dazu gehört ein vollständiger Reset der Root-Stores
   (`GameStore`, `EngineStore`, `LocationStore`, `ResearchStore`, `DebugStore`, Teile von `UIStore`) und der
   Root-Dienste mit Laufzustand (Ortsliste, Autosave-Wache, Bestwellen, Onboarding). Ein Spec „zweimal starten, zweimal
   abbauen, keine Abos, keine Listener, keine Worker übrig“ ist die Abnahme.
4. **Sim-Worker:** `SimClient.stop()` beendet den Transport, `start()` legt ihn neu an und zählt die Epoche hoch
   (`sim-client.service.ts`); das trägt schon. Der Worker wird je Welt neu erzeugt, nicht wiederverwendet: sauberer
   als ein Reset im Worker.
5. **Tiles-Renderer:** `ThreeTilesEngine.dispose()` gibt Entity-Renderer, TilesRenderer, Pipeline und
   `WebGLRenderer` frei (`docs/ARCHITECTURE.md`, Abschnitt Engine). Zu prüfen: Download-Warteschlangen und
   Parse-Worker der Tiles-Bibliothek, Caches für Modelle und Texturen, die global gehalten werden (Asset-Manager),
   Ion-Session. Ein neuer Key baut damit die Tiles-Welt neu statt die Seite (2.2 Punkt 7).
6. **Kartenwelt:** `CustomMapWorld` liest Startwelle und Spawn-Grenze beim Erzeugen aus der URL
   (`world-provider-registry.ts`); künftig aus dem Startauftrag. Die Karte wird vor dem Erzeugen geöffnet
   (`openCustomMap`, `openedCustomMap`); dieser Zwischenspeicher muss beim Wechsel geleert werden.
7. **Coop:** `reloadAtMap` und `reloadAt` werden zu „Welt wechseln, im Raum bleiben“. Das Protokoll erlaubt das
   schon für Orte (`moveToWorld`); für Karten kommt der Weltwechsel dazu. Raum und Relay-Verbindung dürfen den Abbau
   der Spielwelt nicht mitnehmen (heute verlässt `reloadAtMap` den Raum vor dem Neuladen).

### 4.2 Editor als Teil der App

- Spiel und Editor unter einer Hülle (`AppShell`, Name offen), die Kopfzeile, Overlays (Settings, Coop, Load, Map key)
  und Esc-Kette besitzt. Die Spiel-Provider, die beide brauchen (`MainMenuService` in neuer Form, `SaveGameService`,
  `CoopService` für „Leave the room to edit“), ziehen aus `tower-defense.component.ts` in die Hülle oder nach root.
- Die Route `/editor` bleibt vorerst als Einstieg für Entwicklung und AI-Agenten (`EditorPageComponent.navigator`),
  zeigt aber dieselbe Hülle. `?map=` wird Startauftrag; der Editor ändert die URL nicht mehr (heute
  `router.navigate` in `editor-page.component.ts`, `editor-shell.component.ts`).
- Editor- und Spielansicht schließen sich auf dem Bildschirm aus. Der Editor-Renderer wird beim Verlassen abgebaut,
  das Kartendokument und die Rückgängig-Liste bleiben (Chip „Editor: … | unsaved“).
- `beforeunload` des Editors (`desktop/src/main.js` `will-prevent-unload`) gilt dann nur noch beim Schließen der
  App; Wechsel innerhalb fragen über die eigene Rückfrage („Save the changes to …?“, Dummy `edit`).

### 4.3 Globus-Bühne mit drei Globen

- Wiederverwendung `globe/`: Runtime, Worker und Shader bleiben. Neu ist eine Bühne mit drei Kugeln: Echtwelt wie
  heute (Tag/Nacht, Stadtlichter), OSM schematisch (Straßenraster statt Satellitenbild), Maps comichaft im Stil der
  Engine. Die zwei neuen sind Shader-Varianten derselben Kugel ohne Regionskacheln, Wolken und Streuung.
- **Ein Renderer, ein Canvas** für alle drei (Scissor oder drei Kameras in einer Szene), nicht drei
  `GlobeView`s: jede hat heute einen eigenen `WebGLRenderer` mit `forceContextLoss` beim Abbau
  (`docs/GLOBE_PLAN.md`). Drei Kontexte kosten Aufbau (erster Frame im Hauptthread 110 ms, laut GLOBE_PLAN) und
  zählen gegen die Kontextgrenze des Browsers.
- Auf den Globen lädt **nichts** aus der Spielwelt. Heute startet die Engine hinter dem Menü sofort
  (`startGameSequence`); künftig erst mit Start im Weltmenü. Der Abtauchflug (`dive-flight.service.ts`,
  `GlobeDirector`) bleibt für Real places; die anderen Welten blenden über.
- Hintergrund je Welt (Sterne, Papierraster, grüne Tiefe) ist CSS/Canvas 2D, ohne WebGL.
- Settings › Graphics › „Menu globe“ (High, Low, Off) gilt für alle drei; Off zeigt statische Bilder.

### 4.4 Ladeansicht

Eine Ladeansicht für alle Welten, Schritte je Welt (Dummy `stepsFor`), Esc bricht ab und lässt den vorherigen
Zustand stehen. Für die Tiles-Welt sind das die heutigen Schritte (`engine-initialization.service.ts`
`resetLoadingSteps`); ein Abbruch mitten im Aufbau braucht dieselbe Abbau-Sicherheit wie 4.1 Punkt 3 (heute gibt es
„dispose während attach“ als behobenen Befund, `docs/WORLD_PROVIDER_PLAN.md`).

### 4.5 Speicher und GPU

- Eine Tiles-Szene lädt rund 110 MiB je Ort (Messung in `docs/GLOBE_PLAN.md`), die Kugel High etwa 80 MB GPU,
  nach der Landung frei. Zwei Spielwelten gleichzeitig sind nicht vorgesehen: **höchstens eine Spielwelt, ein
  Sim-Worker, ein Spiel-Canvas zur Zeit.**
- Gleichzeitig erlaubt: Globus-Bühne oder Spielwelt (nicht beides auf voller Last; im Spiel ruht die Bühne wie heute),
  Editor oder Spielwelt im Vordergrund. Der Fall „Lauf im Speicher plus Editor“ (3.6, erste Bauweise) wäre der einzige
  mit zwei großen Szenen; er braucht eine Messung vor dem Bau.
- Nach jedem Weltwechsel muss der Speicher zurückgehen. Prüfung per Chrome-Trace oder `performance.memory` über zehn
  Wechsel; ein Leck zeigt sich als Treppe.

### 4.6 Risiken

1. **Unvollständiger Abbau.** Bisher räumt das Neuladen alles weg, was ein `dispose` vergisst: Abos am Event-Bus,
   `effect`s in Root-Diensten, Timer, Worker, GPU-Puffer, Zustand in Root-Stores. Ohne Neuladen bleiben solche Reste
   und zeigen sich als falscher Zustand im nächsten Lauf (alte Tower, alte Forschung, doppelte Töne) oder als
   wachsender Speicher. Gegenmittel: Abnahme-Spec aus 4.1 Punkt 3, Speicher-Treppe aus 4.5, früh in Phase 1.
2. **Breite der URL-Abhängigkeit.** Rund 25 Dateien lesen die Adresse; Coop, Bots, Benchmark und E2E hängen an
   Startparametern. Ein übersehener Leser verhält sich nach einem Wechsel wie zum Start der Seite (etwa die
   Kartenprobe, `?fromWave=`). Gegenmittel: Startauftrag zuerst und vollständig, danach eine Lint-Regel oder ein
   Spec, der `location.search` außerhalb des Boot-Lesers verbietet.
3. Coop während eines Weltwechsels: Raum, Lockstep und Prüfsummen dürfen den Abbau nicht sehen; der Gast folgt dem
   Host heute per Neuladen.
4. Desktop: Fensterverwaltung, Update-Hinweis und `will-prevent-unload` gehen von Seitenwechseln aus.
5. Aufwand für zwei neue Globus-Stile, die nach Engine-Grafik aussehen sollen (Optik-Abstimmung).

## 5. Phasen

Reihenfolge: erst die Technik, die Neuladen überflüssig macht, dann die Oberfläche, die darauf zeigt. Jede Phase ist
für sich lieferbar; bis Phase 4 bleibt die heutige Menüoptik.

| Phase | Inhalt | Größe | Was der User testen kann |
|---|---|---|---|
| 1 Startauftrag | `WorldStart` aus der URL beim Boot, alle Leser umgestellt, URL danach sauber | mittel | alle Links wie heute (`?l=`, `?world=`, `?room=`, `?resume=`); Neuladen nach dem Start lädt keinen Auftrag doppelt |
| 2 Welt wechseln ohne Neuladen | `WorldSession`, `WorldContext` wählbar, Abbau/Aufbau, Store-Reset, neuer Canvas, neuer Key ohne Neuladen | groß | New game › Maps, Play on real places, Load einer anderen Welt, Token eingeben: kein Neuladen, zehnmal hin und her ohne Fehler und ohne wachsenden Speicher |
| 3 Coop und Desktop folgen | `reloadAtMap`/`reloadAt` durch Weltwechsel im Raum ersetzen; Doppelklick auf Karte; Benchmark im Fenster | mittel | Gast tritt einem Host auf einer Karte bei, Host wechselt von Ort zu Karte, Gast folgt; Karte per Doppelklick in der Desktop-App |
| 4 Editor in der App | Hülle, Editor ohne Route-Wechsel, Edit this map und Back to the run (mit Autosave), Kopfzeile mit Pfad und Chips | groß | aus dem Spiel in den Editor und zurück in dieselbe Welle; Editor › Back to the game; kein Neuladen |
| 5 Probespiel im Fenster | Test map und Bot check im selben Fenster, Rückkehr am selben Stand; Test-Tab entfernt | mittel | Test ab Welle 5, zurück, Änderung, erneut testen, nichts verloren; Desktop ohne zweites Fenster |
| 6 Globen und Weltmenüs | Start auf drei Globen (Engine startet erst mit Start), Weltmenüs mit Umschalter, OSM als eigene Welt, `worldLock`/`whyNot`, Esc-Kette | groß | Start ohne Key: grauer Globus mit Weg zum Key; Wege aus der Navigationskarte des Dummys nachklicken |
| 7 Globus-Stile | OSM- und Comic-Globus, Hintergründe je Welt, Feinschliff nach `proposal.html` | mittel | Optik am Bildschirm |

Phase 2 ist die Grundlage für alles danach und das größte Risiko; sie sollte zuerst mit Messung (Speicher-Treppe)
abgeschlossen sein. Phase 6 kann im Klick-Dummy weiter abgestimmt werden, während 1 bis 3 gebaut werden.

## 6. Entscheidungen (User, 2026-10-15)

Gewählte Darstellung nach Dummy und Vorschlag (`tmp/plan/mockups/world-globes/proposal.html`): Einstieg drei frei
stehende Globen, Menü links auf allen Ebenen (Start, Weltmenü, Pausemenü), die Welt des laufenden oder letzten Laufs
groß, Globus mittel, Hintergrund je Welt, Kopfzeile oben, Dichte großzügig, Weltumschalter als Mini-Globen,
Nachtseite an; Kreis- und Minimal-Varianten sind raus.

1. **Lauf beim Weltwechsel:** je Welt bleibt ein Lauf als Autosave stehen; Start fragt nur, wenn in derselben Welt
   schon einer läuft.
2. **Editor neben dem Lauf:** der Lauf geht als Autosave weg, „Back to the run“ lädt ihn an derselben Stelle neu.
3. **Links:** wählen nur aus (Weltmenü mit Ort oder Karte vorgewählt, Globus dreht hin), erst Start lädt.
4. **Start mit Autosave:** immer die Globen, „Continue“ oben im Menü links, die Welt des Laufs groß.
5. **OpenStreetMap:** eigene Welt mit eigenem Globus; fertige OSM-Karten stehen zusätzlich unter Maps.
6. **Echtwelt-Globus:** die heutige Menü-Erde (echte Texturen, Abtauch-Übergang), neu angeordnet, dazu Nachtseite
   und Stadtlichter; der gezeichnete Dummy-Globus war nur Platzhalter.
7. **Globus der Karten:** echter Low-Poly-Globus in den Farben der Engine, Kartenpunkte als kleine Modelle.
8. **Route `/editor`:** bleibt als Einstieg, führt aber in dieselbe App ohne Neuladen.
9. **Fokus im Startmenü:** der erste Eintrag bekommt den Fokus wie heute.

Offen bleibt nur, was beim Bauen auffällt; die Reihenfolge der Phasen steht in Abschnitt 5.

## 7. Gebaut

### Phase 1: Startauftrag (2026-10-16)

- `world/world-start.ts`: `WorldStart` (Welt, Ort, Spielstand, Coop-Raum, Spawn-Grenze, Startwelle) und
  `WorldStartService` (root). Beim ersten Zugriff liest er die Adresse einmal (`worldStartFromSearch`), nimmt die
  Link-Parameter heraus (`LINK_PARAMS`: `l`, `s`, `world`, `resume`, `room`, `lane`) und schreibt die bereinigte
  Adresse per `replaceState` (nur auf den Seiten des Spielfensters, `/` und `/editor` relativ zur base href,
  `pageTakesLinks`; eigene Seiten wie `/map-preview?map=` behalten ihre Parameter). Neuladen startet danach ohne Auftrag: Startort-Raten (Autosave, zuletzt gespielt) wie
  beim Start ohne Link. Ein Spielstand des Auftrags lädt einmal (`takeResume`). DevWorld (`?devworld`) bleibt ein
  Schalter, sein `WorldRef` ist die Welt des Auftrags.
- Schalter der Entwicklung bleiben in der Adresse, weil Bot-Tabs auf ihnen neu laden: `devworld` samt Parametern,
  `bot`, `benchmark`, `quality`, `interp`, `waves`, `tokensetup`, `nokey`, `menu`, `fromWave`, `spawns`,
  `trialWaves`, `relay` (Hosts und Bot-Sitze nennen ihren Relay damit, nicht nur Einladungen), `hashEvery`,
  `resyncPart`, `previewsheets`, Kartenvorschau. Gelesen werden sie nur über `core/page-switches.ts`
  (`pageSwitches`, `pageQuery`); `fromWave` und `spawns` gehen über den Auftrag in die Kartenwelt.
- Leser umgestellt: `WorldContext` (`chosen` ist ein `linkedSignal` des Auftrags, ein neuer Auftrag setzt es neu),
  Kartenfabrik (Spawn-Grenze, Startwelle), `LocationFacadeService` (Ort), Facade (Startort-Raten, Kartenprobe),
  `MainMenuService` (`linkedPlace`, Spielstand), `CoopService` (Raum, Bahn), Token-Dialog (Raum), Spielkomponente
  (Coop-Seite beim Einladungslink). `page-switches.guard.spec.ts` verbietet `location.search` außerhalb der zwei
  Leser.
- Die Adresse wird nicht mehr geschrieben: `UrlLocationService.updateUrl` und `syncUrlWithLocation` sind entfernt
  (die offene Frage aus 3.8 so entschieden). „Copy link“ baut den Link aus dem aktuellen Ort und der Welt
  (`getShareUrl(hq, spawns, world)`); Benchmark-Rückweg und Grafik-Benchmark setzen Ort und Welt wieder in die
  Adresse (`hereUrl`), bis Phase 3 sie ins Fenster holt.
- Bleibt wie heute bis zu den späteren Phasen: Weltwechsel und Editor laden neu (`WORLD_NAVIGATE`, `?world=…`,
  `/editor?map=`); der Editor liest `?map=` weiter selbst. Debug-Berichte (`cell-report`, `corridor-snapshot`)
  nehmen die Adresse ohne Ort.

### Phase 2: Welt wechseln ohne Neuladen (2026-10-16)

- `world/world-session.service.ts`: `WorldSession` (root) öffnet Welten in der Seite. `open(order)` setzt den
  Startauftrag und zählt `world` hoch; `reopen()` macht die offene Welt neu (neuer Tile-Key, Retry), ohne ihren
  Spielstand ein zweites Mal zu laden. Höchstens eine Welt ist offen: eine Engine, ein Sim-Worker, ein Spiel-Canvas.
  Außerhalb des Spiels (Editor, der vor dem Verlassen nach ungespeicherten Änderungen fragt) lädt `open` die
  Spielseite auf dem Link des Auftrags (`worldStartUrl`, `WORLD_NAVIGATE`).
- `game-host.component.ts`: die Spielroute. Ändert sich `world`, nimmt der Host die Spielkomponente mit allem, was sie
  bereitstellt (Facades, Coop, Menüs, Speichern), herunter und baut eine neue auf frischem Canvas; MSAA folgt so der
  Welt. Zwischen beiden liegt ein Render ohne Spiel, weil Angular sonst die neue vor dem Abbau der alten baut.
- Nach dem Abbau (`TowerDefenseComponent.ngOnDestroy`: `facade.dispose()`, dann `WorldSession.closed()`) gehen der
  Laufzustand der Root-Stores (`TowerDefenseStore.resetWorld`: Spiel, Forschung, Engine-Zahlen und Ladeschritte,
  Ort, `UIStore.resetWorld`), `LocationManagementService.reset()` und die geöffnete Karte (`closeCustomMaps`).
  Anzeige-Schalter und Lautstärken bleiben.
- In der Seite öffnen jetzt: New game › Maps, eigene Tilesets, Play on real places, Load eines Spielstands einer
  anderen Welt, ein neuer Tile-Key, Retry im Ladeplakat bei einem Problem ohne eigenen Retry (vorher Neuladen, das
  seit Phase 1 den Ort des Links verlor). Engine und Modellvorschau geben ihren WebGL-Kontext beim Abbau sofort ab
  (`forceContextLoss`).
- Abbau-Lecks, die das Neuladen bisher verdeckte, behoben: die vier Dokument-Listener des `InputHandlerService` (sie
  hielten Canvas und Engine der alten Welt bis zum nächsten Aufbau), ein laufender Höhenzyklus (`HeightUpdateService`,
  sein Timer lief weiter und rief am Ende Facades und Kamera der alten Welt; `dispose` stoppt jetzt ohne diese
  Rückrufe), der Seitengriff `__load`, der das ganze alte Spiel erreichbar hielt, der `StateSnapshotService` (zum
  Spiel gehörig, aber am Bus des Root-`SimClient` angemeldet; über ihn hingen Wave-Director, Facade und Injector
  jedes alten Spiels), dazu die geteilten Blob-Schatten-Materialien und die eine Sprite-Geometrie von three: jeder
  `WebGLRenderer` hängt an alles, was er zeichnet, einen Dispose-Listener, der ihn samt Kontext und Canvas hält.
  Die Engine gibt beide beim Abbau frei (`disposeBlobShadows`, `new Sprite().geometry.dispose()`).
- **Geteilte GPU-Objekte (2026-10-19):** Was die Seite einmal anlegt und jeder Renderer zeichnet, meldet sich bei
  `three-engine/shared-gpu.ts` an (`shareGpu`): Gerüst-Materialien, Rauschtexturen (Variation, Schaum, Lava, Wellen),
  der Portalrahmen, die Modelle des `AssetManagerService` und der geteilten `MapAssetLibrary`, die Marker-Kugel der
  LOS-Anzeige. Jeder Renderer, der geht (Engine, Editor, Vorschau der Seitenleiste, Paletten-Bilder), ruft vor seinem
  Abbau `releaseSharedGpu`: alle angemeldeten Objekte geben ihre GPU-Seite ab und damit die Listener aller Renderer,
  die sie zeichneten; die Objekte bleiben samt CPU-Daten, der nächste Renderer lädt sie neu hoch. Dazu kommen die
  beiden Objekte von three selbst, die Sprite-Geometrie und die DFG-LUT der physikalischen Materialien (three
  exportiert sie nicht; sie wird an einem gezeichneten Material abgelesen). Jedes dieser Objekte hielt für sich jede
  alte Engine samt Seitenleiste und Minikarte fest. Neues GPU-Objekt auf Modulebene, statisch oder in einem
  Root-Dienst: mit `shareGpu` anmelden. Was je Engine gilt (die Blob-Schatten hängen an der Uniform ihres Gegner-Renderers), legt die
  Engine neu an und gibt es selbst frei.
- Abnahme: `world/world-teardown.spec.ts` startet eine Welt zweimal und baut sie ab, mit echten Facades
  (Spiel, Darstellung, Spielschleife), Eingabe, Höhenzyklus und `SimClient`; danach kein Listener auf `window` und
  `document`, kein Worker, kein Intervall, kein Seitengriff, kein Root-Dienst mehr an Canvas oder Engine.
  Gezählt wird auch der Bus der Simulation. `world/world-session.spec.ts` prüft Auftrag, Reset der Root-Stores und den Host (eine Spielkomponente zur Zeit).
  Engine, WebGL-Kontexte und GPU-Ressourcen misst `e2e/perf/world-switch.ts` im Browser (unten).
- Bleibt wie heute bis zu den späteren Phasen: Coop folgt dem Host per Neuladen (`reloadAtMap`, `reloadAt`) und ein
  Weltwechsel verlässt den Raum (Phase 3); Benchmarks laden ihre Seite (Phase 3); der Editor ist eine eigene Seite
  (Phase 4); das Nachladen des Token-Dialogs, wenn sein Chunk nicht kam, lädt die Seite neu.

#### Messung: zehn Weltwechsel

`e2e/perf/world-switch.ts` auf einem Produktions-Build (`ng build`, `public/maps` hineinkopiert,
`node e2e/perf/serve.mjs dist/3DTD/browser <port> --isolate`), Chrome headless, Demo Valley und Mountain Pass im
Wechsel über das Menü (Esc, New game, Maps, Play), nach jedem Wechsel sechsmal GC. Der Dev-Build taugt für den Heap
nicht: Angulars Injector-Profiler hält jede Spielkomponente, die er sah.

| Stand | Heap Start | nach 4 | nach 10 | nach 20 | Zuwachs je Wechsel ab 4 |
|---|---|---|---|---|---|
| vor den Lecks des Bus und der Engine | 158,0 MB | 168,4 MB | 171,5 MB | 178,0 MB | ~0,6 MB |
| mit allen Korrekturen (2026-10-16) | 158,9 MB | 167,0 MB | 167,9 MB | 170,9 MB | ~0,25 MB |

(Heap jeweils auf Demo Valley; Mountain Pass liegt 2 bis 3 MB darunter.) Gleich über alle Wechsel: 3 Worker, 2 lebende
WebGL-Kontexte, eine Spielkomponente, 25 Listener auf `window`, 24 auf `document`, 2 Intervalle, keine Fehler, kein
Neuladen. Die ersten Wechsel steigen um rund 8 MB (übersetzter Code, Caches der Modelle und Shader). Ein Rest von etwa
0,25 MB je Wechsel bleibt; ein Heap-Vergleich zeigt noch abgelöstes DOM alter Spiele (Seitenleiste, Icons,
Vorschau-Canvas), sein Halter ist nicht gefunden. Geometrien und Texturen des Renderers liest das Skript nur im
Dev-Build (`ng`), im Produktions-Build stehen sie auf -1.

**Nachtrag 2026-10-19 (E195 Rest, Messung im Produktions-Build mit Fenster und GPU):** Der Halter war doch da. Über
zehn Wechsel (Demo Valley, Mountain Pass, Autumn Keep über Built Worlds) blieben vorher alle alten Renderer samt
Canvas, Seitenleiste (13 Vorschau-Canvases je Wechsel) und Minikarte im Speicher: `measureUserAgentSpecificMemory`
333 → 576 MB, Renderer-Prozess 1597 → 2023 MB. Ursache die Dispose-Listener an geteilten GPU-Objekten (oben, Risiko
1): Gerüst-Materialien, DFG-LUT von three, Portalrahmen, gecachte Spielmodelle; jedes allein hielt alle. Mit `shared-gpu.ts`: 334 → 336 MB, JS-Heap 184
→ 181 MB, Renderer-Prozess 1637 → 1726 MB (+5,4 %, schwankt je Karte um ±40 MB); nach dem Wechsel lebt außer dem
Spiel nur noch der Vorschau-Renderer, kein abgehängtes Spiel-Canvas, keine alte Vorschau. `e2e/perf/world-switch.ts`
zählt jetzt per WeakRef die Canvases, deren Kontext verloren ist und die in keiner Seite hängen (`retainedContexts`),
und die abgehängten 2D-Canvases; es endet mit Code 1, wenn erstere von Wechsel zu Wechsel steigen. Vorher: 2, 3, 4
nach drei Wechseln; jetzt bleibt es bei 1 (das Canvas des Weltmenüs, das der Browser hält, kein JS-Halter) und 8
abgehängten 2D-Canvases der aktuellen Welt. Der Weg ins Menü heißt jetzt Built Worlds, Karte, Play.

### Phase 3: Coop und Desktop folgen (2026-10-16)

- **Raum über den Weltwechsel:** `WorldSession.onLeaving` meldet, dass die offene Welt für eine andere in der Seite
  geht, solange ihr Spiel noch steht. Ein `CoopService` in der Lobby gibt dort seine Relay-Verbindung samt Chat und
  LAN-Relay an `coop/coop-room-carry.ts` (`CoopSession.unhook` nimmt die alten Handler ab), der `CoopService` der
  nächsten Welt nimmt sie auf (`takeUpRoom`). Der Host sagt dem Raum „changing the map“ und schickt die neue Welt,
  sobald sie steht; der Gast meldet „loading“ und nimmt die Welt, die die Sitzung behielt, nur wenn sie die neue ist
  (sonst wäre es die alte des Hosts, und er spränge zurück). Das Startmenü der neuen Welt öffnet auf der Coop-Seite.
  Ein laufendes Coop-Spiel geht nicht mit: wer die Welt wechselt, verlässt es wie bisher.
- **Gast folgt in der Seite:** `reloadAtMap` und `reloadAt` sind entfernt (`followTo`): auf die Karte des Hosts, an
  den Ort des Hosts, wenn das Hingehen in der Welt scheiterte, und neu von einer Karte in die Echtwelt, wenn der Host
  auf echten Orten spielt (vorher nur eine Meldung). Specs: `coop.service.scenario.spec.ts` (Host wechselt die Welt,
  Gast folgt von einer Karte an den Ort, beide über einen echten Relay, ohne „left“).
- **Desktop:** die doppelt geklickte Karte öffnet seit Phase 2 im Fenster; in einem Coop-Raum, dessen Karte der Host
  wählt, bleibt jetzt die Welt und ein Hinweis nennt den Kartenordner (`world/opened-map-leave.ts`).
- **Benchmarks im Fenster:** der Startauftrag trägt `benchmark` (`load` oder `render` und den Rückweg `back`).
  „Benchmark“ öffnet die DevWorld in der Seite, „Back to your place“ Welt und Ort davor (`orderHere`); „Graphics
  benchmark“ öffnet dieselbe Welt am selben Ort neu. `&benchmark` eines Links ist jetzt ein Link-Parameter
  (`LINK_PARAMS`), einmal gelesen; Startmenü und Menü-Globus bleiben bei einem Benchmark-Auftrag weg wie beim Link.
  `benchmarkUrl`, `renderBenchmarkUrl`, `hereUrl` und die Rückkehr über `sessionStorage` sind entfernt.
- Bleibt bis zu den späteren Phasen: der Editor ist eine eigene Seite (Phase 4), Doppelklick aus dem Editor lädt die
  Spielseite; das Probespiel öffnet einen Tab (Phase 5). Beides ist mit Phase 4 und 5 erledigt.

### Phase 4: Editor in der App (2026-10-16)

- **Hülle:** beide Routen (`/` und `/editor`) zeigen `AppShellComponent`; die Route sagt nur, was zuerst steht.
  `world/app-screen.service.ts` (`AppScreen`, root) hält den Bildschirm (`game` oder `editor`), die Karte, die der
  Editor als Nächstes öffnet, den wartenden Lauf und den Editor-Entwurf. Kein Wechsel ändert die Adresse.
  `/editor?map=<id>` wird beim Start einmal gelesen (`WorldStartService.editorMap`, `map` ist ein Link-Parameter).
- **Editor ohne Route-Wechsel:** der Code des Editors lädt beim ersten Zeigen; seine `EditorSession` lebt in einem
  eigenen Injector der Hülle, die offene Karte samt Rückgängig-Liste bleibt, während das Spiel zeigt. Ansicht,
  Renderer und Canvas gehen mit der Editor-Seite. Bevor das Spiel zeigt, speichert der Editor (`guardEditor`;
  scheitert das, bleibt er). Eine Welt, die aus dem Editor geöffnet wird (Doppelklick, Token-Dialog), zeigt zuerst
  das Spiel; `WORLD_NAVIGATE`, `worldStartUrl` und das Zählen der Spiel-Hosts sind entfernt. Neuladen öffnet die
  Karte, die dieser Tab offen hatte (sessionStorage), weil die Adresse sie nicht mehr trägt.
- **Edit this map und Back to the run:** Map editor, Edit in der Kartenwahl, Edit nach dem OSM-Rahmen und Edit this
  map gehen über `MainMenuService.editMap`: der Lauf wartet als Autosave seiner Welt (Entscheidung 2), zwischen den
  Wellen sofort geschrieben (`SaveGamePort.autosaveNow`), in einer Welle der Autosave vom Anfang dieser Welle; ohne
  beide endet er, und die Rückfrage sagt es. „Back to the run“ (Kartenliste, Pfad, Chip) öffnet seine Welt und lädt
  den Autosave dort (`WorldSession.backToGame`). Jede andere Welt lässt ihn los; er bleibt das Continue seiner Welt.
- **Pfad und Chips:** `components/world-path/` zeigt `Worlds › Welt ›` Ort oder Karte `› Play | Edit` und Chips,
  im Spiel um den Ort-Knopf der Kopfleiste, im Editor um den Kartennamen, auf den Globen (nach dem Zusammenführen mit
  Phase 6) statt deren eigener Leiste. Im Spiel: Worlds zu den Globen, die Welt zu ihrem Weltmenü (läuft ein Lauf,
  öffnet erst das Pausemenü mit „All worlds“ und seiner Rückfrage), Edit den Editor (auf echten Orten „Make map“,
  dann New game); Chip „Editor: Karte“. Im Editor: Worlds zu den Globen (der Editor speichert, die Karte bleibt
  offen), der Chip des Laufs zurück zum Lauf, Maps zur Kartenliste, Play zum Lauf dieser Karte oder einem neuen.
  Gesperrte Wege bleiben sichtbar, inaktiv, mit Grund (`world/why-not.ts`, `whyNot('play' | 'edit')`, für Phase 6
  zum Erweitern). Ein Coop-Chip im Editor entfällt: wer den Editor öffnet, verlässt den Raum.
- Der Pfad im Spiel nennt die Welt wie ihr Weltmenü und das Pausemenü (`worldName(worldOfPage(ref))`, seit
  2026-10-18; vorher hieß eine OSM-Karte „Maps“, ein eigenes Tileset „Own tilesets“). Globen gehören zum
  Spielbildschirm der Hülle (GameHost, `WorldSession.isOpen`), einen eigenen Zustand der Hülle brauchen sie nicht;
  `/editor` mit „Back to the game“ ohne offenen Lauf landet auf den Globen. `opensAtOnce` zählt Benchmark und
  Probespiel über den Startauftrag (`benchmark`, `trial`).

### Phase 5: Probespiel im Fenster (2026-10-16)

- „Test map“ und der Bot-Check speichern, setzen `AppScreen.trial` und öffnen die Karte mit einem Startauftrag mit
  `trial` (Bot-Wellen, From wave als `startWave`) im selben Fenster. Der Editor wartet mit Karte, Verlauf und Kamera
  (`EditorSession.keptView`); Edit im Pfad, „Back to editor“ im Pausemenü und nach Game over zeigen ihn wieder. Ein
  Probespiel wird nie gespeichert, auch nicht als Autosave („A test of the map is not saved.“), und ist kein Lauf.
  Das Ergebnis des Bots geht an `AppScreen.trial` und steht in der Prüfung, sobald der Editor zurück ist.
- `?bot=trial&trialWaves=N` eines Links wird beim Start zum `trial` des Auftrags; die Facade liest nur den Auftrag.
- Entfernt: Test-Tab (`openTestWindow`, `showInTestWindow`, `MAP_TEST_WINDOW`, `MAP_EDITOR_WINDOW`), `returnToEditor`,
  das `postMessage` des Ergebnisses, das Test-Fenster der Desktop-App (`classifyWindowOpen` verwirft jedes Fenster
  auf dem App-Ursprung) und `e2e/tests/desktop-test-window.e2e.ts`. Die Editor-E2E spielen ihren Test in derselben
  Seite.

#### Messung: zehnmal Spiel und Editor im Wechsel

Dev-Build (`ng serve`), Chrome headless, Demo Valley: Spiel, Editor auf derselben Karte (Ansicht fertig), über
Worlds im Pfad zurück ins Spiel, nach jedem Wechsel sechsmal GC. Gezählt wie in `e2e/perf/world-switch.ts`.

| Stand | Worker | lebende WebGL-Kontexte | Listener `window` | Listener `document` | Intervalle | Spielkomponenten |
|---|---|---|---|---|---|---|
| Start (Spiel) | 3 | 2 | 14 | 23 | 3 | 1 |
| nach Wechsel 1 bis 10 | 4 | 3 | 16 | 24 | 4 | 1 |

Der Sprung nach dem ersten Wechsel passt zur `EditorSession`, die in der Hülle lebt, solange die Seite steht: ihr
Takt ist das Intervall; Worker und Kontext sind nach dem Code der Bauflächen-Worker und der Renderer der
Vorschaubilder (nicht einzeln nachgewiesen). Danach bleibt jede Zahl über alle Wechsel gleich, keine Fehler, kein
Neuladen. Der Heap ist im Dev-Build nicht aussagekräftig (Abschnitt Phase 2). Die Messung von
`e2e/perf/world-switch.ts` auf dem Produktions-Build braucht den lokalen Schalter `CUSTOM_MAPS_RELEASED` und steht
nach Phase 4 noch aus.

### Phase 6: Start auf den Globen, Weltmenüs (2026-10-16)

- `WorldSession.isOpen`: die Seite startet auf den Globen, nichts aus einem Spiel lädt. Direkt ins Spiel geht nur ein
  Start, der einem Lauf gehört (`opensAtOnce`): Bot, Benchmark, `menu=skip`, DevWorld, Testlauf des Editors
  (`fromWave`, `trial` des Startauftrags), Coop-Einladung (`?room=`), Spielstand (`?resume=`). Der Host zeigt ohne
  offene Welt `app-worlds-stage`; `WorldSession.close()` führt zurück, das Spiel geht mit Engine, Worker und Canvas.
- `worlds/world-rules.ts`: `worldLock`, `runAtRisk`
  (Autosave desselben Slots an anderer Stelle), `heroWorld`; die Gründe gesperrter Wege erweitert `world/why-not.ts`
  (aus Phase 4) um save, load, restart, replay, leave und Key und Freigabe je Welt. `worlds/worlds-stage.service.ts` (root, die Wahl bleibt
  über ein Spiel hinweg): Ansicht, Welt, Wahl je Welt, Overlays, Rückfrage, Esc-Kette (`back`: Rückfrage, Overlay,
  OSM-Rahmen, Weltmenü, auf den Globen nichts), Start, Continue, Edit, OSM-Rahmen, `leaveGame`.
- `WorldStart` hat `play` und `label`: Start, Continue, Load und eine im Spiel gewählte Karte öffnen mit `play`. Die
  Start-Lage zeigt dann „Loading <Name>“ mit Balken und Cancel (Esc); das Spiel erscheint, sobald der Ort steht.
  Cancel, Esc und „Other place“ der Ladeplatte führen ins Weltmenü zurück, die Wahl steht noch dort. Links setzen nie
  `play`: `?l=` wählt den Ort unter Real places (Name per Nominatim nachgereicht), `?world=map:` die Karte unter Maps
  (eine OSM-Karte unter OpenStreetMap, sobald die Liste das weiß), `?world=tileset:` das Tileset.
- Weltmenüs: Real places mit Recent, Favorites, Showcase, Search (mit Würfel), World map (verteidigte Orte),
  Tilesets; OpenStreetMap mit Suche oder dem Ort aus Real places, dann der OSM-Rahmen im Panel, und den eigenen
  OSM-Karten (`MapSummary.osm`, gesetzt beim Speichern; ältere OSM-Karten erst nach dem nächsten Speichern); Maps mit
  eigenen, von Coop-Hosts und mitgelieferten Karten (OSM-Karten mit Etikett). Unten Coop, Load game, Settings,
  Extras; rechts die zwei anderen Welten als Mini-Globen und All worlds.
- Ohne Key: der Echtwelt-Globus grau, darunter der Grund und „Enter map key“ (Token-Dialog als Overlay, mit „Back to
  the worlds“); das Weltmenü listet die Orte, Start bleibt sichtbar und gesperrt, mit Grund und Link zum Key.
- Autosaves: oben im Menü je Autosave „Continue“ mit Ort und Welle (die Echtwelt hat ihren eigenen, OSM und Maps
  teilen einen), als Chip in der Kopfzeile, als Zeile im Weltmenü. Groß steht die zuletzt gestartete Welt
  (`td_last_world_v1`), sonst die des neuesten Autosaves. Ein Start an anderer Stelle desselben Autosaves fragt
  („Start anyway“, „Continue …“, „Cancel“). Load game auf den Globen listet die Slots (`StageSaves`); ein Slot öffnet
  seine Welt und lädt ihn dort, Laden aus einer Datei geht erst im Spiel.
- Pausemenü: „World menu“ (mit dem Namen der Welt) und „All worlds“ unter der Linie; mit Lauf fragt es und nennt die
  Welle, vor der der Autosave steht; im Coop gesperrt („Leave the coop room first“). „Play on real places“ im Spiel
  öffnet das Weltmenü der Echtwelt.
- Coop auf den Globen: Beitritt per Code (öffnet das Spiel wie ein Einladungslink); gehostet wird aus dem Spiel einer
  Welt. Der Map editor bleibt bis Phase 4 eine eigene Seite.
- Abbruch beim Laden: `EngineInitializationService.abandon()` (aus `TowerDefenseFacadeService.dispose`) lässt einen
  laufenden Aufbau an seinem nächsten Schritt enden, gibt die halb gebaute Engine frei und schreibt keinen Fehler
  mehr. Vorher zeigte Esc und gleich wieder Start „No world is open“ im nächsten Spiel.
- Specs: `worlds/world-rules.spec.ts`, `worlds/worlds-stage.scenario.spec.ts` (ohne Key, Esc-Kette, Start einer
  Karte, Continue und Rückfrage, ein Link wählt nur), `world/world-session.spec.ts` (`opensAtOnce`, Host mit den
  Globen). `e2e/support/game.ts` drückt Start auf den Globen.

### Phase 7: Globus-Stile und Hintergründe (2026-10-16)

- `globe/globe-stage.ts`: ein `WebGLRenderer` auf einem Canvas (durchsichtig, über der Seite, unter Kopfzeile und
  Overlays) zeichnet bis zu drei Globen per Viewport und Scissor in die Quadrate `[data-globe]` der Seite; Lage und
  Größe liest `worlds/stage-globes.ts` je Bild, ein Globus dreht langsam oder zu seiner Wahl, im Leerlauf 30 Bilder je
  Sekunde. Unter dem Zeiger oder dem Tastaturfokus (Karte der Globen, Mini-Globus) wird ein Globus größer (CSS-Skalierung
  seines Quadrats, die Bühne folgt ihm), sein Rand bekommt einen Lichtsaum (`--td-world-glow` hinter dem klaren Canvas)
  und er dreht schneller (4 auf 36 Grad je Sekunde, weich an- und auslaufend, E207); solange sich ein Quadrat bewegt
  oder ein Globus anläuft, zeichnet die Bühne jedes Bild. Die Erde ist die `GlobeView` der Menü-Erde auf diesem Renderer, ohne Sterne, Sonne und 8k-Stufe; die Sonne
  steht 58 Grad westlich der Mitte, rechts liegt die Nachtseite mit Stadtlichtern. `saturation` macht sie grau.
- `globe/style-globes.ts`: OpenStreetMap als Shader auf den Karten der Erde, so wie die daraus erzeugten Karten
  aussehen (E208, vom User aus vier Looks gewählt: aerial): Bodenbedeckung aus der Tageskarte in den Bodenfarben der
  Engine (Wiese, Wald, Steppe, Sand, Fels, Schnee, Felder als unregelmäßige Parzellen, nur wenn groß genug), Städte
  aus den Stadtlichtern mit Dächern und Asphalt, Hauptstraßen in Asphalt mit hellem Rand, Relief von Nordwest
  beleuchtet, Sand am Ufer, Wasser zur Küste hin heller, Nachtseite mit Fensterlicht. Die frühere Karte im Stil von
  OSM Carto mit Grenzen und Gradnetz ist entfernt. Maps als Low-Poly-Ikosaeder (Stufe 14, bei Low 9) mit Höhenrauschen in den Farben der Engine,
  Bäumen, Wolken und je Karte einem Turm an einem festen Landplatz aus ihrer Id; die gewählte Karte in Messing mit Ring.
- Hintergründe je Welt und Scheiben als Ersatz: `td-world-bg` (`is-real`, `is-osm`, `is-maps`) und `td-world-disc`
  (`is-grey`) im Design System. Settings › Menu globe gilt: Low mit Pixelrate 1, sechs Streuschritten und weniger
  Segmenten; Off und ohne WebGL 2 zeigen die Scheiben. Die Marke der Wahl ist `td-globe-mark is-target`.
- Noch nicht: der Abtauchflug aus dem Globus der Globen (die Bühne geht beim Start, die Spiel-Erde des
  `GlobeDirectorService` blendet beim Laden neu ein und taucht wie bisher ab); Drehen mit der Maus; Ortsnamen auf dem
  OSM-Globus.
