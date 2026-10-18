import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { Pool } from "pg";
import { syntheticEvent } from "@blissey/simulator";
import { createDeviceStore, credentialHash } from "../src/ingestion/store.js";
import { createStore, withTransaction } from "../src/db.js";
import { createExplanationStore } from "../src/explanations/store.js";
import { wording, fallback } from "../src/explanations/content.js";
import {
  runExplanationOnce,
  startExplanationWorker,
} from "../src/explanations/worker.js";
import { GenerationError, type Generate } from "../src/explanations/gemini.js";
const token = "synthetic-explanation-device-credential-102";
const subject = "11111111-1111-4111-8111-111111111111";
export const syntheticGenerate: Generate = async (facts) => {
  const w = wording(facts);
  return {
    output: {
      event_id: facts.event_id,
      title: w.title[0]!,
      description: w.description[0]!,
      recommended_action: w.recommended_action[0]!,
    },
    model: "synthetic-response-not-live-Gemini",
  };
};
export async function runExplanationTests(t: TestContext, pool: Pool) {
  await pool.query(
    "INSERT INTO public.device_credentials(token_hash,device_id) VALUES($1,'pi_102') ON CONFLICT DO NOTHING",
    [credentialHash(token)],
  );
  const devices = createDeviceStore(pool);
  const api = createStore(pool);
  const signal = new AbortController().signal;
  async function reset(id: string) {
    await pool.query("TRUNCATE public.inference_events CASCADE");
    return devices.ingest(credentialHash(token), await syntheticEvent(id));
  }
  const store = () => createExplanationStore(pool, { retryMs: 0 });
  const expire = () =>
    pool.query(
      "UPDATE public.explanation_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE state='processing'",
    );
  await t.test(
    "concurrent claims, ready persistence, authorized reads, internal-table RLS and idempotent completion",
    async () => {
      const ack = await reset("synthetic_explanation_ready");
      assert.equal(
        (await api.getIncident(subject, ack.incident_id, true))?.explanation,
        null,
      );
      const results = await Promise.all([store().claim(), store().claim()]);
      const claims = results.filter((c) => c !== null);
      assert.equal(claims.length, 1);
      const claim = claims[0]!;
      const g = await syntheticGenerate(claim.facts!, signal);
      assert.equal(await store().complete(claim, g, "ready"), true);
      assert.equal(await store().complete(claim, g, "ready"), false);
      assert.equal(
        "explanation" in (await api.getIncident(subject, ack.incident_id))!,
        false,
      );
      const incident = await api.getIncident(subject, ack.incident_id, true);
      assert.equal(incident?.explanation_status, "ready");
      assert.deepEqual(incident?.explanation, g.output);
      assert.equal(incident?.revision, 2);
      assert.equal(
        await api.getIncident(
          "22222222-2222-4222-8222-222222222222",
          ack.incident_id,
        ),
        null,
      );
      const trace = (
        await pool.query(
          "SELECT input_hash,model,prompt_version,source FROM public.explanations",
        )
      ).rows[0];
      assert.match(trace.input_hash, /^[a-f0-9]{64}$/);
      assert.equal(trace.source, "gemini");
      for (const role of ["anon", "authenticated"])
        await assert.rejects(
          withTransaction(pool, async (c) => {
            await c.query(`SET LOCAL ROLE ${role}`);
            await c.query("SELECT * FROM public.explanations");
          }),
          /permission denied/,
        );
    },
  );
  await t.test(
    "completion commit failure rolls back explanation, job status and incident revision together",
    async () => {
      const ack = await reset("synthetic_explanation_rollback");
      const claim = (await store().claim())!;
      const g = await syntheticGenerate(claim.facts!, signal);
      await pool.query(
        "CREATE FUNCTION public.fail_explanation_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_completion_failure'; END $$; CREATE CONSTRAINT TRIGGER fail_explanation_commit AFTER UPDATE ON public.incidents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fail_explanation_commit()",
      );
      try {
        await assert.rejects(
          store().complete(claim, g, "ready"),
          /synthetic_completion_failure/,
        );
      } finally {
        await pool.query(
          "DROP TRIGGER fail_explanation_commit ON public.incidents; DROP FUNCTION public.fail_explanation_commit()",
        );
      }
      assert.equal(
        (await pool.query("SELECT * FROM public.explanations")).rowCount,
        0,
      );
      assert.equal(
        (await api.getIncident(subject, ack.incident_id, true))
          ?.explanation_status,
        "pending",
      );
      assert.equal(
        (await api.getIncident(subject, ack.incident_id, true))?.revision,
        1,
      );
      assert.equal(await store().complete(claim, g, "ready"), true);
    },
  );
  await t.test(
    "restart reclaims expired leases with frozen input; stale owners cannot complete or reschedule",
    async () => {
      await reset("synthetic_explanation_lease");
      const old = (await store().claim())!;
      await pool.query(
        "UPDATE public.rooms SET label='Changed label' WHERE id='room_102'",
      );
      await expire();
      try {
        const fresh = (await store().claim())!;
        assert.notEqual(fresh.token, old.token);
        assert.equal(fresh.attempts, 2);
        assert.deepEqual(fresh.facts, old.facts);
        assert.equal(fresh.inputHash, old.inputHash);
        const g = await syntheticGenerate(old.facts!, signal);
        assert.equal(await store().complete(old, g, "ready"), false);
        assert.equal(await store().retry(old, "timeout"), false);
        assert.equal(await store().complete(fresh, g, "ready"), true);
      } finally {
        await pool.query(
          "UPDATE public.rooms SET label='Room 102' WHERE id='room_102'",
        );
      }
    },
  );
  await t.test(
    "transient failures retry once then persist same-schema fallback without losing the incident",
    async () => {
      const ack = await reset("synthetic_explanation_failure");
      let calls = 0;
      const fail: Generate = async () => {
        calls++;
        throw new GenerationError("timeout", true);
      };
      assert.equal(await runExplanationOnce(store(), fail, signal), true);
      assert.equal(
        (await api.getIncident(subject, ack.incident_id, true))
          ?.explanation_status,
        "pending",
      );
      await runExplanationOnce(store(), fail, signal);
      assert.equal(await runExplanationOnce(store(), fail, signal), false);
      assert.equal(calls, 2);
      const i = await api.getIncident(subject, ack.incident_id, true);
      assert.equal(i?.explanation_status, "fallback");
      assert.deepEqual(i?.explanation, fallback(i!.event_id));
      assert.deepEqual(
        (
          await pool.query(
            "SELECT state,attempts,lease_token,last_error_code FROM public.explanation_jobs",
          )
        ).rows[0],
        {
          state: "fallback",
          attempts: 2,
          lease_token: null,
          last_error_code: "timeout",
        },
      );
    },
  );
  await t.test(
    "expired final attempt falls back after restart without a third provider call",
    async () => {
      const ack = await reset("synthetic_explanation_exhausted");
      await store().claim();
      await expire();
      await store().claim();
      await expire();
      await runExplanationOnce(
        store(),
        async () => {
          throw Error("Unexpected provider call");
        },
        signal,
      );
      assert.equal(
        (await api.getIncident(subject, ack.incident_id, true))
          ?.explanation_status,
        "fallback",
      );
      assert.equal(
        (await pool.query("SELECT attempts FROM public.explanation_jobs"))
          .rows[0].attempts,
        2,
      );
    },
  );
  await t.test(
    "ungrounded or corrupt persisted input never becomes a ready explanation",
    async () => {
      const ack = await reset("synthetic_explanation_ungrounded");
      await runExplanationOnce(
        store(),
        async (facts) => ({
          output: {
            ...fallback(facts.event_id),
            description: "The resident fell beside the bed and was injured.",
          },
          model: "synthetic",
        }),
        signal,
      );
      assert.equal(
        (await api.getIncident(subject, ack.incident_id, true))
          ?.explanation_status,
        "fallback",
      );
      const damaged = await reset("synthetic_explanation_corrupt_hash");
      await store().claim();
      await pool.query(
        "UPDATE public.explanation_jobs SET input_hash='corrupt'",
      );
      await expire();
      await runExplanationOnce(
        store(),
        async () => {
          throw Error("Corrupt snapshot must not reach provider");
        },
        signal,
      );
      assert.equal(
        (await api.getIncident(subject, damaged.incident_id, true))
          ?.explanation_status,
        "fallback",
      );
      await reset("synthetic_explanation_corrupt");
      await pool.query("UPDATE public.inference_events SET payload='{}'");
      await runExplanationOnce(
        store(),
        async () => {
          throw Error("Invalid facts must not reach provider");
        },
        signal,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT last_error_code FROM public.explanation_jobs",
          )
        ).rows[0].last_error_code,
        "invalid_input",
      );
    },
  );
  await t.test(
    "shutdown aborts generation and restart recovers the durable lease",
    async () => {
      const ack = await reset("synthetic_explanation_shutdown");
      let started!: () => void;
      const entered = new Promise<void>((r) => {
        started = r;
      });
      const worker = startExplanationWorker(
        store(),
        async (_facts, abort) => {
          started();
          return new Promise((_resolve, reject) =>
            abort.addEventListener(
              "abort",
              () => reject(Error("synthetic shutdown")),
              { once: true },
            ),
          );
        },
        { error: () => assert.fail("Unexpected worker error") },
      );
      await entered;
      await worker.stop();
      assert.equal(
        (await api.getIncident(subject, ack.incident_id, true))
          ?.explanation_status,
        "pending",
      );
      await expire();
      await runExplanationOnce(store(), syntheticGenerate, signal);
      assert.equal(
        (await api.getIncident(subject, ack.incident_id, true))
          ?.explanation_status,
        "ready",
      );
    },
  );
}
