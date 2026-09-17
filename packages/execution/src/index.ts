import { createHash } from "node:crypto";

import {
  AGENTS,
  findAgent,
  route,
  type AgentDefinition,
  type Capability,
  type RoutingEvidenceLike,
} from "@legalos/agentos";

/** Agents whose definition requires a named human to authorise a release. */
function agentsRequiringHumanReview(): readonly string[] {
  return AGENTS.filter((a) => a.requiresHumanReview).map((a) => a.id);
}

import type {
  AgentMetricsProjection,
  CompletionInput,
  ExecutionState,
  PostgresExecutionLifecycle,
  PostgresExecutionStore,
  RetrievalSnapshotInput,
  TerminalState,
} from "@legalos/database";

/**
 * @legalos/execution — the only way to call a model.
 *
 * Execution recording is infrastructure rather than a feature of the AI
 * package. Wired into `packages/ai` alone it would have to be retrofitted into
 * Evidence, Timeline, Communications, Bundle and every agent added afterwards,
 * and the one that got missed would be invisible: it would work perfectly and
 * simply not appear in any record.
 *
 * So the shape here is deliberate.
 *
 * **The runner owns the lifecycle.** Agents do not write execution records and
 * providers do not know a database exists. A provider receives a context and a
 * prompt and returns a response, usage, latency and a finish reason. It knows
 * nothing about workspaces, permissions, audit or users, which is what keeps it
 * swappable.
 *
 * **The record is created before the provider is called.** An execution that
 * times out, is refused by guardrails, or throws is still recorded. A log
 * containing only successes cannot answer the question anyone actually asks
 * after an incident.
 *
 * **Retrieval is persisted before the model is invoked.** An exception between
 * retrieving and persisting would leave an execution that can never be
 * replayed, and it would look identical to one that could.
 *
 * **The agent is resolved from the registry.** An id nobody registered is
 * refused before a provider is reachable, so there is no way to run work under
 * a name that is not governed — which is what would otherwise let an agent
 * escape its declared permissions by not having any.
 */

/** Raised when a request needs a capability its agent does not declare. */
export class CapabilityNotDeclaredError extends Error {
  constructor(agentId: string, capability: string) {
    super(
      `${agentId} does not declare the ${capability} capability. Declare it in the registry rather than requesting it here.`
    );
    this.name = "CapabilityNotDeclaredError";
  }
}

/** Raised when no configured provider serves a capability. */
export class NoProviderError extends Error {
  constructor(capability: string, reason: string) {
    super(`no provider for ${capability}: ${reason}`);
    this.name = "NoProviderError";
  }
}

/** Raised when an execution names an agent that is not in the registry. */
export class UnknownAgentError extends Error {
  readonly agentId: string;

  constructor(agentId: string) {
    super(
      `${agentId} is not a registered agent. Register it in @legalos/agentos rather than passing an id through.`
    );
    this.name = "UnknownAgentError";
    this.agentId = agentId;
  }
}

export type { ExecutionState, TerminalState };
export type { AgentDefinition };

/**
 * Everything downstream needs, assembled once and never mutated.
 *
 * Passing this rather than twenty parameters is not only tidier: a component
 * that cannot add to the context cannot quietly introduce an input that the
 * execution record does not mention, which would make the record incomplete
 * without making it wrong.
 */
export interface ExecutionContext {
  readonly executionId: string;
  /** The capability this request needed, which is what routing resolved from. */
  readonly capability: Capability;
  readonly workspaceId: string | null;
  readonly caseId: string | null;
  readonly organisationId: string | null;
  readonly actorId: string;
  readonly actorType: string;
  readonly sessionId: string | null;
  readonly deviceId: string | null;
  readonly department: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly promptTemplateId: string;
  readonly promptTemplateVersion: string;
  readonly retrievalSnapshotId: string | null;
  readonly guardrailVersion: string;
  readonly registryVersion: string;
  readonly requestedAt: string;
}

/** What a provider returns. Nothing about storage, identity or policy. */
export interface ProviderResult {
  readonly response: string;
  /**
   * What actually answered, where the provider can say.
   *
   * A gateway routes an alias to a concrete model, and the resolution can move
   * without the alias moving. Recording both is what keeps a replay honest
   * about which model produced the answer.
   */
  readonly resolvedProvider?: string | null;
  readonly resolvedModel?: string | null;
  readonly responseId?: string | null;
  readonly apiVersion?: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly latencyMs: number | null;
  readonly finishReason: string | null;
  readonly endpoint: string | null;
  readonly retries: number;
  readonly metadata: Record<string, unknown>;
}

/**
 * The provider port.
 *
 * Deliberately narrow. A provider that could reach a database would eventually
 * be given a reason to, and the independence this preserves is what allows a
 * model to be swapped without touching anything that decides what is allowed.
 */
export interface ProviderIdentity {
  /** Routing id, matching the preferences in the capability routing table. */
  readonly id: string;
  readonly model: string;
  readonly modelVersion: string;
}

export interface Provider {
  /** Who this is, so the record names what actually ran rather than what a caller asked for. */
  describe(): ProviderIdentity;
  /**
   * The model this provider will request for a capability, where it varies.
   *
   * Without this the record stored the provider's default while the adapter
   * sent a per-capability override, so an execution said it requested one model
   * and another answered. Both fields then disagreed with the truth, which is
   * the opposite of what recording requested and resolved is for.
   */
  modelFor?(capability: Capability): string;
  execute(context: ExecutionContext, prompt: string): Promise<ProviderResult>;
}

/** Applied after the model returns, before anything is released. */
export interface GuardrailVerdict {
  readonly verdict: "pass" | "flag" | "block";
  readonly detail: string | null;
  /**
   * Anything the caller needs alongside the verdict — findings, provenance,
   * certainty. Carried through rather than re-derived, because a route that had
   * to run the gate a second time to obtain them could run a different one.
   */
  readonly details?: Record<string, unknown>;
}

export interface Guardrails {
  check(context: ExecutionContext, response: string): Promise<GuardrailVerdict>;
}

export interface ExecutionRequest {
  /**
   * Everything except what routing decides.
   *
   * `provider`, `model` and `modelVersion` are absent on purpose: a caller that
   * can name a provider has bypassed the capability router, and the routing
   * table then describes a decision nobody makes. They are filled in from the
   * provider the router selected.
   */
  readonly context: Omit<
    ExecutionContext,
    "executionId" | "retrievalSnapshotId" | "provider" | "model" | "modelVersion" | "capability"
  >;
  /**
   * Which of the agent's declared capabilities this request needs.
   *
   * Must be one the agent declares. An agent asking for a capability it never
   * claimed is a caller reaching past the registry, and is refused.
   */
  readonly capability: Capability;
  readonly prompt: string;
  readonly userMessage: string;
  readonly systemPromptHash: string;
  readonly developerPromptHash?: string | null;
  /** Retrieval to persist before the model is invoked, if this call uses any. */
  readonly retrieval?: RetrievalSnapshotInput;
  readonly resolvedSources?: readonly string[];
  readonly verifiedSourceCount?: number;
  readonly unverifiedSourceCount?: number;
  /** Milliseconds before the call is abandoned and recorded as timed out. */
  readonly timeoutMs?: number;
}

export interface ExecutionOutcome {
  readonly executionId: string;
  readonly state: TerminalState;
  /** Present only when the response passed guardrails and was released. */
  readonly response: string | null;
  readonly verdict: "pass" | "flag" | "block" | null;
  readonly reason: string | null;
  /** Whatever the guardrails returned alongside the verdict. */
  readonly details: Record<string, unknown> | null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export interface RunnerDependencies {
  readonly store: PostgresExecutionStore;
  readonly lifecycle: PostgresExecutionLifecycle;
  /**
   * Configured providers, keyed by routing id.
   *
   * A map rather than one instance, because routing chooses between them. A
   * runner given a single provider would make the routing table a description
   * of a decision nobody makes.
   */
  readonly providers: ReadonlyMap<string, Provider>;
  readonly guardrails: Guardrails;
  /**
   * Benchmark evidence available to routing.
   *
   * Empty is a valid and common state, and it is not a failure: with one
   * configured provider nothing is being ranked. With several it means routing
   * refuses, which is the intended behaviour rather than a gap.
   */
  readonly routingEvidence?: readonly RoutingEvidenceLike[];
  /**
   * Refreshes the agent metrics projection as each execution completes.
   *
   * Optional because the projection is derived: a runner without one still
   * records everything, and a rebuild reconstructs the same numbers. Supplying
   * it is what makes standing continuous rather than periodic.
   */
  readonly projection?: AgentMetricsProjection;
  /** Injected so tests are deterministic and the runner never reads the clock. */
  readonly now: () => number;
}

export class ExecutionRunner {
  readonly #deps: RunnerDependencies;

  constructor(deps: RunnerDependencies) {
    this.#deps = deps;
  }

  /**
   * Runs one execution, recording it whatever happens.
   *
   * Ordering is the substance of this method. Retrieval is persisted before the
   * record is created; the record is created before the provider is called;
   * every terminal state writes a completion row. There is no path out of here
   * that reaches a provider without a record already existing, which is what
   * AU-005 asserts and what the integration suite checks by counting.
   */
  async execute(request: ExecutionRequest): Promise<ExecutionOutcome> {
    const { store, lifecycle, providers, guardrails, now } = this.#deps;
    const startedAt = now();

    // Before anything else, and before a provider is reachable. An unregistered
    // agent is a defect in the caller, not a runtime condition to record.
    const agent: AgentDefinition | null = findAgent(request.context.agentId);
    if (!agent) throw new UnknownAgentError(request.context.agentId);

    // The capability must be one the agent declares. Asking for a capability it
    // never claimed is a caller reaching past the registry, which would make
    // the declared capability list decorative.
    if (!agent.capabilities.includes(request.capability)) {
      throw new CapabilityNotDeclaredError(agent.id, request.capability);
    }

    // Routing resolves a provider from the capability. Nothing upstream names
    // one, so changing which model serves a capability is a change to the
    // routing table and to nothing else.
    const configured = [...providers.keys()];
    const routed = route({
      capability: request.capability,
      configured,
      evidence: this.#deps.routingEvidence ?? [],
      now: now(),
    });
    if (!routed.provider) {
      throw new NoProviderError(request.capability, routed.basis.detail);
    }
    const provider = providers.get(routed.provider)!;
    const described = provider.describe();
    // The model actually about to be requested, not the provider's default.
    const requestedModel = provider.modelFor?.(request.capability) ?? described.model;
    const identity = { ...described, model: requestedModel, modelVersion: requestedModel };

    // 1. Retrieval, persisted first. An exception after this point leaves an
    //    execution that is still replayable; an exception before it leaves no
    //    execution at all, which is the honest outcome.
    let snapshotId: string | null = null;
    let snapshotHash: string | null = null;
    if (request.retrieval) {
      const snapshot = await store.recordSnapshot(request.retrieval);
      snapshotId = snapshot.id;
      snapshotHash = snapshot.hash;
    }

    // 2. The request record, before the provider is reachable.
    const executionId = await store.record({
      workspaceId: request.context.workspaceId,
      caseId: request.context.caseId,
      organisationId: request.context.organisationId,
      actorId: request.context.actorId,
      actorType: request.context.actorType,
      sessionId: request.context.sessionId,
      deviceId: request.context.deviceId,
      department: request.context.department,
      agentId: request.context.agentId,
      agentVersion: request.context.agentVersion,
      provider: identity.id,
      model: identity.model,
      modelVersion: identity.modelVersion,
      promptTemplateId: request.context.promptTemplateId,
      promptTemplateVersion: request.context.promptTemplateVersion,
      systemPromptHash: request.systemPromptHash,
      developerPromptHash: request.developerPromptHash ?? null,
      userMessageHash: sha256(request.userMessage),
      retrievalSnapshotId: snapshotId,
      retrievalContextHash: snapshotHash,
      resolvedSources: request.resolvedSources ?? [],
      toolCalls: [],
      verifiedSourceCount: request.verifiedSourceCount ?? 0,
      unverifiedSourceCount: request.unverifiedSourceCount ?? 0,
      registryVersion: request.context.registryVersion,
      guardrailVersion: request.context.guardrailVersion,
      verificationVerdict: null,
      released: null,
      responseHash: null,
    });

    const context: ExecutionContext = {
      ...request.context,
      executionId,
      capability: request.capability,
      retrievalSnapshotId: snapshotId,
      provider: identity.id,
      model: identity.model,
      modelVersion: identity.modelVersion,
    };

    let state: ExecutionState = "created";
    const move = async (to: ExecutionState, detail?: string) => {
      await lifecycle.transition(executionId, state, to, detail);
      state = to;
    };
    await move(request.retrieval ? "retrieving" : "verified");
    if (request.retrieval) await move("verified");

    const finish = async (
      terminal: TerminalState,
      completion: Partial<CompletionInput>,
      reason: string | null
    ): Promise<ExecutionOutcome> => {
      await move(terminal, reason ?? undefined);
      const completed = lifecycle.complete(executionId, {
        terminalState: terminal,
        responseHash: null,
        verificationVerdict: null,
        released: false,
        latencyMs: now() - startedAt,
        inputTokens: null,
        outputTokens: null,
        estimatedCostPence: null,
        retries: 0,
        providerEndpoint: null,
        finishReason: null,
        providerMetadata: {},
        errorCode: null,
        errorDetail: reason,
        ...completion,
      });
      await completed;
      await this.#refresh(agent.id);
      return {
        executionId,
        state: terminal,
        response: null,
        verdict: completion.verificationVerdict ?? null,
        reason,
        details: null,
      };
    };

    // 3. The provider call. Every way out of it is recorded.
    await move("executing");
    let result: ProviderResult;
    try {
      result = await this.#withTimeout(
        provider.execute(context, request.prompt),
        request.timeoutMs
      );
    } catch (error) {
      const timedOut = error instanceof Error && error.message === "EXECUTION_TIMED_OUT";
      return finish(
        timedOut ? "timed_out" : "failed",
        { errorCode: timedOut ? "TIMEOUT" : "PROVIDER_ERROR" },
        error instanceof Error ? error.message : "unknown provider failure"
      );
    }

    // 4. Guardrails. A blocked answer is a recorded execution, not a silence.
    await move("guardrails");
    const verdict = await guardrails.check(context, result.response);
    const shared = {
      resolvedProvider: result.resolvedProvider ?? null,
      resolvedModel: result.resolvedModel ?? null,
      providerResponseId: result.responseId ?? null,
      providerApiVersion: result.apiVersion ?? null,
      latencyMs: result.latencyMs ?? now() - startedAt,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      estimatedCostPence: null,
      retries: result.retries,
      providerEndpoint: result.endpoint,
      finishReason: result.finishReason,
      providerMetadata: result.metadata,
    };

    if (verdict.verdict === "block") {
      const outcome = await finish(
        "blocked",
        { ...shared, verificationVerdict: "block", responseHash: sha256(result.response) },
        verdict.detail
      );
      return { ...outcome, response: null, details: verdict.details ?? null };
    }

    // An agent that declares it needs a named human to authorise never has its
    // output released automatically, however the gate voted. The verdict is
    // recorded either way, so the difference between "failed verification" and
    // "passed but awaits a person" stays visible.
    const released = verdict.verdict === "pass" && !agent.requiresHumanReview;
    await move("completed");
    await lifecycle.complete(executionId, {
      terminalState: "completed",
      responseHash: sha256(result.response),
      verificationVerdict: verdict.verdict,
      released,
      errorCode: null,
      errorDetail: null,
      ...shared,
    });
    await this.#refresh(agent.id);

    return {
      executionId,
      state: "completed",
      // Withheld rather than softened when it did not pass: a hedged unverified
      // answer is still an unverified answer, and it reads as caution.
      response: released ? result.response : null,
      verdict: verdict.verdict,
      reason: released
        ? null
        : agent.requiresHumanReview && verdict.verdict === "pass"
          ? `${agent.name} proposes; a named qualified human authorises before anything is released.`
          : verdict.detail,
      details: verdict.details ?? null,
    };
  }

  /**
   * Updates the projection for one agent, and never fails an execution for it.
   *
   * The projection is derived state. Losing an update loses nothing that a
   * rebuild cannot restore, and failing a person's request because an aggregate
   * could not be written would be the wrong trade — the execution itself is
   * already recorded by this point. A missed update shows up as drift, which is
   * measured.
   */
  async #refresh(agentId: string): Promise<void> {
    const { projection } = this.#deps;
    if (!projection) return;
    try {
      await projection.refreshAgent(agentId, agentsRequiringHumanReview());
    } catch (error) {
      console.error("[execution] agent metrics projection not updated", error);
    }
  }

  async #withTimeout<T>(work: Promise<T>, timeoutMs?: number): Promise<T> {
    if (!timeoutMs) return work;
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("EXECUTION_TIMED_OUT")), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export { XaiProvider, extractText, XAI_BASE_URL, type XaiOptions } from "./providers/xai.ts";
export {
  createRunner,
  type RunnerHandle,
  type RunnerOptions,
  type RunnerResult,
  type RunnerUnavailable,
} from "./runner-factory.ts";
export {
  GatewayProvider,
  gatewayOptionsFromEnv,
  type GatewayOptions,
} from "./providers/gateway.ts";
