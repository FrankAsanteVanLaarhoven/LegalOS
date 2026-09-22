import { inspectConfidentiality } from "@legalos/fiduciary";

/**
 * Safe In-Memory Server Cache with strict Anti-Leakage Gates.
 *
 * Designed to cache deterministic public API reads (e.g. statutory links,
 * currency conversions, weather, legal corpus navigation) while strictly
 * preventing sensitive asylum notes, case files, or user PII from being cached.
 *
 * Fails closed: any attempt to cache an entry containing personal identifiers
 * (Home Office references, NI numbers, emails, phone numbers, postcodes) throws
 * or rejects storage, preventing cross-tenant leakage.
 */

interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
  readonly createdAt: number;
}

export class SafeMemoryCache<T = unknown> {
  readonly #store = new Map<string, CacheEntry<T>>();
  readonly #maxEntries: number;
  readonly #name: string;

  constructor(name: string, maxEntries = 200) {
    this.#name = name;
    this.#maxEntries = maxEntries;
  }

  /**
   * Retrieves an item if not expired.
   */
  get(key: string, now = Date.now()): T | null {
    const entry = this.#store.get(key);
    if (!entry) return null;

    if (now > entry.expiresAt) {
      this.#store.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Stores an item with a specified TTL (in milliseconds).
   *
   * Rejects keys or payloads that risk leaking identity or case data.
   */
  set(key: string, value: T, ttlMs: number, now = Date.now()): boolean {
    // 1. Key check: keys must not contain session or case indicators
    if (/(?:session|case-|user-|token|auth|account)/i.test(key)) {
      console.warn(
        `[SafeMemoryCache:${this.#name}] Refused to cache entry with sensitive key pattern: ${key}`
      );
      return false;
    }

    // 2. Value confidentiality check if serialisable to text
    if (typeof value === "string") {
      const check = inspectConfidentiality(value);
      if (!check.safeToSendExternally) {
        console.warn(
          `[SafeMemoryCache:${this.#name}] Refused to cache value containing detected PII identifiers:`,
          check.identifiers.map((i) => i.label)
        );
        return false;
      }
    } else if (value !== null && typeof value === "object") {
      try {
        const textRepresentation = JSON.stringify(value);
        const check = inspectConfidentiality(textRepresentation);
        if (!check.safeToSendExternally) {
          console.warn(
            `[SafeMemoryCache:${this.#name}] Refused to cache object containing detected PII:`,
            check.identifiers.map((i) => i.label)
          );
          return false;
        }
      } catch {
        // Non-serialisable objects: reject to fail-closed
        return false;
      }
    }

    // Capacity management: evict oldest if full
    if (this.#store.size >= this.#maxEntries) {
      const firstKey = this.#store.keys().next().value;
      if (firstKey) this.#store.delete(firstKey);
    }

    this.#store.set(key, {
      value,
      expiresAt: now + ttlMs,
      createdAt: now,
    });

    return true;
  }

  /**
   * Invalidates a key or sweeps expired items.
   */
  delete(key: string): void {
    this.#store.delete(key);
  }

  sweep(now = Date.now()): void {
    for (const [key, entry] of this.#store) {
      if (now > entry.expiresAt) {
        this.#store.delete(key);
      }
    }
  }

  size(): number {
    return this.#store.size;
  }
}

/** Global public resource cache */
export const publicResourceCache = new SafeMemoryCache<string>("public-resources", 100);
