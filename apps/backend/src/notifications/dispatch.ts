import { validateFamilyCallContext } from "@blissey/contracts";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../db.js";
import { POLICY_VERSION, POLICY, digest } from "./policy.js";
import type {
  Submission,
  SubmissionResult,
  SubmitCall,
  ProviderEvent,
} from "./provider.js";
async function bump(c: PoolClient, id: string) {
  await c.query("UPDATE public.incidents SET revision=revision+1 WHERE id=$1", [
    id,
  ]);
}
async function reconcile(
  c: PoolClient,
  callId: string,
  conversationId: string,
) {
  const events = (
    await c.query(
      "SELECT * FROM public.notification_provider_events WHERE conversation_id=$1 AND call_id IS NULL ORDER BY received_at,event_hash FOR UPDATE",
      [conversationId],
    )
  ).rows;
  for (const row of events) {
    const e = row.normalized as ProviderEvent;
    // Ended sessions take precedence over failure callbacks; never undo spoken evidence.
    await c.query(
      `UPDATE public.notification_calls SET transport_status=CASE WHEN transport_status='completed' THEN 'completed' ELSE $2 END,
    callback_requested=callback_requested OR $3,error_code=CASE WHEN transport_status='completed' OR $2='completed' THEN NULL ELSE $4 END,updated_at=now() WHERE id=$1`,
      [callId, e.kind, e.callbackRequested, e.failureCode],
    );
    await c.query(
      "UPDATE public.notification_provider_events SET call_id=$2 WHERE event_hash=$1",
      [row.event_hash, callId],
    );
    await bump(
      c,
      (
        await c.query(
          "SELECT incident_id FROM public.notification_calls WHERE id=$1",
          [callId],
        )
      ).rows[0].incident_id,
    );
  }
}
export function createDispatchStore(pool: Pool) {
  return {
    async claim(): Promise<Submission | null> {
      return withTransaction(pool, async (c) => {
        const expired = await c.query(
          "UPDATE public.notification_calls SET transport_status='unknown',error_code='submission_interrupted',updated_at=now() WHERE transport_status='initiating' AND provider_conversation_id IS NULL AND submitted_at<clock_timestamp()-interval '30 seconds' RETURNING incident_id,attempt_id",
        );
        for (const row of expired.rows) {
          await c.query(
            "UPDATE public.notification_attempts SET state='unknown',updated_at=now() WHERE id=$1",
            [row.attempt_id],
          );
          await bump(c, row.incident_id);
        }
        const n = (
          await c.query(
            "SELECT n.*,p.incident_revision,p.patient_id AS approved_patient FROM public.notification_calls n JOIN public.call_previews p ON p.id=n.preview_id WHERE n.transport_status='queued' ORDER BY n.created_at LIMIT 1 FOR UPDATE OF n SKIP LOCKED",
          )
        ).rows[0];
        if (!n) return null;
        const contact = (
          await c.query(
            "SELECT * FROM public.family_contacts WHERE id=$1 FOR SHARE",
            [n.contact_id],
          )
        ).rows[0];
        const membership = (
          await c.query(
            "SELECT 1 FROM public.facility_memberships WHERE user_id=$1 AND facility_id=$2 FOR SHARE",
            [n.approved_by, n.facility_id],
          )
        ).rowCount;
        const historic = (
          await c.query(
            `SELECT a.patient_id FROM public.room_assignments a JOIN public.incidents i ON i.room_id=a.room_id JOIN public.inference_events e ON e.event_id=i.event_id
   WHERE i.id=$1 AND a.facility_id=i.facility_id AND a.assigned_at<=e.detected_at AND (a.released_at IS NULL OR a.released_at>e.detected_at) FOR SHARE OF a`,
            [n.incident_id],
          )
        ).rows;
        if (
          !validateFamilyCallContext(n.context) ||
          digest({
            context: n.context,
            opening: n.opening,
            policy_version: n.policy_version,
            policy: POLICY,
            contact_revision: n.contact_revision,
            destination: n.destination,
            incident_revision: n.incident_revision,
          }) !== n.context_hash ||
          !membership ||
          !contact ||
          contact.consent_status !== "granted" ||
          contact.revision !== n.contact_revision ||
          historic.length !== 1 ||
          historic[0].patient_id !== contact.patient_id ||
          historic[0].patient_id !== n.approved_patient ||
          n.policy_version !== POLICY_VERSION ||
          Date.now() - n.created_at.getTime() > 10 * 60 * 1000
        ) {
          await c.query(
            "UPDATE public.notification_calls SET transport_status='failed',error_code='authorization_no_longer_valid',updated_at=now() WHERE id=$1",
            [n.id],
          );
          await bump(c, n.incident_id);
          return null;
        }
        const attemptId = randomUUID();
        await c.query(
          "INSERT INTO public.notification_attempts(id,call_id,state) VALUES($1,$2,'initiating')",
          [attemptId, n.id],
        );
        await c.query(
          "UPDATE public.notification_calls SET transport_status='initiating',attempt_id=$2,submitted_at=now(),updated_at=now() WHERE id=$1",
          [n.id, attemptId],
        );
        await bump(c, n.incident_id);
        return {
          callId: n.id,
          attemptId,
          destination: n.destination,
          context: n.context,
          opening: n.opening,
          policyVersion: n.policy_version,
        };
      });
    },
    async settle(input: Submission, result: SubmissionResult) {
      return withTransaction(pool, async (c) => {
        if (result.conversationId)
          await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            result.conversationId,
          ]);
        const n = (
          await c.query(
            "SELECT * FROM public.notification_calls WHERE id=$1 AND attempt_id=$2 FOR UPDATE",
            [input.callId, input.attemptId],
          )
        ).rows[0];
        if (!n) return;
        if (
          n.provider_conversation_id &&
          result.conversationId &&
          n.provider_conversation_id !== result.conversationId
        )
          throw Error("Call identity conflict");
        await c.query(
          `UPDATE public.notification_calls SET provider_conversation_id=COALESCE(provider_conversation_id,$2),provider_sip_call_id=COALESCE(provider_sip_call_id,$3),
   transport_status=CASE WHEN transport_status IN ('completed','failed') THEN transport_status ELSE $4 END,error_code=$5,updated_at=now() WHERE id=$1`,
          [
            input.callId,
            result.conversationId ?? null,
            result.sipCallId ?? null,
            result.state === "accepted" ? "initiating" : result.state,
            result.code ?? null,
          ],
        );
        await c.query(
          "UPDATE public.notification_attempts SET state=$2,updated_at=now() WHERE id=$1",
          [input.attemptId, result.state],
        );
        if (result.conversationId)
          await reconcile(c, input.callId, result.conversationId);
        await bump(c, n.incident_id);
      });
    },
    async event(hash: string, event: ProviderEvent) {
      return withTransaction(pool, async (c) => {
        // Share the conversation lock with submission correlation, including orphan events.
        await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          event.conversationId,
        ]);
        const r = await c.query(
          "INSERT INTO public.notification_provider_events(event_hash,conversation_id,kind,normalized) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [hash, event.conversationId, event.kind, event],
        );
        if (!r.rowCount) return;
        const n = (
          await c.query(
            "SELECT * FROM public.notification_calls WHERE provider_conversation_id=$1 FOR UPDATE",
            [event.conversationId],
          )
        ).rows[0];
        if (n) await reconcile(c, n.id, event.conversationId);
      });
    },
  };
}
export type DispatchStore = ReturnType<typeof createDispatchStore>;
export async function runCallOnce(
  store: DispatchStore,
  submit: SubmitCall,
  signal: AbortSignal,
) {
  if (signal.aborted) return false;
  const call = await store.claim();
  if (!call) return false;
  let result: SubmissionResult;
  try {
    result = await submit(call, signal);
  } catch {
    result = { state: "unknown", code: "submission_interrupted" };
  }
  await store.settle(call, result);
  return true;
}
export function startCallWorker(
  store: DispatchStore,
  submit: SubmitCall,
  log: { error: (fields: { code: string }, message: string) => void },
) {
  const controller = new AbortController();
  const running = (async () => {
    while (!controller.signal.aborted) {
      let worked = false;
      try {
        worked = await runCallOnce(store, submit, controller.signal);
      } catch {
        log.error(
          { code: "call_worker_error" },
          "Call processing failed; uncertain submissions are not redialed",
        );
      }
      if (!worked && !controller.signal.aborted)
        try {
          await delay(1000, undefined, { signal: controller.signal });
        } catch {
          /* shutdown */
        }
    }
  })();
  return {
    async stop() {
      controller.abort();
      await running;
    },
  };
}
