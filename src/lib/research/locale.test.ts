import assert from "node:assert/strict";
import test from "node:test";
import { inferLocale, localeFromFields } from "./locale.ts";

test("a canvas without a place uses Helsinki and marks the assumption", () => {
  const locale = inferLocale("Small teams lose decisions after meetings.");
  assert.equal(locale.city, "Helsinki");
  assert.equal(locale.country, "Finland");
  assert.equal(locale.assumed, true);
});

test("Finnish on the canvas selects Finland without asking for a default city", () => {
  const locale = inferLocale("Finnish-language meetings may be a niche.");
  assert.equal(locale.countryCode, "FI");
  assert.equal(locale.assumed, false);
  assert.equal(locale.cityUnclear, false);
});

test("a country without a city asks for the city", () => {
  const locale = inferLocale("Sell this to salons in the United States.");
  assert.equal(locale.countryCode, "US");
  assert.equal(locale.cityUnclear, true);
  assert.equal(locale.city, "");
});

test("an edited country name resolves to a country code when it is known", () => {
  const locale = localeFromFields("Austin", "united states");
  assert.equal(locale.countryCode, "US");
  assert.equal(locale.city, "Austin");
  assert.equal(locale.assumed, false);
});
