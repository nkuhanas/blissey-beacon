import type { Pool, PoolClient } from "pg";
import type {
  CallAuthorization,
  FamilyContactInput,
  IncidentAction,
  NotificationCall,
} from "@blissey/contracts";
import { withTransaction } from "../db.js";
import {
  CallError,
  digest,
  familyContext,
  POLICY,
  POLICY_VERSION,
} from "./policy.js";
const contactProjection =
  "id,facility_id,patient_id,contact_name,relationship,phone_e164,consent_status,revision,consented_at,consent_revoked_at";
async function member(c: PoolClient, subject: string, facility: string) {
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
async function incident(c: PoolClient, subject: string, id: string) {
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
async function assigned(
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
async function bump(c: PoolClient, id: string) {
  await c.query("UPDATE public.incidents SET revision=revision+1 WHERE id=$1", [
    id,
  ]);
}
function callDto(row: Record<string, unknown>): NotificationCall {
  return {
    id: row.id as string,
    incident_id: row.incident_id as string,
    contact_id: row.contact_id as string,
    transport_status:
      row.transport_status as NotificationCall["transport_status"],
    notification_success:
      row.connected === true && row.notification_spoken === true,
    connected: row.connected === true,
    notification_spoken: row.notification_spoken === true,
    callback_requested: row.callback_requested === true,
    summary: row.summary as string | null,
    error_code: row.error_code as string | null,
    created_at: (row.created_at as Date).toISOString(),
    updated_at: (row.updated_at as Date).toISOString(),
  };
}
export function createCallStore(pool: Pool) {
  return {
    async contacts(subject: string, facility: string, patient: string) {
      return withTransaction(pool, async (c) => {
        await member(c, subject, facility);
        return (
          await c.query(
            `SELECT ${contactProjection} FROM public.family_contacts WHERE facility_id=$1 AND patient_id=$2`,
            [facility, patient],
          )
        ).rows;
      });
    },
    async saveContact(subject: string, id: string, input: FamilyContactInput) {
      return withTransaction(pool, async (c) => {
        await member(c, subject, input.facility_id);
        await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "contact:" + id,
        ]);
        if (
          !(
            await c.query(
              "SELECT id FROM public.patients WHERE id=$1 AND facility_id=$2 FOR SHARE",
              [input.patient_id, input.facility_id],
            )
          ).rowCount
        )
          throw new CallError("patient_not_found", 404);
        const old = (
          await c.query(
            "SELECT * FROM public.family_contacts WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (
          old &&
          (old.facility_id !== input.facility_id ||
            old.patient_id !== input.patient_id)
        )
          throw new CallError("not_found", 404);
        if ((old?.revision ?? 0) !== input.expected_revision)
          throw new CallError("contact_revision_conflict");
        const values = [
          id,
          input.facility_id,
          input.patient_id,
          input.contact_name,
          input.relationship,
          input.phone_e164,
          input.consent_status,
        ];
        const r = await c.query(
          `INSERT INTO public.family_contacts(id,facility_id,patient_id,contact_name,relationship,phone_e164,consent_status,consented_at,consent_revoked_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7='granted' THEN now() END,CASE WHEN $7='revoked' THEN now() END)
          ON CONFLICT(id) DO UPDATE SET contact_name=EXCLUDED.contact_name,relationship=EXCLUDED.relationship,phone_e164=EXCLUDED.phone_e164,
          consent_status=EXCLUDED.consent_status,consented_at=CASE WHEN EXCLUDED.consent_status='granted' THEN now() ELSE family_contacts.consented_at END,
          consent_revoked_at=CASE WHEN EXCLUDED.consent_status='revoked' THEN now() ELSE NULL END,revision=family_contacts.revision+1,updated_at=now() RETURNING ${contactProjection}`,
          values,
        );
        await c.query(
          `INSERT INTO public.operator_audit(facility_id,actor_id,action,target_id,detail) VALUES($1,$2,'contact_saved',$3,$4)`,
          [
            input.facility_id,
            subject,
            id,
            {
              revision: r.rows[0].revision,
              consent_status: input.consent_status,
            },
          ],
        );
        // Invalidate every unsent authorization on any contact/destination/consent edit.
        const cancelled = await c.query(
          "UPDATE public.notification_calls SET transport_status='failed',error_code='contact_changed',updated_at=now() WHERE contact_id=$1 AND transport_status='queued' RETURNING incident_id",
          [id],
        );
        for (const row of cancelled.rows) await bump(c, row.incident_id);
        return r.rows[0];
      });
    },
    async preview(
      subject: string,
      id: string,
      contactId: string,
      revision: number,
    ) {
      return withTransaction(pool, async (c) => {
        const i = await incident(c, subject, id);
        if (i.revision !== revision)
          throw new CallError("incident_revision_conflict");
        if (!i.source) throw new CallError("explanation_not_ready");
        const contact = (
          await c.query(
            "SELECT * FROM public.family_contacts WHERE id=$1 AND facility_id=$2 FOR SHARE",
            [contactId, i.facility_id],
          )
        ).rows[0];
        if (!contact) throw new CallError("contact_not_found", 404);
        if (contact.consent_status !== "granted")
          throw new CallError("consent_required");
        const residentName = await assigned(c, i, contact.patient_id);
        const context = familyContext(i, contact.contact_name, residentName);
        const opening =
          "Hello, this is Blissey Beacon's automated demo assistant. May I speak to " +
          contact.contact_name +
          "?";
        const hash = digest({
          context,
          opening,
          policy_version: POLICY_VERSION,
          policy: POLICY,
          contact_revision: contact.revision,
          destination: contact.phone_e164,
          incident_revision: i.revision,
        });
        const row = (
          await c.query(
            `INSERT INTO public.call_previews(actor_id,incident_id,facility_id,contact_id,incident_revision,contact_revision,patient_id,context,opening,policy_version,context_hash)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,expires_at`,
            [
              subject,
              id,
              i.facility_id,
              contactId,
              i.revision,
              contact.revision,
              contact.patient_id,
              context,
              opening,
              POLICY_VERSION,
              hash,
            ],
          )
        ).rows[0];
        return {
          preview_id: row.id,
          expires_at: row.expires_at,
          expected_revision: i.revision,
          context_hash: hash,
          recipient: {
            id: contact.id,
            name: contact.contact_name,
            phone_e164: contact.phone_e164,
          },
          context,
          opening,
          policy: POLICY,
          policy_version: POLICY_VERSION,
        };
      });
    },
    async authorize(
      subject: string,
      id: string,
      key: string,
      input: CallAuthorization,
    ) {
      return withTransaction(pool, async (c) => {
        await c.query(
          "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
          [subject, key],
        );
        const hash = digest({ id, input });
        const existing = (
          await c.query(
            "SELECT * FROM public.notification_calls WHERE approved_by=$1 AND idempotency_key=$2",
            [subject, key],
          )
        ).rows[0];
        if (existing) {
          await member(c, subject, existing.facility_id);
          if (existing.request_hash !== hash)
            throw new CallError("idempotency_conflict");
          return callDto(existing);
        }
        const i = await incident(c, subject, id);
        const p = (
          await c.query(
            "SELECT * FROM public.call_previews WHERE id=$1 AND actor_id=$2 AND incident_id=$3 AND expires_at>now() FOR UPDATE",
            [input.preview_id, subject, id],
          )
        ).rows[0];
        if (!p || p.policy_version !== POLICY_VERSION)
          throw new CallError("preview_expired_or_missing");
        if (
          input.context_hash !== p.context_hash ||
          input.expected_revision !== p.incident_revision ||
          i.revision !== p.incident_revision
        )
          throw new CallError("review_changed");
        const contact = (
          await c.query(
            "SELECT * FROM public.family_contacts WHERE id=$1 FOR UPDATE",
            [p.contact_id],
          )
        ).rows[0];
        if (
          contact.consent_status !== "granted" ||
          contact.revision !== p.contact_revision
        )
          throw new CallError("contact_changed");
        await assigned(c, i, contact.patient_id);
        const previous = (
          await c.query(
            "SELECT * FROM public.notification_calls WHERE incident_id=$1 AND contact_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE",
            [id, contact.id],
          )
        ).rows[0];
        if (
          previous &&
          (!input.retry_of ||
            input.retry_of !== previous.id ||
            !["failed", "completed"].includes(previous.transport_status))
        )
          throw new CallError("call_exists_or_uncertain");
        if (!previous && input.retry_of) throw new CallError("invalid_retry");
        const r = await c.query(
          `INSERT INTO public.notification_calls(incident_id,facility_id,contact_id,preview_id,approved_by,idempotency_key,request_hash,contact_revision,context,opening,policy_version,context_hash,destination,retry_of)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [
            id,
            i.facility_id,
            contact.id,
            p.id,
            subject,
            key,
            hash,
            contact.revision,
            p.context,
            p.opening,
            p.policy_version,
            p.context_hash,
            contact.phone_e164,
            input.retry_of ?? null,
          ],
        );
        await c.query(
          "INSERT INTO public.operator_audit(facility_id,actor_id,action,target_id,detail) VALUES($1,$2,'call_authorized',$3,$4)",
          [
            i.facility_id,
            subject,
            r.rows[0].id,
            {
              context_hash: p.context_hash,
              incident_revision: i.revision,
              contact_revision: contact.revision,
              retry_of: input.retry_of ?? null,
            },
          ],
        );
        await bump(c, id);
        return callDto(r.rows[0]);
      });
    },
    async list(subject: string, id: string) {
      return withTransaction(pool, async (c) => {
        await incident(c, subject, id);
        return (
          await c.query(
            "SELECT * FROM public.notification_calls WHERE incident_id=$1 ORDER BY created_at DESC LIMIT 100",
            [id],
          )
        ).rows.map(callDto);
      });
    },
    async workflow(subject: string, id: string) {
      return withTransaction(pool, async (c) => {
        const i = await incident(c, subject, id);
        const notes = (
          await c.query(
            "SELECT actor_id,detail->>'note' AS note,created_at FROM public.operator_audit WHERE target_id=$1 AND action='incident_action' AND detail->>'note' IS NOT NULL ORDER BY created_at,id LIMIT 100",
            [id],
          )
        ).rows;
        const next: Record<string, string> = {
          pending: "acknowledged",
          acknowledged: "responding",
          responding: "resolved",
        };
        const patients = (
          await c.query(
            "SELECT patient_id FROM public.room_assignments WHERE room_id=$1 AND facility_id=$2 AND assigned_at<=$3 AND (released_at IS NULL OR released_at>$3)",
            [i.room_id, i.facility_id, i.detected_at],
          )
        ).rows;
        return {
          incident_id: id,
          status: i.status,
          revision: i.revision,
          disposition: i.disposition,
          allowed_actions: [
            ...(next[i.status] ? [next[i.status]] : []),
            "add_note",
          ],
          patient_id: patients.length === 1 ? patients[0].patient_id : null,
          notes,
        };
      });
    },
    async action(
      subject: string,
      id: string,
      key: string,
      input: IncidentAction,
    ) {
      return withTransaction(pool, async (c) => {
        await c.query(
          "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
          [subject, key],
        );
        const i = await incident(c, subject, id),
          hash = digest({ id, input });
        const old = (
          await c.query(
            "SELECT request_hash,detail FROM public.operator_audit WHERE actor_id=$1 AND request_key=$2",
            [subject, key],
          )
        ).rows[0];
        if (old) {
          if (old.request_hash !== hash)
            throw new CallError("idempotency_conflict");
          return old.detail;
        }
        if (i.revision !== input.expected_revision)
          throw new CallError("incident_revision_conflict");
        if (!input.status && !input.note)
          throw new CallError("action_required", 400);
        const next: Record<string, string> = {
          pending: "acknowledged",
          acknowledged: "responding",
          responding: "resolved",
        };
        if (input.status && next[i.status] !== input.status)
          throw new CallError("invalid_transition");
        if (input.disposition && input.status !== "resolved")
          throw new CallError("disposition_requires_resolution", 400);
        const r = (
          await c.query(
            "UPDATE public.incidents SET status=COALESCE($2,status),disposition=COALESCE($3,disposition),revision=revision+1 WHERE id=$1 RETURNING id,status,disposition,revision",
            [
              id,
              input.status ?? null,
              input.status === "resolved"
                ? (input.disposition ?? "unknown")
                : null,
            ],
          )
        ).rows[0];
        await c.query(
          "INSERT INTO public.operator_audit(facility_id,actor_id,action,target_id,request_key,request_hash,detail) VALUES($1,$2,'incident_action',$3,$4,$5,$6)",
          [
            i.facility_id,
            subject,
            id,
            key,
            hash,
            { ...r, note: input.note ?? null },
          ],
        );
        return { ...r, note: input.note ?? null };
      });
    },
  };
}
export type CallStore = ReturnType<typeof createCallStore>;
