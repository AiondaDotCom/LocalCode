/**
 * LRU (Least Recently Used) Cache with fixed capacity.
 * Evicts the least recently used entry when full.
 */
export class LRUCache<V = number> {
  private capacity: number;
  private cache: Map<string, V>;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  /** Check if key exists (counts as access, moves to front). */
  has(key: string): boolean {
    if (!this.cache.has(key)) return false;
    // Move to end (most recently used) by re-inserting
    const value = this.cache.get(key) as V;
    this.cache.delete(key);
    this.cache.set(key, value);
    return true;
  }

  /** Get value and move to front. Returns undefined if not found. */
  get(key: string): V | undefined {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key) as V;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /** Set value. Evicts oldest entry if at capacity. */
  set(key: string, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Delete the first (oldest) entry
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
    this.cache.set(key, value);
  }

  /** Number of entries in cache. */
  get size(): number {
    return this.cache.size;
  }

  /** Clear all entries. */
  clear(): void {
    this.cache.clear();
  }
}
