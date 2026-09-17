import type { Capability } from "@legalos/agentos";

import type { ExecutionContext, Provider, ProviderResult } from "../index.ts";

/**
 * Multi-model gateway adapter.
 *
 * One API in front of many vendors' models, spoken through the widely
 * implemented chat-completions shape. It exists so that adding a model is a
 * configuration change rather than an integration, which is what the capability
 * router and the benchmark-derived routing were built to assume.
 *
 * **No endpoint and no model id appears in this file.** Both come from the
 * environment, and that is deliberate rather than fastidious. A default model
 * written into source is a statement about which model suits a capability, and
 * this platform has measured nothing of the sort — the routing table already
 * refuses to rank providers without benchmark evidence, and hard-coding a model
 * here would be the same claim made somewhere the router cannot see it.
 *
 * Configuration:
 *
 *   AI_GATEWAY_URL                    base URL of the gateway
 *   AI_GATEWAY_API_KEY                credential
 *   AI_GATEWAY_MODEL                  model used when a capability has no override
 *   AI_GATEWAY_MODEL_<CAPABILITY>     optional per-capability model
 *
 * The per-capability form is an override and not a ranking. With one model
 * configured for a capability there is nothing being chosen between, exactly as
 * with one configured provider.
 */

export interface GatewayOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Model used where a capability has no specific one. */
  readonly defaultModel: string;
  /** Per-capability models, keyed by capability. */
  readonly models?: Readonly<Partial<Record<Capability, string>>>;
  readonly timeoutMs?: number;
  /**
   * Upper bound on the completion.
   *
   * Without it a gateway reserves the model's full context window and prices
   * the request against that, which fails on any account without the credit to
   * cover a maximal response — a 402 that reads as a billing problem when the
   * request was only ever going to be a few hundred tokens. It is also the
   * cheapest cost control there is.
   */
  readonly maxTokens?: number;
  /** Sent so the gateway can attribute traffic. Never a credential. */
  readonly referer?: string;
}

/** Reads gateway configuration, or says what is missing. */
export function gatewayOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): { ok: true; options: GatewayOptions } | { ok: false; missing: readonly string[] } {
  const missing: string[] = [];
  if (!env.AI_GATEWAY_URL) missing.push("AI_GATEWAY_URL");
  if (!env.AI_GATEWAY_API_KEY) missing.push("AI_GATEWAY_API_KEY");
  if (!env.AI_GATEWAY_MODEL) missing.push("AI_GATEWAY_MODEL");
  if (missing.length > 0) return { ok: false, missing };

  const models: Partial<Record<Capability, string>> = {};
  for (const [key, value] of Object.entries(env)) {
    const match = key.match(/^AI_GATEWAY_MODEL_(.+)$/);
    if (match && value) models[match[1]!.toLowerCase() as Capability] = value;
  }

  return {
    ok: true,
    options: {
      baseUrl: env.AI_GATEWAY_URL!,
      apiKey: env.AI_GATEWAY_API_KEY!,
      defaultModel: env.AI_GATEWAY_MODEL!,
      ...(env.AI_GATEWAY_MAX_TOKENS ? { maxTokens: Number(env.AI_GATEWAY_MAX_TOKENS) } : {}),
      models,
      ...(env.AI_GATEWAY_REFERER ? { referer: env.AI_GATEWAY_REFERER } : {}),
    },
  };
}

interface ChatResponse {
  id?: unknown;
  model?: unknown;
  provider?: unknown;
  choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class GatewayProvider implements Provider {
  readonly #options: GatewayOptions;

  constructor(options: GatewayOptions) {
    this.#options = options;
  }

  describe() {
    return {
      id: "gateway",
      model: this.#options.defaultModel,
      modelVersion: this.#options.defaultModel,
    };
  }

  /** The model for a capability, or the default. Not a ranking either way. */
  modelFor(capability: Capability): string {
    return this.#options.models?.[capability] ?? this.#options.defaultModel;
  }

  async execute(context: ExecutionContext, prompt: string): Promise<ProviderResult> {
    const startedAt = Date.now();
    const parsed = JSON.parse(prompt) as { system: string; user: string };
    const requested = this.modelFor(context.capability);

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#options.apiKey}`,
      "content-type": "application/json",
    };
    if (this.#options.referer) headers["http-referer"] = this.#options.referer;

    const response = await fetch(`${this.#options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: requested,
        max_tokens: this.#options.maxTokens ?? 2_048,
        messages: [
          { role: "system", content: parsed.system },
          // The user's message stays in its own turn. Concatenating it into the
          // system prompt is what lets an injected instruction outrank the
          // rules.
          { role: "user", content: parsed.user },
        ],
      }),
      signal: AbortSignal.timeout(this.#options.timeoutMs ?? 30_000),
    });

    if (!response.ok) {
      // The gateway's own message, and nothing else from the body.
      //
      // This previously threw the status alone, on the reasoning that a body
      // can carry account state. That reasoning cost hours: a 404 turned out to
      // mean "no allowed provider serves this model" and a 402 meant "no
      // max_tokens, so the full context window was priced" — neither knowable
      // from the number. The message field is the diagnosis; the rest of the
      // body is still discarded, and it is truncated so a verbose upstream
      // cannot push detail into a log.
      let reason = "";
      try {
        const body = (await response.json()) as { error?: { message?: unknown } };
        if (typeof body.error?.message === "string")
          reason = `: ${body.error.message.slice(0, 200)}`;
      } catch {
        // No parseable body. The status still tells the runner it failed.
      }
      throw new Error(`gateway returned ${response.status}${reason}`);
    }

    const body = (await response.json()) as ChatResponse;
    const content = body.choices?.[0]?.message?.content;

    return {
      response: typeof content === "string" ? content : "",
      // What actually answered. A gateway resolves an alias to a concrete
      // model, and that resolution can move without the alias moving.
      resolvedProvider: typeof body.provider === "string" ? body.provider : null,
      resolvedModel: typeof body.model === "string" ? body.model : requested,
      responseId: typeof body.id === "string" ? body.id : null,
      apiVersion: response.headers.get("x-api-version"),
      inputTokens: body.usage?.prompt_tokens ?? null,
      outputTokens: body.usage?.completion_tokens ?? null,
      latencyMs: Date.now() - startedAt,
      finishReason:
        typeof body.choices?.[0]?.finish_reason === "string"
          ? (body.choices[0].finish_reason as string)
          : null,
      endpoint: this.#options.baseUrl,
      retries: 0,
      metadata: { requestedModel: requested },
    };
  }
}
