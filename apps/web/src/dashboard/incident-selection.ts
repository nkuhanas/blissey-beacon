import type { Incident } from "@blissey/contracts";
export function overviewIncident(
  records: Incident[],
  room: string,
  now: number,
  focused?: string | null,
) {
  const roomRecords = records.filter((i) => i.room_id === room);
  return (
    roomRecords.find((i) => i.id === focused) ??
    roomRecords.find((i) => i.status !== "resolved") ??
    roomRecords.find(
      (i) => i.resolved_at && now - Date.parse(i.resolved_at) < 60_000,
    )
  );
}
