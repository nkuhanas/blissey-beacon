import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import {
  configuration,
  check,
  SmokeError,
  runPath,
  load,
  save,
  locked,
  redact,
} from "./lib/config.mjs";
import {
  jsonRequest,
  operatorClient,
  railway,
  checkAgent,
} from "./lib/services.mjs";
import { SmokeRun, managedDispatch, deployDispatch } from "./lib/smoke.mjs";

const help = `Usage: sh scripts/demo.sh <command> [options]
  doctor [--run NAME]             Read-only health/auth/Realtime; optionally compare saved policy with live agent
  smoke [--run NAME]              Synthetic WSS -> dedup -> REST -> Gemini -> Realtime -> call review
  smoke --call [--manage-dispatch] Same path, then interactive review, ONE call and callback monitoring
  call --run NAME --approve HASH  Approve a previously displayed frozen review; no automatic redials
  status --run NAME               Read-only incident and call status
  dispatch status|on|off          Read/change Railway's service-wide call flag (deployment required)
  dispatch restore --run NAME     Restore a journaled flag after interruption

Options: --env FILE (default .env.deploy.local), --run NAME, --call,
  --manage-dispatch (dedicated demo backend only), --approve FULL_CONTEXT_HASH,
  --allow-fallback (label deterministic explanation), --require-spoken (strict acceptance),
  --timeout SECONDS (call/callback wait, default 360), --help
Run journals/locks: .smoke/ (private, Git-ignored). See scripts/README.md.
This CLI never provisions contacts, applies migrations or implements clinical fall detection.`;

let config;
const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => stop.abort());
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      env: { type: "string", default: ".env.deploy.local" },
      run: { type: "string" },
      call: { type: "boolean" },
      "manage-dispatch": { type: "boolean" },
      approve: { type: "string" },
      "allow-fallback": { type: "boolean" },
      "require-spoken": { type: "boolean" },
      timeout: { type: "string", default: "360" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || !positionals.length) {
    console.log(help);
  } else {
    const [command, action] = positionals;
    check(
      ["doctor", "smoke", "call", "status", "dispatch"].includes(command),
      "Unknown command. Use --help.",
    );
    check(
      positionals.length === (command === "dispatch" ? 2 : 1),
      "Unexpected command arguments.",
    );
    check(
      !values.call || command === "smoke",
      "--call is only valid with smoke.",
    );
    check(
      !values.approve || command === "call",
      "--approve is only valid with call --run.",
    );
    check(
      !values["manage-dispatch"] || command === "call" || values.call,
      "--manage-dispatch requires a call action.",
    );
    const timeout = Number(values.timeout) * 1000;
    check(
      Number.isFinite(timeout) && timeout >= 1000 && timeout <= 900000,
      "--timeout must be 1–900 seconds.",
    );
    config = await configuration(values.env);
    const log = (value) =>
      console.log(
        redact(
          typeof value === "string" ? value : JSON.stringify(value, null, 2),
          config.env,
        ),
      );
    const client = operatorClient(config);
    const callOptions = { timeout, requireSpoken: values["require-spoken"] };
    if (command === "dispatch") {
      check(
        ["status", "on", "off", "restore"].includes(action),
        "Use dispatch status|on|off|restore.",
      );
      const control = railway(config);
      if (action === "status") log(await control.status());
      else
        await locked(".smoke/dispatch", async () => {
          if (action === "restore") {
            const file = runPath(values.run);
            await locked(file, async () => {
              const state = await load(file);
              check(
                state?.version === 1 &&
                  state?.target === config.target &&
                  state.dispatch_restore_pending === true &&
                  typeof state.dispatch_previous === "boolean",
                "No restoration journal for this environment/run.",
              );
              await deployDispatch(control, state.dispatch_previous, {
                signal: stop.signal,
              });
              state.dispatch_restore_pending = false;
              await save(file, state);
            });
          } else
            await deployDispatch(control, action === "on", {
              signal: stop.signal,
            });
          log(
            "Railway dispatch configuration deployment verified. This is service-wide, not run-scoped.",
          );
        });
    } else {
      await client.login();
      if (command === "doctor") {
        const journal = values.run ? await load(runPath(values.run)) : null;
        check(
          !values.run || (journal?.target === config.target && journal.preview),
          "No reviewed journal for this environment/run.",
        );
        await jsonRequest(config.api + "/healthz");
        const { rooms } = await client.api(
          "/api/operator/rooms?facility_id=" +
            encodeURIComponent(config.facility),
        );
        check(
          Array.isArray(rooms) && rooms.length,
          "No rooms authorized for this facility.",
        );
        const close = await client.subscribe(
          "doctor_" + randomUUID(),
          () => {},
        );
        await close();
        log({
          api: config.api,
          facility: config.facility,
          authorized_rooms: rooms.map((r) => r.id),
          realtime_subscription: "ready",
          device_credential_present: Boolean(config.env.DEVICE_TOKEN),
          agent: await checkAgent(config, journal?.preview),
        });
        if (config.env.RAILWAY_TOKEN)
          log({ railway: await railway(config).status() });
        log(
          "Read-only checks passed; no incident, notification, or phone call created. Health is not ingestion/provider proof.",
        );
      } else {
        check(command === "smoke" || values.run, "Use --run with call/status.");
        const name = values.run || "demo-" + randomUUID();
        const file = runPath(name);
        log("Run: " + name);
        if (command === "status") {
          const state = await load(file);
          check(
            state?.version === 1 &&
              state.target === config.target &&
              state.incidentId,
            "No incident journal for this environment/run.",
          );
          log(
            await client.api(
              "/api/operator/incidents/" +
                state.incidentId +
                "?include_explanation=true",
            ),
          );
          log(
            await client.api(
              "/api/operator/incidents/" + state.incidentId + "/notifications",
            ),
          );
          if (state.dispatch_restore_pending)
            log(
              "Dispatch restoration pending: use dispatch restore --run " +
                name,
            );
        } else
          await locked(file, async () => {
            const { syntheticEvent, sendSyntheticEvent } =
              await import("../tools/simulator/dist/client.js");
            let state = await load(file);
            if (!state) {
              check(command === "smoke", "Prepare this run with smoke first.");
              const event = await syntheticEvent(
                "synthetic_smoke_" + randomUUID(),
              );
              event.detected_at = new Date().toISOString();
              event.device_id = config.env.DEVICE_ID || event.device_id;
              event.room_id = config.env.SMOKE_ROOM_ID || event.room_id;
              state = {
                version: 1,
                target: config.target,
                event,
                created_at: new Date().toISOString(),
              };
              await save(file, state); // Stable ID/payload survives a lost WSS ACK.
            }
            const persist = () => save(file, state);
            const run = new SmokeRun({
              state,
              config,
              client,
              sendEvent: sendSyntheticEvent,
              persist,
              log,
              signal: stop.signal,
            });
            const close = await client.subscribe(
              state.event.event_id,
              (payload) => {
                state.realtime_observed = {
                  at: new Date().toISOString(),
                  event: payload.eventType,
                  revision: payload.new.revision,
                };
              },
            );
            try {
              if (state.incidentId && (await run.history())) {
                await run.monitor(callOptions);
                return;
              }
              check(
                !state.authorization,
                "Previous authorization outcome is uncertain. Use status; never start another run as a retry.",
              );
              let preview =
                command === "smoke"
                  ? await run.prepare({
                      allowFallback: values["allow-fallback"],
                    })
                  : await run.preview();
              check(
                state.prepared,
                "Complete the incident smoke before authorizing a call.",
              );
              const showReview = () =>
                log({
                  api: config.api,
                  facility: config.facility,
                  incident: state.incidentId,
                  synthetic: true,
                  recipient: {
                    name: preview.recipient.name,
                    phone: "***" + preview.recipient.phone_e164.slice(-4),
                  },
                  context: preview.context,
                  opening: preview.opening,
                  policy: preview.policy,
                  policy_version: preview.policy_version,
                  context_hash: preview.context_hash,
                  dispatch_enabled: preview.dispatch_enabled,
                });
              showReview();
              let approved = values.approve;
              if (values.call) {
                check(
                  process.stdin.isTTY && process.stdout.isTTY,
                  "Interactive call review needs a terminal. Otherwise prepare, review the output, then use call --run NAME --approve HASH.",
                );
                if (values["manage-dispatch"])
                  log(
                    "This will temporarily enable ALL already-authorized queued work on the selected Railway service. Use only the dedicated demo backend.",
                  );
                const phrase = "CALL " + preview.context_hash.slice(0, 12);
                const prompt = createInterface({
                  input: process.stdin,
                  output: process.stdout,
                });
                try {
                  check(
                    (await prompt.question(
                      `Approve the recipient, frozen facts, opening and policy? Type ${phrase}: `,
                      { signal: stop.signal },
                    )) === phrase,
                    "Call not authorized; no call submitted.",
                  );
                } finally {
                  prompt.close();
                }
                approved = preview.context_hash;
              }
              if (command === "smoke" && !values.call) {
                log(
                  `Prepared only; NO CALL. To authorize this reviewed context:\nsh scripts/demo.sh call --run ${name} --approve ${preview.context_hash} --manage-dispatch`,
                );
                return;
              }
              check(
                approved === preview.context_hash,
                "Supply the complete hash from the reviewed preview; no call submitted.",
              );
              if (values["manage-dispatch"])
                log(
                  "Managing the selected Railway service-wide call flag; already-approved queued work on that service may also dispatch.",
                );
              const agent = await checkAgent(config, preview);
              log(
                agent.checked
                  ? { agent }
                  : "Provider setup readback skipped (no ElevenLabs admin key); backend remains responsible for dispatch validation.",
              );
              const call = async () => {
                // The deployment may take time. A changed hash still requires fresh review.
                if (values["manage-dispatch"]) {
                  const { until } = await import("./lib/smoke.mjs");
                  preview = await until(
                    async () => {
                      const p = await run.preview();
                      return p.dispatch_enabled && p;
                    },
                    { signal: stop.signal, timeout: 180000 },
                  );
                }
                log(
                  "Submitting ONE call authorization. A lost response will not be retried.",
                );
                await run.authorize(approved);
                await run.monitor(callOptions);
              };
              if (values["manage-dispatch"])
                await locked(".smoke/dispatch", () =>
                  managedDispatch({
                    state,
                    persist,
                    control: railway(config),
                    work: call,
                    log,
                    waitOptions: { signal: stop.signal },
                  }),
                );
              else await call();
            } finally {
              await persist();
              await close();
            }
          });
      }
    }
  }
} catch (error) {
  const message = stop.signal.aborted
    ? "Interrupted. A submitted call may still be active. Use status; do not redial."
    : error instanceof SmokeError
      ? error.message
      : "Unexpected script failure; journal retained. Check status before retrying a call.";
  console.error(redact(message, config?.env || {}));
  process.exitCode = 1;
}
