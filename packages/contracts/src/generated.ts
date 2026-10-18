// Generated from schemas/*.json. Run pnpm contracts:generate.
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
