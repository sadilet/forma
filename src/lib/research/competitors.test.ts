import assert from "node:assert/strict";
import test from "node:test";
import type { CompanyHit } from "../context-dev/source.ts";
import { catalogFromHits } from "./citations.ts";
import { bindCompetitors } from "./competitors.ts";

const telavox: CompanyHit = {
  name: "Telavox",
  domain: "telavox.com",
  description: "Cloud phone system",
  headcount: "201-500",
  fundingSummary: "Series C",
  headquarters: "Malmö",
};

const citations = catalogFromHits([
  { title: "Telavox", url: "https://telavox.com", snippet: "Cloud phone system", sourceKind: "company" },
  { title: "Pricing", url: "https://telavox.com/pricing", snippet: "From 19 EUR", sourceKind: "pricing" },
]);
const companyId = citations[0]!.id;
const pricingId = citations[1]!.id;

function drafted(overrides: Partial<Parameters<typeof bindCompetitors>[0][number]>) {
  return {
    name: "Telavox Finland (Enreach FI) — note: see exact name",
    domain: "https://www.telavox.com/fi",
    headcount: "31 staff",
    fundingSummary: "raised 1B",
    positioning: "Business phone for SMBs",
    pricingModel: "Per seat",
    strengths: [],
    weaknesses: [],
    citationIds: [pricingId, "cit_invented"],
    ...overrides,
  };
}

test("a competitor takes its name, domain, headcount, and funding from the retrieved company", () => {
  const [bound] = bindCompetitors([drafted({})], [telavox], citations);
  assert.equal(bound?.name, "Telavox");
  assert.equal(bound?.domain, "telavox.com");
  assert.equal(bound?.headcount, "201-500");
  assert.equal(bound?.fundingSummary, "Series C");
  assert.equal(bound?.positioning, "Business phone for SMBs");
  assert.deepEqual(bound?.citationIds, [companyId, pricingId]);
});

test("a competitor that was not retrieved is dropped even with a valid citation", () => {
  const bound = bindCompetitors([drafted({ name: "Invented Oy", domain: "invented.fi" })], [telavox], citations);
  assert.equal(bound.length, 0);
});

test("the same company is listed once", () => {
  const bound = bindCompetitors([drafted({}), drafted({ name: "Telavox", domain: "telavox.com" })], [telavox], citations);
  assert.equal(bound.length, 1);
});
