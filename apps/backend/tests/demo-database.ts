import { tickDemoStreams } from "../src/demo/stream.js";
import {
  persistInferenceEvent,
  createDeviceStore,
  credentialHash,
} from "../src/ingestion/store.js";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { validateDashboardRoom, isInferenceEvent } from "@blissey/contracts";
import { createDemoStore } from "../src/demo/store.js";
import { createApp } from "../src/app.js";
import { createStore, withTransaction } from "../src/db.js";
import { createCallStore } from "../src/notifications/store.js";
const subject = "11111111-1111-4111-8111-111111111111";
export async function runDemoTests(t: TestContext, pool: Pool) {
  const options = {
    enabled: true,
    facilityId: "demo_facility",
    phone: "+15555550123",
  };
  const store = createDemoStore(pool, options);
  const request = {
    facility_id: "demo_facility",
    room_id: "104",
    scenario: "attention",
  } as const;
  const app = await createApp({
    store: createStore(pool),
    webOrigin: "http://localhost:5173",
    verifyOperator: async (token) => {
      if (token !== "synthetic") throw Error("denied");
      return subject;
    },
    demo: { store, enabled: true },
  });
  const headers = {
    authorization: "Bearer synthetic",
    "idempotency-key": randomUUID(),
  };
  try {
    await t.test(
      "scenario routes enforce identity, membership, input and explicit enablement",
      async () => {
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/api/operator/demo/scenarios",
              payload: request,
            })
          ).statusCode,
          401,
        );
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/api/operator/demo/scenarios",
              headers,
              payload: { ...request, room_id: "other_room" },
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await app.inject({
              url: "/api/operator/dashboard?facility_id=other",
              headers,
            })
          ).statusCode,
          403,
        );
        await assert.rejects(
          createDemoStore(pool, { ...options, enabled: false }).instantiate(
            subject,
            randomUUID(),
            request,
          ),
          /demo_scenarios_disabled/,
        );
        await assert.rejects(
          store.instantiate(
            "22222222-2222-4222-8222-222222222222",
            randomUUID(),
            request,
          ),
          /forbidden/,
        );
        await assert.rejects(
          createDemoStore(pool, { ...options, phone: undefined }).instantiate(
            subject,
            randomUUID(),
            request,
          ),
          /demo_recipient_not_configured/,
        );
      },
    );
    await t.test(
      "concurrent UI retries create exactly one canonical event, incident and durable job without dispatch",
      async () => {
        const [a, b] = await Promise.all([
          app.inject({
            method: "POST",
            url: "/api/operator/demo/scenarios",
            headers,
            payload: request,
          }),
          app.inject({
            method: "POST",
            url: "/api/operator/demo/scenarios",
            headers,
            payload: request,
          }),
        ]);
        assert.equal(a.statusCode, 201, a.body);
        assert.equal(b.statusCode, 201, b.body);
        const result = a.json();
        assert.deepEqual(result, b.json());
        const rows = await pool.query(
          `SELECT e.payload FROM public.inference_events e JOIN public.incidents i ON i.event_id=e.event_id JOIN public.explanation_jobs j ON j.incident_id=i.id WHERE i.id=$1`,
          [result.incident_id],
        );
        assert.equal(rows.rowCount, 1);
        assert.ok(isInferenceEvent(rows.rows[0].payload));
        assert.match(rows.rows[0].payload.event_id, /^synthetic_dashboard_/);
        assert.equal(
          (
            await pool.query(
              "SELECT 1 FROM public.notification_calls WHERE incident_id=$1",
              [result.incident_id],
            )
          ).rowCount,
          0,
        );
        const list = await app.inject({
          url: "/api/operator/incidents?facility_id=demo_facility&include_explanation=true",
          headers,
        });
        assert.equal(list.statusCode, 200);
        assert.ok(
          list
            .json()
            .incidents.some((i: { id: string }) => i.id === result.incident_id),
        );
        const workflow = await createCallStore(pool).workflow(
          subject,
          result.incident_id,
        );
        assert.equal(workflow.patient_id, "dashboard_resident_104");
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/api/operator/demo/scenarios",
              headers,
              payload: { ...request, scenario: "fallback" },
            })
          ).statusCode,
          409,
        );
      },
    );
    await t.test(
      "fixture provisioning preserves actual Pi identity and revoked consent; snapshots omit private phone",
      async () => {
        await pool.query(
          "INSERT INTO public.devices(id,room_id) VALUES('1','101') ON CONFLICT(id) DO NOTHING",
        );
        await pool.query(
          "UPDATE public.family_contacts SET consent_status='revoked',imessage_consent_status='revoked' WHERE patient_id='dashboard_resident_104'",
        );
        await store.instantiate(subject, randomUUID(), {
          ...request,
          scenario: "empty",
        });
        const snapshot = await app.inject({
          url: "/api/operator/dashboard?facility_id=demo_facility",
          headers,
        });
        assert.equal(snapshot.statusCode, 200, snapshot.body);
        assert.ok(
          snapshot.json().rooms.every((r: unknown) => validateDashboardRoom(r)),
        );
        const rooms = snapshot.json().rooms;
        assert.equal(
          rooms.find((r: { id: string }) => r.id === "101").device_id,
          "1",
        );
        assert.equal(
          rooms.find((r: { id: string }) => r.id === "104").voice_consent,
          false,
        );
        assert.equal(
          rooms.find((r: { id: string }) => r.id === "104").messaging_consent,
          false,
        );
        assert.equal(
          rooms.find((r: { id: string }) => r.id === "104").monitoring_status,
          "monitoring",
        );
        assert.ok(!snapshot.body.includes(options.phone));
      },
    );
    await t.test(
      "forced fallback is labeled synthetic; outage and empty markers never forge hardware health or erase incidents",
      async () => {
        const result = await store.instantiate(subject, randomUUID(), {
          ...request,
          scenario: "fallback",
        });
        const row = (
          await pool.query(
            "SELECT x.source,x.model,j.state FROM public.explanations x JOIN public.explanation_jobs j USING(incident_id) WHERE x.incident_id=$1",
            [result.incident_id],
          )
        ).rows[0];
        assert.deepEqual(row, {
          source: "deterministic",
          model: "synthetic-forced-fallback",
          state: "fallback",
        });
        const before = (
          await pool.query("SELECT count(*) AS n FROM public.incidents")
        ).rows[0].n;
        const health = (
          await pool.query(
            "SELECT * FROM public.device_health ORDER BY device_id",
          )
        ).rows;
        for (const scenario of ["offline", "empty"] as const)
          assert.equal(
            (
              await store.instantiate(subject, randomUUID(), {
                ...request,
                scenario,
              })
            ).incident_id,
            null,
          );
        assert.equal(
          (await pool.query("SELECT count(*) AS n FROM public.incidents"))
            .rows[0].n,
          before,
        );
        assert.deepEqual(
          (
            await pool.query(
              "SELECT * FROM public.device_health ORDER BY device_id",
            )
          ).rows,
          health,
        );
        await assert.rejects(
          withTransaction(pool, async (c) => {
            await c.query("SET LOCAL ROLE authenticated");
            await c.query("SELECT * FROM public.dashboard_scenarios");
          }),
          /permission denied/,
        );
      },
    );
    await t.test(
      "failure after event creation rolls back scenario, incident and pending work",
      async () => {
        const before = (
          await pool.query("SELECT count(*) AS n FROM public.inference_events")
        ).rows[0].n;
        await pool.query(
          `CREATE FUNCTION public.reject_scenario_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic scenario failure'; END $$; CREATE TRIGGER reject_scenario_test BEFORE INSERT ON public.dashboard_scenarios FOR EACH ROW EXECUTE FUNCTION public.reject_scenario_test()`,
        );
        try {
          await assert.rejects(
            store.instantiate(subject, randomUUID(), request),
            /synthetic scenario failure/,
          );
        } finally {
          await pool.query(
            "DROP TRIGGER reject_scenario_test ON public.dashboard_scenarios; DROP FUNCTION public.reject_scenario_test()",
          );
        }
        assert.equal(
          (
            await pool.query(
              "SELECT count(*) AS n FROM public.inference_events",
            )
          ).rows[0].n,
          before,
        );
      },
    );
    await t.test(
      "looped healthy streams are bounded, distinguish synthetic data, respect offline overrides and never touch room 101",
      async () => {
        const before = (
          await pool.query("SELECT count(*)::int AS n FROM public.incidents")
        ).rows[0].n;
        const health = (
          await pool.query(
            "SELECT * FROM public.device_health ORDER BY device_id",
          )
        ).rows;
        await pool.query(
          "UPDATE public.demo_room_streams SET mode='healthy',sampled_at=NULL",
        );
        await tickDemoStreams(pool, options.facilityId);
        let rooms = await store.rooms(subject, options.facilityId);
        assert.equal(rooms.find((r) => r.id === "101")?.data_source, "device");
        assert.ok(
          rooms
            .filter((r) => ["102", "103", "104", "105", "106"].includes(r.id))
            .every(
              (r) =>
                r.data_source === "synthetic" &&
                r.monitoring_status === "monitoring",
            ),
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM public.demo_room_streams",
            )
          ).rows[0].n,
          5,
        );
        for (let i = 0; i < 7; i++) {
          await pool.query(
            "UPDATE public.demo_room_streams SET sampled_at=now()-interval '20 seconds'",
          );
          await tickDemoStreams(pool, options.facilityId);
        }
        assert.equal(
          (await pool.query("SELECT count(*)::int AS n FROM public.incidents"))
            .rows[0].n,
          before,
        );
        assert.deepEqual(
          (
            await pool.query(
              "SELECT * FROM public.device_health ORDER BY device_id",
            )
          ).rows,
          health,
        );
        await pool.query(
          "UPDATE public.demo_room_streams SET mode='offline' WHERE room_id='106'",
        );
        await tickDemoStreams(pool, options.facilityId);
        assert.equal(
          (await store.rooms(subject, options.facilityId)).find(
            (r) => r.id === "106",
          )?.monitoring_status,
          "offline",
        );
        await store.reset(subject, randomUUID(), "106", options.facilityId);
        assert.equal(
          (await store.rooms(subject, options.facilityId)).find(
            (r) => r.id === "106",
          )?.monitoring_status,
          "monitoring",
        );
        // A newly registered physical device immediately wins over an existing synthetic stream.
        await pool.query(
          "INSERT INTO public.devices(id,room_id) VALUES('real_105','105')",
        );
        await pool.query(
          "INSERT INTO public.device_credentials(token_hash,device_id) VALUES($1,'real_105')",
          [credentialHash("hardware-test")],
        );
        rooms = await store.rooms(subject, options.facilityId);
        assert.equal(rooms.find((r) => r.id === "105")?.data_source, "device");
        assert.equal(
          rooms.find((r) => r.id === "105")?.monitoring_status,
          "offline",
        );
        await assert.rejects(
          withTransaction(pool, async (c) => {
            await c.query("SET LOCAL ROLE authenticated");
            await c.query("SELECT * FROM public.demo_room_streams");
          }),
          /permission denied/,
        );
      },
    );
    await t.test(
      "room archive is scoped, atomic, authorized and idempotent; Pi retry IDs stay deduplicated and new events survive",
      async () => {
        await pool.query(
          "INSERT INTO public.devices(id,room_id) VALUES('reset_pi','101')",
        );
        const hash = credentialHash("reset-device-test");
        await pool.query(
          "INSERT INTO public.device_credentials(token_hash,device_id) VALUES($1,'reset_pi')",
          [hash],
        );
        const devices = createDeviceStore(pool);
        const event = {
          event_id: "reset_pi_event",
          device_id: "reset_pi",
          room_id: "101",
          event_type: "inference_result",
          confidence_scores: { fall: 0.91, non_fall: 0.09 },
          detected_at: new Date().toISOString(),
          sensor_status: "connected",
        } as const;
        const ack = await devices.ingest(hash, event);
        const other = await withTransaction(pool, (c) =>
          persistInferenceEvent(
            c,
            {
              device_id: "dashboard_sim_104",
              room_id: "104",
              facility_id: options.facilityId,
            },
            {
              ...event,
              event_id: "other_room_preserved",
              device_id: "dashboard_sim_104",
              room_id: "104",
            },
          ),
        );
        const key = randomUUID();
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/api/operator/rooms/101/reset",
              payload: { facility_id: options.facilityId },
            })
          ).statusCode,
          401,
        );
        await assert.rejects(
          store.reset(
            "22222222-2222-4222-8222-222222222222",
            randomUUID(),
            "101",
            options.facilityId,
          ),
          /forbidden/,
        );
        const result = await store.reset(
          subject,
          key,
          "101",
          options.facilityId,
        );
        assert.ok((result.archived_incidents ?? 0) >= 1);
        assert.deepEqual(
          await store.reset(subject, key, "101", options.facilityId),
          result,
        );
        assert.equal(
          await createStore(pool).getIncident(subject, ack.incident_id),
          null,
        );
        assert.ok(
          await createStore(pool).getIncident(subject, other.incident_id),
        );
        assert.equal((await devices.ingest(hash, event)).status, "duplicate");
        const next = await devices.ingest(hash, {
          ...event,
          event_id: "reset_pi_next_event",
        });
        assert.ok(
          await createStore(pool).getIncident(subject, next.incident_id),
        );
        assert.deepEqual(
          await store.reset(subject, key, "101", options.facilityId),
          result,
        );
        assert.ok(
          await createStore(pool).getIncident(subject, next.incident_id),
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM public.demo_room_streams WHERE room_id='101'",
            )
          ).rows[0].n,
          0,
        );
        await withTransaction(pool, async (c) => {
          await c.query("SET LOCAL ROLE authenticated");
          await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
            subject,
          ]);
          assert.equal(
            (
              await c.query("SELECT id FROM public.incidents WHERE id=$1", [
                ack.incident_id,
              ])
            ).rowCount,
            0,
          );
        });
        await pool.query(
          "CREATE FUNCTION public.fail_reset_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='room_reset' THEN RAISE EXCEPTION 'reset rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_reset_test BEFORE INSERT ON public.operator_audit FOR EACH ROW EXECUTE FUNCTION public.fail_reset_test()",
        );
        try {
          await assert.rejects(
            store.reset(subject, randomUUID(), "101", options.facilityId),
            /reset rollback/,
          );
        } finally {
          await pool.query(
            "DROP TRIGGER fail_reset_test ON public.operator_audit; DROP FUNCTION public.fail_reset_test()",
          );
        }
        assert.ok(
          await createStore(pool).getIncident(subject, next.incident_id),
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM public.notification_calls WHERE incident_id=ANY($1::uuid[])",
              [[ack.incident_id, next.incident_id]],
            )
          ).rows[0].n,
          0,
        );
        await pool.query(
          "UPDATE public.incidents SET status='resolved' WHERE id=$1",
          [next.incident_id],
        );
        assert.ok(
          (await createStore(pool).getIncident(subject, next.incident_id))
            ?.resolved_at,
        );
      },
    );
  } finally {
    await app.close();
  }
}
