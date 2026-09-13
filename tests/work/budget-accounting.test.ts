import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  createOwnerCapability,
  inspectBudget,
  reserveBudget,
  reviseContract,
  settleBudget
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";
import { classifiedInput, contract } from "../support/work-fixtures.js";

// story: e05s03
// scenario: SC-e05s03-P0-01

test("e05s03 budget ledger reservations are cumulative across retry revision reopen and spent totals; unknown spend is denied and uncertain is not zero", () => {
  const fixture = projectFixture();
  try {
    const owner = createOwnerCapability("owner-test");
    const input = classifiedInput(fixture.handle);
    const authorized = contract(fixture.handle, owner, [input.id], { limits: { tokens: 10, calls: 2, timeMs: 20, spend: 5 } });
    assert.equal(reserveBudget(fixture.handle, `${authorized.id}@1`, "budget-run-1", { tokens: 4, calls: 1, timeMs: 8, spend: 2 }, { status: "known", amount: 2, currency: "USD" }).status, "reserved");
    assert.equal(reserveBudget(fixture.handle, `${authorized.id}@1`, "budget-run-2", { tokens: 7, calls: 1, timeMs: 8, spend: 3 }, { status: "known", amount: 3, currency: "USD" }).status, "rejected");
    assert.equal(reserveBudget(fixture.handle, `${authorized.id}@1`, "budget-run-3", { tokens: 1, calls: 1, timeMs: 1, spend: 1 }, { status: "unknown", reason: "provider did not quote" }).status, "rejected");
    assert.equal(settleBudget(fixture.handle, "budget-run-1", { tokens: 3, calls: 1, timeMs: 5, spend: 2 }).status, "settled");
    assert.equal(inspectBudget(fixture.handle, authorized.id).spent.spend, 2);
    const revised = reviseContract(fixture.handle, owner, { contractId: authorized.id });
    assert.equal(inspectBudget(fixture.handle, revised.id, revised.version).spent.spend, 2);
    assert.equal(settleBudget(fixture.handle, "budget-run-uncertain", { tokens: 1 }, true).status, "rejected");
    assert.equal(reserveBudget(fixture.handle, `${authorized.id}@1`, "budget-run-unreserved-dimension", { tokens: 1, calls: 1, spend: 1 }, { status: "known", amount: 1, currency: "USD" }).status, "reserved");
    assert.throws(() => settleBudget(fixture.handle, "budget-run-unreserved-dimension", { timeMs: 1 }), /has no reservation/);
  } finally {
    disposeFixture(fixture);
  }
});
