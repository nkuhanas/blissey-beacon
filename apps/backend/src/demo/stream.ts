import type { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";
import { withTransaction } from "../db.js";

// Latest-only synthetic samples, never authenticated Pi health or inference incidents.
export async function tickDemoStreams(pool: Pool, facility: string) {
  return withTransaction(pool, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "demo-stream:" + facility,
    ]);
    await c.query(
      `INSERT INTO public.demo_room_streams(room_id)
      SELECT r.id FROM public.rooms r WHERE r.facility_id=$1 AND r.id<>'101'
      AND NOT EXISTS(SELECT 1 FROM public.devices d JOIN public.device_credentials dc ON dc.device_id=d.id WHERE d.room_id=r.id AND dc.revoked_at IS NULL)
      ON CONFLICT DO NOTHING`,
      [facility],
    );
    return (
      await c.query(
        `UPDATE public.demo_room_streams s SET
      sampled_at=clock_timestamp(),sample_index=(sample_index+1)%6,
      confidence_scores=jsonb_build_object('fall',(ARRAY[0.02,0.03,0.01,0.04,0.02,0.01]::numeric[])[sample_index+1],
      'non_fall',1-(ARRAY[0.02,0.03,0.01,0.04,0.02,0.01]::numeric[])[sample_index+1])
      FROM public.rooms r WHERE r.id=s.room_id AND r.facility_id=$1 AND r.id<>'101' AND s.mode='healthy'
      AND (s.sampled_at IS NULL OR s.sampled_at<clock_timestamp()-interval '9 seconds')
      AND NOT EXISTS(SELECT 1 FROM public.devices d JOIN public.device_credentials dc ON dc.device_id=d.id WHERE d.room_id=r.id AND dc.revoked_at IS NULL)
      RETURNING s.room_id`,
        [facility],
      )
    ).rows;
  });
}
export function startDemoStreams(
  pool: Pool,
  facility: string,
  log: FastifyBaseLogger,
) {
  let running: Promise<unknown> | undefined;
  const tick = () => {
    if (!running)
      running = tickDemoStreams(pool, facility)
        .catch(() =>
          log.error(
            { code: "demo_stream_failed" },
            "Synthetic feed tick failed",
          ),
        )
        .finally(() => {
          running = undefined;
        });
  };
  tick();
  const timer = setInterval(tick, 10_000);
  return {
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
