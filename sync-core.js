(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HabitFlowSyncCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const stamp = value => {
    const time = Date.parse(value || '');
    return Number.isFinite(time) ? time : 0;
  };
  const normalizeCompletion = (value, fallbackTime) => {
    if (value && typeof value === 'object') {
      const updatedAt = value.updatedAt || fallbackTime;
      if (value.deleted === true) return { deleted: true, updatedAt };
      if (typeof value.done === 'boolean') return { done: value.done, updatedAt };
      if ((value.value === null || (typeof value.value === 'number' && Number.isFinite(value.value) && value.value >= 0)) && typeof value.note === 'string') {
        return { value: value.value, note: value.note.slice(0, 240), updatedAt };
      }
      if (typeof value.value === 'number' && Number.isFinite(value.value) && value.value >= 0) {
        return { value: value.value, note: '', updatedAt };
      }
    }
    if (value === true || value === false) return { done: value, updatedAt: fallbackTime };
    return null;
  };
  const eventSignature = event => JSON.stringify([event.deleted === true, typeof event.done === 'boolean' ? event.done : null, event.value ?? null, event.note || '']);
  function mergeCompletions(left = {}, right = {}, leftTime, rightTime) {
    const result = {};
    for (const date of new Set([...Object.keys(left || {}), ...Object.keys(right || {})])) {
      const a = normalizeCompletion(left?.[date], leftTime);
      const b = normalizeCompletion(right?.[date], rightTime);
      if (!a) result[date] = b;
      else if (!b) result[date] = a;
      else if (stamp(b.updatedAt) !== stamp(a.updatedAt)) result[date] = stamp(b.updatedAt) > stamp(a.updatedAt) ? b : a;
      else if (Boolean(a.deleted) !== Boolean(b.deleted)) result[date] = a.deleted ? a : b;
      else if (typeof a.done === 'boolean' && typeof b.done === 'boolean' && a.done !== b.done) result[date] = a.done ? b : a;
      else result[date] = eventSignature(a) >= eventSignature(b) ? a : b;
    }
    return result;
  }
  function mergeHabit(local, remote) {
    if (!local) return structuredClone(remote);
    if (!remote) return structuredClone(local);
    const localTime = local.updatedAt || local.updated_at || local.createdAt || local.created_at;
    const remoteTime = remote.updatedAt || remote.updated_at || remote.createdAt || remote.created_at;
    const localStamp = stamp(localTime), remoteStamp = stamp(remoteTime);
    const localDeleted = local.deletedAt ?? local.deleted_at ?? null;
    const remoteDeleted = remote.deletedAt ?? remote.deleted_at ?? null;
    const localSignature = JSON.stringify([local.name, local.intervalDays ?? local.interval_days, local.startDate ?? local.start_date, local.trackingType ?? local.tracking_type ?? 'checkbox', local.unit || '', local.dailyTarget ?? local.daily_target ?? null, localDeleted || null]);
    const remoteSignature = JSON.stringify([remote.name, remote.intervalDays ?? remote.interval_days, remote.startDate ?? remote.start_date, remote.trackingType ?? remote.tracking_type ?? 'checkbox', remote.unit || '', remote.dailyTarget ?? remote.daily_target ?? null, remoteDeleted || null]);
    const localWins = localStamp === remoteStamp
      ? (Boolean(localDeleted) === Boolean(remoteDeleted) ? localSignature >= remoteSignature : Boolean(localDeleted))
      : localStamp > remoteStamp;
    const winner = localWins ? local : remote;
    const merged = structuredClone(winner);
    merged.updatedAt = localWins ? localTime : remoteTime;
    merged.completions = mergeCompletions(
      local.completions,
      remote.completions,
      localTime,
      remoteTime
    );
    const deletedAt = winner.deletedAt ?? winner.deleted_at ?? null;
    if (deletedAt) merged.deletedAt = deletedAt;
    else delete merged.deletedAt;
    return merged;
  }
  function mergeHabitLists(localItems, remoteItems) {
    const byId = new Map();
    for (const habit of localItems || []) byId.set(habit.id, mergeHabit(byId.get(habit.id), habit));
    for (const habit of remoteItems || []) byId.set(habit.id, mergeHabit(byId.get(habit.id), habit));
    return [...byId.values()].sort((a, b) => (a.createdAt || a.created_at || '').localeCompare(b.createdAt || b.created_at || ''));
  }
  function isDone(value, habit = {}) {
    if (value === true || (value && typeof value === 'object' && value.done === true)) return true;
    if (!value || typeof value !== 'object' || value.deleted === true || typeof value.value !== 'number' || !Number.isFinite(value.value)) return false;
    const target = Number(habit.dailyTarget ?? habit.daily_target);
    return target > 0 ? value.value >= target : value.value > 0;
  }
  function measurementStats(events = []) {
    const values = events.map(event => event && event.deleted !== true && typeof event.value === 'number' && Number.isFinite(event.value) && event.value >= 0 ? event.value : null).filter(value => value !== null);
    const sum = values.reduce((total, value) => total + value, 0);
    return { count: values.length, sum, average: values.length ? sum / values.length : 0, best: values.length ? Math.max(...values) : 0 };
  }
  return { mergeCompletions, mergeHabit, mergeHabitLists, isDone, measurementStats, normalizeCompletion, stamp };
});

