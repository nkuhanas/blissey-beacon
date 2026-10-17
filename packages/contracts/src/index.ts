import AjvModule, { type ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";
import event from "../schemas/inference-event.json" with { type: "json" };
import health from "../schemas/device-health.json" with { type: "json" };
import ack from "../schemas/event-ack.json" with { type: "json" };
import error from "../schemas/event-error.json" with { type: "json" };
import explanation from "../schemas/explanation.json" with { type: "json" };
import room from "../schemas/room.json" with { type: "json" };
import type {
  InferenceEvent,
  DeviceHealth,
  EventAck,
  EventError,
  Explanation,
  Room,
} from "./generated.js";
export type * from "./generated.js";
const ajv = new AjvModule.default({ allErrors: true, strict: true });
addFormatsModule.default(ajv);
export const validateEvent: ValidateFunction<InferenceEvent> =
  ajv.compile(event);
export const validateHealth: ValidateFunction<DeviceHealth> =
  ajv.compile(health);
export const validateAck: ValidateFunction<EventAck> = ajv.compile(ack);
export const validateEventError: ValidateFunction<EventError> =
  ajv.compile(error);
export const validateExplanation: ValidateFunction<Explanation> =
  ajv.compile(explanation);
export const validateRoom: ValidateFunction<Room> = ajv.compile(room);
// JSON Schema checks shape/ranges; this cross-field rule is also required on QNX.
export function isInferenceEvent(value: unknown): value is InferenceEvent {
  return (
    validateEvent(value) &&
    Math.abs(
      value.confidence_scores.fall + value.confidence_scores.non_fall - 1,
    ) <= 1e-6
  );
}
