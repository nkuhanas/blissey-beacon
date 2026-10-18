import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { check, required, load, save, locked, SmokeError } from "./config.mjs";

// Explicit retries reuse the durable intent; fresh keys create fresh synthetic alerts.
export async function publishIncident101(
  config,
  key,
  { directory = ".smoke", fetcher = fetch, now = Date.now } = {},
) {
  check(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key),
    "--key must be a UUID.",
  );
  const target = createHash("sha256")
    .update(
      JSON.stringify([
        config.api,
        config.supabase,
        config.facility,
        required(config.env, "DEMO_OPERATOR_EMAIL"),
      ]),
    )
    .digest("hex");
  const journal = resolve(directory, "runs", "incident101-" + key + ".json");
  const cache = resolve(directory, "incident-auth-" + target + ".json");
  async function request(url, body, headers) {
    let response;
    try {
      response = await fetcher(url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    } catch {
      throw new SmokeError(
        "Request timed out or failed. No automatic incident retry.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { status: response.status };
    }
    let value;
    try {
      value = await response.json();
    } catch {
      throw new SmokeError(
        "Service returned invalid JSON; result may be saved remotely.",
      );
    }
    return { status: response.status, value };
  }
  async function login() {
    const result = await request(
      config.supabase + "/auth/v1/token?grant_type=password",
      {
        email: required(config.env, "DEMO_OPERATOR_EMAIL"),
        password: required(config.env, "DEMO_OPERATOR_PASSWORD"),
      },
      { apikey: required(config.env, "SUPABASE_PUBLISHABLE_KEY") },
    );
    check(
      typeof result.value?.access_token === "string",
      `Operator login failed (HTTP ${result.status}).`,
    );
    const auth = {
      target,
      token: result.value.access_token,
      expiresAt:
        now() +
        Math.max(0, Math.min(Number(result.value.expires_in) || 0, 3600) - 30) *
          1000,
    };
    // Access token only, never password/refresh token. Atomic mode-0600 file, ignored by Git.
    await save(cache, auth);
    return auth;
  }
  return locked(journal, async () => {
    let state = await load(journal);
    if (state)
      check(
        state.target === target,
        "This key belongs to another operator/target; use its original configuration.",
      );
    else {
      state = {
        target,
        key,
        input: {
          facility_id: config.facility,
          room_id: "101",
          scenario: "attention",
        },
      };
      await save(journal, state);
    }
    if (state.result) return state.result;
    let auth;
    try {
      auth = await load(cache);
    } catch {
      /* Corrupt cache can be replaced by a fresh login. */
    }
    if (
      auth?.target !== target ||
      typeof auth.token !== "string" ||
      !Number.isFinite(auth.expiresAt) ||
      auth.expiresAt <= now()
    )
      auth = await login();
    const post = () =>
      request(config.api + "/api/operator/demo/scenarios", state.input, {
        Authorization: "Bearer " + auth.token,
        "Idempotency-Key": key,
      });
    let response = await post();
    // A rejected JWT cannot commit a scenario; reauthenticate once with the same intent.
    if (response.status === 401) {
      auth = await login();
      response = await post();
    }
    check(
      response.value &&
        response.value.room_id === "101" &&
        response.value.scenario === "attention" &&
        typeof response.value.incident_id === "string" &&
        /^[0-9a-f-]{36}$/i.test(response.value.incident_id),
      `Incident not confirmed (HTTP ${response.status}); retry with the same --key.`,
    );
    state.result = { ...response.value, idempotency_key: key };
    await save(journal, state);
    return state.result;
  });
}
