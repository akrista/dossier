import "server-only";

import { credentialsChainFor, loadJobSearchConfigChain, requestContext } from "./config";
import { JobSearchError, type JobSearchProblem } from "./errors";
import { postingDetails, searchPostings } from "./index";
import type { FoundPosting, JobSource, SearchPage, SearchProblem, SearchQuery } from "./search";

// Asking a job source from Find jobs (E14-6): a page of postings, or what
// went wrong in words for the screen. Kept searches are in
// src/lib/posting-searches.ts.

const FAILOVER_PROBLEMS = new Set<JobSearchProblem>(["key", "quota", "unavailable"]);

export function shouldFailoverJobSearchError(error: unknown): boolean {
  return error instanceof JobSearchError && FAILOVER_PROBLEMS.has(error.problem);
}

/**
 * One page for `query` from `source`, the one chosen in Settings unless
 * given (a kept search goes on with the source it ran on).
 */
export async function askSource(
  query: SearchQuery,
  { source, next = null }: { source?: JobSource; next?: string | null } = {},
): Promise<({ ok: true; source: JobSource } & SearchPage) | SearchProblem> {
  const configs = await loadJobSearchConfigChain();
  const [primary] = configs;
  const from = source ?? primary.source;
  if (!from) return { ok: false, problem: "off", message: "Choose where to search in Settings → Job search first." };
  if (!query.country) return { ok: false, problem: "no-country", message: "Choose a country to search in." };
  try {
    const creds = credentialsChainFor(configs, from);
    const ctx = requestContext(from);
    try {
      const page = await searchPostings(from, creds[0], query, next, ctx);
      return { ok: true, source: from, ...page };
    } catch (error) {
      if (creds.length > 1 && shouldFailoverJobSearchError(error)) {
        const page = await searchPostings(from, creds[1], query, next, ctx);
        return { ok: true, source: from, ...page };
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof JobSearchError) return { ok: false, problem: error.problem, message: error.message };
    throw error;
  }
}

/**
 * The whole text of a posting, from its own source (which may no longer be
 * the one chosen, for a saved posting); null when it can't be had.
 */
export async function fullText(posting: FoundPosting): Promise<string | null> {
  if (posting.complete) return posting.description;
  try {
    const configs = await loadJobSearchConfigChain();
    const creds = credentialsChainFor(configs, posting.source);
    const ctx = requestContext(posting.source);
    try {
      return await postingDetails(posting.source, creds[0], posting, ctx);
    } catch (error) {
      if (creds.length > 1 && shouldFailoverJobSearchError(error)) {
        return await postingDetails(posting.source, creds[1], posting, ctx);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof JobSearchError) return null;
    throw error;
  }
}
