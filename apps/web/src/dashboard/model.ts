// Fictional, browser-only fixtures. Never send these to the operator API.
export type IncidentStatus =
  "pending" | "acknowledged" | "responding" | "resolved";
export type Contact = { name: string; phone: string; consent: boolean };
export type DemoRoom = {
  id: string;
  resident: string;
  device: string;
  online: boolean;
  contact: Contact | null;
  lastDataAt?: string | null;
  monitoringStatus?: "offline" | "degraded" | "monitoring";
};
export type DemoIncident = {
  record?: import("@blissey/contracts").Incident;
  roomId: string;
  status: IncidentStatus;
  explanation: "pending" | "ready" | "fallback";
  timeline: string[];
  notes: string[];
  falseAlarm: boolean;
};
export type DemoState = { rooms: DemoRoom[]; incident: DemoIncident | null };
export type Scenario = "attention" | "ready" | "fallback" | "offline" | "empty";
export function createDemo(scenario: Scenario = "attention"): DemoState {
  const names = [
    "Eleanor Brooks",
    "James Wilson",
    "Rose Chen",
    "Margaret Lee",
    "Arthur Davis",
    "Grace Patel",
  ];
  return {
    rooms: names.map((resident, i) => ({
      id: String(101 + i),
      resident,
      device: `pi_${101 + i}`,
      online: scenario !== "offline" && i !== 5,
      contact:
        i === 3
          ? { name: "Daniel Lee", phone: "+12025550142", consent: true }
          : null,
    })),
    incident:
      scenario === "empty"
        ? null
        : {
            roomId: "104",
            status: "pending",
            explanation:
              scenario === "ready"
                ? "ready"
                : scenario === "fallback"
                  ? "fallback"
                  : "pending",
            timeline: ["2:32 PM · Staged possible-fall event received"],
            notes: [],
            falseAlarm: false,
          },
  };
}
export type DemoAction =
  | { type: "advance"; status: IncidentStatus }
  | { type: "false-alarm" }
  | { type: "note"; text: string }
  | { type: "contact"; roomId: string; contact: Contact }
  | { type: "reset"; scenario: Scenario };
export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  if (action.type === "reset") return createDemo(action.scenario);
  if (action.type === "contact")
    return {
      ...state,
      rooms: state.rooms.map((room) =>
        room.id === action.roomId ? { ...room, contact: action.contact } : room,
      ),
    };
  const incident = state.incident;
  if (!incident) return state;
  if (action.type === "note") {
    const text = action.text.trim();
    if (!text || text.length > 500) return state;
    return {
      ...state,
      incident: { ...incident, notes: [...incident.notes, text] },
    };
  }
  if (incident.status === "resolved") return state;
  if (action.type === "false-alarm")
    return {
      ...state,
      incident: {
        ...incident,
        status: "resolved",
        falseAlarm: true,
        timeline: [...incident.timeline, "Demo action · Marked as false alarm"],
      },
    };
  const next: Partial<Record<IncidentStatus, IncidentStatus>> = {
    pending: "acknowledged",
    acknowledged: "responding",
    responding: "resolved",
  };
  if (next[incident.status] !== action.status) return state;
  return {
    ...state,
    incident: {
      ...incident,
      status: action.status,
      timeline: [...incident.timeline, `Demo action · ${action.status}`],
    },
  };
}
export function roomStatus(room: DemoRoom, incident: DemoIncident | null) {
  if (incident?.roomId === room.id && incident.status !== "resolved")
    return incident.status === "pending"
      ? "Possible fall · Pending"
      : `Possible fall · ${incident.status}`;
  return room.monitoringStatus === "degraded"
    ? "Monitoring degraded"
    : room.online
      ? "Monitoring"
      : "Sensor offline";
}
export function canReviewCall(room: DemoRoom, incident: DemoIncident | null) {
  return !!(
    room.contact?.consent &&
    room.contact.name.trim() &&
    /^\+[1-9]\d{7,14}$/.test(room.contact.phone) &&
    incident?.roomId === room.id
  );
}
