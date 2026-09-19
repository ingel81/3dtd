# Electron Desktop-Build

> **Status:** Anforderungen festgelegt (2026-09-18). Umsetzung läuft auf Branch
> `electron`, Stand unter [Reihenfolge](#reihenfolge) (TODO H10).
> Ein Proof-of-Concept lief am 2026-05-16 durch und wurde danach zurückgebaut,
> im Repo liegt davon nichts mehr. Seine Erkenntnisse stehen unter
> [Aus dem PoC](#aus-dem-poc).

## Ziel

3DTD als Windows-Desktop-App über GitHub Releases ausliefern, mit Installer und
automatischem Update. Der Web-Build bleibt unverändert. Der Angular-Code bekommt
genau eine Desktop-Stelle, den Update-Hinweis (E32); alles andere lebt in
`desktop/` oder ist eine allgemeine Regel, die im Web genauso gilt.

## Entscheidungen

| Thema | Entscheidung | Begründung |
|-------|--------------|------------|
| Plattform | Nur Windows x64 | macOS braucht Notarisierung (99 $/Jahr), Linux erst auf Nachfrage |
| Paket | NSIS-Installer, One-Click, pro Nutzer (kein Admin, keine UAC-Abfrage), Startmenü- und Desktop-Verknüpfung. **Kein Portable-ZIP** | Auto-Update geht nur mit Installer; eine ZIP bräuchte einen zweiten Update-Pfad. Wer nichts installieren will, hat die Web-Version. Nachrüsten ist ein zusätzliches `zip`-Target |
| Update | `electron-updater` gegen GitHub Releases: Download im Hintergrund, Installation beim Beenden, Hinweis im Spiel mit "Jetzt neu starten" | Ohne Update bleiben Installationen auf dem Stand des ersten Downloads stehen |
| Hintergrund | `backgroundThrottling` bleibt an (Default) | Verhält sich wie ein Browser-Tab: minimiert steht das Spiel, auf einem zweiten Monitor ohne Fokus läuft es weiter. Beim Zurückholen begrenzt `GameClock.MAX_CATCHUP_MS` (50 ms) den ersten Schritt, es gibt keinen Sprung |
| Diagnose | `electron-log` in eine Datei, DevTools per F12, Taste für "Log-Ordner öffnen" | Sporadische Bugs lassen sich nur mit Logs belegen. Open Source, DevTools verbergen nichts |
| Tile-Zugang | Nur der Token-Dialog. **Keine** zweite Quelle `userData/config.json` | `localStorage` liegt unter Electron ohnehin in `userData` und überlebt Updates. Eine zweite Ablage wäre ein paralleles System ohne Mehrwert. Die mitgelieferte `runtime-config.json` (leerer Token) wird normal ausgeliefert |
| Code-Signing | Erstes Release unsigniert, SmartScreen-Hinweis in Release-Text und README | Kosten siehe [Code-Signing](#code-signing). SignPath.io ist für AGPL-Projekte kostenlos, später |
| Release-Ablauf | CI baut auf Tag `v*` einen **Release-Entwurf**. Nach dem Smoke-Test wird er von Hand veröffentlicht, als normales Release, nicht als Pre-release | Der Updater sieht nur veröffentlichte Nicht-Pre-releases. Der Entwurf verhindert, dass ein kaputter Build an alle Installationen geht |
| Repo-Struktur | Unterprojekt `desktop/` mit eigener `package.json` und eigenem Lockfile | Hält die Electron-Abhängigkeiten aus dem Angular-Baum heraus |
| App-Laden | Eigenes `app://`-Protokoll, registriert als `standard` + `secure` + `supportFetchAPI` + `stream` | Echte sichere Origin: Routing, Worker und WASM lösen sauber auf, kein `file://`-Sonderverhalten |
| Cross-Origin-Isolation | Aus | `COEP: require-corp` blockiert die Tile-Fetches. ONNX wäre damit nur single-threaded, ist seit dem Regel-Director (2026-09-07) aber ohnehin Opt-in im Debug-Fenster |
| Versionen | Electron 44.4.2, electron-builder 26.15.3, electron-updater 6.8.9, electron-log 5.4.4 (Stand 2026-09-18, exakt gepinnt) | PoC lief mit Electron 42 |
| `appId` | `net.sgeht.3dtd`, danach nie mehr ändern | Windows und der Updater erkennen die Installation daran |

## Anforderungen

**Muss** = Voraussetzung für das erste Release. **Soll** = gehört dazu, blockiert aber nicht.

### Laden und Protokoll

- **E1 Muss** Prod lädt `app://app/` aus dem asar. Der Angular-Build dafür läuft mit
  `--base-href=/`, nicht mit dem `/play/` der Web-Version.
- **E2 Muss** Explizite MIME-Typen für alles, was im Build liegt: `.html .js .mjs .css
  .json .wasm .glb .mp3 .png .webp .svg .ico .woff2 .txt`. `.wasm` →
  `application/wasm` (Draco-Decoder unter `draco/gltf/`).
- **E3 Muss** SPA-Fallback auf `index.html` nur für Pfade ohne Dateiendung. Eine
  fehlende Datei mit Endung liefert 404, sonst parst ein JSON- oder GLB-Loader HTML
  und scheitert mit einer irreführenden Meldung.
- **E4 Muss** Der aufgelöste Pfad muss innerhalb des App-Verzeichnisses liegen.
  `..`, kodiertes `%2e%2e` und absolute Pfade enden in 404.
- **E5 Muss** Query-Parameter (`?tokensetup`, Ortsparameter) überleben das Laden und
  den Ortswechsel über `window.location.href`
  (`location-change-coordinator.service.ts`).
- **E6 Muss** Worker (Pathfinding, Heartbeat), Draco-WASM und alle Assets laden unter
  `app://`. Im PoC so gesehen, nach dem Neuaufbau erneut prüfen.
- **E7 Soll** Dev-Modus: Electron gegen `localhost:4200` mit Live-Reload.

### Fenster und Eingabe

- **E8 Muss** Single-Instance: ein zweiter Start holt das vorhandene Fenster nach vorn.
- **E9 Muss** Kein Anwendungsmenü (`Menu.setApplicationMenu(null)`). Damit entfallen
  auch Ctrl+R und Ctrl+W als versehentliches Neuladen oder Schließen mitten in einer
  Partie.
- **E9a Muss** Die native Titelleiste bleibt (Verschieben, Andocken, Doppelklick zum
  Maximieren wie gewohnt), dunkel über `nativeTheme.themeSource = 'dark'`. Das Theme
  des Spiels ist fest dunkel (`theme-type: dark`, `color-scheme: dark`), die
  Einstellung ändert an der Seite also nichts. Eine eigene Titelleiste
  (`titleBarOverlay`) wäre Desktop-Code im Angular-Header und kollidiert mit dessen
  Icons; wer ohne Rahmen spielen will, drückt F11.
- **E10 Muss** F11 schaltet Vollbild um, der Zustand wird gemerkt. Kein Vollbild beim
  allerersten Start. F12 öffnet die DevTools (E37 vorgezogen); sonst nimmt die Shell
  dem Spiel keine Taste weg.
- **E11 Muss** Größe, Position und Maximiert-Zustand werden gemerkt
  (`%APPDATA%\3DTD\window-state.json`). Liegt die Titelleiste auf keinem vorhandenen
  Monitor mehr, startet das Fenster zentriert auf dem Hauptmonitor. Erststart
  maximiert. Mindestgröße 1024 × 600, damit das Fenster auch auf einem
  1920 × 1080-Laptop mit 150 % Skalierung (Arbeitsfläche 1280 × 680) passt; ob die
  Oberfläche so klein noch brauchbar ist, gehört in den Nachtest.
  Zwei Windows-Eigenheiten, beide im Smoke-Test gefunden:
  - Mit 125 % Skalierung legt Electron ein Fenster nicht in der angefragten Größe an
    (900 hoch wird 907, `setBounds(900)` wird 902). Das Zurücklesen ließ das Fenster
    bei jedem Start um einige Pixel wachsen. Der Tracker misst den Fehler direkt nach
    dem Anlegen und zieht ihn beim Speichern ab.
  - Vollbild direkt nach `maximize()` landet randlos in Normalgröße. Ein im Vollbild
    beendetes Spiel startet deshalb direkt im Vollbild, und beim Verlassen maximiert
    die Shell selbst, wenn das Fenster vorher maximiert war. Die Aufzeichnung beginnt
    erst, wenn der Startzustand erreicht ist, weil Windows auf dem Weg dorthin
    `resize` meldet, während `isFullScreen()` noch `false` sagt.
- **E12 Muss** Der Seitenzoom bleibt bei 100 %: Ctrl+Mausrad, Ctrl+Plus/Minus/0 und
  Pinch zoomen nicht die Seite. Mausrad und Tasten erreichen die Spielsteuerung weiter.
- **E13 Muss** Fenstertitel "3DTD", Icon `desktop/build/icon.ico` mit allen Stufen
  von 16 bis 256 px. 256, 128 und 64 px zeigen das volle Logo; 48 px und kleiner nur
  den Pin mit dem Turm, weil der breite Schriftzug in Titel- und Taskleiste zum Fleck
  wird. Erzeugt von `desktop/scripts/make-icon.sh` aus
  `public/assets/images/logo/logo_square.png`. Die alte `logo_square.ico` (nur
  256 px, nur für den PoC angelegt) ist aus `public/` entfernt.
- **E14 Soll** Hybrid-Laptops rendern auf der dedizierten GPU. Im Renderer steht
  `powerPreference: 'high-performance'` schon (`three-tiles-engine.ts`). Ob das unter
  Electron auf Windows allein greift oder der Chromium-Schalter
  `force_high_performance_gpu` nötig ist, ist ungeprüft; auf einem Hybrid-Laptop
  nachsehen (Spalte "GPU-Modul" im Windows-Task-Manager).
- **E15 Soll** Musik darf ohne vorherigen Klick starten
  (`autoplayPolicy: 'no-user-gesture-required'`).

### Sicherheit

- **E16 Muss** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  `webSecurity` an.
- **E17 Muss** Der Preload stellt unter `window.desktop` nur bereit: App-Version,
  Update-Status abonnieren, "neu starten und installieren". Keine weiteren Kanäle.
- **E18 Muss** Links mit `target="_blank"` (Attributions, GitHub, Cesium-Anmeldung,
  Google Console) öffnen im Systembrowser, nur `http` und `https`. Neue
  Electron-Fenster entstehen nie (`setWindowOpenHandler` → `deny`).
- **E19 Muss** `will-navigate` hält das Fenster auf `app://app`. Navigation innerhalb
  der Origin ist erlaubt (E5), alles andere geht in den Systembrowser oder wird
  verworfen.
- **E20 Muss** Content-Security-Policy als Response-Header im `app://`-Handler, auf
  jeder Antwort (Module-Worker bekommen ihre CSP aus dem Header ihres Skripts).
  Stand in `desktop/src/protocol.js`:

  ```
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval' 'unsafe-hashes' 'sha256-<this.media='all'>';
  worker-src 'self' blob:;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  media-src 'self' blob:;
  font-src 'self';
  connect-src 'self' blob: data: https://api.cesium.com https://assets.ion.cesium.com
    https://tile.googleapis.com https://nominatim.openstreetmap.org
    https://overpass.kumi.systems https://overpass-api.de
    https://overpass.private.coffee https://query.wikidata.org;
  object-src 'none'; base-uri 'self'; frame-ancestors 'none'
  ```

  Drei Einträge kamen erst beim Bauen und Spielen dazu. Angular (Beasties, kritisches
  CSS) schreibt `onload="this.media='all'"` in die `index.html`; ohne den Hash bliebe
  das volle Stylesheet auf `media="print"`. `test/index-csp.test.js` schlägt an,
  sobald der Build weiteren Inline-Code enthält. `GLTFLoader` holt die in `.glb`
  eingebetteten Texturen per `fetch(blob:...)`, deshalb `blob:` in `connect-src` (im
  Smoke-Test aufgefallen). `AudioBufferCache` lädt Sounds, die als
  `data:audio/wav`-URL vorliegen, per `fetch`, deshalb `data:` (im ersten Spieltest
  aufgefallen, 20 blockierte Sounds).
  Abgenommen ist die Liste erst, wenn eine volle Partie (Ortssuche, Weltwürfel,
  Tiles, Straßen, Gebäude, Screenshot) ohne CSP-Verletzung in der Konsole läuft und
  der Netzwerk-Tab keine weiteren Hosts zeigt. Der Trainings-WebSocket
  (`localhost:3001`) bleibt draußen: Training läuft nur im Web-Dev-Build.
- **E21 Muss** Berechtigungsanfragen (Kamera, Mikrofon, Standort, Benachrichtigungen
  usw.) werden abgelehnt. Erlaubt ist nur das Schreiben in die Zwischenablage
  (Teilen-Link, Kopierknöpfe im Debug-Fenster).
- **E22 Soll** Electron-Fuses: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`,
  `EnableNodeCliInspectArguments` und `GrantFileProtocolExtraPrivileges` aus,
  `EnableEmbeddedAsarIntegrityValidation` und `OnlyLoadAppFromAsar` an.

### Daten

- **E23 Muss** `userData` ist `%APPDATA%\3DTD`. Token, Einstellungen und alles andere
  im `localStorage` bleiben über Updates erhalten.
- **E24 Muss** Deinstallieren lässt `userData` stehen, eine Neuinstallation findet den
  Token wieder.
- **E25 Muss** Downloads aus dem Spiel (Screenshot im Fotomodus, State-Dumps über
  `utils/download.ts`) landen ohne Dialog im Downloads-Ordner, wie in Chrome. Die
  Dateinamen tragen schon einen Zeitstempel. **Umgesetzt 2026-09-19**
  (`desktop/src/downloads.js`): ein belegter Name wird wie im Browser nummeriert
  ("name (1).png"), Pfadteile und unter Windows verbotene Zeichen fallen weg. Das
  Spiel meldet selbst nicht, dass etwas gespeichert wurde (im Web tut das die
  Download-Leiste des Browsers), deshalb zeigt eine Windows-Benachrichtigung
  "Saved to Downloads" mit dem Dateinamen; ein Klick darauf zeigt die Datei im
  Explorer. Die Benachrichtigung läuft unter der `appId` (`desktop/src/app-id.js`,
  auch vom Installer benutzt).
- **E26 Muss** Teilen-Link: `getShareUrl()` (`url-location.service.ts`) lieferte
  `window.location.href`, im Desktop also `app://app/?...`, das niemand öffnen kann.
  Ist die Origin nicht `http(s)`, zeigt der Link auf die Web-Version
  (`https://3dtd.sgeht.net/play/` plus Query). Eine Regel über das Protokoll, keine
  Electron-Prüfung. Web und `localhost` bleiben unverändert. **Umgesetzt 2026-09-19**
  als `shareableUrl()` in `src/app/utils/public-url.ts`; dieselbe Regel gilt für die
  Adresse in Korridor-Reports und Snapshots (`reportUrl`), damit man die Stelle aus
  einem Desktop-Report im Browser öffnen kann.

### Externe Dienste

- **E27 Muss** Anfragen an Nominatim, Overpass und Wikidata tragen einen User-Agent,
  der die App ausweist, etwa `3DTD/0.3.0 (+https://github.com/ingel81/3dtd)`.
  Gesetzt im Main-Prozess über `session.webRequest.onBeforeSendHeaders`, nur für diese
  Hosts. Grund: Nominatims Nutzungsbedingungen verlangen einen identifizierenden
  User-Agent oder Referer, die User-Agent-Richtlinie von Wikimedia ebenso. Im Web
  weist der Referer der Seite die App aus, unter `app://` fällt das weg. Den
  `User-Agent`, den `geocoding.service.ts` im `fetch` setzt, übernimmt Chromium nicht.
  **Umgesetzt 2026-09-18** (`desktop/src/user-agent.js`), vorgezogen aus Schritt 3,
  weil ohne ihn keine Partie startet: im ersten Spieltest lehnte `overpass-api.de`
  jede Straßenabfrage mit 406 ab. Nachgestellt per curl: 406 mit dem User-Agent von
  Chrome oder Electron ohne Referer, 200 mit dem der App. Im Smoke-Test gehen
  Overpass- und Nominatim-Anfragen mit `3DTD/0.3.0 (+https://github.com/ingel81/3dtd)`
  raus und kommen mit 200 zurück.
- **E28 Muss** Der Token-Dialog bleibt für beide Anbieter offen. Release-Text und
  README sagen: ein Google-Maps-Key oder Cesium-Token, der auf bestimmte Websites
  beschränkt ist, funktioniert in der Desktop-App nicht. Empfohlen ist ein
  Cesium-Ion-Token ohne URL-Beschränkung.
- **E29 Muss** Ohne Netz dasselbe Fehlerbild wie im Web (der Token-Test meldet "Could
  not reach the provider"). `did-fail-load` und `render-process-gone` zeigen eine
  Fehlerseite mit Neu-laden-Knopf statt eines weißen Fensters. **Umgesetzt
  2026-09-19** (`desktop/src/error-page.js`): eine `data:`-Seite ohne Skript, die
  weder eine Datei noch den `app://`-Handler braucht, falls genau der ausgefallen ist.
  Sie nennt Grund, Fehlercode und Version für ein Issue. "Reload" führt zur letzten
  Adresse des Spiels zurück, auch zu einer per `history.replaceState` gesetzten, ein
  Absturz mitten in der Partie landet also wieder am selben Ort.

### Update

- **E30 Muss** `electron-updater`, Provider GitHub (`ingel81/3dtd`). Das Repo ist
  öffentlich, der Client braucht kein Token.
- **E31 Muss** Prüfung beim Start und danach alle 6 Stunden. Download im Hintergrund,
  differentiell über die Blockmap. Installation beim Beenden
  (`autoInstallOnAppQuit`).
- **E32 Muss** Hinweis im Spiel, sobald ein Update geladen ist: klein, nicht modal,
  unterbricht keine Welle, bleibt bis zum Wegklicken. Etwa "Version 0.4.0 ist geladen
  und wird beim Beenden installiert", dazu ein Knopf "Jetzt neu starten", der sagt,
  dass er die laufende Partie beendet. Das ist die einzige Desktop-Stelle im
  Angular-Code: eine Komponente liest `window.desktop`; im Web gibt es das nicht, und
  sie rendert nichts.
- **E33 Muss** Keine Verbindung, GitHub nicht erreichbar, kaputtes `latest.yml`: nur
  ein Log-Eintrag, kein Dialog, das Spiel startet normal.
- **E34 Muss** Der Update-Weg ist vor dem ersten öffentlichen Release einmal
  durchgespielt: Version N installieren, N+1 bereitstellen, Download, Hinweis,
  Installation beim Beenden, Token danach noch da. Getestet gegen einen lokalen
  `generic`-Provider (`dev-app-update.yml`) oder ein Test-Repo, nicht gegen die echten
  Releases.

### Diagnose

- **E35 Muss** `electron-log`: Main-Prozess vollständig, Renderer-Konsole ab Warnung
  (über `console-message`). Datei `%APPDATA%\3DTD\logs\main.log`, rotiert (Richtwert
  5 MB, eine Vorgängerdatei).
- **E36 Muss** Kein Schlüssel im Log. Werte von `access_token=` und `key=` werden vor
  dem Schreiben maskiert. Nutzer hängen Logs öffentlich an Issues.
- **E37 Muss** F12 öffnet die DevTools. Eine Tastenkombination öffnet den Log-Ordner
  im Explorer; welche, wird beim Umsetzen gegen die Spieltasten
  (`input-handler.service.ts`) abgeglichen.

### Build und Release

- **E38 Muss** Eine Versionsquelle: die Root-`package.json`. Der Desktop-Build
  übernimmt sie (`extraMetadata.version`), `desktop/package.json` führt keine eigene
  Version. Passt der Tag `vX.Y.Z` nicht zur Version, bricht CI ab.
- **E39 Muss** `npm run dist` in `desktop/` baut lokal einen Installer, ohne etwas zu
  veröffentlichen.
- **E40 Muss** `.github/workflows/release.yml`: Trigger Tag `v*` und
  `workflow_dispatch` mit Tag-Eingabe (damit sich auch das schon getaggte `v0.3.0`
  bauen lässt), `windows-latest`. Schritte: `environment.ts` mit leeren Schlüsseln
  anlegen wie in `deploy.yml` (die Datei ist gitignored), Root `npm ci`,
  Production-Build mit `--base-href=/`, `desktop` `npm ci`, Tests, electron-builder mit
  `--publish always`. Ergebnis: Release-Entwurf mit `3DTD-Setup-X.Y.Z.exe`,
  `.blockmap` und `latest.yml`.
- **E41 Muss** `LICENSE` liegt im Installationsordner, dazu
  `dist/3DTD/3rdpartylicenses.txt` aus dem Angular-Build (Lizenzen der gebündelten
  Abhängigkeiten). Attributions-Dialog und Tiles-Attribution bleiben im Spiel
  erreichbar (CC-BY- und Google-Pflicht).
- **E42 Soll** Installergröße messen und hier festhalten. Was nicht ins Paket gehört
  (etwa `public/assets/images/logo/logo.psd`, 650 KB), fliegt über die
  `ignore`-Liste der Production-Config raus. Stand 2026-09-18, `win-unpacked`:
  440 MB, davon `3DTD.exe` 235 MB (Chromium), `app.asar` 119 MB (Spiel),
  Rest Chromium-Bibliotheken. Die Chromium-Sprachdateien sind auf `en-US` und `de`
  beschränkt (`electronLanguages`), das spart 47 MB. Installergröße folgt mit dem
  ersten `npm run dist`.
- **E43 Soll** README bekommt die Zeile "Download for Windows" mit SmartScreen-Hinweis
  (*Weitere Informationen → Trotzdem ausführen*). Der Knopf "Desktop app soon" in
  `landing/index.html` wird ein Link auf `releases/latest`.
- **E44 Muss** Kein lokaler Schlüssel im Installer. `scripts/copy-web.js` liest
  `cesiumIonToken` und `googleMapsApiKey` aus `environment.ts` und
  `environment.prod.ts` und bricht ab, wenn einer dieser Werte im Build steht. Die
  Dateien sind gitignored und können den eigenen Schlüssel des Entwicklers
  enthalten; eine falsche Zeile in `environment.prod.ts` würde ihn sonst in jede
  Kopie des Installers schreiben.

## Abnahme

Reine Logik prüfen Tests, der Nachtest am echten Rechner nur, was Augen und echte
Hardware brauchen.

**Automatisch** (Tests in `desktop/`, laufen in CI vor dem Build):

- Protokoll-Handler: MIME-Tabelle, SPA-Fallback nur ohne Endung, 404 bei fehlender
  Datei mit Endung, Pfad-Traversal (E2 bis E4)
- Link- und Navigationsregeln: was extern öffnet, was verworfen wird (E18, E19)
- Fenster-State: Rückfall bei fehlendem Monitor (E11)
- Log-Maskierung (E36)
- Abgleich Tag gegen Version (E38)
- Kein Inline-Code in der gebauten `index.html`, den die CSP nicht kennt (E20)
- Schlüssel-Sperre (E44)
- Teilen-Link als Vitest im Angular-Teil (E26)

**Smoke-Test der gepackten App** (über das DevTools-Protokoll, mit
`--remote-debugging-port`): Origin `app://app`, Stylesheet auf `media="all"`,
Token-Screen erscheint, `.wasm` als `application/wasm` und kompilierbar, Range-Anfrage
206, fehlende Datei 404, Route liefert HTML, Module-Worker und Blob-Worker laufen,
fremder Host von der CSP geblockt, Nominatim erreichbar, Navigation mit Query bleibt
in der App, `file://` wird verworfen, Standort und Benachrichtigungen abgelehnt,
Zwischenablage erlaubt.
Fenster und Eingabe mit echten Windows-Eingaben (`keybd_event`, `mouse_event`):
Tasten über das DevTools-Protokoll laufen nicht durch `before-input-event` und taugen
für F11 nicht als Nachweis. Geprüft: Erststart maximiert, nur Titelleiste über dem
Inhalt (kein Menü), F11 hin und zurück, Ctrl+Mausrad und Ctrl+Plus ändern den Zoom
nicht, Ctrl+R und F5 laden nicht neu, zweiter Start beendet sich und das erste
Fenster lebt weiter, Neustart stellt maximiert und Vollbild wieder her, Verlassen des
Vollbilds landet im vorherigen Zustand, gespeicherte Größe bleibt über drei Starts
gleich. Zuletzt grün am 2026-09-18.
Schritt 3 (2026-09-19): ein Download aus der Seite landet ohne Dialog in `Downloads`;
nach `Page.crash` zeigt das Fenster die Fehlerseite mit Grund und Version, "Reload"
führt zu der zuletzt per `replaceState` gesetzten Adresse zurück.

**Nachtest** (kommt nach der Umsetzung in `docs/PLAYTEST.md`):

- Installer: SmartScreen-Weg, Installation ohne Admin, Verknüpfungen, Erststart mit
  Token-Dialog
- Volle Partie unter `app://` ohne CSP-Verletzung, Ortswechsel, Weltwürfel,
  Screenshot, Teilen-Link
- F11, Fenster merken, Minimieren und Zurückholen, Zoom-Tasten, zweiter Start
- Update-Durchlauf (E34)
- Deinstallieren und Neuinstallieren, Token noch da

## Aufbau

```
desktop/                       Unterprojekt, eigene package.json ohne Version
├── package.json               electron, electron-builder, electron-updater, electron-log
├── .gitignore                 node_modules/, app/, release/
├── README.md                  Befehle und Stolperstellen
├── src/
│   ├── main.js                Start, Fenster, Sicherheits-Verdrahtung, dev oder app://
│   ├── app-id.js              appId für Installer, Benachrichtigungen, Updater
│   ├── protocol.js            app://-Handler: Pfade, MIME, Ranges, CSP
│   ├── security.js            Navigations- und Berechtigungsregeln
│   ├── preload.js             window.desktop
│   ├── downloads.js           Speicherort und Name für Downloads (E25)
│   ├── error-page.js          Fehlerseite bei Ladefehler oder Absturz (E29)
│   ├── shortcuts.js           F11, F12, sonst nichts
│   ├── user-agent.js          App-User-Agent für OSM und Wikidata (E27)
│   ├── window-state.js        Fenster merken und wiederherstellen
│   ├── updater.js             (Schritt 5) electron-updater, Status an den Preload
│   └── log.js                 (Schritt 4) electron-log, Maskierung
├── scripts/
│   ├── copy-web.js            dist/3DTD/browser → desktop/app/, mit Schlüssel-Sperre
│   ├── build-guard.js         findet lokale Schlüssel im Build (E44)
│   └── make-icon.sh           build/icon.ico aus dem Logo (ImageMagick)
├── build/icon.ico             App- und Installer-Icon, 16 bis 256 px
├── test/                      node:test, reine Funktionen aus src/ und scripts/
├── electron-builder.config.js NSIS, Fuses, Sprachen, Version aus der Root
├── app/                       kopierter Angular-Build (generiert)
└── release/                   Installer (generiert)
```

Die Aufteilung dient den Tests: Pfadauflösung, MIME, Ranges, Navigationsregeln,
Berechtigungen, Fenster-Rückfall und Maskierung sind reine Funktionen, die ohne
Electron unter `node --test` laufen. Die Config ist JavaScript statt YAML, weil sie die Version aus der Root-`package.json`
liest.

| Script | Zweck |
|--------|-------|
| `npm run dev` | Angular-Dev-Server + Electron mit Live-Reload |
| `npm start` | Angular-Build, Kopie, Start über `app://` |
| `npm run dist` | Angular-Build, Kopie, Installer nach `release/` |
| `npm test` | Tests aus `test/` |

## Reihenfolge

1. Gerüst, Protokoll, Sicherheit, Tests (E1 bis E7, E16 bis E22, E44).
   **Erledigt 2026-09-18** auf Branch `electron`, bis auf E7: der Dev-Modus ist
   eingerichtet, aber noch nicht gestartet
2. Fenster und Eingabe (E8 bis E15). **Erledigt 2026-09-18**, bis auf E14 (kein
   Hybrid-Laptop zum Prüfen) und die Frage, ob die Oberfläche bei 1024 × 600 noch
   brauchbar ist (Nachtest)
   Spieltest des Users am 2026-09-18 mit eigenem Token: läuft, 144 FPS in New York
   (erster Versuch mit dem Stand vor E27 lief ohne Straßen, siehe E27)
3. Daten und Dienste, dazu der Teilen-Link (E23 bis E29). **Erledigt 2026-09-19.**
   E23 und E24 prüft erst der Installer-Nachtest, E28 ist Text für README und
   Release (Schritt 6). Vom User am 2026-09-19 angespielt: Screenshot im Fotomodus
   (Taste O) mit Windows-Benachrichtigung, auch im Vollbild; "Copy link" öffnet
   denselben Ort in der Web-Version; GitHub- und Attributions-Links öffnen im
   Browser
4. Diagnose (E35 bis E37)
5. Update und Hinweis-Komponente (E30 bis E33)
6. Release-CI, Update-Durchlauf, README und Landing (E38 bis E43, E34)
7. Nachtest, danach das erste Release

## Bewusst nicht

- macOS und Linux
- Portable-ZIP (nachrüstbar, siehe Entscheidungen)
- Code-Signing im ersten Release
- Training im Desktop-Build
- Zweite Token-Quelle in `userData`
- Nachfrage beim Schließen während einer Partie; das Web fragt auch nicht
- Telemetrie und Crash-Upload
- Steam und itch.io (dort erwartet man "klicken, spielen", das beißt sich mit dem
  eigenen Token)
- Deep-Link in die App (TODO H15), vorerst. Skizze: der Installer registriert ein
  Schema wie `threedtd://open?l=...&s=...` (electron-builder `protocols`; `3dtd://`
  geht nicht, ein Schema muss mit einem Buchstaben beginnen). Der Link kommt beim
  Start über `process.argv` oder bei laufender App über `second-instance`; der
  Main-Prozess nimmt daraus nur `l` und `s`, prüft sie als Koordinaten und lädt
  `app://app/?l=...&s=...`, nie einen Pfad oder eine fremde URL. Weil Messenger
  eigene Schemata oft nicht klickbar machen und eine Webseite nicht erkennen kann,
  ob die App installiert ist, bleibt der geteilte Link https (E26); die Web-Version
  bekäme einen Knopf "In der Desktop-App öffnen". Echte https-App-Links gibt es unter
  Windows nur für Apps mit Paket-Identität (MSIX), nicht für einen NSIS-Installer.

## Code-Signing

Selbst-signiert bringt nichts: Windows vertraut nur CA-Ketten. Ein
Code-Signing-Zertifikat einer anerkannten CA kostet Geld, meist pro Jahr.

| Typ | SmartScreen | Preis/Jahr (grob) |
|-----|-------------|-------------------|
| **OV** (Organization Validation) | Warnung bleibt anfangs, verschwindet erst mit "Reputation" (genug Downloads) | ~150 bis 400 € |
| **EV** (Extended Validation) | Kein Warnscreen ab Tag 1 | ~300 bis 700 € |

- Seit 2023 muss der private Schlüssel auf Hardware (USB-Token, HSM) oder in einer
  Cloud-HSM liegen, eine `.pfx`-Datei auf der Platte ist nicht mehr erlaubt.
- Günstige Wege: **SignPath.io** kostenlos für Open-Source-Projekte, **Azure Trusted
  Signing** ~10 $/Monat, **Certum Open-Source-Code-Signing** ~70 bis 100 €.
- Ohne Signing zeigt SmartScreen "Der PC wurde durch Windows geschützt", der Nutzer
  klickt *Weitere Informationen → Trotzdem ausführen*. Lästig, kein Blocker.
- Auto-Update funktioniert auch unsigniert. Kommt später eine Signatur dazu, prüft
  `electron-updater` bei den folgenden Updates den Herausgeber-Namen des Zertifikats;
  ein Zertifikatswechsel mit anderem Namen bricht dann den Update-Weg.

## Aus dem PoC

**Verifiziert am 2026-05-16:** Prod-Modus über `app://` lief (3D-Tiles, WebGL,
Worker, ONNX-WASM). electron-builder erzeugte `3DTD-Setup-0.2.0.exe` (~352 MB) und
`win-unpacked/3DTD.exe` (~216 MB) mit eingebettetem Icon. Der Dev-Modus war
eingerichtet, aber nicht fertig getestet. Die 352 MB stammen aus der Zeit vor dem
Build-Trim; seitdem schließt die Production-Config `candidates/` und `onnx-wasm/` aus
(393 MB → 160 MB `dist`).

### winCodeSign-Symlink-Fehler bei `npm run dist`

electron-builder lädt das `winCodeSign`-Archiv (enthält u.a. `rcedit` für das Icon).
Das Archiv enthält macOS-Symlinks (`libcrypto.dylib`, `libssl.dylib`), deren Anlegen
Windows ohne erhöhte Rechte verweigert (`"Dem Client fehlt ein erforderliches
Recht"`). Der Build bricht ab.

Lösung, eine von beiden:

1. **Windows-Entwicklermodus aktivieren** (dauerhaft): Einstellungen → System → Für
   Entwickler → Entwicklermodus ein.
2. **Einmal als Administrator bauen**: danach liegt `winCodeSign` im Cache
   (`%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\`), Folge-Builds laufen ohne
   erhöhte Rechte.

Auf dem Entwicklungsrechner liegt der Cache seit dem PoC bereits. Ob der CI-Runner
`windows-latest` den Fehler zeigt, ist ungeprüft; beim ersten CI-Lauf ansehen.

### Netzwerk

electron-builder lädt beim ersten Build Electron-Zip, NSIS-Tooling und winCodeSign
von GitHub. Nur in stark abgeschotteten Umgebungen ein Thema.
