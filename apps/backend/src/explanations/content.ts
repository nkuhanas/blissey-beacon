import { createHash } from "node:crypto";
import {
  isInferenceEvent,
  validateExplanation,
  type Explanation,
  type InferenceEvent,
} from "@blissey/contracts";
export const PROMPT_VERSION = "grounded-phrasing-v1";
export interface Facts {
  event_id: string;
  event_type: "inference_result";
  room_label: string;
  detected_at: string;
  confidence_scores: InferenceEvent["confidence_scores"];
  sensor_status: "connected";
  audience: "operator";
}
export function factsFor(
  payload: unknown,
  eventId: string,
  roomLabel: string,
): Facts | null {
  if (!isInferenceEvent(payload) || payload.event_id !== eventId) return null;
  return {
    event_id: payload.event_id,
    event_type: payload.event_type,
    room_label: roomLabel.slice(0, 120),
    detected_at: payload.detected_at,
    confidence_scores: {
      fall: payload.confidence_scores.fall,
      non_fall: payload.confidence_scores.non_fall,
    },
    sensor_status: payload.sensor_status,
    audience: "operator",
  };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonical(record[key])]),
    );
  }
  return value;
}
export function inputHash(facts: Facts | null, eventId: string) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical(facts ?? { event_id: eventId, invalid_input: true }),
      ),
    )
    .digest("hex");
}
// A deliberately constrained MVP: Gemini chooses wording, never adds observations.
// Exact allowlists validate grounding independently of the provider's JSON mode.
export function wording(facts: Facts) {
  const scores = `fall ${facts.confidence_scores.fall}, non-fall ${facts.confidence_scores.non_fall}`;
  return {
    title: ["Sensor inference received", "Sensor result ready for review"],
    description: [
      `A sensor inference was received for ${facts.room_label} at ${facts.detected_at}. Experimental confidence scores: ${scores}. Sensor status: ${facts.sensor_status}.`,
      `${facts.room_label}: experimental confidence scores are ${scores}. The sensor reported this inference at ${facts.detected_at}, with sensor status ${facts.sensor_status}.`,
    ],
    recommended_action: [
      "Review the incident and check on the resident.",
      "Check on the resident and review the sensor result.",
    ],
  };
}
export function grounded(value: unknown, facts: Facts): value is Explanation {
  if (!validateExplanation(value) || value.event_id !== facts.event_id)
    return false;
  const choices = wording(facts);
  return (
    choices.title.includes(value.title) &&
    choices.description.includes(value.description) &&
    choices.recommended_action.includes(value.recommended_action)
  );
}
export function fallback(eventId: string): Explanation {
  return {
    event_id: eventId,
    title: "Sensor inference received",
    description:
      "An inference result was recorded. Automated explanation is unavailable; review the incident's recorded sensor scores.",
    recommended_action: "Review the incident and check on the resident.",
  };
}
