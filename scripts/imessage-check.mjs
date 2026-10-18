// Resolves the existing sender/recipient assignment and onboarding. Never sends a message.
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { check, redact } from "./lib/config.mjs";
import { createPhotonProvider } from "../apps/backend/dist/messages/photon.js";
let env = {};
try {
  check(
    process.argv.length <= 3,
    "Usage: sh scripts/imessage-check.sh [ENV_FILE]",
  );
  env = {
    ...parseEnv(await readFile(process.argv[2] ?? ".env.deploy.local", "utf8")),
    ...process.env,
  };
  for (const key of [
    "PHOTON_PROJECT_ID",
    "PHOTON_API_KEY",
    "PHOTON_IMESSAGE_SENDER_NUMBER",
    "DEMO_FAMILY_PHONE_E164",
  ])
    check(env[key], `Missing ${key}.`);
  const provider = createPhotonProvider({
    projectId: env.PHOTON_PROJECT_ID,
    apiKey: env.PHOTON_API_KEY,
    senderNumber: env.PHOTON_IMESSAGE_SENDER_NUMBER,
  });
  const route = await provider.resolve(
    env.DEMO_FAMILY_PHONE_E164,
    AbortSignal.timeout(60000),
  );
  console.log(
    JSON.stringify({
      sender_assignment_verified: true,
      shared_line: route.assignment_id !== null,
      onboarding_verified: route.assignment_id !== null,
      outbound_messages_sent: 0,
    }),
  );
} catch (error) {
  console.error(
    redact(error.code ?? error.message ?? "iMessage check failed.", env),
  );
  process.exitCode = 1;
}
