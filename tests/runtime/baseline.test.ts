// story: e01s01
import assert from "node:assert/strict";
import test from "node:test";
import { runtimeBaseline } from "../../src/index.js";

test("the public baseline identifies Ganesh", () => {
  assert.equal(runtimeBaseline.name, "ganesh");
  assert.match(runtimeBaseline.version, /^\d+\.\d+\.\d+$/);
});
