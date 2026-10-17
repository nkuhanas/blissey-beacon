import test from "node:test";
import assert from "node:assert/strict";
import { syntheticEvent, sendSyntheticEvent } from "../src/client.js";
import { isInferenceEvent } from "@blissey/contracts";
test("uses canonical fixture unchanged; caller may select a stable synthetic event ID", async () => {
  const fixture = await syntheticEvent();
  assert.equal(isInferenceEvent(fixture), true);
  assert.deepEqual(await syntheticEvent("retry-id"), {
    ...fixture,
    event_id: "retry-id",
  });
});
test("rejects insecure remote transport and credentials in URLs before connecting", async () => {
  const event = await syntheticEvent();
  for (const url of [
    "ws://example.com/api/devices/v1/stream",
    "wss://example.com/api?token=secret",
  ])
    await assert.rejects(
      sendSyntheticEvent({ url, token: "synthetic", event }),
    );
});
