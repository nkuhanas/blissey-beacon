import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  validateIncident,
  validateCallPreview,
  validateIncidentWorkflow,
  validateNotificationCall,
  validateFamilyContact,
  validateCallAuthorization,
} from "../../packages/contracts/dist/src/index.js";
import { check, SmokeError } from "./config.mjs";

export async function until(
  work,
  {
    timeout = 120000,
    interval = 2000,
    signal,
    message = "Operation timed out.",
  } = {},
) {
  const end = Date.now() + timeout;
  do {
    signal?.throwIfAborted();
    const result = await work();
    if (result) return result;
    if (Date.now() >= end) break;
    await sleep(Math.min(interval, Math.max(1, end - Date.now())), undefined, {
      signal,
    });
  } while (Date.now() <= end);
  throw new SmokeError(message);
}
export class SmokeRun {
  constructor({
    state,
    config,
    client,
    sendEvent,
    persist,
    log = console.log,
    signal,
    interval = 2000,
  }) {
    Object.assign(this, {
      state,
      config,
      client,
      sendEvent,
      persist,
      log,
      signal,
      interval,
    });
    check(
      state.version === 1 &&
        state.target === config.target &&
        state.event?.event_id?.startsWith("synthetic_smoke_"),
      "Run belongs to a different environment or is not a synthetic smoke journal.",
    );
  }
  path(suffix = "") {
    return "/api/operator/incidents/" + this.state.incidentId + suffix;
  }
  async detail() {
    const { incident } = await this.client.api(
      this.path("?include_explanation=true"),
    );
    check(
      validateIncident(incident) &&
        incident.id === this.state.incidentId &&
        incident.event_id === this.state.event.event_id &&
        incident.room_id === this.state.event.room_id &&
        incident.device_id === this.state.event.device_id &&
        incident.facility_id === this.config.facility,
      "Operator incident response does not match this run/contract/facility.",
    );
    return incident;
  }
  async workflow() {
    const workflow = await this.client.api(this.path("/workflow"));
    check(
      validateIncidentWorkflow(workflow) &&
        workflow.incident_id === this.state.incidentId,
      "Invalid incident workflow response.",
    );
    return workflow;
  }
  async history() {
    const { calls } = await this.client.api(this.path("/notifications"));
    check(
      Array.isArray(calls) &&
        calls.every(
          (c) =>
            validateNotificationCall(c) &&
            c.incident_id === this.state.incidentId,
        ),
      "Invalid call history response.",
    );
    check(
      calls.length <= 1,
      "More than one call exists; inspect manually, no new authorization.",
    );
    if (calls.length) {
      check(
        !this.state.callId || calls[0].id === this.state.callId,
        "Call identity changed; inspect manually.",
      );
      this.state.callId = calls[0].id;
      this.state.call = calls[0];
      this.state.authorization = "recorded";
      await this.persist();
    }
    return calls[0];
  }
  async prepare({ allowFallback = false } = {}) {
    check(
      !this.state.callId && !this.state.authorization,
      "This run already has a call/authorization intent. Use status; no automatic retry.",
    );
    check(this.config.env.DEVICE_TOKEN, "Missing DEVICE_TOKEN.");
    const ack = await this.sendEvent({
      url: this.config.ws,
      token: this.config.env.DEVICE_TOKEN,
      event: this.state.event,
    });
    check(
      !this.state.incidentId || this.state.incidentId === ack.incident_id,
      "Durable incident identity changed.",
    );
    this.state.incidentId = ack.incident_id;
    await this.persist();
    const duplicate = await this.sendEvent({
      url: this.config.ws,
      token: this.config.env.DEVICE_TOKEN,
      event: this.state.event,
    });
    check(
      duplicate.status === "duplicate" &&
        duplicate.incident_id === ack.incident_id,
      "Duplicate delivery did not return the same durable incident.",
    );
    this.state.deduplication_verified = true;
    this.log("Durable incident + duplicate ACK verified: " + ack.incident_id);
    const incident = await until(
      async () => {
        const i = await this.detail();
        return i.explanation_status !== "pending" && i;
      },
      {
        signal: this.signal,
        interval: this.interval,
        message:
          "Explanation still pending. Run journal saved; do not create another call.",
      },
    );
    check(
      incident.explanation &&
        (incident.explanation_status === "ready" || allowFallback),
      "Explanation fell back; use --allow-fallback only for an intentionally labeled fallback smoke.",
    );
    this.state.explanation_status = incident.explanation_status;
    if (incident.status === "pending") {
      await this.client.api(this.path(), {
        method: "PATCH",
        key: this.state.event.event_id + ":ack",
        body: {
          expected_revision: incident.revision,
          status: "acknowledged",
          note: "Synthetic smoke incident; operator action simulated by the demo script. No physical fall or staff assessment.",
        },
      });
    }
    await until(() => this.state.realtime_observed, {
      signal: this.signal,
      interval: this.interval,
      timeout: 20000,
      message:
        "No incident change observed through Realtime. Journal saved; REST alone is not Realtime evidence.",
    });
    this.state.prepared = true;
    this.log(
      "Realtime incident change observed; explanation: " +
        incident.explanation_status,
    );
    await this.persist();
    return this.preview();
  }
  async preview() {
    const workflow = await this.workflow();
    check(
      workflow.patient_id && workflow.status !== "resolved",
      "Smoke needs an active incident with one historical patient assignment.",
    );
    const { contacts } = await this.client.api(
      "/api/operator/family-contacts?facility_id=" +
        encodeURIComponent(this.config.facility) +
        "&patient_id=" +
        encodeURIComponent(workflow.patient_id),
    );
    check(
      Array.isArray(contacts) &&
        contacts.length === 1 &&
        validateFamilyContact(contacts[0]),
      "Configure one saved primary family contact first.",
    );
    const contact = contacts[0];
    check(
      contact.facility_id === this.config.facility &&
        contact.patient_id === workflow.patient_id &&
        contact.consent_status === "granted",
      "Saved contact is not consented/associated with this incident.",
    );
    check(
      this.config.env.DEMO_FAMILY_PHONE_E164 &&
        contact.phone_e164 === this.config.env.DEMO_FAMILY_PHONE_E164,
      "Saved consented contact differs from DEMO_FAMILY_PHONE_E164 (or that allowlist value is missing). No arbitrary dispatch destination.",
    );
    const preview = await this.client.api(this.path("/notifications/preview"), {
      method: "POST",
      body: { contact_id: contact.id, expected_revision: workflow.revision },
    });
    check(
      validateCallPreview(preview) &&
        preview.context.incident_id === this.state.incidentId &&
        preview.context.resident_name &&
        preview.recipient.id === contact.id &&
        preview.recipient.phone_e164 === contact.phone_e164,
      "Invalid call preview, missing resident identity, or changed recipient.",
    );
    this.state.preview = preview;
    if (this.state.with_imessage) {
      const message = await this.client.api(this.path("/messages/preview"), {
        method: "POST",
        body: {
          contact_id: contact.id,
          expected_revision: workflow.revision,
          purpose: "followup",
          ...(this.state.staff_dispatch_confirmed
            ? { staff_dispatch_confirmed: true }
            : {}),
        },
      });
      check(
        message.dispatch_enabled &&
          message.recipient?.id === contact.id &&
          message.recipient?.phone_e164 === contact.phone_e164 &&
          message.expected_revision === workflow.revision &&
          /^[a-f0-9]{64}$/.test(message.context_hash) &&
          typeof message.candidates?.missed === "string" &&
          message.candidates?.summary?.startsWith(
            "Blissey Beacon care notification: Thank you for speaking with us.",
          ) &&
          message.candidates.summary.includes(
            "Our care team has been dispatched",
          ) === Boolean(this.state.staff_dispatch_confirmed),
        "Invalid message review, recipient, dispatch or shared incident facts.",
      );
      this.state.message_preview = message;
      this.state.review_hash = createHash("sha256")
        .update(
          JSON.stringify({
            call: preview.context_hash,
            message: message.context_hash,
          }),
        )
        .digest("hex");
    } else this.state.review_hash = preview.context_hash;
    await this.persist();
    return preview;
  }
  async authorize(approvedHash) {
    const existing = await this.history();
    if (existing) {
      this.log("Existing call retained; no new call authorization.");
      return existing;
    }
    check(
      this.state.authorization !== "pending",
      "Previous authorization outcome is uncertain. Use status; no automatic resubmission or redial.",
    );
    const preview = await this.preview();
    check(
      preview.dispatch_enabled,
      "Dispatch is disabled. Use dispatch on or explicitly select --manage-dispatch on the dedicated demo service.",
    );
    check(
      approvedHash === this.state.review_hash,
      "Reviewed context changed. Review the new preview and approve its new hash.",
    );
    const body = {
      preview_id: preview.preview_id,
      context_hash: preview.context_hash,
      expected_revision: preview.expected_revision,
      explicit_authorization: true,
      ...(this.state.with_imessage
        ? {
            message_preview_id: this.state.message_preview.preview_id,
            message_context_hash: this.state.message_preview.context_hash,
            explicit_messaging_authorization: true,
          }
        : {}),
    };
    check(
      validateCallAuthorization(body),
      "Invalid call/message authorization review.",
    );
    // Persist intent BEFORE the POST. A lost response must not trigger another call.
    this.state.authorization = "pending";
    this.state.authorization_request = body;
    this.state.idempotency_key = this.state.event.event_id + ":call";
    await this.persist();
    const { call } = await this.client.api(this.path("/notifications"), {
      method: "POST",
      key: this.state.idempotency_key,
      body,
    });
    check(
      validateNotificationCall(call) &&
        call.incident_id === this.state.incidentId &&
        call.contact_id === preview.recipient.id,
      "Invalid authorization response; inspect status before retrying anything.",
    );
    this.state.callId = call.id;
    this.state.call = call;
    this.state.authorization = "recorded";
    await this.persist();
    return call;
  }
  async monitor({ timeout = 360000, requireSpoken = false } = {}) {
    let last;
    const call = await until(
      async () => {
        const current = await this.history();
        check(
          current,
          "Call not visible yet. Authorization may be uncertain; use status, not a new call.",
        );
        if (current.transport_status !== last) {
          this.log("Call: " + current.transport_status);
          last = current.transport_status;
        }
        return (
          ["completed", "failed", "unknown"].includes(
            current.transport_status,
          ) && current
        );
      },
      {
        signal: this.signal,
        interval: this.interval,
        timeout,
        message:
          "Call/callback still pending. It may still be active; use status. Do not redial.",
      },
    );
    check(
      call.transport_status === "completed",
      "Call ended as " +
        call.transport_status +
        "; inspect status, no automatic retry.",
    );
    this.log(
      call.notification_success
        ? "Provider-connected/spoken evidence verified."
        : "Session completed; connected/spoken delivery remains UNVERIFIED (completion is not playback proof).",
    );
    check(
      !requireSpoken || call.notification_success,
      "Strict spoken-delivery acceptance not met.",
    );
    return call;
  }
}

export async function deployDispatch(control, enabled, waitOptions = {}) {
  const before = await control.status();
  if (before.enabled === enabled && before.deployment === "SUCCESS")
    return before;
  await control.set(enabled);
  return until(
    async () => {
      const current = await control.status();
      check(
        !["FAILED", "CRASHED", "REMOVED"].includes(current.deployment),
        "Railway configuration deployment failed; inspect dispatch status.",
      );
      return (
        current.enabled === enabled &&
        current.deployment === "SUCCESS" &&
        current.deployment_id !== before.deployment_id &&
        current
      );
    },
    {
      timeout: 180000,
      ...waitOptions,
      message:
        "Railway configuration deployment timed out; inspect dispatch status.",
    },
  );
}

export async function managedDispatch({
  state,
  persist,
  control,
  work,
  log = console.log,
  waitOptions = {},
}) {
  check(
    !state.dispatch_restore_pending,
    "Previous dispatch restoration is unresolved. Use dispatch restore --run before another call.",
  );
  const before = await control.status();
  check(
    before.deployment === "SUCCESS",
    "Wait for the current Railway deployment to finish before managing dispatch.",
  );
  if (before.enabled) return work(); // Preserve an intentionally enabled service.
  state.dispatch_restore_pending = true;
  state.dispatch_previous = before.enabled;
  await persist();
  let enabledDeployment;
  try {
    await control.set(true);
    enabledDeployment = await until(
      async () => {
        const s = await control.status();
        check(
          !["FAILED", "CRASHED", "REMOVED"].includes(s.deployment),
          "Railway dispatch deployment failed.",
        );
        return (
          s.enabled &&
          s.deployment === "SUCCESS" &&
          s.deployment_id !== before.deployment_id &&
          s.deployment_id
        );
      },
      {
        timeout: 180000,
        ...waitOptions,
        message: "Railway dispatch deployment timed out.",
      },
    );
    return await work();
  } finally {
    // Cleanup is intentionally not tied to an aborted smoke signal.
    log(
      "Restoring Railway dispatch to disabled; submitted calls are not cancelled.",
    );
    await control.set(false);
    await until(
      async () => {
        const s = await control.status();
        check(
          !["FAILED", "CRASHED", "REMOVED"].includes(s.deployment),
          "Dispatch restoration deployment failed. Use dispatch restore --run after resolving deployment.",
        );
        return (
          !s.enabled &&
          s.deployment === "SUCCESS" &&
          (!enabledDeployment || s.deployment_id !== enabledDeployment)
        );
      },
      {
        timeout: 180000,
        interval: waitOptions.interval ?? 2000,
        message:
          "Dispatch restoration not verified. Use dispatch restore --run.",
      },
    );
    state.dispatch_restore_pending = false;
    await persist();
  }
}
