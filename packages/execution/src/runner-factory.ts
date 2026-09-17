import {
  createPool,
  PostgresAgentMetrics,
  PostgresExecutionLifecycle,
  PostgresExecutionStore,
  withTransaction,
  type PoolLike,
} from "@legalos/database";

import { ExecutionRunner, type Guardrails, type Provider } from "./index.ts";
import { GatewayProvider, gatewayOptionsFromEnv } from "./providers/gateway.ts";
import { XaiProvider } from "./providers/xai.ts";

/**
 * The composition root.
 *
 * A caller receives a runner or a reason it cannot have one. It never receives
 * a provider, and there is no exported way to build one, so a route has no
 * means of reaching a model that skips the record.
 *
 * Two refusals, both deliberate:
 *
 * **No database, no model call.** AU-005 says every execution is recorded. If
 * the record cannot be written the honest response is to decline, not to answer
 * and log nothing — the alternative is a system that quietly stops recording
 * exactly when its storage is in trouble, which is when the record matters
 * most.
 *
 * **No API key, no runner.** Offline is a real state and callers handle it;
 * what they must not do is construct their own way round.
 */

export type RunnerUnavailable =
  | { readonly reason: "NO_API_KEY"; readonly detail: string }
  | { readonly reason: "PROVIDER_NOT_CONFIGURED"; readonly detail: string }
  | { readonly reason: "NO_DATABASE"; readonly detail: string }
  | { readonly reason: "DATABASE_UNREACHABLE"; readonly detail: string };

export interface RunnerHandle {
  readonly runner: ExecutionRunner;
  /** Registers a prompt template version. Idempotent. */
  registerTemplate(input: {
    id: string;
    version: string;
    kind: "system" | "developer" | "user_template";
    body: string;
  }): Promise<string>;
  close(): Promise<void>;
}

export type RunnerResult =
  | { readonly ok: true; readonly handle: RunnerHandle }
  | { readonly ok: false; readonly unavailable: RunnerUnavailable };

export interface RunnerOptions {
  readonly guardrails: Guardrails;
  /** Repository root, so benchmark evidence can be read. */
  readonly repoRoot?: string;
  readonly now?: () => number;
  readonly env?: NodeJS.ProcessEnv;
}

export async function createRunner(options: RunnerOptions): Promise<RunnerResult> {
  const env = options.env ?? process.env;

  // Which adapter, from configuration. `AI_PROVIDER` names the integration and
  // never the model: choosing a model is the routing table's job, and a default
  // written here would be a claim about model suitability made where the router
  // cannot see it.
  const kind = env.AI_PROVIDER ?? "gateway";
  const providers = new Map<string, Provider>();

  if (kind === "gateway") {
    const configured = gatewayOptionsFromEnv(env);
    if (!configured.ok) {
      return {
        ok: false,
        unavailable: {
          reason: "NO_API_KEY",
          detail: `gateway provider is not configured: ${configured.missing.join(", ")} not set.`,
        },
      };
    }
    providers.set("gateway", new GatewayProvider(configured.options));
  } else if (kind === "xai") {
    if (!env.XAI_API_KEY) {
      return {
        ok: false,
        unavailable: { reason: "NO_API_KEY", detail: "XAI_API_KEY is not set." },
      };
    }
    providers.set("xai", new XaiProvider({ apiKey: env.XAI_API_KEY }));
  } else {
    return {
      ok: false,
      unavailable: {
        reason: "PROVIDER_NOT_CONFIGURED",
        detail: `AI_PROVIDER is ${kind}; expected gateway or xai.`,
      },
    };
  }

  if (!env.DATABASE_URL) {
    return {
      ok: false,
      unavailable: {
        reason: "NO_DATABASE",
        detail:
          "DATABASE_URL is not set, so an execution could not be recorded. Model calls are refused rather than made unrecorded.",
      },
    };
  }

  let pool: PoolLike;
  try {
    pool = await createPool(env.DATABASE_URL);
    await pool.query("SELECT 1");
  } catch (error) {
    return {
      ok: false,
      unavailable: {
        reason: "DATABASE_UNREACHABLE",
        detail: error instanceof Error ? error.message : "database unreachable",
      },
    };
  }

  // Read rather than configured: routing must cite evidence that exists on
  // disk, not a list someone passed in.
  const routingEvidence = options.repoRoot
    ? await (async () => {
        try {
          const { readRoutingEvidence } = await import("@legalos/bench");
          return await readRoutingEvidence(options.repoRoot!);
        } catch {
          return [];
        }
      })()
    : [];

  const runner = new ExecutionRunner({
    store: new PostgresExecutionStore(pool),
    lifecycle: new PostgresExecutionLifecycle(pool),
    // Keyed by routing id. Adding a second is a change here and to the routing
    // table; no agent definition and no route is touched.
    providers,
    projection: new PostgresAgentMetrics(pool),
    guardrails: options.guardrails,
    routingEvidence,
    now: options.now ?? Date.now,
  });

  return {
    ok: true,
    handle: {
      runner,
      registerTemplate: (input) =>
        withTransaction(pool, (tx) => new PostgresExecutionStore(tx).recordTemplate(input)),
      close: () => pool.end(),
    },
  };
}
