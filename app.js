'use strict';

const DB_NAME = 'habitflow-db';
const DB_VERSION = 2;
const HABIT_STORE = 'habits';
const META_STORE = 'meta';
const $ = id => document.getElementById(id);
const state = {
  records: [], habits: [], user: null, tab: 'habits',
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selectedDate: null, theme: localStorage.getItem('habitflow-theme') || 'dark'
};
const pad = n => String(n).padStart(2, '0');
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); x.setDate(x.getDate() + n); return x; };
const dayDiff = (a, b) => Math.round((parseKey(key(a)) - parseKey(key(b))) / 86400000);
const today = () => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 12);
const fmtDate = d => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }).format(d);
const fmtMonth = d => new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(d);
const fmtShort = d => new Intl.DateTimeFormat('de-DE', { weekday: 'short' }).format(d).replace('.', '');
const SyncCore = window.HabitFlowSyncCore;
const AuthCore = window.HabitFlowAuthCore;
let db, toastTimer, cloud, realtimeChannel, syncTimer, syncInProgress = false, syncRequested = false, supabaseLoadPromise, authBusy = false;
let syncState = 'local';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(HABIT_STORE)) d.createObjectStore(HABIT_STORE, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(META_STORE)) d.createObjectStore(META_STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function habitTx(mode = 'readonly') { return db.transaction(HABIT_STORE, mode).objectStore(HABIT_STORE); }
function metaTx(mode = 'readonly') { return db.transaction(META_STORE, mode).objectStore(META_STORE); }
function getAll() { return new Promise((resolve, reject) => { const r = habitTx().getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
function putRecord(h) { return new Promise((resolve, reject) => { const r = habitTx('readwrite').put(h); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); }); }
function putRecords(items) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(HABIT_STORE, 'readwrite'), s = t.objectStore(HABIT_STORE);
    items.forEach(h => s.put(h)); t.oncomplete = resolve; t.onerror = () => reject(t.error);
  });
}
function replaceRecords(items) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(HABIT_STORE, 'readwrite'), s = t.objectStore(HABIT_STORE);
    s.clear(); items.forEach(h => s.put(h)); t.oncomplete = resolve; t.onerror = () => reject(t.error);
  });
}
function getMeta(k) { return new Promise((resolve, reject) => { const r = metaTx().get(k); r.onsuccess = () => resolve(r.result?.value); r.onerror = () => reject(r.error); }); }
function setMeta(k, value) { return new Promise((resolve, reject) => { const r = metaTx('readwrite').put({ key: k, value }); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); }); }
function ownerOf(h) { return h.localOwner || null; }
function isVisibleToCurrentUser(h) { return state.user ? ownerOf(h) === state.user.id : !ownerOf(h); }
function normalizeRecord(raw, owner = ownerOf(raw)) {
  const now = new Date().toISOString();
  const updatedAt = raw.updatedAt || raw.updated_at || raw.createdAt || raw.created_at || now;
  const createdAt = raw.createdAt || raw.created_at || updatedAt;
  const sourceCompletions = raw.completions && typeof raw.completions === 'object' ? raw.completions : {};
  const completions = {};
  for (const [date, value] of Object.entries(sourceCompletions)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const event = value && typeof value === 'object' && typeof value.done === 'boolean'
      ? { done: value.done, updatedAt: value.updatedAt || updatedAt }
      : (value === true || value === false ? { done: value, updatedAt } : null);
    if (event) completions[date] = event;
  }
  return {
    id: raw.id, name: String(raw.name || '').slice(0, 60),
    intervalDays: Number(raw.intervalDays ?? raw.interval_days ?? 1),
    startDate: raw.startDate || raw.start_date,
    createdAt, updatedAt, completions,
    ...(raw.deletedAt || raw.deleted_at ? { deletedAt: raw.deletedAt || raw.deleted_at } : {}),
    ...(owner ? { localOwner: owner } : {})
  };
}
function planned(h, date) { const delta = dayDiff(date, parseKey(h.startDate)); return delta >= 0 && delta % h.intervalDays === 0; }
function completed(h, date) { return SyncCore.isDone(h.completions?.[key(date)]); }
function scheduledDates(h, end = today()) { const dates = []; let d = parseKey(h.startDate); const last = parseKey(key(end)); while (d <= last) { dates.push(d); d = addDays(d, h.intervalDays); } return dates; }
function currentStreak(h) {
  const start = parseKey(h.startDate), t = today(), delta = dayDiff(t, start); if (delta < 0) return 0;
  let d = addDays(t, -(delta % h.intervalDays));
  if (key(d) === key(t) && !completed(h, d)) d = addDays(d, -h.intervalDays);
  let count = 0; while (d >= start) { if (!completed(h, d)) break; count++; d = addDays(d, -h.intervalDays); } return count;
}
function longestStreak(h) { let best = 0, run = 0; for (const d of scheduledDates(h)) { if (completed(h, d)) { run++; best = Math.max(best, run); } else run = 0; } return best; }
function rate(h, from = null) { const dates = scheduledDates(h); const selected = from ? dates.filter(d => d >= from) : dates; const done = selected.filter(d => completed(h, d)).length; return { done, total: selected.length, percent: selected.length ? Math.round(done / selected.length * 100) : 0 }; }
function dueToday(h) { return planned(h, today()); }
function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJSON(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200); }
function setAuthMessage(message = '', type = 'info') {
  const el = $('authMessage');
  if (!el) return;
  el.textContent = message;
  el.className = `auth-message ${type}`;
  el.hidden = !message;
}
function setTheme(theme) { state.theme = theme; document.documentElement.dataset.theme = theme; localStorage.setItem('habitflow-theme', theme); $('themeToggle').textContent = theme === 'dark' ? '☼' : '☾'; }
function setSyncStatus(status, message) {
  syncState = status;
  const indicator = $('saveIndicator');
  const labels = { setup: 'Cloud nicht eingerichtet', local: 'Lokal gespeichert', offline: 'Offline · lokal gespeichert', syncing: 'Synchronisiere …', synced: 'Synchronisiert', error: 'Sync fehlgeschlagen' };
  indicator.dataset.state = status;
  indicator.querySelector('span').textContent = message || labels[status] || labels.local;
  indicator.title = message || labels[status] || labels.local;
}
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === tab + 'View'));
  if (tab === 'calendar') renderCalendar(); if (tab === 'stats') renderStats();
}
async function refresh() {
  state.records = (await getAll()).map(h => normalizeRecord(h));
  state.records = state.records.filter(isVisibleToCurrentUser);
  state.habits = state.records.filter(h => !h.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  render();
}
function scheduleSync(delay = 700) {
  if (!cloud || !state.user || !navigator.onLine) { if (state.user) setSyncStatus('offline'); return; }
  clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow().catch(() => {}), delay);
}
function render() {
  const t = today(), plannedList = state.habits.filter(dueToday), done = plannedList.filter(h => completed(h, t)).length;
  $('todayLabel').textContent = new Intl.DateTimeFormat('de-DE', { weekday: 'long' }).format(t).toUpperCase();
  $('todayDate').textContent = fmtDate(t); $('totalHabits').textContent = state.habits.length; $('doneToday').textContent = done;
  $('plannedToday').textContent = ' / ' + plannedList.length; $('activeStreaks').textContent = state.habits.filter(h => currentStreak(h) > 0).length;
  $('todayProgress').textContent = plannedList.length ? (done === plannedList.length ? 'Alles für heute geschafft!' : `${Math.round(done / plannedList.length * 100)} % deiner heutigen Ziele`) : 'Heute steht nichts auf dem Plan.';
  renderHabits(); if (state.tab === 'calendar') renderCalendar(); if (state.tab === 'stats') renderStats(); renderAuthState();
}
function renderHabits() {
  const list = $('habitList'); list.innerHTML = ''; $('emptyHabits').hidden = state.habits.length > 0;
  const dates = Array.from({ length: 7 }, (_, i) => addDays(today(), i - 6));
  state.habits.forEach(h => {
    const card = document.createElement('article'); card.className = 'habit-card';
    const streak = currentStreak(h);
    const days = dates.map(d => {
      const isPlan = planned(h, d), isFuture = d > today(), isDone = completed(h, d);
      let cls = 'day-check', mark = '';
      if (!isPlan) { cls += ' rest'; mark = '–'; } else if (isFuture) { cls += ' future'; mark = '·'; } else if (isDone) { cls += ' done'; mark = '✓'; } else { cls += ' missed'; mark = '○'; }
      return `<div class="day-cell"><div class="day-name">${fmtShort(d)}</div><div class="day-date">${d.getDate()}.</div><button class="${cls}" data-habit="${escapeHTML(h.id)}" data-date="${key(d)}" ${(!isPlan || isFuture) ? 'disabled' : ''} aria-pressed="${isDone}" aria-label="${fmtDate(d)}: ${isDone ? 'erledigt' : (isPlan ? 'offen' : 'nicht geplant')}">${mark}</button></div>`;
    }).join('');
    card.innerHTML = `<div class="habit-top"><div class="habit-name-wrap"><div class="habit-symbol" aria-hidden="true">✳</div><div><div class="habit-name">${escapeHTML(h.name)}</div><div class="habit-frequency">${h.intervalDays === 1 ? 'Jeden Tag' : `Alle ${h.intervalDays} Tage`} · Start ${fmtDate(parseKey(h.startDate))}</div></div></div><div class="streak"><strong>${streak}</strong><span><b class="fire">♨</b> aktuelle Streak</span></div></div><div class="habit-divider"></div><div class="week-row" role="group" aria-label="Wochenübersicht für ${escapeHTML(h.name)}">${days}</div><div class="habit-bottom"><span class="habit-meta">Längste Streak: ${longestStreak(h)} · Erfüllungsquote: ${rate(h).percent}%</span><div class="habit-actions"><button class="tiny-button" data-edit="${escapeHTML(h.id)}">Bearbeiten</button><button class="tiny-button" data-delete="${escapeHTML(h.id)}">Löschen</button></div></div>`;
    list.appendChild(card);
  });
  list.querySelectorAll('[data-habit]').forEach(b => b.addEventListener('click', () => toggleCompletion(b.dataset.habit, b.dataset.date)));
  list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openHabit(b.dataset.edit)));
  list.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', () => deleteHabit(b.dataset.delete)));
}
async function persistHabit(h) {
  const normalized = normalizeRecord({ ...h, updatedAt: new Date().toISOString() }, state.user?.id || ownerOf(h));
  await putRecord(normalized); await refresh(); scheduleSync();
}
async function toggleCompletion(id, dateKey) {
  const h = state.habits.find(x => x.id === id); if (!h) return;
  const d = parseKey(dateKey); if (!planned(h, d) || d > today()) return;
  const wasDone = completed(h, d), updatedAt = new Date().toISOString();
  const completions = { ...h.completions, [dateKey]: { done: !wasDone, updatedAt } };
  await persistHabit({ ...h, completions });
}

function dayTotals(date) {
  const plannedHabits = state.habits.filter(h => planned(h, date));
  const done = plannedHabits.filter(h => completed(h, date)).length;
  return { planned: plannedHabits.length, done, open: plannedHabits.length - done };
}
function renderCalendar() {
  $('calendarMonth').textContent = fmtMonth(state.month); $('yearTitle').textContent = String(today().getFullYear());
  const grid = $('calendarGrid'); grid.innerHTML = '';
  ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].forEach(w => { const el = document.createElement('div'); el.className = 'calendar-weekday'; el.textContent = w; grid.appendChild(el); });
  const first = new Date(state.month.getFullYear(), state.month.getMonth(), 1, 12), offset = (first.getDay() + 6) % 7;
  const daysIn = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 0).getDate();
  for (let i = 0; i < offset; i++) { const e = document.createElement('div'); e.className = 'calendar-day outside'; e.setAttribute('aria-hidden', 'true'); grid.appendChild(e); }
  let monthPlanned = 0, monthDone = 0;
  for (let n = 1; n <= daysIn; n++) {
    const d = new Date(state.month.getFullYear(), state.month.getMonth(), n, 12), totals = dayTotals(d);
    if (d <= today()) { monthPlanned += totals.planned; monthDone += totals.done; }
    const e = document.createElement('button');
    e.type = 'button'; e.className = 'calendar-day';
    if (d > today()) {
      e.classList.add('future');
      if (totals.planned) e.classList.add('planned-future'); else e.classList.add('rest');
    } else if (totals.planned) e.classList.add(totals.open ? (totals.done ? 'partial' : 'missed') : 'completed');
    else e.classList.add('rest');
    if (key(d) === key(today())) e.classList.add('today');
    if (key(d) === state.selectedDate) e.classList.add('selected');
    e.dataset.day = key(d); e.setAttribute('aria-pressed', String(key(d) === state.selectedDate));
    e.setAttribute('aria-label', `${fmtDate(d)}: ${totals.done} erledigt, ${totals.open} offen, ${totals.planned} geplant`);
    e.innerHTML = `<span class="calendar-number">${n}</span><span class="calendar-count">${totals.planned ? `✓${totals.done} · ○${totals.open}` : '–'}</span><span class="calendar-planned">${totals.planned ? `${totals.planned} geplant` : 'frei'}</span>`;
    e.title = `${fmtDate(d)} · ${totals.done} erledigt · ${totals.open} offen · ${totals.planned} geplant`;
    grid.appendChild(e);
  }
  $('calendarSummary').textContent = `${monthDone} von ${monthPlanned} geplanten Habit-Terminen bis heute erledigt`;
  grid.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => { state.selectedDate = b.dataset.day; renderCalendar(); }));
  renderDayDetail(); renderYear();
}
function renderDayDetail() {
  const detail = $('dayDetail'); if (!state.selectedDate) state.selectedDate = key(today());
  const date = parseKey(state.selectedDate), due = state.habits.filter(h => planned(h, date));
  const totals = dayTotals(date);
  detail.innerHTML = `<div class="day-detail-heading"><div><p class="eyebrow">TAGESDETAIL</p><h3>${fmtDate(date)}</h3></div><span class="day-detail-count">${totals.done} erledigt · ${totals.open} offen · ${totals.planned} geplant</span></div>`;
  if (!due.length) { detail.insertAdjacentHTML('beforeend', '<p class="muted">Für diesen Tag ist kein Habit geplant.</p>'); return; }
  const list = document.createElement('div'); list.className = 'day-habit-list';
  for (const h of due) {
    const done = completed(h, date), isFuture = date > today(), row = document.createElement('div');
    row.className = `day-habit-row${done ? ' is-done' : ''}`;
    row.innerHTML = `<span class="day-habit-status" aria-hidden="true">${done ? '✓' : '○'}</span><span class="day-habit-name">${escapeHTML(h.name)}</span><button class="day-toggle ${done ? 'done' : ''}" type="button" data-detail-habit="${escapeHTML(h.id)}" ${isFuture ? 'disabled' : ''} aria-pressed="${done}" aria-label="${done ? 'Erledigt markieren als offen' : 'Habit als erledigt markieren'}: ${escapeHTML(h.name)}">${done ? 'Erledigt' : 'Abhaken'}</button>`;
    list.appendChild(row);
  }
  detail.appendChild(list);
  list.querySelectorAll('[data-detail-habit]').forEach(b => b.addEventListener('click', () => toggleCompletion(b.dataset.detailHabit, state.selectedDate)));
}
function renderYear() {
  const grid = $('yearGrid'); grid.innerHTML = ''; const year = today().getFullYear();
  const monthNames = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  for (let m = 0; m < 12; m++) {
    const wrap = document.createElement('div'); wrap.className = 'year-month-wrap';
    wrap.innerHTML = `<div class="year-month-label">${monthNames[m]}</div>`;
    const cells = document.createElement('div'); cells.className = 'year-month';
    const first = new Date(year, m, 1, 12), offset = (first.getDay() + 6) % 7;
    for (let i = 0; i < offset; i++) { const e = document.createElement('i'); e.className = 'year-cell spacer'; cells.appendChild(e); }
    const len = new Date(year, m + 1, 0).getDate();
    for (let n = 1; n <= len; n++) {
      const d = new Date(year, m, n, 12), totals = dayTotals(d), e = document.createElement('i'); e.className = 'year-cell';
      if (d > today()) e.classList.add('future');
      else if (!totals.planned) e.classList.add('inactive');
      else if (totals.done === 0) e.classList.add('missed');
      else e.classList.add(`level-${Math.min(4, Math.ceil((totals.done / totals.planned) * 4))}`);
      e.title = `${key(d)} · ${totals.done} erledigt · ${totals.open} offen · ${totals.planned} geplant`;
      cells.appendChild(e);
    }
    wrap.appendChild(cells); grid.appendChild(wrap);
  }
}
function renderStats() {
  const habits = state.habits, all = habits.reduce((a, h) => { const r = rate(h); a.done += r.done; a.total += r.total; return a; }, { done: 0, total: 0 });
  const pct = all.total ? Math.round(all.done / all.total * 100) : 0, longest = habits.reduce((m, h) => Math.max(m, longestStreak(h)), 0);
  $('statsOverview').innerHTML = `<div class="stat-tile"><span class="stat-label">Gesamte Erfüllungsquote</span><strong>${pct}%</strong></div><div class="stat-tile"><span class="stat-label">Erledigte Einheiten</span><strong>${all.done}</strong></div><div class="stat-tile"><span class="stat-label">Längste Streak</span><strong>${longest}</strong></div>`;
  const list = $('statsList'); list.innerHTML = '';
  if (!habits.length) { list.innerHTML = '<p class="muted">Noch keine Daten. Füge ein Habit hinzu.</p>'; return; }
  habits.forEach(h => { const r = rate(h), row = document.createElement('div'); row.className = 'stats-row'; row.innerHTML = `<div class="stats-habit">${escapeHTML(h.name)}<div class="muted small">Aktuell: ${currentStreak(h)} · Rekord: ${longestStreak(h)}</div></div><div class="progress-track"><div class="progress-fill" style="width:${r.percent}%"></div></div><div class="stats-number">${r.percent}%</div><div class="stats-number">${r.done}/${r.total}</div>`; list.appendChild(row); });
}
function openHabit(id = null) {
  const h = id ? state.habits.find(x => x.id === id) : null; $('habitForm').reset(); $('habitId').value = h ? h.id : '';
  $('habitDialogTitle').textContent = h ? 'Habit bearbeiten' : 'Habit erstellen'; $('habitName').value = h ? h.name : '';
  $('habitInterval').value = h ? h.intervalDays : 1; $('habitStart').value = h ? h.startDate : key(today()); $('habitDialog').showModal(); $('habitName').focus();
}
async function saveHabit(e) {
  e.preventDefault(); const id = $('habitId').value, name = $('habitName').value.trim();
  const intervalDays = Number($('habitInterval').value), startDate = $('habitStart').value;
  if (!name || !startDate || !Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) { toast('Bitte überprüfe deine Eingaben.'); return; }
  const existing = state.habits.find(h => h.id === id), now = new Date().toISOString();
  const h = existing ? { ...existing, name, intervalDays, startDate, deletedAt: undefined } : { id: crypto.randomUUID(), name, intervalDays, startDate, createdAt: now, updatedAt: now, completions: {}, ...(state.user ? { localOwner: state.user.id } : {}) };
  await persistHabit(h); $('habitDialog').close(); toast(existing ? 'Habit aktualisiert' : 'Habit erstellt');
}
async function deleteHabit(id) {
  const h = state.habits.find(x => x.id === id); if (!h || !confirm(`„${h.name}“ und alle zugehörigen Einträge wirklich löschen?`)) return;
  const now = new Date().toISOString(); await persistHabit({ ...h, updatedAt: now, deletedAt: now }); toast('Habit gelöscht');
}
function exportBackup() {
  const backupHabits = state.habits.map(({ localOwner, deletedAt, ...h }) => h);
  const payload = { app: 'HabitFlow', schemaVersion: 1, exportedAt: new Date().toISOString(), habits: backupHabits };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `habitflow-backup-${key(today())}.json`; a.click(); URL.revokeObjectURL(url); toast('Backup wurde erstellt');
}
async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'HabitFlow' || data.schemaVersion !== 1 || !Array.isArray(data.habits)) throw Error('Ungültiges Backup-Format');
    const now = new Date().toISOString();
    const clean = data.habits.map(h => {
      if (typeof h.id !== 'string' || typeof h.name !== 'string' || !Number.isInteger(h.intervalDays) || h.intervalDays < 1 || h.intervalDays > 365 || !/^\d{4}-\d{2}-\d{2}$/.test(h.startDate) || !h.completions || typeof h.completions !== 'object') throw Error('Das Backup enthält ungültige Habit-Daten');
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(h.id) ? h.id : crypto.randomUUID();
      return normalizeRecord({ id: uuid, name: h.name.slice(0, 60), intervalDays: h.intervalDays, startDate: h.startDate, createdAt: h.createdAt || now, updatedAt: now, completions: h.completions }, state.user?.id || null);
    });
    if (!confirm(`Backup mit ${clean.length} Habits importieren? Deine aktuellen Habits werden ersetzt. Bei angemeldetem Konto werden entfernte Habits als Löschungen synchronisiert.`)) return;
    const allRecords = (await getAll()).map(h => normalizeRecord(h));
    const current = allRecords.filter(isVisibleToCurrentUser), importedIds = new Set(clean.map(h => h.id));
    const tombstones = current.filter(h => !importedIds.has(h.id)).map(h => ({ ...h, updatedAt: now, deletedAt: now }));
    const otherAccounts = allRecords.filter(h => !isVisibleToCurrentUser(h));
    await replaceRecords([...otherAccounts, ...tombstones, ...clean]); await refresh(); scheduleSync(); $('settingsDialog').close(); toast('Backup erfolgreich importiert');
  } catch (err) { toast(err.message || 'Import fehlgeschlagen'); }
}

function rowToHabit(row) {
  return normalizeRecord({ id: row.id, name: row.name, intervalDays: row.interval_days, startDate: row.start_date, completions: row.completions, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at }, row.user_id);
}
function habitToRow(h, userId = state.user.id) {
  return { id: h.id, user_id: userId, name: h.name, interval_days: h.intervalDays, start_date: h.startDate, completions: h.completions, created_at: h.createdAt, updated_at: h.updatedAt, deleted_at: h.deletedAt || null };
}
function remoteEqual(local, remote, userId = state.user.id) {
  const a = habitToRow(local, userId), b = { ...remote };
  return a.id === b.id && a.user_id === b.user_id && a.name === b.name && a.interval_days === b.interval_days && a.start_date === b.start_date && a.updated_at === b.updated_at && a.deleted_at === b.deleted_at && stableJSON(a.completions) === stableJSON(b.completions);
}
async function syncNow() {
  if (!cloud || !state.user) return;
  if (syncInProgress) { syncRequested = true; return; }
  if (!navigator.onLine) { setSyncStatus('offline'); return; }
  const syncUser = state.user;
  syncInProgress = true; setSyncStatus('syncing');
  try {
    const { data: remoteRows, error } = await cloud.from('habits').select('*').eq('user_id', syncUser.id);
    if (error) throw error;
    if (state.user?.id !== syncUser.id) return;
    let allLocal = (await getAll()).map(h => normalizeRecord(h));
    const guestRecords = allLocal.filter(h => !ownerOf(h));
    const ownedRecords = allLocal.filter(h => ownerOf(h) === syncUser.id);
    const foreignRecords = allLocal.filter(h => ownerOf(h) && ownerOf(h) !== syncUser.id);
    const initKey = `sync-initialized:${syncUser.id}`;
    const initialized = await getMeta(initKey);
    let currentLocal = [...ownedRecords];
    let unclaimedGuest = [];
    if (guestRecords.length) {
      const decisionsKey = `guest-decisions:${syncUser.id}`;
      const decisions = await getMeta(decisionsKey) || {};
      const undecided = guestRecords.filter(h => !decisions[h.id]);
      if (undecided.length) {
        const importGuest = confirm(`Es gibt ${undecided.filter(h => !h.deletedAt).length} lokale Habits ohne Konto-Zuordnung. Sollen sie mit ${syncUser.email || 'diesem Konto'} zusammengeführt werden? Lokale und Cloud-Habits werden addiert; gleiche IDs werden nach Änderungszeitpunkt abgeglichen.`);
        for (const h of undecided) decisions[h.id] = importGuest ? 'import' : 'keep-local';
        await setMeta(decisionsKey, decisions);
      }
      const imported = guestRecords.filter(h => decisions[h.id] === 'import').map(h => ({ ...h, localOwner: syncUser.id }));
      unclaimedGuest = guestRecords.filter(h => decisions[h.id] !== 'import');
      currentLocal = [...currentLocal, ...imported];
    }
    const remote = (remoteRows || []).map(rowToHabit);
    if (!initialized && !currentLocal.length && remote.length) {
      const downloaded = remote.map(h => ({ ...h, localOwner: syncUser.id }));
      if (state.user?.id !== syncUser.id) return;
      await putRecords([...foreignRecords, ...unclaimedGuest, ...downloaded]);
      await setMeta(initKey, true); await refresh();
      setSyncStatus('synced', 'Cloud-Daten geladen'); return;
    }
    const merged = SyncCore.mergeHabitLists(currentLocal, remote).map(h => normalizeRecord(h, syncUser.id));
    const remoteById = new Map(remoteRows.map(r => [r.id, r]));
    const toUpload = merged.filter(h => !remoteById.has(h.id) || !remoteEqual(h, remoteById.get(h.id), syncUser.id));
    if (state.user?.id !== syncUser.id) return;
    await putRecords([...foreignRecords, ...unclaimedGuest, ...merged]); await refresh();
    if (toUpload.length) {
      if (state.user?.id !== syncUser.id) return;
      const { error: upsertError } = await cloud.from('habits').upsert(toUpload.map(h => habitToRow(h, syncUser.id)), { onConflict: 'id' });
      if (upsertError) throw upsertError;
    }
    await setMeta(initKey, true);
    setSyncStatus('synced', toUpload.length ? `Synchronisiert · ${toUpload.length} Änderung(en)` : 'Synchronisiert');
  } catch (error) {
    console.error('HabitFlow sync error', error);
    setSyncStatus(navigator.onLine ? 'error' : 'offline');
    if (navigator.onLine) toast(`Synchronisierung fehlgeschlagen: ${error.message || 'Verbindung prüfen'}`);
  } finally {
    syncInProgress = false;
    if (syncRequested || (state.user && state.user.id !== syncUser.id)) { syncRequested = false; scheduleSync(100); }
  }
}
function subscribeRealtime() {
  if (!cloud || !state.user) return;
  if (realtimeChannel) cloud.removeChannel(realtimeChannel);
  realtimeChannel = cloud.channel(`habits-${state.user.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'habits', filter: `user_id=eq.${state.user.id}` }, () => scheduleSync(350))
    .subscribe();
}
async function handleAuthChange(session) {
  state.user = session?.user || null; renderAuthState();
  if (state.user) { await refresh(); subscribeRealtime(); await syncNow(); }
  else { if (realtimeChannel && cloud) { await cloud.removeChannel(realtimeChannel); realtimeChannel = null; } await refresh(); setSyncStatus(cloud ? 'local' : 'setup'); }
}
function renderAuthState() {
  const config = window.HABITFLOW_SUPABASE_CONFIG || {};
  const hasConfig = !!(config.url && config.anonKey), authState = $('authState'), help = $('syncHelp');
  if (!hasConfig) {
    authState.textContent = 'Cloud nicht eingerichtet'; authState.dataset.state = 'setup'; help.textContent = 'Die Cloud wurde vom Betreiber noch nicht eingerichtet. Deine Habits bleiben auf diesem Gerät gespeichert.';
    $('authEmail').disabled = $('authPassword').disabled = $('signInButton').disabled = $('signUpButton').disabled = true; $('signOutButton').hidden = true;
    setSyncStatus('setup'); return;
  }
  if (!cloud) {
    authState.textContent = 'Cloud nicht verfügbar'; authState.dataset.state = 'offline'; help.textContent = navigator.onLine ? 'Der Cloud-Dienst konnte nicht geladen werden. Deine Habits bleiben lokal gespeichert. Prüfe die Verbindung und lade die App erneut.' : 'Du bist offline. Die Anmeldung und Synchronisierung sind wieder verfügbar, sobald du online bist.';
    $('authEmail').disabled = $('authPassword').disabled = $('signInButton').disabled = $('signUpButton').disabled = true; $('signOutButton').hidden = true; return;
  }
  $('authEmail').disabled = $('authPassword').disabled = !!state.user || authBusy;
  $('signInButton').disabled = $('signUpButton').disabled = !!state.user || authBusy;
  $('signOutButton').hidden = !state.user;
  if (authBusy) { authState.textContent = 'Bitte warten …'; authState.dataset.state = 'pending'; help.textContent = 'Deine Anfrage wird verarbeitet.'; }
  else if (state.user) { authState.textContent = `Angemeldet als ${state.user.email || 'HabitFlow-Konto'}`; authState.dataset.state = 'signed-in'; help.textContent = 'Dieses Gerät ist mit deinem Konto verbunden. Deine Änderungen werden bei bestehender Internetverbindung automatisch synchronisiert.'; }
  else { authState.textContent = 'Nicht angemeldet'; authState.dataset.state = 'signed-out'; help.textContent = 'Erstelle ein Konto oder melde dich an. Verwende auf allen Geräten dieselbe E-Mail-Adresse und dasselbe Passwort.'; }
}
async function signIn() {
  const emailInput = $('authEmail'), passwordInput = $('authPassword');
  const email = emailInput.value.trim(), password = passwordInput.value;
  if (!emailInput.checkValidity()) { emailInput.reportValidity(); setAuthMessage('Bitte gib eine gültige E-Mail-Adresse ein.', 'error'); return; }
  if (!password) { setAuthMessage('Bitte gib dein Passwort ein.', 'error'); passwordInput.focus(); return; }
  authBusy = true; renderAuthState(); setAuthMessage('Anmeldung läuft …', 'info');
  try {
    const { error } = await cloud.auth.signInWithPassword({ email, password });
    if (error) setAuthMessage(AuthCore.authErrorMessage(error, 'signin'), 'error');
    else { passwordInput.value = ''; setAuthMessage('Anmeldung erfolgreich. Deine Kontodaten werden geladen.', 'success'); }
  } catch (error) { setAuthMessage(AuthCore.authErrorMessage(error, 'signin'), 'error'); }
  finally { authBusy = false; renderAuthState(); }
}
async function signUp() {
  const emailInput = $('authEmail'), passwordInput = $('authPassword');
  const email = emailInput.value.trim(), password = passwordInput.value;
  if (!emailInput.checkValidity()) { emailInput.reportValidity(); setAuthMessage('Bitte gib eine gültige E-Mail-Adresse ein.', 'error'); return; }
  const passwordError = AuthCore.validateNewPassword(password);
  if (passwordError) { setAuthMessage(passwordError, 'error'); passwordInput.focus(); return; }
  authBusy = true; renderAuthState(); setAuthMessage('Konto wird erstellt …', 'info');
  try {
    const { data, error } = await cloud.auth.signUp({ email, password });
    if (error) setAuthMessage(AuthCore.authErrorMessage(error, 'signup'), 'error');
    else if (!data.session) {
      passwordInput.value = '';
      const result = AuthCore.signupResultMessage(data.session);
      setAuthMessage(result.text, result.type);
    } else { passwordInput.value = ''; const result = AuthCore.signupResultMessage(data.session); setAuthMessage(result.text, result.type); }
  } catch (error) { setAuthMessage(AuthCore.authErrorMessage(error, 'signup'), 'error'); }
  finally { authBusy = false; renderAuthState(); }
}
async function signOut() {
  if (!cloud) return;
  const { error } = await cloud.auth.signOut();
  if (error) setAuthMessage('Abmelden war gerade nicht möglich. Bitte versuche es erneut.', 'error');
  else setAuthMessage('Du bist abgemeldet. Die lokalen Kontodaten bleiben auf diesem Gerät gespeichert.', 'success');
}
async function initCloud() {
  const config = window.HABITFLOW_SUPABASE_CONFIG || {};
  if (!config.url || !config.anonKey) { cloud = null; setSyncStatus('setup'); renderAuthState(); return; }
  if (!window.supabase?.createClient) {
    if (!navigator.onLine) { setSyncStatus('offline', 'Supabase-Bibliothek offline nicht verfügbar · lokal gespeichert'); renderAuthState(); return; }
    if (!supabaseLoadPromise) supabaseLoadPromise = new Promise(resolve => {
      const script = document.createElement('script'); script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.onload = () => resolve(!!window.supabase?.createClient); script.onerror = () => resolve(false); document.head.appendChild(script);
    });
    if (!await supabaseLoadPromise) { supabaseLoadPromise = null; cloud = null; setSyncStatus('error', 'Supabase-Bibliothek konnte nicht geladen werden'); renderAuthState(); return; }
  }
  try { cloud = window.supabase.createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }); }
  catch (error) { cloud = null; setSyncStatus('error', 'Supabase-Konfiguration prüfen'); renderAuthState(); console.error(error); return; }
  cloud.auth.onAuthStateChange((_event, session) => { queueMicrotask(() => handleAuthChange(session).catch(error => { console.error(error); setSyncStatus('error'); })); });
  cloud.auth.getSession().then(({ data, error }) => { if (error) throw error; return handleAuthChange(data.session); }).catch(error => { console.error(error); setSyncStatus('error'); });
  renderAuthState();
}
function bind() {
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('addHabitButton').addEventListener('click', () => openHabit()); $('emptyAddButton').addEventListener('click', () => openHabit());
  $('habitForm').addEventListener('submit', saveHabit); $('themeToggle').addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
  $('settingsButton').addEventListener('click', () => $('settingsDialog').showModal());
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).close()));
  $('prevMonth').addEventListener('click', () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1, 12); state.selectedDate = key(state.month); renderCalendar(); });
  $('nextMonth').addEventListener('click', () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1, 12); state.selectedDate = key(state.month); renderCalendar(); });
  $('exportButton').addEventListener('click', exportBackup); $('importButton').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', e => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });
  $('signInButton').addEventListener('click', () => signIn().catch(() => setAuthMessage('Anmeldung nicht möglich. Prüfe deine Verbindung und versuche es erneut.', 'error')));
  $('signUpButton').addEventListener('click', () => signUp().catch(() => setAuthMessage('Konto konnte nicht erstellt werden. Prüfe deine Verbindung und versuche es erneut.', 'error')));
  $('signOutButton').addEventListener('click', () => signOut().catch(() => setAuthMessage('Abmelden nicht möglich. Bitte versuche es erneut.', 'error')));
  $('authForm').addEventListener('submit', e => { e.preventDefault(); signIn().catch(() => setAuthMessage('Anmeldung nicht möglich. Prüfe deine Verbindung und versuche es erneut.', 'error')); });
  window.addEventListener('online', () => { if (!cloud) initCloud(); else scheduleSync(200); }); window.addEventListener('offline', () => { if (state.user) setSyncStatus('offline'); });
  window.addEventListener('focus', () => scheduleSync(200)); document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleSync(200); });
}
async function init() {
  if (!state.selectedDate) state.selectedDate = key(today());
  setTheme(state.theme); bind();
  try {
    if (!('indexedDB' in window)) throw Error('Dieser Browser unterstützt IndexedDB nicht.');
    db = await openDB(); await refresh(); await initCloud();
  } catch (err) { setSyncStatus('error', 'Speicherfehler'); toast('Lokale Datenbank konnte nicht geöffnet werden: ' + err.message); }
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
init();

