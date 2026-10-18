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
          "offline",
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
  } finally {
    await app.close();
  }
}
