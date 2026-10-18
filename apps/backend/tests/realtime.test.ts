import { createGeminiGenerator } from "../src/explanations/gemini.js";
import { createExplanationStore } from "../src/explanations/store.js";
import { runExplanationOnce } from "../src/explanations/worker.js";
import { syntheticGenerate } from "./explanation-database.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { importJWK, SignJWT } from "jose";
import { RealtimeClient } from "@supabase/realtime-js";
import { syntheticEvent, sendSyntheticEvent } from "@blissey/simulator";
import { validateIncident } from "@blissey/contracts";
import { createApp } from "../src/app.js";
import { createStore } from "../src/db.js";
import { createDeviceStore, credentialHash } from "../src/ingestion/store.js";
import { createOperatorVerifier } from "../src/auth.js";
const root = new URL("../../../", import.meta.url);
const database = process.env.REALTIME_DATABASE_URL;
const endpoint = process.env.REALTIME_URL;
if (!database || !endpoint)
  throw new Error(
    "Use sh scripts/verify-realtime.sh; test requires isolated local Realtime stack",
  );
const issuer = "https://synthetic.local/auth/v1";
const subject = "11111111-1111-4111-8111-111111111111";
const deniedSubject = "22222222-2222-4222-8222-222222222222";
const token = "synthetic-realtime-device-credential-102";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
test(
  "local Supabase Realtime observes one durable authenticated synthetic incident; RLS excludes another identity",
  { timeout: 120000 },
  async () => {
    const pool = new Pool({ connectionString: database });
    const keys = JSON.parse(
      await readFile(new URL(".supabase-test/keys.json", root), "utf8"),
    );
    const privateKey = await importJWK(keys.private, "ES256");
    const publicKey = await importJWK(keys.public, "ES256");
    const jwt = async (sub: string) =>
      new SignJWT({ role: "authenticated" })
        .setProtectedHeader({ alg: "ES256", kid: "synthetic-local" })
        .setIssuer(issuer)
        .setAudience("authenticated")
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(privateKey);
    const accessToken = await jwt(subject);
    const deniedToken = await jwt(deniedSubject);
    const app = await createApp({
      store: createStore(pool),
      devices: createDeviceStore(pool),
      verifyOperator: createOperatorVerifier(
        issuer,
        "authenticated",
        publicKey,
      ),
      webOrigin: "http://localhost:5173",
    });
    const clients: RealtimeClient[] = [];
    try {
      // Realtime has its own real migrations. Apply only app migrations to the fresh local database.
      for (const file of (await readdir(new URL("supabase/migrations/", root)))
        .filter((f) => f.endsWith(".sql"))
        .sort())
        await pool.query(
          await readFile(new URL(`supabase/migrations/${file}`, root), "utf8"),
        );
      await pool.query(
        await readFile(new URL("supabase/seed.sql", root), "utf8"),
      );
      await pool.query("INSERT INTO auth.users(id) VALUES ($1),($2)", [
        subject,
        deniedSubject,
      ]);
      await pool.query(
        "INSERT INTO public.facility_memberships VALUES ($1,'demo_facility')",
        [subject],
      );
      await pool.query(
        "INSERT INTO public.device_credentials(token_hash,device_id) VALUES ($1,'pi_102')",
        [credentialHash(token)],
      );
      await app.listen({ host: "0.0.0.0", port: 0 });
      const port = (app.server.address() as { port: number }).port;
      let observed = 0;
      let leaked = 0;
      let resolveExplanation!: () => void;
      const explanationUpdated = new Promise<void>((resolve) => {
        resolveExplanation = resolve;
      });
      let resolveObserved!: () => void;
      const observation = new Promise<void>((resolve) => {
        resolveObserved = resolve;
      });
      async function subscribe(
        jwt: string,
        onChange: (payload: { eventType: string }) => void,
      ) {
        const client = new RealtimeClient(endpoint!, {
          params: { apikey: jwt },
          accessToken: async () => jwt,
        });
        clients.push(client);
        const channel = client.channel(`synthetic:${clients.length}`).on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "incidents",
            filter: "facility_id=eq.demo_facility",
          },
          (payload) => onChange(payload),
        );
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new Error(
                  "Local PostgreSQL Realtime subscription did not become ready",
                ),
              ),
            20000,
          );
          channel.on("system", {}, (message) => {
            console.log(
              "Local Realtime subscription:",
              JSON.stringify(message),
            );
            if (
              message.extension === "postgres_changes" &&
              message.status === "ok"
            ) {
              clearTimeout(timer);
              resolve();
            }
            if (message.status === "error") {
              clearTimeout(timer);
              reject(
                new Error(`Realtime subscription failed: ${message.message}`),
              );
            }
          });
          channel.subscribe((status, error) => {
            if (status === "CHANNEL_ERROR") {
              clearTimeout(timer);
              reject(error ?? new Error(status));
            }
          });
        });
      }
      // Use the public local process healthcheck; admin API health uses a different key.
      let ready = false;
      for (let n = 0; n < 90; n++) {
        try {
          if ((await fetch("http://realtime:4000/healthcheck")).ok) {
            ready = true;
            break;
          }
        } catch {
          /* local engine is booting */
        }
        await sleep(500);
      }
      assert.equal(ready, true, "local Realtime engine became ready");
      await subscribe(accessToken, (payload) => {
        if (payload.eventType === "INSERT") {
          observed++;
          resolveObserved();
        }
        if (payload.eventType === "UPDATE") resolveExplanation();
      });
      await subscribe(deniedToken, () => {
        leaked++;
      });
      const event = await syntheticEvent("synthetic-realtime-acceptance");
      const ack = await sendSyntheticEvent({
        url: `ws://127.0.0.1:${port}/api/devices/v1/stream`,
        token,
        event,
      });
      assert.equal(ack.status, "accepted");
      await Promise.race([
        observation,
        sleep(15000).then(() => {
          throw new Error("No actual Realtime incident notification");
        }),
      ]);
      const detail = await fetch(
        `http://127.0.0.1:${port}/api/operator/incidents/${ack.incident_id}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      assert.equal(detail.status, 200);
      const body = (await detail.json()) as { incident: unknown };
      assert.equal(validateIncident(body.incident), true);
      assert.equal(
        (body.incident as { explanation_status: string }).explanation_status,
        "pending",
      );
      assert.equal(
        (
          await sendSyntheticEvent({
            url: `ws://127.0.0.1:${port}/api/devices/v1/stream`,
            token,
            event,
          })
        ).status,
        "duplicate",
      );
      await sleep(400);
      assert.equal(observed, 1);
      assert.equal(leaked, 0);
      const count = await pool.query(
        "SELECT count(*)::int AS count FROM public.incidents WHERE event_id=$1",
        [event.event_id],
      );
      assert.equal(count.rows[0].count, 1);
      const live = process.env.LIVE_GEMINI_CHECK === "1";
      if (live && (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL))
        throw new Error(
          "Live check requires GEMINI_API_KEY and GEMINI_MODEL in .env.deploy.local",
        );
      const generator = live
        ? createGeminiGenerator({
            apiKey: process.env.GEMINI_API_KEY!,
            model: process.env.GEMINI_MODEL!,
          })
        : syntheticGenerate;
      await runExplanationOnce(
        createExplanationStore(pool),
        generator,
        new AbortController().signal,
      );
      await Promise.race([
        explanationUpdated,
        sleep(15000).then(() => {
          throw new Error("No explanation Realtime update");
        }),
      ]);
      const enriched = await fetch(
        `http://127.0.0.1:${port}/api/operator/incidents/${ack.incident_id}?include_explanation=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const enrichedBody = (await enriched.json()) as {
        incident: {
          explanation_status: string;
          explanation: { event_id: string };
          revision: number;
        };
      };
      assert.equal(validateIncident(enrichedBody.incident), true);
      assert.equal(enrichedBody.incident.explanation_status, "ready");
      assert.equal(enrichedBody.incident.explanation.event_id, event.event_id);
      assert.equal(enrichedBody.incident.revision, 2);
      await sleep(400);
      assert.equal(leaked, 0);
      console.log(
        live
          ? "PASS: LIVE Gemini API explanation persisted and observed through actual local Realtime UPDATE + authorized REST; synthetic event and disposable database, not hosted acceptance."
          : "PASS: synthetic Gemini response persisted and observed through actual local Realtime UPDATE + authorized REST. No live Gemini call.",
      );
      console.log(
        "PASS: canonical simulator → authenticated backend → durable PostgreSQL incident → authorized REST + actual local Supabase Realtime; duplicate remains one incident. Synthetic identities/events; no live QNX or hosted deployment.",
      );
    } finally {
      for (const client of clients) {
        await client.removeAllChannels();
        client.disconnect();
      }
      await app.close();
      await pool.end();
    }
  },
);
