/** Short-lived, memory-only M5 data. Never persists passages or results to storage. */
export class ReadingDataCache {
  private session = "";
  private userId: string | undefined;
  private entries = new Map<string, { value?: unknown; expires: number; pending?: Promise<unknown> }>();

  private readonly now: () => number;
  private readonly ttl: number;
  constructor(now = Date.now, ttl = 60_000) { this.now = now; this.ttl = ttl; }

  putForUser<T>(userId: string, key: string, value: T) {
    if (userId && userId === this.userId) this.put(this.session, key, value);
  }

  setSession(session: string, userId?: string) {
    if (session !== this.session || userId !== this.userId) this.entries.clear();
    this.session = session;
    this.userId = userId;
  }

  peek<T>(key: string, userId?: string): T | undefined {
    if (!userId || userId !== this.userId || !this.session) return;
    const entry = this.entries.get(key);
    return entry && entry.expires > this.now() ? entry.value as T | undefined : undefined;
  }

  /** Drops one entry (and lets a pending request finish without filling it). */
  forget(key: string) {
    this.entries.delete(key);
  }

  put<T>(session: string, key: string, value: T) {
    if (!session || session !== this.session) return;
    this.entries.delete(key);
    this.entries.set(key, { value, expires: this.now() + this.ttl });
    if (this.entries.size > 30) this.entries.delete(this.entries.keys().next().value!);
  }

  async load<T>(session: string, key: string, fetch: () => Promise<T>, refresh = false): Promise<T> {
    // A response from a previous session may finish, but must never populate this cache.
    if (session !== this.session) return fetch();
    const existing = this.entries.get(key);
    if (existing?.pending) return existing.pending as Promise<T>;
    if (!refresh && existing && existing.expires > this.now()) return existing.value as T;
    const entry: { value?: unknown; expires: number; pending?: Promise<unknown> } = { expires: 0 };
    this.entries.set(key, entry);
    entry.pending = fetch().then(value => {
      if (this.entries.get(key) === entry) this.put(session, key, value);
      return value;
    }).catch(error => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    return entry.pending as Promise<T>;
  }
}
