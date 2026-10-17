import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  InferenceEvent,
  DeviceHealth,
  EventAck,
} from "@blissey/contracts";
import { withTransaction } from "../db.js";
export class IngestionError extends Error {
  constructor(
    public code:
      "unauthorized_device" | "identity_mismatch" | "event_id_conflict",
  ) {
    super(code);
  }
}
export function credentialHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export interface DeviceIdentity {
  device_id: string;
  room_id: string;
  facility_id: string;
}
export interface DeviceStore {
  authenticate(hash: string): Promise<DeviceIdentity | null>;
  ingest(hash: string, event: InferenceEvent): Promise<EventAck>;
  health(hash: string, health: DeviceHealth): Promise<void>;
}
const identitySql = `SELECT d.id AS device_id,d.room_id,r.facility_id
 FROM public.device_credentials c JOIN public.devices d ON d.id=c.device_id
 JOIN public.rooms r ON r.id=d.room_id WHERE c.token_hash=$1 AND c.revoked_at IS NULL`;
async function authorize(
  client: PoolClient,
  hash: string,
  payload: { device_id: string; room_id: string },
) {
  // Revocation/reassignment must serialize against the persistence transaction.
  const result = await client.query<DeviceIdentity>(
    identitySql + " FOR SHARE OF c,d,r",
    [hash],
  );
  const identity = result.rows[0];
  if (!identity) throw new IngestionError("unauthorized_device");
  if (
    identity.device_id !== payload.device_id ||
    identity.room_id !== payload.room_id
  )
    throw new IngestionError("identity_mismatch");
  return identity;
}
export function createDeviceStore(pool: Pool): DeviceStore {
  return {
    async authenticate(hash) {
      return (
        (await pool.query<DeviceIdentity>(identitySql, [hash])).rows[0] ?? null
      );
    },
    async ingest(hash, event) {
      return withTransaction(pool, async (client) => {
        const identity = await authorize(client, hash, event);
        // ON CONFLICT waits for concurrent inserts; uniqueness lives in PostgreSQL.
        const inserted = await client.query(
          `INSERT INTO public.inference_events(event_id,device_id,room_id,payload,detected_at)
     VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,
          [
            event.event_id,
            event.device_id,
            event.room_id,
            JSON.stringify(event),
            event.detected_at,
          ],
        );
        if (inserted.rowCount === 0) {
          const existing = await client.query<{ id: string; same: boolean }>(
            `SELECT i.id,
      (e.device_id=$2 AND e.room_id=$3 AND e.payload=$4::jsonb) AS same
      FROM public.inference_events e JOIN public.incidents i ON i.event_id=e.event_id WHERE e.event_id=$1`,
            [
              event.event_id,
              event.device_id,
              event.room_id,
              JSON.stringify(event),
            ],
          );
          if (!existing.rows[0]?.same)
            throw new IngestionError("event_id_conflict");
          return {
            type: "event_ack",
            event_id: event.event_id,
            incident_id: existing.rows[0].id,
            status: "duplicate",
          };
        }
        const incident = await client.query<{ id: string }>(
          `INSERT INTO public.incidents(event_id,room_id,facility_id)
     VALUES ($1,$2,$3) RETURNING id`,
          [event.event_id, event.room_id, identity.facility_id],
        );
        const id = incident.rows[0]!.id;
        await client.query(
          "INSERT INTO public.explanation_jobs(incident_id) VALUES ($1)",
          [id],
        );
        // withTransaction resolves only after COMMIT succeeds. Socket ACK is sent by caller.
        return {
          type: "event_ack",
          event_id: event.event_id,
          incident_id: id,
          status: "accepted",
        };
      });
    },
    async health(hash, message) {
      await withTransaction(pool, async (client) => {
        await authorize(client, hash, message);
        // Server receipt time drives staleness. Older reported health cannot erase newer state.
        await client.query(
          `INSERT INTO public.device_health(device_id,room_id,sent_at,sensor_status,model_status,
     last_valid_frame_at,outbox_depth,dropped_event_count,clock_synced)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT(device_id) DO UPDATE SET room_id=excluded.room_id,sent_at=excluded.sent_at,
      received_at=clock_timestamp(),sensor_status=excluded.sensor_status,model_status=excluded.model_status,
      last_valid_frame_at=excluded.last_valid_frame_at,outbox_depth=excluded.outbox_depth,
      dropped_event_count=excluded.dropped_event_count,clock_synced=excluded.clock_synced
     WHERE excluded.sent_at > device_health.sent_at`,
          [
            message.device_id,
            message.room_id,
            message.sent_at,
            message.sensor_status,
            message.model_status,
            message.last_valid_frame_at,
            message.outbox_depth,
            message.dropped_event_count,
            message.clock_synced,
          ],
        );
      });
    },
  };
}
