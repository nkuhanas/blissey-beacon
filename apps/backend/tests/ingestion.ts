import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import type { TestContext } from "node:test";
import WebSocket from "ws";
import { generateKeyPair, SignJWT } from "jose";
import { validateAck, validateIncident } from "@blissey/contracts";
import { createApp } from "../src/app.js";
import { createStore } from "../src/db.js";
import { createOperatorVerifier } from "../src/auth.js";
import { createDeviceStore, credentialHash } from "../src/ingestion/store.js";
type Reply = {
  type: string;
  event_id: string;
  incident_id?: string;
  status?: string;
  code?: string;
  retryable?: boolean;
};
const token = "synthetic-device-token-102-aaaaaaaaaaaa";
const otherToken = "synthetic-device-token-202-bbbbbbbbbbbb";
const subject = "11111111-1111-4111-8111-111111111111";
const issuer = "https://synthetic.supabase.test/auth/v1";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function response(socket: WebSocket): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket response timeout"));
    }, 4000);
    const message = (raw: WebSocket.RawData) => {
      cleanup();
      resolve(JSON.parse(raw.toString()));
    };
    const error = (err: Error) => {
      cleanup();
      reject(err);
    };
    function cleanup() {
      clearTimeout(timer);
      socket.off("message", message);
      socket.off("error", error);
    }
    socket.once("message", message);
    socket.once("error", error);
  });
}
async function exchange(socket: WebSocket, payload: unknown) {
  const result = response(socket);
  socket.send(typeof payload === "string" ? payload : JSON.stringify(payload));
  return result;
}
export async function runIngestionTests(t: TestContext, pool: Pool) {
  const fixtures = JSON.parse(
    await readFile(
      new URL(
        "../../../packages/contracts/fixtures/inference-events.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const base = fixtures.find((f: { valid: boolean }) => f.valid).payload;
  const event = (id: string) => ({ ...base, event_id: id });
  await pool.query("TRUNCATE public.inference_events CASCADE");
  await pool.query(
    "INSERT INTO public.devices(id,room_id) VALUES ('pi_202','other_room')",
  );
  await pool.query(
    "INSERT INTO public.device_credentials(token_hash,device_id) VALUES ($1,$2),($3,$4)",
    [credentialHash(token), "pi_102", credentialHash(otherToken), "pi_202"],
  );
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwt = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(subject)
    .setIssuer(issuer)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);
  const build = () =>
    createApp({
      webOrigin: "http://localhost:5173",
      store: createStore(pool),
      devices: createDeviceStore(pool),
      verifyOperator: createOperatorVerifier(
        issuer,
        "authenticated",
        publicKey,
      ),
    });
  let app = await build();
  await app.listen({ host: "127.0.0.1", port: 0 });
  let url = `ws://127.0.0.1:${(app.server.address() as { port: number }).port}/api/devices/v1/stream`;
  const sockets: WebSocket[] = [];
  async function connect(credential = token) {
    const socket = new WebSocket(url, {
      headers: { authorization: `Bearer ${credential}` },
    });
    sockets.push(socket);
    await once(socket, "open");
    return socket;
  }
  async function counts(id: string) {
    const r = await pool.query(
      `SELECT (SELECT count(*)::int FROM public.inference_events WHERE event_id=$1) AS events,
   (SELECT count(*)::int FROM public.incidents WHERE event_id=$1) AS incidents,
   (SELECT count(*)::int FROM public.explanation_jobs j JOIN public.incidents i ON i.id=j.incident_id WHERE i.event_id=$1) AS jobs`,
      [id],
    );
    return r.rows[0];
  }
  const one = { events: 1, incidents: 1, jobs: 1 };
  const zero = { events: 0, incidents: 0, jobs: 0 };
  const headers = { authorization: `Bearer ${jwt}` };
  try {
    await t.test(
      "unauthenticated, unknown and revoked credentials cannot upgrade",
      async () => {
        for (const credential of [
          "",
          "invalid-but-long-enough-device-token-aaaaaaaa",
        ]) {
          const socket = new WebSocket(url, {
            headers: credential
              ? { authorization: `Bearer ${credential}` }
              : {},
          });
          const status = await new Promise<number>((resolve, reject) => {
            socket.on("unexpected-response", (_req, res) => {
              res.resume();
              resolve(res.statusCode!);
              socket.terminate();
            });
            socket.on("open", () =>
              reject(new Error("Unauthorized upgrade accepted")),
            );
            socket.on("error", () => {});
          });
          assert.equal(status, 401);
        }
      },
    );
    const socket = await connect();
    await t.test(
      "malformed canonical fixtures, JSON, extra fields and identities reject without writes",
      async () => {
        assert.equal((await exchange(socket, "{")).code, "invalid_payload");
        for (const fixture of fixtures.filter(
          (f: { valid: boolean }) => !f.valid,
        ))
          assert.equal(
            (await exchange(socket, fixture.payload)).code,
            "invalid_payload",
          );
        for (const mismatch of [
          { device_id: "pi_202" },
          { room_id: "other_room" },
        ])
          assert.equal(
            (await exchange(socket, { ...event("mismatch"), ...mismatch }))
              .code,
            "identity_mismatch",
          );
        assert.deepEqual(await counts("mismatch"), zero);
      },
    );
    let incidentId = "";
    await t.test(
      "valid event commits exactly one event/incident/job and is readable via authorized operator API",
      async () => {
        const ack = await exchange(socket, event("valid"));
        assert.equal(validateAck(ack), true);
        assert.equal(ack.status, "accepted");
        incidentId = ack.incident_id!;
        assert.deepEqual(await counts("valid"), one);
        const detail = await app.inject({
          url: `/api/operator/incidents/${incidentId}`,
          headers,
        });
        assert.equal(detail.statusCode, 200);
        const incident = detail.json().incident;
        assert.equal(validateIncident(incident), true);
        assert.equal(incident.event_id, "valid");
        assert.equal(incident.explanation_status, "pending");
        assert.deepEqual(incident.allowed_actions, []);
        const list = await app.inject({
          url: "/api/operator/incidents?facility_id=demo_facility",
          headers,
        });
        assert.equal(list.statusCode, 200);
        assert.equal(list.json().incidents[0].id, incidentId);
        assert.equal(
          (await app.inject(`/api/operator/incidents/${incidentId}`))
            .statusCode,
          401,
        );
        assert.equal(
          (
            await app.inject({
              url: "/api/operator/incidents?facility_id=other",
              headers,
            })
          ).statusCode,
          403,
        );
        const forbidden = await new SignJWT({ role: "authenticated" })
          .setProtectedHeader({ alg: "ES256" })
          .setSubject("22222222-2222-4222-8222-222222222222")
          .setIssuer(issuer)
          .setAudience("authenticated")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey);
        assert.equal(
          (
            await app.inject({
              url: `/api/operator/incidents/${incidentId}`,
              headers: { authorization: `Bearer ${forbidden}` },
            })
          ).statusCode,
          404,
        );
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          await c.query("SET LOCAL ROLE authenticated");
          await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
            subject,
          ]);
          assert.equal(
            (
              await c.query("SELECT * FROM public.incidents WHERE id=$1", [
                incidentId,
              ])
            ).rowCount,
            1,
          );
          await c.query(
            "SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true)",
          );
          assert.equal(
            (
              await c.query("SELECT * FROM public.incidents WHERE id=$1", [
                incidentId,
              ])
            ).rowCount,
            0,
          );
          await c.query("ROLLBACK");
        } finally {
          c.release();
        }
      },
    );
    await t.test(
      "duplicate delivery across sockets is durable; conflicts and cross-device ID reuse reject",
      async () => {
        const duplicate = await exchange(socket, event("valid"));
        assert.equal(duplicate.status, "duplicate");
        assert.equal(duplicate.incident_id, incidentId);
        assert.equal(
          (
            await exchange(socket, {
              ...event("valid"),
              confidence_scores: { fall: 0.8, non_fall: 0.2 },
            })
          ).code,
          "event_id_conflict",
        );
        const other = await connect(otherToken);
        assert.equal(
          (
            await exchange(other, {
              ...event("valid"),
              device_id: "pi_202",
              room_id: "other_room",
            })
          ).code,
          "event_id_conflict",
        );
        const second = await connect();
        const pair = await Promise.all([
          exchange(socket, event("concurrent")),
          exchange(second, event("concurrent")),
        ]);
        assert.deepEqual(pair.map((x) => x.status).sort(), [
          "accepted",
          "duplicate",
        ]);
        assert.equal(pair[0]!.incident_id, pair[1]!.incident_id);
        assert.deepEqual(await counts("concurrent"), one);
        assert.deepEqual(await counts("valid"), one);
        const page = await app.inject({
          url: "/api/operator/incidents?facility_id=demo_facility&limit=1",
          headers,
        });
        assert.equal(page.json().incidents.length, 1);
        assert.ok(page.json().next_cursor);
        const next = await app.inject({
          url: `/api/operator/incidents?facility_id=demo_facility&limit=1&cursor=${page.json().next_cursor}`,
          headers,
        });
        assert.equal(next.json().incidents.length, 1);
        assert.notEqual(
          page.json().incidents[0].id,
          next.json().incidents[0].id,
        );
        assert.equal(
          (
            await app.inject({
              url: "/api/operator/incidents?facility_id=demo_facility&limit=101",
              headers,
            })
          ).statusCode,
          400,
        );
      },
    );
    await pool.query(`CREATE FUNCTION public.test_commit_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   IF NEW.event_id='commit-gate' THEN PERFORM pg_advisory_xact_lock(1723102); END IF;
   IF NEW.event_id='commit-fail' THEN RAISE EXCEPTION 'synthetic commit failure'; END IF; RETURN NEW; END $$;
   CREATE CONSTRAINT TRIGGER test_commit_gate AFTER INSERT ON public.incidents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.test_commit_gate();`);
    await t.test(
      "no acknowledgment or visible incident before commit; commit-time failure rolls all writes back",
      async () => {
        const gate = await pool.connect();
        await gate.query("SELECT pg_advisory_lock(1723102)");
        let received = false;
        const observe = () => {
          received = true;
        };
        socket.on("message", observe);
        const ack = response(socket);
        socket.send(JSON.stringify(event("commit-gate")));
        try {
          let waiting = false;
          for (let i = 0; i < 100; i++) {
            if (
              (
                await pool.query(
                  "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=1723102 AND NOT granted",
                )
              ).rowCount
            ) {
              waiting = true;
              break;
            }
            await delay(10);
          }
          assert.equal(
            waiting,
            true,
            "transaction reached deferred commit gate",
          );
          assert.equal(received, false);
          assert.deepEqual(await counts("commit-gate"), zero);
        } finally {
          await gate.query("SELECT pg_advisory_unlock(1723102)");
          gate.release();
          socket.off("message", observe);
        }
        assert.equal((await ack).status, "accepted");
        assert.deepEqual(await counts("commit-gate"), one);
        const failure = await exchange(socket, event("commit-fail"));
        assert.equal(failure.type, "error");
        assert.equal(failure.code, "storage_unavailable");
        assert.equal(failure.retryable, true);
        assert.deepEqual(await counts("commit-fail"), zero);
      },
    );
    await pool.query(
      "DROP TRIGGER test_commit_gate ON public.incidents; DROP FUNCTION public.test_commit_gate()",
    );
    await t.test(
      "retry after failed commit succeeds, and reconnect after lost ACK deduplicates",
      async () => {
        assert.equal(
          (await exchange(socket, event("commit-fail"))).status,
          "accepted",
        );
        assert.deepEqual(await counts("commit-fail"), one);
        const lost = await connect();
        lost.send(JSON.stringify(event("lost-ack")));
        // No application ACK listener: wait for durable state, drop the connection,
        // and retry the exact payload. The retry must find the committed incident.
        for (let n = 0; n < 100; n++) {
          if ((await counts("lost-ack")).events === 1) break;
          await delay(10);
        }
        assert.deepEqual(await counts("lost-ack"), one);
        lost.terminate();
        const retried = await exchange(await connect(), event("lost-ack"));
        assert.equal(retried.status, "duplicate");
        assert.deepEqual(await counts("lost-ack"), one);
      },
    );
    await t.test(
      "device health persists separately, mismatched identity rejects, stale/fault states stay visible",
      async () => {
        const health = {
          type: "device_health",
          device_id: "pi_102",
          room_id: "room_102",
          sent_at: "2026-10-17T22:00:00Z",
          sensor_status: "degraded",
          model_status: "error",
          last_valid_frame_at: null,
          outbox_depth: 2,
          dropped_event_count: 1,
          clock_synced: false,
        };
        socket.send(JSON.stringify(health));
        // An event queued immediately after health acts as an ordered barrier; health never emits event_ack.
        const ack = await exchange(socket, event("health-barrier"));
        assert.equal(ack.event_id, "health-barrier");
        const data = (
          await app.inject({
            url: "/api/devices/status?facility_id=demo_facility",
            headers,
          })
        ).json().devices[0];
        assert.equal(data.monitoring_status, "degraded");
        assert.equal(data.dropped_event_count, 1);
        assert.equal(data.clock_synced, false);
        assert.equal(
          (await exchange(socket, { ...health, room_id: "other_room" })).code,
          "identity_mismatch",
        );
        await pool.query(
          "UPDATE public.device_health SET received_at=now()-interval '31 seconds'",
        );
        assert.equal(
          (
            await app.inject({
              url: "/api/devices/status?facility_id=demo_facility",
              headers,
            })
          ).json().devices[0].monitoring_status,
          "offline",
        );
      },
    );
    await t.test(
      "revocation and room reassignment are enforced on established connections",
      async () => {
        const moved = await connect(otherToken);
        await pool.query(
          "UPDATE public.devices SET room_id='room_102' WHERE id='pi_202'",
        );
        assert.equal(
          (
            await exchange(moved, {
              ...event("reassigned"),
              device_id: "pi_202",
              room_id: "other_room",
            })
          ).code,
          "identity_mismatch",
        );
        assert.deepEqual(await counts("reassigned"), zero);
        await pool.query(
          "UPDATE public.devices SET room_id='other_room' WHERE id='pi_202'",
        );
        await pool.query(
          "UPDATE public.device_credentials SET revoked_at=now() WHERE token_hash=$1",
          [credentialHash(otherToken)],
        );
        const revoked = new WebSocket(url, {
          headers: { authorization: `Bearer ${otherToken}` },
        });
        const status = await new Promise<number>((resolve) => {
          revoked.on("unexpected-response", (_req, res) => {
            res.resume();
            resolve(res.statusCode!);
            revoked.terminate();
          });
          revoked.on("error", () => {});
        });
        assert.equal(status, 401);
        await pool.query(
          "UPDATE public.device_credentials SET revoked_at=now() WHERE token_hash=$1",
          [credentialHash(token)],
        );
        assert.equal(
          (await exchange(socket, event("revoked"))).code,
          "unauthorized_device",
        );
        assert.deepEqual(await counts("revoked"), zero);
        await pool.query(
          "UPDATE public.device_credentials SET revoked_at=NULL WHERE token_hash=$1",
          [credentialHash(token)],
        );
      },
    );
    await t.test(
      "backend restart retains deduplication and pending explanation work",
      async () => {
        for (const s of sockets) s.terminate();
        await app.close();
        app = await build();
        await app.listen({ host: "127.0.0.1", port: 0 });
        url = `ws://127.0.0.1:${(app.server.address() as { port: number }).port}/api/devices/v1/stream`;
        const reply = await exchange(await connect(), event("valid"));
        assert.equal(reply.status, "duplicate");
        assert.equal(reply.incident_id, incidentId);
        assert.deepEqual(await counts("valid"), one);
      },
    );
  } finally {
    for (const s of sockets) s.terminate();
    await app.close();
  }
}
