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
    if (value && typeof value === 'object' && typeof value.done === 'boolean') {
      return { done: value.done, updatedAt: value.updatedAt || fallbackTime };
    }
    if (value === true || value === false) return { done: value, updatedAt: fallbackTime };
    return null;
  };
  function mergeCompletions(left = {}, right = {}, leftTime, rightTime) {
    const result = {};
    for (const date of new Set([...Object.keys(left || {}), ...Object.keys(right || {})])) {
      const a = normalizeCompletion(left?.[date], leftTime);
      const b = normalizeCompletion(right?.[date], rightTime);
      if (!a) result[date] = b;
      else if (!b) result[date] = a;
      else if (stamp(b.updatedAt) !== stamp(a.updatedAt)) result[date] = stamp(b.updatedAt) > stamp(a.updatedAt) ? b : a;
      else result[date] = a.done === b.done ? a : (a.done ? b : a);
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
    const localSignature = JSON.stringify([local.name, local.intervalDays ?? local.interval_days, local.startDate ?? local.start_date, localDeleted || null]);
    const remoteSignature = JSON.stringify([remote.name, remote.intervalDays ?? remote.interval_days, remote.startDate ?? remote.start_date, remoteDeleted || null]);
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
  function isDone(value) {
    return value === true || (value && typeof value === 'object' && value.done === true);
  }
  return { mergeCompletions, mergeHabit, mergeHabitLists, isDone, stamp };
});
