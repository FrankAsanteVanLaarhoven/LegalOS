/**
 * @legalos/providers — bring your own model, keep the platform's guarantees.
 *
 * Letting an organisation supply its own inference is genuinely useful: it puts
 * inference inside their compliance boundary and lowers cost. It also creates
 * an obvious way to defeat everything else in this repository, if the
 * abstraction is drawn in the usual place.
 *
 * The usual place is "a provider supplies a model and its configuration". That
 * hands the customer the system prompt, and with it the guardrails — and the
 * platform is still the thing that displays the answer to an asylum seeker. A
 * customer-configured model that omits "never state a rule number you cannot
 * verify" produces output under LegalOS's name, to LegalOS's users.
 *
 * So the boundary here is narrower on purpose. A provider supplies transport:
 * credentials, an endpoint, a model name. It does not supply prompts, it does
 * not supply guardrails, and its output goes through the same verification and
 * policy path as everything else. `describeGuarantees` states this in terms an
 * enterprise buyer can check, because the honest sales position is "you control
 * where inference happens, not what we will show your clients".
 */

export type ProviderKind =
  "anthropic" | "azure" | "bedrock" | "gemini" | "openai_compatible" | "openrouter" | "self_hosted";

/**
 * A credential reference, never a credential.
 *
 * The secret lives in a secret store; this carries the handle. Keeping the key
 * out of the object means it cannot reach a log, an error report, an audit
 * payload or a serialised config by accident.
 */
export interface CredentialReference {
  readonly secretRef: string;
  /** Last four characters, for a human to recognise which key is configured. */
  readonly hint: string;
}

export interface ProviderConfig {
  readonly id: string;
  readonly kind: ProviderKind;
  /** Scoped to one workspace. A key is never shared across tenants. */
  readonly workspaceId: string;
  readonly endpoint: string;
  readonly model: string;
  readonly credential: CredentialReference;
  readonly enabled: boolean;
}

/**
 * Fields a caller might try to supply that would compromise the platform's
 * guarantees. Rejected by name so the refusal is legible rather than silent.
 */
const FORBIDDEN_CONFIG_KEYS = [
  "systemPrompt",
  "system_prompt",
  "guardrails",
  "instructions",
  "preamble",
  "skipVerification",
  "disableVerification",
  "bypassPolicy",
  "rawPassthrough",
] as const;

export class ProviderConfigurationError extends Error {
  constructor(key: string) {
    super(
      `a provider may not supply "${key}". Providers supply transport — endpoint, model and credentials. Prompts, guardrails and the verification path belong to the platform, because the platform is what shows the answer to the user.`
    );
    this.name = "ProviderConfigurationError";
  }
}

/**
 * Validates a provider configuration.
 *
 * Also rejects a plaintext-looking key: a credential that arrives in the config
 * object rather than as a reference has already been somewhere it should not be.
 */
export function configureProvider(input: Record<string, unknown>): ProviderConfig {
  for (const key of FORBIDDEN_CONFIG_KEYS) {
    if (key in input) throw new ProviderConfigurationError(key);
  }

  const credential = input.credential as CredentialReference | undefined;
  if (!credential || typeof credential.secretRef !== "string" || credential.secretRef === "") {
    throw new Error("provider requires a credential reference, not an inline key");
  }
  if (/^(sk-|xai-|AIza|ghp_)/.test(credential.secretRef)) {
    throw new Error(
      "credential.secretRef looks like an actual key. Store the secret and pass its reference; a key in this object will reach logs and audit payloads."
    );
  }

  const workspaceId = input.workspaceId;
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    throw new Error("provider must be scoped to a workspace");
  }

  return {
    id: String(input.id),
    kind: input.kind as ProviderKind,
    workspaceId,
    endpoint: String(input.endpoint),
    model: String(input.model),
    credential: { secretRef: credential.secretRef, hint: credential.hint ?? "" },
    enabled: input.enabled !== false,
  };
}

/** Redacts anything that could carry a secret, for logs and audit payloads. */
export function redactForLog(config: ProviderConfig): Record<string, unknown> {
  return {
    id: config.id,
    kind: config.kind,
    workspaceId: config.workspaceId,
    endpoint: config.endpoint,
    model: config.model,
    credential: `[secret ref, ending ${config.credential.hint}]`,
    enabled: config.enabled,
  };
}

/**
 * Whether a provider may serve a workspace.
 *
 * Fails closed on tenant mismatch. A misrouted provider would send one
 * organisation's case content to another organisation's endpoint and key.
 */
export function providerPermitted(config: ProviderConfig, workspaceId: string): boolean {
  return config.enabled && config.workspaceId === workspaceId;
}

export interface PlatformGuarantee {
  readonly guarantee: string;
  /** True when it holds regardless of which provider is configured. */
  readonly providerIndependent: boolean;
}

/**
 * What remains true whichever provider is connected.
 *
 * Written to be checkable by an enterprise buyer rather than reassuring. Each
 * of these is enforced elsewhere in the repository, not asserted here.
 */
export function describeGuarantees(): readonly PlatformGuarantee[] {
  return [
    {
      guarantee:
        "Guardrails and the system prompt are set by the platform. A provider cannot supply or override them.",
      providerIndependent: true,
    },
    {
      guarantee:
        "Every answer passes the verification gate before display: citations must resolve, and outcome guarantees, confidence figures and advice to proceed without a solicitor are withheld.",
      providerIndependent: true,
    },
    {
      guarantee:
        "The release decision is made by the platform's policy engine, not the model or its operator.",
      providerIndependent: true,
    },
    {
      guarantee:
        "Every released or withheld answer is recorded in the audit chain with the model and prompt version that produced it.",
      providerIndependent: true,
    },
    {
      guarantee:
        "Credentials are held by reference, scoped to one workspace, and never written to logs or audit payloads.",
      providerIndependent: true,
    },
    {
      guarantee:
        "Where inference runs, and therefore which jurisdiction processes the content, is determined by the connected provider.",
      providerIndependent: false,
    },
    {
      guarantee:
        "Answer quality, latency and cost depend on the connected model and are not controlled by the platform.",
      providerIndependent: false,
    },
  ];
}
