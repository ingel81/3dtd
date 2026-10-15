# TODO

**Offene Arbeit steht nur hier.** Handover, Berichte und Playtest-Listen führen keine eigenen Listen, sie verweisen
hierher. Offene Nachtests stehen in [docs/PLAYTEST.md](docs/PLAYTEST.md), Erledigtes in [DONE.md](DONE.md), Überholtes
in `docs/archive/` und in der Git-Historie.

**Drei Abschnitte, ein Weg:**

1. **Offen**: was gebaut oder entschieden werden soll, nach Gewicht. Besprochene Details für noch nicht Gebautes stehen
   im Eintrag (`Entschieden (User, Datum): …`); mehr als ein paar Entscheidungen bekommen ein Plan-Doc
   `docs/<THEMA>_PLAN.md`, hier steht dann nur der Verweis.
2. **Gebaut, wartet auf Test**: höchstens drei Zeilen, mit Verweis auf den Punkt in PLAYTEST.md. Die Entscheidungen
   wandern beim Bau in die Fach-Doku, der Verlauf steht in den Commits.
3. **Später und Ideen**: ohne Termin, höchstens drei Zeilen; Konzepte bekommen ein eigenes Dokument.

Nach dem Test geht ein Eintrag **nur auf Zuruf des Users** nach DONE.md. Die Kennungen (A1, C4, E106 …) bleiben stabil
und werden nicht neu vergeben, Neues bekommt die nächste freie Nummer. Nichts Internes ins Repo (Adressen,
Mitspielernamen, Gesprächsdetails).

Stand 2026-10-16 (Nachtschicht). 0.7.1 ist veröffentlicht (`origin/main` = `v0.7.1`). Die Arbeit seit 0.7.0 liegt
lokal auf `night/custom-maps-round2` (über 300 Commits, nicht gepusht; ein Push veröffentlicht auch die gesperrten
eigenen Karten, Coop-Protokoll 5). Die Worker-Runden vom 2026-10-15 sind übernommen (Abschnitt 2).

---

## 1. Offen


- [ ] **E1 Balancing aufrollen**: Phase 1 und 2 gebaut, Baseline und sechs Tuning-Runden gelaufen. Offen: Zielbänder
      (3b) und Kampagnenende (3a), [docs/BALANCING_PLAN.md](docs/BALANCING_PLAN.md).
- [ ] **E105 Spieltiefe, Rest der Balance-Nacht**: Schild am Skarnax-Kopf, Gegnereigenschaften Shielded und Aura,
      Mutator „Panzerung +1“.
- [ ] **E106 Menschenähnlicher Bot** ([BOT_PLAYER_PLAN.md](docs/BOT_PLAYER_PLAN.md), B1 bis B6 auf `next`): offen B7
      (Camo, Pfade, Bauzeit; seit 2026-10-05 auf `next`); Profile mit dem Lauf vom 2026-10-04 nachjustieren
      (`tools/play-profile`); Gold an den Coop-Partner im Browser auslösen (bisher nur per Spec).

### Bugs

- [ ] **E188 Objekte poppen beim Zoomen und Bewegen auf** (User, 2026-10-15, eigene Karten): stellenweise erscheinen
      Objekte sichtbar spät. User sieht es sich genauer an und liefert Screenshots; erst dann untersuchen (LOD-Wechsel,
      Sichtweite je Objekt, Culling). Verwandt: Bäume poppen nach `viewReady` (E183, `wt/fx-engine`).
- [ ] **C16 Zufalls-Spawn-Portal noch schräg** (User, 2026-09-17, Amsterdam "Westerstraat", nicht reproduziert): Trotz
      Verschieben auf ein gerades Stück (`cbdec4e5`) stand ein Portal schräg. Vermutungen: gerades Stück zu kurz (nur
      bis zur Ebene geprüft, Mindestlänge etwa 25 bis 30 m fehlt) oder die Gegnerlinie schwenkt am Start vom OSM-Punkt
      zur Bandmitte. Erst mit URL oder Snapshot eines neuen Falls debuggen.

### Features

- [ ] **E173 Wasser und Lava auf eigenen Karten schöner** (User, 2026-10-14 und 2026-10-15): Seen, Flüsse und gegossene
      Becken wirken billig; bessere Shader für Wasser (Reflexion, Ufer, Tiefe, Bewegung) und genauso für Lava,
      möglichst ohne Leistungsverlust (Kosten je Frame vorher/nachher messen, Grafikstufen beachten). Läuft seit
      2026-10-15 auf `wt/fx-water`.
- [ ] **E179 Objektmodelle und ihre Texturen verfeinern** (User, 2026-10-15): Gebäude und Co. wirken grob. Die rund
      450 Modelle unter `public/maps/assets/models/` baut `tools/map-assets/build_models.py` prozedural in Blender 5.1
      (CC0, keine KI-Generatoren, `LICENSES.md`). Im selben Weg verfeinern: Details an den Bauskripten (Fenster,
      Dachkanten, Sockel, Kantenfasen), Texturen in Blender (Verdeckung, Kantenabnutzung, Schmutz backen; höhere
      Auflösung wo es lohnt, heute WebP 512 px), LODs neu (`make_lods.py`, `match_lods.py`), im Budget (Scene cost,
      E169). Zuerst die Gebäude aus dem Showreel; Vorher/Nachher-Bilder je Modell zur Abnahme.
- [ ] **E195 Spiel, Editor und Welten aus einem Guss** (User, 2026-10-15, für später; großer Punkt, erst Plan-Doku
      und Abstimmung): Spiel und Editor fühlen sich wie zwei getrennte Anwendungen an, beide nicht richtig mit dem
      Hauptmenü verknüpft; das Hin und Her zwischen Editor, Karte und Spiel und zwischen echten Orten (3D-Tiles), eigenen
      Karten und OSM-Karten (im Grunde auch eigene Karten) ist nicht flüssig, teils lädt die Seite neu. Ziel:
      - eine zusammenhängende Anwendung: Hauptmenü, Spiel und Editor als Teile eines Ganzen, Wechsel ohne Neuladen
        und ohne Änderung der URL (die Desktop-App hat keine Adresszeile: jeder Weg muss über die Oberfläche gehen)
      - jederzeit klar: wo man ist (Welt, Karte, Spiel oder Editor, laufender Lauf), wohin man kann, und was nicht geht
        und warum (etwa kein Map-Key für 3D-Tiles: sichtbar, mit dem Weg zum Key, statt versteckt)
      - möglichst viele Optionen von überall: aus dem Spiel in den Editor und zurück in denselben Lauf, aus dem Editor
        in ein Probespiel, aus einem echten Ort eine Karte, Laden und Speichern quer über die Welten
      - Idee (User): ein globaler Umschalter für das, was man gerade tut (echte Orte, eigene Karten, OSM-Karten, Editor),
        und je Welt ein eigener Hintergrund hinter dem Menü statt immer des echten Globus, etwa ein eigener Globus oder
        eine Kartenwelt für die Custom Maps, damit sichtbar ist, dass es mechanisch dasselbe Spiel in anderer Welt ist;
        der Wechsel nahtlos, ohne Klick-und-Neuladen
      - Idee (User, 2026-10-15 abends): Neuladen landet heute immer gleich in der Echtwelt (Tiles laden). Stattdessen
        zum Start drei Globen nebeneinander: echte 3D-Tiles (ausgegraut ohne Token, mit dem Weg zum Token), ein
        schematischer Globus für die OSM-Welt, ein comichafter in Engine-Grafik für die mitgelieferten und eigenen
        Karten. Ein Klick holt den Globus groß nach vorn (wie heute der Menü-Globus), geladen wird erst mit Start im
        Menü. Klick-Dummy dazu: `tmp/plan/mockups/world-globes/`
      Plan: [WORLDS_NAVIGATION_PLAN.md](docs/WORLDS_NAVIGATION_PLAN.md) (Bestand, Zielmodell, 7 Phasen, offene Entscheidungen);
      gewählte Darstellung: Globen, Menü links, letzte Welt groß, Globus mittel, Hintergrund je Welt, großzügig.
      Vorgehen: alle heutigen Wege aufnehmen (Startmenü-Reiter, New game, Pausemenü, Game over, Editor-Kopf, Testfenster,
      Spielstände, Links, Desktop), Brüche und Neuladen benennen, ein durchgängiges Modell vorschlagen (Plan-Doku),
      mit dem User per Baukasten/Entwürfen abstimmen, dann bauen.
- [ ] **E184 Mitgelieferte Karten imposanter** (User, 2026-10-15): die meisten Karten sind noch zu langweilig, es muss
      deutlich mehr gehen (Kulisse, Höhenunterschiede, Blickpunkte, Wahrzeichen, dichtere und abwechslungsreichere
      Gestaltung). Bekannte Stellen aus dem Showreel: Wald in Autumn Keep trüb und aus der Distanz braun, Burg in der
      Dämmerung nur Silhouette, langer leerer weißer Hang in Frost Hamlet. Nach E180 (Fehler zuerst; fx-maps schreibt
      je Karte Vorschläge, liegen vor zur Auswahl durch den User); je Karte ein Vorschlag mit Vorher-Bildern, dann die Level-Skripte
      (`tools/maps/levels/`, `LevelKit`) ausbauen. Hängt mit E179 (bessere Modelle) und E182 (Showreel) zusammen.
- [ ] **E190 Karten lebendiger** (User, 2026-10-15): neben der Gestaltung (E184) Bewegung und Leben in der Welt, z. B.
      Vogelschwärme, Rauch aus Schornsteinen, Fahnen, Boote, die treiben, Glühwürmchen und Funken bei Nacht, Tiere am
      Rand, Umgebungsgeräusche je Biom; alles billig (Partikel, Shader, wenige Instanzen) und je Grafikstufe abschaltbar.
      Vorschläge je Karte zusammen mit E184. Entschieden (User, 2026-10-15): allgemeine Mechanismen, auch im Editor
      setzbar und einstellbar (Katalog/Effekt-Objekte, Bereiche, Map-Kit- und MCP-Befehle); die mitgelieferten Karten
      bekommen ihr Leben nur über dieselben Editor-Funktionen, keine Sonderwege je Karte. Gilt ebenso für E184.
- [ ] **E182 Showreel-Video, nächste Runde** (User, 2026-10-15; geparkt, bis Fixes, Karten und offene Features stehen):
      Rig auf `wt/showreel` (`tools/showreel/`), Take 8 sauber, lange (12 min) und kurze Fassung (1:30) abgelehnt:
      zu lahm, noch Fehler. Wünsche: kurzes Intro bis zum Editor; Editor-Funktionen auf vier Karten im Wechsel, auch
      Mars und Mond; „Fire and Ice“ mit passendem Grundmaterial statt Wiese (weniger Grün); Kampf am Schluss nicht
      abrupt enden lassen; Outro auf Mars, Mond oder einem anderen Planeten mit eindrucksvoller Kulisse, nicht dieselbe
      Karte wie am Anfang. Kurze Fassung: zeigt das Wichtige nicht, lässt zu viel aus und schneidet teils im falschen
      Moment (mitten in der Aktion statt nach der sichtbaren Wirkung). Schnitt mit `tmp/showreel/edit/build.py long|short`.
- [ ] **E103 Ego-Steuerung des Helden** (User, 2026-10-02).
- [ ] **E83 AppImage und AUR** (2026-09-30): gebaut 2026-10-05 (statische Laufzeit, Update-Information und `.zsync`,
      AUR-Paket `3dtd-bin` mit CI-Job). AUR ok, der Job lief im Release 0.7.0 grün. Offen beim User nur: das AppImage
      einmal auf Linux starten (PLAYTEST A3.2).
- [ ] **E134 Eigene Karten freigeben** (entschieden 2026-10-11): erst wenn alles Abgestimmte steht (E130 bis E133, auch
      Wellen-Editor und Zerstörung). Dann `CUSTOM_MAPS_RELEASED` an (`src/app/world/custom-maps-open.ts`) und
      `.3dtdmap`-Zuordnung im Installer. Die Karten-Daten (194 MB) kommen beim ersten Öffnen einer Karte vom Webserver
      (Fortschritt, danach Cache; die Desktop-App legt sie auf die Platte), nicht im Installer. Die Level bleiben eine
      einfache Liste (keine Bestwerte, keine Kampagne).
      Vorbereitet 2026-10-12: Nachladen mit Cache und Fortschritt (`map-data.ts`, `mapData` in der runtime-config);
      offen: Daten auf den Webserver, CORS, CSP der Desktop-App ([CUSTOM_MAP_WORLD.md](docs/CUSTOM_MAP_WORLD.md#laden)).

### Assets

- [ ] **A1 Herkunft von 5 Gegnermodellen** (Ghost, Hornet, Mech, Wraith, zombie_v2), Einträge in
      `attributions.config.ts` nachtragen. Der User sucht die Quellen, low prio; Stone Golem und Herbert sind eigene
      Modelle.

### Mit dem User klären

- [ ] **Entschieden 2026-10-15 (Entscheidungsseite, Runde 1):** Push nach den Nachtests, auf `next` auch früher,
      sobald alles in einem Branch liegt; **kein Release auf main**. E184/E190: alle 13 Karten hohe Priorität, die
      angehakten Vorschläge plus Leben (Liste in der Entscheidungsseite, Notizen in `tmp/plan/IMPOSING_MAPS_2026-10-15.md`).
      Optik abgenommen: Lava, Kartenrand, Kai, Laternen, Strand. E185: Variante B (Shader-Umfärben). E179: alle
      Kategorien, zuerst Feinschliff, nach Bedarf mehr. E171 Teil 2: Statusanzeige, Schalter im Editor, Agenten-Band,
      voller Werkzeugkasten, Karten öffnen. E182: Demo Valley, Red Canyon, Ember Crater, Ruined City; Outro Mond; kurze
      Überflüge. E12: so lassen. E186: User sieht es sich an, niedrigste Priorität. E157: MapLibre, immer 2,4 km,
      Budget nach Scene cost, Höhendaten per Probe wählen, Gebäude gemischt.
- [ ] **Entschieden 2026-10-15 (Runde 2):** E134 Kartendaten vom eigenen Webserver (dieselben Dateien wie /play/,
      CORS per .htaccess, Server in der CSP der App). E185 Variante B bestätigt. E157 OSM: Spawns und Wege der Gegner
      genau wie auf echten Orten (plus Editor), Tunnel mit einem Tunneleingang-Modell an beiden Enden (nicht das
      Spawn-Portal; Modell fehlt noch, mit E179), dazwischen unsichtbar; Menüpunkt auch für Spieler mit Token;
      Splat 2048 für OSM-Welten.
- [ ] **E12 Heilung oder kürzere Kampagne?** Entschieden 2026-10-15: so lassen. (vorher vertagt, Tendenz "so lassen"): Der Könner verliert in W24-29 je 8 bis 14 HP und nichts heilt; die drei Antworten stehen in
      [docs/BALANCING_PLAN.md](docs/BALANCING_PLAN.md), "Was das Tuning nicht lösen kann". Hängt an D10.

### Review-Reste

- [ ] **E94 Rest aus dem Review Sicherheit und Desktop** (Review 2026-10-01; der Rest von E92 und E94 ist am
      2026-10-05 gebaut, Rest im Nachtest PLAYTEST A2.3):
      - Windows-Installer und Auto-Update ohne Code-Signierung. Entschieden (User, 2026-10-01): vorerst nicht, wieder
        ansehen, wenn die App mehr Nutzer hat.
      - Der LAN-Relay der Desktop-App lauscht auf allen Schnittstellen (für LAN-Spiel nötig) und nimmt Verbindungen
        ohne Origin an.
      - Testlücke: `tower-defense.component` selbst.

---

## 2. Gebaut, wartet auf Test

### Worker-Runden 2026-10-15 (übernommen, Nachtests in PLAYTEST.md C)

- [ ] **E177 Editor-Fehler, E191 Gebäude ebnen ihren Boden**: Nachtwechsel ohne Standbild, Auto paint, Toast, Day/Dusk,
      Hölle-Pinsel auf voller Liste, Fill a hollow, Look auf blankem Boden, Baumschatten beim Malen (PLAYTEST C).
- [ ] **E178, E181, E183, E193**: Test ab Welle N mit Forschung, Wetter füllt das Bild, kein Schwarz und Aufploppen im
      Intro, Ladeplatte bis alles steht (PLAYTEST C).
- [ ] **E180, E173**: Karten nach strengem Check, Wasser mit Spiegelung und Uferwellen, Lava als Krustenplatten (PLAYTEST C).
- [ ] **E185 Zombies** mit Kleidungsvarianten und Gangbild, **E192 Strand-Biom**, **E194 Erde aus Blue Marble** (PLAYTEST C).
- [ ] **E102 Neue Tower** Iron Bastion, Sentinel Laser, Chainsaw, Shawarma Slicer; **E101** Pfade Sniper, Caustic,
      Binding Sigil; **E20** Kameraplätze Shift+F1..F5; **E109** Forschung ziehen (PLAYTEST C).
- [ ] **Biome**: mehr Baumarten in Wiese, Dorf, Wüste, neues Herbst-Biom (PLAYTEST C).

### Runde 2026-10-14 tagsüber (Branch `night/custom-maps-round2`, nicht gepusht)

Nachtest-Liste in `tmp/NEXT_SESSION.md`, kommt nach PLAYTEST.md, wenn der User Zeit hat.

- [ ] **E202 Ferne Berge am Kartenrand**: Fels an Steilflanken, Rinnen, Schnee/Staub je Look, Gipfel aus dem Dunst
      (Moon Base, Mountain Pass, Red Canyon, Frost Hamlet zum Horizont).
- [ ] **Editor** E158 Tour 23 Schritte, E159 Probewelle 1x bis 8x, E165 Seitenleiste umbrechend mit Anfasser, E166
      Hilfe-Reiter, E167 ruhiges Create map, E168 Werkzeug Look (Esc), E169 Scene cost statt Objektzahl.
- [ ] **E170 Eigene Karten nach E154**: Bauflächen-Overlay, Test ab Welle N, Difficulty, Mars nach NASA-Farben, Plant
      motion, Standbild B, Schatten über 4 Frames; E156 Grafik-Einstellungen nach Welt getrennt.
- [ ] **Welt** E155 Felsen auf ihrer Platte und Schwebe-Check, E160 Routen auf dem Boden, E161 Routen auf dem
      Brückendeck, E162 Lava ohne Querstreifen, E163 Gischt nur wo das Wasser landet, E164 Schattenbox nach Boden;
      Boote, Bojen und Seerosen auf dem Wasser, Schwebe-Check (Editor-Warnung, strenger Check), kein Schilf auf
      Flanken über 30°, glatte Uferlinie; kein schwarzes Bild und Flackern bei dynamischer Auflösung (Auto/Medium).
- [ ] **Gelände und Himmel** E172 8 CC0-Bildhimmel, E174 Pour flutet keine flachen Ebenen, E175 12 Bodenschichten
      (Dateiversion 3), E176 kürzere Diagonale je Zelle (glatte Wände; Prüfsummen eigener Karten geändert); Fill a hollow
      bis zum Rand, Flüsse im Bett, Speicher-Hinweis, Kartenname per Link, kein verlorener Strich.
- [ ] **E171 Teil 1** MCP-Server in der Desktop-App ([AGENT_MCP.md](docs/AGENT_MCP.md)), `run_script`, 19 Werkzeuge.
- [ ] **E153 Desktop auf der starken GPU**: in 0.7.1 ausgeliefert, auf dem Laptop geprüft (PLAYTEST A3.3); nach DONE
      auf Zuruf.
- [ ] **E198 OSM-Häuser**: Einfamilienhäuser statt Reihenhaus-Reihen und Blöcke (Nachbarschaft unter 180 m², Block erst ab
      400 m²), Modellwahl per Salz, Tönung je Grundriss; Erlenbach 74235 im Editor ansehen.
- [ ] **E201 Bauverbot als Rechteck**: Gebäude und Mauern sperren und sitzen nach ihrem gedrehten Rechteck (Katalog `box`);
      neben einer langen Schule bauen, Sitz am Hang.
- [ ] **E197 Rauchsäule** `fx-smoke-column` (Life-Panel „Tall smoke column“), Ember Crater mit drei Säulen; dort ansehen.
- [ ] **E187 Baumvariation**: Herbstlaub streut Rot bis Gelb je Baum, Pflanzen in der Größe; Autumn Keep über dem Wald.
- [ ] **Klippen geschlossen**: Klippen-Scans mit Rückseite, Felsen ab Fuß der Kante, keine Streifen an Steilwänden;
      Archipelago Leuchtturmfelsen, Demo Valley Crag.
- [ ] **Mond, Mars, Hafen**: Schleusen zu, Radarschüssel ebnet ihren Boden, Kraterauswurf statt Steinkreise, Fischerboot,
      Asphalt in Harbor Town, Gewächshaus mit dunklem Glas (nur 2 auf Mars), Mover-Routen frei.
- [ ] **Bojen blinken, Ballista-Bolzen mit eigenem Ton** (Dev-Build, Ballista Bolts); **OSM-Tunnel mit Portalen** (Miltenberg).
- [ ] **OSM: Gehweg und Pflaster eine Schicht** (graue Platten `sidewalk`), eine Bodenschicht mehr für die Landnutzung;
      eine neue OSM-Welt mit Fußgängerzone erzeugen.
- [ ] **E199 Ortssuche im New game**: Treffer fließen unter dem Feld, der Dialog wächst; Kartenwelt › A map of a real place.
- [ ] **E200 Wegknoten in Look**: außerhalb von Roads kleine Punkte statt großer Scheiben; OSM-Karte im Editor, Look.
- [ ] **Straßenbelag am Weg**: Roads, Straße wählen, „Surface“ (Asphalt, Pflaster, Kies …) sofort, mit Undo, bleibt bei Rebuild.
- [ ] **E189 Lichter nachts**: Lichtfleck breiter und heller, größerer Hof, Pool kräftiger, Licht auf Wasser, Lava glüht
      weiter; Autumn Keep und Witch Marsh nachts ansehen.

### Nachtschicht 2026-10-14 (Branch `night/custom-maps-round2`, nicht gepusht)

- [ ] **E154 Eigene Karten rund** gebaut, alle Phasen aus [CUSTOM_MAPS_NEXT_PLAN.md](docs/CUSTOM_MAPS_NEXT_PLAN.md) mit zwei
      Review-Runden: PLAYTEST B1 bis B4. Coop-Protokoll 5: Relay und Spiel zusammen ausrollen. Vor E134.
- [ ] **Nach der Nachtschicht (2026-10-14 vormittags)**: Baumschatten springen nicht mehr, wenn der Blick über den
      Kartenrand geht; Hauptmenü mit Reitern „Real places | Custom maps“, eigenes Continue und Autosave je Welt:
      PLAYTEST B5.

### Rest nach Release 0.7 (PLAYTEST A)

- [ ] **Coop App gegen App** (PLAYTEST A1): A1.1 Raumliste (E31), A1.2 Einladungslink und Beitritt ohne Ort, A1.3 Same
      network (E119 bis E122), A1.4 Coop nach Solo-Lauf, A1.5 Forschungspreise des Partners, A1.6 Resync (E110 ff.).
- [ ] **App und Web** (PLAYTEST A2): A2.1 Quit und Links, A2.2 Datei laden im Lauf, A2.3 Konsole auf `/play/` ohne
      CSP-Verletzung (E92, E94a), A2.4 Globus Low/Off (E126).
- [ ] **Nur wenn es passiert oder ein Gerät da ist** (PLAYTEST A3): A3.1 Kartenserver lehnt ab, A3.2 AppImage (E83).

### Ohne festen Nachtest (im Spiel nebenbei)

- [ ] **E139 Söldner-Ton** neu (`hero_hire_bolt` v1): Söldner anheuern und hinhören.
- [ ] **E86 Simulationsrate 30, Bild interpoliert** ([SIM_WORKER.md](docs/SIM_WORKER.md)): ansehen, ob die Drehung mit
      dem Stand springt und Auren und Flammen mitgleiten.
- [ ] **E14 Luftwellen**: der Deckel lässt bei zähen Luftgegnern (Drache) fast nur Leck zu, gerechnet so gewollt; falls
      zu hart: Leck-Kontingent nach Tötbarkeit gewichten, bei großem Spawn-Abstand Rate 0,8.
- [ ] **E15 Rakete**: in reinen Luftwellen 18 % des Schadens (vorher 7 %); offen nur, ob sie sich richtig anfühlt.
- [ ] **E52 Tower-Balance**: Schaden je Gold Kanone 3,2, Magic 3,0, Archer 0,7 (Bot-Läufe); offen, ob ein menschlicher
      Lauf Kanone oder Archer anders erlebt.
- [ ] **E43 Coop-Masken des Hosts mit groben Kacheln**: auf einer echten Karte prüfen.
- [ ] **E93 Route, Zellen, Spawn und HQ schweben nach dem Laden**: Neubau im neuen Rahmen; im Spiel bestätigen, sonst
      [ROUTE_CORRIDOR.md](docs/ROUTE_CORRIDOR.md), „Vorgehen, wenn die Route wieder schwebt“.
- [ ] **Eigene Karten E130 bis E133** (gesperrt): Spurenwahl, Zerstörung in der Simulation, Regeln, vier Level
      ([SHOWCASE_LEVELS.md](docs/SHOWCASE_LEVELS.md)); der Augen-Nachtest geht in E180 auf.

### Getestet, nach DONE auf Zuruf

- [ ] **Nachtschicht 2026-10-12**: abgestimmte Runde E136 bis E138, E141 bis E146, E151, E152 (X1 bis X11),
      Optik-Runde E140, E147 bis E150 (X12 bis X15), E135 Replay an einem anderen Ort (X16), Nachmittag mit Minikarte,
      Benchmark bis 25k, Kartenserver-Meldung, Sinkflug, Tipp, E123 (Y1 bis Y4); alle ok laut
      [PLAYTEST_2026-10.md](docs/archive/PLAYTEST_2026-10.md).
- [ ] **Eigene Karten und Editor E61, E129** (V1 bis V4), **Hauptmenü E119 bis E122** (H1, H2, H5), **Design System E124**
      (H6), **Weltkugel E126** (G1, G2, G3.2), **E127** (U1, U2), **nach 0.6** E110 bis E115, C17, E97, E100, E101,
      E104 (S1 bis S4 bis auf die Reste in A), Coop N21, T79, K8.4, Zwischenschritt von H16 (N19); Reste stehen oben in A.

---

## 3. Später und Ideen

- [ ] **E170 Rest (C)**: Intro-Kameraflug, DevWorld durch Testkarten ersetzen; KTX2 für Modelltexturen nur mit
      Roh-GLBs ([CUSTOM_MAPS_NEXT_PLAN.md](docs/CUSTOM_MAPS_NEXT_PLAN.md)). Prefabs, Ereignisse je Welle und HP-Kurve gebaut.
- [ ] **E169 Rest**: einmalig 5,09 ms auf Ultra im Demo-Tal (`dda5daf4`), ungeklärt; nur mit neuem Beleg angehen.
- [ ] **E171 Teil 2 KI-Agent baut Karten** (Desktop-App, Entscheide in [AGENT_MCP.md](docs/AGENT_MCP.md)): Rest nach
      Teil 1, Umfang offen (Abschnitt 1, „Mit dem User klären“).
- [ ] **E157 OSM-Welt: spielen ohne Token oder als eigene Karte** (User-Idee 2026-10-14, mit E128 zusammengelegt;
      entschieden mit dem User): Spieler ohne 3D-Tile-Token spielen trotzdem auf „ihrer“ Adresse. Zwei Wege aus derselben
      erzeugten Welt: direkt spielen, oder in den Editor nehmen und bearbeiten (auch nachträglich aus einem laufenden oder
      gespielten Ort). Ortssuche wie im Spiel, Rahmen auf einer flachen OSM-Karte. Gelände aus freien Höhendaten
      (Terrarium/Copernicus, etwa 30 m Raster, geglättet). HQ auf der Adresse, Spawns wie auf echten Orten (Portale auf
      Straßen, 500 bis 1000 m, verschiebbar), Gegner auf dem OSM-Straßennetz; die Karte wird so groß, dass alle Spawns
      drin liegen. Gebäude: jeder Grundriss bekommt ein passendes Katalog-Modell nach Größe, Form und Art, auf den
      Grundriss gedreht; fehlen Modelle, kommen neue in den Katalog. Erste Fassung mit allem, was geht: Gelände, Straßen,
      Brücken, Gebäude, Landnutzung zu Biomen (Wald mit Bäumen, Wiese, Acker, Sand, Fels), Gewässer (Seen, Flüsse,
      Küste), Ausstattung (Zäune, Mauern, Laternen, Einzelbäume, Bahnlinien). Groß: erst ein Plan-Dokument
      (`docs/OSM_WORLD_PLAN.md`).
- [ ] **E18 Die tote Strecke beim Könner** und **E19 Abwechslung gegen Passung**: Der Regler steuert den Erwartungswert,
      nicht die Verteilung; Serien ohne HP-Verlust häufen sich bei W15 bis W19 und W30 bis W34. Hebel wäre die
      Template-Wahl (öfter schicken, wogegen die Abwehr schwach ist), Tausch: weniger Abwechslung. User kommt darauf zurück.
- [ ] **E125 Mit den Pfaden spielen, um Läufe spannender zu machen** (User, 2026-10-09): Routen sind rein automatisch
      (A* auf dem OSM-Straßengraph vom Portal zum HQ, Spawns und HQ verschiebbar, keine Zwischenwegpunkte). Lange gerade
      Strecken geben Towern viel freien Schaden, die Wellengröße richtet sich nach der Abwehr, nicht nach der
      Routenform. Ideen: erzwungene Ecken oder Umwege, wenn eine Route zu gerade ist, ggf. manuelle Wegpunkte.
- [ ] **E29 Coop-Rest**: Egoperspektive im Coop zäher als allein (T19), vielleicht Turm-Modell lokal vorausdrehen;
      weitere Raum-Optionen aus dem Design (D45: Credits je Spieler oder geteilt, Gold senden an/aus, Startgeld,
      Difficulty, Regel bei Abbruch).
- [ ] **E33 Relay-Rest**: Drain, C5b nach dem Playtest ([COOP_PLAN.md](docs/COOP_PLAN.md) C9).
- [ ] **E101 Rest: weitere Tower-Pfade** (User, 2026-10-02): je Tower ein Pfad, Forschung schaltet frei, je Tower
      einmal gekauft. Gebaut: Späher und Scharfschütze (Ballista) des Archers, Magic Bannsiegel, Poison Ätzend. Ideen:
      Brandpfeile, Rakete Mehrzweck (Boden mit halbem Schaden); Ice, Kanone, Gatling, Lightning, Fire, Tentacle offen.
- [ ] **E81 Restrisiken des zweiten Worker-Reviews**: Wellenstart-Sperre fällt nach 2 s Wanduhr; Coop-Start und
      Ortswechsel ohne Paket dazwischen lassen den Lauf unmarkiert; ein hängender Worker blockiert nach `newRun`;
      Gegner-Views nur aus Event-Refs behalten die Werte des Events. Beobachten, nur mit Beleg angehen.
- [ ] **E107 Hauptthread bei vielen Gegnern** (aus dem Fahrplan Worker und Performance, A und B1 sind in `next`, B2
      und B3 verworfen): Paket anwenden und Gegner darstellen sind der nächste Hebel für die Bildrate.
- [ ] **F4 Laser auf der Karte messen** (`e2e/perf/render-costs.ts`): Ringe und Laser-Säule kosten in DevWorld 0,05
      bis 0,14 ms je Bild; auf der Karte kam im Lauf kein Laser-Schlag zustande.
- [ ] **D1 Spawn-Portal an engen Stellen und Hängen**: Pfeiler in Fassaden, Lichtfleck am Hang schief. Nur im Browser
      an echten Gassen zu beurteilen.
- [ ] **E84 Weitere Vertriebswege** (nach E83): Flathub, Snap Store, winget; Distro-Repos erst, wenn jemand dort
      paketiert. Je Weg klären: Aufwand pro Release, Auto-Update, Sandbox gegen WebGL und LAN-Relay.
- [ ] **H4** Tower-LOD (High, Medium, Low).
- [ ] **H5** Tower-Instancing (schwierig wegen der Rotationen).
- [ ] **H7** Explosionen zweistufig staffeln.
- [ ] **H8** Bloom nur für ausgewählte Objekte (Render-Layers, zweiter Composer).
- [ ] **H9** Mobile und Barrierefreiheit: Qualitäts-Presets, Breakpoints 768 und 480 px, Touch-Ziele 44 px
      (`aria-label` an allen Icon-Buttons ist erledigt).
- [ ] **H16** Deep-Link in die Desktop-App (`threedtd://open?l=...&s=...`) plus Knopf in der Web-Version; Skizze im
      [Electron-Plan](docs/ELECTRON_DESKTOP_PLAN.md), "Bewusst nicht". Zwischenschritt gebaut und getestet (2026-10-04): ein Link im
      Ortsdialog unter „Coordinates“ eingefügt lädt HQ und alle Spawns.
- [ ] **G1 Konzept Resistenzen, Immunitäten, Schild und HP** je Gegnertyp. Entschieden: Herbert Slow-Resistenz 50 %,
      `immunityPercent` geht im neuen Feld auf. Grundlage lokal in `tmp/archive-2026-09/fix1/reports/`.
- [ ] **G2 Konzept Tech Tree des Helden** (Stufe 2 erst damit), Vorschläge lokal in `tmp/archive-2026-09/fix1/reports/herotier2.md`.
- [ ] **G4 Konzept Explosivmunition des Helden mit Flächenschaden** (`hero.config.ts`).
- [ ] **E118 Anmelden mit Cesium ion** statt Token kopieren (Probe 2026-10-06, Browser und Desktop): OAuth2 mit PKCE
      ohne Client-Secret, Client per Dynamic Client Registration beim Start (Desktop: System-Browser, Rückleitung an
      `127.0.0.1:port`), im Web per CIMD oder DCR, Austausch per `fetch` (CORS offen). Scope `assets:read`; der Token
      trägt `CesiumIonAuthPlugin` und den Endpoint von Asset 2275207 wie ein normaler Token. Zugriff 30 Tage, Refresh
      90 Tage, jeder Refresh erneuert beide. Token einfügen bleibt als Rückfall. Offen: Ablauf mit neuem Konto,
      Steam Deck im Gaming-Modus.
- [ ] **E55 Eigene Tilesets als dritter Anbieter**: Anbieter „tileset.json per URL“ mit eigener Authentifizierung;
      braucht ein Mesh mit Boden (Raycasts), Höhen mit Geoidabstand nach EPSG:4978.
- [ ] **E56 Eigenes Spielfeld aus Photogrammetrie** (z. B. der eigene Garten): `TerrainProvider` auf das Mesh, Wege
      ohne OSM (größter Brocken), Maßstab, glTF-Import; verwandt Mond/Mars mit anderem Ellipsoid.
- [ ] **E60 Versus-Modus** (im Lobby-Umschalter als SOON, COOP_PLAN D39): Form offen.
- [ ] **E108 Kampfzonen-Heatmap** (Schicht 2 der Studie, [COMBAT_HEATMAP_STUDY.md](docs/archive/COMBAT_HEATMAP_STUDY.md)):
      Kills je Route-Grid-Zelle mit Farbrampe, in der Bauphase als Bild der letzten Welle, in der Welle per Taste;
      Aufwand M laut Studie. Schicht 1 (Kampfspuren) ist gebaut.
- [ ] **E116 Coop-Spielstand vom Host** (User, 2026-10-05: vorerst nur Einzelspiel): der Host lädt einen Spielstand in
      einen Raum, Gäste bekommen ihn beim Beitreten; das Format ist dafür ausgelegt ([SAVE_LOAD_PLAN.md](docs/SAVE_LOAD_PLAN.md)).

## Entschieden (keine Arbeit)

- **E68 Pool-Größen** (User, 2026-10-11): bleiben; die Suche im vollen Pool ist behoben (`778343c2`), größere Pools waren
  langsamer.
Vom User am 2026-09-16 entschieden, festgehalten in DONE.md (2026-09-16, "Entscheidungen des Users") und in der
jeweiligen Fach-Doku.

- **B1** ~~ONNX-Modell und Training bleiben.~~ Am 2026-09-19 revidiert: PPO, ONNX und die Python-Directors fallen
  weg, das Backend bleibt als Bot-Server ([BALANCING_PLAN.md](docs/BALANCING_PLAN.md), D12 bis D16).
- **B4** Kette und Knick-Rahmen aus Playtest 748 bleiben.
- **B6** Skarnax-Ringe, die neben einem Transporter schräg stehen, stören nicht.
- **B8** Der Suchscheinwerfer bleibt, wie er ist.
- **B11** `PERF_BUG_ANALYSIS_2026-05-28.md` und die Abschnitte 0 bis 6 von `PLAYER_AGENCY_CONCEPT.md` liegen im Archiv
  (erledigt, `fbd30436`).
- **B12** Die 32 Worker-Entscheidungen und "Shader-Prüfung bleibt manuell" sind bestätigt; Fundstellen in DONE.md.
- **E66** Coop: Das gemeinsame HQ trägt die Lecks aller Spuren, Coop bleibt härter (User, 2026-09-28: so lassen).
- Dev-Menü mit Cheats, alle Konsolen-Globals (`__corridor`, `__rg`, `__perf` usw.) und die Dauer-Messungen
  (Raycast-Zeitmessung, `[Camera]`-Log) bleiben im Release-Build.

- [ ] **Entschieden 2026-10-15 (abends):** E195 Navigation: alle Fragen beantwortet, siehe Abschnitt 6 in
      [WORLDS_NAVIGATION_PLAN.md](docs/WORLDS_NAVIGATION_PLAN.md). Kamera auf Kartenwelten bleibt 3 m über dem Boden.
      Biom-Pinsel bekommen mehr Baumarten und ein Herbst-Biom (Karten neu packen). OSM: Gehweg und Pflaster eine
      Bodenschicht. Kein Dev-Link `?osm=`. Ballista-Ton abgenommen.

## Verworfen (nicht erneut angehen)

- **E196 Doppelseitige Stoffe von unten unsichtbar** (2026-10-15): kein Renderfehler; alle Stoffe sind DoubleSide, die
  Kamera bleibt auf Kartenwelten 3 m über dem Boden und kommt nie unter ein Vordach. Spec pinnt die Doppelseitigkeit.

- **Eigene Karten: Wellen je Spawn und Spuren erst ab Welle N** (Review eigene Karten, User-Wahl D am 2026-10-13):
  verworfen, siehe [CUSTOM_MAPS_NEXT_PLAN.md](docs/CUSTOM_MAPS_NEXT_PLAN.md).
- **E98 Druck-Regler getrennt für Luft und Boden** (User, 2026-10-11): verworfen; ein Regler bleibt, Luftwellen bei
  Bedarf über die Plan-Zeilen.
- **Sichtmaske im Coop nur vom Host annehmen** (E92; User 2026-10-01): `command:los-mask` gilt nur für einen
  wartenden Tower mit passender Generation, die erste Antwort gewinnt. Ein umgebauter Gast könnte nur direkt nach
  Setzen, Reichweiten-Upgrade oder Luftziel-Forschung schneller antworten als der Host. Coop läuft unter Freunden;
  der Host-Wechsel über den Lockstep lohnt dafür nicht.
- **Enemy Movement als Structure of Arrays**: gebaut `bd1d3a5`, zurückgenommen `731f454` (13 % langsamer). Nur als
  Komplettumbau mit Position und Rotation in Arrays sinnvoll; gemessen unter jsdom.
- **Mehrere Simulations-Worker und Gegnerzustand in Tabellen** (E72 B2, B3; User 2026-09-30): gebaut auf
  `perf/multi-worker` (Bewegung als Zeilen einer geteilten Tabelle, zwei Phasen, Helfer-Worker, bitgleich im Coop 4
  gegen 1 Thread) und `spike/tables` (Position als Getter, Paket aus den Zeilen). Gemessen: mit 4 Threads 13 bis 18 %
  weniger Rechenzeit als heute, mit 1 Thread 12 bis 19 % mehr (schwache Rechner bekämen 1 bis 2 Threads); das Paket
  aus den Zeilen macht seine Schleife nicht schneller. Etwa 60 % des Sub-Steps bleiben seriell. Branches als Archiv.
- **Weitere Enemy-Hot-Path-Hebel** (2026-09-10): Culling je Pool greift nur bei ganz anderer Blickrichtung; kalte
  Gegner einmal je Frame zu rechnen ändert die Simulation.

Vom User am 2026-09-16 gestrichen:

- **A2** Benchmark mit 20.000 Gegnern gegen `main` (der User misst laufend).
- **A3** Ladezeit und Grafikspeicher gegen `main` (irrelevant).
- **B2** BVH für Raycasts gegen die Tiles.
- **B3** Zellen parallel zur Route (das Konzeptdokument bleibt, nicht geplant).
- **B9** Atompilz auf Grafikstufe Low noch einmal ansehen.
- **B10** Feste Spawns für weitere Showcase-Orte.
- **B14 (D7)** Falsche Spanne in "COMING UP" bei ausgeschaltetem Director.
- **E6** Tower-Debug: Kegelhöhe des Blutmond-Scheinwerfers je Towertyp.
- **E7** Debug: Blutmond und künftige Modi erzwingen.
- **F1** Anteil beleuchteter Tile-Materialien messen.
- **F2** Skarnax-Pfad bei 75-facher Geschwindigkeit messen.
- **F3** Audio-Aktualisierung je Sub-Step messen.
- **F5** Kalter Start ohne Intro auf 2,5 m; `__raycastStats()` beim Boss-Intro.
- **F6** Grobe Kamera-Tiles, wo die Korridor-Region kein Tile hat.
- **F7** Laser-Bot: 2,9 ms je Entscheidung.
- **H1** logDepth-Experiment.
- **H2** Loading Screen überarbeiten.
- **H11** Gewässer aus OSM als unpassierbare Zonen.
- **H12** MechaCat als Gegner.
- **H15** Hitze-Verzerrung beim Orbitallaser.

Bei den Aufräumarbeiten am 2026-09-16 bewusst nicht gemacht:

- **Zwei Tower-Zähler zusammenlegen**: keine echte Doppelung, der Store-Zähler ist nur Auslöser.
- **Hinweis-Services zusammenlegen** (Refusal, Upgrade): verschiedene Leser und Regeln, 19 Dateien für einen Timer.
- **Label `climb` an Straßenkuppen korrigieren**: würde die abgenommene Korridor-Messung ändern.
- **Krücken für grobe Tiles entfernen**: `maxTileError` greift weiterhin, wenn Tiles spät kommen.
- **231 überflüssige `export` entfernen**: kein sicheres Werkzeug (Specs, `tools/`, dynamische Importe).
- **npm-Install-Skripte freigeben**: Entscheidung über fremden Code, bei Bedarf neu aufmachen.
