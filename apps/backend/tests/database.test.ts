import { runNotificationTests } from "./notification-database.js";
import { runExplanationTests } from "./explanation-database.js";
import { runIngestionTests } from "./ingestion.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { withTransaction, createStore } from "../src/db.js";
// Deliberately requires an empty disposable database. Never point this at hosted data.
const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "TEST_DATABASE_URL is required; use docker compose run --rm verify",
  );
const pool = new Pool({ connectionString: url });
const root = new URL("../../../", import.meta.url);
const user = "11111111-1111-4111-8111-111111111111";
test("migration, publication, scoped RLS and real multi-statement rollback", async (t) => {
  try {
    await pool.query(
      await readFile(new URL("supabase/tests/bootstrap.sql", root), "utf8"),
    );
    await pool.query(
      await readFile(
        new URL("supabase/migrations/20261017221000_foundation.sql", root),
        "utf8",
      ),
    );
    await pool.query(
      await readFile(new URL("supabase/seed.sql", root), "utf8"),
    );
    await pool.query("INSERT INTO auth.users(id) VALUES ($1);", [user]);
    await pool.query(
      "INSERT INTO public.facility_memberships VALUES ($1,'demo_facility')",
      [user],
    );
    await pool.query(
      "INSERT INTO public.facilities VALUES ('other','Other'); INSERT INTO public.rooms(id,facility_id,label) VALUES ('other_room','other','Other room')",
    );
    await withTransaction(pool, async (client) => {
      await client.query("SET LOCAL ROLE authenticated");
      await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
        user,
      ]);
      assert.equal(
        (await client.query("SELECT * FROM public.rooms")).rowCount,
        1,
      );
      assert.equal(
        (await client.query("SELECT * FROM public.patients")).rowCount,
        1,
      );
      assert.equal(
        (await client.query("SELECT * FROM public.room_assignments")).rowCount,
        1,
      );
    });
    await withTransaction(pool, async (client) => {
      await client.query("SET LOCAL ROLE authenticated");
      await client.query(
        "SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true)",
      );
      assert.equal(
        (await client.query("SELECT * FROM public.rooms")).rowCount,
        0,
      );
    });
    await assert.rejects(
      withTransaction(pool, async (c) => {
        await c.query("SET LOCAL ROLE anon");
        await c.query("SELECT * FROM public.rooms");
      }),
      /permission denied/,
    );
    await assert.rejects(
      withTransaction(pool, async (c) => {
        await c.query("SET LOCAL ROLE authenticated");
        await c.query("SELECT * FROM public.explanation_jobs");
      }),
      /permission denied/,
    );
    await assert.rejects(
      withTransaction(pool, async (c) => {
        await c.query("SET LOCAL ROLE authenticated");
        await c.query(
          "INSERT INTO public.rooms(id,facility_id,label) VALUES ('bad','demo_facility','Bad')",
        );
      }),
      /permission denied/,
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO public.room_assignments(facility_id,room_id,patient_id,assigned_at,released_at) VALUES ('other','other_room','demo_resident_102','2026-10-01','2026-10-02')",
      ),
      /foreign key/,
    );
    const publication = await pool.query(
      "SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY tablename",
    );
    assert.deepEqual(
      publication.rows.map((r) => r.tablename),
      ["incidents", "rooms"],
    );
    const persist = async (fail: boolean) =>
      withTransaction(pool, async (c) => {
        await c.query(
          "INSERT INTO public.inference_events(event_id,device_id,room_id,payload,detected_at) VALUES ('synthetic','pi_102','room_102','{}',now())",
        );
        const incident = await c.query(
          "INSERT INTO public.incidents(event_id,room_id) VALUES ('synthetic','room_102') RETURNING id",
        );
        await c.query(
          "INSERT INTO public.explanation_jobs(incident_id) VALUES ($1)",
          [incident.rows[0].id],
        );
        if (fail) throw new Error("synthetic failure after all writes");
      });
    await assert.rejects(persist(true), /synthetic failure/);
    for (const table of ["inference_events", "incidents", "explanation_jobs"])
      assert.equal(
        (await pool.query(`SELECT * FROM public.${table}`)).rowCount,
        0,
      );
    await persist(false);
    await assert.rejects(persist(false), /duplicate key/);
    for (const table of ["inference_events", "incidents", "explanation_jobs"])
      assert.equal(
        (await pool.query(`SELECT * FROM public.${table}`)).rowCount,
        1,
      );
    assert.equal(await createStore(pool).isMember(user, "other"), false);
    await pool.query(
      await readFile(
        new URL(
          "supabase/migrations/20261017230000_slice2_ingestion.sql",
          root,
        ),
        "utf8",
      ),
    );
    await pool.query(
      await readFile(
        new URL("supabase/migrations/20261018001000_explanations.sql", root),
        "utf8",
      ),
    );
    await runIngestionTests(t, pool);
    await runExplanationTests(t, pool);
    await pool.query(
      await readFile(
        new URL("supabase/migrations/20261018022000_family_calls.sql", root),
        "utf8",
      ),
    );
    await runNotificationTests(t, pool);
  } finally {
    await pool.end();
  }
});
