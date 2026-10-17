import { createIncidentStore } from "./incidents/store.js";
import type { Pool, PoolClient } from "pg";
import type { Room } from "@blissey/contracts";
// All statements in the callback share this checked-out client. Never use pool.query inside it.
export async function withTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let destroyed = false;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      client.release(true);
      destroyed = true;
      throw error;
    }
    throw error;
  } finally {
    if (!destroyed) client.release();
  }
}
export function createStore(pool: Pool) {
  return {
    ...createIncidentStore(pool),
    async isMember(subject: string, facilityId: string) {
      const result = await pool.query(
        "SELECT 1 FROM public.facility_memberships WHERE user_id = $1 AND facility_id = $2",
        [subject, facilityId],
      );
      return result.rowCount === 1;
    },
    async listRooms(facilityId: string): Promise<Room[]> {
      const result = await pool.query<Room>(
        "SELECT id, facility_id, label, floor, layout FROM public.rooms WHERE facility_id = $1 ORDER BY id",
        [facilityId],
      );
      return result.rows;
    },
  };
}
