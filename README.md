# HabitFlow – Habit Tracker (PWA)

HabitFlow ist eine installierbare, offlinefähige Habit-Tracker-Web-App. Die App speichert Daten zuerst lokal in IndexedDB. Optional können angemeldete Nutzer ihre Habits über Supabase zwischen Geräten synchronisieren.

## Funktionen

- Habits erstellen, bearbeiten und löschen
- Checkbox-Habits oder messbare Habits mit Tageswert, Einheit und optionalem Ziel
- Verlaufsgrafik für 30, 90 oder 365 Tage mit Summe, Durchschnitt und Bestwert
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

## Cloud-Synchronisierung einrichten

Die Einrichtung hat zwei Teile. **Der Betreiber der App richtet die Cloud einmalig ein.** Danach brauchen Nutzer weder ein Supabase-Konto noch Projektwerte oder API-Schlüssel: Sie erstellen einfach ein HabitFlow-Konto und verwenden dieselbe E-Mail und dasselbe Passwort auf ihren Geräten.

### Einmalige Einrichtung durch den App-Betreiber

1. Erstelle ein Supabase-Projekt und öffne **Project Settings → API**.
2. Kopiere die **Project URL** und den öffentlichen **anon/publishable Key**.
3. Setze sie in `supabase-config.js` ein:

   ```js
   window.HABITFLOW_SUPABASE_CONFIG = Object.freeze({
     url: "https://DEIN-PROJEKT.supabase.co",
     anonKey: "DEIN_OEFFENTLICHER_ANON_KEY"
   });
   ```

4. Bei einem neuen Projekt führe `supabase/schema.sql` vollständig im Supabase **SQL Editor** aus. Bei einem bereits eingerichteten Projekt führe stattdessen `supabase/migrations/20261117_quantity_habits.sql` aus, bevor du die neue App-Version veröffentlichst. Die Migration ist wiederholbar und lässt alte Habits als Checkbox-Habits bestehen.
5. Aktiviere unter **Authentication → Providers** die E-Mail/Passwort-Anmeldung. Entscheide dort, ob neue Konten ihre E-Mail erst bestätigen müssen.
6. Trage unter **Authentication → URL Configuration** die HTTPS-Adresse der veröffentlichten App als **Site URL** und erlaubte **Redirect URL** ein. Für lokales Testen ergänze `http://localhost:8000/**`.
7. Veröffentliche die App erneut über HTTPS. Auf GitHub Pages muss der veröffentlichte Branch/Ordner die konfigurierte `supabase-config.js` enthalten.

`supabase-config.js` enthält nur die öffentliche Projekt-URL und den für Browser vorgesehenen `anon`/publishable Key. **Den `service_role`- oder einen `sb_secret_`-Key niemals veröffentlichen oder in die App eintragen.** Der Schutz der Daten beruht zusätzlich auf den RLS-Regeln im Schema.

### Für Nutzer

1. Öffne die veröffentlichte HabitFlow-App und gehe zu **Einstellungen → Dein HabitFlow-Konto**.
2. Gib E-Mail und ein Passwort ein und wähle **Konto erstellen**. Falls E-Mail-Bestätigung aktiviert ist, bestätige zuerst den Link aus der E-Mail.
3. Erlaube beim ersten Login auf einem Gerät den Import vorhandener lokaler Habits, wenn du sie mit diesem Konto zusammenführen möchtest. Lehnst du ab, bleiben sie lokal auf diesem Gerät.
4. Melde dich auf weiteren Geräten mit **demselben HabitFlow-Konto** an. Die Habits werden automatisch synchronisiert; bei Konflikten gewinnt die jeweils neuere Änderung.

Für neue Konten verlangt die App ein Passwort mit mindestens 8 Zeichen und mindestens einer Zahl. Stelle unter Supabase **Authentication → Settings** dieselbe Mindestlänge und Zahlenanforderung ein, damit die Regel auch serverseitig gilt. Bei aktivierter E-Mail-Bestätigung kann Supabase aus Datenschutzgründen eine bereits registrierte Adresse absichtlich wie eine neue behandeln. Die App zeigt dann einen allgemeinen Hinweis: Wenn du schon ein Konto hast, melde dich an; sonst bestätige die E-Mail. Wenn die Registrierung bei deaktivierter Bestätigung ausdrücklich mit „already registered“ abgelehnt wird, zeigt HabitFlow an, dass du dich anmelden sollst.

Wenn der Hinweis in den Einstellungen sagt, dass die Cloud noch nicht eingerichtet wurde, muss sich der App-Betreiber darum kümmern. Nutzer können diesen Schritt nicht durch ein eigenes Supabase-Konto ersetzen.

### Synchronisierung und Konflikte

- IndexedDB bleibt der lokale Speicher. Änderungen werden lokal gespeichert, auch wenn das Gerät offline ist.
- Bei einer Verbindung synchronisiert die App nach Änderungen, beim Wiederverbinden, beim Zurückkehren zur App und über Supabase Realtime.
- Beim ersten Login fragt HabitFlow, ob lokale Habits ohne Konto-Zuordnung mit diesem Konto zusammengeführt werden sollen. Ablehnen lässt die lokalen Daten unverändert auf dem Gerät.
- Habits verschiedener Geräte werden addiert. Bei gleicher Habit-ID gewinnt für Name, Intervall, Startdatum und Löschstatus die neueste Habit-Änderung.
- Erledigt-/Offen-Markierungen werden pro Datum separat versioniert. Dadurch kann auch das Zurücknehmen eines Hakens synchronisiert werden.
- Messwerte und optionale Tagesnotizen werden ebenfalls pro Datum mit Zeitstempel gespeichert. Die Daten liegen weiter im JSONB-Feld `completions`; neue SQL-Spalten speichern Art, Einheit und Ziel eines Habits.
- Die Datenbank schützt Messwerte vor Schreibvorgängen älterer App-Versionen, die Mengen-Habits noch nicht kennen.
- Haben zwei Änderungen denselben Zeitstempel, entscheidet eine feste Regel auf allen Geräten gleich; bei einem Gleichstand der Tagesmarkierung gewinnt „offen“, beim Löschstatus die Löschung.
- Löschungen sind synchronisierte Tombstones. Sie werden nicht sofort aus der Cloud entfernt, damit ein älteres Gerät eine gelöschte Habit nicht ungewollt wiederherstellt.
- Der Status in der Kopfzeile zeigt lokal, offline, synchronisiert oder einen Fehler an.

## Mengen-Habits

Beim Erstellen eines Habits kann zwischen **Einfach abhaken** und **Menge erfassen** gewählt werden. Messbare Habits benötigen eine Einheit, zum Beispiel Wiederholungen, km oder Seiten. Ein Tagesziel ist optional. Ohne Ziel zählt ein eingetragener Wert über 0 als erledigt; mit Ziel zählt der Tag ab dem Zielwert als erledigt. Teilwerte und der Wert 0 bleiben als Messung sichtbar, zählen aber ohne Ziel nicht als erledigt.

Die Eingabe ist für geplante Tage in der Wochenansicht und im Kalender-Tagesdetail möglich. Tagesnotizen sind optional. Die Verlaufsgrafik zeigt 30, 90 oder 365 zurückliegende Tage. Summe, Durchschnitt und Bestwert berücksichtigen nur geplante Tage mit einem eingetragenen Zahlenwert; ein eingetragener Wert 0 zählt mit, fehlende Werte zählen nicht als 0. Das Jahr ist ein rollierender Zeitraum der letzten 365 Tage.

Backups werden mit Schema-Version 2 exportiert. Version-1-Backups mit Checkbox-Habits können weiterhin importiert werden; nicht angegebene Messoptionen werden als einfache Checkbox-Habits behandelt.

### Noch manuell zu prüfen

Automatisierte Tests ersetzen keine Live-Prüfung mit dem Supabase-Projekt. Nach dem Ausführen der Migration muss der Betreiber Registrierung, E-Mail-Bestätigung (falls aktiviert), Synchronisierung auf zwei Geräten und Realtime-Änderungen mit Testkonten prüfen.

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
- `auth-core.js` – Passwortprüfung und verständliche Authentifizierungsmeldungen
- `supabase-config.js` – öffentliche Browser-Konfiguration (niemals einen Secret- oder Service-Role-Key eintragen)
- `supabase/schema.sql` – Tabelle, Mess-Habit-Felder, Rechte, RLS und Realtime
- `supabase/migrations/20261117_quantity_habits.sql` – sichere Migration bestehender Supabase-Projekte
- `sw.js` – Offline-Cache und Cache-Version

