import {
  validateDashboardRoom,
  validateIncident,
  validateIncidentWorkflow,
  validateCallPreview,
  validateNotificationCall,
  validateFamilyContact,
  validateMessageHistory,
} from "@blissey/contracts";
import type {
  DashboardRoom,
  Incident,
  IncidentWorkflow,
  CallPreview,
  NotificationCall,
  FamilyContact,
  MessageHistory,
  IncidentAction,
  CallAuthorization,
  DemoScenarioRequest,
} from "@blissey/contracts";
export class OperatorError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code.replaceAll("_", " "));
    this.code = code;
    this.status = status;
  }
}
type Validator<T> = (value: unknown) => value is T;
export interface MessagePreview {
  preview_id: string;
  context_hash: string;
  expected_revision: number;
  expires_at: string;
  dispatch_enabled: boolean;
  candidates: { missed: string; summary: string };
}
function isMessagePreview(value: unknown): value is MessagePreview {
  if (!value || typeof value !== "object") return false;
  const x = value as Record<string, unknown>,
    c = x.candidates as Record<string, unknown> | undefined;
  return (
    typeof x.preview_id === "string" &&
    typeof x.context_hash === "string" &&
    Number.isInteger(x.expected_revision) &&
    typeof x.expires_at === "string" &&
    typeof x.dispatch_enabled === "boolean" &&
    !!c &&
    typeof c.missed === "string" &&
    typeof c.summary === "string"
  );
}
export function createOperatorApi(base: string, token: string) {
  async function request<T>(
    path: string,
    validate: Validator<T>,
    method = "GET",
    body?: unknown,
    key?: string,
  ): Promise<T> {
    const response = await fetch(base + path, {
      method,
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const code =
        result &&
        typeof result === "object" &&
        "error" in result &&
        typeof result.error === "string"
          ? result.error
          : "request_failed";
      throw new OperatorError(code, response.status);
    }
    if (!validate(result)) throw new Error("Unexpected operator API response");
    return result;
  }
  const root = (id: string) =>
    `/api/operator/incidents/${encodeURIComponent(id)}`;
  const object = (x: unknown): x is Record<string, unknown> =>
    !!x && typeof x === "object";
  return {
    dashboard: (facility: string) =>
      request(
        `/api/operator/dashboard?facility_id=${encodeURIComponent(facility)}`,
        (x): x is { rooms: DashboardRoom[]; scenarios_enabled: boolean } =>
          object(x) &&
          Array.isArray(x.rooms) &&
          x.rooms.every((row) => validateDashboardRoom(row)) &&
          typeof x.scenarios_enabled === "boolean",
      ),
    incidents: (facility: string, cursor?: string) =>
      request(
        `/api/operator/incidents?facility_id=${encodeURIComponent(facility)}&include_explanation=true&limit=100${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
        (x): x is { incidents: Incident[]; next_cursor?: string | null } =>
          object(x) &&
          Array.isArray(x.incidents) &&
          x.incidents.every((row) => validateIncident(row)),
      ),
    instantiate: (input: DemoScenarioRequest, key: string) =>
      request(
        "/api/operator/demo/scenarios",
        (
          x,
        ): x is {
          scenario_id: string;
          incident_id: string | null;
          room_id: string;
          scenario: string;
        } =>
          object(x) &&
          typeof x.scenario_id === "string" &&
          (typeof x.incident_id === "string" || x.incident_id === null) &&
          typeof x.room_id === "string" &&
          typeof x.scenario === "string",
        "POST",
        input,
        key,
      ),
    workflow: (id: string) =>
      request(root(id) + "/workflow", validateIncidentWorkflow),
    action: (id: string, input: IncidentAction, key: string) =>
      request(
        root(id),
        (x): x is Record<string, unknown> => object(x) && object(x.action),
        "PATCH",
        input,
        key,
      ),
    contacts: (facility: string, patient: string) =>
      request(
        `/api/operator/family-contacts?facility_id=${encodeURIComponent(facility)}&patient_id=${encodeURIComponent(patient)}`,
        (x): x is { contacts: FamilyContact[] } =>
          object(x) &&
          Array.isArray(x.contacts) &&
          x.contacts.every((row) => validateFamilyContact(row)),
      ),
    previewCall: (id: string, contact: string, revision: number) =>
      request(
        root(id) + "/notifications/preview",
        validateCallPreview,
        "POST",
        { contact_id: contact, expected_revision: revision },
      ),
    previewMessages: (
      id: string,
      contact: string,
      revision: number,
      staffDispatched: boolean,
    ) =>
      request(root(id) + "/messages/preview", isMessagePreview, "POST", {
        contact_id: contact,
        expected_revision: revision,
        purpose: "followup",
        ...(staffDispatched ? { staff_dispatch_confirmed: true } : {}),
      }),
    authorize: (id: string, input: CallAuthorization, key: string) =>
      request(
        root(id) + "/notifications",
        (x): x is { call: NotificationCall } =>
          object(x) && validateNotificationCall(x.call),
        "POST",
        input,
        key,
      ),
    calls: (id: string) =>
      request(
        root(id) + "/notifications",
        (x): x is { calls: NotificationCall[] } =>
          object(x) &&
          Array.isArray(x.calls) &&
          x.calls.every((row) => validateNotificationCall(row)),
      ),
    messages: (id: string) =>
      request(root(id) + "/messages", validateMessageHistory),
    reviewMessage: (
      authorizationId: string,
      revision: number,
      evidence: "communicated" | "no_answer" | "voicemail",
      verified: boolean,
    ) =>
      request(
        `/api/operator/message-authorizations/${encodeURIComponent(authorizationId)}/review`,
        (x): x is Record<string, unknown> => object(x),
        "POST",
        {
          expected_revision: revision,
          evidence,
          recipient_verified: verified,
          note: "Operator reviewed the outcome in the dashboard.",
          explicit_authorization: true,
        },
      ),
  };
}
export type OperatorApi = ReturnType<typeof createOperatorApi>;
export type {
  IncidentWorkflow,
  CallPreview,
  NotificationCall,
  FamilyContact,
  MessageHistory,
};

// Resolve a snapshot of this room's active alerts through the established lifecycle.
// Never resets device health, deletes history or invokes notification endpoints.
export async function resetRoomAlerts(
  api: Pick<OperatorApi, "incidents" | "workflow" | "action">,
  facility: string,
  room: string,
) {
  const targets: string[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const history = await api.incidents(facility, cursor);
    targets.push(
      ...history.incidents
        .filter((i) => i.room_id === room && i.status !== "resolved")
        .map((i) => i.id),
    );
    const next = history.next_cursor;
    if (!next) {
      cursor = undefined;
      break;
    }
    if (seen.has(next))
      throw Error(
        "Incident history pagination changed. Refresh before resetting alerts.",
      );
    seen.add(next);
    cursor = next;
  }
  if (cursor) throw Error("Too many historical records to reset at once.");
  for (const id of new Set(targets)) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const w = await api.workflow(id);
      if (w.status === "resolved") break;
      const status =
        w.status === "pending"
          ? "acknowledged"
          : w.status === "acknowledged"
            ? "responding"
            : "resolved";
      try {
        await api.action(
          id,
          {
            expected_revision: w.revision,
            status,
            note: "Operator reset room alerts; preserve monitoring and history. No notification authorized.",
          },
          crypto.randomUUID(),
        );
      } catch (e) {
        if (!(e instanceof OperatorError && e.status === 409)) throw e;
      }
      if (attempt === 7)
        throw Error(
          "The incident kept changing. Refresh and retry the room reset.",
        );
    }
  }
  return new Set(targets).size;
}
