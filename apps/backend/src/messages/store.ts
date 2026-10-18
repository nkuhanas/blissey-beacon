import type { Pool, PoolClient } from "pg";
import type {
  MessagePreviewRequest,
  MessageAuthorization,
  MessageReview,
  MessagingConsent,
  ReplyReview,
} from "@blissey/contracts";
import { withTransaction } from "../db.js";
import { assigned, bump, incident, member } from "../notifications/access.js";
import { CallError, digest } from "../notifications/policy.js";
import { messageCandidates, replyIntent, selectFollowup } from "./policy.js";
import type { MessageRoute, PhotonMessage } from "./photon.js";
export async function cancelMessages(c: PoolClient, contactId: string) {
  const changed = await c.query(
    "UPDATE public.message_authorizations SET state='cancelled',updated_at=now() WHERE contact_id=$1 AND state IN ('waiting','review','queued') RETURNING incident_id",
    [contactId],
  );
  await c.query(
    "UPDATE public.notification_messages SET state='cancelled',error_code='contact_changed',updated_at=now() WHERE contact_id=$1 AND state='queued'",
    [contactId],
  );
  for (const row of changed.rows) await bump(c, row.incident_id);
}
async function contactFor(
  c: PoolClient,
  subject: string,
  id: string,
  contactId: string,
  revision?: number,
) {
  const i = await incident(c, subject, id);
  if (revision !== undefined && i.revision !== revision)
    throw new CallError("incident_revision_conflict");
  const contact = (
    await c.query(
      "SELECT * FROM public.family_contacts WHERE id=$1 AND facility_id=$2 FOR UPDATE",
      [contactId, i.facility_id],
    )
  ).rows[0];
  if (!contact) throw new CallError("contact_not_found", 404);
  if (contact.imessage_consent_status !== "granted")
    throw new CallError("messaging_consent_required");
  const resident = await assigned(c, i, contact.patient_id);
  return { i, contact, resident };
}
function previewHash(p: Record<string, unknown>) {
  return digest({
    ...(p.followup_policy === "automatic-v2"
      ? { followup_policy: p.followup_policy }
      : {}),
    candidates: p.candidates,
    route: p.route,
    contact_revision: p.contact_revision,
    incident_revision: p.incident_revision,
    purpose: p.purpose,
    incident_id: p.incident_id,
    contact_id: p.contact_id,
  });
}
export async function authorizeMessagePreview(
  c: PoolClient,
  subject: string,
  id: string,
  key: string,
  input: MessageAuthorization,
  call?: { id: string; contact_id: string },
) {
  const p = (
    await c.query(
      "SELECT * FROM public.message_previews WHERE id=$1 AND actor_id=$2 AND incident_id=$3 AND expires_at>now() FOR UPDATE",
      [input.preview_id, subject, id],
    )
  ).rows[0];
  if (
    !p ||
    previewHash(p) !== p.context_hash ||
    p.context_hash !== input.context_hash
  )
    throw new CallError("message_review_changed");
  if (
    (p.purpose === "followup") !== Boolean(call) ||
    (call && call.contact_id !== p.contact_id)
  )
    throw new CallError("message_call_mismatch");
  const { i } = await contactFor(
    c,
    subject,
    id,
    p.contact_id,
    input.expected_revision,
  );
  if (p.incident_revision !== i.revision)
    throw new CallError("message_review_changed");
  const contact = (
    await c.query(
      "SELECT revision,phone_e164 FROM public.family_contacts WHERE id=$1",
      [p.contact_id],
    )
  ).rows[0];
  if (
    contact.revision !== p.contact_revision ||
    contact.phone_e164 !== p.route.destination
  )
    throw new CallError("contact_changed");
  const a = (
    await c.query(
      `INSERT INTO public.message_authorizations(preview_id,incident_id,facility_id,contact_id,call_id,approved_by,request_key,request_hash,contact_revision,candidates,route,context_hash,state,selection)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        p.id,
        id,
        i.facility_id,
        p.contact_id,
        call?.id ?? null,
        subject,
        key,
        digest(input),
        p.contact_revision,
        p.candidates,
        p.route,
        p.context_hash,
        call ? "waiting" : "queued",
        call ? null : "update",
      ],
    )
  ).rows[0];
  await c.query(
    "INSERT INTO public.operator_audit(facility_id,actor_id,action,target_id,detail) VALUES($1,$2,'message_authorized',$3,$4)",
    [
      i.facility_id,
      subject,
      a.id,
      { context_hash: p.context_hash, call_id: call?.id ?? null },
    ],
  );
  if (!call) await queueSelected(c, a, "update");
  await bump(c, id);
  return a.id as string;
}
async function queueSelected(
  c: PoolClient,
  a: Record<string, unknown>,
  selection: "missed" | "summary" | "update",
) {
  const candidates = a.candidates as Record<string, string>;
  if (!candidates[selection]) throw new CallError("message_candidate_missing");
  await c.query(
    "UPDATE public.message_authorizations SET selection=$2,state='queued',updated_at=now() WHERE id=$1",
    [a.id, selection],
  );
  await c.query(
    "INSERT INTO public.notification_messages(authorization_id,incident_id,facility_id,contact_id,body,route) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(authorization_id) DO NOTHING",
    [
      a.id,
      a.incident_id,
      a.facility_id,
      a.contact_id,
      candidates[selection],
      a.route,
    ],
  );
  await c.query(
    "INSERT INTO public.message_poll_state(route_key,route,since_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [digest(a.route), a.route, a.created_at],
  );
}
export function createMessageStore(pool: Pool) {
  return {
    async consent(subject: string, id: string, input: MessagingConsent) {
      return withTransaction(pool, async (c) => {
        const contact = (
          await c.query(
            "SELECT * FROM public.family_contacts WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (!contact) throw new CallError("not_found", 404);
        await member(c, subject, contact.facility_id);
        if (contact.revision !== input.expected_revision)
          throw new CallError("contact_revision_conflict");
        const row = (
          await c.query(
            "UPDATE public.family_contacts SET imessage_consent_status=$2,imessage_consented_at=CASE WHEN $2='granted' THEN now() ELSE imessage_consented_at END,imessage_consent_revoked_at=CASE WHEN $2='revoked' THEN now() ELSE NULL END,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING id,revision,imessage_consent_status",
            [id, input.consent_status],
          )
        ).rows[0];
        await cancelMessages(c, id);
        const cancelled = await c.query(
          "UPDATE public.notification_calls SET transport_status='failed',error_code='contact_changed' WHERE contact_id=$1 AND transport_status='queued' RETURNING incident_id",
          [id],
        );
        for (const row of cancelled.rows) await bump(c, row.incident_id);
        await c.query(
          "INSERT INTO public.operator_audit(facility_id,actor_id,action,target_id,detail) VALUES($1,$2,'messaging_consent',$3,$4)",
          [
            contact.facility_id,
            subject,
            id,
            { status: input.consent_status, revision: row.revision },
          ],
        );
        return row;
      });
    },
    async destination(
      subject: string,
      id: string,
      input: MessagePreviewRequest,
    ) {
      return withTransaction(
        pool,
        async (c) =>
          (
            await contactFor(
              c,
              subject,
              id,
              input.contact_id,
              input.expected_revision,
            )
          ).contact.phone_e164 as string,
      );
    },
    async preview(
      subject: string,
      id: string,
      input: MessagePreviewRequest,
      route: MessageRoute,
    ) {
      return withTransaction(pool, async (c) => {
        const { i, contact } = await contactFor(
          c,
          subject,
          id,
          input.contact_id,
          input.expected_revision,
        );
        if (contact.phone_e164 !== route.destination)
          throw new CallError("contact_changed");
        if (!i.source) throw new CallError("explanation_not_ready");
        if (
          input.purpose === "update" &&
          (!input.update_text?.trim() ||
            input.verified_facts_confirmed !== true)
        )
          throw new CallError("verified_update_required", 400);
        if (input.staff_dispatch_confirmed && input.purpose !== "followup")
          throw new CallError("dispatch_confirmation_requires_followup", 400);
        const candidates =
          input.purpose === "followup"
            ? messageCandidates({
                staffDispatchConfirmed: input.staff_dispatch_confirmed === true,
              })
            : {
                update: `Blissey Beacon care update: ${input.update_text!.trim()}`,
              };
        const p = {
          followup_policy:
            input.purpose === "followup" ? "automatic-v2" : "manual-v1",
          candidates,
          route,
          contact_revision: contact.revision,
          incident_revision: i.revision,
          purpose: input.purpose,
          incident_id: id,
          contact_id: contact.id,
        };
        const hash = previewHash(p);
        const row = (
          await c.query(
            "INSERT INTO public.message_previews(actor_id,incident_id,facility_id,contact_id,incident_revision,contact_revision,purpose,candidates,route,context_hash,followup_policy) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,expires_at",
            [
              subject,
              id,
              i.facility_id,
              contact.id,
              i.revision,
              contact.revision,
              input.purpose,
              candidates,
              route,
              hash,
              p.followup_policy,
            ],
          )
        ).rows[0];
        if (input.staff_dispatch_confirmed)
          await c.query(
            "INSERT INTO public.operator_audit(facility_id,actor_id,action,target_id,detail) VALUES($1,$2,'staff_dispatch_confirmed',$3,$4)",
            [
              i.facility_id,
              subject,
              id,
              {
                preview_id: row.id,
                incident_revision: i.revision,
                staff_dispatch_confirmed: true,
              },
            ],
          );
        return {
          followup_policy: p.followup_policy,
          preview_id: row.id,
          expires_at: row.expires_at,
          context_hash: hash,
          expected_revision: i.revision,
          purpose: input.purpose,
          recipient: {
            id: contact.id,
            name: contact.contact_name,
            phone_e164: contact.phone_e164,
          },
          sender_number: route.sender_number,
          candidates,
        };
      });
    },
    async authorizeUpdate(
      subject: string,
      id: string,
      key: string,
      input: MessageAuthorization,
    ) {
      return withTransaction(pool, async (c) => {
        await c.query(
          "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
          [subject, "message:" + key],
        );
        const previous = (
          await c.query(
            "SELECT * FROM public.message_authorizations WHERE approved_by=$1 AND request_key=$2",
            [subject, key],
          )
        ).rows[0];
        if (previous) {
          await member(c, subject, previous.facility_id);
          if (
            previous.incident_id !== id ||
            previous.request_hash !== digest(input)
          )
            throw new CallError("idempotency_conflict");
          return previous.id as string;
        }
        return authorizeMessagePreview(c, subject, id, key, input);
      });
    },
    async review(subject: string, authId: string, input: MessageReview) {
      return withTransaction(pool, async (c) => {
        const a = (
          await c.query(
            "SELECT * FROM public.message_authorizations WHERE id=$1 FOR UPDATE",
            [authId],
          )
        ).rows[0];
        if (!a) throw new CallError("not_found", 404);
        await contactFor(
          c,
          subject,
          a.incident_id,
          a.contact_id,
          input.expected_revision,
        );
        if (!["waiting", "review"].includes(a.state))
          throw new CallError("message_already_selected");
        const call = (
          await c.query(
            "SELECT transport_status FROM public.notification_calls WHERE id=$1",
            [a.call_id],
          )
        ).rows[0];
        if (
          !call ||
          !["completed", "failed", "unknown"].includes(call.transport_status)
        )
          throw new CallError("call_not_finished");
        const selection = selectFollowup(
          input.evidence,
          input.recipient_verified,
        );
        if (selection === "review")
          throw new CallError("verified_recipient_required");
        await c.query(
          "UPDATE public.message_authorizations SET evidence=$2 WHERE id=$1",
          [a.id, "operator:" + input.evidence],
        );
        await queueSelected(c, a, selection);
        await c.query(
          "INSERT INTO public.operator_audit(facility_id,actor_id,action,target_id,detail) VALUES($1,$2,'message_outcome_reviewed',$3,$4)",
          [
            a.facility_id,
            subject,
            a.id,
            {
              evidence: input.evidence,
              recipient_verified: input.recipient_verified,
              note: input.note,
            },
          ],
        );
        await bump(c, a.incident_id);
        return { authorization_id: a.id, selection };
      });
    },
    async selectReady() {
      return withTransaction(pool, async (c) => {
        const rows = (
          await c.query(
            `SELECT a.*,p.followup_policy,n.transport_status,n.error_code,n.connected,n.notification_spoken,n.attempt_id,
              (SELECT e.normalized FROM public.notification_provider_events e WHERE e.call_id=n.id ORDER BY e.received_at DESC LIMIT 1) AS report
              FROM public.message_authorizations a JOIN public.message_previews p ON p.id=a.preview_id JOIN public.notification_calls n ON n.id=a.call_id
              WHERE a.state='waiting' AND n.transport_status IN ('completed','failed','unknown') AND (n.transport_status<>'unknown' OR p.followup_policy<>'automatic-v2' OR n.submitted_at<clock_timestamp()-interval '7 minutes') ORDER BY a.created_at LIMIT 20 FOR UPDATE OF a SKIP LOCKED`,
          )
        ).rows;
        for (const a of rows) {
          const automatic = a.followup_policy === "automatic-v2";
          if (automatic && !a.attempt_id) {
            await c.query(
              "UPDATE public.message_authorizations SET state='cancelled',evidence='call:not_submitted',updated_at=now() WHERE id=$1",
              [a.id],
            );
            await bump(c, a.incident_id);
            continue;
          }
          const evidence =
            a.transport_status === "failed" &&
            ["busy", "no-answer"].includes(a.error_code)
              ? a.error_code === "busy"
                ? "busy"
                : "no_answer"
              : automatic &&
                  a.report?.outcome === "communicated" &&
                  a.report?.recipientVerified === true
                ? "communicated"
                : "unknown";
          const selection = automatic
            ? evidence === "communicated"
              ? "summary"
              : "missed"
            : selectFollowup(evidence, false);
          if (selection === "review")
            await c.query(
              "UPDATE public.message_authorizations SET state='review',evidence='provider:unknown',updated_at=now() WHERE id=$1",
              [a.id],
            );
          else {
            await c.query(
              "UPDATE public.message_authorizations SET evidence=$2 WHERE id=$1",
              [a.id, (automatic ? "automatic:" : "provider:") + evidence],
            );
            await queueSelected(c, a, selection);
          }
          await bump(c, a.incident_id);
        }
      });
    },
    async history(subject: string, id: string) {
      return withTransaction(pool, async (c) => {
        await incident(c, subject, id);
        return {
          authorizations: (
            await c.query(
              "SELECT id,call_id,state,selection,evidence,created_at,updated_at FROM public.message_authorizations WHERE incident_id=$1 ORDER BY created_at DESC LIMIT 100",
              [id],
            )
          ).rows,
          messages: (
            await c.query(
              "SELECT id,authorization_id,body,state,error_code,created_at,updated_at FROM public.notification_messages WHERE incident_id=$1 ORDER BY created_at DESC LIMIT 100",
              [id],
            )
          ).rows,
          replies: (
            await c.query(
              "SELECT id,incident_id,contact_id,body,intent,review_status,received_at FROM public.family_replies WHERE incident_id=$1 ORDER BY received_at DESC LIMIT 100",
              [id],
            )
          ).rows,
        };
      });
    },
    async inbox(subject: string, facility: string) {
      return withTransaction(pool, async (c) => {
        await member(c, subject, facility);
        return (
          await c.query(
            "SELECT id,incident_id,contact_id,body,intent,review_status,received_at FROM public.family_replies WHERE facility_id=$1 ORDER BY received_at DESC LIMIT 100",
            [facility],
          )
        ).rows;
      });
    },
    async reviewReply(subject: string, id: string, input: ReplyReview) {
      return withTransaction(pool, async (c) => {
        const r = (
          await c.query(
            "SELECT * FROM public.family_replies WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (!r) throw new CallError("not_found", 404);
        await member(c, subject, r.facility_id);
        const incidentId = input.incident_id ?? r.incident_id;
        if (incidentId) {
          await incident(c, subject, incidentId);
          const match = (
            await c.query(
              "SELECT 1 FROM public.notification_messages WHERE incident_id=$1 AND facility_id=$2 AND contact_id=$3 AND route->>'space_id'=$4",
              [incidentId, r.facility_id, r.contact_id, r.space_id],
            )
          ).rowCount;
          if (!match || (r.incident_id && r.incident_id !== incidentId))
            throw new CallError("reply_incident_mismatch");
        }
        if (r.intent === "stop" && input.intent)
          throw new CallError("stop_cannot_be_reclassified");
        await c.query(
          "UPDATE public.family_replies SET incident_id=$2,intent=COALESCE($3,intent),review_status='reviewed' WHERE id=$1",
          [id, incidentId, input.intent ?? null],
        );
        await c.query(
          "INSERT INTO public.operator_audit(facility_id,actor_id,action,target_id,detail) VALUES($1,$2,'family_reply_reviewed',$3,$4)",
          [
            r.facility_id,
            subject,
            id,
            { incident_id: incidentId, intent: input.intent ?? r.intent },
          ],
        );
        if (incidentId) await bump(c, incidentId);
        return { reviewed: true };
      });
    },
    async receive(c: PoolClient, route: MessageRoute, m: PhotonMessage) {
      if (
        m.status !== "received" ||
        m.senderId !== route.recipient_id ||
        m.recipientId !== route.sender_id ||
        m.spaceId !== route.space_id ||
        !m.text
      )
        return;
      let parents = (
        await c.query(
          "SELECT DISTINCT incident_id,facility_id,contact_id FROM public.notification_messages WHERE route->>'space_id'=$1 AND route->>'sender_id'=$2 AND route->>'recipient_id'=$3 AND created_at<=$4 AND ($5::text IS NULL OR provider_message_id=$5)",
          [
            route.space_id,
            route.sender_id,
            route.recipient_id,
            m.createdAt,
            m.parentId,
          ],
        )
      ).rows;
      let unmatchedParent = false;
      if (!parents.length && m.parentId) {
        parents = (
          await c.query(
            "SELECT DISTINCT incident_id,facility_id,contact_id FROM public.notification_messages WHERE route->>'space_id'=$1 AND route->>'sender_id'=$2 AND route->>'recipient_id'=$3 AND created_at<=$4",
            [route.space_id, route.sender_id, route.recipient_id, m.createdAt],
          )
        ).rows;
        unmatchedParent = true;
      }
      if (!parents.length) return;
      // The same recipient can belong to several facilities. Do not disclose or guess across them.
      if (
        new Set(parents.map((p) => p.facility_id + ":" + p.contact_id)).size !==
        1
      )
        return;
      const parent = parents[0],
        incidentId =
          !unmatchedParent && parents.length === 1 ? parent.incident_id : null,
        intent = replyIntent(m.text);
      const inserted = await c.query(
        "INSERT INTO public.family_replies(provider_message_id,facility_id,contact_id,incident_id,space_id,sender_id,recipient_id,body,intent,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(provider_message_id) DO NOTHING",
        [
          m.id,
          parent.facility_id,
          parent.contact_id,
          incidentId,
          m.spaceId,
          m.senderId,
          m.recipientId,
          m.text,
          intent,
          m.createdAt,
        ],
      );
      if (!inserted.rowCount) return;
      if (intent === "stop") {
        await c.query(
          "UPDATE public.family_contacts SET imessage_consent_status='revoked',imessage_consent_revoked_at=now(),revision=revision+1,updated_at=now() WHERE id=$1",
          [parent.contact_id],
        );
        await cancelMessages(c, parent.contact_id);
      }
      for (const p of parents) await bump(c, p.incident_id);
    },
  };
}
export type MessageStore = ReturnType<typeof createMessageStore>;
