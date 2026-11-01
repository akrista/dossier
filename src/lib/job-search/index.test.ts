import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";
import { jsearchV2LastPage, jsearchV2Page } from "@/test/job-search-fixtures";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));

import { clearJobSearchCache } from "./cache";
import * as configMod from "./config";
import { jobSearchError } from "./errors";
import { askSource, fullText } from "./find";
import * as indexMod from "./index";
import { postingDetails, searchPostings, testSource } from "./index";
import { EMPTY_QUERY } from "./search";
import { sourceCovers } from "./sources";

const query = { ...EMPTY_QUERY, keywords: "designer", country: "de" };
const ninja = { key: "ak_test", host: "openwebninja" as const };

beforeEach(() => {
  clearJobSearchCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("searchPostings", () => {
  it("asks the source once per half hour for the same search and page", async () => {
    const requests = stubFetch(() => json(jsearchV2Page));
    const first = await searchPostings("JSEARCH", ninja, query);
    const again = await searchPostings("JSEARCH", ninja, query);
    expect(again).toEqual(first);
    expect(requests).toHaveLength(1);

    await searchPostings("JSEARCH", ninja, query, first.next);
    await searchPostings("JSEARCH", ninja, { ...query, remoteOnly: true });
    expect(requests).toHaveLength(3);
  });

  it("doesn't keep failures", async () => {
    let status = 503;
    const requests = stubFetch(() => json(jsearchV2LastPage, { status }));
    await expect(searchPostings("JSEARCH", ninja, query)).rejects.toMatchObject({ problem: "unavailable" });
    status = 200;
    await expect(searchPostings("JSEARCH", ninja, query)).resolves.toMatchObject({ next: null });
    expect(requests).toHaveLength(2);
  });

  it("logs problems with the source without the search, but not a wrong key", async () => {
    const log = vi.mocked(console.error);
    stubFetch(() => json({}, { status: 404 }));
    await expect(searchPostings("JSEARCH", ninja, query)).rejects.toMatchObject({ problem: "changed" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("[job search] Error: JSEARCH: /jsearch/search-v2: HTTP 404");
    expect(String(log.mock.calls[0][0])).not.toContain("designer");

    stubFetch(() => json({}, { status: 401 }));
    await expect(searchPostings("JSEARCH", ninja, { ...query, keywords: "other" })).rejects.toMatchObject({ problem: "key" });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("says when a source doesn't cover the country, before asking it", async () => {
    const requests = stubFetch(() => json(jsearchV2Page));
    await expect(searchPostings("ARBEITSAGENTUR", {}, { ...query, country: "fr" })).rejects.toMatchObject({
      problem: "country",
      message: "Bundesagentur für Arbeit doesn't list jobs in France. Choose another country, or another source in Settings → Job search.",
    });
    expect(requests).toHaveLength(0);
    expect(sourceCovers("ADZUNA", "de")).toBe(true);
    expect(sourceCovers("ADZUNA", "jp")).toBe(false);
    expect(sourceCovers("JSEARCH", "jp")).toBe(true);
  });
});

describe("postingDetails", () => {
  it("returns a complete description as it is", async () => {
    const requests = stubFetch(() => json(jsearchV2Page));
    const [posting] = (await searchPostings("JSEARCH", ninja, query)).postings;
    expect(await postingDetails("JSEARCH", ninja, posting)).toBe(posting.description);
    expect(requests).toHaveLength(1);
  });

  it("asks the source for the rest of an incomplete one, and keeps it", async () => {
    stubFetch(() => json(jsearchV2Page));
    const [posting] = (await searchPostings("JSEARCH", ninja, query)).postings;
    const partial = { ...posting, complete: false };
    expect(await postingDetails("JSEARCH", ninja, partial)).toBe(posting.description);
    expect(await postingDetails("JSEARCH", ninja, { ...partial, description: "" })).toBe(posting.description);
    expect(await postingDetails("JSEARCH", ninja, { ...partial, externalId: "other", description: "" })).toBeNull();
  });
});

describe("testSource", () => {
  it("passes when the source answers", async () => {
    stubFetch(() => json(jsearchV2LastPage));
    await expect(testSource("JSEARCH", ninja)).resolves.toBeUndefined();
  });

  it("throws the problem when it doesn't", async () => {
    stubFetch(() => json({}, { status: 401 }));
    await expect(testSource("JSEARCH", ninja)).rejects.toMatchObject({ problem: "key" });
  });
});

describe("askSource & fullText runtime key failover", () => {
  const makeConfig = (key: string): configMod.JobSearchConfig => ({
    source: "JSEARCH",
    saved: true,
    jsearch: { key, host: "openwebninja", keyState: "set" },
    adzuna: { appId: "", key: null, keyState: "none" },
    arbeitsagentur: { offered: true, acceptedAt: null },
    freehire: { url: "https://freehire.me" },
  });

  it("retries askSource with the secondary key when the primary fails with key, quota, or unavailable", async () => {
    vi.spyOn(configMod, "loadJobSearchConfigChain").mockResolvedValue([makeConfig("ak_primary"), makeConfig("ak_secondary")]);
    let calls = 0;
    const requests = stubFetch(() => {
      calls += 1;
      if (calls === 1) return json({}, { status: 429 });
      return json(jsearchV2LastPage);
    });

    const res = await askSource(query);
    expect(res).toMatchObject({ ok: true, source: "JSEARCH", next: null });
    expect(requests).toHaveLength(2);
    expect(requests[0].headers.get("x-api-key")).toBe("ak_primary");
    expect(requests[1].headers.get("x-api-key")).toBe("ak_secondary");
  });

  it("does not retry askSource on non-failover problems such as country or changed", async () => {
    vi.spyOn(configMod, "loadJobSearchConfigChain").mockResolvedValue([makeConfig("ak_primary"), makeConfig("ak_secondary")]);
    const requests = stubFetch(() => json({}, { status: 404 }));

    const res = await askSource(query);
    expect(res).toMatchObject({ ok: false, problem: "changed" });
    expect(requests).toHaveLength(1);
  });

  it("retries fullText with the secondary key when the primary fails with key or quota", async () => {
    stubFetch(() => json(jsearchV2Page));
    const [posting] = (await searchPostings("JSEARCH", ninja, query)).postings;
    clearJobSearchCache();

    vi.spyOn(configMod, "loadJobSearchConfigChain").mockResolvedValue([makeConfig("ak_primary"), makeConfig("ak_secondary")]);
    const detailsSpy = vi
      .spyOn(indexMod, "postingDetails")
      .mockRejectedValueOnce(jobSearchError("key", "JSEARCH"))
      .mockResolvedValueOnce("Full job description after failover");

    const text = await fullText({ ...posting, complete: false });
    expect(text).toBe("Full job description after failover");
    expect(detailsSpy).toHaveBeenCalledTimes(2);
    expect(detailsSpy.mock.calls[0][1]).toEqual({ key: "ak_primary", host: "openwebninja" });
    expect(detailsSpy.mock.calls[1][1]).toEqual({ key: "ak_secondary", host: "openwebninja" });
  });
});
