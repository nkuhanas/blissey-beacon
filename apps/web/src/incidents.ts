// Backend/frontend handoff: Realtime invalidates snapshots; REST owns the DTO.
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateIncident, type Incident } from "@blissey/contracts";
export async function fetchIncidents(
  apiUrl: string,
  token: string,
  facilityId: string,
  signal: AbortSignal,
): Promise<Incident[]> {
  const response = await fetch(
    `${apiUrl}/api/operator/incidents?facility_id=${encodeURIComponent(facilityId)}&include_explanation=true`,
    { headers: { Authorization: `Bearer ${token}` }, signal },
  );
  if (!response.ok)
    throw new Error("Unable to load authorized incident history.");
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== "object" ||
    !("incidents" in body) ||
    !Array.isArray(body.incidents) ||
    !body.incidents.every((row) => validateIncident(row))
  )
    throw new Error("Unexpected incident response.");
  return body.incidents;
}
export function subscribeToIncidents(
  client: SupabaseClient,
  facilityId: string,
  refresh: () => void,
  status: (stale: boolean) => void,
) {
  const channel = client
    .channel(`incidents:${facilityId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "incidents",
        filter: `facility_id=eq.${facilityId}`,
      },
      () => refresh(),
    )
    .on("system", {}, (message) => {
      if (message.extension === "postgres_changes") {
        status(message.status !== "ok");
        if (message.status === "ok") refresh();
      }
    })
    .subscribe((state) => {
      status(state !== "SUBSCRIBED");
      if (state === "SUBSCRIBED") refresh();
    });
  return () => {
    void client.removeChannel(channel);
  };
}
