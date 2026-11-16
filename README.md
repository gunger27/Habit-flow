# HabitFlow – Habit Tracker (PWA)

HabitFlow ist eine installierbare, offlinefähige Habit-Tracker-Web-App. Die App speichert Daten zuerst lokal in IndexedDB. Optional können angemeldete Nutzer ihre Habits über Supabase zwischen Geräten synchronisieren.

## Funktionen

- Habits erstellen, bearbeiten und löschen
- Intervalle von 1 bis 365 Tagen mit Startdatum als Rhythmusanker
- Wochenübersicht mit gut bedienbaren Abhakflächen
- Gemeinsamer Monatskalender mit Tageszahlen für erledigte, offene und geplante Habits
- Tagesdetailansicht zum direkten Abhaken
- Jahresübersicht der Gesamtaktivität aller Habits
- Aktuelle und längste Streak, Statistiken und Erfüllungsquote
- Dark und Light Mode
- JSON-Backup exportieren und importieren
- Offline-Nutzung mit IndexedDB und Service Worker
- Optionale Kontoanmeldung und Cloud-Synchronisierung über Supabase

## Lokale Nutzung

Eine PWA benötigt HTTPS oder `localhost`. Öffne `index.html` nicht per Doppelklick (`file://`), da Service Worker und Installation dort nicht funktionieren.

Mit Python im Projektordner:

```bash
python -m http.server 8000
```

Öffne danach `http://localhost:8000`.

## Supabase einrichten

Die App enthält keine erfundenen Zugangsdaten. Cloud-Synchronisierung bleibt deaktiviert, bis du deine eigenen Projektwerte einträgst.

1. Erstelle ein Supabase-Projekt und öffne **Project Settings → API**.
2. Kopiere die Projekt-URL sowie den öffentlichen `anon`/publishable Key.
3. Trage beide Werte in `supabase-config.js` ein:

   ```js
   window.HABITFLOW_SUPABASE_CONFIG = Object.freeze({
     url: "https://DEIN-PROJEKT.supabase.co",
     anonKey: "DEIN_OEFFENTLICHER_ANON_KEY"
   });
   ```

4. Öffne den **SQL Editor** in Supabase und führe `supabase/schema.sql` vollständig aus. Das Schema erstellt `public.habits`, aktiviert Row Level Security, gewährt Datenbankrechte nur für `authenticated` und legt Policies an, die jede Zeile auf `auth.uid() = user_id` beschränken.
5. Stelle unter **Authentication → Providers** sicher, dass E-Mail/Passwort-Anmeldung aktiviert ist. Wenn E-Mail-Bestätigung aktiviert ist, muss die Person den Bestätigungslink öffnen, bevor sie sich anmelden kann.
6. Trage deine HTTPS-App-Adresse unter **Authentication → URL Configuration** als Site URL ein und ergänze sie bei den Redirect URLs. Für lokales Testen verwende zusätzlich `http://localhost:8000/**`.
7. Lade die Dateien auf einen HTTPS-Host hoch. Für GitHub Pages muss die Pages-Veröffentlichung auf den richtigen Branch und Ordner zeigen.
8. Öffne die App online, gehe zu **Einstellungen → Cloud-Synchronisierung** und registriere ein Konto oder melde dich an.

**Sicherheit:** Im Browser darf ausschließlich der öffentliche `anon` Key stehen. Den `service_role` Key niemals in `supabase-config.js`, GitHub Pages, HTML, JavaScript oder einem anderen Client ausliefern. Der anon Key ist kein Ersatz für RLS; führe das SQL-Schema aus und prüfe die Policies im Supabase Dashboard.

### Synchronisierung und Konflikte

- IndexedDB bleibt der lokale Speicher. Änderungen werden lokal gespeichert, auch wenn das Gerät offline ist.
- Bei einer Verbindung synchronisiert die App nach Änderungen, beim Wiederverbinden, beim Zurückkehren zur App und über Supabase Realtime.
- Beim ersten Login fragt HabitFlow, ob lokale Habits ohne Konto-Zuordnung mit diesem Konto zusammengeführt werden sollen. Ablehnen lässt die lokalen Daten unverändert auf dem Gerät.
- Habits verschiedener Geräte werden addiert. Bei gleicher Habit-ID gewinnt für Name, Intervall, Startdatum und Löschstatus die neueste Habit-Änderung.
- Erledigt-/Offen-Markierungen werden pro Datum separat versioniert. Dadurch kann auch das Zurücknehmen eines Hakens synchronisiert werden.
- Haben zwei Änderungen denselben Zeitstempel, entscheidet eine feste Regel auf allen Geräten gleich; bei einem Gleichstand der Tagesmarkierung gewinnt „offen“, beim Löschstatus die Löschung.
- Löschungen sind synchronisierte Tombstones. Sie werden nicht sofort aus der Cloud entfernt, damit ein älteres Gerät eine gelöschte Habit nicht ungewollt wiederherstellt.
- Der Status in der Kopfzeile zeigt lokal, offline, synchronisiert oder einen Fehler an.

### Manuell erforderlich

- Ein Supabase-Projekt erstellen und die echte URL sowie den öffentlichen anon Key in `supabase-config.js` eintragen.
- `supabase/schema.sql` im SQL Editor ausführen.
- E-Mail-Provider und erlaubte App-/Redirect-URLs konfigurieren.
- Die veröffentlichte App nach dem Eintragen der Konfiguration erneut deployen.
- Cloud-Registrierung, Anmeldung, Synchronisierung zwischen zwei Geräten und Realtime-Änderungen mit echten Testkonten prüfen.

## Daten & Backups

- Ohne Supabase-Konfiguration bleibt HabitFlow vollständig lokal.
- Daten und Streak-Berechnungen werden auf Basis geplanter Tage durchgeführt.
- JSON-Backup: **Einstellungen → Backup exportieren**. Import ersetzt die sichtbaren Habits nach Sicherheitsabfrage; bei Cloud-Anmeldung werden ersetzte Habits als Löschungen synchronisiert.
- Vor dem Löschen von Browserdaten oder Gerätewechsel ein Backup exportieren.

## Dateien

- `index.html` – App-Struktur und Authentifizierungsformular
- `styles.css`, `feature.css` – Layout, Darstellung und mobile Bedienung
- `app.js` – IndexedDB, App-Logik, Authentifizierung, Synchronisierung, Kalender und Statistiken
- `sync-core.js` – deterministische Konfliktauflösung
- `supabase-config.js` – Platzhalter für Projekt-URL und öffentlichen Key
- `supabase/schema.sql` – Tabelle, Rechte, RLS und Realtime-Veröffentlichung
- `sw.js` – Offline-Cache und Cache-Version
