import { readFile, mkdir, open, rename, unlink } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";

export class SmokeError extends Error {}
export function check(ok, message) {
  if (!ok) throw new SmokeError(message);
}
export function endpoint(value, websocket = false) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SmokeError("Invalid service URL.");
  }
  const local = ["localhost", "127.0.0.1", "backend"].includes(url.hostname);
  check(
    !url.username && !url.password && !url.search && !url.hash,
    "Service URLs must not contain credentials, query strings or fragments.",
  );
  check(
    url.protocol === (websocket ? "wss:" : "https:") ||
      (local && url.protocol === (websocket ? "ws:" : "http:")),
    "Remote services require HTTPS/WSS; TLS verification is never disabled.",
  );
  check(
    websocket || url.pathname === "/",
    "Use a service origin without a path.",
  );
  return url.toString().replace(/\/$/, "");
}
export async function configuration(file, overrides = process.env) {
  let contents;
  try {
    contents = await readFile(file, "utf8");
  } catch {
    throw new SmokeError(`Cannot read ${file}; see scripts/README.md.`);
  }
  const env = { ...parseEnv(contents), ...overrides };
  env.SUPABASE_PUBLISHABLE_KEY ||= env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const api = endpoint(env.SMOKE_API_URL || env.VITE_API_URL);
  const supabase = endpoint(env.SUPABASE_URL || env.VITE_SUPABASE_URL);
  const ws = endpoint(
    env.DEVICE_WS_URL || api.replace(/^http/, "ws") + "/api/devices/v1/stream",
    true,
  );
  check(
    new URL(ws).origin.replace(/^ws/, "http") === new URL(api).origin,
    "Device WSS and operator API must target the same service.",
  );
  const facility =
    env.SMOKE_FACILITY_ID || env.VITE_FACILITY_ID || "demo_facility";
  check(/^[-\w]{1,128}$/.test(facility), "Invalid smoke facility ID.");
  const target = createHash("sha256")
    .update(JSON.stringify([api, supabase, facility, ws]))
    .digest("hex");
  return { env, api, supabase, ws, facility, target };
}
export function required(env, key) {
  check(typeof env[key] === "string" && env[key].length > 0, `Missing ${key}.`);
  return env[key];
}
export function runPath(name, directory = ".smoke") {
  check(
    typeof name === "string" && /^[-a-zA-Z0-9_]{1,80}$/.test(name),
    "Run names must contain 1–80 letters, digits, underscores or hyphens.",
  );
  return resolve(directory, "runs", name + ".json");
}
export async function save(file, state) {
  const directory = resolve(file, "..");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = file + "." + randomUUID() + ".tmp";
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(state, null, 2) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
}
export async function load(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new SmokeError(
      "Run journal is unreadable; do not delete it and retry a call.",
    );
  }
}
export async function locked(file, work) {
  await mkdir(resolve(file, ".."), { recursive: true, mode: 0o700 });
  let lock;
  try {
    lock = await open(file + ".lock", "wx", 0o600);
  } catch {
    throw new SmokeError(
      "Run/dispatch lock exists. Check status and running processes before removing a stale lock.",
    );
  }
  try {
    await lock.writeFile(
      JSON.stringify({
        pid: process.pid,
        started_at: new Date().toISOString(),
      }),
    );
    return await work();
  } finally {
    await lock.close();
    await unlink(file + ".lock");
  }
}
export function redact(message, env) {
  let text = String(message);
  for (const [key, value] of Object.entries(env))
    if (/KEY|TOKEN|PASSWORD|SECRET|DATABASE_URL|PHONE|EMAIL/.test(key) && value)
      text = text.split(value).join("[redacted]");
  return text;
}
