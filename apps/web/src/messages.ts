// Paper/front-end handoff: use incident Realtime revisions to invalidate this REST snapshot.
// Message bodies are untrusted text; render with React text nodes, never innerHTML.
import {
  validateMessageHistory,
  validateFamilyReply,
  type MessageHistory,
  type FamilyReply,
} from "@blissey/contracts";
export async function fetchMessageHistory(
  apiUrl: string,
  token: string,
  incidentId: string,
  signal: AbortSignal,
): Promise<MessageHistory> {
  const r = await fetch(
    `${apiUrl}/api/operator/incidents/${encodeURIComponent(incidentId)}/messages`,
    { headers: { Authorization: `Bearer ${token}` }, signal },
  );
  if (!r.ok) throw Error("Unable to load authorized family messages.");
  const body: unknown = await r.json();
  if (!validateMessageHistory(body))
    throw Error("Unexpected message history response.");
  return body;
}
export async function fetchFamilyReplies(
  apiUrl: string,
  token: string,
  facilityId: string,
  signal: AbortSignal,
): Promise<FamilyReply[]> {
  const r = await fetch(
    `${apiUrl}/api/operator/family-replies?facility_id=${encodeURIComponent(facilityId)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal },
  );
  if (!r.ok) throw Error("Unable to load authorized family replies.");
  const body: unknown = await r.json();
  if (
    !body ||
    typeof body !== "object" ||
    !("replies" in body) ||
    !Array.isArray(body.replies) ||
    !body.replies.every((x) => validateFamilyReply(x))
  )
    throw Error("Unexpected family replies response.");
  return body.replies;
}
