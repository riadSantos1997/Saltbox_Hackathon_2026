/**
 * lib/salesforce/client.ts — Salesforce Tooling API client (A1)
 *
 * Thin wrapper around `fetch` that:
 *   - reads a bearer session token for the requested org
 *   - posts SOQL to the Tooling API `/query/` endpoint
 *   - enforces a 10s timeout (addresses PRD high-severity risk)
 *   - converts 401/403 to a distinct SessionExpiredError so the UI can
 *     render "Session expired. Reconnect Org X."
 *
 * Metadata SOAP API is explicitly forbidden (PRD). Only REST + Tooling.
 */

import { readSession } from "./session";
import {
  SessionExpiredError,
  type OrgId,
  type OrgSession,
  type SalesforceClient,
} from "./types";

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Build a client for the given org. Credentials are read eagerly so
 * missing env vars surface at construction time rather than on the first
 * query.
 */
export function getClient(org: OrgId): SalesforceClient {
  const session = readSession(org);
  return {
    org,
    query: <T = unknown>(soql: string) => runToolingQuery<T>(session, soql),
  };
}

async function runToolingQuery<T>(
  session: OrgSession,
  soql: string,
): Promise<T> {
  const url = buildToolingUrl(session, soql);
  const res = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      Accept: "application/json",
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new SessionExpiredError(session.org);
  }
  if (!res.ok) {
    const body = await safeReadText(res);
    throw new Error(
      `Salesforce query failed (Org ${session.org}, status ${res.status}): ${body}`,
    );
  }

  return (await res.json()) as T;
}

function buildToolingUrl(session: OrgSession, soql: string): string {
  const encoded = encodeURIComponent(soql);
  return `https://${session.domain}/services/data/${session.apiVersion}/tooling/query/?q=${encoded}`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  // AbortSignal.timeout is available in Node 20+, which Next.js 14 targets.
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(
        `Salesforce query timed out after ${REQUEST_TIMEOUT_MS}ms`,
      );
    }
    throw err;
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
