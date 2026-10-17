import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  isInferenceEvent,
  validateAck,
  validateExplanation,
} from "../src/index.js";
const fixtures = JSON.parse(
  readFileSync(
    new URL("../fixtures/inference-events.json", import.meta.url),
    "utf8",
  ),
) as { name: string; valid: boolean; payload: unknown }[];
for (const fixture of fixtures)
  test(fixture.name, () =>
    assert.equal(isInferenceEvent(fixture.payload), fixture.valid),
  );
test("ACK and explanation contracts reject missing identity and fields", () => {
  assert.equal(
    validateAck({
      type: "event_ack",
      event_id: "e",
      incident_id: "i",
      status: "duplicate",
    }),
    true,
  );
  assert.equal(
    validateAck({ type: "event_ack", event_id: "e", status: "accepted" }),
    false,
  );
  assert.equal(
    validateExplanation({
      event_id: "e",
      title: "Possible event",
      description: "Uncertain sensor event.",
      recommended_action: "Review the room.",
    }),
    true,
  );
  assert.equal(
    validateExplanation({ event_id: "e", title: "Missing facts" }),
    false,
  );
});
