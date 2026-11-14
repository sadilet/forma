import assert from "node:assert/strict";
import test from "node:test";
import { catalogFromHits, keepKnownIds, websiteUrl } from "./citations.ts";

test("catalog drops duplicate or invalid urls", () => {
  const citations = catalogFromHits(
    [
      { title: "Fresha", url: "https://www.fresha.com/pricing", snippet: "Plans", sourceKind: "pricing" },
      { title: "Again", url: "https://www.fresha.com/pricing", snippet: "Duplicate", sourceKind: "pricing" },
      { title: "Broken", url: "not a url", snippet: "no", sourceKind: "news" },
    ],
    100,
  );
  assert.equal(citations.length, 1);
  assert.match(citations[0]?.id ?? "", /^cit_[0-9a-z]+$/);
  assert.equal(citations[0]?.domain, "fresha.com");
  assert.equal(citations[0]?.retrievedAt, 100);
});

test("a rerun keeps each url's citation id even when the order changes", () => {
  const fresha = { title: "Fresha", url: "https://fresha.com", snippet: "", sourceKind: "company" as const };
  const timma = { title: "Timma", url: "https://timma.fi", snippet: "", sourceKind: "company" as const };
  const first = catalogFromHits([fresha, timma]);
  const rerun = catalogFromHits([timma, fresha]);
  const idOf = (list: typeof first, url: string) => list.find((citation) => citation.url === url)?.id;
  assert.equal(idOf(first, fresha.url), idOf(rerun, fresha.url));
  assert.equal(idOf(first, timma.url), idOf(rerun, timma.url));
  assert.notEqual(idOf(first, fresha.url), idOf(first, timma.url));
});

test("keepKnownIds drops invented citation ids", () => {
  assert.deepEqual(keepKnownIds(["cit_1", "cit_9", "cit_1"], new Set(["cit_1"])), ["cit_1"]);
});

test("websiteUrl accepts a bare domain", () => {
  assert.equal(websiteUrl("fresha.com"), "https://fresha.com");
  assert.equal(websiteUrl("not a domain"), null);
});
