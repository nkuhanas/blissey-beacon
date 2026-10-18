import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  DashboardRoom,
  DemoScenarioRequest,
  InferenceEvent,
} from "@blissey/contracts";
import { withTransaction } from "../db.js";
import { member } from "../notifications/access.js";
import { CallError } from "../notifications/policy.js";
import { persistInferenceEvent } from "../ingestion/store.js";
import {
  fallback,
  factsFor,
  inputHash,
  PROMPT_VERSION,
} from "../explanations/content.js";

const residents = [
  "Eleanor Brooks",
  "James Wilson",
  "Rose Chen",
  "Margaret Lee",
  "Arthur Davis",
  "Grace Patel",
];
const contacts = [
  "Alex Brooks",
  "Morgan Wilson",
  "Jamie Chen",
  "Daniel Lee",
  "Taylor Davis",
  "Sam Patel",
];
export interface DemoOptions {
  enabled: boolean;
  facilityId: string;
  phone?: string;
}

async function provision(c: PoolClient, subject: string, options: DemoOptions) {
  if (!options.phone || !/^\+[1-9]\d{7,14}$/.test(options.phone))
    throw new CallError("demo_recipient_not_configured", 503);
  // Serialize fixture creation; never overwrite hardware assignments, consent changes or existing patients.
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    "dashboard-fixtures:" + options.facilityId,
  ]);
  for (let index = 0; index < residents.length; index++) {
    const room = String(101 + index),
      patient = "dashboard_resident_" + room;
    await c.query(
      "INSERT INTO public.rooms(id,facility_id,label,floor) VALUES($1,$2,$3,0) ON CONFLICT(id) DO NOTHING",
      [room, options.facilityId, "Room " + room],
    );
    if (
      !(
        await c.query(
          "SELECT 1 FROM public.rooms WHERE id=$1 AND facility_id=$2 FOR SHARE",
          [room, options.facilityId],
        )
      ).rowCount
    )
      throw new CallError("demo_room_conflict");
    await c.query(
      "INSERT INTO public.patients(id,facility_id,display_label) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",
      [patient, options.facilityId, residents[index]],
    );
    const assignment = (
      await c.query(
        "SELECT patient_id FROM public.room_assignments WHERE room_id=$1 AND released_at IS NULL FOR SHARE",
        [room],
      )
    ).rows[0];
    if (!assignment)
      await c.query(
        "INSERT INTO public.room_assignments(facility_id,room_id,patient_id,assigned_at) VALUES($1,$2,$3,clock_timestamp())",
        [options.facilityId, room, patient],
      );
    // Only provision a contact for our own fixture patient, never somebody else's existing assignment.
    if (!assignment || assignment.patient_id === patient) {
      await c.query(
        `INSERT INTO public.family_contacts(id,facility_id,patient_id,contact_name,relationship,phone_e164,consent_status,consented_at,imessage_consent_status,imessage_consented_at)
        VALUES($1,$2,$3,$4,'Fictional family contact',$5,'granted',now(),'granted',now()) ON CONFLICT(patient_id) DO NOTHING`,
        [
          randomUUID(),
          options.facilityId,
          patient,
          contacts[index],
          options.phone,
        ],
      );
    }
    await c.query(
      "INSERT INTO public.devices(id,room_id) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
      ["dashboard_sim_" + room, room],
    );
  }
  await c.query(
    "INSERT INTO public.operator_audit(facility_id,actor_id,action,target_id,detail) VALUES($1,$2,'dashboard_fixtures_verified',$3,$4)",
    [
      options.facilityId,
      subject,
      randomUUID(),
      { fictional: true, test_recipient_configured: true },
    ],
  );
}

export function createDemoStore(pool: Pool, options: DemoOptions) {
  return {
    async rooms(subject: string, facility: string): Promise<DashboardRoom[]> {
      return withTransaction(pool, async (c) => {
        await member(c, subject, facility);
        const result = await c.query(
          `SELECT r.id,r.label,p.display_label AS resident,p.id AS patient_id,
          CASE WHEN s.room_id IS NOT NULL THEN 'dashboard_sim_'||r.id ELSE d.id END AS device_id,
          CASE WHEN s.room_id IS NOT NULL THEN s.sampled_at ELSE h.received_at END AS last_data_at,
          CASE WHEN s.room_id IS NOT NULL THEN 'synthetic' ELSE 'device' END AS data_source,
          CASE WHEN s.room_id IS NOT NULL THEN s.confidence_scores ELSE NULL END AS confidence_scores,
          CASE WHEN s.room_id IS NOT NULL THEN CASE WHEN s.mode='offline' OR s.sampled_at IS NULL OR s.sampled_at<clock_timestamp()-interval '30 seconds' THEN 'offline' ELSE 'monitoring' END ELSE
          CASE WHEN h.received_at IS NULL OR h.received_at<clock_timestamp()-interval '30 seconds' THEN 'offline'
          WHEN h.sensor_status<>'connected' OR h.model_status<>'ready' THEN 'degraded' ELSE 'monitoring' END END AS monitoring_status,
          f.id AS contact_id,f.contact_name,COALESCE(f.consent_status='granted',false) AS voice_consent,
          COALESCE(f.imessage_consent_status='granted',false) AS messaging_consent
          FROM public.rooms r
          LEFT JOIN public.room_assignments a ON a.room_id=r.id AND a.released_at IS NULL
          LEFT JOIN public.patients p ON p.id=a.patient_id
          LEFT JOIN public.family_contacts f ON f.patient_id=p.id AND f.facility_id=r.facility_id
          LEFT JOIN LATERAL (SELECT dev.id FROM public.devices dev WHERE dev.room_id=r.id
            ORDER BY (left(dev.id,14)='dashboard_sim_') ASC,dev.id LIMIT 1) d ON true
          LEFT JOIN public.device_health h ON h.device_id=d.id
          LEFT JOIN public.demo_room_streams s ON s.room_id=r.id AND $2::boolean AND r.id<>'101' AND r.facility_id=$3
            AND NOT EXISTS(SELECT 1 FROM public.devices hd JOIN public.device_credentials hc ON hc.device_id=hd.id WHERE hd.room_id=r.id AND hc.revoked_at IS NULL)
          WHERE r.facility_id=$1 ORDER BY r.id`,
          [facility, options.enabled, options.facilityId],
        );
        return result.rows.map((row) => ({
          ...row,
          last_data_at: row.last_data_at?.toISOString() ?? null,
        }));
      });
    },
    async reset(subject: string, key: string, room: string, facility: string) {
      return withTransaction(pool, async (c) => {
        await member(c, subject, facility);
        if (
          !(
            await c.query(
              "SELECT 1 FROM public.rooms WHERE id=$1 AND facility_id=$2 FOR UPDATE",
              [room, facility],
            )
          ).rowCount
        )
          throw new CallError("not_found", 404);
        await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          subject + ":reset:" + key,
        ]);
        const previous = (
          await c.query(
            "SELECT target_id,detail FROM public.operator_audit WHERE actor_id=$1 AND request_key=$2",
            [subject, key],
          )
        ).rows[0];
        if (previous) {
          if (
            previous.target_id !== room ||
            previous.detail.facility_id !== facility
          )
            throw new CallError("reset_idempotency_conflict");
          return previous.detail;
        }
        const archived = await c.query(
          "UPDATE public.incidents SET archived_at=clock_timestamp(),revision=revision+1 WHERE room_id=$1 AND facility_id=$2 AND archived_at IS NULL RETURNING id",
          [room, facility],
        );
        const events = await c.query(
          "UPDATE public.inference_events SET archived_at=clock_timestamp() WHERE room_id=$1 AND archived_at IS NULL RETURNING event_id",
          [room],
        );
        await c.query(
          "UPDATE public.demo_room_streams SET mode='healthy',sampled_at=clock_timestamp(),sample_index=0,confidence_scores='{\"fall\":0.02,\"non_fall\":0.98}' WHERE room_id=$1",
          [room],
        );
        const result = {
          room_id: room,
          facility_id: facility,
          archived_incidents: archived.rowCount,
          archived_events: events.rowCount,
        };
        await c.query(
          "INSERT INTO public.operator_audit(facility_id,actor_id,action,target_id,request_key,detail) VALUES($1,$2,'room_reset',$3,$4,$5)",
          [facility, subject, room, key, result],
        );
        return result;
      });
    },
    async instantiate(
      subject: string,
      key: string,
      input: DemoScenarioRequest,
    ) {
      if (!options.enabled || input.facility_id !== options.facilityId)
        throw new CallError("demo_scenarios_disabled", 403);
      return withTransaction(pool, async (c) => {
        await member(c, subject, input.facility_id);
        await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          subject + ":" + key,
        ]);
        const previous = (
          await c.query(
            "SELECT * FROM public.dashboard_scenarios WHERE actor_id=$1 AND idempotency_key=$2",
            [subject, key],
          )
        ).rows[0];
        if (previous) {
          if (
            previous.facility_id !== input.facility_id ||
            previous.room_id !== input.room_id ||
            previous.scenario !== input.scenario
          )
            throw new CallError("scenario_idempotency_conflict");
          return {
            scenario_id: previous.id,
            incident_id: previous.incident_id,
            scenario: previous.scenario,
            room_id: previous.room_id,
          };
        }
        await provision(c, subject, options);
        if (input.room_id !== "101")
          await c.query(
            `INSERT INTO public.demo_room_streams(room_id,mode,sampled_at)
          SELECT $1,$2,clock_timestamp() WHERE NOT EXISTS(SELECT 1 FROM public.devices d JOIN public.device_credentials dc ON dc.device_id=d.id WHERE d.room_id=$1 AND dc.revoked_at IS NULL)
          ON CONFLICT(room_id) DO UPDATE SET mode=EXCLUDED.mode,sampled_at=EXCLUDED.sampled_at`,
            [
              input.room_id,
              input.scenario === "offline" ? "offline" : "healthy",
            ],
          );
        const count = (
          await c.query(
            "SELECT count(*)::int AS n FROM public.dashboard_scenarios WHERE actor_id=$1 AND created_at>now()-interval '1 minute'",
            [subject],
          )
        ).rows[0].n;
        if (count >= 10) throw new CallError("scenario_rate_limited", 429);
        const scenarioId = randomUUID();
        let incidentId: string | null = null;
        if (!["empty", "offline"].includes(input.scenario)) {
          const detected = (
            await c.query("SELECT clock_timestamp() AS t")
          ).rows[0].t.toISOString();
          const event: InferenceEvent = {
            event_id: "synthetic_dashboard_" + scenarioId,
            room_id: input.room_id,
            device_id: "dashboard_sim_" + input.room_id,
            event_type: "inference_result",
            confidence_scores: { fall: 0.91, non_fall: 0.09 },
            detected_at: detected,
            sensor_status: "connected",
          };
          const ack = await persistInferenceEvent(
            c,
            {
              device_id: event.device_id,
              room_id: event.room_id,
              facility_id: input.facility_id,
            },
            event,
          );
          incidentId = ack.incident_id;
          if (input.scenario === "fallback") {
            const facts = factsFor(
              event,
              event.event_id,
              "Room " + input.room_id,
            );
            await c.query(
              `INSERT INTO public.explanations(incident_id,event_id,output,source,model,prompt_version,input_hash)
              VALUES($1,$2,$3,'deterministic','synthetic-forced-fallback',$4,$5)`,
              [
                incidentId,
                event.event_id,
                fallback(event.event_id),
                PROMPT_VERSION,
                inputHash(facts, event.event_id),
              ],
            );
            await c.query(
              "UPDATE public.explanation_jobs SET state='fallback',last_error_code='synthetic_fallback' WHERE incident_id=$1",
              [incidentId],
            );
            await c.query(
              "UPDATE public.incidents SET revision=revision+1 WHERE id=$1",
              [incidentId],
            );
          }
        }
        // Scenario overrides affect only the separate synthetic feed, never physical Pi health.
        await c.query(
          "INSERT INTO public.dashboard_scenarios(id,facility_id,actor_id,idempotency_key,room_id,scenario,incident_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            scenarioId,
            input.facility_id,
            subject,
            key,
            input.room_id,
            input.scenario,
            incidentId,
          ],
        );
        await c.query(
          "INSERT INTO public.operator_audit(facility_id,actor_id,action,target_id,detail) VALUES($1,$2,'dashboard_scenario_created',$3,$4)",
          [
            input.facility_id,
            subject,
            scenarioId,
            {
              scenario: input.scenario,
              room_id: input.room_id,
              incident_id: incidentId,
              source: "synthetic",
            },
          ],
        );
        return {
          scenario_id: scenarioId,
          incident_id: incidentId,
          scenario: input.scenario,
          room_id: input.room_id,
        };
      });
    },
  };
}
