// Generated from schemas/*.json. Run pnpm contracts:generate.
export interface CallAuthorization {
  preview_id: string;
  context_hash: string;
  expected_revision: number;
  explicit_authorization: true;
  retry_of?: string | null;
  message_preview_id?: string;
  message_context_hash?: string;
  explicit_messaging_authorization?: true;
}

export interface CallPreviewRequest {
  contact_id: string;
  expected_revision: number;
}

export interface CallPreview {
  preview_id: string;
  expires_at: string;
  expected_revision: number;
  context_hash: string;
  recipient: {
    id: string;
    name: string;
    phone_e164: string;
  };
  context: FamilyCallContext;
  opening: string;
  policy: string;
  policy_version: string;
  dispatch_enabled: boolean;
}

export interface DeviceHealth {
  type: "device_health";
  device_id: string;
  room_id: string;
  sent_at: string;
  sensor_status: "connected" | "degraded" | "disconnected";
  model_status: "loading" | "ready" | "error";
  last_valid_frame_at: string | null;
  outbox_depth: number;
  dropped_event_count: number;
  clock_synced: boolean;
}

export interface EventAck {
  type: "event_ack";
  event_id: string;
  incident_id: string;
  status: "accepted" | "duplicate";
}

export interface EventError {
  type: "error";
  event_id: string;
  code: string;
  retryable: boolean;
}

export interface Explanation {
  event_id: string;
  title: string;
  description: string;
  recommended_action: string;
}

export interface FamilyCallContext {
  incident_id: string;
  explanation_source: "gemini" | "deterministic";
  event_type: "inference_result";
  room_label: string;
  /**
   * Frozen fictional patient display label from the incident-time room assignment. Optional only for historical contexts created before family-call-v3.
   */
  resident_name?: string;
  detected_at: string;
  family_summary: string;
  resident_condition: "unknown";
  staff_response: "not_confirmed";
  recipient_name: string;
  /**
   * @minItems 2
   * @maxItems 2
   */
  allowed_actions: ["explain_incident" | "request_callback", "explain_incident" | "request_callback"];
  /**
   * Persisted incident lifecycle frozen at operator review. Optional for historical contexts; active-alert wording requires pending, acknowledged or responding.
   */
  incident_status?: "pending" | "acknowledged" | "responding" | "resolved";
}

export interface FamilyContactInput {
  facility_id: string;
  patient_id: string;
  contact_name: string;
  relationship: string;
  phone_e164: string;
  consent_status: "granted" | "revoked";
  expected_revision: number;
  consent_confirmed: true;
}

export interface FamilyContact {
  id: string;
  facility_id: string;
  patient_id: string;
  contact_name: string;
  relationship: string;
  phone_e164: string;
  consent_status: "granted" | "revoked";
  revision: number;
  consented_at: string | null;
  consent_revoked_at: string | null;
  imessage_consent_status?: "granted" | "revoked";
}

export interface FamilyReply {
  id: string;
  incident_id: string | null;
  contact_id: string;
  body: string;
  intent: "acknowledged" | "callback_requested" | "stop" | "operator_review";
  review_status: "pending" | "reviewed";
  received_at: string;
}

export interface IncidentAction {
  expected_revision: number;
  status?: "acknowledged" | "responding" | "resolved";
  disposition?: "reported_fall" | "false_alarm" | "unknown";
  note?: string;
}

export interface IncidentWorkflow {
  incident_id: string;
  status: "pending" | "acknowledged" | "responding" | "resolved";
  revision: number;
  disposition: "reported_fall" | "false_alarm" | "unknown" | null;
  allowed_actions: ("acknowledged" | "responding" | "resolved" | "add_note")[];
  patient_id: string | null;
  /**
   * @maxItems 100
   */
  notes: {
    actor_id: string;
    note: string;
    created_at: string;
  }[];
}

export interface Incident {
  id: string;
  event_id: string;
  room_id: string;
  facility_id: string;
  device_id: string;
  status: "pending" | "acknowledged" | "responding" | "resolved";
  revision: number;
  detected_at: string;
  received_at: string;
  created_at: string;
  confidence_scores: {
    fall: number;
    non_fall: number;
  };
  sensor_status: "connected";
  explanation_status: "pending" | "ready" | "fallback";
  /**
   * @maxItems 0
   */
  allowed_actions: [];
  explanation?: Explanation | null;
}

export interface InferenceEvent {
  event_id: string;
  room_id: string;
  device_id: string;
  event_type: "inference_result";
  confidence_scores: {
    fall: number;
    non_fall: number;
  };
  detected_at: string;
  sensor_status: "connected";
}

export interface MessageAuthorization {
  preview_id: string;
  context_hash: string;
  expected_revision: number;
  explicit_authorization: true;
}

export interface MessageHistory {
  /**
   * @maxItems 100
   */
  authorizations: {
    id: string;
    call_id: string | null;
    state: "waiting" | "review" | "queued" | "cancelled" | "submitted";
    selection: ("missed" | "summary" | "update") | null;
    evidence: string | null;
    created_at: string;
    updated_at: string;
  }[];
  /**
   * @maxItems 100
   */
  messages: {
    id: string;
    authorization_id: string;
    body: string;
    state: "queued" | "initiating" | "accepted" | "delivered" | "read" | "failed" | "unknown" | "cancelled";
    error_code: string | null;
    created_at: string;
    updated_at: string;
  }[];
  /**
   * @maxItems 100
   */
  replies: FamilyReply[];
}

export type MessagePreviewRequest = {
  [k: string]: unknown;
} & {
  contact_id: string;
  expected_revision: number;
  purpose: "followup" | "update";
  update_text?: string;
  verified_facts_confirmed?: true;
  /**
   * Explicit operator confirmation that staff dispatch occurred for this incident; only valid for a follow-up preview. Records confirmation, does not dispatch staff.
   */
  staff_dispatch_confirmed?: true;
};

export interface MessageReview {
  expected_revision: number;
  evidence: "no_answer" | "busy" | "voicemail" | "ended_before_message" | "communicated";
  recipient_verified: boolean;
  note: string;
  explicit_authorization: true;
}

export interface MessagingConsent {
  expected_revision: number;
  consent_status: "granted" | "revoked";
  consent_confirmed: true;
}

export interface NotificationCall {
  id: string;
  incident_id: string;
  contact_id: string;
  transport_status: "queued" | "initiating" | "in_progress" | "completed" | "failed" | "unknown";
  notification_success: boolean;
  connected: boolean;
  notification_spoken: boolean;
  callback_requested: boolean;
  summary: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReplyReview {
  incident_id?: string;
  intent?: "acknowledged" | "callback_requested" | "operator_review";
  explicit_review: true;
}

export interface Room {
  id: string;
  facility_id: string;
  label: string;
  floor: number;
  layout: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}
