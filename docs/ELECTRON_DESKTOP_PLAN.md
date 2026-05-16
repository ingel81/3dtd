# Electron Desktop-Build — Umsetzungsplan

> **Status:** Proof-of-Concept abgeschlossen und wieder zurueckgebaut (2026-05-16).
> Dieses Dokument haelt den vollstaendigen Plan + alle Erkenntnisse aus dem PoC fest,
> damit die produktive Umsetzung jederzeit ohne Wissensverlust aufgesetzt werden kann.

## Ziel

Die 3DTD-Angular-App als eigenstaendige **Windows-Desktop-App** (Electron) ausliefern,
inklusive Installer (`.exe`). Der Web-Build bleibt davon vollstaendig unberuehrt.

## PoC-Ergebnis (verifiziert)

Der PoC hat folgendes nachgewiesen — die Ansaetze funktionieren:

- **Prod-Modus** (`app://`-Protokoll-Load): Fenster startete, Spiel lief korrekt
  (3D-Tiles, WebGL, Worker, ONNX-WASM — alles funktionierte).
- **Installer-Build**: electron-builder erzeugte `3DTD-Setup-0.2.0.exe` (~352 MB)
  und `win-unpacked/3DTD.exe` (~216 MB), App-Icon eingebettet.
- **Dev-Modus** (`npm run dev`): eingerichtet, aber nicht final getestet.
- Versionen im PoC: **Electron 42**, **electron-builder 26**.

## Architektur-Entscheidungen

Diese Entscheidungen wurden im PoC getroffen und sollten uebernommen werden:

| Thema | Entscheidung | Begruendung |
|-------|--------------|-------------|
| Repo-Struktur | Eigenes Unterprojekt `desktop/` mit eigener `package.json` | Haelt die Angular-Dependencies im Root sauber getrennt; `desktop/` ist ein reines Add-on |
| App-Laden (Prod) | Eigenes **`app://`-Protokoll** (registriert als `standard` + `secure`) | Echte sichere Origin: korrektes Routing/History-API, saubere Worker-/WASM-Aufloesung, kein `file://`-Quirk. `<base href="/">` bleibt unveraendert nutzbar |
| Run-Modi | Dev (`localhost:4200`, Live-Reload) **und** Prod (`app://`) | Dev fuer Entwicklung, Prod fuer Auslieferung |
| Installer | electron-builder, **NSIS**-Target | Standard fuer Windows-Installer |
| Tile-Provider | `cesium` (Bearer-Token) beibehalten | Origin-unabhaengig; Google-Maps-Key waere wegen HTTP-Referrer-Restriktion unter `app://` problematisch |
| Cross-Origin-Isolation | Bewusst **AUS** | `COEP: require-corp` wuerde die externen 3D-Tiles-Fetches (Cesium/Google) blockieren. ONNX laeuft dann single-threaded — fuer das kleine Wave-Director-Modell unkritisch |

## Verzeichnisstruktur

```
desktop/                       NEUES Unterprojekt (eigene package.json)
├── package.json               electron, electron-builder, concurrently, wait-on
├── .gitignore                 node_modules/, app/, release/
├── main.js                    Main-Prozess + app://-Protokoll
├── preload.js                 contextBridge-API (window.desktop)
├── electron-builder.yml        NSIS-Installer-Konfiguration
├── scripts/copy-web.js         kopiert dist/3DTD/browser -> desktop/app/
├── build/icon.ico              App-/Installer-Icon
├── app/                        kopierter Angular-Build (generiert, gitignored)
└── release/                    Installer-Output (generiert, gitignored)
```

npm-Scripts in `desktop/package.json`:

| Script | Beschreibung |
|--------|--------------|
| `npm run dev` | Angular Dev-Server (`localhost:4200`) + Electron mit Live-Reload (via `concurrently` + `wait-on`) |
| `npm start` | Angular-Build + Laden via `app://` |
| `npm run dist` | Angular-Build + electron-builder → Windows-Installer |
| `npm run web:build` | nur Angular-Build + Kopie nach `app/` |

## Umsetzungsschritte

1. **Subprojekt anlegen** — `desktop/package.json`, `.gitignore`, Dependencies installieren.
2. **`main.js`** — `BrowserWindow` mit sicheren `webPreferences`
   (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, Preload).
   Dev: `loadURL('http://localhost:4200')`. Prod: `loadURL('app://app/')`.
3. **`app://`-Protokoll** — via `protocol.registerSchemesAsPrivileged` als
   `standard` + `secure` + `supportFetchAPI` + `stream`; Handler liest Dateien aus
   `desktop/app/` (asar-fest via `fs.promises.readFile`), setzt **explizite MIME-Typen**
   (wichtig u.a. `.wasm` → `application/wasm`) und macht **SPA-Fallback** auf
   `index.html` fuer Angular-Router-Routen ohne Datei-Endung.
4. **`preload.js`** — minimale `contextBridge`-API unter `window.desktop`.
5. **Build-Orchestrierung** — `scripts/copy-web.js` (Node `fs.cpSync`) kopiert
   `dist/3DTD/browser` nach `desktop/app/`.
6. **electron-builder** — `electron-builder.yml`: `win`/`nsis`-Target, `appId`,
   Output nach `desktop/release/`. Icon wird automatisch aus `build/icon.ico` gezogen.
7. **Best-Practice-Haertung** — siehe naechster Abschnitt (Block 1–7).
8. **Verifikation** — Dev-Modus, Prod-Load und Installer-Build je einmal durchtesten.
9. **`desktop/README.md`** — Kurz-Doku.

## Electron Best Practices / Must-haves

Reihenfolge = Empfehlung. **Block 1–7 lebt ausnahmslos in `desktop/main.js`** —
kein Eingriff in den Angular-Code noetig.

### Sofort sinnvoll (geringer Aufwand)

1. **Single-Instance-Lock** (`app.requestSingleInstanceLock()`) — verhindert
   Doppelstart, fokussiert stattdessen das vorhandene Fenster.
2. **Menue entfernen** (`Menu.setApplicationMenu(null)`) — das Standard-Electron-Menue
   ist fuer ein Spiel deplatziert. Plus **F11-Fullscreen-Toggle** (kein Auto-Fullscreen
   beim Start — das ist aufdringlich; Zustand merken).
3. **Fenster-State-Persistenz** — Groesse/Position/Maximiert merken und wiederherstellen
   (manuell ~20 Zeilen oder via `electron-window-state`).
4. **Crash-/Lade-Handler** — `render-process-gone`, `did-fail-load` abfangen statt
   stummem weissen Fenster.
5. **Zoom sperren** — `webContents.setVisualZoomLevelLimits(1, 1)` + Tastatur-Handler
   gegen versehentliches Ctrl+Mausrad-/Ctrl+± -Zoom.
6. **`backgroundThrottling` bewusst setzen** — Electron drosselt Timer/rAF bei
   Fokusverlust. Fuer ein Tower-Defense entscheiden: `false` = laeuft im Hintergrund
   weiter, `true` (Default) = pausiert faktisch. **Offene Entscheidung.**
7. **CSP + `will-navigate`-Guard** — Content-Security-Policy (als Response-Header im
   `app://`-Handler gesetzt, damit es nicht in `index.html` wandert) und ein
   `will-navigate`-Handler, der die App auf ihrer Origin haelt.

### Sicherheit (im PoC bereits umgesetzt)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- `setWindowOpenHandler` → http/https-Links im System-Browser oeffnen
- `webSecurity` bleibt an

### Spaeter, bei echter Auslieferung

8. **`electron-log`** — Logging in eine Datei, damit Nutzer bei Bugs ein Log schicken koennen.
9. **`electron-updater`** — Auto-Update (gehoert zu electron-builder). Braucht ein
   Publish-Ziel (GitHub Releases, S3 oder eigener Server). Praktisch ein Must-have,
   sobald die App verteilt wird.
10. **Code-Signing** — siehe eigener Abschnitt.

## Cesium-Token zur Laufzeit (Ship ohne eingebackenen Token)

Szenario: Die App ohne Cesium-Ion-Token ausliefern; jeder Nutzer traegt seinen
**eigenen** Token ein.

**Aktueller Stand:** Der Token steht in `environment.prod.ts` und wird beim
Angular-Build **fest ins JS-Bundle inlinet**. Fuer "ship ohne Token" muss er stattdessen
zur **Laufzeit** geladen werden.

**Gute Nachricht — der Konsum ist bereits zentralisiert.** In
`src/app/core/services/config.service.ts` liegt der `ConfigService`, der die Werte
als **Signals** exponiert (`cesiumIonToken`, `cesiumAssetId`, `tileProvider`, …).
Die gesamte App liest aus diesem einen Service. Es existiert sogar schon ein
`loaded`-Signal — asynchrones Laden ist architektonisch vorgesehen.

### Loesung in 3 Schichten

| Schicht | Wo | Inhalt |
|---------|----|--------|
| **Persistenz** | Electron `userData`-Ordner: `%APPDATA%\3DTD\config.json` | Token liegt NICHT im Bundle, NICHT in `environment`. Ueberlebt App-Updates. Eigentuemer: Electron Main-Prozess |
| **Bridge** | `app://`-Handler **oder** preload | Empfehlung: Handler faengt `app://app/runtime-config.json` ab und liefert `{ cesiumIonToken }` dynamisch aus `userData`. App macht nur `fetch('/runtime-config.json')` — identisch fuer Web (statische Datei) und Desktop, **ohne `if (electron)`-Branching** |
| **Eingabe-UI** | In-App-Overlay (Angular) **oder** Mini-Setup-Fenster (`desktop/setup.html`) | Beim ersten Start "Cesium-Token eingeben" mit Link zu `cesium.com/ion`. Speichern via preload → IPC → `config.json` |

### Der eine unvermeidbare Angular-Eingriff

`config.service.ts` — **eine Datei**: statt synchron aus `environment` zu
initialisieren, laedt der Service die Config zur Laufzeit, `.set()`-et die Signals
und flippt `loaded` auf `true`. App-Init wartet ggf. auf `loaded`. ~15 Zeilen.
Diese Aenderung ist **generisch** (Runtime-Config statt Build-Time-Inlining —
verbessert auch den Web-Build), kein Electron-spezifischer Code.

Zusaetzlich: `environment.prod.ts` shippt mit **leerem** `cesiumIonToken`
(lokales `environment.ts` behaelt den Token fuer die Dev-Arbeit).
`cesiumAssetId` (`2275207`, Google Photorealistic Tiles) ist nicht geheim und
bleibt als Default.

## Code-Signing (Kostenuebersicht)

Selbst-signiert bringt nichts — Windows vertraut nur CA-Ketten. Ein
Code-Signing-Zertifikat einer anerkannten CA kostet Geld, meist pro Jahr.

| Typ | SmartScreen | Preis/Jahr (grob) |
|-----|-------------|-------------------|
| **OV** (Organization Validation) | Warnung bleibt anfangs, verschwindet erst mit "Reputation" (genug Downloads) | ~150–400 € |
| **EV** (Extended Validation) | Sofort kein Warnscreen ab Tag 1 | ~300–700 € |

- **Seit 2023:** Der private Schluessel muss auf **Hardware** (USB-Token / HSM) oder
  in einer Cloud-HSM liegen — eine `.pfx`-Datei auf der Platte ist nicht mehr erlaubt.
- **Guenstige Optionen:**
  - **Azure Trusted Signing** — ~10 $/Monat, cloud-basiert, kein Hardware-Token.
    Aktuell die preiswerteste seriose Loesung (Identitaetspruefung noetig).
  - **Certum Open-Source-Code-Signing** — fuer Open-Source-Projekte ~70–100 € (inkl. Token).
  - **SignPath.io** — kostenlos fuer Open-Source-Projekte.
- **Ohne Signing:** SmartScreen zeigt "Der PC wurde durch Windows geschuetzt" →
  Nutzer klickt *Weitere Informationen → Trotzdem ausfuehren*. Nervig, kein Blocker.

**Empfehlung:** Fuer einen ersten Release **nicht signieren**, Thema aufheben bis
zum echten breiten Vertrieb.

## Stolpersteine (aus dem PoC)

### winCodeSign-Symlink-Fehler bei `npm run dist`

electron-builder laedt das `winCodeSign`-Archiv (enthaelt u.a. `rcedit` zum
Einbetten des Icons). Das Archiv enthaelt **macOS-Symlinks** (`libcrypto.dylib`,
`libssl.dylib`) — Windows verweigert deren Anlegen ohne erhoehte Rechte
(`"Dem Client fehlt ein erforderliches Recht"`). Der Build bricht ab.

**Loesung — eine von beiden:**
1. **Windows-Entwicklermodus aktivieren** (dauerhaft, empfohlen): Einstellungen →
   System → Fuer Entwickler → Entwicklermodus EIN. Danach `npm run dist` erneut.
2. **Einmalig als Administrator bauen:** `npm run dist` in einer Admin-Konsole —
   danach liegt `winCodeSign` im Cache
   (`%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\`), Folge-Builds laufen
   ohne erhoehte Rechte.

### Netzwerk

electron-builder laedt beim ersten Build Electron-Zip, NSIS-Tooling und
winCodeSign von GitHub. Auf einem normalen Entwickler-Rechner mit Internetzugang
unproblematisch — nur in stark gesandboxten Umgebungen relevant.

## Offene Entscheidungen

- **`backgroundThrottling`**: Soll das Spiel im Hintergrund weiterlaufen (`false`)
  oder pausieren (`true`)?
- **Token-Eingabe-UI**: In-App-Overlay (Angular, schoenere UX) oder separates
  `desktop/setup.html`-Fenster (100 % in `desktop/`)?
- **Auslieferung ohne Cesium-Token** ja/nein — falls ja, greift der Abschnitt
  "Cesium-Token zur Laufzeit".
- **Code-Signing** — erst relevant beim breiten Vertrieb.
