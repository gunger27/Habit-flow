# HabitFlow – Habit Tracker (PWA)

Eine installierbare, offlinefähige Habit-Tracker-Web-App. Die App speichert alle Habit-Daten lokal in **IndexedDB** auf deinem Gerät. Es gibt keinen Account und keinen Server, an den deine Gewohnheiten übertragen werden.

## Funktionen

- Habits erstellen, bearbeiten und löschen
- Frei wählbares Intervall von 1 bis 365 Tagen
- Startdatum als Anker für den Rhythmus (z. B. alle 2 Tage ab dem gewählten Startdatum)
- Tagesansicht der letzten sieben Tage
- Monatskalender und Jahresübersicht je Habit
- Aktuelle Streak, längste Streak und Erfüllungsquote
- Dark und Light Mode
- JSON-Backup exportieren und wieder importieren
- Offline-Nutzung nach dem ersten Laden

## App starten / installieren

Eine PWA benötigt einen sicheren Kontext: **HTTPS** oder `localhost`. Öffne `index.html` nicht direkt per Doppelklick (`file://`), da Service Worker und Installation dann nicht funktionieren.

### Schnell lokal testen

Mit installiertem Python im Projektordner:

```bash
python -m http.server 8000
```

Dann `http://localhost:8000` im Browser öffnen.

### Kostenlos online bereitstellen (z. B. GitHub Pages)

1. Erstelle ein GitHub-Repository.
2. Lade alle Dateien aus diesem Ordner in das Repository hoch.
3. Öffne im Repository **Settings → Pages**.
4. Wähle **Deploy from a branch**, Branch `main`, Ordner `/ (root)`.
5. Warte auf die veröffentlichte HTTPS-Adresse und öffne sie auf deinem Android-Handy in Chrome.
6. Chrome-Menü (⋮) → **App installieren** oder **Zum Startbildschirm hinzufügen**.

Alternativ kann das Projekt auf jedem statischen HTTPS-Host bereitgestellt werden.

## Daten & Backups

- Automatisches Speichern: IndexedDB, lokal im Browserprofil.
- JSON-Backup: Einstellungen (⚙) → Backup exportieren.
- Wiederherstellen: Einstellungen → Backup importieren. Der Import **ersetzt** die aktuell gespeicherten Habits nach einer Sicherheitsabfrage.
- Für Gerätewechsel oder vor dem Löschen von Browserdaten unbedingt ein Backup exportieren. Die App synchronisiert nicht automatisch zwischen Geräten.

## Streak-Logik

Ein Habit ist an Tagen geplant, deren Abstand zum Startdatum ein Vielfaches des eingestellten Intervalls ist. Bei Intervall 2 und Start am Montag sind also Montag, Mittwoch, Freitag usw. geplant.

Die aktuelle Streak zählt rückwärts nur geplante und erledigte Termine. Ein heute geplanter, aber noch nicht abgehakter Termin unterbricht die Streak erst ab dem Folgetag. Nicht geplante Tage werden ignoriert. Die längste Streak zählt die längste Folge erledigter geplanter Termine seit Beginn.

Die Erfüllungsquote ist `erledigte geplante Termine / alle geplanten Termine bis heute`. Zukünftige Termine zählen nicht in die Quote.

## Projektdateien

- `index.html` – App-Struktur
- `styles.css` – responsives Design, Dark/Light Mode
- `app.js` – App-Logik, IndexedDB, Kalender, Streaks, Backup
- `manifest.webmanifest` – PWA-Metadaten
- `sw.js` – Offline-Cache / Service Worker
- `icon.svg` – App-Symbol
