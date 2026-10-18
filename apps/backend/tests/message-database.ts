import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { TestContext } from "node:test";
import {
  validateMessageHistory,
  validateFamilyReply,
} from "@blissey/contracts";
import { syntheticEvent } from "@blissey/simulator";
import { createCallStore } from "../src/notifications/store.js";
import { createDispatchStore } from "../src/notifications/dispatch.js";
import { createDeviceStore, credentialHash } from "../src/ingestion/store.js";
import { createExplanationStore } from "../src/explanations/store.js";
import { runExplanationOnce } from "../src/explanations/worker.js";
import { syntheticGenerate } from "./explanation-database.js";
import { createMessageStore } from "../src/messages/store.js";
import {
  createMessageDispatch,
  runMessageOnce,
} from "../src/messages/worker.js";
import type {
  MessageRoute,
  MessageProvider,
  PhotonMessage,
} from "../src/messages/photon.js";
import { createStore, withTransaction } from "../src/db.js";
import { createApp } from "../src/app.js";
const subject = "11111111-1111-4111-8111-111111111111",
  stranger = "22222222-2222-4222-8222-222222222222";
const signal = new AbortController().signal;
const route: MessageRoute = {
  sender_number: "+15555550100",
  destination: "+15555550123",
  sender_id: "sender",
  recipient_id: "recipient",
  space_id: "space",
  resource_id: "resource",
  assignment_id: "assignment",
};
export async function runMessageTests(t: TestContext, pool: Pool) {
  const calls = createCallStore(pool),
    messages = createMessageStore(pool),
    dispatch = createMessageDispatch(pool),
    callDispatch = createDispatchStore(pool),
    api = createStore(pool),
    device = createDeviceStore(pool);
  const credential = credentialHash("synthetic-call-device-credential-102"),
    contactId = randomUUID();
  let incidentId: string;
  const input = {
    facility_id: "demo_facility",
    patient_id: "demo_resident_102",
    contact_name: "Demo Family",
    relationship: "Demo",
    phone_e164: route.destination,
    consent_status: "granted" as const,
    expected_revision: 0,
    consent_confirmed: true as const,
  };
  async function fresh() {
    await pool.query(
      "TRUNCATE public.inference_events,public.family_contacts,public.operator_audit,public.message_poll_state CASCADE",
    );
    incidentId = (
      await device.ingest(
        credential,
        await syntheticEvent("synthetic_message_" + randomUUID()),
      )
    ).incident_id;
    await runExplanationOnce(
      createExplanationStore(pool),
      syntheticGenerate,
      signal,
    );
    await calls.saveContact(subject, contactId, input);
  }
  async function revision() {
    return (await api.getIncident(subject, incidentId))!.revision;
  }
  async function grant() {
    return messages.consent(subject, contactId, {
      expected_revision: (
        await calls.contacts(subject, input.facility_id, input.patient_id)
      )[0]!.revision,
      consent_status: "granted",
      consent_confirmed: true,
    });
  }
  async function prepare(purpose: "followup" | "update" = "followup") {
    return messages.preview(
      subject,
      incidentId,
      {
        contact_id: contactId,
        expected_revision: await revision(),
        purpose,
        ...(purpose === "update"
          ? {
              update_text:
                "Operator verified a fictional demonstration update.",
              verified_facts_confirmed: true as const,
            }
          : {}),
      },
      route,
    );
  }
  async function joint() {
    const p = await prepare(),
      v = await calls.preview(subject, incidentId, contactId, await revision());
    const authorization = {
      preview_id: v.preview_id,
      context_hash: v.context_hash,
      expected_revision: v.expected_revision,
      explicit_authorization: true as const,
      message_preview_id: p.preview_id,
      message_context_hash: p.context_hash,
      explicit_messaging_authorization: true as const,
    };
    const call = await calls.authorize(
      subject,
      incidentId,
      "synthetic-joint-key",
      authorization,
    );
    const a = (await pool.query("SELECT * FROM public.message_authorizations"))
      .rows[0];
    return { call, authorization, a };
  }
  async function update() {
    const p = await prepare("update");
    const body = {
      preview_id: p.preview_id,
      context_hash: p.context_hash,
      expected_revision: p.expected_revision,
      explicit_authorization: true as const,
    };
    const id = await messages.authorizeUpdate(
      subject,
      incidentId,
      "synthetic-update-" + randomUUID(),
      body,
    );
    return { id, body };
  }
  const provider: MessageProvider = {
    resolve: async () => route,
    send: async () => ({ state: "accepted", providerId: "synthetic-outbound" }),
    get: async (id) => ({
      id,
      status: "delivered",
      spaceId: "space",
      senderId: "sender",
      recipientId: null,
      parentId: null,
      text: (
        await pool.query(
          "SELECT body FROM public.notification_messages WHERE provider_message_id=$1",
          [id],
        )
      ).rows[0]?.body,
      createdAt: new Date().toISOString(),
    }),
    replies: async () => ({ items: [], next: null }),
  };
  const app = await createApp({
    webOrigin: "http://localhost:5173",
    verifyOperator: async (token) => {
      if (token === "operator") return subject;
      if (token === "stranger") return stranger;
      throw Error("denied");
    },
    store: api,
    messages: { store: messages, provider, enabled: true },
    calls: {
      store: calls,
      dispatch: callDispatch,
      enabled: true,
      messagesEnabled: true,
    },
  });
  try {
    await t.test(
      "messaging migration is private; voice consent does not authorize messages",
      async () => {
        await fresh();
        assert.equal(
          (
            await calls.contacts(subject, input.facility_id, input.patient_id)
          )[0].imessage_consent_status,
          "revoked",
        );
        await assert.rejects(prepare(), /messaging_consent/);
        for (const role of ["authenticated", "anon"])
          await assert.rejects(
            withTransaction(pool, async (c) => {
              await c.query("SET LOCAL ROLE " + role);
              await c.query("SELECT * FROM public.family_replies");
            }),
            /permission denied/,
          );
        await grant();
        assert.ok((await prepare()).context_hash);
      },
    );
    await t.test(
      "joint approval atomically creates one call and message plan, with durable idempotency",
      async () => {
        await fresh();
        await grant();
        const { call, authorization } = await joint();
        assert.equal(
          (
            await calls.authorize(
              subject,
              incidentId,
              "synthetic-joint-key",
              authorization,
            )
          ).id,
          call.id,
        );
        assert.equal(
          (await pool.query("SELECT * FROM public.notification_calls"))
            .rowCount,
          1,
        );
        assert.equal(
          (await pool.query("SELECT * FROM public.message_authorizations"))
            .rowCount,
          1,
        );
        assert.equal(
          (await pool.query("SELECT * FROM public.notification_messages"))
            .rowCount,
          0,
        );
        await messages.selectReady();
        assert.equal(
          (await pool.query("SELECT state FROM public.message_authorizations"))
            .rows[0].state,
          "waiting",
        );
        await fresh();
        await grant();
        const p = await prepare(),
          v = await calls.preview(
            subject,
            incidentId,
            contactId,
            await revision(),
          );
        await assert.rejects(
          calls.authorize(subject, incidentId, "synthetic-rollback", {
            preview_id: v.preview_id,
            context_hash: v.context_hash,
            expected_revision: v.expected_revision,
            explicit_authorization: true,
            message_preview_id: p.preview_id,
            message_context_hash: "0".repeat(64),
            explicit_messaging_authorization: true,
          }),
          /message_review/,
        );
        assert.equal(
          (await pool.query("SELECT * FROM public.notification_calls"))
            .rowCount,
          0,
        );
      },
    );
    await t.test(
      "definitive busy evidence selects exactly one generic message despite repeated processing",
      async () => {
        await fresh();
        await grant();
        await joint();
        const call = (await callDispatch.claim())!;
        await callDispatch.settle(call, {
          state: "accepted",
          conversationId: "synthetic-busy",
        });
        await callDispatch.event("synthetic-busy-event", {
          conversationId: "synthetic-busy",
          kind: "failed",
          callbackRequested: false,
          failureCode: "busy",
        });
        await messages.selectReady();
        await messages.selectReady();
        const rows = (
          await pool.query("SELECT * FROM public.notification_messages")
        ).rows;
        assert.equal(rows.length, 1);
        assert.ok(rows[0].body.includes("tried to reach you"));
        assert.ok(!rows[0].body.includes("Demo Resident"));
      },
    );
    await t.test(
      "completed call/analysis alone requires review; identity verification gates summaries",
      async () => {
        await fresh();
        await grant();
        const { a } = await joint();
        const call = (await callDispatch.claim())!;
        await callDispatch.settle(call, {
          state: "accepted",
          conversationId: "synthetic-completed",
        });
        await callDispatch.event("synthetic-completed-event", {
          conversationId: "synthetic-completed",
          kind: "completed",
          callbackRequested: false,
          failureCode: null,
        });
        await messages.selectReady();
        assert.equal(
          (await pool.query("SELECT state FROM public.message_authorizations"))
            .rows[0].state,
          "review",
        );
        assert.equal(
          (await pool.query("SELECT * FROM public.notification_messages"))
            .rowCount,
          0,
        );
        await assert.rejects(
          messages.review(subject, a.id, {
            expected_revision: await revision(),
            evidence: "communicated",
            recipient_verified: false,
            note: "Synthetic observation",
            explicit_authorization: true,
          }),
          /verified_recipient/,
        );
        await messages.review(subject, a.id, {
          expected_revision: await revision(),
          evidence: "communicated",
          recipient_verified: true,
          note: "Synthetic operator observation, not provider playback evidence.",
          explicit_authorization: true,
        });
        assert.ok(
          (
            await pool.query("SELECT body FROM public.notification_messages")
          ).rows[0].body.includes("Demo Resident"),
        );
        await assert.rejects(
          messages.review(subject, a.id, {
            expected_revision: await revision(),
            evidence: "no_answer",
            recipient_verified: false,
            note: "Duplicate",
            explicit_authorization: true,
          }),
          /already_selected/,
        );
      },
    );
    await t.test(
      "staff updates require reviewed facts and idempotent authorization",
      async () => {
        await fresh();
        await grant();
        await assert.rejects(
          messages.preview(
            subject,
            incidentId,
            {
              contact_id: contactId,
              expected_revision: await revision(),
              purpose: "update",
              update_text: "Unconfirmed",
            },
            route,
          ),
          /verified_update/,
        );
        const p = await prepare("update"),
          body = {
            preview_id: p.preview_id,
            context_hash: p.context_hash,
            expected_revision: p.expected_revision,
            explicit_authorization: true as const,
          };
        const a = await messages.authorizeUpdate(
          subject,
          incidentId,
          "synthetic-same-update",
          body,
        );
        assert.equal(
          await messages.authorizeUpdate(
            subject,
            incidentId,
            "synthetic-same-update",
            body,
          ),
          a,
        );
        await assert.rejects(
          messages.authorizeUpdate(
            subject,
            incidentId,
            "synthetic-same-update",
            { ...body, context_hash: "0".repeat(64) },
          ),
          /idempotency_conflict/,
        );
      },
    );
    await t.test(
      "private APIs enforce membership before provider resolution and reject malformed approval",
      async () => {
        await fresh();
        await grant();
        let resolved = 0;
        const guarded = await createApp({
          webOrigin: "http://localhost:5173",
          verifyOperator: async () => stranger,
          store: api,
          messages: {
            store: messages,
            provider: {
              ...provider,
              resolve: async () => {
                resolved++;
                return route;
              },
            },
            enabled: true,
          },
        });
        try {
          const r = await guarded.inject({
            method: "POST",
            url: `/api/operator/incidents/${incidentId}/messages/preview`,
            headers: { authorization: "Bearer stranger" },
            payload: {
              contact_id: contactId,
              expected_revision: await revision(),
              purpose: "followup",
            },
          });
          assert.equal(r.statusCode, 404);
          assert.equal(resolved, 0);
        } finally {
          await guarded.close();
        }
        assert.equal(
          (
            await app.inject({
              url: "/api/operator/family-replies?facility_id=demo_facility",
            })
          ).statusCode,
          401,
        );
        assert.equal(
          (
            await app.inject({
              url: "/api/operator/family-replies?facility_id=demo_facility",
              headers: { authorization: "Bearer stranger" },
            })
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: `/api/operator/incidents/${incidentId}/messages`,
              headers: {
                authorization: "Bearer operator",
                "idempotency-key": "synthetic-key",
              },
              payload: { explicit_authorization: false },
            })
          ).statusCode,
          400,
        );
      },
    );
    await t.test(
      "workers commit attempts before sending; competing workers send only once",
      async () => {
        await fresh();
        await grant();
        await update();
        let sends = 0;
        const p = {
          ...provider,
          send: async (id: string) => {
            sends++;
            assert.equal(
              (
                await pool.query(
                  "SELECT * FROM public.message_attempts WHERE message_id=$1",
                  [id],
                )
              ).rowCount,
              1,
            );
            return {
              state: "accepted" as const,
              providerId: "synthetic-concurrent",
            };
          },
        };
        await Promise.all([
          runMessageOnce(dispatch, p, signal),
          runMessageOnce(dispatch, p, signal),
        ]);
        assert.equal(sends, 1);
      },
    );
    await t.test(
      "attempt transaction rollback prevents any provider effect",
      async () => {
        await fresh();
        await grant();
        await update();
        let sends = 0;
        await pool.query(
          "CREATE FUNCTION public.fail_message_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_message_commit_failure'; END $$; CREATE CONSTRAINT TRIGGER fail_message_commit AFTER INSERT ON public.message_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fail_message_commit()",
        );
        try {
          await assert.rejects(
            runMessageOnce(
              dispatch,
              {
                ...provider,
                send: async () => {
                  sends++;
                  return { state: "accepted" };
                },
              },
              signal,
            ),
            /synthetic_message_commit_failure/,
          );
        } finally {
          await pool.query(
            "DROP TRIGGER fail_message_commit ON public.message_attempts; DROP FUNCTION public.fail_message_commit()",
          );
        }
        assert.equal(sends, 0);
        assert.equal(
          (await pool.query("SELECT state FROM public.notification_messages"))
            .rows[0].state,
          "queued",
        );
      },
    );
    await t.test(
      "assignment changes, consent changes, tampered snapshots and missing membership prevent sending",
      async () => {
        for (const kind of [
          "assignment",
          "consent",
          "tamper",
          "membership",
        ] as const) {
          await fresh();
          await grant();
          await update();
          let sends = 0;
          if (kind === "tamper")
            await pool.query(
              "UPDATE public.notification_messages SET body='Unapproved text'",
            );
          if (kind === "membership")
            await pool.query(
              "DELETE FROM public.facility_memberships WHERE user_id=$1",
              [subject],
            );
          try {
            const p = {
              ...provider,
              resolve: async () => {
                if (kind === "consent")
                  await messages.consent(subject, contactId, {
                    expected_revision: 2,
                    consent_status: "revoked",
                    consent_confirmed: true,
                  });
                return kind === "assignment"
                  ? { ...route, assignment_id: "changed" }
                  : route;
              },
              send: async () => {
                sends++;
                return { state: "accepted" as const };
              },
            };
            await runMessageOnce(dispatch, p, signal);
            assert.equal(sends, 0);
          } finally {
            if (kind === "membership")
              await pool.query(
                "INSERT INTO public.facility_memberships VALUES($1,'demo_facility')",
                [subject],
              );
          }
        }
      },
    );
    await t.test(
      "effect-then-exception and restart leave unknown submissions without automatic resend",
      async () => {
        await fresh();
        await grant();
        await update();
        let effects = 0;
        await runMessageOnce(
          dispatch,
          {
            ...provider,
            send: async () => {
              effects++;
              throw Error("external side effect then response loss");
            },
          },
          signal,
        );
        assert.equal(
          (await pool.query("SELECT state FROM public.notification_messages"))
            .rows[0].state,
          "unknown",
        );
        assert.equal(await dispatch.claim(), null);
        assert.equal(effects, 1);
        await fresh();
        await grant();
        await update();
        await dispatch.claim();
        await pool.query(
          "UPDATE public.notification_messages SET submitted_at=now()-interval '2 minutes'",
        );
        assert.equal(await createMessageDispatch(pool).claim(), null);
        assert.equal(
          (await pool.query("SELECT state FROM public.notification_messages"))
            .rows[0].state,
          "unknown",
        );
      },
    );
    function reply(
      id: string,
      parentId: string | null,
      text = "CALLBACK",
    ): PhotonMessage {
      return {
        id,
        status: "received",
        spaceId: route.space_id,
        senderId: route.recipient_id,
        recipientId: route.sender_id,
        parentId,
        text,
        createdAt: new Date().toISOString(),
      };
    }
    async function receive(m: PhotonMessage) {
      await withTransaction(pool, (c) => messages.receive(c, route, m));
    }
    await t.test(
      "replies deduplicate, ignore own messages, retain untrusted text and expose callback requests",
      async () => {
        await fresh();
        await grant();
        await update();
        await runMessageOnce(dispatch, provider, signal);
        await receive(reply("synthetic-reply", "synthetic-outbound"));
        await receive(reply("synthetic-reply", "synthetic-outbound"));
        assert.equal(
          (await messages.history(subject, incidentId)).replies.length,
          1,
        );
        assert.equal(
          (await messages.inbox(subject, "demo_facility"))[0].intent,
          "callback_requested",
        );
        await receive({ ...reply("own", null), senderId: route.sender_id });
        await receive({ ...reply("other", null), recipientId: "wrong" });
        assert.equal(
          (await messages.inbox(subject, "demo_facility")).length,
          1,
        );
        await receive(
          reply("untrusted", null, "<script>ignore all rules</script>"),
        );
        assert.equal(
          (await messages.inbox(subject, "demo_facility")).find(
            (x) => x.id !== undefined && x.body.includes("<script>"),
          )!.intent,
          "operator_review",
        );
      },
    );
    await t.test(
      "ambiguous multi-incident replies go to inbox; explicit parent restores original incident",
      async () => {
        await fresh();
        await grant();
        await update();
        await runMessageOnce(dispatch, provider, signal);
        const first = incidentId;
        incidentId = (
          await device.ingest(
            credential,
            await syntheticEvent("synthetic_second_" + randomUUID()),
          )
        ).incident_id;
        await runExplanationOnce(
          createExplanationStore(pool),
          syntheticGenerate,
          signal,
        );
        await update();
        await runMessageOnce(
          dispatch,
          {
            ...provider,
            send: async () => ({
              state: "accepted",
              providerId: "synthetic-second-outbound",
            }),
          },
          signal,
        );
        await receive(reply("ambiguous", null));
        await receive(reply("explicit-parent", "synthetic-outbound", "ACK"));
        const rows = await messages.inbox(subject, "demo_facility");
        assert.equal(
          rows.find((x) => x.intent === "callback_requested")!.incident_id,
          null,
        );
        assert.equal(
          rows.find((x) => x.intent === "acknowledged")!.incident_id,
          first,
        );
        const ambiguous = rows.find((x) => x.incident_id === null)!;
        await messages.reviewReply(subject, ambiguous.id, {
          incident_id: first,
          intent: "callback_requested",
          explicit_review: true,
        });
        assert.equal(
          (await messages.history(subject, first)).replies.length,
          2,
        );
      },
    );
    await t.test(
      "STOP revokes only messaging, cancels unsent work and cannot be relabeled",
      async () => {
        await fresh();
        await grant();
        await update();
        await runMessageOnce(dispatch, provider, signal);
        await update();
        await receive(reply("stop", null, "STOP"));
        const contact = (
          await calls.contacts(subject, input.facility_id, input.patient_id)
        )[0];
        assert.equal(contact.imessage_consent_status, "revoked");
        assert.equal(contact.consent_status, "granted");
        assert.equal(
          (
            await pool.query(
              "SELECT * FROM public.notification_messages WHERE state='queued'",
            )
          ).rowCount,
          0,
        );
        const inbox = await messages.inbox(subject, "demo_facility");
        await assert.rejects(
          messages.reviewReply(subject, inbox[0].id, {
            intent: "acknowledged",
            explicit_review: true,
          }),
          /stop_cannot/,
        );
      },
    );
    await t.test(
      "poll checkpoints survive restarts and late replies are recovered; delivery never regresses",
      async () => {
        await fresh();
        await grant();
        await update();
        await runMessageOnce(dispatch, provider, signal);
        let page = 0;
        const p = {
          ...provider,
          replies: async () => ({
            items: page++ ? [reply("late", "synthetic-outbound")] : [],
            next: null,
          }),
        };
        await dispatch.poll(p, signal);
        await pool.query(
          "UPDATE public.message_poll_state SET lease_until=NULL",
        );
        await createMessageDispatch(pool).poll(p, signal);
        assert.equal(
          (await messages.inbox(subject, "demo_facility")).length,
          1,
        );
        await dispatch.reconcile(provider, signal);
        assert.equal(
          (await pool.query("SELECT state FROM public.notification_messages"))
            .rows[0].state,
          "delivered",
        );
        await dispatch.reconcile(
          {
            ...provider,
            get: async (id, r, s) => ({
              ...(await provider.get(id, r, s)),
              status: "accepted",
            }),
          },
          signal,
        );
        assert.equal(
          (await pool.query("SELECT state FROM public.notification_messages"))
            .rows[0].state,
          "delivered",
        );
      },
    );
    await t.test(
      "late conflicting call evidence blocks a previously selected generic follow-up",
      async () => {
        await fresh();
        await grant();
        await joint();
        const call = (await callDispatch.claim())!;
        await callDispatch.settle(call, {
          state: "accepted",
          conversationId: "synthetic-conflict",
        });
        await callDispatch.event("synthetic-first-busy", {
          conversationId: "synthetic-conflict",
          kind: "failed",
          callbackRequested: false,
          failureCode: "busy",
        });
        await messages.selectReady();
        await callDispatch.event("synthetic-later-completion", {
          conversationId: "synthetic-conflict",
          kind: "completed",
          callbackRequested: false,
          failureCode: null,
        });
        let sent = 0;
        await runMessageOnce(
          dispatch,
          {
            ...provider,
            send: async () => {
              sent++;
              return { state: "accepted" };
            },
          },
          signal,
        );
        assert.equal(sent, 0);
      },
    );
    await t.test(
      "reply commit failure preserves checkpoint; restart deduplicates and returns shared DTOs",
      async () => {
        await fresh();
        await grant();
        await update();
        await runMessageOnce(dispatch, provider, signal);
        const p = {
          ...provider,
          replies: async () => ({
            items: [reply("synthetic-commit-reply", "synthetic-outbound")],
            next: "synthetic-next-page",
          }),
        };
        await pool.query(
          "CREATE FUNCTION public.fail_reply_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_reply_commit_failure'; END $$; CREATE CONSTRAINT TRIGGER fail_reply_commit AFTER INSERT ON public.family_replies DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fail_reply_commit()",
        );
        try {
          await assert.rejects(
            dispatch.poll(p, signal),
            /synthetic_reply_commit_failure/,
          );
        } finally {
          await pool.query(
            "DROP TRIGGER fail_reply_commit ON public.family_replies; DROP FUNCTION public.fail_reply_commit()",
          );
        }
        assert.equal(
          (await pool.query("SELECT page_token FROM public.message_poll_state"))
            .rows[0].page_token,
          null,
        );
        assert.equal(
          (await pool.query("SELECT * FROM public.family_replies")).rowCount,
          0,
        );
        await pool.query(
          "UPDATE public.message_poll_state SET lease_until=NULL",
        );
        await createMessageDispatch(pool).poll(p, signal);
        assert.equal(
          (await pool.query("SELECT page_token FROM public.message_poll_state"))
            .rows[0].page_token,
          "synthetic-next-page",
        );
        const h = await app.inject({
          url: `/api/operator/incidents/${incidentId}/messages`,
          headers: { authorization: "Bearer operator" },
        });
        assert.equal(h.statusCode, 200);
        assert.ok(validateMessageHistory(h.json()));
        const inbox = await app.inject({
          url: "/api/operator/family-replies?facility_id=demo_facility",
          headers: { authorization: "Bearer operator" },
        });
        assert.ok(validateFamilyReply(inbox.json().replies[0]));
        await receive(reply("unknown-parent", "not-a-known-message"));
        assert.equal(
          (await messages.inbox(subject, "demo_facility")).find(
            (r) => r.incident_id === null,
          )!.intent,
          "callback_requested",
        );
      },
    );
  } finally {
    await app.close();
  }
}
