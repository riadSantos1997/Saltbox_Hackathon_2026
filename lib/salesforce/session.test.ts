/**
 * lib/salesforce/session.test.ts — unit tests for env-var session reader (A1)
 *
 * Uses vi.stubEnv / vi.unstubAllEnvs to keep tests hermetic — no leak
 * from one test to another, no dependency on the real shell env.
 *
 * Note: the exported entry point is `readSession(org)` (not
 * `getSession`). Tests target the actual export.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSession } from "./session";

const OUR_VARS = [
  "SF_ORG_A_ACCESS_TOKEN",
  "SF_ORG_A_DOMAIN",
  "SF_ORG_A_API_VERSION",
  "SF_ORG_B_ACCESS_TOKEN",
  "SF_ORG_B_DOMAIN",
  "SF_ORG_B_API_VERSION",
] as const;

// Snapshot + restore approach. vi.stubEnv with "" sets the var to the
// empty string (not unset), which breaks `??`-based defaults. To get a
// truly-unset var we delete from process.env and restore the original
// values in afterEach.
const originalValues: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of OUR_VARS) {
    originalValues[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const key of OUR_VARS) {
    const prev = originalValues[key];
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
});

describe("readSession — happy path", () => {
  it("returns a session shape for Org A when env vars are set", () => {
    vi.stubEnv("SF_ORG_A_ACCESS_TOKEN", "token-A");
    vi.stubEnv("SF_ORG_A_DOMAIN", "orga.my.salesforce.com");
    vi.stubEnv("SF_ORG_A_API_VERSION", "v60.0");

    const session = readSession("A");
    expect(session).toEqual({
      org: "A",
      accessToken: "token-A",
      domain: "orga.my.salesforce.com",
      apiVersion: "v60.0",
    });
  });

  it("returns a session shape for Org B when env vars are set", () => {
    vi.stubEnv("SF_ORG_B_ACCESS_TOKEN", "token-B");
    vi.stubEnv("SF_ORG_B_DOMAIN", "orgb.my.salesforce.com");
    vi.stubEnv("SF_ORG_B_API_VERSION", "v61.0");

    const session = readSession("B");
    expect(session.org).toBe("B");
    expect(session.accessToken).toBe("token-B");
    expect(session.domain).toBe("orgb.my.salesforce.com");
    expect(session.apiVersion).toBe("v61.0");
  });
});

describe("readSession — missing required vars", () => {
  it("throws a clear error naming SF_ORG_A_ACCESS_TOKEN when it is missing", () => {
    // Only domain set; access token intentionally absent.
    vi.stubEnv("SF_ORG_A_DOMAIN", "orga.my.salesforce.com");

    expect(() => readSession("A")).toThrowError(/SF_ORG_A_ACCESS_TOKEN/);
  });

  it("throws a clear error naming SF_ORG_B_ACCESS_TOKEN when it is missing for Org B", () => {
    vi.stubEnv("SF_ORG_B_DOMAIN", "orgb.my.salesforce.com");

    expect(() => readSession("B")).toThrowError(/SF_ORG_B_ACCESS_TOKEN/);
  });

  it("throws a clear error naming SF_ORG_A_DOMAIN when only the access token is set", () => {
    vi.stubEnv("SF_ORG_A_ACCESS_TOKEN", "token-A");

    expect(() => readSession("A")).toThrowError(/SF_ORG_A_DOMAIN/);
  });

  it("throws a clear error naming SF_ORG_B_DOMAIN when only the access token is set", () => {
    vi.stubEnv("SF_ORG_B_ACCESS_TOKEN", "token-B");

    expect(() => readSession("B")).toThrowError(/SF_ORG_B_DOMAIN/);
  });
});

describe("readSession — API version defaulting and normalisation", () => {
  it("defaults apiVersion to v60.0 when the env var is unset", () => {
    vi.stubEnv("SF_ORG_A_ACCESS_TOKEN", "token-A");
    vi.stubEnv("SF_ORG_A_DOMAIN", "orga.my.salesforce.com");
    // SF_ORG_A_API_VERSION intentionally NOT stubbed — the beforeEach
    // deleted it so `process.env.SF_ORG_A_API_VERSION` is undefined,
    // triggering the nullish-coalescing default.

    const session = readSession("A");
    expect(session.apiVersion).toBe("v60.0");
  });

  it("normalises an apiVersion missing the leading 'v' to include it", () => {
    vi.stubEnv("SF_ORG_A_ACCESS_TOKEN", "token-A");
    vi.stubEnv("SF_ORG_A_DOMAIN", "orga.my.salesforce.com");
    vi.stubEnv("SF_ORG_A_API_VERSION", "62.0");

    const session = readSession("A");
    expect(session.apiVersion).toBe("v62.0");
  });
});

describe("readSession — domain normalisation", () => {
  it("strips https:// from the domain", () => {
    vi.stubEnv("SF_ORG_A_ACCESS_TOKEN", "token-A");
    vi.stubEnv("SF_ORG_A_DOMAIN", "https://orga.my.salesforce.com");

    const session = readSession("A");
    expect(session.domain).toBe("orga.my.salesforce.com");
  });

  it("strips http:// from the domain", () => {
    vi.stubEnv("SF_ORG_A_ACCESS_TOKEN", "token-A");
    vi.stubEnv("SF_ORG_A_DOMAIN", "http://orga.my.salesforce.com");

    const session = readSession("A");
    expect(session.domain).toBe("orga.my.salesforce.com");
  });

  it("strips trailing slashes from the domain", () => {
    vi.stubEnv("SF_ORG_A_ACCESS_TOKEN", "token-A");
    vi.stubEnv("SF_ORG_A_DOMAIN", "orga.my.salesforce.com///");

    const session = readSession("A");
    expect(session.domain).toBe("orga.my.salesforce.com");
  });
});

describe("readSession — isolation between orgs", () => {
  it("does not cross-read Org A creds when asked for Org B", () => {
    // Only Org A is set — Org B should still fail.
    vi.stubEnv("SF_ORG_A_ACCESS_TOKEN", "token-A");
    vi.stubEnv("SF_ORG_A_DOMAIN", "orga.my.salesforce.com");

    expect(() => readSession("B")).toThrowError(/SF_ORG_B_ACCESS_TOKEN/);
  });
});
