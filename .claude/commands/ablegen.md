Die Sitzung wird gleich gecleart. Lege alles so ab, dass die nächste Sitzung ohne Rückfragen weiterarbeiten kann:

1. Laufendes beenden: eigene Hintergrundprozesse (Dev-Server auf 4201, Messläufe, Agenten) per eigener PID stoppen;
   den Dev-Server des Users auf 4200 nie anfassen.
2. Repo-Stand prüfen: `git status`, Branch, Commits vor `origin`. Unfertiges nicht stillschweigend liegen lassen:
   committen nur, wenn ein Befehl dazu vorliegt; sonst im Handover benennen, was uncommittet ist und warum.
3. `tmp/NEXT_SESSION.md` neu schreiben: Stand (Branch, HEAD, gepusht oder nicht, Gate/E2E), was diese Sitzung
   passiert ist (kurz, mit Commit-Kennungen oder Artefakt-Links), was offen ist nach Gewicht, Werkzeuge und Fallen.
   Offene Arbeit gehört in `TODO.md` (Statuszeilen nachziehen, Neues als Eintrag), nicht nur ins Handover.
4. Memory pflegen: Projektstand-Eintrag aktualisieren und auf `tmp/NEXT_SESSION.md` verweisen; Entscheidungen und
   Lehren der Sitzung als Feedback- oder Projekt-Memory, veraltete Einträge korrigieren; `MEMORY.md` nachziehen.
5. Zum Schluss dem User in wenigen Zeilen sagen, wo was liegt und womit die nächste Sitzung beginnt.
