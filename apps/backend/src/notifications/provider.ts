import { createHmac, timingSafeEqual } from "node:crypto";
import type { FamilyCallContext } from "@blissey/contracts";
import { CallError } from "./policy.js";
export interface Submission {
  callId: string;
  attemptId: string;
  destination: string;
  context: FamilyCallContext;
  opening: string;
  policyVersion: string;
}
export interface SubmissionResult {
  state: "accepted" | "failed" | "unknown";
  conversationId?: string;
  sipCallId?: string;
  code?: string;
}
export type SubmitCall = (
  input: Submission,
  signal: AbortSignal,
) => Promise<SubmissionResult>;
export function createElevenLabsSubmit(options: {
  apiKey: string;
  agentId: string;
  phoneNumberId: string;
  fetcher?: typeof fetch;
}): SubmitCall {
  return async (input, signal) => {
    try {
      const r = await (options.fetcher ?? fetch)(
        "https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": options.apiKey,
          },
          signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
          body: JSON.stringify({
            agent_id: options.agentId,
            agent_phone_number_id: options.phoneNumberId,
            to_number: input.destination,
            conversation_initiation_client_data: {
              dynamic_variables: {
                ...input.context,
                allowed_actions: JSON.stringify(input.context.allowed_actions),
                family_context: JSON.stringify(input.context),
                call_id: input.callId,
                attempt_id: input.attemptId,
                opening_message: input.opening,
                policy_version: input.policyVersion,
              },
            },
          }),
        },
      );
      if (!r.ok) {
        await r.body?.cancel();
        return {
          state: [400, 401, 403, 404, 422].includes(r.status)
            ? "failed"
            : "unknown",
          code: "provider_http_" + r.status,
        };
      }
      const reader = r.body?.getReader();
      if (!reader)
        return { state: "unknown", code: "invalid_provider_response" };
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 16384) {
          await reader.cancel();
          return { state: "unknown", code: "provider_response_too_large" };
        }
        chunks.push(part.value);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
      if (!body || typeof body !== "object")
        return { state: "unknown", code: "invalid_provider_response" };
      const o = body as Record<string, unknown>;
      if (
        o.success !== true ||
        typeof o.conversation_id !== "string" ||
        o.conversation_id.length < 1 ||
        o.conversation_id.length > 200
      )
        return { state: "unknown", code: "uncertain_provider_acceptance" };
      return {
        state: "accepted",
        conversationId: o.conversation_id,
        ...(typeof o.sip_call_id === "string" && o.sip_call_id.length <= 200
          ? { sipCallId: o.sip_call_id }
          : {}),
      };
    } catch {
      return { state: "unknown", code: "submission_interrupted" };
    }
  };
}
export interface ProviderEvent {
  conversationId: string;
  kind: "completed" | "failed";
  callbackRequested: boolean;
  failureCode: string | null;
  outcome?:
    | "communicated"
    | "no_answer"
    | "busy"
    | "voicemail"
    | "wrong_recipient"
    | "unverified"
    | "ended_before_message"
    | "unknown";
  recipientVerified?: boolean;
  answered?: boolean;
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function verifyProviderEvent(
  raw: Buffer,
  signature: string | undefined,
  secret: string,
  agentId: string,
  now = Date.now(),
): ProviderEvent {
  const fields = signature?.split(",").map((s) => s.trim()) ?? [];
  const timestamps = fields
    .filter((s) => s.startsWith("t="))
    .map((s) => s.slice(2));
  const signatures = fields
    .filter((s) => s.startsWith("v0="))
    .map((s) => s.slice(3));
  const timestamp = timestamps[0];
  if (
    timestamps.length !== 1 ||
    !timestamp ||
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp) * 1000) > 30 * 60 * 1000
  )
    throw new CallError("invalid_webhook_signature", 401);
  const expected = createHmac("sha256", secret)
    .update(timestamp + ".")
    .update(raw)
    .digest();
  if (
    !signatures.some(
      (s) =>
        /^[a-fA-F0-9]{64}$/.test(s) &&
        timingSafeEqual(Buffer.from(s, "hex"), expected),
    )
  )
    throw new CallError("invalid_webhook_signature", 401);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new CallError("invalid_webhook_payload", 400);
  }
  const event = object(parsed),
    data = object(event.data);
  if (
    data.agent_id !== agentId ||
    typeof data.conversation_id !== "string" ||
    data.conversation_id.length < 1 ||
    data.conversation_id.length > 200
  )
    throw new CallError("unrecognized_call_event", 400);
  if (
    !["post_call_transcription", "call_initiation_failure"].includes(
      String(event.type),
    )
  )
    throw new CallError("unsupported_webhook_event", 400);
  return normalizeProviderResult(
    data,
    event.type === "call_initiation_failure" ? "failed" : "completed",
  );
}
// Called only after signature/agent validation, or authenticated provider GET validation.
// Analysis is a reported conversational outcome, never verified playback/clinical evidence.
export function normalizeProviderResult(
  data: Record<string, unknown>,
  kind: ProviderEvent["kind"],
): ProviderEvent {
  const fields = object(object(data.analysis).data_collection_results);
  const callback = object(fields.callback_requested).value === true;
  const verified = object(fields.recipient_verified).value === true;
  const spoken = object(fields.incident_communicated).value === true;
  const label = object(fields.call_outcome).value;
  const failure =
    typeof data.failure_reason === "string" &&
    ["busy", "no-answer", "unknown"].includes(data.failure_reason)
      ? data.failure_reason
      : "unknown";
  // A transcript/LLM analysis is not playback evidence. Connected/spoken success is
  // intentionally not inferred until the actual SIP event mapping is verified.
  return {
    conversationId: data.conversation_id as string,
    kind,
    callbackRequested: callback,
    failureCode: kind === "failed" ? failure : null,
    outcome:
      kind === "failed"
        ? failure === "busy"
          ? "busy"
          : failure === "no-answer"
            ? "no_answer"
            : "unknown"
        : label === "communicated" && verified && spoken
          ? "communicated"
          : [
                "no_answer",
                "busy",
                "voicemail",
                "wrong_recipient",
                "unverified",
                "ended_before_message",
              ].includes(String(label))
            ? (label as ProviderEvent["outcome"])
            : "unknown",
    recipientVerified: verified,
    ...(object(object(data.metadata).phone_call).call_result === "answered"
      ? { answered: true }
      : {}),
  };
}
