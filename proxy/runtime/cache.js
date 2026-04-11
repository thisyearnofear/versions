function createTtlCache({ ttlMs = 60000, maxEntries = 200 }) {
  const store = new Map();

  function purgeExpired(now) {
    for (const [key, entry] of store.entries()) {
      if (entry.expiresAt <= now) {
        store.delete(key);
      }
    }
  }

  return {
    get(key) {
      const now = Date.now();
      const entry = store.get(key);
      if (!entry) {
        return null;
      }

      if (entry.expiresAt <= now) {
        store.delete(key);
        return null;
      }

      return entry.value;
    },
    set(key, value) {
      const now = Date.now();
      purgeExpired(now);

      if (store.size >= maxEntries) {
        const firstKey = store.keys().next().value;
        if (firstKey) {
          store.delete(firstKey);
        }
      }

      store.set(key, {
        value,
        expiresAt: now + ttlMs
      });
    },
    size() {
      purgeExpired(Date.now());
      return store.size;
    }
  };
}

module.exports = {
  createTtlCache
};

