// Minimal key/value store with TTL, used by courseMappingStore.js to
// persist admin-configured webinar URL overrides. Swap implementations by
// setting REDIS_URL.
//
// The in-memory implementation only works within a single Node process — it
// does NOT dedupe across multiple instances/replicas or across restarts.
// Use the Redis-backed store for any real deployment with more than one
// instance (which most production deployments will have).

class MemoryStore {
  constructor() {
    this._map = new Map();
  }

  async get(key) {
    const entry = this._map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this._map.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key, value, ttlSeconds) {
    this._map.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async delete(key) {
    this._map.delete(key);
  }
}

class RedisStore {
  constructor(redisUrl) {
    // Imported lazily so environments without Redis configured never pay
    // the cost of loading/connecting the client.
    this._ready = import("ioredis").then(({ default: Redis }) => {
      this._client = new Redis(redisUrl, { lazyConnect: false });
      return this._client;
    });
  }

  async _client_() {
    await this._ready;
    return this._client;
  }

  async get(key) {
    const client = await this._client_();
    const raw = await client.get(key);
    return raw === null ? null : JSON.parse(raw);
  }

  async set(key, value, ttlSeconds) {
    const client = await this._client_();
    await client.set(key, JSON.stringify(value), "EX", ttlSeconds);
  }

  async delete(key) {
    const client = await this._client_();
    await client.del(key);
  }
}

let singleton;

export function getStore(config) {
  if (!singleton) {
    singleton = config.redisUrl
      ? new RedisStore(config.redisUrl)
      : new MemoryStore();
  }
  return singleton;
}

// Exposed for tests that want an isolated store instance.
export function createMemoryStore() {
  return new MemoryStore();
}
