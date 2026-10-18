import { createCallStore } from "./notifications/store.js";
import {
  createDispatchStore,
  startCallWorker,
} from "./notifications/dispatch.js";
import { createElevenLabsSubmit } from "./notifications/provider.js";
let callWorker: ReturnType<typeof startCallWorker> | undefined;
import { createDeviceStore } from "./ingestion/store.js";
import { Pool } from "pg";
import { loadConfig } from "./config.js";
import { createOperatorVerifier } from "./auth.js";
import { createStore } from "./db.js";
import { createApp } from "./app.js";
import { createGeminiGenerator } from "./explanations/gemini.js";
import { createExplanationStore } from "./explanations/store.js";
import { startExplanationWorker } from "./explanations/worker.js";
let worker: ReturnType<typeof startExplanationWorker> | undefined;
const config = loadConfig();
const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 5000,
});
const app = await createApp({
  verifyOperator: createOperatorVerifier(config.issuer, config.audience),
  store: createStore(pool),
  webOrigin: config.webOrigin,
  devices: createDeviceStore(pool),
  calls: {
    store: createCallStore(pool),
    dispatch: createDispatchStore(pool),
    enabled: config.callsEnabled,
    ...(config.voice.secret && config.voice.agentId
      ? {
          webhook: {
            secret: config.voice.secret,
            agentId: config.voice.agentId,
          },
        }
      : {}),
  },
});
app.addHook("onClose", async () => {
  await Promise.all([worker?.stop(), callWorker?.stop()]);
  await pool.end();
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void app.close().catch(() => {
      process.exitCode = 1;
    });
  });
try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  if (config.callsEnabled)
    callWorker = startCallWorker(
      createDispatchStore(pool),
      createElevenLabsSubmit({
        apiKey: config.voice.apiKey!,
        agentId: config.voice.agentId!,
        phoneNumberId: config.voice.phoneNumberId!,
      }),
      app.log,
    );
  if (config.gemini) {
    worker = startExplanationWorker(
      createExplanationStore(pool),
      createGeminiGenerator(config.gemini),
      app.log,
    );
    app.log.info(
      { model: config.gemini.model },
      "Gemini explanation worker enabled",
    );
  } else
    app.log.info(
      "Explanation worker disabled: GEMINI_API_KEY is not configured; jobs remain pending",
    );
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
