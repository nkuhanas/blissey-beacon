import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  createElevenLabsSubmit,
  verifyProviderEvent,
} from "../src/notifications/provider.js";
import { familyContext, POLICY, digest } from "../src/notifications/policy.js";
import { loadConfig } from "../src/config.js";
const context = familyContext(
  {
    id: "11111111-1111-4111-8111-111111111111",
    label: "Room 102",
    detected_at: new Date("2026-10-17T21:32:06Z"),
    source: "gemini",
  },
  "Demo recipient",
);
const input = {
  callId: "11111111-1111-4111-8111-111111111111",
  attemptId: "22222222-2222-4222-8222-222222222222",
  destination: "+15555550123",
  context,
  opening: "Hello, this is an automated demo. May I speak to Demo recipient?",
  policyVersion: "family-call-v2",
};
export function sign(
  raw: string,
  secret = "synthetic-webhook-secret",
  timestamp = Math.floor(Date.now() / 1000),
) {
  return `t=${timestamp},v0=${createHmac("sha256", secret)
    .update(timestamp + "." + raw)
    .digest("hex")}`;
}
test("family projection is neutral, score-free and deterministically hashed; provider receives only approved context", async () => {
  assert.equal(context.event_type, "inference_result");
  assert.equal(context.resident_condition, "unknown");
  assert.ok(!JSON.stringify(context).includes("confidence"));
  assert.ok(!context.family_summary.includes("possible fall"));
  assert.ok(POLICY.includes("No tools"));
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
  const submit = createElevenLabsSubmit({
    apiKey: "synthetic-key",
    agentId: "synthetic-agent",
    phoneNumberId: "synthetic-phone",
    fetcher: async (url, init) => {
      assert.equal(
        url,
        "https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call",
      );
      const body = JSON.parse(init!.body as string);
      assert.equal(body.to_number, input.destination);
      assert.equal(body.agent_id, "synthetic-agent");
      assert.equal(body.agent_phone_number_id, "synthetic-phone");
      assert.ok(!JSON.stringify(body).includes("synthetic-key"));
      assert.deepEqual(
        JSON.parse(
          body.conversation_initiation_client_data.dynamic_variables
            .family_context,
        ),
        context,
      );
      return Response.json({
        success: true,
        conversation_id: "synthetic-conversation",
        sip_call_id: "synthetic-sip",
      });
    },
  });
  assert.deepEqual(await submit(input, new AbortController().signal), {
    state: "accepted",
    conversationId: "synthetic-conversation",
    sipCallId: "synthetic-sip",
  });
});
test("ambiguous external outcomes never become retryable automatic redials", async () => {
  for (const [response, state] of [
    [new Response("private provider body", { status: 503 }), "unknown"],
    [new Response("denied", { status: 401 }), "failed"],
    [Response.json({ success: false }), "unknown"],
    [new Response("invalid JSON"), "unknown"],
    [new Response("x".repeat(16385)), "unknown"],
  ] as const) {
    const s = createElevenLabsSubmit({
      apiKey: "synthetic",
      agentId: "a",
      phoneNumberId: "p",
      fetcher: async () => response,
    });
    assert.equal((await s(input, new AbortController().signal)).state, state);
  }
  const s = createElevenLabsSubmit({
    apiKey: "synthetic",
    agentId: "a",
    phoneNumberId: "p",
    fetcher: async () => {
      throw Error("request may have been accepted");
    },
  });
  assert.equal((await s(input, new AbortController().signal)).state, "unknown");
});
test("webhooks verify exact bytes, timestamp and agent; transcript/analysis never proves spoken success", () => {
  const body = JSON.stringify({
    type: "post_call_transcription",
    data: {
      agent_id: "synthetic-agent",
      conversation_id: "synthetic-conversation",
      transcript: [{ role: "agent", message: "Private text" }],
      analysis: {
        call_successful: "success",
        data_collection_results: { callback_requested: { value: true } },
      },
    },
  });
  const event = verifyProviderEvent(
    Buffer.from(body),
    sign(body),
    "synthetic-webhook-secret",
    "synthetic-agent",
  );
  assert.equal(event.kind, "completed");
  assert.equal(event.callbackRequested, true);
  assert.ok(!("connected" in event));
  assert.ok(!("notificationSpoken" in event));
  assert.ok(!JSON.stringify(event).includes("Private text"));
  for (const [raw, sig, agent] of [
    [body + " ", sign(body), "synthetic-agent"],
    [body, sign(body, "wrong"), "synthetic-agent"],
    [
      body,
      sign(
        body,
        "synthetic-webhook-secret",
        Math.floor(Date.now() / 1000) - 1801,
      ),
      "synthetic-agent",
    ],
    [
      body,
      sign(
        body,
        "synthetic-webhook-secret",
        Math.floor(Date.now() / 1000) + 1801,
      ),
      "synthetic-agent",
    ],
    [body, sign(body), "wrong-agent"],
  ] as const)
    assert.throws(() =>
      verifyProviderEvent(
        Buffer.from(raw),
        sig,
        "synthetic-webhook-secret",
        agent,
      ),
    );
});
test("calls stay explicitly disabled until complete provider configuration is present", () => {
  const env = {
    DATABASE_URL: "postgresql://synthetic",
    SUPABASE_URL: "https://synthetic.supabase.test",
    WEB_ORIGIN: "http://localhost:5173",
  };
  assert.equal(loadConfig(env).callsEnabled, false);
  assert.throws(
    () => loadConfig({ ...env, NOTIFICATION_CALLS_ENABLED: "true" }),
    /Calling requires/,
  );
});
