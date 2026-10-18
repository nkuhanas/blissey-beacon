import type { Pool } from "pg";
import type { Incident } from "@blissey/contracts";
export interface IncidentPage {
  incidents: Incident[];
  next_cursor: string | null;
}
const projection = `i.id,i.event_id,i.room_id,i.facility_id,e.device_id,i.status,i.revision,i.resolved_at,
 e.detected_at,e.received_at,i.created_at,e.payload->'confidence_scores' AS confidence_scores,
 e.payload->>'sensor_status' AS sensor_status,
 CASE WHEN j.state='fallback' THEN 'fallback' WHEN j.state='completed' THEN 'ready' ELSE 'pending' END AS explanation_status, x.output AS explanation`;
const joins = `FROM public.incidents i JOIN public.inference_events e ON e.event_id=i.event_id
 JOIN public.explanation_jobs j ON j.incident_id=i.id
 LEFT JOIN public.explanations x ON x.incident_id=i.id
 JOIN public.facility_memberships m ON m.facility_id=i.facility_id AND m.user_id=$1`;
type Row = Omit<
  Incident,
  | "detected_at"
  | "received_at"
  | "created_at"
  | "allowed_actions"
  | "resolved_at"
> & {
  detected_at: Date;
  received_at: Date;
  created_at: Date;
  resolved_at: Date | null;
};
function dto(row: Row, includeExplanation: boolean): Incident {
  const { explanation, ...rest } = row;
  return {
    ...rest,
    ...(includeExplanation ? { explanation: explanation ?? null } : {}),
    detected_at: row.detected_at.toISOString(),
    received_at: row.received_at.toISOString(),
    created_at: row.created_at.toISOString(),
    resolved_at: row.resolved_at?.toISOString() ?? null,
    allowed_actions: [],
  };
}
export function createIncidentStore(pool: Pool) {
  return {
    async listIncidents(
      subject: string,
      facilityId: string,
      limit: number,
      cursor: string | null,
      includeExplanation = false,
    ): Promise<IncidentPage> {
      const result = await pool.query<Row>(
        `SELECT ${projection} ${joins} WHERE i.archived_at IS NULL AND i.facility_id=$2
    AND ($3::uuid IS NULL OR (i.created_at,i.id)<(SELECT c.created_at,c.id FROM public.incidents c WHERE c.id=$3 AND c.facility_id=$2))
    ORDER BY i.created_at DESC,i.id DESC LIMIT $4`,
        [subject, facilityId, cursor, limit + 1],
      );
      const rows = result.rows.slice(0, limit);
      return {
        incidents: rows.map((row) => dto(row, includeExplanation)),
        next_cursor: result.rows.length > limit ? rows.at(-1)!.id : null,
      };
    },
    async getIncident(
      subject: string,
      id: string,
      includeExplanation = false,
    ): Promise<Incident | null> {
      const result = await pool.query<Row>(
        `SELECT ${projection} ${joins} WHERE i.archived_at IS NULL AND i.id=$2`,
        [subject, id],
      );
      return result.rows[0] ? dto(result.rows[0], includeExplanation) : null;
    },
    async listDeviceStatus(subject: string, facilityId: string) {
      const result = await pool.query(
        `SELECT d.id AS device_id,d.room_id,r.facility_id,h.sent_at,h.received_at,
    h.sensor_status,h.model_status,h.last_valid_frame_at,h.outbox_depth::float8,h.dropped_event_count::float8,h.clock_synced,
    (h.received_at IS NULL OR h.received_at < clock_timestamp()-interval '30 seconds') AS stale,
    CASE WHEN h.received_at IS NULL OR h.received_at < clock_timestamp()-interval '30 seconds' THEN 'offline'
     WHEN h.sensor_status<>'connected' OR h.model_status<>'ready' THEN 'degraded' ELSE 'monitoring' END AS monitoring_status
    FROM public.devices d JOIN public.rooms r ON r.id=d.room_id
    JOIN public.facility_memberships m ON m.facility_id=r.facility_id AND m.user_id=$1
    LEFT JOIN public.device_health h ON h.device_id=d.id WHERE r.facility_id=$2 ORDER BY d.id`,
        [subject, facilityId],
      );
      return result.rows;
    },
  };
}
