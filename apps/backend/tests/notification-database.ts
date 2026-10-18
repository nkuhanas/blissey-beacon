import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import type { Pool } from "pg";
import type { TestContext } from "node:test";
import {
  validateNotificationCall,
  validateCallPreview,
  validateIncidentWorkflow,
} from "@blissey/contracts";
import { syntheticEvent } from "@blissey/simulator";
import { createDeviceStore, credentialHash } from "../src/ingestion/store.js";
import { createExplanationStore } from "../src/explanations/store.js";
import { runExplanationOnce } from "../src/explanations/worker.js";
import { syntheticGenerate } from "./explanation-database.js";
import { createCallStore } from "../src/notifications/store.js";
import {
  createDispatchStore,
  runCallOnce,
} from "../src/notifications/dispatch.js";
import { createStore, withTransaction } from "../src/db.js";
import { createApp } from "../src/app.js";
const subject = "11111111-1111-4111-8111-111111111111";
const stranger = "22222222-2222-4222-8222-222222222222";
const token = "synthetic-call-device-credential-102";
const signal = new AbortController().signal;
export async function runNotificationTests(t: TestContext, pool: Pool) {
  const store = createCallStore(pool),
    dispatch = createDispatchStore(pool),
    api = createStore(pool);
  await pool.query(
    "INSERT INTO public.device_credentials(token_hash,device_id) VALUES($1,'pi_102') ON CONFLICT DO NOTHING",
    [credentialHash(token)],
  );
  const device = createDeviceStore(pool);
  const contactId = randomUUID();
  let incidentId: string;
  const contact = {
    facility_id: "demo_facility",
    patient_id: "demo_resident_102",
    contact_name: "Demo family",
    relationship: "Demo recipient",
    phone_e164: "+15555550123",
    consent_status: "granted" as const,
    expected_revision: 0,
    consent_confirmed: true as const,
  };
  const app = await createApp({
    webOrigin: "http://localhost:5173",
    store: api,
    verifyOperator: async (token) => {
      if (token === "synthetic-operator") return subject;
      if (token === "synthetic-stranger") return stranger;
      throw Error("denied");
    },
    calls: {
      store,
      dispatch,
      enabled: true,
      webhook: {
        secret: "synthetic-webhook-secret",
        agentId: "synthetic-agent",
      },
    },
  });
  const headers = { authorization: "Bearer synthetic-operator" };
  async function fresh() {
    await pool.query(
      "TRUNCATE public.inference_events,public.family_contacts,public.operator_audit CASCADE",
    );
    const ack = await device.ingest(
      credentialHash(token),
      await syntheticEvent("synthetic_call_" + randomUUID()),
    );
    incidentId = ack.incident_id;
    await runExplanationOnce(
      createExplanationStore(pool),
      syntheticGenerate,
      signal,
    );
    await store.saveContact(subject, contactId, contact);
  }
  async function preview() {
    const i = await api.getIncident(subject, incidentId);
    return store.preview(subject, incidentId, contactId, i!.revision);
  }
  async function queue(key = "synthetic-authorization-key") {
    const p = await preview();
    const input = {
      preview_id: p.preview_id,
      context_hash: p.context_hash,
      expected_revision: p.expected_revision,
      explicit_authorization: true as const,
    };
    return {
      call: await store.authorize(subject, incidentId, key, input),
      input,
    };
  }
  try {
    await t.test(
      "authenticated contact configuration, consent, historical assignment and private-table access",
      async () => {
        await fresh();
        assert.equal(
          (
            await app.inject(
              "/api/operator/family-contacts?facility_id=demo_facility&patient_id=demo_resident_102",
            )
          ).statusCode,
          401,
        );
        const denied = await app.inject({
          url: "/api/operator/family-contacts?facility_id=demo_facility&patient_id=demo_resident_102",
          headers: { authorization: "Bearer synthetic-stranger" },
        });
        assert.equal(denied.statusCode, 403);
        assert.equal(
          (await store.contacts(subject, "demo_facility", "demo_resident_102"))
            .length,
          1,
        );
        await assert.rejects(
          store.saveContact(stranger, contactId, {
            ...contact,
            expected_revision: 1,
          }),
          /forbidden/,
        );
        const p = await preview();
        assert.ok(!JSON.stringify(p.context).includes("confidence"));
        assert.equal(p.context.event_type, "inference_result");
        assert.equal(p.context.resident_condition, "unknown");
        assert.ok(p.opening.startsWith("Hello"));
        assert.equal(p.recipient.phone_e164, contact.phone_e164);
        await pool.query(
          "UPDATE public.room_assignments SET assigned_at='2027-01-01' WHERE room_id='room_102'",
        );
        await assert.rejects(preview(), /historical_patient_mismatch/);
        await pool.query(
          "UPDATE public.room_assignments SET assigned_at='2026-10-17' WHERE room_id='room_102'",
        );
        for (const role of ["anon", "authenticated"])
          for (const table of [
            "family_contacts",
            "call_previews",
            "notification_calls",
            "notification_attempts",
            "notification_provider_events",
            "operator_audit",
          ])
            await assert.rejects(
              withTransaction(pool, async (c) => {
                await c.query(`SET LOCAL ROLE ${role}`);
                await c.query(`SELECT * FROM public.${table}`);
              }),
              /permission denied/,
            );
      },
    );
    await t.test(
      "call review uses the incident-time resident, freezes their name and refuses missing identity",
      async () => {
        await fresh();
        await pool.query(
          "UPDATE public.room_assignments SET released_at='2026-10-18' WHERE room_id='room_102'",
        );
        await pool.query(
          "INSERT INTO public.patients(id,facility_id,display_label) VALUES('synthetic_new_resident','demo_facility','Different Resident')",
        );
        await pool.query(
          "INSERT INTO public.room_assignments(facility_id,room_id,patient_id,assigned_at) VALUES('demo_facility','room_102','synthetic_new_resident','2026-10-18')",
        );
        try {
          const p = await preview();
          assert.equal(p.context.resident_name, "Demo Resident 102");
          assert.ok(p.context.family_summary.includes("Demo Resident 102"));
          assert.ok(!JSON.stringify(p.context).includes("Different Resident"));
          assert.notEqual(p.context.resident_name, p.recipient.name);
          // A later profile edit must not silently change the reviewed snapshot.
          await pool.query(
            "UPDATE public.patients SET display_label='Updated Demo Label' WHERE id='demo_resident_102'",
          );
          await store.authorize(
            subject,
            incidentId,
            "synthetic-resident-snapshot",
            {
              preview_id: p.preview_id,
              context_hash: p.context_hash,
              expected_revision: p.expected_revision,
              explicit_authorization: true,
            },
          );
          const submission = await dispatch.claim();
          assert.equal(submission?.context.resident_name, "Demo Resident 102");
          await pool.query(
            "UPDATE public.patients SET display_label='   ' WHERE id='demo_resident_102'",
          );
          await assert.rejects(preview(), /resident_name_unavailable/);
        } finally {
          await pool.query(
            "DELETE FROM public.room_assignments WHERE patient_id='synthetic_new_resident'",
          );
          await pool.query(
            "DELETE FROM public.patients WHERE id='synthetic_new_resident'",
          );
          await pool.query(
            "UPDATE public.room_assignments SET released_at=NULL WHERE room_id='room_102'",
          );
          await pool.query(
            "UPDATE public.patients SET display_label='Demo Resident 102' WHERE id='demo_resident_102'",
          );
        }
      },
    );
    await t.test(
      "HTTP contracts enforce explicit authorization, idempotency keys and facility privacy",
      async () => {
        await fresh();
        const preflight = await app.inject({
          method: "OPTIONS",
          url: "/api/operator/family-contacts/" + contactId,
          headers: {
            origin: "http://localhost:5173",
            "access-control-request-method": "PUT",
            "access-control-request-headers":
              "authorization,content-type,idempotency-key",
          },
        });
        assert.equal(preflight.statusCode, 204);
        assert.ok(
          preflight.headers["access-control-allow-methods"]?.includes("PUT"),
        );
        assert.ok(
          preflight.headers["access-control-allow-methods"]?.includes("PATCH"),
        );
        const i = (await api.getIncident(subject, incidentId))!;
        const response = await app.inject({
          method: "POST",
          url: `/api/operator/incidents/${incidentId}/notifications/preview`,
          headers,
          payload: { contact_id: contactId, expected_revision: i.revision },
        });
        assert.equal(response.statusCode, 200);
        const p = response.json();
        assert.ok(validateCallPreview(p));
        const input = {
          preview_id: p.preview_id,
          context_hash: p.context_hash,
          expected_revision: p.expected_revision,
          explicit_authorization: true,
        };
        const url = `/api/operator/incidents/${incidentId}/notifications`;
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url,
              headers,
              payload: { ...input, explicit_authorization: false },
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (await app.inject({ method: "POST", url, headers, payload: input }))
            .statusCode,
          400,
        );
        const accepted = await app.inject({
          method: "POST",
          url,
          headers: { ...headers, "idempotency-key": "synthetic-http-approval" },
          payload: input,
        });
        assert.equal(accepted.statusCode, 202);
        assert.ok(validateNotificationCall(accepted.json().call));
        const detail = await app.inject({
          url: `/api/operator/incidents/${incidentId}/workflow`,
          headers,
        });
        assert.equal(detail.statusCode, 200);
        assert.equal(detail.json().patient_id, "demo_resident_102");
        assert.ok(validateIncidentWorkflow(detail.json()));
        assert.equal(
          (
            await app.inject({
              url,
              headers: { authorization: "Bearer synthetic-stranger" },
            })
          ).statusCode,
          404,
        );
        const disabled = await createApp({
          webOrigin: "http://localhost:5173",
          store: api,
          verifyOperator: async () => subject,
          calls: { store, dispatch, enabled: false },
        });
        try {
          assert.equal(
            (
              await disabled.inject({
                method: "POST",
                url,
                headers: {
                  ...headers,
                  "idempotency-key": "synthetic-disabled-key",
                },
                payload: input,
              })
            ).statusCode,
            503,
          );
        } finally {
          await disabled.close();
        }
      },
    );
    await t.test(
      "frozen preview, transactional authorization, concurrent duplicate requests and conflicting keys",
      async () => {
        await fresh();
        const p = await preview();
        const input = {
          preview_id: p.preview_id,
          context_hash: p.context_hash,
          expected_revision: p.expected_revision,
          explicit_authorization: true as const,
        };
        const calls = await Promise.all([
          store.authorize(subject, incidentId, "synthetic-repeat-key", input),
          store.authorize(subject, incidentId, "synthetic-repeat-key", input),
        ]);
        assert.equal(calls[0]!.id, calls[1]!.id);
        assert.ok(validateNotificationCall(calls[0]));
        assert.equal(
          (await pool.query("SELECT * FROM public.notification_calls"))
            .rowCount,
          1,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT * FROM public.operator_audit WHERE action='call_authorized'",
            )
          ).rowCount,
          1,
        );
        await assert.rejects(
          store.authorize(subject, incidentId, "synthetic-repeat-key", {
            ...input,
            context_hash: "f".repeat(64),
          }),
          /idempotency_conflict/,
        );
        const second = await preview();
        await assert.rejects(
          store.authorize(subject, incidentId, "synthetic-second-call", {
            ...input,
            preview_id: second.preview_id,
            context_hash: second.context_hash,
            expected_revision: second.expected_revision,
          }),
          /call_exists/,
        );
        const reads = await store.list(subject, incidentId);
        assert.ok(!JSON.stringify(reads).includes(contact.phone_e164));
        assert.ok(!JSON.stringify(reads).includes("context_hash"));
        await assert.rejects(store.list(stranger, incidentId), /not_found/);
      },
    );
    await t.test(
      "revoked or edited contacts, stale/expired previews and missing explanations block dispatch approval",
      async () => {
        await fresh();
        const p = await preview();
        await store.saveContact(subject, contactId, {
          ...contact,
          expected_revision: 1,
          consent_status: "revoked",
        });
        await assert.rejects(
          store.authorize(subject, incidentId, "synthetic-revoked-key", {
            preview_id: p.preview_id,
            context_hash: p.context_hash,
            expected_revision: p.expected_revision,
            explicit_authorization: true,
          }),
          /contact_changed/,
        );
        await fresh();
        const q = await preview();
        await pool.query(
          "UPDATE public.call_previews SET expires_at=now()-interval '1 second'",
        );
        await assert.rejects(
          store.authorize(subject, incidentId, "synthetic-expired-key", {
            preview_id: q.preview_id,
            context_hash: q.context_hash,
            expected_revision: q.expected_revision,
            explicit_authorization: true,
          }),
          /preview_expired/,
        );
        await pool.query("DELETE FROM public.explanations");
        await assert.rejects(preview(), /explanation_not_ready/);
      },
    );
    await t.test(
      "authorization failure at commit rolls back job, audit and incident revision",
      async () => {
        await fresh();
        const p = await preview();
        await pool.query(
          "CREATE FUNCTION public.fail_call_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_call_commit_failure'; END $$; CREATE CONSTRAINT TRIGGER fail_call_commit AFTER INSERT ON public.notification_calls DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fail_call_commit()",
        );
        try {
          await assert.rejects(
            store.authorize(subject, incidentId, "synthetic-rollback-key", {
              preview_id: p.preview_id,
              context_hash: p.context_hash,
              expected_revision: p.expected_revision,
              explicit_authorization: true,
            }),
            /synthetic_call_commit_failure/,
          );
        } finally {
          await pool.query(
            "DROP TRIGGER fail_call_commit ON public.notification_calls; DROP FUNCTION public.fail_call_commit()",
          );
        }
        assert.equal(
          (await pool.query("SELECT * FROM public.notification_calls"))
            .rowCount,
          0,
        );
        assert.equal(
          (await api.getIncident(subject, incidentId))!.revision,
          p.expected_revision,
        );
      },
    );
    await t.test(
      "incident lifecycle validates revisions, states, notes and action idempotency",
      async () => {
        await fresh();
        const i = (await api.getIncident(subject, incidentId))!;
        const action = {
          expected_revision: i.revision,
          status: "acknowledged" as const,
          note: "Synthetic operator note",
        };
        const first = await store.action(
          subject,
          incidentId,
          "synthetic-action-key",
          action,
        );
        assert.equal(first.status, "acknowledged");
        assert.deepEqual(
          await store.action(
            subject,
            incidentId,
            "synthetic-action-key",
            action,
          ),
          first,
        );
        await assert.rejects(
          store.action(subject, incidentId, "synthetic-stale-key", action),
          /revision_conflict/,
        );
        await assert.rejects(
          store.action(subject, incidentId, "synthetic-skipped-key", {
            expected_revision: first.revision,
            status: "resolved",
          }),
          /invalid_transition/,
        );
        const responding = await store.action(
          subject,
          incidentId,
          "synthetic-respond-key",
          { expected_revision: first.revision, status: "responding" },
        );
        const resolved = await store.action(
          subject,
          incidentId,
          "synthetic-resolve-key",
          {
            expected_revision: responding.revision,
            status: "resolved",
            disposition: "false_alarm",
          },
        );
        assert.equal(resolved.disposition, "false_alarm");
      },
    );
    await t.test(
      "durable attempt commits before external submission; ambiguous response and restart never redial",
      async () => {
        await fresh();
        await queue();
        let submitted = 0;
        const results = await Promise.all([
          runCallOnce(
            dispatch,
            async (input) => {
              submitted++;
              assert.equal(
                (
                  await pool.query(
                    "SELECT state FROM public.notification_attempts WHERE id=$1",
                    [input.attemptId],
                  )
                ).rows[0].state,
                "initiating",
              );
              return { state: "unknown", code: "submission_interrupted" };
            },
            signal,
          ),
          runCallOnce(
            dispatch,
            async () => {
              submitted++;
              return { state: "unknown" };
            },
            signal,
          ),
        ]);
        assert.ok(results.some(Boolean));
        assert.equal(submitted, 1);
        assert.equal(
          (await store.list(subject, incidentId))[0]!.transport_status,
          "unknown",
        );
        assert.equal(await dispatch.claim(), null);
        const p = await preview();
        await assert.rejects(
          store.authorize(subject, incidentId, "synthetic-uncertain-retry", {
            preview_id: p.preview_id,
            context_hash: p.context_hash,
            expected_revision: p.expected_revision,
            explicit_authorization: true,
            retry_of: (await store.list(subject, incidentId))[0]!.id,
          }),
          /uncertain/,
        );
        await fresh();
        await queue();
        await dispatch.claim();
        await pool.query(
          "UPDATE public.notification_calls SET submitted_at=now()-interval '1 minute'",
        );
        assert.equal(await dispatch.claim(), null);
        assert.equal(
          (await store.list(subject, incidentId))[0]!.transport_status,
          "unknown",
        );
      },
    );
    await t.test(
      "attempt commit failure makes no external call; definitive failures require a fresh explicit retry",
      async () => {
        await fresh();
        await queue();
        let invoked = 0;
        await pool.query(
          "CREATE FUNCTION public.fail_attempt_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_attempt_commit_failure'; END $$; CREATE CONSTRAINT TRIGGER fail_attempt_commit AFTER INSERT ON public.notification_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fail_attempt_commit()",
        );
        try {
          await assert.rejects(
            runCallOnce(
              dispatch,
              async () => {
                invoked++;
                return { state: "accepted", conversationId: "must-not-submit" };
              },
              signal,
            ),
            /synthetic_attempt_commit_failure/,
          );
        } finally {
          await pool.query(
            "DROP TRIGGER fail_attempt_commit ON public.notification_attempts; DROP FUNCTION public.fail_attempt_commit()",
          );
        }
        assert.equal(invoked, 0);
        assert.equal(
          (await pool.query("SELECT * FROM public.notification_attempts"))
            .rowCount,
          0,
        );
        assert.equal(
          (await store.list(subject, incidentId))[0]!.transport_status,
          "queued",
        );
        await runCallOnce(
          dispatch,
          async () => ({ state: "failed", code: "provider_http_401" }),
          signal,
        );
        const old = (await store.list(subject, incidentId))[0]!;
        assert.equal(old.transport_status, "failed");
        const p = await preview();
        const retry = await store.authorize(
          subject,
          incidentId,
          "synthetic-explicit-retry",
          {
            preview_id: p.preview_id,
            context_hash: p.context_hash,
            expected_revision: p.expected_revision,
            explicit_authorization: true,
            retry_of: old.id,
          },
        );
        assert.notEqual(retry.id, old.id);
        await runCallOnce(
          dispatch,
          async () => ({
            state: "accepted",
            conversationId: "synthetic-retried-conversation",
          }),
          signal,
        );
        assert.equal(
          (await pool.query("SELECT * FROM public.notification_attempts"))
            .rowCount,
          2,
        );
      },
    );
    await t.test(
      "consent/membership/approval rechecked immediately before submission and destination changes cancel queued work",
      async () => {
        await fresh();
        await queue();
        await store.saveContact(subject, contactId, {
          ...contact,
          expected_revision: 1,
          phone_e164: "+15555550124",
        });
        assert.equal(await dispatch.claim(), null);
        assert.equal(
          (await store.list(subject, incidentId))[0]!.transport_status,
          "failed",
        );
        await fresh();
        await queue();
        await pool.query(
          "UPDATE public.notification_calls SET context=jsonb_set(context,'{family_summary}',to_jsonb('Unapproved claim'::text))",
        );
        assert.equal(await dispatch.claim(), null);
        assert.equal(
          (await store.list(subject, incidentId))[0]!.transport_status,
          "failed",
        );
        await fresh();
        await queue();
        await pool.query(
          "UPDATE public.notification_calls SET created_at=now()-interval '11 minutes'",
        );
        assert.equal(await dispatch.claim(), null);
      },
    );
    await t.test(
      "signed early callbacks are correlated after response; replay and reversed events cannot duplicate or regress state",
      async () => {
        await fresh();
        await queue();
        const call = (await dispatch.claim())!;
        const body = JSON.stringify({
          type: "post_call_transcription",
          data: {
            agent_id: "synthetic-agent",
            conversation_id: "synthetic-conversation",
            transcript: [{ message: "Private transcript must not persist" }],
            analysis: {
              call_successful: "success",
              data_collection_results: { callback_requested: { value: true } },
            },
          },
        });
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = `t=${timestamp},v0=${createHmac(
          "sha256",
          "synthetic-webhook-secret",
        )
          .update(timestamp + "." + body)
          .digest("hex")}`;
        const bad = await app.inject({
          method: "POST",
          url: "/api/webhooks/elevenlabs",
          headers: {
            "content-type": "application/json",
            "elevenlabs-signature": "bad",
          },
          payload: body,
        });
        assert.equal(bad.statusCode, 401);
        const send = () =>
          app.inject({
            method: "POST",
            url: "/api/webhooks/elevenlabs",
            headers: {
              "content-type": "application/json",
              "elevenlabs-signature": signature,
            },
            payload: body,
          });
        assert.equal((await send()).statusCode, 200);
        await dispatch.settle(call, {
          state: "accepted",
          conversationId: "synthetic-conversation",
          sipCallId: "synthetic-sip",
        });
        assert.equal((await send()).statusCode, 200);
        await dispatch.event("synthetic-late-failure", {
          conversationId: "synthetic-conversation",
          kind: "failed",
          callbackRequested: false,
          failureCode: "unknown",
        });
        const read = (await store.list(subject, incidentId))[0]!;
        assert.equal(read.transport_status, "completed");
        assert.equal(read.callback_requested, true);
        assert.equal(read.notification_success, false);
        assert.equal(read.notification_spoken, false);
        const stored = JSON.stringify(
          (
            await pool.query(
              "SELECT * FROM public.notification_provider_events",
            )
          ).rows,
        );
        assert.ok(!stored.includes("Private transcript"));
        assert.equal(
          (await pool.query("SELECT * FROM public.notification_attempts"))
            .rowCount,
          1,
        );
      },
    );
  } finally {
    await app.close();
  }
}
