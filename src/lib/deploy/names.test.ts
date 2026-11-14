import assert from "node:assert/strict";
import test from "node:test";
import { labelValue, serviceNameFor } from "./names.ts";

const VALID = /^[a-z]([a-z0-9-]{0,47}[a-z0-9])?$/;

test("a clean project id keeps a readable service name", () => {
  assert.equal(serviceNameFor("project-slotguard"), "forma-project-slotguard");
});

test("service names are always valid for Cloud Run", () => {
  for (const id of ["Project_One", "  weird id!! ", "UPPER", "a".repeat(100), "---", "", "ß∂ƒ", "9lives"]) {
    const name = serviceNameFor(id);
    assert.match(name, VALID, `${JSON.stringify(id)} -> ${name}`);
    assert.ok(name.length <= 49);
  }
});

test("ids that clean up to the same text still get different names", () => {
  assert.notEqual(serviceNameFor("My Project"), serviceNameFor("my-project"));
  assert.notEqual(serviceNameFor("a".repeat(60) + "1"), serviceNameFor("a".repeat(60) + "2"));
});

test("the same id always gives the same name", () => {
  assert.equal(serviceNameFor("Some Project"), serviceNameFor("Some Project"));
});

test("label values only contain allowed characters", () => {
  assert.match(labelValue("Project One!"), /^[a-z0-9_-]{1,63}$/);
  assert.equal(labelValue("!!!"), "-");
  assert.equal(labelValue(""), "none");
  assert.equal(labelValue("x".repeat(100)).length, 63);
});
