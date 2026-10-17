import { setTimeout as delay } from "node:timers/promises";
import { fallback, grounded } from "./content.js";
import { GenerationError, type Generate } from "./gemini.js";
import { MAX_ATTEMPTS, type ExplanationStore } from "./store.js";
export async function runExplanationOnce(
  store: ExplanationStore,
  generate: Generate,
  signal: AbortSignal,
) {
  if (signal.aborted) return false;
  const claim = await store.claim();
  if (!claim) return false;
  if (!claim.facts || claim.exhausted) {
    await store.complete(
      claim,
      { output: fallback(claim.eventId), model: "deterministic-v1" },
      "fallback",
      claim.exhausted ? "lease_expired" : "invalid_input",
    );
    return true;
  }
  try {
    const generation = await generate(claim.facts, signal);
    if (signal.aborted) return true; // Leave the durable lease for restart recovery.
    if (!grounded(generation.output, claim.facts))
      throw new GenerationError("grounding_rejected", false);
    await store.complete(claim, generation, "ready");
  } catch (error) {
    if (signal.aborted) return true;
    if (!(error instanceof GenerationError)) throw error; // Database/programming failures do not masquerade as provider responses.
    if (error.retryable && claim.attempts < MAX_ATTEMPTS)
      await store.retry(claim, error.code);
    else
      await store.complete(
        claim,
        { output: fallback(claim.eventId), model: "deterministic-v1" },
        "fallback",
        error.code,
      );
  }
  return true;
}
export function startExplanationWorker(
  store: ExplanationStore,
  generate: Generate,
  log: { error: (fields: { code: string }, message: string) => void },
) {
  const controller = new AbortController();
  const running = (async () => {
    while (!controller.signal.aborted) {
      let worked = false;
      try {
        worked = await runExplanationOnce(store, generate, controller.signal);
      } catch {
        log.error(
          { code: "explanation_worker_error" },
          "Explanation processing failed; durable lease will recover",
        );
      }
      if (!worked && !controller.signal.aborted) {
        try {
          await delay(1000, undefined, { signal: controller.signal });
        } catch {
          /* shutdown */
        }
      }
    }
  })();
  return {
    async stop() {
      controller.abort();
      await running;
    },
  };
}
