import { test } from "node:test";
import assert from "node:assert/strict";

import {
  configureProvider,
  describeGuarantees,
  ProviderConfigurationError,
  providerPermitted,
  redactForLog,
} from "../src/index.ts";

const VALID = {
  id: "p1",
  kind: "anthropic",
  workspaceId: "ws-1",
  endpoint: "https://api.example.invalid/v1",
  model: "some-model",
  credential: { secretRef: "vault://ws-1/provider-key", hint: "9f2a" },
};

test("a valid provider configures", () => {
  const config = configureProvider(VALID);
  assert.equal(config.workspaceId, "ws-1");
  assert.equal(config.enabled, true);
});

test("a provider may not supply prompts or guardrails", () => {
  for (const key of ["systemPrompt", "guardrails", "instructions", "preamble"]) {
    assert.throws(
      () => configureProvider({ ...VALID, [key]: "you are a helpful assistant" }),
      ProviderConfigurationError,
      key
    );
  }
});

test("a provider may not ask to skip verification", () => {
  for (const key of ["skipVerification", "disableVerification", "bypassPolicy", "rawPassthrough"]) {
    assert.throws(
      () => configureProvider({ ...VALID, [key]: true }),
      ProviderConfigurationError,
      key
    );
  }
});

test("the refusal explains where the boundary is", () => {
  try {
    configureProvider({ ...VALID, systemPrompt: "x" });
    assert.fail("should have thrown");
  } catch (error) {
    assert.match((error as Error).message, /Providers supply transport/);
    assert.match((error as Error).message, /the platform is what shows the answer to the user/);
  }
});

test("an inline key is refused", () => {
  assert.throws(
    () =>
      configureProvider({ ...VALID, credential: { secretRef: "sk-live-abc123", hint: "c123" } }),
    /looks like an actual key/
  );
  assert.throws(
    () => configureProvider({ ...VALID, credential: undefined }),
    /credential reference, not an inline key/
  );
});

test("a provider must be scoped to a workspace", () => {
  assert.throws(() => configureProvider({ ...VALID, workspaceId: "  " }), /scoped to a workspace/);
});

test("a provider never serves another tenant", () => {
  const config = configureProvider(VALID);
  assert.equal(providerPermitted(config, "ws-1"), true);
  assert.equal(providerPermitted(config, "ws-2"), false);
  assert.equal(providerPermitted({ ...config, enabled: false }, "ws-1"), false);
});

test("nothing secret survives redaction", () => {
  const redacted = JSON.stringify(redactForLog(configureProvider(VALID)));
  assert.equal(redacted.includes("vault://"), false);
  assert.match(redacted, /secret ref, ending 9f2a/);
});

test("guarantees separate what the platform controls from what it does not", () => {
  const guarantees = describeGuarantees();
  const independent = guarantees.filter((g) => g.providerIndependent);
  const dependent = guarantees.filter((g) => !g.providerIndependent);

  assert.ok(independent.some((g) => /verification gate/.test(g.guarantee)));
  assert.ok(independent.some((g) => /cannot supply or override/.test(g.guarantee)));
  assert.ok(independent.some((g) => /audit chain/.test(g.guarantee)));

  // The honest half: things a customer's choice does decide.
  assert.ok(dependent.length >= 2, "must state what the platform does not control");
  assert.ok(dependent.some((g) => /jurisdiction/.test(g.guarantee)));
});
