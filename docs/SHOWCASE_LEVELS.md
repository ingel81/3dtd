# Vorzeige-Level

**Status:** Entwurf, Bau auf `exp/custom-maps` (2026-10-11)

Acht Karten, die zeigen, was der Editor kann, und die sich gut spielen. Jede wird mit den Werkzeugen des Editors gebaut
(dieselben Operationen wie im Editor: Landschafts-Pinsel, Fluss, Straße, Biome, Objekte), als Bauskript unter
`tools/maps/levels/<id>.ts`, damit sie nachvollziehbar und reproduzierbar ist. `tools/maps/shipped-maps.spec.ts` packt
sie nach `public/maps/` mit Vorschaubild und Eintrag in `index.json`.

## Regeln für alle Level

- **Spielbarkeit vor Kulisse:** Wege 350 bis 800 m je Spawn, klare Bauflächen entlang der Wege (Plateaus, Lichtungen),
  Engstellen, an denen sich Türme lohnen, Sichtlinien über die Wege nicht überall verbaut. Objekte mit `blocksBuild`
  nie direkt an der Straße entlang lückenlos
- **Spawns:** 1 bis 4; mit mehr Spawns führen Wege früh zusammen, damit ein Spieler sie halten kann. Eine Coop-Karte
  (Arena) hat je Spieler eigene Spuren
- **Kartenprobe:** jede Karte besteht `?bot=trial&trialWaves=10` mit Budget-Wellen (Bot hält 10 Wellen); sonst werden
  Wege, Bauflächen oder Startgeld angepasst, nicht die Wellen
- **Leistung:** in der Spielansicht über 100 fps auf dem Entwicklungsrechner, Ladezeit im Produktions-Build unter 4 s
- **Größe:** Small (512 m) oder Medium (1024 m); Objekte höchstens etwa 15 000

## Die Level

### 1 Bergpass (`mountain-pass`)
Biom Berge, Look `mountain`, später Nachmittag. Ein Pass zwischen zwei Gipfeln; die Straße windet sich in Serpentinen
vom Tal zum Pass, wo das HQ in einem Bergdorf steht (Steinhäuser mit Holzbalkon, Kapelle, Stützmauern). Ein Wasserfall
stürzt von einer Klippe in einen Bergsee, der Fluss läuft talwärts unter einer Steinbrücke durch. Seilbahn als Kulisse
über dem Tal. Spawns: 2, beide im Tal, die Wege treffen sich an der ersten Kehre. Bauflächen: die Kehren-Innenseiten
und Felsterrassen über der Straße.

### 2 Sumpf bei Nacht (`witch-marsh`)
Biom Sumpf, Look `swamp`, Nacht mit Bodennebel und Glühwürmchen. Ein Bohlenweg über Sumpfwasser, Inseln mit
Pfahlhütten, die Hexenhütte mit grün leuchtenden Fenstern als HQ-Kulisse, Laternen an den Stegen als einzige
Lichtinseln. Spawns: 2 aus dem Nebel im Norden und Westen; die Stege verzweigen und treffen sich auf einer großen
Insel. Bauflächen: die Inseln; das Wasser selbst ist nicht bebaubar.

### 3 Burgruine im Herbst (`autumn-keep`)
Biom Laubwald mit Herbstfarben, Look `day` warm. Eine Burgruine auf einem Hügel, Mauerreste, Bergfried-Ruine, ein
Torhaus. Drei Wege kommen aus den Wäldern und treffen sich vor dem Tor; das HQ steht im Burghof. Laubhaufen, Efeu,
Nebel in den Senken am Morgen. Spawns: 3. Bauflächen: Mauerkronen-Nähe, Lichtungen.

### 4 Wüstencanyon (`red-canyon`)
Biom Wüste, Look `desert`, harte Mittagssonne mit Hitzedunst. Ein verzweigter Canyon mit Tafelbergen; die Wege laufen
im Canyon-Boden, Türme stehen oben auf den Tafelbergen (Plateaus mit Rampen). Tempelruine als HQ, Oase mit Palmen,
Karawanenzelte. Spawns: 2. Bauflächen: Plateaus über dem Canyon (Sichtlinie nach unten).

### 5 Inselarchipel (`archipelago`)
Biom gemäßigt/Küste, Meer rundum, Look `day` klar. Fünf Inseln, verbunden durch Holzbrücken und Furten; Hafen mit
Kaimauer, Kran, Fischerhütten, Leuchtturm. Gegner kommen über zwei Brückenketten zur Hauptinsel. Spawns: 2. Bauflächen:
Inselränder an den Brückenköpfen.

### 6 Winterdorf (`frost-hamlet`)
Biom Schnee/Arktis, Look `arctic`, leichter Schneefall, später Abend mit Laternen. Ein Dorf mit verschneiten Häusern um
einen zugefrorenen See (Eisfläche), Eisfischerhütten, Holzstapel, Schlitten. Die Straße führt um den See; ein zweiter Weg
über das Eis (Gegner laufen übers Eis). Spawns: 2. Bauflächen: Seeufer, Dorfplatz.

### 7 Vulkankrater (`ember-crater`)
Biom Hölle/Vulkan, Look `hell`. Ein großer Krater mit Lavasee; ein Spiralweg führt vom Kraterrand hinab zum HQ auf
einer Obsidianinsel im Lavasee, über eine Lavabrücke. Glutrisse, Lavaströme, Schmiede am Rand, Rauchsäulen. Spawns: 3
am Kraterrand, die Wege münden in die Spirale. Bauflächen: Terrassen zwischen den Spiralwindungen.

### 8 Spiegel-Arena (`twin-gates`)
Biom gemäßigt mit Burgmauern, Look `dusk`. Streng symmetrische Coop-Karte (Spiegelung an X): zwei Burgen, je zwei
Spuren pro Spieler, die sich in der Mitte am gemeinsamen HQ treffen. Gestaltet mit dem Symmetrie-Modus. Spawns: 4.
Bauflächen gespiegelt, gleiche Chancen für beide Spieler.

## Weitere bei Bedarf
Mondbasis (Krater, Habitate, Erde am Himmel), Mars-Canyon (rote Dünen, Rover), Endzeit-Stadt (Ruinen, Wracks, Smog),
Hafenstadt (Kanäle mit Brücken).
