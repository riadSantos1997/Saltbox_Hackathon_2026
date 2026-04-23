/**
 * lib/salesforce/session.ts — org session reader (A1)
 *
 * The PRD assumes "both orgs are already connected to S1" — so in
 * production this module would read from S1's connected-org store. For
 * the hackathon MVP we read from env vars per-org:
 *
 *   SF_ORG_A_ACCESS_TOKEN, SF_ORG_A_DOMAIN, SF_ORG_A_API_VERSION
 *   SF_ORG_B_ACCESS_TOKEN, SF_ORG_B_DOMAIN, SF_ORG_B_API_VERSION
 *
 * API version defaults to "v60.0" when unset.
 */

import type { OrgId, OrgSession } from "./types";

const DEFAULT_API_VERSION = "v60.0";

/**
 * Read session credentials for the given org from environment variables.
 * Throws a descriptive error when required credentials are missing so
 * that API routes can surface a 500 with actionable text.
 */
export function readSession(org: OrgId): OrgSession {
  const prefix = `SF_ORG_${org}`;
  const accessToken = process.env[`${prefix}_ACCESS_TOKEN`];
  const domain = process.env[`${prefix}_DOMAIN`];
  const apiVersion = process.env[`${prefix}_API_VERSION`] ?? DEFAULT_API_VERSION;

  if (!accessToken) {
    throw new Error(
      `Missing ${prefix}_ACCESS_TOKEN — Org ${org} is not connected to S1.`,
    );
  }
  if (!domain) {
    throw new Error(
      `Missing ${prefix}_DOMAIN — set to the instance host, e.g. "mycompany.my.salesforce.com".`,
    );
  }

  return {
    org,
    accessToken,
    domain: stripProtocol(domain),
    apiVersion: normalizeApiVersion(apiVersion),
  };
}

function stripProtocol(host: string): string {
  return host.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function normalizeApiVersion(v: string): string {
  return v.startsWith("v") ? v : `v${v}`;
}
