import type { LegalSource, Proposition, SourceResolution } from "./types.ts";

export interface RegistryOptions {
  /**
   * Strict mode (the default) refuses to resolve sources that are unverified or
   * superseded. Turning it off is only appropriate for authoring and tests —
   * never for a request that produces user-facing legal output.
   */
  readonly strict?: boolean;
}

export class SourceRegistry {
  readonly #sources = new Map<string, LegalSource>();
  readonly #propositions = new Map<string, Proposition>();
  readonly #strict: boolean;

  constructor(sources: readonly LegalSource[] = [], options: RegistryOptions = {}) {
    this.#strict = options.strict ?? true;
    for (const source of sources) this.register(source);
  }

  get strict(): boolean {
    return this.#strict;
  }

  register(source: LegalSource): void {
    if (this.#sources.has(source.id)) {
      throw new Error(`duplicate source id: ${source.id}`);
    }
    this.#sources.set(source.id, source);
  }

  registerProposition(proposition: Proposition): void {
    if (!this.#sources.has(proposition.sourceId)) {
      throw new Error(`proposition ${proposition.id} cites unknown source ${proposition.sourceId}`);
    }
    if (this.#propositions.has(proposition.id)) {
      throw new Error(`duplicate proposition id: ${proposition.id}`);
    }
    this.#propositions.set(proposition.id, proposition);
  }

  /** Non-throwing resolution carrying an explicit failure reason. */
  resolve(sourceId: string): SourceResolution {
    const source = this.#sources.get(sourceId);
    if (!source) return { ok: false, source: null, failure: "SRC_UNKNOWN" };
    if (this.#strict && source.verificationStatus === "unverified") {
      return { ok: false, source, failure: "SRC_UNVERIFIED" };
    }
    if (this.#strict && source.verificationStatus === "superseded") {
      return { ok: false, source, failure: "SRC_SUPERSEDED" };
    }
    return { ok: true, source, failure: null };
  }

  /** Fail-closed accessor for call sites that cannot proceed without a source. */
  require(sourceId: string): LegalSource {
    const resolution = this.resolve(sourceId);
    if (!resolution.ok || !resolution.source) {
      throw new Error(`source not usable: ${sourceId} (${resolution.failure})`);
    }
    return resolution.source;
  }

  proposition(propositionId: string): Proposition | null {
    return this.#propositions.get(propositionId) ?? null;
  }

  list(): readonly LegalSource[] {
    return [...this.#sources.values()];
  }

  /** Sources that are recorded but not yet retrieved and checksummed. */
  unverified(): readonly LegalSource[] {
    return this.list().filter((s) => s.verificationStatus === "unverified");
  }
}
