import test from "node:test";
import assert from "node:assert/strict";
import { overviewIncident } from "../src/dashboard/incident-selection.ts";
import { createOperatorApi } from "../src/operator-api.ts";
test("resolved overview expires after sixty seconds without removing history or hiding active incidents", () => {
  const now = Date.now();
  const records = [
    {
      id: "resolved",
      room_id: "104",
      status: "resolved",
      resolved_at: new Date(now).toISOString(),
    },
  ] as never;
  assert.equal(overviewIncident(records, "104", now + 59_999)?.id, "resolved");
  assert.equal(overviewIncident(records, "104", now + 60_000), undefined);
  assert.equal(
    overviewIncident(records, "104", now + 60_000, "resolved")?.id,
    "resolved",
  );
  assert.equal(overviewIncident(records, "101", now), undefined);
  assert.equal(
    overviewIncident(
      [{ id: "active", room_id: "104", status: "pending" }] as never,
      "104",
      now + 999_999,
    )?.id,
    "active",
  );
});
test("room reset is one authorized idempotent request, never a family dispatch", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return Response.json({
      room_id: "101",
      archived_incidents: 3,
      archived_events: 3,
    });
  };
  try {
    const api = createOperatorApi("https://api.example.test", "test-jwt");
    await api.resetRoom("demo_facility", "101", "same-reset-intent");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://api.example.test/api/operator/rooms/101/reset",
    );
    assert.equal(
      new Headers(calls[0].init.headers).get("Idempotency-Key"),
      "same-reset-intent",
    );
    assert.equal(
      new Headers(calls[0].init.headers).get("Authorization"),
      "Bearer test-jwt",
    );
  } finally {
    globalThis.fetch = original;
  }
});
