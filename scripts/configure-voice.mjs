import { required } from "./lib/config.mjs";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { voiceSettings } from "./lib/voice-settings.mjs";
import {
  POLICY,
  POLICY_VERSION,
  END_CALL_DESCRIPTION,
} from "../apps/backend/dist/notifications/policy.js";
const apply = process.argv.slice(2).includes("--apply");
if (process.argv.slice(2).some((x) => x !== "--apply"))
  throw Error("Usage: node scripts/configure-voice.mjs [--apply]");
const env = {
  ...parseEnv(await readFile(".env.deploy.local", "utf8")),
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      key.startsWith("ELEVENLABS_"),
    ),
  ),
};
const url =
  "https://api.elevenlabs.io/v1/convai/agents/" +
  encodeURIComponent(required(env, "ELEVENLABS_AGENT_ID"));
const headers = {
  "xi-api-key": required(env, "ELEVENLABS_API_KEY"),
  "Content-Type": "application/json",
};
async function request(method, body) {
  const r = await fetch(url, {
    method,
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) {
    await r.body?.cancel();
    throw Error("ElevenLabs agent request failed: HTTP " + r.status);
  }
  return r.json();
}
const current = await request("GET");
const patch = voiceSettings(current, POLICY, END_CALL_DESCRIPTION);
if (apply) await request("PATCH", patch);
const verified = apply ? await request("GET") : current;
if (
  apply &&
  verified.conversation_config.agent.prompt.prompt !==
    patch.conversation_config.agent.prompt.prompt
)
  throw Error("Agent policy readback did not match");
if (
  apply &&
  verified.conversation_config.turn.merge_with_default_ignore_terms !== true
)
  throw Error("Agent interruption readback did not match");
console.log(
  JSON.stringify({
    applied: apply,
    policyVersion: POLICY_VERSION,
    backchannelFiltering:
      verified.conversation_config?.turn?.merge_with_default_ignore_terms ===
      true,
    automaticOutcomeFields: [
      "recipient_verified",
      "incident_communicated",
      "call_outcome",
    ].every((x) => verified.platform_settings?.data_collection?.[x]),
    callPlaced: false,
  }),
);
