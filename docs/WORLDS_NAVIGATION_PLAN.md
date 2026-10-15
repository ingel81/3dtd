# Welten und Navigation aus einem Guss (Plan)

Status: Plan, nicht gebaut. Abstimmung mit dem User offen (Abschnitt 6).
Grundlagen: TODO E195, Klick-Dummy `tmp/plan/mockups/world-globes/index.html` (Datenmodell, Regeln, Navigationskarte,
Abgleichsliste „heute vorhanden → im Dummy“), die gewählte Darstellung aus dem Dummy.

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
