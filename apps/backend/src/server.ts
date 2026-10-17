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
});
app.addHook("onClose", async () => {
  await worker?.stop();
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
