import type { PoolClient } from "pg";
import { CallError } from "./policy.js";
export async function member(c: PoolClient, subject: string, facility: string) {
  if (
    !(
      await c.query(
        "SELECT 1 FROM public.facility_memberships WHERE user_id=$1 AND facility_id=$2 FOR SHARE",
        [subject, facility],
      )
    ).rowCount
  )
    throw new CallError("forbidden", 403);
}
export async function incident(c: PoolClient, subject: string, id: string) {
  const r = await c.query(
    `SELECT i.*,e.detected_at,r.label,x.source FROM public.incidents i
    JOIN public.facility_memberships m ON m.facility_id=i.facility_id AND m.user_id=$1
    JOIN public.inference_events e ON e.event_id=i.event_id JOIN public.rooms r ON r.id=i.room_id
    LEFT JOIN public.explanations x ON x.incident_id=i.id WHERE i.id=$2 FOR UPDATE OF i`,
    [subject, id],
  );
  if (!r.rows[0]) throw new CallError("not_found", 404);
  return r.rows[0];
}
export async function assigned(
  c: PoolClient,
  i: { room_id: string; detected_at: Date; facility_id: string },
  patient: string,
) {
  const r = await c.query(
    `SELECT a.patient_id,p.display_label FROM public.room_assignments a
    JOIN public.patients p ON p.id=a.patient_id AND p.facility_id=a.facility_id
    WHERE a.room_id=$1 AND a.facility_id=$2
    AND a.assigned_at<=$3 AND (a.released_at IS NULL OR a.released_at>$3) FOR SHARE OF a,p`,
    [i.room_id, i.facility_id, i.detected_at],
  );
  if (r.rowCount !== 1 || r.rows[0].patient_id !== patient)
    throw new CallError("historical_patient_mismatch");
  return r.rows[0].display_label as string;
}
export async function bump(c: PoolClient, id: string) {
  await c.query("UPDATE public.incidents SET revision=revision+1 WHERE id=$1", [
    id,
  ]);
}
