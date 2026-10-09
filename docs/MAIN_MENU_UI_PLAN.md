# Hauptmenü und Spieloptik (E119 bis E122)

Stand 2026-10-09, **gebaut** auf dem Branch `menu/main-menu-2026-10-08`, wartet auf den Nachtest
([PLAYTEST.md](PLAYTEST.md#h-hauptmenü-und-spieloptik-2026-10-09)). Hauptmenü, Wege in die Spielarten, Ladeanzeige und
die Optik von Menü, Dialogen, Panels und HUD (TODO E121 mit E119, E120, E122). Unten je Entscheidung, was gebaut ist
und wo es vom Vorschlag abweicht; die Einzelheiten stehen in der Fach-Doku (Tabelle „Wo es steht“).

## Ziel

- **Ein Ort für alles, was nicht Spielen ist.** Weiterspielen, neues Spiel, Ort wählen, Coop, Laden, Einstellungen,
  Extras und Beenden laufen über ein Menü. Vorher führten Ortsdialog, Continue-Leiste, Coop-Dock, Kopfzeile,
  Sidebar-Fuß und zwei Schnellmenüs je eigene Wege.
- **Das Spiel lädt hinter dem Menü.** Ort, Tiles, Straßen, Korridor und Simulation laden, während das Menü davor steht.
- **Optik aus einem Guss.** Ein SCSS-Fundament mit Platten, Titelplatten, Knöpfen und HUD-Platten; Stil der
  Projektseite: dunkler Stein, Messing, Oswald.
- **Einheitlich, komfortabel, klar.** Jede Aktion hat einen Weg; Tastatur, Fokus und Esc verhalten sich überall gleich.

## Entscheidungen und was gebaut ist

### Menü

1. **Eine Komponente, zwei Lagen.** Gebaut: `app-main-menu` ersetzt das Esc-Spielmenü (`game-menu`) und den
   Ladebildschirm (`loading-screen`); beide sind gelöscht. Lage Start mit großem Logo und Zeile „Tower defense on real
   streets“, Lage Pause mit kleinem Logo und „Paused | Ort | wave N“.
2. **Im Spielbaum.** Gebaut: Overlay im Template von `TowerDefenseComponent`, `MainMenuService` dort bereitgestellt;
   Rolle `dialog`, `aria-modal`, Fokusfalle, Name aus dem Seitentitel.
3. **Zustand** in `UIStore.mainMenu` (`open`, `layer`, `page`), geschrieben nur vom `MainMenuService`. HUD, Hotkeys,
   Steuerungshinweis und What's new warten, solange das Menü steht. Was ein Ort beim Laden zeigt (Musikwechsel,
   Routenanimation, Intro-Flug), wartet bis zum Schließen (`StartShowService`).
4. **Liste.** Gebaut wie vorgeschlagen, mit diesen Abweichungen: Coop steht in der Pause unter der Linie; Save nur mit
   begonnenem Lauf; im Coop-Spiel fallen Save, Load, Restart und New game weg. Continue an einem anderen Ort heißt
   „in Paris | wave 7“ und fragt „Leaves Heilbronn: the save plays in Paris.“ (E120); der Vergleich läuft über das HQ,
   das jeder Slot jetzt mitführt (`SaveSlotInfo.hq`), bei älteren Slots über den Ortsnamen.
5. **Start ohne Ort im Link.** Gebaut: keine ungefragte Ortung mehr, „Use my location“ steht auf New game. Ohne `?l=`
   wartet der Start auf die Wahl im Menü (`LocationChangeCoordinatorService.choosePlace`); als Vorschlag lädt dahinter
   der Ort des Autosaves, sonst der zuletzt gespielte (`startPlaceGuess`), bei einem Einladungslink keiner. Mit `?l=`
   steht Play vor Continue.
6. **Ladeanzeige.** Gebaut: Ladeplatte unten rechts mit Ortsname, Prozent, zehn Segmenten, laufendem Schritt und
   „Show steps“; Play und Continue tragen den Balken und merken sich einen Klick („Starts when loaded“). Feldtipps
   wechseln alle 8 s, der Versions-Chip nennt Version und Tile-Anbieter.
7. **Ortswechsel im Spiel.** Gebaut: jeder Ortswechsel (Kopfzeilen-Ortsknopf über New game, Würfel, Favorit, ein
   Spielstand an anderem Ort, ein Coop-Gast folgt dem Host) schaltet das Menü in die Lage Start; eine offene Seite
   bleibt dabei stehen. Fehler stehen in der Ladeplatte mit Retry, Other place und bei einem Engine-Fehler Map key. Das
   alte Fehler-Overlay bleibt nur ohne Menü (automatisierte Läufe) und ist eine Danger-Platte.
8. **Pause.** Gebaut wie vorgeschlagen: allein pausiert das Menü in beiden Lagen, im Coop nie.
9. **Token-Schritt.** Bleibt eigener Schritt; solange er steht, ist das Menü ausgeblendet. Settings, Map, „Change key“
   öffnet ihn; in der Lage Pause schließt das Menü dafür, in der Lage Start bleibt es dahinter.
10. **Automatisierung.** Gebaut: `?bot=` (außer `bot=manual`), `&benchmark` und `&menu=skip` lassen das Start-Menü weg
    (`startMenuSkipped`). Die E2E-Helfer drücken Play.

### Wege, die wegfallen oder umziehen

| Vorher | Jetzt |
|---|---|
| Esc-Spielmenü (`game-menu`) | Menü Lage Pause; Esc als letzter Schritt, „Menu“ im Sidebar-Fuß, „Main menu“ am Game Over |
| Ladebildschirm `loading-screen` | Ladeplatte im Menü |
| Continue-Leiste `continue-bar` | Eintrag „Continue“ |
| Ortsdialog (`location-dialog`) | Seite „New game“ mit der Ortswahl `app-place-picker` (Suche, Koordinaten oder 3DTD-Link, Use my location, Würfel, Spawn per Adresse, Listen Recent, Favorites, Showcase, World) |
| Coop-Reiter im Startdialog, `coop-entry` im Dock | Seite „Coop“: Name und Lobby oben, Host online, Join online, Same network untereinander; Beitritt auch ohne eigenen Ort |
| Kopfzeile „Coop“ | ohne Raum die Seite „Coop“, im Raum der Raum-Chip mit dem Dock |
| Schnellmenüs Display und Audio | Seite „Settings“; in der Leiste ein Knopf „Settings“ |
| Sidebar-Fuß World, Runs, GitHub | New game (Liste World), Extras (Runs, GitHub); der Fuß behält Menu, Tips, Version |
| Map key über More, Fehler-Overlay | Settings, Map, „Change key“; `?tokensetup` bleibt |
| Run-Upload-Schalter im Runs-Dialog | nur noch Settings, Privacy |

Abweichungen vom Vorschlag:

- **Lobby bleibt das Dock.** Das Dock zeigt nur noch Beitritt und Raum (Lobby, Bahnen, Chat), ohne Raum nur einen
  Fehler, der zum Verlassen führte. Wer über die Coop-Seite einen Raum betritt, bekommt Play, sobald der Ort steht;
  bis dahin bleibt das Start-Menü mit Ladeplatte vorne.
- **Lobby-Adressen** kommen nur über Settings, Coop, „Add lobby“ dazu; die Coop-Seite wählt nur.
- **Einladungslink** öffnet das Start-Menü auf der Seite Coop; im Browser der Website zeigt sie nur den Hinweis auf
  die Desktop-App mit dem Raumcode.
- **Spieltempo** in Settings ist das laufende Tempo, keine gespeicherte Voreinstellung.

### Optik

Die Optik dieses Umbaus (Oswald, Platten mit Eckwinkeln, Glas-Streifen, `_td-mixins.scss`, `pages/_menu-page.scss`) ist
mit E124 durch das Design System ersetzt: Putz, Basalt, Steinknöpfe, Barlow Semi Condensed, Tokens, Rezepte und
`td-*`-Klassen. Stand und Regeln in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md); das Logo als SVG
(`public/assets/images/logo/logo.svg`, `tools/logo/vectorize_logo.py`) bleibt.

## Wo es steht

| Teil | Dateien | Doku |
|---|---|---|
| Menü-Hülle, Lagen, Liste, Ladeplatte | `components/main-menu/` (`main-menu.service.ts`, `pages/home/`, `loading/`, `autosave-place.ts`) | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#hauptmenü) |
| Seiten New game, Save, Load, Settings, Extras, Coop | `components/main-menu/pages/` | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#menüseiten) |
| Ortswahl, Start wartet auf die Wahl | `pages/new-game/place-picker.component.ts`, `services/location/place-choice.ts`, `LocationChangeCoordinatorService.choosePlace`, `LocationFacadeService.initializeLocation`, `pages/start-places.ts` | [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md#ortswahl-menüseite-new-game) |
| Show erst nach dem Menü | `services/world/start-show.service.ts` | |
| Coop-Wege, Dock nur im Raum | `pages/coop/`, `components/coop-dock/` | [COOP_PLAN.md](COOP_PLAN.md), [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#coop-dock-squad-chat-canvas) |
| HQ im Slot (E120) | `services/save-game/save-slot.store.ts`, `save-game.ts` | [SAVE_LOAD_PLAN.md](SAVE_LOAD_PLAN.md) |
| Design System, Tokens, Schrift, Logo | `styles/td-theme.ts`, `styles/ui/`, `src/styles.scss`, `tools/logo/` | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#übersicht) |
| Kopfleiste | `components/game-header/` | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#kopfleiste) |
| Legal & privacy (E119) | `utils/public-url.ts` (`LEGAL_URL`), Links in Extras und im Attributions-Dialog | |
| E2E: Helfer, Bildtour | `e2e/support/game.ts`, `e2e/tests/ui-tour.e2e.ts` | [E2E.md](E2E.md) |

## Prüfung

- Je Paket: betroffene Specs, `tsc` App und Spec, Lint, Build; zwei Review-Runden über den gemergten Stand.
- Ablauf-Fälle (erster Start, Autosave am selben und anderen Ort, `?l=`, Einladungslink, Laden vor dem ersten Ort,
  Ortswechsel, Straßenfehler, Token, Game Over, Quit) je durch Szenario-Specs belegt, vor allem
  `main-menu.scenario.spec.ts` und die Specs unter `pages/`.
- Bildtour `e2e/tests/ui-tour.e2e.ts` in DevWorld.

## Offen

Nachtests mit Augen, Ohren, echter Karte und Desktop-App: [PLAYTEST.md](PLAYTEST.md#h-hauptmenü-und-spieloptik-2026-10-09).
