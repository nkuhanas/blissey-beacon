import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { withTransaction } from "../db.js";
import { digest } from "./policy.js";
import { normalizeProviderResult, type ProviderEvent } from "./provider.js";
import type { DispatchStore } from "./dispatch.js";
export type LookupCall = (
  id: string,
  signal: AbortSignal,
  allowProcessing?: boolean,
) => Promise<ProviderEvent | null>;
export function createCallLookup(options: {
  apiKey: string;
  agentId: string;
  fetcher?: typeof fetch;
}): LookupCall {
  return async (id, signal, allowProcessing = false) => {
    const response = await (options.fetcher ?? fetch)(
      `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(id)}`,
      {
        headers: { "xi-api-key": options.apiKey },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const reader = response.body?.getReader();
    if (!reader) return null;
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 262144) {
        await reader.cancel();
        return null;
      }
      parts.push(part.value);
    }
    const data: unknown = JSON.parse(Buffer.concat(parts).toString());
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const value = data as Record<string, unknown>;
    if (
      value.agent_id !== options.agentId ||
      value.conversation_id !== id ||
      !(
        ["done", "failed"].includes(String(value.status)) ||
        (allowProcessing &&
          value.status === "processing" &&
          typeof (value.metadata as Record<string, unknown> | undefined)
            ?.termination_reason === "string" &&
          !!(value.metadata as Record<string, unknown>).termination_reason)
      )
    )
      return null;
    return normalizeProviderResult(
      value,
      value.status === "failed" ? "failed" : "completed",
    );
  };
}
export async function recoverCallOnce(
  pool: Pool,
  dispatch: DispatchStore,
  lookup: LookupCall,
  signal: AbortSignal,
) {
  const lease = randomUUID();
  const work = await withTransaction(pool, async (c) => {
    // Only new, explicitly automatic approvals can be recovered or timed out here.
    const expired =
      await c.query(`UPDATE public.notification_calls n SET transport_status='unknown',error_code='provider_result_timeout',updated_at=now()
   WHERE n.transport_status IN ('initiating','in_progress') AND n.submitted_at<clock_timestamp()-interval '7 minutes'
   AND EXISTS(SELECT 1 FROM public.message_authorizations a JOIN public.message_previews p ON p.id=a.preview_id WHERE a.call_id=n.id AND a.state='waiting' AND p.followup_policy IN ('automatic-v2','automatic-v3')) RETURNING incident_id`);
    for (const row of expired.rows)
      await c.query(
        "UPDATE public.incidents SET revision=revision+1 WHERE id=$1",
        [row.incident_id],
      );
    await c.query(`INSERT INTO public.call_recovery(call_id) SELECT n.id FROM public.notification_calls n
   JOIN public.message_authorizations a ON a.call_id=n.id JOIN public.message_previews p ON p.id=a.preview_id
   WHERE p.followup_policy IN ('automatic-v2','automatic-v3') AND a.state='waiting' AND n.provider_conversation_id IS NOT NULL
   AND n.transport_status IN ('initiating','in_progress','unknown') AND n.submitted_at<clock_timestamp()-CASE WHEN p.followup_policy='automatic-v3' THEN interval '10 seconds' ELSE interval '30 seconds' END ON CONFLICT DO NOTHING`);
    const row = (
      await c.query(`SELECT r.call_id,n.provider_conversation_id,p.followup_policy FROM public.call_recovery r JOIN public.notification_calls n ON n.id=r.call_id
   JOIN public.message_authorizations a ON a.call_id=n.id JOIN public.message_previews p ON p.id=a.preview_id WHERE a.state='waiting' AND n.transport_status IN ('initiating','in_progress','unknown')
   AND r.attempts<CASE WHEN p.followup_policy='automatic-v3' THEN 42 ELSE 10 END AND r.next_attempt_at<=now() AND (r.lease_until IS NULL OR r.lease_until<now()) ORDER BY r.next_attempt_at LIMIT 1 FOR UPDATE OF r SKIP LOCKED`)
    ).rows[0];
    if (!row) return null;
    await c.query(
      "UPDATE public.call_recovery SET lease_id=$2,lease_until=now()+interval '15 seconds',attempts=attempts+1,next_attempt_at=now()+CASE WHEN $3::boolean THEN interval '10 seconds' ELSE interval '30 seconds' END WHERE call_id=$1",
      [row.call_id, lease, row.followup_policy === "automatic-v3"],
    );
    return row;
  });
  if (!work) return false;
  try {
    const event = await lookup(
      work.provider_conversation_id,
      signal,
      work.followup_policy === "automatic-v3",
    );
    if (event && event.conversationId === work.provider_conversation_id)
      await dispatch.event(digest({ provider_readback: event }), event);
  } finally {
    await pool.query(
      "UPDATE public.call_recovery SET lease_until=NULL WHERE call_id=$1 AND lease_id=$2",
      [work.call_id, lease],
    );
  }
  return true;
}
