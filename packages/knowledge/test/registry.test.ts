import { test } from "node:test";
import assert from "node:assert/strict";

import { SourceRegistry } from "../src/registry.ts";
import { createUkRegistry, UK_SOURCES } from "../src/index.ts";
import type { LegalSource } from "../src/types.ts";

const verified: LegalSource = {
  id: "test.verified",
  kind: "immigration_rule",
  title: "Test rule",
  citation: "Test rule para 1",
  publisher: "test",
  url: "https://example.invalid/rule",
  version: "2026-01-01",
  retrievedAt: "2026-01-01",
  checksum: "0".repeat(64),
  verificationStatus: "verified",
};

const superseded: LegalSource = {
  ...verified,
  id: "test.superseded",
  verificationStatus: "superseded",
  supersededBy: "test.verified",
};

test("strict registry refuses unknown sources", () => {
  const registry = new SourceRegistry([verified]);
  const resolution = registry.resolve("test.missing");
  assert.equal(resolution.ok, false);
  assert.equal(resolution.failure, "SRC_UNKNOWN");
  assert.equal(resolution.source, null);
});

test("strict registry refuses unverified sources", () => {
  const registry = createUkRegistry();
  const resolution = registry.resolve("uk.immigration-rules.appendix-skilled-worker");
  assert.equal(resolution.ok, false);
  assert.equal(resolution.failure, "SRC_UNVERIFIED");
});

test("strict registry refuses superseded sources", () => {
  const registry = new SourceRegistry([verified, superseded]);
  assert.equal(registry.resolve("test.superseded").failure, "SRC_SUPERSEDED");
});

test("non-strict registry resolves unverified sources for authoring only", () => {
  const registry = createUkRegistry(false);
  assert.equal(registry.resolve("uk.immigration-rules.appendix-graduate").ok, true);
});

test("require() throws rather than returning an unusable source", () => {
  const registry = createUkRegistry();
  assert.throws(() => registry.require("uk.immigration-rules.appendix-graduate"), /SRC_UNVERIFIED/);
  assert.equal(new SourceRegistry([verified]).require("test.verified").id, "test.verified");
});

test("propositions cannot cite an unregistered source", () => {
  const registry = new SourceRegistry([verified]);
  assert.throws(
    () =>
      registry.registerProposition({
        id: "p1",
        sourceId: "test.missing",
        locator: "para 1",
        text: "x",
      }),
    /unknown source/
  );
});

test("duplicate ids are rejected", () => {
  const registry = new SourceRegistry([verified]);
  assert.throws(() => registry.register(verified), /duplicate source id/);
});

test("every seeded UK source ships unverified with no checksum", () => {
  assert.ok(UK_SOURCES.length > 0);
  for (const source of UK_SOURCES) {
    assert.equal(source.verificationStatus, "unverified", source.id);
    assert.equal(source.checksum, null, source.id);
    assert.equal(source.retrievedAt, null, source.id);
    assert.match(source.url, /^https:\/\//, source.id);
  }
  assert.equal(createUkRegistry().unverified().length, UK_SOURCES.length);
});
