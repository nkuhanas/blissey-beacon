import { readFile } from "node:fs/promises";
import { parseArgs, parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { endpoint, check, redact } from "./lib/config.mjs";
import { publishIncident101 } from "./lib/incident.mjs";

let env = {};
let key;
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      env: { type: "string", default: ".env.deploy.local" },
      key: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  check(positionals.length === 0, "Unexpected arguments; use --help.");
  if (values.help) {
    console.log(`Usage: sh scripts/incident101.sh [--env FILE] [--key UUID]
Publish one synthetic possible-fall incident to room 101, then exit after persistence.
Default env: .env.deploy.local. Each invocation creates a new incident.
To safely retry a failed/uncertain request, reuse the displayed --key UUID.
No build/install, Gemini wait, Pi credential/health changes, calls or texts.
Short-lived operator access tokens and retry journals stay private under .smoke/.`);
  } else {
    key = values.key ?? randomUUID();
    console.error("Incident request key: " + key);
    env = { ...parseEnv(await readFile(values.env, "utf8")), ...process.env };
    env.SUPABASE_PUBLISHABLE_KEY ||= env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const config = {
      env,
      api: endpoint(env.SMOKE_API_URL || env.VITE_API_URL),
      supabase: endpoint(env.SUPABASE_URL || env.VITE_SUPABASE_URL),
      facility:
        env.SMOKE_FACILITY_ID || env.VITE_FACILITY_ID || "demo_facility",
    };
    const result = await publishIncident101(config, key);
    console.log(JSON.stringify(result));
  }
} catch (error) {
  console.error(redact(error.message, env));
  if (key)
    console.error("Retry this intent: sh scripts/incident101.sh --key " + key);
  process.exitCode = 1;
}
