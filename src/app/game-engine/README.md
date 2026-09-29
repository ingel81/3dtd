# Game Engine

Angular-freie Kernklassen: der Event Bus und die Dienste, die an ihm hängen und Effekte, Ton und Musik auslösen.
Manager und Dienste reden über den Bus statt über direkte Aufrufe. Die Darstellungsdienste (VFX, Audio, GameSounds,
ScreenShake, Musik, Blutmond) hängen am Hauptthread-Bus (`SimClient.bus`, Events mit Views) und werden von
`presentation/presentation-host.ts` gebaut ([docs/SIM_WORKER.md](../../../docs/SIM_WORKER.md)).

Beschreibung, Event-Typen, Producer und Listener: [docs/EVENT_SYSTEM.md](../../../docs/EVENT_SYSTEM.md).
Einordnung ins Ganze: [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md). Ton und Musik:
[docs/SPATIAL_AUDIO.md](../../../docs/SPATIAL_AUDIO.md).

## Dateien

| Datei | Rolle |
|-------|-------|
| `game-event-bus.ts` | `GameEventBus`, die Union `GameEvent`, `SubscriptionBag` |
| `game-manager.interface.ts` | Gemeinsame Schnittstelle der Manager |
| `vfx.service.ts` | Hört `vfx:*`, `ability:*`, `enemy:split`, `hero:level-up` und startet die Effekte |
| `audio.service.ts` | Hört `audio:play` und `ability:*`, spielt 3D-Ton; Nachhall und Strahl in Spielzeit je Bild |
| `game-sounds.service.ts` | Töne der Spiel-Events: Tod, Treffer, Schritte, Upgrade, Wellen-Signale, Game Over |
| `screen-shake.service.ts` | Kamerawackeln bei nahen Einschlägen, HQ-Schaden, Boss-Tod und Fähigkeiten |
| `blood-moon.service.ts` | Blutmond-Look an und aus nach Wellen-Events |
| `background-music.service.ts` | Musik nach Spielphase: Main Theme, Track-Wahl, Loop |
| `music-mixer.ts` | Zwei Kanäle mit Crossfade |
| `music-buffer-loader.ts` | Laden und Cache der Musik-Buffer |
| `index.ts` | Barrel Exports |
