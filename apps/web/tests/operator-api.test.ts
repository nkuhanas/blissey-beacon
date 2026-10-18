import test from "node:test";
import assert from "node:assert/strict";
import { createOperatorApi, OperatorError } from "../src/operator-api.ts";

test("scenario retries preserve auth and idempotency without invoking notifications", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return Response.json({
      scenario_id: "synthetic",
      incident_id: null,
      room_id: "104",
      scenario: "empty",
    });
  };
  try {
    const api = createOperatorApi("https://api.example.test", "synthetic-jwt");
    for (let n = 0; n < 2; n++)
      await api.instantiate(
        { facility_id: "demo_facility", room_id: "104", scenario: "empty" },
        "same-intent-key",
      );
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(
        call.url,
        "https://api.example.test/api/operator/demo/scenarios",
      );
      assert.equal(
        new Headers(call.init.headers).get("Authorization"),
        "Bearer synthetic-jwt",
      );
      assert.equal(
        new Headers(call.init.headers).get("Idempotency-Key"),
        "same-intent-key",
      );
      assert.equal(call.init.redirect, "error");
    }
  } finally {
    globalThis.fetch = original;
  }
});
test("operator client rejects malformed snapshots and exposes conflict without retry", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    const api = createOperatorApi("https://api.example.test", "synthetic-jwt");
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ error: "stale_revision" }, { status: 409 });
    };
    await assert.rejects(
      api.action(
        "synthetic",
        { expected_revision: 1, status: "acknowledged" },
        "same-intent-key",
      ),
      (e: unknown) => e instanceof OperatorError && e.status === 409,
    );
    assert.equal(calls, 1);
    globalThis.fetch = async () =>
      Response.json({
        rooms: [{ id: "104", phone_e164: "private" }],
        scenarios_enabled: true,
      });
    await assert.rejects(
      api.dashboard("demo_facility"),
      /Unexpected operator API response/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("room reset follows existing states, handles revision conflicts, and never contacts family or touches other rooms", async () => {
  const { resetRoomAlerts } = await import("../src/operator-api.ts");
  const states = new Map([
    ["room101-active", { status: "pending", revision: 1 }],
    ["room101-ack", { status: "acknowledged", revision: 1 }],
  ]);
  const writes = [];
  let conflict = true;
  const api = {
    incidents: async (_facility, cursor) =>
      cursor
        ? {
            incidents: [
              { id: "room101-ack", room_id: "101", status: "acknowledged" },
            ],
            next_cursor: null,
          }
        : {
            incidents: [
              { id: "room101-active", room_id: "101", status: "pending" },
              { id: "other-room", room_id: "104", status: "pending" },
            ],
            next_cursor: "cursor",
          },
    workflow: async (id) => ({ ...states.get(id) }),
    action: async (id, input) => {
      if (conflict) {
        conflict = false;
        throw new OperatorError("incident_revision_conflict", 409);
      }
      writes.push({ id, input });
      states.set(id, {
        status: input.status,
        revision: input.expected_revision + 1,
      });
      return { action: {} };
    },
  };
  assert.equal(await resetRoomAlerts(api as never, "demo_facility", "101"), 2);
  assert.deepEqual(
    [...states.values()].map((x) => x.status),
    ["resolved", "resolved"],
  );
  assert.equal(writes.length, 5);
  assert.ok(
    writes.every(
      (x) =>
        x.id !== "other-room" &&
        x.input.note.includes("No notification authorized"),
    ),
  );
});
