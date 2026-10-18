import test from "node:test";
import assert from "node:assert/strict";
import {
  factsFor,
  wording,
  grounded,
  fallback,
} from "../src/explanations/content.js";
import {
  createGeminiGenerator,
  GenerationError,
} from "../src/explanations/gemini.js";
import { loadConfig } from "../src/config.js";
const facts = factsFor(
  {
    event_id: "synthetic_unit",
    device_id: "pi_102",
    room_id: "room_102",
    event_type: "inference_result",
    detected_at: "2026-10-17T14:32:06-07:00",
    confidence_scores: { fall: 0.91, non_fall: 0.09 },
    sensor_status: "connected",
  },
  "synthetic_unit",
  "Room 102",
)!;
const choices = wording(facts);
const output = {
  event_id: facts.event_id,
  title: choices.title[0]!,
  description: choices.description[0]!,
  recommended_action: choices.recommended_action[0]!,
};
function response(value: unknown, finishReason = "STOP") {
  return Response.json({
    candidates: [
      { finishReason, content: { parts: [{ text: JSON.stringify(value) }] } },
    ],
    modelVersion: "synthetic-model-v1",
  });
}
test("Gemini receives minimal persisted facts and a constrained canonical schema; secrets never enter prompt", async () => {
  const generate = createGeminiGenerator({
    apiKey: "synthetic-secret-key",
    model: "synthetic-model",
    fetcher: async (url, init) => {
      assert.equal(
        url,
        "https://generativelanguage.googleapis.com/v1beta/models/synthetic-model:generateContent",
      );
      const body = JSON.parse(init!.body as string);
      assert.equal(
        (init!.headers as Record<string, string>)["x-goog-api-key"],
        "synthetic-secret-key",
      );
      assert.ok(!JSON.stringify(body).includes("synthetic-secret-key"));
      const input = JSON.parse(body.contents[0].parts[0].text);
      assert.deepEqual(input, facts);
      assert.ok(!("device_id" in input));
      assert.ok(!("patient" in input));
      assert.deepEqual(
        body.generationConfig.responseJsonSchema.properties.event_id.enum,
        [facts.event_id],
      );
      return response(output);
    },
  });
  assert.deepEqual(await generate(facts, new AbortController().signal), {
    output,
    model: "synthetic-model-v1",
  });
});
test("identity, schema, factual wording and incomplete/oversized provider output are rejected", async () => {
  for (const value of [
    { ...output, event_id: "wrong" },
    { ...output, title: "Confirmed fall" },
    {
      ...output,
      description: "The resident fell next to the bed and was injured.",
    },
    { ...output, recommended_action: "Staff called emergency services." },
    { ...output, extra: "invented" },
    { ...output, title: "x".repeat(121) },
  ]) {
    assert.equal(grounded(value, facts), false);
    const g = createGeminiGenerator({
      apiKey: "synthetic",
      model: "synthetic-model",
      fetcher: async () => response(value),
    });
    await assert.rejects(
      g(facts, new AbortController().signal),
      (e) => e instanceof GenerationError && !e.retryable,
    );
  }
  for (const r of [
    new Response("not JSON"),
    response(output, "MAX_TOKENS"),
    new Response("x".repeat(65537)),
  ]) {
    const g = createGeminiGenerator({
      apiKey: "synthetic",
      model: "synthetic-model",
      fetcher: async () => r,
    });
    await assert.rejects(
      g(facts, new AbortController().signal),
      GenerationError,
    );
  }
});
test("transient provider errors retry, credential errors terminate, timeouts abort and errors redact provider bodies", async () => {
  for (const [status, retryable] of [
    [429, true],
    [503, true],
    [401, false],
  ] as const) {
    const g = createGeminiGenerator({
      apiKey: "secret-must-not-leak",
      model: "synthetic-model",
      fetcher: async () => new Response("secret-must-not-leak", { status }),
    });
    await assert.rejects(
      g(facts, new AbortController().signal),
      (e) =>
        e instanceof GenerationError &&
        e.retryable === retryable &&
        !e.message.includes("secret-must-not-leak"),
    );
  }
  const g = createGeminiGenerator({
    apiKey: "synthetic",
    model: "synthetic-model",
    timeoutMs: 5,
    fetcher: async (_url, init) =>
      new Promise((_resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Timeout did not abort")),
          1000,
        );
        init!.signal!.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
      }),
  });
  await assert.rejects(
    g(facts, new AbortController().signal),
    (e) => e instanceof GenerationError && e.code === "timeout" && e.retryable,
  );
  assert.equal(fallback(facts.event_id).event_id, facts.event_id);
});
test("worker is explicitly disabled without a key and a configured key requires an explicit model", () => {
  const env = {
    DATABASE_URL: "postgresql://synthetic",
    SUPABASE_URL: "https://synthetic.supabase.test",
    WEB_ORIGIN: "https://blissey-beacon.health",
  };
  assert.equal(loadConfig(env).gemini, null);
  assert.throws(
    () => loadConfig({ ...env, GEMINI_API_KEY: "synthetic" }),
    /GEMINI_MODEL/,
  );
  assert.equal(
    loadConfig({
      ...env,
      GEMINI_API_KEY: "synthetic",
      GEMINI_MODEL: "synthetic-model",
    }).gemini?.model,
    "synthetic-model",
  );
});
