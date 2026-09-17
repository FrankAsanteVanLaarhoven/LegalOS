import OpenAI from "openai";

import type { ExecutionContext, Provider, ProviderResult } from "../index.ts";

/**
 * xAI provider adapter (OpenAI-compatible API).
 *
 * This file is the only place in the repository that constructs a model client,
 * and `@legalos/execution` is the only package permitted to depend on the SDK
 * that makes one. That is what makes AU-005 hold by construction: a route
 * cannot reach a model without going through the runner, because it has no way
 * to obtain a client.
 *
 * It previously lived in apps/web/src/lib/ai/client.ts, exported as
 * `getAIClient()`, and two routes called it directly. Both were correct and
 * careful, and neither produced an execution record.
 *
 * The adapter knows nothing about databases, workspaces, permissions, audit or
 * users. It receives a context and a prompt and returns what came back.
 */

/** Narrow view of the response shape, so callers need no `any`. */
interface RawResponse {
  output_text?: unknown;
  output?: { type?: string; content?: { text?: unknown }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function extractText(response: unknown): string {
  const typed = response as RawResponse;
  if (typeof typed.output_text === "string") return typed.output_text;
  const message = typed.output?.find((item) => item.type === "message");
  const text = message?.content?.[0]?.text;
  return typeof text === "string" ? text : "";
}

export const XAI_BASE_URL = "https://api.x.ai/v1";

export const DEFAULT_MODEL = process.env.XAI_MODEL ?? "grok-4.5";

export interface XaiOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export class XaiProvider implements Provider {
  readonly #client: OpenAI;
  readonly #baseUrl: string;
  readonly #maxRetries: number;
  readonly #model: string;

  constructor(options: XaiOptions) {
    this.#model = options.model ?? DEFAULT_MODEL;
    this.#baseUrl = options.baseUrl ?? XAI_BASE_URL;
    this.#maxRetries = options.maxRetries ?? 1;
    this.#client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: this.#baseUrl,
      // Without these the SDK defaults to a ten-minute timeout with two
      // retries, so one stalled upstream call holds an instance for half an
      // hour. The runner applies its own timeout as well; this is the floor.
      timeout: options.timeoutMs ?? 30_000,
      maxRetries: this.#maxRetries,
    });
  }

  describe() {
    return { id: "xai", model: this.#model, modelVersion: this.#model };
  }

  async execute(context: ExecutionContext, prompt: string): Promise<ProviderResult> {
    const startedAt = Date.now();
    const parsed = JSON.parse(prompt) as { system: string; user: string };

    const response = await this.#client.responses.create({
      model: this.#model,
      input: [
        { role: "system", content: parsed.system },
        // The user's message stays in its own turn. Concatenating it into the
        // system prompt is what lets an injected instruction outrank the rules.
        { role: "user", content: parsed.user },
      ],
    });

    const raw = response as RawResponse;
    return {
      response: extractText(response),
      inputTokens: raw.usage?.input_tokens ?? null,
      outputTokens: raw.usage?.output_tokens ?? null,
      latencyMs: Date.now() - startedAt,
      finishReason: "stop",
      endpoint: this.#baseUrl,
      retries: 0,
      metadata: { maxRetries: this.#maxRetries },
    };
  }
}
