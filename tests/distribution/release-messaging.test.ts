// story: e19s05
// scenario: SC-e19s05-P0-01 SC-e19s05-P0-03
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { presentReleaseStates } from "../../src/distribution/release-messaging.js";
import { runReleaseProcedure } from "../../src/distribution/release-procedure.js";

describe("e19s05 honest release states", () => {
  it("distinguishes local tarball, private distribution, and shipment blockers", () => {
    const view = presentReleaseStates();
    assert.equal(view.states.length, 3);
    assert.match(view.text, /maintained local npm tarball/i);
    assert.match(view.text, /private[ /-]?unpublished/i);
    assert.match(view.text, /shipment[- ]blocked/i);
    assert.doesNotMatch(view.text, /production-ready/i);
    assert.doesNotMatch(view.text, /Darwin.*verified|Windows.*verified/i);
    assert.match(view.text, /B06/i);
    assert.equal(runReleaseProcedure(process.cwd()).releaseStates.current, "shipment-blocked");
  });
});
