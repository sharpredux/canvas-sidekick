export function loadCompletionOverrides(storage, cachedTasks) {
  const saved = storage.getItem('taskCompletionOverrides');
  if (saved) return JSON.parse(saved);
  const ids = JSON.parse(storage.getItem('localCompletedIds') || '[]');
  return Object.fromEntries(ids.map(id => {
    const task = cachedTasks.find(item => item.id === id);
    return [id, { completed: true, canvasCompleted: task?.canvasCompleted ?? false }];
  }));
}

export function applyCompletion(item, overrides, previous) {
  const canvasCompleted = item.completionKnown === false && previous ?
    (previous.canvasCompleted ?? previous.completed) : Boolean(item.completed);
  const override = overrides[item.id];
  // A new Canvas submission/reassignment takes precedence over an older local
  // choice. Until that happens, both checked and unchecked choices persist.
  if (override && override.canvasCompleted !== canvasCompleted && !item.isManual) {
    delete overrides[item.id];
  }
  return {
    ...item, canvasCompleted,
    completed: overrides[item.id]?.completed ?? canvasCompleted
  };
}
