import { createDeviceStore } from "./ingestion/store.js";
import { Pool } from "pg";
import { loadConfig } from "./config.js";
import { createOperatorVerifier } from "./auth.js";
import { createStore } from "./db.js";
import { createApp } from "./app.js";
const config = loadConfig();
const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
const app = await createApp({
  verifyOperator: createOperatorVerifier(config.issuer, config.audience),
  store: createStore(pool),
  webOrigin: config.webOrigin,
  devices: createDeviceStore(pool),
});
app.addHook("onClose", async () => {
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
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
