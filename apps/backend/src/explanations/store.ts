import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { validateExplanation } from "@blissey/contracts";
import { withTransaction } from "../db.js";
import {
  factsFor,
  inputHash,
  grounded,
  PROMPT_VERSION,
  type Facts,
} from "./content.js";
import type { Generation, FailureCode } from "./gemini.js";
export const MAX_ATTEMPTS = 2;
export interface Claim {
  id: string;
  incidentId: string;
  eventId: string;
  token: string;
  attempts: number;
  exhausted: boolean;
  facts: Facts | null;
  inputHash: string;
  promptVersion: string;
}
export function createExplanationStore(
  pool: Pool,
  options: { leaseMs?: number; retryMs?: number } = {},
) {
  return {
    async claim(): Promise<Claim | null> {
      return withTransaction(pool, async (c) => {
        const selected =
          await c.query(`SELECT j.*,i.event_id,e.payload,r.label FROM public.explanation_jobs j
          JOIN public.incidents i ON i.id=j.incident_id JOIN public.inference_events e ON e.event_id=i.event_id
          JOIN public.rooms r ON r.id=i.room_id
          WHERE (j.state='pending' AND j.next_attempt_at<=clock_timestamp())
             OR (j.state='processing' AND j.lease_until<=clock_timestamp())
          ORDER BY j.next_attempt_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`);
        const row = selected.rows[0];
        if (!row) return null;
        const facts: Facts | null =
          row.input_facts ?? factsFor(row.payload, row.event_id, row.label);
        const hash = inputHash(facts, row.event_id);
        const validFacts =
          row.input_hash && row.input_hash !== hash ? null : facts;
        const claim: Claim = {
          id: row.id,
          incidentId: row.incident_id,
          eventId: row.event_id,
          token: randomUUID(),
          attempts: Math.min(row.attempts + 1, MAX_ATTEMPTS),
          exhausted: row.attempts >= MAX_ATTEMPTS,
          facts: validFacts,
          inputHash: inputHash(validFacts, row.event_id),
          promptVersion: row.prompt_version ?? PROMPT_VERSION,
        };
        await c.query(
          `UPDATE public.explanation_jobs SET state='processing',attempts=$2,lease_token=$3,
          lease_until=clock_timestamp()+$4::double precision*interval '1 millisecond',
          input_facts=$5,input_hash=$6,prompt_version=$7 WHERE id=$1`,
          [
            claim.id,
            claim.attempts,
            claim.token,
            options.leaseMs ?? 30000,
            claim.facts,
            claim.inputHash,
            claim.promptVersion,
          ],
        );
        return claim;
      });
    },
    async retry(claim: Claim, code: FailureCode) {
      const r = await pool.query(
        `UPDATE public.explanation_jobs SET state='pending',lease_token=NULL,lease_until=NULL,
        next_attempt_at=clock_timestamp()+$3::double precision*interval '1 millisecond',last_error_code=$4
        WHERE id=$1 AND lease_token=$2 AND state='processing' AND lease_until>clock_timestamp()`,
        [claim.id, claim.token, options.retryMs ?? 2000, code],
      );
      return r.rowCount === 1;
    },
    async complete(
      claim: Claim,
      generation: Generation,
      status: "ready" | "fallback",
      code: FailureCode | "lease_expired" | null = null,
    ) {
      if (
        !validateExplanation(generation.output) ||
        generation.output.event_id !== claim.eventId ||
        (status === "ready" &&
          (!claim.facts || !grounded(generation.output, claim.facts)))
      )
        throw new Error("Invalid explanation completion");
      return withTransaction(pool, async (c) => {
        const owner = await c.query(
          `SELECT id FROM public.explanation_jobs WHERE id=$1 AND lease_token=$2
          AND state='processing' AND lease_until>clock_timestamp() FOR UPDATE`,
          [claim.id, claim.token],
        );
        if (owner.rowCount !== 1) return false;
        await c.query(
          `INSERT INTO public.explanations(incident_id,event_id,output,source,model,prompt_version,input_hash)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            claim.incidentId,
            claim.eventId,
            generation.output,
            status === "ready" ? "gemini" : "deterministic",
            generation.model,
            claim.promptVersion,
            claim.inputHash,
          ],
        );
        await c.query(
          `UPDATE public.explanation_jobs SET state=$2,lease_token=NULL,lease_until=NULL,last_error_code=$3 WHERE id=$1`,
          [claim.id, status === "ready" ? "completed" : "fallback", code],
        );
        await c.query(
          "UPDATE public.incidents SET revision=revision+1 WHERE id=$1",
          [claim.incidentId],
        );
        return true;
      });
    },
  };
}
export type ExplanationStore = ReturnType<typeof createExplanationStore>;
