import test from "node:test";
import assert from "node:assert/strict";
import { voiceSettings } from "../lib/voice-settings.mjs";
test("voice patch filters backchannels without overriding voice, model, privacy or SIP settings", () => {
  const current = {
    conversation_config: {
      turn: { interruption_ignore_terms: ["um"] },
      agent: {
        prompt: { built_in_tools: { end_call: { description: "old" } } },
      },
    },
  };
  const patch = voiceSettings(current, "approved policy", "explicit closure");
  assert.equal(
    patch.conversation_config.agent.prompt.built_in_tools.end_call.description,
    "explicit closure",
  );
  assert.equal(
    patch.conversation_config.turn.merge_with_default_ignore_terms,
    true,
  );
  assert.equal(
    patch.conversation_config.turn.interruption_ignore_terms.filter(
      (x) => x === "um",
    ).length,
    1,
  );
  assert.ok(
    !patch.conversation_config.turn.interruption_ignore_terms.includes("yes"),
  );
  assert.equal(
    patch.conversation_config.turn.retranscribe_on_turn_timeout,
    true,
  );
  assert.ok(!("tts" in patch.conversation_config));
  assert.ok(!("privacy" in patch.platform_settings));
  assert.ok(!("webhooks" in patch.platform_settings));
  assert.ok(
    patch.platform_settings.data_collection.call_outcome.enum.includes(
      "unknown",
    ),
  );
});
