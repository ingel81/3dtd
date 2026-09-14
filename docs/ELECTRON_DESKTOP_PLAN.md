# Electron Desktop-Build: Umsetzungsplan

> **Status:** Proof-of-Concept abgeschlossen und wieder zurückgebaut (2026-05-16).
> Dieses Dokument hält den vollständigen Plan + alle Erkenntnisse aus dem PoC fest,
> damit die produktive Umsetzung jederzeit ohne Wissensverlust aufgesetzt werden kann.

## Ziel

Die 3DTD-Angular-App als eigenständige **Windows-Desktop-App** (Electron) ausliefern,
inklusive Installer (`.exe`). Der Web-Build bleibt davon vollständig unberührt.

## PoC-Ergebnis (verifiziert)

Der PoC hat folgendes nachgewiesen: die Ansätze funktionieren:

- **Prod-Modus** (`app://`-Protokoll-Load): Fenster startete, Spiel lief korrekt
  (3D-Tiles, WebGL, Worker, ONNX-WASM, alles funktionierte).
- **Installer-Build**: electron-builder erzeugte `3DTD-Setup-0.2.0.exe` (~352 MB)
  und `win-unpacked/3DTD.exe` (~216 MB), App-Icon eingebettet.
- **Dev-Modus** (`npm run dev`): eingerichtet, aber nicht final getestet.
- Versionen im PoC: **Electron 42**, **electron-builder 26**.

## Architektur-Entscheidungen

Diese Entscheidungen wurden im PoC getroffen und sollten übernommen werden:

| Thema | Entscheidung | Begründung |
|-------|--------------|-------------|
| Repo-Struktur | Eigenes Unterprojekt `desktop/` mit eigener `package.json` | Hält die Angular-Dependencies im Root sauber getrennt; `desktop/` ist ein reines Add-on |
| App-Laden (Prod) | Eigenes **`app://`-Protokoll** (registriert als `standard` + `secure`) | Echte sichere Origin: korrektes Routing/History-API, saubere Worker-/WASM-Auflösung, kein `file://`-Quirk. `<base href="/">` bleibt unverändert nutzbar |
| Run-Modi | Dev (`localhost:4200`, Live-Reload) **und** Prod (`app://`) | Dev für Entwicklung, Prod für Auslieferung |
| Installer | electron-builder, **NSIS**-Target | Standard für Windows-Installer |
| Tile-Provider | `cesium` (Bearer-Token) beibehalten | Origin-unabhängig; Google-Maps-Key wäre wegen HTTP-Referrer-Restriktion unter `app://` problematisch |
| Cross-Origin-Isolation | Bewusst **AUS** | `COEP: require-corp` würde die externen 3D-Tiles-Fetches (Cesium/Google) blockieren. ONNX läuft dann single-threaded; seit dem Wechsel auf den Regel-Director (2026-09-07) ohnehin irrelevant: das Modell wird im Betrieb nicht mehr geladen |

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

1. **Subprojekt anlegen**: `desktop/package.json`, `.gitignore`, Dependencies installieren.
2. **`main.js`**: `BrowserWindow` mit sicheren `webPreferences`
   (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, Preload).
   Dev: `loadURL('http://localhost:4200')`. Prod: `loadURL('app://app/')`.
3. **`app://`-Protokoll**: via `protocol.registerSchemesAsPrivileged` als
   `standard` + `secure` + `supportFetchAPI` + `stream`; Handler liest Dateien aus
   `desktop/app/` (asar-fest via `fs.promises.readFile`), setzt **explizite MIME-Typen**
   (wichtig u.a. `.wasm` → `application/wasm`) und macht **SPA-Fallback** auf
   `index.html` für Angular-Router-Routen ohne Datei-Endung.
4. **`preload.js`**: minimale `contextBridge`-API unter `window.desktop`.
5. **Build-Orchestrierung**: `scripts/copy-web.js` (Node `fs.cpSync`) kopiert
   `dist/3DTD/browser` nach `desktop/app/`.
6. **electron-builder**: `electron-builder.yml`: `win`/`nsis`-Target, `appId`,
   Output nach `desktop/release/`. Icon wird automatisch aus `build/icon.ico` gezogen.
7. **Best-Practice-Härtung**: siehe nächster Abschnitt (Block 1–7).
8. **Verifikation**: Dev-Modus, Prod-Load und Installer-Build je einmal durchtesten.
9. **`desktop/README.md`**: Kurz-Doku.

## Electron Best Practices / Must-haves

Reihenfolge = Empfehlung. **Block 1–7 lebt ausnahmslos in `desktop/main.js`**,
kein Eingriff in den Angular-Code nötig.

### Sofort sinnvoll (geringer Aufwand)

1. **Single-Instance-Lock** (`app.requestSingleInstanceLock()`): verhindert
   Doppelstart, fokussiert stattdessen das vorhandene Fenster.
2. **Menü entfernen** (`Menu.setApplicationMenu(null)`): das Standard-Electron-Menü
   ist für ein Spiel deplatziert. Plus **F11-Fullscreen-Toggle** (kein Auto-Fullscreen
   beim Start, das ist aufdringlich; Zustand merken).
3. **Fenster-State-Persistenz**: Größe/Position/Maximiert merken und wiederherstellen
   (manuell ~20 Zeilen oder via `electron-window-state`).
4. **Crash-/Lade-Handler**: `render-process-gone`, `did-fail-load` abfangen statt
   stummem weißen Fenster.
5. **Zoom sperren**: `webContents.setVisualZoomLevelLimits(1, 1)` + Tastatur-Handler
   gegen versehentliches Ctrl+Mausrad-/Ctrl+± -Zoom.
6. **`backgroundThrottling` bewusst setzen**: Electron drosselt Timer/rAF bei
   Fokusverlust. Für ein Tower-Defense entscheiden: `false` = läuft im Hintergrund
   weiter, `true` (Default) = pausiert faktisch. **Offene Entscheidung.**
7. **CSP + `will-navigate`-Guard**: Content-Security-Policy (als Response-Header im
   `app://`-Handler gesetzt, damit es nicht in `index.html` wandert) und ein
   `will-navigate`-Handler, der die App auf ihrer Origin hält.

### Sicherheit (im PoC bereits umgesetzt)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- `setWindowOpenHandler` → http/https-Links im System-Browser öffnen
- `webSecurity` bleibt an

### Später, bei echter Auslieferung

8. **`electron-log`**: Logging in eine Datei, damit Nutzer bei Bugs ein Log schicken können.
9. **`electron-updater`**: Auto-Update (gehört zu electron-builder). Braucht ein
   Publish-Ziel (GitHub Releases, S3 oder eigener Server). Praktisch ein Must-have,
   sobald die App verteilt wird.
10. **Code-Signing**: siehe eigener Abschnitt.

## Cesium-Token zur Laufzeit (Ship ohne eingebackenen Token)

Szenario: Die App ohne Cesium-Ion-Token ausliefern; jeder Nutzer trägt seinen
**eigenen** Token ein.

**Stand 2026-09-15: in der Web-App umgesetzt.** Der `ConfigService`
(`src/app/core/services/config.service.ts`) liest die Zugangsdaten zur Laufzeit
aus drei Quellen, die spätere gewinnt: `environment.ts` (in Production-Builds
leer, siehe `environment.template.ts`), `runtime-config.json` neben der
`index.html` (per `fetch` in `load()`, danach `loaded`) und der localStorage
(`3dtd-tile-credentials`), in den der Token-Dialog (`components/token-setup/`)
schreibt. Kein Token steht mehr im Bundle.

Für den Desktop-Build bleibt davon nur die Bridge: der `app://`-Handler liefert
`runtime-config.json` aus `userData` aus (siehe Tabelle unten), oder die App
verlässt sich auf den Token-Dialog. Der Rest dieses Abschnitts ist der Plan von
2026-05-16, nach dem das umgesetzt wurde.

### Lösung in 3 Schichten

| Schicht | Wo | Inhalt |
|---------|----|--------|
| **Persistenz** | Electron `userData`-Ordner: `%APPDATA%\3DTD\config.json` | Token liegt NICHT im Bundle, NICHT in `environment`. Überlebt App-Updates. Eigentümer: Electron Main-Prozess |
| **Bridge** | `app://`-Handler **oder** preload | Empfehlung: Handler fängt `app://app/runtime-config.json` ab und liefert `{ cesiumIonToken }` dynamisch aus `userData`. App macht nur `fetch('/runtime-config.json')`, identisch für Web (statische Datei) und Desktop, **ohne `if (electron)`-Branching** |
| **Eingabe-UI** | In-App-Overlay (Angular) **oder** Mini-Setup-Fenster (`desktop/setup.html`) | Beim ersten Start "Cesium-Token eingeben" mit Link zu `cesium.com/ion`. Speichern via preload → IPC → `config.json` |

### Der Angular-Eingriff (erledigt)

Geplant war genau eine Datei, `config.service.ts`: Config zur Laufzeit laden,
die Signals setzen, `loaded` auf `true`. So ist es umgesetzt, generisch für Web
und Desktop, ohne Electron-spezifischen Code. `environment.prod.ts` bleibt ohne
Token; `cesiumAssetId` (`2275207`, Google Photorealistic Tiles) ist nicht geheim
und bleibt als Default.

## Code-Signing (Kostenübersicht)

Selbst-signiert bringt nichts: Windows vertraut nur CA-Ketten. Ein
Code-Signing-Zertifikat einer anerkannten CA kostet Geld, meist pro Jahr.

| Typ | SmartScreen | Preis/Jahr (grob) |
|-----|-------------|-------------------|
| **OV** (Organization Validation) | Warnung bleibt anfangs, verschwindet erst mit "Reputation" (genug Downloads) | ~150–400 € |
| **EV** (Extended Validation) | Sofort kein Warnscreen ab Tag 1 | ~300–700 € |

- **Seit 2023:** Der private Schlüssel muss auf **Hardware** (USB-Token / HSM) oder
  in einer Cloud-HSM liegen; eine `.pfx`-Datei auf der Platte ist nicht mehr erlaubt.
- **Günstige Optionen:**
  - **Azure Trusted Signing**: ~10 $/Monat, cloud-basiert, kein Hardware-Token.
    Aktuell die preiswerteste seriöse Lösung (Identitätsprüfung nötig).
  - **Certum Open-Source-Code-Signing**: für Open-Source-Projekte ~70–100 € (inkl. Token).
  - **SignPath.io**: kostenlos für Open-Source-Projekte.
- **Ohne Signing:** SmartScreen zeigt "Der PC wurde durch Windows geschützt" →
  Nutzer klickt *Weitere Informationen → Trotzdem ausführen*. Nervig, kein Blocker.

**Empfehlung:** Für einen ersten Release **nicht signieren**, Thema aufheben bis
zum echten breiten Vertrieb.

## Stolpersteine (aus dem PoC)

### winCodeSign-Symlink-Fehler bei `npm run dist`

electron-builder lädt das `winCodeSign`-Archiv (enthält u.a. `rcedit` zum
Einbetten des Icons). Das Archiv enthält **macOS-Symlinks** (`libcrypto.dylib`,
`libssl.dylib`): Windows verweigert deren Anlegen ohne erhöhte Rechte
(`"Dem Client fehlt ein erforderliches Recht"`). Der Build bricht ab.

**Lösung, eine von beiden:**
1. **Windows-Entwicklermodus aktivieren** (dauerhaft, empfohlen): Einstellungen →
   System → Für Entwickler → Entwicklermodus EIN. Danach `npm run dist` erneut.
2. **Einmalig als Administrator bauen:** `npm run dist` in einer Admin-Konsole;
   danach liegt `winCodeSign` im Cache
   (`%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\`), Folge-Builds laufen
   ohne erhöhte Rechte.

### Netzwerk

electron-builder lädt beim ersten Build Electron-Zip, NSIS-Tooling und
winCodeSign von GitHub. Auf einem normalen Entwickler-Rechner mit Internetzugang
unproblematisch, nur in stark gesandboxten Umgebungen relevant.

## Offene Entscheidungen

- **`backgroundThrottling`**: Soll das Spiel im Hintergrund weiterlaufen (`false`)
  oder pausieren (`true`)?
- **Token-Eingabe-UI**: Das In-App-Overlay gibt es inzwischen
  (`components/token-setup/`). Offen ist nur, ob der Desktop-Build zusätzlich
  eine `runtime-config.json` aus `userData` ausliefert.
- **Code-Signing**: erst relevant beim breiten Vertrieb.
