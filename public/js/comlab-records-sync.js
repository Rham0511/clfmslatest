(() => {
  const eventName = 'comlab:records-changed';
  const storageKey = 'comlab-records-changed';
  const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const seen = new Set();
  const channel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('comlab-records')
    : null;

  function emit(message) {
    if (!message || message.source === clientId || !message.id || seen.has(message.id)) return;
    seen.add(message.id);
    if (seen.size > 100) seen.clear();
    window.dispatchEvent(new CustomEvent(eventName, { detail: message }));
  }

  channel?.addEventListener('message', (event) => emit(event.data));
  window.addEventListener('storage', (event) => {
    if (event.key !== storageKey || !event.newValue) return;
    try { emit(JSON.parse(event.newValue)); } catch { /* Ignore malformed cross-tab events. */ }
  });

  window.comlabRecordsSync = {
    publish(action) {
      const message = { id: `${clientId}-${Date.now()}`, source: clientId, action, at: Date.now() };
      seen.add(message.id);
      channel?.postMessage(message);
      try { localStorage.setItem(storageKey, JSON.stringify(message)); } catch { /* BroadcastChannel still works. */ }
    },
    subscribe(callback) {
      const listener = (event) => callback(event.detail || {});
      window.addEventListener(eventName, listener);
      return () => window.removeEventListener(eventName, listener);
    }
  };
})();
