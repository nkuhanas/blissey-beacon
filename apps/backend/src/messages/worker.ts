import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../db.js";
import { assigned, bump, member } from "../notifications/access.js";
import { CallError, digest } from "../notifications/policy.js";
import { createMessageStore } from "./store.js";
import type {
  MessageProvider,
  MessageRoute,
  MessageResult,
  PhotonMessage,
} from "./photon.js";
interface Work {
  id: string;
  incident_id: string;
  body: string;
  route: MessageRoute;
}
async function valid(c: PoolClient, id: string) {
  const row = (
    await c.query(
      "SELECT m.*,a.approved_by,a.contact_revision,a.candidates,a.selection,a.context_hash,a.evidence,a.call_id,p.incident_revision,p.purpose,p.followup_policy,p.incident_id AS preview_incident,p.contact_id AS preview_contact,a.created_at AS approved_at FROM public.notification_messages m JOIN public.message_authorizations a ON a.id=m.authorization_id JOIN public.message_previews p ON p.id=a.preview_id WHERE m.id=$1 FOR UPDATE OF m",
      [id],
    )
  ).rows[0];
  if (!row || !["queued", "initiating"].includes(row.state)) return false;
  const contact = (
    await c.query(
      "SELECT * FROM public.family_contacts WHERE id=$1 FOR SHARE",
      [row.contact_id],
    )
  ).rows[0];
  const i = (
    await c.query(
      "SELECT i.*,e.detected_at FROM public.incidents i JOIN public.inference_events e ON e.event_id=i.event_id WHERE i.id=$1",
      [row.incident_id],
    )
  ).rows[0];
  try {
    await member(c, row.approved_by, row.facility_id);
    if (
      !contact ||
      contact.imessage_consent_status !== "granted" ||
      contact.revision !== row.contact_revision ||
      contact.phone_e164 !== row.route.destination ||
      contact.facility_id !== row.facility_id ||
      !i
    )
      return false;
    await assigned(c, i, contact.patient_id);
    if (
      typeof row.evidence === "string" &&
      row.evidence.startsWith("provider:")
    ) {
      const call = (
        await c.query(
          "SELECT transport_status,error_code FROM public.notification_calls WHERE id=$1",
          [row.call_id],
        )
      ).rows[0];
      const reason =
        row.evidence === "provider:no_answer" ? "no-answer" : "busy";
      if (
        !call ||
        call.transport_status !== "failed" ||
        call.error_code !== reason
      )
        return false;
    }
    if (row.followup_policy === "automatic-v2" && row.selection === "summary") {
      const report = (
        await c.query(
          "SELECT normalized FROM public.notification_provider_events WHERE call_id=$1 ORDER BY received_at DESC LIMIT 1",
          [row.call_id],
        )
      ).rows[0]?.normalized;
      if (
        report?.outcome !== "communicated" ||
        report?.recipientVerified !== true
      )
        return false;
    }
    const hash = digest({
      ...(row.followup_policy === "automatic-v2"
        ? { followup_policy: row.followup_policy }
        : {}),
      candidates: row.candidates,
      route: row.route,
      contact_revision: row.contact_revision,
      incident_revision: row.incident_revision,
      purpose: row.purpose,
      incident_id: row.preview_incident,
      contact_id: row.preview_contact,
    });
    return (
      hash === row.context_hash &&
      row.body === row.candidates[row.selection] &&
      Date.now() - row.approved_at.getTime() < 24 * 60 * 60 * 1000
    );
  } catch (e) {
    if (e instanceof CallError) return false;
    throw e;
  }
}
export function createMessageDispatch(pool: Pool) {
  const messages = createMessageStore(pool);
  return {
    async claim(): Promise<Work | null> {
      return withTransaction(pool, async (c) => {
        const expired = await c.query(
          "UPDATE public.notification_messages SET state='unknown',error_code='submission_interrupted',updated_at=now() WHERE state='initiating' AND submitted_at<clock_timestamp()-interval '1 minute' RETURNING id,incident_id",
        );
        for (const row of expired.rows) {
          await c.query(
            "UPDATE public.message_attempts SET state='unknown' WHERE message_id=$1",
            [row.id],
          );
          await bump(c, row.incident_id);
        }
        const m = (
          await c.query(
            "SELECT * FROM public.notification_messages WHERE state='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
          )
        ).rows[0];
        if (!m) return null;
        if (!(await valid(c, m.id))) {
          await c.query(
            "UPDATE public.notification_messages SET state='cancelled',error_code='authorization_no_longer_valid',updated_at=now() WHERE id=$1",
            [m.id],
          );
          await bump(c, m.incident_id);
          return null;
        }
        await c.query(
          "INSERT INTO public.message_attempts(message_id,state) VALUES($1,'initiating')",
          [m.id],
        );
        await c.query(
          "UPDATE public.notification_messages SET state='initiating',submitted_at=now(),updated_at=now() WHERE id=$1",
          [m.id],
        );
        await bump(c, m.incident_id);
        return {
          id: m.id,
          incident_id: m.incident_id,
          body: m.body,
          route: m.route,
        };
      });
    },
    async validate(id: string) {
      return withTransaction(pool, (c) => valid(c, id));
    },
    async settle(work: Work, result: MessageResult) {
      return withTransaction(pool, async (c) => {
        await c.query(
          "UPDATE public.notification_messages SET state=$2,provider_message_id=$3,error_code=$4,updated_at=now() WHERE id=$1 AND state IN ('initiating','unknown')",
          [
            work.id,
            result.state,
            result.providerId ?? null,
            result.code ?? null,
          ],
        );
        await c.query(
          "UPDATE public.message_attempts SET state=$2 WHERE message_id=$1",
          [work.id, result.state],
        );
        await c.query(
          "UPDATE public.message_authorizations SET state='submitted',updated_at=now() WHERE id=(SELECT authorization_id FROM public.notification_messages WHERE id=$1)",
          [work.id],
        );
        await bump(c, work.incident_id);
      });
    },
    async reconcile(provider: MessageProvider, signal: AbortSignal) {
      const rows = (
        await pool.query(
          "SELECT id,incident_id,provider_message_id,body,route FROM public.notification_messages WHERE provider_message_id IS NOT NULL AND state IN ('accepted','unknown','delivered') ORDER BY updated_at LIMIT 20",
        )
      ).rows;
      for (const row of rows) {
        const m = await provider.get(
          row.provider_message_id,
          row.route,
          signal,
        );
        if (m.text !== row.body)
          throw new CallError("photon_message_content_mismatch");
        await withTransaction(pool, async (c) => {
          // Preserve stronger evidence if polls overlap or provider views lag.
          const ranks: Record<string, number> = {
            accepted: 1,
            delivered: 2,
            read: 3,
          };
          const next = ["delivered", "read", "failed"].includes(m.status)
            ? m.status
            : "accepted";
          const old = (
            await c.query(
              "SELECT state FROM public.notification_messages WHERE id=$1 FOR UPDATE",
              [row.id],
            )
          ).rows[0];
          if (
            old &&
            old.state !== next &&
            (next === "failed"
              ? !(old.state in ranks) || old.state === "accepted"
              : (ranks[next] ?? 0) > (ranks[old.state] ?? 0))
          ) {
            await c.query(
              "UPDATE public.notification_messages SET state=$2,updated_at=now() WHERE id=$1",
              [row.id, next],
            );
            await bump(c, row.incident_id);
          }
        });
      }
    },
    async poll(provider: MessageProvider, signal: AbortSignal) {
      const lease = randomUUID();
      const work = await withTransaction(pool, async (c) => {
        const row = (
          await c.query(
            "SELECT * FROM public.message_poll_state WHERE lease_until IS NULL OR lease_until<now() ORDER BY lease_until NULLS FIRST LIMIT 1 FOR UPDATE SKIP LOCKED",
          )
        ).rows[0];
        if (!row) return null;
        await c.query(
          "UPDATE public.message_poll_state SET lease_id=$2,lease_until=now()+interval '30 seconds' WHERE route_key=$1",
          [row.route_key, lease],
        );
        return row;
      });
      if (!work) return;
      try {
        const page = await provider.replies(
          work.route,
          work.since_at.toISOString(),
          work.page_token,
          signal,
        );
        await withTransaction(pool, async (c) => {
          const row = (
            await c.query(
              "SELECT * FROM public.message_poll_state WHERE route_key=$1 AND lease_id=$2 FOR UPDATE",
              [work.route_key, lease],
            )
          ).rows[0];
          if (!row) return;
          for (const m of page.items) await messages.receive(c, work.route, m);
          // Restart completed scans from the durable original start. Eventual consistency
          // cannot strand a late reply behind an advancing timestamp watermark.
          await c.query(
            "UPDATE public.message_poll_state SET page_token=$2,lease_until=now()+interval '10 seconds',lease_id=NULL WHERE route_key=$1",
            [work.route_key, page.next],
          );
        });
      } catch (e) {
        await pool.query(
          "UPDATE public.message_poll_state SET lease_id=NULL,lease_until=now()+interval '10 seconds' WHERE route_key=$1 AND lease_id=$2",
          [work.route_key, lease],
        );
        // Invalid/expired page tokens restart the bounded scan; durable reply IDs deduplicate.
        if (e instanceof CallError && e.code === "photon_http_400")
          await pool.query(
            "UPDATE public.message_poll_state SET page_token=NULL WHERE route_key=$1",
            [work.route_key],
          );
        throw e;
      }
    },
  };
}
export async function runMessageOnce(
  dispatch: ReturnType<typeof createMessageDispatch>,
  provider: MessageProvider,
  signal: AbortSignal,
) {
  if (signal.aborted) return false;
  const work = await dispatch.claim();
  if (!work) return false;
  let result: MessageResult;
  try {
    const current = await provider.resolve(work.route.destination, signal);
    if (digest(current) !== digest(work.route))
      result = { state: "failed", code: "imessage_assignment_changed" };
    else if (!(await dispatch.validate(work.id)))
      result = { state: "failed", code: "authorization_no_longer_valid" };
    else {
      try {
        result = await provider.send(work.id, work.body, work.route, signal);
      } catch {
        result = { state: "unknown", code: "photon_submission_interrupted" };
      }
    }
  } catch (e) {
    result = {
      state: "failed",
      code: e instanceof CallError ? e.code : "imessage_preflight_failed",
    };
  }
  await dispatch.settle(work, result);
  return true;
}
export function startMessageWorker(
  pool: Pool,
  provider: MessageProvider,
  log: { error: (fields: { code: string }, message: string) => void },
  recover?: (signal: AbortSignal) => Promise<unknown>,
) {
  const controller = new AbortController(),
    store = createMessageStore(pool),
    dispatch = createMessageDispatch(pool);
  const running = (async () => {
    while (!controller.signal.aborted) {
      try {
        if (recover) await recover(controller.signal);
        await store.selectReady();
        await runMessageOnce(dispatch, provider, controller.signal);
      } catch {
        log.error(
          { code: "message_dispatch_error" },
          "Message processing failed; uncertain submissions are not resent",
        );
      }
      try {
        await dispatch.reconcile(provider, controller.signal);
      } catch {
        log.error(
          { code: "message_reconcile_error" },
          "Message evidence could not be refreshed",
        );
      }
      try {
        await dispatch.poll(provider, controller.signal);
      } catch {
        log.error(
          { code: "message_reply_poll_error" },
          "Family reply polling failed; durable checkpoint retained",
        );
      }
      if (!controller.signal.aborted)
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
// Exported for integration fixtures without provider payload persistence.
export type { PhotonMessage };
