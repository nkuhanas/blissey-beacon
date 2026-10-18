import familyReplySchema from "../schemas/family-reply.json" with { type: "json" };
import messageHistorySchema from "../schemas/message-history.json" with { type: "json" };
import replyReviewSchema from "../schemas/reply-review.json" with { type: "json" };
import messageReviewSchema from "../schemas/message-review.json" with { type: "json" };
import messageAuthorizationSchema from "../schemas/message-authorization.json" with { type: "json" };
import messagePreviewRequestSchema from "../schemas/message-preview-request.json" with { type: "json" };
import messagingConsentSchema from "../schemas/messaging-consent.json" with { type: "json" };
import incidentWorkflowSchema from "../schemas/incident-workflow.json" with { type: "json" };
import callPreviewSchema from "../schemas/call-preview.json" with { type: "json" };
import incidentActionSchema from "../schemas/incident-action.json" with { type: "json" };
import notificationCallSchema from "../schemas/notification-call.json" with { type: "json" };
import callAuthorizationSchema from "../schemas/call-authorization.json" with { type: "json" };
import callPreviewRequestSchema from "../schemas/call-preview-request.json" with { type: "json" };
import familyCallContextSchema from "../schemas/family-call-context.json" with { type: "json" };
import familyContactSchema from "../schemas/family-contact.json" with { type: "json" };
import familyContactInputSchema from "../schemas/family-contact-input.json" with { type: "json" };
import AjvModule, { type ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";
import event from "../schemas/inference-event.json" with { type: "json" };
import health from "../schemas/device-health.json" with { type: "json" };
import ack from "../schemas/event-ack.json" with { type: "json" };
import error from "../schemas/event-error.json" with { type: "json" };
import explanation from "../schemas/explanation.json" with { type: "json" };
import incident from "../schemas/incident.json" with { type: "json" };
import room from "../schemas/room.json" with { type: "json" };
import type {
  InferenceEvent,
  DeviceHealth,
  EventAck,
  EventError,
  Explanation,
  Room,
  Incident,
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

ajv.addSchema(explanation, "explanation.json");
export const explanationJsonSchema = explanation;
export const validateIncident: ValidateFunction<Incident> =
  ajv.compile(incident);

export const validateFamilyContactInput: ValidateFunction<
  import("./generated.js").FamilyContactInput
> = ajv.compile(familyContactInputSchema);
export const validateFamilyContact: ValidateFunction<
  import("./generated.js").FamilyContact
> = ajv.compile(familyContactSchema);
export const validateFamilyCallContext: ValidateFunction<
  import("./generated.js").FamilyCallContext
> = ajv.compile(familyCallContextSchema);
export const validateCallPreviewRequest: ValidateFunction<
  import("./generated.js").CallPreviewRequest
> = ajv.compile(callPreviewRequestSchema);
export const validateCallAuthorization: ValidateFunction<
  import("./generated.js").CallAuthorization
> = ajv.compile(callAuthorizationSchema);
export const validateNotificationCall: ValidateFunction<
  import("./generated.js").NotificationCall
> = ajv.compile(notificationCallSchema);
export const validateIncidentAction: ValidateFunction<
  import("./generated.js").IncidentAction
> = ajv.compile(incidentActionSchema);

ajv.addSchema(familyCallContextSchema, "family-call-context.json");
export const validateCallPreview: ValidateFunction<
  import("./generated.js").CallPreview
> = ajv.compile(callPreviewSchema);

export const validateIncidentWorkflow: ValidateFunction<
  import("./generated.js").IncidentWorkflow
> = ajv.compile(incidentWorkflowSchema);

export const validateMessagingConsent: ValidateFunction<
  import("./generated.js").MessagingConsent
> = ajv.compile(messagingConsentSchema);

export const validateMessagePreviewRequest: ValidateFunction<
  import("./generated.js").MessagePreviewRequest
> = ajv.compile(messagePreviewRequestSchema);

export const validateMessageAuthorization: ValidateFunction<
  import("./generated.js").MessageAuthorization
> = ajv.compile(messageAuthorizationSchema);

export const validateMessageReview: ValidateFunction<
  import("./generated.js").MessageReview
> = ajv.compile(messageReviewSchema);

export const validateReplyReview: ValidateFunction<
  import("./generated.js").ReplyReview
> = ajv.compile(replyReviewSchema);

ajv.addSchema(familyReplySchema, "family-reply.json");
export const validateFamilyReply: ValidateFunction<
  import("./generated.js").FamilyReply
> = ajv.compile(familyReplySchema);
export const validateMessageHistory: ValidateFunction<
  import("./generated.js").MessageHistory
> = ajv.compile(messageHistorySchema);
