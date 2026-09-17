import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * The storage boundary.
 *
 * A database and an object store are two systems, and there is no transaction
 * spanning them. Pretending otherwise is how an evidence item comes to point at
 * bytes that were never written — which is worse than a failed upload, because
 * it looks like success right up until somebody needs the document.
 *
 * The order chosen here, and what it costs:
 *
 *   1. Write the bytes. If this fails, nothing is recorded and the caller is
 *      told. No row, no orphan.
 *   2. Write the database rows. If this fails, the object is removed as
 *      compensation.
 *   3. If that removal also fails, the object is orphaned. This is the residual
 *      failure and it is stated rather than hidden: an orphaned object is
 *      unreferenced bytes on disk, which costs space and leaks nothing, and it
 *      is strictly better than a referenced row with no bytes.
 *
 * The provider below is named `development_filesystem` in the schema, in code
 * and in every report, so nothing can imply a production object store that does
 * not exist. There is no encryption at rest here and the schema records
 * `encryption_state = 'none'` accordingly — a claim of encryption without a
 * provider that performs it would be the worst kind of untrue.
 */

export interface EvidenceStorage {
  readonly provider: "development_filesystem" | "none";
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A bounded development provider.
 *
 * Deliberately not called `LocalStorage` or `FileStorage`: the name is the
 * honest description, and it appears in `evidence_files.storage_provider` so a
 * reader of the database can see what is actually behind a row.
 */
export class DevelopmentFilesystemStorage implements EvidenceStorage {
  readonly provider = "development_filesystem" as const;
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #path(key: string): string {
    // Keys are generated, never caller-supplied, but a traversal check costs
    // nothing and the alternative is a write outside the root.
    if (key.includes("..") || key.startsWith("/")) {
      throw new Error(`refusing a storage key that escapes the root: ${key}`);
    }
    return join(this.#root, key);
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const path = this.#path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.#path(key)));
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.#path(key), { force: true });
  }
}

/** A provider that stores nothing, for instances with no storage configured. */
export class NoStorage implements EvidenceStorage {
  readonly provider = "none" as const;
  async put(): Promise<void> {
    throw new Error("no evidence storage is configured for this instance");
  }
  async get(): Promise<Uint8Array | null> {
    return null;
  }
  async remove(): Promise<void> {
    /* nothing was stored */
  }
}
