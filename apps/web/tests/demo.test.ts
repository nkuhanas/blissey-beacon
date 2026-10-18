import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canReviewCall,
  createDemo,
  demoReducer,
  roomStatus,
} from "../src/dashboard/model.ts";

test("incident workflow requires acknowledgment and preserves a resolved incident in history", () => {
  let state = createDemo();
  assert.equal(
    demoReducer(state, { type: "advance", status: "responding" }),
    state,
  );
  for (const status of ["acknowledged", "responding", "resolved"] as const)
    state = demoReducer(state, { type: "advance", status });
  assert.equal(state.incident?.status, "resolved");
  assert.equal(state.incident?.timeline.length, 4);
  assert.equal(
    demoReducer(state, { type: "advance", status: "acknowledged" }),
    state,
  );
});
test("revoking family consent blocks call review and contacts belong to their resident", () => {
  let state = createDemo();
  const room = state.rooms[3];
  assert.equal(canReviewCall(room, state.incident), true);
  state = demoReducer(state, {
    type: "contact",
    roomId: room.id,
    contact: { ...room.contact!, consent: false },
  });
  assert.equal(canReviewCall(state.rooms[3], state.incident), false);
  assert.equal(state.rooms[0].contact, null);
  assert.equal(
    canReviewCall(
      { ...room, contact: { ...room.contact!, phone: "invalid" } },
      state.incident,
    ),
    false,
  );
  assert.equal(canReviewCall({ ...room, id: "101" }, state.incident), false);
});
test("offline sensing never becomes a monitoring label and no-incident scenario stays empty", () => {
  const state = createDemo("offline");
  assert.ok(
    state.rooms.every(
      (room) => roomStatus(room, state.incident) === "Sensor offline",
    ),
  );
  assert.equal(createDemo("empty").incident, null);
});
test("notes and false alarm are retained, and reset clears contact changes and actions", () => {
  let state = demoReducer(createDemo(), {
    type: "note",
    text: "  Fictional follow-up  ",
  });
  state = demoReducer(state, { type: "false-alarm" });
  assert.deepEqual(state.incident?.notes, ["Fictional follow-up"]);
  assert.equal(state.incident?.falseAlarm, true);
  state = demoReducer(state, { type: "reset", scenario: "attention" });
  assert.deepEqual(state, createDemo());
});
